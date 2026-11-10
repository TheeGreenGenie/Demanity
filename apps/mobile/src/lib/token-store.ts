import * as SecureStore from 'expo-secure-store';

// iOS/Android: the session token lives in the OS keychain/keystore.
const KEY = 'demanity.session';

export const tokenStore = {
  get: () => SecureStore.getItemAsync(KEY),
  set: (token: string) => SecureStore.setItemAsync(KEY, token),
  clear: () => SecureStore.deleteItemAsync(KEY),
};
