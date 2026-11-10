import { useRouter } from 'expo-router';
import { useState } from 'react';

import { Button, ErrorText, Field } from '@/components/form';
import { Screen } from '@/components/screen';
import { SignUpSteps } from '@/components/steps';
import { ThemedText } from '@/components/themed-text';
import { api, ApiError, describeError, type IdentityForm } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { createPasskey, passkeysSupported, passkeyUnsupportedReason } from '@/lib/passkey';
import { parseBirthDate, validateEmail, validateIdentity } from '@/lib/validation';

/**
 * Sign-up flow, driven entirely by the account status the API reports:
 *   pending  → identity verification
 *   verified → email 2FA (free, vault-generated code)
 *   active   → register a passkey (web for now), which also signs you in
 *
 * Buttons are never silently disabled: pressing one either proceeds or shows
 * exactly which field needs fixing.
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
  const [attempted, setAttempted] = useState(false);
  const [form, setForm] = useState<IdentityForm>({
    firstName: '',
    lastName: '',
    birthDate: '',
    state: '',
    licenseNumber: '',
  });
  const set = (k: keyof IdentityForm) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  // Errors appear after the first attempt, then update live as fields are fixed.
  const errors = validateIdentity(form);
  const shown = attempted ? errors : {};

  const submit = () => {
    setAttempted(true);
    if (Object.keys(errors).length > 0) return;
    void run(async () => {
      const res = await api.verifyIdentity(token!, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        birthDate: parseBirthDate(form.birthDate)!,
        state: form.state.trim().toUpperCase(),
        licenseNumber: form.licenseNumber.trim(),
      });
      if (res.review) {
        setReview(true);
        return;
      }
      await refresh();
    });
  };

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
      subtitle="Demanity is for people 18 and over with a US driver’s license. Your details go to our verification partner to confirm them, and are never stored by Demanity."
    >
      <SignUpSteps current={1} />
      <Field
        label="First name"
        value={form.firstName}
        onChangeText={set('firstName')}
        autoComplete="name-given"
        error={shown.firstName}
      />
      <Field
        label="Last name"
        value={form.lastName}
        onChangeText={set('lastName')}
        autoComplete="name-family"
        error={shown.lastName}
      />
      <Field
        label="Date of birth"
        hint="MM/DD/YYYY"
        placeholder="MM/DD/YYYY"
        value={form.birthDate}
        onChangeText={set('birthDate')}
        autoComplete="birthdate-full"
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        error={shown.birthDate}
      />
      <Field
        label="License state"
        hint="Two-letter code, e.g. CA"
        value={form.state}
        onChangeText={(v) => set('state')(v.toUpperCase())}
        autoCapitalize="characters"
        maxLength={2}
        error={shown.state}
      />
      <Field
        label="Driver’s license number"
        value={form.licenseNumber}
        onChangeText={set('licenseNumber')}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        maxLength={30}
        error={shown.licenseNumber}
      />
      {attempted && Object.keys(errors).length > 0 ? (
        <ErrorText message="Please fix the highlighted fields." />
      ) : null}
      <ErrorText message={error} />
      <Button title="Verify" onPress={submit} busy={busy} />
    </Screen>
  );
}

function EmailStep() {
  const { token, refresh } = useAuth();
  const { busy, error, run } = useStep();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [codeError, setCodeError] = useState<string | undefined>();

  const send = () => {
    const problem = validateEmail(email) ?? undefined;
    setEmailError(problem);
    if (problem) return;
    void run(async () => {
      await api.setEmail(token!, email.trim());
      setSent(true);
    });
  };

  const confirm = () => {
    const problem = /^\d{6}$/.test(code) ? undefined : 'Enter all 6 digits from the email.';
    setCodeError(problem);
    if (problem) return;
    void run(async () => {
      await api.confirmEmail(token!, code);
      await refresh();
    });
  };

  return (
    <Screen
      title="Confirm your email"
      subtitle="Used only to send you security codes, for example if you lose your phone. It is stored encrypted and never shown to anyone."
    >
      <SignUpSteps current={2} />
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        editable={!sent}
        error={emailError}
      />
      {!sent ? (
        <Button title="Send code" onPress={send} busy={busy} />
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
            error={codeError}
          />
          <Button title="Confirm" onPress={confirm} busy={busy} />
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

  // One device prompt: creating the passkey requires your fingerprint, face or
  // PIN, so the server signs you in with it directly (no second prompt).
  const register = () =>
    run(async () => {
      const options = await api.passkeyRegistrationOptions(token!);
      const response = await createPasskey(options);
      const { token: fullSession } = await api.registerPasskey(token!, response);
      await adopt(fullSession);
      router.replace('/account');
    });

  return (
    <Screen
      title="Create your passkey"
      subtitle="A passkey replaces passwords. It stays on your device, unlocked with your fingerprint, face or device PIN, and it’s what lets you vote."
    >
      <SignUpSteps current={3} />
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
