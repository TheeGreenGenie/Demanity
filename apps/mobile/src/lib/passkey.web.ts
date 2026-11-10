import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

// Web: the browser's built-in WebAuthn (passkeys), via SimpleWebAuthn v14.

export const passkeysSupported = (): boolean => browserSupportsWebAuthn();

export const passkeyUnsupportedReason =
  'This browser does not support passkeys. Try a current version of Chrome, Safari, Edge or Firefox.';

export function createPasskey(options: Record<string, unknown>) {
  return startRegistration({
    optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON,
  });
}

export function authenticateWithPasskey(options: Record<string, unknown>) {
  return startAuthentication({
    optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON,
  });
}
