/**
 * Versioned secret keyring. Keys are 32 random bytes, supplied base64-encoded
 * via environment variables, e.g.
 *   VAULT_TOKEN_KEYS="1:BASE64KEY,2:BASE64KEY"   (highest version = current)
 *
 * Old versions stay loaded so existing tokens keep matching after rotation.
 */
export interface Keyring {
  current: { version: number; key: Buffer };
  all: ReadonlyMap<number, Buffer>;
}

export function parseKeyring(spec: string | undefined, name: string): Keyring {
  if (!spec) throw new Error(`${name} is required`);
  const all = new Map<number, Buffer>();
  for (const part of spec.split(',')) {
    const [v, b64] = part.trim().split(':');
    const version = Number(v);
    if (!Number.isInteger(version) || version < 1 || !b64) {
      throw new Error(`${name}: malformed entry (expected "<version>:<base64>")`);
    }
    const key = Buffer.from(b64, 'base64');
    if (key.length !== 32) {
      throw new Error(`${name}: key version ${version} must be 32 bytes`);
    }
    if (all.has(version)) throw new Error(`${name}: duplicate version ${version}`);
    all.set(version, key);
  }
  const version = Math.max(...all.keys());
  return { current: { version, key: all.get(version)! }, all };
}

export function parseKey(b64: string | undefined, name: string): Buffer {
  if (!b64) throw new Error(`${name} is required`);
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error(`${name} must be 32 bytes`);
  return key;
}
