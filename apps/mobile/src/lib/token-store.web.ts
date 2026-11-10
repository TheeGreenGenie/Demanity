// Web: the session token lives in an HttpOnly cookie that page scripts can't
// read (apps/api/src/auth/web-session.ts). The app only remembers that it is
// signed in, as a non-secret marker, so a reload knows to check the session.
// The marker is in localStorage so every tab shares the cookie's session.
const KEY = 'demanity.session';

const storage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null; // storage blocked (private mode): the app starts as a guest
  }
};

export const tokenStore = {
  get: async () => storage()?.getItem(KEY) ?? null,
  // The API sends the marker "cookie" to web clients, never a real token.
  set: async (token: string) => storage()?.setItem(KEY, token),
  clear: async () => storage()?.removeItem(KEY),
};
