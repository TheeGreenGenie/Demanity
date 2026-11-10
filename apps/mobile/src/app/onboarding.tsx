import { useRouter } from 'expo-router';
import { useState } from 'react';

import { Button, ErrorText, Field } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { api, ApiError, describeError, type IdentityForm } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  authenticateWithPasskey,
  createPasskey,
  passkeysSupported,
  passkeyUnsupportedReason,
} from '@/lib/passkey';

/**
 * Sign-up flow, driven entirely by the account status the API reports:
 *   pending  → identity verification
 *   verified → email 2FA (free, vault-generated code)
 *   active   → register a passkey (web for now), then sign in with it
 */
export default function OnboardingScreen() {
  const { me } = useAuth();
  if (!me) return null;
  if (me.status === 'pending') return <IdentityStep />;
  if (me.status === 'verified') return <EmailStep />;
  if (me.scope === 'full') return <DoneStep />;
  return <PasskeyStep />;
}

function useStep() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(
        err instanceof ApiError ? describeError(err) : (err as Error).message || describeError(err),
      );
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function IdentityStep() {
  const { token, refresh } = useAuth();
  const { busy, error, run } = useStep();
  const [review, setReview] = useState(false);
  const [form, setForm] = useState<IdentityForm>({
    firstName: '',
    lastName: '',
    birthDate: '',
    state: '',
    licenseNumber: '',
  });
  const set = (k: keyof IdentityForm) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const complete =
    form.firstName.trim() !== '' &&
    form.lastName.trim() !== '' &&
    /^\d{4}-\d{2}-\d{2}$/.test(form.birthDate) &&
    /^[A-Za-z]{2}$/.test(form.state) &&
    form.licenseNumber.trim().length >= 4;

  const submit = () =>
    run(async () => {
      const res = await api.verifyIdentity(token!, {
        ...form,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        state: form.state.toUpperCase(),
        licenseNumber: form.licenseNumber.trim(),
      });
      if (res.review) {
        setReview(true);
        return;
      }
      await refresh();
    });

  if (review) {
    return (
      <Screen
        title="Under review"
        subtitle="Our moderation team needs to look at your verification. You’ll be able to continue once they approve it. Come back and submit your details again then."
      />
    );
  }

  return (
    <Screen
      title="Verify your identity"
      subtitle="Demanity is for US residents 18 and over with a US driver’s license. Your details go to our verification partner to confirm them, and are never stored by Demanity."
    >
      <Field
        label="First name"
        value={form.firstName}
        onChangeText={set('firstName')}
        autoComplete="name-given"
      />
      <Field
        label="Last name"
        value={form.lastName}
        onChangeText={set('lastName')}
        autoComplete="name-family"
      />
      <Field
        label="Date of birth"
        hint="YYYY-MM-DD"
        value={form.birthDate}
        onChangeText={set('birthDate')}
        autoComplete="birthdate-full"
        keyboardType="numbers-and-punctuation"
        maxLength={10}
      />
      <Field
        label="License state"
        hint="Two-letter code, e.g. CA"
        value={form.state}
        onChangeText={(v) => set('state')(v.toUpperCase())}
        autoCapitalize="characters"
        maxLength={2}
      />
      <Field
        label="Driver’s license number"
        value={form.licenseNumber}
        onChangeText={set('licenseNumber')}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        maxLength={30}
      />
      <ErrorText message={error} />
      <Button title="Verify" onPress={submit} busy={busy} disabled={!complete} />
    </Screen>
  );
}

function EmailStep() {
  const { token, refresh } = useAuth();
  const { busy, error, run } = useStep();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');

  const send = () =>
    run(async () => {
      await api.setEmail(token!, email.trim());
      setSent(true);
    });

  const confirm = () =>
    run(async () => {
      await api.confirmEmail(token!, code.trim());
      await refresh();
    });

  return (
    <Screen
      title="Confirm your email"
      subtitle="Used only to send you security codes, for example if you lose your phone. It is stored encrypted and never shown to anyone."
    >
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        editable={!sent}
      />
      {!sent ? (
        <Button title="Send code" onPress={send} busy={busy} disabled={!email.includes('@')} />
      ) : (
        <>
          <Field
            label="6-digit code"
            hint="Check your email. The code expires in 10 minutes."
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            maxLength={6}
          />
          <Button title="Confirm" onPress={confirm} busy={busy} disabled={code.length !== 6} />
          <Button
            title="Use a different email"
            variant="secondary"
            onPress={() => setSent(false)}
          />
        </>
      )}
      <ErrorText message={error} />
    </Screen>
  );
}

function PasskeyStep() {
  const router = useRouter();
  const { token, adopt } = useAuth();
  const { busy, error, run } = useStep();
  const supported = passkeysSupported();

  const register = () =>
    run(async () => {
      const options = await api.passkeyRegistrationOptions(token!);
      const response = await createPasskey(options);
      await api.registerPasskey(token!, response);
      // Registering a passkey does not upgrade the sign-up session; sign in with it now.
      const { challengeId, options: signInOptions } = await api.passkeySignInOptions();
      const assertion = await authenticateWithPasskey(signInOptions);
      const session = await api.passkeySignIn(challengeId, assertion);
      await adopt(session.token);
      router.replace('/account');
    });

  return (
    <Screen
      title="Create your passkey"
      subtitle="A passkey replaces passwords. It stays on your device, unlocked with your fingerprint, face or device PIN, and it’s what lets you vote."
    >
      {supported ? (
        <Button title="Create passkey" onPress={register} busy={busy} />
      ) : (
        <ThemedText themeColor="textSecondary">{passkeyUnsupportedReason}</ThemedText>
      )}
      <ErrorText message={error} />
    </Screen>
  );
}

function DoneStep() {
  const router = useRouter();
  return (
    <Screen title="You’re in" subtitle="Your account is verified and protected by a passkey.">
      <Button title="Go to your account" onPress={() => router.replace('/account')} />
    </Screen>
  );
}
