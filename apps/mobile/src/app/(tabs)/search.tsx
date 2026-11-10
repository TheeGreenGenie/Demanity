import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { BillCard, peerWord, Section } from '@/components/civic';
import { ErrorText } from '@/components/form';
import { CommunityIcon } from '@/components/forum';
import { Screen } from '@/components/screen';
import { FollowButton } from '@/components/social';
import { ThemedText } from '@/components/themed-text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { civic, describeError, social, type Community, type SearchResults } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/**
 * Search tab: a search bar over communities, places, leaders, bills and posts.
 * With an empty query it shows the community directory, Reddit-style. Humanity
 * is its own tab, so it is not listed or searched here.
 */
export default function SearchScreen() {
  const theme = useTheme();
  const { token } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = query.trim();

  useEffect(() => {
    if (q.length < 2) return;
    let cancelled = false;
    const t = setTimeout(() => {
      civic
        .search(token, q)
        .then((r) => !cancelled && (setResults(r), setError(null)))
        .catch((err) => !cancelled && setError(describeError(err)));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, token]);

  return (
    <Screen flush>
      <View style={styles.searchWrap}>
        <View style={[styles.search, { backgroundColor: theme.backgroundElement }]}>
          <Ionicons name="search" size={18} color={theme.textSecondary} />
          <TextInput
            accessibilityLabel="Search Demanity"
            placeholder="Search places, leaders, bills, topics"
            placeholderTextColor={theme.textSecondary}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.input, { color: theme.text }]}
          />
          {query ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setQuery('')}
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <ErrorText message={error} />
      {q.length >= 2 && results ? <Results results={results} /> : <Directory />}
    </Screen>
  );
}

function Results({ results }: { results: SearchResults }) {
  const total =
    results.communities.length +
    results.places.length +
    results.leaders.length +
    results.bills.length +
    results.posts.length;
  if (total === 0)
    return (
      <View style={styles.pad}>
        <ThemedText themeColor="textSecondary">No results. Try another word.</ThemedText>
      </View>
    );
  return (
    <View>
      {results.places.length ? (
        <Section title="Places">
          {results.places.map((p) => (
            <ResultRow
              key={p.slug}
              icon="location"
              color={Brand.location}
              title={p.name}
              caption={peerWord(p.kind, false)}
              href={{ pathname: '/place/[slug]', params: { slug: p.slug } }}
            />
          ))}
        </Section>
      ) : null}
      {results.leaders.length ? (
        <Section title="Leaders">
          {results.leaders.map((l) => (
            <ResultRow
              key={l.slug}
              icon="ribbon"
              color={Brand.primary}
              title={l.name}
              caption={`${l.office}${l.party ? ` · ${l.party}` : ''}`}
              href={{ pathname: '/leader/[slug]', params: { slug: l.slug } }}
            />
          ))}
        </Section>
      ) : null}
      {results.communities.length ? (
        <Section title="Communities">
          {results.communities.map((c) => (
            <ResultRow
              key={c.slug}
              icon={c.kind === 'location' ? 'location' : 'chatbubbles'}
              color={c.kind === 'location' ? Brand.location : Brand.topic}
              title={`c/${c.slug}`}
              caption={c.name}
              href={{ pathname: '/c/[slug]', params: { slug: c.slug } }}
            />
          ))}
        </Section>
      ) : null}
      {results.bills.length ? (
        <Section title="Bills">
          {results.bills.map((b) => (
            <BillCard key={b.id} bill={b} />
          ))}
        </Section>
      ) : null}
      {results.posts.length ? (
        <Section title="Posts">
          {results.posts.map((p) => (
            <ResultRow
              key={p.id}
              icon="document-text"
              color="#5B6170"
              title={p.title}
              caption={`c/${p.communitySlug}`}
              href={{ pathname: '/post/[id]', params: { id: p.id } }}
            />
          ))}
        </Section>
      ) : null}
    </View>
  );
}

function ResultRow({
  icon,
  color,
  title,
  caption,
  href,
}: {
  icon: 'location' | 'ribbon' | 'chatbubbles' | 'document-text';
  color: string;
  title: string;
  caption: string;
  href: Href;
}) {
  const router = useRouter();
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push(href)}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: theme.backgroundSelected },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={[styles.resultIcon, { backgroundColor: color }]}>
        <Ionicons name={icon} size={18} color="#fff" />
      </View>
      <View style={styles.rowText}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {title}
        </ThemedText>
        <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
          {caption}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const SECTIONS: { kind: Community['kind']; title: string; blurb: string }[] = [
  { kind: 'location', title: 'Places', blurb: 'The country and the MVP states' },
  { kind: 'topic', title: 'Top topics', blurb: 'The 32 policy areas Congress uses, by members' },
];

/** Reddit-style community directory: ranked rows with icon, c/name, members and Join. */
function Directory() {
  const router = useRouter();
  const theme = useTheme();
  const { token } = useAuth();
  const [communities, setCommunities] = useState<Community[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    social
      .communities(token)
      .then((r) => setCommunities(r.communities.filter((c) => c.kind !== 'humanity')))
      .catch((err) => setError(describeError(err)));
  }, [token]);

  return (
    <View>
      <ErrorText message={error} />
      {SECTIONS.map((section) => {
        const list = communities
          .filter((c) => c.kind === section.kind)
          .sort((a, b) =>
            section.kind === 'topic'
              ? b.followers - a.followers || a.name.localeCompare(b.name)
              : 0,
          );
        return (
          <Section key={section.kind} title={section.title} caption={section.blurb}>
            {list.map((c, i) => (
              <View
                key={c.slug}
                style={[styles.row, { borderBottomColor: theme.backgroundSelected }]}
              >
                <ThemedText type="smallBold" themeColor="textSecondary" style={styles.rank}>
                  {i + 1}
                </ThemedText>
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={c.name}
                  onPress={() => router.push({ pathname: '/c/[slug]', params: { slug: c.slug } })}
                  style={({ pressed }) => [styles.rowLink, pressed && { opacity: 0.7 }]}
                >
                  <CommunityIcon kind={c.kind} size={36} />
                  <View style={styles.rowText}>
                    <ThemedText type="smallBold" numberOfLines={1}>
                      c/{c.slug}
                    </ThemedText>
                    <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
                      {c.name} · {c.followers} {c.followers === 1 ? 'member' : 'members'}
                    </ThemedText>
                  </View>
                </Pressable>
                <FollowButton kind="community" name={c.slug} following={c.following} />
              </View>
            ))}
          </Section>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: Spacing.three },
  searchWrap: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    height: 46,
  },
  input: { flex: 1, fontSize: 16, height: 46 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 4,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rank: { width: 20, textAlign: 'right' },
  rowLink: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4 },
  rowText: { flex: 1, gap: 2 },
  resultIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
