/**
 * Web version: your own bill stances in this browser's localStorage only.
 * The server deliberately doesn't know which way you swiped
 * (docs/LEGISLATION.md §3a). Never sent anywhere.
 */
export type Stance = 'support' | 'oppose';
const KEY = 'demanity.stances';

function read(): Record<string, Stance> {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Record<string, Stance>;
  } catch {
    return {};
  }
}

export const stanceStore = {
  get: async (billId: string): Promise<Stance | null> => read()[billId] ?? null,
  set: async (billId: string, stance: Stance): Promise<void> => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ ...read(), [billId]: stance }));
    } catch {
      // Storage blocked: only the "You supported" reminder is lost.
    }
  },
};
