// iOS/Android: native passkeys need a passkey module plus an associated domain
// (Apple Universal Links / Android Digital Asset Links), which require the
// production domain. Until then the passkey step is web-only.

export const passkeysSupported = (): boolean => false;

export const passkeyUnsupportedReason =
  'Passkeys on the mobile app need Demanity’s production domain, which is not set up yet. ' +
  'For now, finish this step on the web version.';

export async function createPasskey(_options: Record<string, unknown>): Promise<unknown> {
  throw new Error(passkeyUnsupportedReason);
}

export async function authenticateWithPasskey(_options: Record<string, unknown>): Promise<unknown> {
  throw new Error(passkeyUnsupportedReason);
}
