import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Button, ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { PostCard } from '@/components/social';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { usePagedPosts } from '@/hooks/use-paged-posts';
import { social } from '@/lib/api';
import { isFullyOnboarded, useAuth } from '@/lib/auth';

export default function HomeScreen() {
  const { ready, me } = useAuth();
  if (!ready) return null;
  return isFullyOnboarded(me) ? <MemberHome /> : <GuestHome />;
}

/** Members: their feed. Chronological, built only from what they follow; each item says why it's there. */
function MemberHome() {
  const router = useRouter();
  const { token } = useAuth();
  const feed = usePagedPosts((cursor) => social.feed(token!, cursor), `feed:${token}`);

  return (
    <Screen
      title="Your feed"
      subtitle="Newest first, from the communities and people you follow. No hidden ranking."
    >
      <Button title="Write a post" onPress={() => router.push('/compose')} />
      <ErrorText message={feed.error} />
      {feed.posts.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
      {!feed.loading && feed.posts.length === 0 ? (
        <ThemedText themeColor="textSecondary">
          Nothing here yet. Follow some communities to fill your feed.
        </ThemedText>
      ) : null}
      {feed.hasMore ? (
        <Button title="Load more" variant="secondary" onPress={feed.loadMore} busy={feed.loading} />
      ) : null}
    </Screen>
  );
}

const PILLARS = [
  { title: 'Legislation', body: 'Every new federal and state bill, order, regulation and ruling.' },
  { title: 'Leaders', body: 'Trust pages that hold leaders to their own stated positions.' },
  { title: 'Polls', body: 'One verified person, one unlinkable vote.' },
  { title: 'Forums', body: 'Discuss issues by topic, location and bill.' },
  { title: 'Humanity', body: 'The good people do for each other, and the ways we are alike.' },
] as const;

/** Guests: what Demanity is, how to join, and a taste of Humanity. */
function GuestHome() {
  const router = useRouter();
  const { token } = useAuth();
  const humanity = usePagedPosts(
    (cursor) => social.communityPosts(null, 'humanity', cursor),
    'guest-humanity',
  );

  return (
    <Screen>
      <ThemedText type="title">Demanity</ThemedText>
      <ThemedText themeColor="textSecondary">Democracy + Humanity</ThemedText>
      {token ? (
        <Button title="Continue signing up" onPress={() => router.push('/onboarding')} />
      ) : (
        <ThemedView style={styles.actions}>
          <Button title="Join Demanity" onPress={() => router.push('/join')} />
          <Button title="Sign in" variant="secondary" onPress={() => router.push('/sign-in')} />
        </ThemedView>
      )}
      {PILLARS.map((pillar) => (
        <ThemedView key={pillar.title} type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">{pillar.title}</ThemedText>
          <ThemedText>{pillar.body}</ThemedText>
        </ThemedView>
      ))}
      {humanity.posts.length > 0 ? (
        <ThemedText type="smallBold">Recently in Humanity</ThemedText>
      ) : null}
      {humanity.posts.slice(0, 3).map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
      <ThemedText type="small" themeColor="textSecondary">
        Pre-release build. Browsing as a guest: nothing about you is tracked.
      </ThemedText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: Spacing.two },
  card: { gap: Spacing.two, padding: Spacing.three, borderRadius: Radius.medium },
});
