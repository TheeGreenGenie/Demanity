import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import {
  BillCard,
  FollowToggle,
  OverallCard,
  SampleBanner,
  Section,
  Tabs,
} from '@/components/civic';
import { Button, ErrorText, Field } from '@/components/form';
import { Empty, ScoresTab } from '@/components/place-sections';
import { Screen } from '@/components/screen';
import { timeAgo } from '@/components/social';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  civic,
  describeError,
  type Leader,
  type LeaderRequest,
  type LeaderViewer,
  moderation,
  type RequestStatus,
} from '@/lib/api';
import { isFullyOnboarded, useAuth } from '@/lib/auth';

type Tab = 'legislation' | 'scores' | 'requests';
const TABS: readonly { key: Tab; label: string }[] = [
  { key: 'legislation', label: 'Legislation' },
  { key: 'scores', label: 'Scores' },
  { key: 'requests', label: 'Requests' },
];

/** Leader page: most recent legislation, 0-100 scores (tap for why), and member requests. */
export default function LeaderScreen() {
  const { slug, tab } = useLocalSearchParams<{ slug: string; tab?: Tab }>();
  const router = useRouter();
  const theme = useTheme();
  const { token } = useAuth();
  const [leader, setLeader] = useState<Leader | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<Tab>(tab ?? 'legislation');

  useEffect(() => {
    civic
      .leader(token, slug)
      .then(setLeader)
      .catch((err) => setError(describeError(err)));
  }, [token, slug]);

  return (
    <Screen flush>
      <View style={[styles.banner, { backgroundColor: Brand.primary }]}>
        <Ionicons name="ribbon" size={120} color="rgba(255,255,255,0.12)" style={styles.art} />
      </View>
      <View style={styles.header}>
        <View style={[styles.avatarRing, { borderColor: theme.background }]}>
          <Avatar name={leader?.name ?? null} size={76} />
        </View>
        <View style={styles.nameRow}>
          <ThemedText type="subtitle" style={styles.flex}>
            {leader?.name ?? ''}
          </ThemedText>
          {leader ? <FollowToggle kind="leader" name={leader.slug} /> : null}
        </View>
        {leader ? (
          <>
            <ThemedText themeColor="textSecondary">
              {leader.office}
              {leader.party ? ` · ${leader.party}` : ''}
            </ThemedText>
            {leader.place ? (
              <Pressable
                accessibilityRole="link"
                onPress={() =>
                  router.push({ pathname: '/place/[slug]', params: { slug: leader.place!.slug } })
                }
              >
                <ThemedText type="small" style={{ color: Brand.primary, fontWeight: 700 }}>
                  {leader.place.name}
                </ThemedText>
              </Pressable>
            ) : null}
            {!leader.inOffice ? (
              <ThemedText type="caption" themeColor="textSecondary">
                No longer in office: this page is read-only and scores are frozen.
              </ThemedText>
            ) : null}
          </>
        ) : null}
      </View>
      <ErrorText message={error} />
      {leader ? <ClaimBanner leader={leader} /> : null}
      {leader?.isSample ? (
        <SampleBanner what="this leader is a fictional person; the bills and scores are made up" />
      ) : null}
      {leader ? <OverallCard overall={leader.overall} /> : null}
      <View style={styles.gap} />
      <Tabs tabs={TABS} value={current} onChange={setCurrent} />
      {leader && current === 'legislation' ? <LegislationTab leader={leader} /> : null}
      {leader && current === 'scores' ? <ScoresTab kind="leader" slug={leader.slug} /> : null}
      {leader && current === 'requests' ? <RequestsTab leader={leader} /> : null}
    </Screen>
  );
}

function LegislationTab({ leader }: { leader: Leader }) {
  return (
    <View>
      <Section title="Recently passed" caption="Bills they sponsored that passed or became law">
        {leader.passed.length === 0 ? (
          <Empty text="No passed legislation on record yet." />
        ) : (
          leader.passed.map((b) => <BillCard key={b.id} bill={b} />)
        )}
      </Section>
      <Section title="Still in progress" caption="Sponsored or cosponsored, newest action first">
        {leader.sponsored.length === 0 ? (
          <Empty text="Nothing else on record yet." />
        ) : (
          leader.sponsored.map((b) => <BillCard key={b.id} bill={b} />)
        )}
      </Section>
    </View>
  );
}

