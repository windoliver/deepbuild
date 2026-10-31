// The devices you paired (#34): an answer that saves a decision or changes what a check demands counts when one of
// them signs it, or, from the CLI, once the OS confirms you (confirm.ts); never on the control token or the peer
// check alone. A device is paired once the OS confirms you, so the token can't pair a key of its own.
import { createPublicKey, verify } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { canonicalize, type JsonValue } from '@deepbuild/contracts';
import { Refused, refusal } from './wire.js';

type Obj = Record<string, unknown>;
/**
 * A paired device: its ID, its name and its Ed25519 public key, the raw 32 bytes in base64url. The one `enclave` device
 * is deep-confirm's Secure Enclave key (#880): P-256, its X9.63 point in base64url, with the code requirement its
 * helper was recorded under at setup; it signs confirmations, never an answer's params.
 */
interface Device { device: string; name: string; public_key: string; paired: number; kind?: 'enclave'; requirement?: string }

/** Refuses a public key that isn't an Ed25519 key's raw 32 bytes in base64url. */
export function checkKey(key: unknown): string {
  const bytes = typeof key === 'string' ? Buffer.from(key, 'base64url') : Buffer.alloc(0);
  if (bytes.length !== 32 || bytes.toString('base64url') !== key) throw new Refused(refusal('format', '/params/public_key', 'Give the Ed25519 public key as its raw 32 bytes in base64url.', key));
  return key as string;
}

export class Devices {
  constructor(private readonly file: string) {}

  private all(): Device[] {
    return existsSync(this.file) ? (JSON.parse(readFileSync(this.file, 'utf8')) as Device[]) : [];
  }

  /** Pairs a key, once the OS confirmed you; written only you can read, as the control token is. */
  pair(device: string, name: string, key: string, at: number): void {
    this.write([...this.all(), { device, name, public_key: key, paired: at }]);
  }

  private write(devices: Device[]): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(devices), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  /** deep-confirm's key, as setup recorded it, or undefined before it did. */
  enclave(): Device | undefined {
    return this.all().find((d) => d.kind === 'enclave');
  }

  /** Records deep-confirm's key and helper; the key it replaces stops counting at once. */
  enroll(device: Device): void {
    this.write([...this.all().filter((d) => d.kind !== 'enclave'), device]);
  }

  /**
   * Whether `params` carry a paired device's valid signature: Ed25519 over the RFC 8785 bytes of the params with
   * `device` in them and `signature` left out. A key never paired, or a signature over other params, is none.
   */
  signed(params: Obj): boolean {
    const { signature, ...body } = params;
    if (typeof signature !== 'string' || typeof body.device !== 'string') return false;
    const device = this.all().find((d) => d.device === body.device && d.kind === undefined);
    if (!device) return false;
    try {
      const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: device.public_key }, format: 'jwk' });
      return verify(null, canonicalize(body as JsonValue), key, Buffer.from(signature, 'base64url'));
    } catch {
      return false;
    }
  }
}
