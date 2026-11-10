import { useRouter } from 'expo-router';
import { useState } from 'react';

import { Button, ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { api, ApiError, describeError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  authenticateWithPasskey,
  passkeysSupported,
  passkeyUnsupportedReason,
} from '@/lib/passkey';

export default function SignInScreen() {
  const router = useRouter();
  const { adopt } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const { challengeId, options } = await api.passkeySignInOptions();
      const assertion = await authenticateWithPasskey(options);
      const { token } = await api.passkeySignIn(challengeId, assertion);
      await adopt(token);
      router.replace('/account');
    } catch (err) {
      setError(err instanceof ApiError ? describeError(err) : 'Sign-in was cancelled or failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Sign in" subtitle="Use the passkey saved on this device. No password needed.">
      {passkeysSupported() ? (
        <Button title="Sign in with passkey" onPress={signIn} busy={busy} />
      ) : (
        <ThemedText themeColor="textSecondary">{passkeyUnsupportedReason}</ThemedText>
      )}
      <ErrorText message={error} />
      <Button
        title="New here? Join Demanity"
        variant="secondary"
        onPress={() => router.replace('/join')}
      />
    </Screen>
  );
}
