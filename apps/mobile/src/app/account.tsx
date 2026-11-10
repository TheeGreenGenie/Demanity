import { useRouter } from 'expo-router';

import { Button } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/lib/auth';

export default function AccountScreen() {
  const router = useRouter();
  const { me, signOut } = useAuth();
  if (!me) return null;

  return (
    <Screen title={me.username} subtitle="Verified Demanity member">
      <ThemedText>
        Your identity is verified, your email is confirmed, and you sign in with a passkey. Forums,
        polls and leader pages are coming next.
      </ThemedText>
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
