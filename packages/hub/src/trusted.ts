// The trusted path (#34): an answer with authority, or one that saves a decision or changes what a check demands,
// counts only when a device you paired signs it, or, from the CLI, once the OS confirms you; never on the control
// token or the peer check alone. A device is paired once the OS confirms you, so the token can't pair a key of its own.
import { execFile } from 'node:child_process';
import { createPublicKey, verify } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { canonicalize, type JsonValue } from '@deepbuild/contracts';
import { Refused, refusal } from './wire.js';

type Obj = Record<string, unknown>;
/** A paired device: its ID, its name and its Ed25519 public key, the raw 32 bytes in base64url. */
interface Device { device: string; name: string; public_key: string; paired: number }

/**
 * Asks the OS to confirm you, once, with a prompt naming what you confirm. Only the stand-in a test names in
 * DEEP_HUB_TEST_CONFIRM answers today; with none, nothing is confirmed, since the LocalAuthentication and polkit
 * prompt is #19's. Each confirmation answers one prompt and is never cached.
 */
export function confirmed(prompt: string, stand?: string): Promise<boolean> {
  if (!stand) return Promise.resolve(false);
  return new Promise((done) => execFile(stand, [prompt], { timeout: 120_000 }, (error) => done(!error)));
}

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
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify([...this.all(), { device, name, public_key: key, paired: at }]), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  /**
   * Whether `params` carry a paired device's valid signature: Ed25519 over the RFC 8785 bytes of the params with
   * `device` in them and `signature` left out. A key never paired, or a signature over other params, is none.
   */
  signed(params: Obj): boolean {
    const { signature, ...body } = params;
    if (typeof signature !== 'string' || typeof body.device !== 'string') return false;
    const device = this.all().find((d) => d.device === body.device);
    if (!device) return false;
    try {
      const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: device.public_key }, format: 'jwk' });
      return verify(null, canonicalize(body as JsonValue), key, Buffer.from(signature, 'base64url'));
    } catch {
      return false;
    }
  }
}
