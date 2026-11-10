import { useRouter } from 'expo-router';

import { Button } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { isFullyOnboarded, useAuth } from '@/lib/auth';

export default function AccountScreen() {
  const router = useRouter();
  const { ready, token, me, signOut } = useAuth();
  if (!ready) return null;

  if (!isFullyOnboarded(me)) {
    return (
      <Screen
        title="Your account"
        subtitle="Browse freely as a guest. To post, comment, react or vote, join with one verified account per person."
      >
        {token ? (
          <Button title="Continue signing up" onPress={() => router.push('/onboarding')} />
        ) : (
          <>
            <Button title="Join Demanity" onPress={() => router.push('/join')} />
            <Button title="Sign in" variant="secondary" onPress={() => router.push('/sign-in')} />
          </>
        )}
      </Screen>
    );
  }

  return (
    <Screen title={me!.username} subtitle="Verified Demanity member">
      <ThemedText>
        Your identity is verified, your email is confirmed, and you sign in with a passkey.
      </ThemedText>
      <Button
        title="View your public profile"
        variant="secondary"
        onPress={() =>
          router.push({ pathname: '/u/[username]', params: { username: me!.username } })
        }
      />
      <Button
        title="Sign out"
        variant="secondary"
        onPress={async () => {
          await signOut();
          router.replace('/');
        }}
      />
    </Screen>
  );
}
