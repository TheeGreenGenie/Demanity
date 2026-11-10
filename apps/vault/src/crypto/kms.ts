import { DecryptCommand, EncryptCommand, type KMSClient } from '@aws-sdk/client-kms';
import type { KeyProvider } from './envelope.js';

/**
 * Production key-encryption-key (KEK) provider backed by AWS KMS.
 *
 * Each record's random data key (DEK) is wrapped with KMS Encrypt and
 * unwrapped with KMS Decrypt (https://docs.aws.amazon.com/kms/latest/APIReference/).
 * The KEK itself never leaves KMS.
 *
 * - A fixed encryption context binds every wrapped DEK to Demanity's vault;
 *   KMS refuses to decrypt if it does not match exactly (InvalidCiphertextException).
 *   It is non-secret by design (it can appear in CloudTrail).
 * - KeyId is passed on Decrypt too, as AWS recommends, so a different key can
 *   never be used by accident.
 */
export const KMS_ENCRYPTION_CONTEXT = { app: 'demanity', purpose: 'vault-dek' } as const;

type KmsSend = Pick<KMSClient, 'send'>;

export class AwsKmsKeyProvider implements KeyProvider {
  readonly kekId: string;

  constructor(
    private readonly client: KmsSend,
    private readonly keyId: string,
  ) {
    if (!keyId) throw new Error('AWS KMS key ID or ARN is required');
    this.kekId = `aws-kms:${keyId}`;
  }

  async wrap(dek: Buffer): Promise<Buffer> {
    const out = await this.client.send(
      new EncryptCommand({
        KeyId: this.keyId,
        Plaintext: dek,
        EncryptionContext: { ...KMS_ENCRYPTION_CONTEXT },
      }),
    );
    if (!out.CiphertextBlob) throw new Error('KMS Encrypt returned no ciphertext');
    return Buffer.from(out.CiphertextBlob);
  }

  async unwrap(wrapped: Buffer): Promise<Buffer> {
    const out = await this.client.send(
      new DecryptCommand({
        KeyId: this.keyId,
        CiphertextBlob: wrapped,
        EncryptionContext: { ...KMS_ENCRYPTION_CONTEXT },
      }),
    );
    if (!out.Plaintext) throw new Error('KMS Decrypt returned no plaintext');
    return Buffer.from(out.Plaintext);
  }
}