function RequestsTab({ leader }: { leader: Leader }) {
  const router = useRouter();
  const theme = useTheme();
  const { token, me } = useAuth();
  const member = isFullyOnboarded(me) && token !== null;
  const [requests, setRequests] = useState<LeaderRequest[]>([]);
  const [threshold, setThreshold] = useState(25);
  const isLeader = useLeaderViewer(leader.slug)?.isLeader ?? false;
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [titleError, setTitleError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(false);

  const load = useCallback(() => {
    civic
      .requests(token, leader.slug)
      .then((r) => {
        setRequests(r.requests);
        setThreshold(r.threshold);
      })
      .catch((err) => setError(describeError(err)));
  }, [token, leader.slug]);
  useEffect(load, [load]);

  async function submit() {
    if (!member) return router.push('/join');
    const t = title.trim();
    if (t.length < 5) return setTitleError('Write at least 5 characters.');
    setTitleError(undefined);
    setBusy(true);
    try {
      await civic.createRequest(token!, leader.slug, t, body.trim());
      setTitle('');
      setBody('');
      setComposing(false);
      load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(r: LeaderRequest) {
    if (!member) return router.push('/join');
    const next = !r.myVote;
    setRequests((list) =>
      list.map((x) =>
        x.id === r.id ? { ...x, myVote: next, votes: x.votes + (next ? 1 : -1) } : x,
      ),
    );
    try {
      if (next) await civic.voteRequest(token!, r.id);
      else await civic.unvoteRequest(token!, r.id);
    } catch (err) {
      setError(describeError(err));
      load();
    }
  }

  return (
    <View>
      <Section
        title={`What people want ${leader.name.split(' ')[0]} to do`}
        caption={`Most-wanted first · one vote per verified member · at ${threshold} votes a public response is expected`}
      />

      <ErrorText message={error} />
      {requests.length === 0 ? <Empty text="No requests yet. Add the first one." /> : null}
      {requests.map((r) => (
        <View key={r.id} style={[styles.request, { borderBottomColor: theme.backgroundSelected }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Upvote (${r.votes})`}
            accessibilityState={{ selected: r.myVote }}
            onPress={() => toggle(r)}
            style={({ pressed }) => [
              styles.vote,
              {
                backgroundColor: r.myVote ? Brand.primary : theme.backgroundElement,
              },
              pressed && { opacity: 0.75 },
            ]}
          >
            <Ionicons name="arrow-up" size={18} color={r.myVote ? '#fff' : theme.text} />
            <ThemedText type="smallBold" style={r.myVote ? { color: '#fff' } : undefined}>
              {r.votes}
            </ThemedText>
          </Pressable>
          <View style={styles.flex}>
            <View style={styles.statusRow}>
              <RequestStatusChip status={r.status} />
              {r.awaitingResponseDays !== null ? (
                <ThemedText type="caption" style={{ color: Brand.dislike, fontWeight: 800 }}>
                  Awaiting response · {r.awaitingResponseDays}{' '}
                  {r.awaitingResponseDays === 1 ? 'day' : 'days'}
                </ThemedText>
              ) : null}
            </View>
            <ThemedText type="smallBold">{r.title}</ThemedText>
            {r.body ? (
              <ThemedText type="small" themeColor="textSecondary">
                {r.body}
              </ThemedText>
            ) : null}
            <ThemedText type="caption" themeColor="textSecondary">
              {r.author ? `u/${r.author.username}` : 'deleted'} · {timeAgo(r.createdAt)}
              {r.mergedCount > 0
                ? ` · ${r.mergedCount} duplicate${r.mergedCount === 1 ? '' : 's'} merged in`
                : ''}
            </ThemedText>
            {r.response ? (
              <View style={[styles.response, { borderLeftColor: Brand.primary }]}>
                <ThemedText type="caption" style={{ color: Brand.primary, fontWeight: 900 }}>
                  {leader.name.toUpperCase()} RESPONDED
                  {r.respondedAt ? ` · ${timeAgo(r.respondedAt)}` : ''}
                </ThemedText>
                <ThemedText type="small">{r.response}</ThemedText>
              </View>
            ) : null}
            {isLeader && r.status !== 'done' ? (
              <LeaderControls request={r} onChange={load} />
            ) : null}
            {me?.moderator && !isLeader ? (
              <ModRequestControls
                request={r}
                others={requests.filter((x) => x.id !== r.id)}
                onChange={load}
              />
            ) : null}
          </View>
        </View>
      ))}
      {leader.inOffice && !composing ? (
        <View style={styles.addWrap}>
          <Button
            title={member ? 'Add a request' : 'Join to add requests'}
            variant="secondary"
            onPress={() => (member ? setComposing(true) : router.push('/join'))}
          />
        </View>
      ) : null}
      {leader.inOffice && composing ? (
        <View style={[styles.composer, { backgroundColor: theme.backgroundElement }]}>
          <Field
            label="Your request"
            placeholder="e.g. Hold a town hall in every county"
            value={title}
            onChangeText={setTitle}
            maxLength={140}
            error={titleError}
          />
          <Field
            label="Details (optional)"
            value={body}
            onChangeText={setBody}
            multiline
            maxLength={2000}
          />
          <Button
            title={member ? 'Add request' : 'Join to add requests'}
            onPress={submit}
            busy={busy}
          />
        </View>
      ) : null}
    </View>
  );
}

/** Viewer-specific leader state (claimed? is this my page?), kept off the cached page. */
function useLeaderViewer(slug: string) {
  const { token } = useAuth();
  const [state, setState] = useState<LeaderViewer | null>(null);
  useEffect(() => {
    let cancelled = false;
    civic
      .leaderViewer(token, slug)
      .then((v) => !cancelled && setState(v))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token, slug]);
  return state;
}

function ClaimBanner({ leader }: { leader: Leader }) {
  const router = useRouter();
  const theme = useTheme();
  const { me } = useAuth();
  const viewer = useLeaderViewer(leader.slug);
  if (!viewer || leader.isSample || !leader.inOffice) return null;
  if (viewer.isLeader)
    return (
      <View style={[styles.banner2, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold" style={{ color: Brand.primary }}>
          This is your page. You can answer requests on the Requests tab.
        </ThemedText>
      </View>
    );
  if (viewer.claimPending)
    return (
      <View style={[styles.banner2, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="small" themeColor="textSecondary">
          Your claim on this page is being reviewed.
        </ThemedText>
      </View>
    );
  if (viewer.claimed || !isFullyOnboarded(me)) return null;
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() =>
        router.push({ pathname: '/claim', params: { slug: leader.slug, name: leader.name } })
      }
      style={[styles.banner2, { backgroundColor: theme.backgroundElement }]}
    >
      <ThemedText type="small" style={{ color: Brand.primary, fontWeight: 800 }}>
        Are you {leader.name}? Claim this page →
      </ThemedText>
    </Pressable>
  );
}

/** Moderators: mark done when the action is documented, remove, or merge a duplicate. */
function ModRequestControls({
  request,
  others,
  onChange,
}: {
  request: LeaderRequest;
  others: LeaderRequest[];
  onChange: () => void;
}) {
  const { token } = useAuth();
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (body: Parameters<typeof moderation.moderateRequest>[2]) => {
    try {
      await moderation.moderateRequest(token!, request.id, body);
      setMerging(false);
      onChange();
    } catch (err) {
      setError(describeError(err));
    }
  };
  return (
    <View style={styles.controls}>
      <View style={styles.controlRow}>
        {request.status !== 'done' ? (
          <Button
            title="Done (documented)"
            size="small"
            variant="ghost"
            onPress={() => act({ status: 'done', reasonCode: 'leader_action_documented' })}
          />
        ) : null}
        {others.length ? (
          <Button
            title="Merge…"
            size="small"
            variant="ghost"
            onPress={() => setMerging((m) => !m)}
          />
        ) : null}
        <Button
          title="Remove"
          size="small"
          variant="ghost"
          onPress={() => act({ status: 'removed', reasonCode: 'not_a_request' })}
        />
      </View>
      {merging
        ? others
            .slice(0, 8)
            .map((o) => (
              <Button
                key={o.id}
                title={`Merge into: ${o.title}`}
                size="small"
                variant="secondary"
                onPress={() =>
                  act({ status: 'merged', mergeInto: o.id, reasonCode: 'duplicate_request' })
                }
              />
            ))
        : null}
      <ErrorText message={error} />
    </View>
  );
}

/** For the leader only: acknowledge, respond in writing, or mark done. */
function LeaderControls({ request, onChange }: { request: LeaderRequest; onChange: () => void }) {
  const { token } = useAuth();
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const update = async (status: 'acknowledged' | 'responded' | 'done', response?: string) => {
    try {
      await civic.updateRequest(token!, request.id, response ? { status, response } : { status });
      setWriting(false);
      onChange();
    } catch (err) {
      setError(describeError(err));
    }
  };
  return (
    <View style={styles.controls}>
      {writing ? (
        <>
          <Field
            label="Your response"
            value={text}
            onChangeText={setText}
            multiline
            maxLength={4000}
          />
          <Button
            title="Post response"
            size="small"
            onPress={() =>
              text.trim() ? update('responded', text.trim()) : setError('Write a response first.')
            }
          />
        </>
      ) : (
        <View style={styles.controlRow}>
          {request.status === 'open' ? (
            <Button
              title="Acknowledge"
              size="small"
              variant="secondary"
              onPress={() => update('acknowledged')}
            />
          ) : null}
          <Button
            title="Respond"
            size="small"
            variant="secondary"
            onPress={() => setWriting(true)}
          />
          <Button title="Mark done" size="small" variant="ghost" onPress={() => update('done')} />
        </View>
      )}
      <ErrorText message={error} />
    </View>
  );
}

const STATUS: Record<RequestStatus, { label: string; color: string }> = {
  open: { label: 'Open', color: '#8B919C' },
  acknowledged: { label: 'Acknowledged', color: Brand.location },
  responded: { label: 'Responded', color: Brand.primary },
  done: { label: 'Done', color: Brand.like },
};

function RequestStatusChip({ status }: { status: RequestStatus }) {
  const s = STATUS[status];
  return (
    <View style={[styles.chip, { borderColor: s.color }]}>
      <ThemedText type="caption" style={{ color: s.color, fontWeight: 800 }}>
        {s.label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  banner2: {
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    padding: Spacing.three - 4,
    borderRadius: Radius.medium,
  },
  controls: { gap: Spacing.two, marginTop: Spacing.two },
  controlRow: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  chip: { borderWidth: 1, borderRadius: Radius.pill, paddingHorizontal: Spacing.two },
  response: { borderLeftWidth: 3, paddingLeft: Spacing.two, gap: 2, marginTop: Spacing.one },
  flex: { flex: 1, gap: 2 },
  banner: { height: 120, overflow: 'hidden' },
  art: { position: 'absolute', right: -10, bottom: -24 },
  header: { paddingHorizontal: Spacing.three, gap: Spacing.one },
  avatarRing: { marginTop: -42, borderWidth: 4, borderRadius: 46, alignSelf: 'flex-start' },
  gap: { height: Spacing.three },
  addWrap: { padding: Spacing.three },
  composer: {
    margin: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.medium,
    gap: Spacing.three,
  },
  request: {
    flexDirection: 'row',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three - 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  vote: {
    width: 52,
    alignItems: 'center',
    borderRadius: Radius.medium,
    paddingVertical: Spacing.two,
    alignSelf: 'flex-start',
  },
});
