import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DecryptCommand, EncryptCommand } from '@aws-sdk/client-kms';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from '../src/crypto/envelope.js';
import { AwsKmsKeyProvider, KMS_ENCRYPTION_CONTEXT } from '../src/crypto/kms.js';

/**
 * A stand-in for KMS that behaves like the documented API: it encrypts with a
 * key only it holds and refuses to decrypt unless the KeyId and the
 * EncryptionContext match exactly (as KMS does with InvalidCiphertextException).
 */
class FakeKms {
  private readonly key = randomBytes(32);
  readonly calls: Array<{ name: string; input: Record<string, unknown> }> = [];

  constructor(private readonly keyId: string) {}

  async send(command: EncryptCommand | DecryptCommand) {
    const input = command.input as Record<string, unknown>;
    this.calls.push({ name: command.constructor.name, input });
    if (input.KeyId !== this.keyId)
      throw Object.assign(new Error('IncorrectKeyException'), { name: 'IncorrectKeyException' });
    const aad = Buffer.from(JSON.stringify(input.EncryptionContext ?? {}));
    if (command instanceof EncryptCommand) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', this.key, iv).setAAD(aad);
      const ct = Buffer.concat([c.update(input.Plaintext as Uint8Array), c.final()]);
      return {
        CiphertextBlob: new Uint8Array(Buffer.concat([iv, c.getAuthTag(), ct])),
        KeyId: this.keyId,
      };
    }
    const blob = Buffer.from(input.CiphertextBlob as Uint8Array);
    try {
      const d = createDecipheriv('aes-256-gcm', this.key, blob.subarray(0, 12)).setAAD(aad);
      d.setAuthTag(blob.subarray(12, 28));
      return { Plaintext: new Uint8Array(Buffer.concat([d.update(blob.subarray(28)), d.final()])) };
    } catch {
      throw Object.assign(new Error('InvalidCiphertextException'), {
        name: 'InvalidCiphertextException',
      });
    }
  }
}

const KEY = 'arn:aws:kms:us-east-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab';

describe('AwsKmsKeyProvider', () => {
  it('wraps and unwraps data keys through KMS with the key ID and encryption context', async () => {
    const kms = new FakeKms(KEY);
    const provider = new AwsKmsKeyProvider(kms, KEY);
    const dek = randomBytes(32);
    const wrapped = await provider.wrap(dek);
    expect(wrapped.equals(dek)).toBe(false);
    expect((await provider.unwrap(wrapped)).equals(dek)).toBe(true);

    expect(kms.calls.map((c) => c.name)).toEqual(['EncryptCommand', 'DecryptCommand']);
    for (const call of kms.calls) {
      expect(call.input.KeyId).toBe(KEY);
      expect(call.input.EncryptionContext).toEqual(KMS_ENCRYPTION_CONTEXT);
    }
  });

  it('works end to end with envelope encryption of a contact value', async () => {
    const provider = new AwsKmsKeyProvider(new FakeKms(KEY), KEY);
    const env = await encrypt(provider, 'voter@example.com', 'contact:row-1:email');
    expect(env.kekId).toBe(`aws-kms:${KEY}`);
    expect(await decrypt(provider, env, 'contact:row-1:email')).toBe('voter@example.com');
  });

  it('cannot decrypt with a different KMS key', async () => {
    const kms = new FakeKms(KEY);
    const env = await encrypt(new AwsKmsKeyProvider(kms, KEY), 'secret', 'aad');
    const otherKey = 'arn:aws:kms:us-east-1:111122223333:key/ffffffff-0000-0000-0000-000000000000';
    // Different kekId: rejected before KMS is even called.
    await expect(decrypt(new AwsKmsKeyProvider(kms, otherKey), env, 'aad')).rejects.toThrow(
      /another KEK/,
    );
  });

  it('requires a key ID', () => {
    expect(() => new AwsKmsKeyProvider(new FakeKms(KEY), '')).toThrow(/required/);
  });
});
