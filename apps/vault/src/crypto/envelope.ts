import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Envelope encryption (docs/PRIVACY.md): each record gets its own random data
 * key (DEK); the DEK is wrapped by a key-encryption key (KEK) held by a
 * KeyProvider. In production the provider is a cloud KMS; locally it is a
 * 32-byte key from the environment.
 *
 * AES-256-GCM everywhere. `aad` binds a ciphertext to its purpose/record so it
 * cannot be swapped into another row undetected.
 */

export interface KeyProvider {
  readonly kekId: string;
  wrap(dek: Buffer): Promise<Buffer>;
  unwrap(wrapped: Buffer): Promise<Buffer>;
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

function seal(key: Buffer, plaintext: Buffer, aad: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

function open(key: Buffer, sealed: Buffer, aad: Buffer): Buffer {
  const iv = sealed.subarray(0, IV_BYTES);
  const tag = sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = sealed.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** Local/dev KEK provider. Production must use a KMS-backed provider. */
export class LocalKeyProvider implements KeyProvider {
  constructor(
    private readonly kek: Buffer,
    readonly kekId = 'local-v1',
  ) {
    if (kek.length !== 32) throw new Error('KEK must be 32 bytes');
  }
  async wrap(dek: Buffer): Promise<Buffer> {
    return seal(this.kek, dek, Buffer.from(`kek:${this.kekId}`));
  }
  async unwrap(wrapped: Buffer): Promise<Buffer> {
    return open(this.kek, wrapped, Buffer.from(`kek:${this.kekId}`));
  }
}

export interface Envelope {
  v: 1;
  kekId: string;
  wrappedDek: string; // base64
  data: string; // base64 (iv | tag | ciphertext)
}

export async function encrypt(
  provider: KeyProvider,
  plaintext: string,
  aad: string,
): Promise<Envelope> {
  const dek = randomBytes(32);
  try {
    const data = seal(dek, Buffer.from(plaintext, 'utf8'), Buffer.from(aad, 'utf8'));
    const wrappedDek = await provider.wrap(dek);
    return {
      v: 1,
      kekId: provider.kekId,
      wrappedDek: wrappedDek.toString('base64'),
      data: data.toString('base64'),
    };
  } finally {
    dek.fill(0);
  }
}

export async function decrypt(
  provider: KeyProvider,
  envelope: Envelope,
  aad: string,
): Promise<string> {
  if (envelope.v !== 1) throw new Error('Unsupported envelope version');
  if (envelope.kekId !== provider.kekId) throw new Error('Envelope was sealed under another KEK');
  const dek = await provider.unwrap(Buffer.from(envelope.wrappedDek, 'base64'));
  try {
    return open(dek, Buffer.from(envelope.data, 'base64'), Buffer.from(aad, 'utf8')).toString(
      'utf8',
    );
  } finally {
    dek.fill(0);
  }
}
