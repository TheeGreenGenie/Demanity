import { useRouter } from 'expo-router';
import { useState } from 'react';

import { Button, ErrorText, Field } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { api, describeError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const USERNAME = /^[a-z0-9_]{3,30}$/;

export default function JoinScreen() {
  const router = useRouter();
  const { adopt } = useAuth();
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = USERNAME.test(username);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { token } = await api.signUp(username);
      await adopt(token);
      router.replace('/onboarding');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Join Demanity"
      subtitle="One verified person, one account. Your username is public; nothing else about you is."
    >
      <Field
        label="Username"
        hint="3–30 characters: lowercase letters, numbers and underscores."
        value={username}
        onChangeText={(t) => setUsername(t.toLowerCase().trim())}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username-new"
        maxLength={30}
        onSubmitEditing={() => valid && submit()}
      />
      <ErrorText message={error} />
      <Button title="Continue" onPress={submit} busy={busy} disabled={!valid} />
      <ThemedText type="small" themeColor="textSecondary">
        Next you will verify your identity. Demanity keeps only a one-way code that prevents
        duplicate accounts, never your name, birth date or license details.
      </ThemedText>
    </Screen>
  );
}
