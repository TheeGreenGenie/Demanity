import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

/**
 * A minimal software WebAuthn authenticator for tests. It produces genuine
 * ES256 ("none" attestation) registration and authentication responses, so the
 * server is exercised through SimpleWebAuthn's real verification code.
 * Format per W3C WebAuthn Level 3 (authenticator data, attestation object).
 */

// --- Minimal CBOR encoder (RFC 8949): ints, byte/text strings, maps ----------
function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) {
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
}

type Cbor = number | string | Buffer | Map<Cbor, Cbor>;

function cbor(v: Cbor): Buffer {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') {
    const s = Buffer.from(v, 'utf8');
    return Buffer.concat([head(3, s.length), s]);
  }
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  const parts: Buffer[] = [head(5, v.size)];
  for (const [k, val] of v) parts.push(cbor(k), cbor(val));
  return Buffer.concat(parts);
}

const b64url = (b: Buffer) => b.toString('base64url');
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest();

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export class SoftAuthenticator {
  readonly credentialId = randomBytes(16);
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private counter = 0;
  private userHandle: Buffer | null = null;

  constructor(
    private readonly rpId: string,
    private readonly origin: string,
    private readonly opts: { userVerified?: boolean } = {},
  ) {
    const kp = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = kp.privateKey;
    this.publicKey = kp.publicKey;
  }

  private flags(extra = 0) {
    return FLAG_UP | (this.opts.userVerified === false ? 0 : FLAG_UV) | extra;
  }

  private coseKey(): Buffer {
    const jwk = this.publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    return cbor(
      new Map<Cbor, Cbor>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(jwk.x, 'base64url')],
        [-3, Buffer.from(jwk.y, 'base64url')],
      ]),
    );
  }

  private clientData(type: string, challenge: string): Buffer {
    return Buffer.from(
      JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }),
    );
  }

  /** Answers `navigator.credentials.create()` options. */
  register(options: { challenge: string; user: { id: string } }) {
    this.userHandle = Buffer.from(options.user.id, 'base64url');
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(this.credentialId.length);
    const signCount = Buffer.alloc(4);
    const authData = Buffer.concat([
      sha256(this.rpId),
      Buffer.from([this.flags(FLAG_AT)]),
      signCount,
      Buffer.alloc(16), // AAGUID (none attestation)
      idLen,
      this.credentialId,
      this.coseKey(),
    ]);
    const attestationObject = cbor(
      new Map<Cbor, Cbor>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    );
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64url(this.clientData('webauthn.create', options.challenge)),
        attestationObject: b64url(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform' as const,
    };
  }

  /** Answers `navigator.credentials.get()` options. */
  authenticate(options: { challenge: string }) {
    this.counter += 1;
    const signCount = Buffer.alloc(4);
    signCount.writeUInt32BE(this.counter);
    const authData = Buffer.concat([sha256(this.rpId), Buffer.from([this.flags()]), signCount]);
    const clientDataJSON = this.clientData('webauthn.get', options.challenge);
    const signature = sign(
      'sha256',
      Buffer.concat([authData, sha256(clientDataJSON)]),
      this.privateKey,
    );
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        ...(this.userHandle ? { userHandle: b64url(this.userHandle) } : {}),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform' as const,
    };
  }
}
