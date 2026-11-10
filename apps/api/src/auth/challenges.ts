import type { Redis } from 'ioredis';

/**
 * Short-lived, single-use WebAuthn challenges. `take` returns and deletes in
 * one step, so a challenge can never be replayed.
 */
export interface ChallengeStore {
  put(key: string, challenge: string, ttlSeconds: number): Promise<void>;
  take(key: string): Promise<string | null>;
}

export class RedisChallengeStore implements ChallengeStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'webauthn:challenge:',
  ) {}

  async put(key: string, challenge: string, ttlSeconds: number) {
    await this.redis.set(this.prefix + key, challenge, 'EX', ttlSeconds);
  }

  async take(key: string) {
    return this.redis.getdel(this.prefix + key);
  }
}

export class MemoryChallengeStore implements ChallengeStore {
  private readonly items = new Map<string, { value: string; expires: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async put(key: string, challenge: string, ttlSeconds: number) {
    this.items.set(key, { value: challenge, expires: this.now() + ttlSeconds * 1000 });
  }

  async take(key: string) {
    const item = this.items.get(key);
    this.items.delete(key);
    if (!item || item.expires < this.now()) return null;
    return item.value;
  }
}
