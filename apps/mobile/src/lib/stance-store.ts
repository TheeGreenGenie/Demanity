import * as SecureStore from 'expo-secure-store';

/**
 * Your own bill stances, kept ONLY on this device. The server deliberately
 * doesn't know which way you swiped (docs/LEGISLATION.md §3a), so the app
 * remembers it locally to show "You supported" on bill pages. Never sent anywhere.
 */
export type Stance = 'support' | 'oppose';
const key = (billId: string) => `stance_${billId.replace(/[^a-zA-Z0-9_.-]/g, '')}`;

export const stanceStore = {
  get: async (billId: string): Promise<Stance | null> => {
    try {
      const v = await SecureStore.getItemAsync(key(billId));
      return v === 'support' || v === 'oppose' ? v : null;
    } catch {
      return null;
    }
  },
  set: async (billId: string, stance: Stance): Promise<void> => {
    try {
      await SecureStore.setItemAsync(key(billId), stance);
    } catch {
      // Best effort: losing the local copy only hides "You supported".
    }
  },
};
