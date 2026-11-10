// Web: SecureStore is not available on web (Expo SDK 58 docs). The token is
// kept in sessionStorage, so it is scoped to the tab and cleared when the tab
// closes. Known trade-off: any script running on the page could read it, so
// the web app must never load third-party scripts. Moving web sessions to
// HttpOnly cookies is tracked as a hardening task.
const KEY = 'demanity.session';

const storage = (): Storage | null =>
  typeof window === 'undefined' ? null : window.sessionStorage;

export const tokenStore = {
  get: async () => storage()?.getItem(KEY) ?? null,
  set: async (token: string) => storage()?.setItem(KEY, token),
  clear: async () => storage()?.removeItem(KEY),
};
