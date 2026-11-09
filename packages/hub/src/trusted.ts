// The devices you paired (#34): an answer that saves a decision or changes what a check demands counts when one of
// them signs it, or, from the CLI, once the OS confirms you (confirm.ts); never on the control token or the peer
// check alone. A device is paired once the OS confirms you, so the token can't pair a key of its own.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { canonicalize, type JsonValue } from '@deepbuild/contracts';
import { Refused, refusal } from './wire.js';

type Obj = Record<string, unknown>;
/** How long a signature counts, either side of the hub's now. */
const SIGNED_WITHIN_MS = 10 * 60_000;
const SPENT_KEPT_MS = 24 * 60 * 60_000;
/**
 * A paired device: its ID, its name and its Ed25519 public key, the raw 32 bytes in base64url. The one `enclave` device
 * is deep-confirm's Secure Enclave key (#880): P-256, its X9.63 point in base64url, with the code requirement its
 * helper was recorded under at setup; it signs confirmations, never an answer's params.
 */
interface Device { device: string; name: string; public_key: string; paired: number; kind?: 'enclave'; requirement?: string; /** When you unpaired it (#65): from then on what it signs counts for nothing. */ unpaired?: number }

/** Refuses a public key that isn't an Ed25519 key's raw 32 bytes in base64url. */
export function checkKey(key: unknown): string {
  const bytes = typeof key === 'string' ? Buffer.from(key, 'base64url') : Buffer.alloc(0);
  if (bytes.length !== 32 || bytes.toString('base64url') !== key) throw new Refused(refusal('format', '/params/public_key', 'Give the Ed25519 public key as its raw 32 bytes in base64url.', key));
  return key as string;
}

export class Devices {
  private db: Spent | undefined;
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

  /**
   * Unpairs a paired device, on the trusted path (#65): kept, marked unpaired, so its signatures count for nothing
   * and a refusal can still name it. Whether it was a paired device to unpair.
   */
  unpair(device: string, at: number): boolean {
    const all = this.all();
    const found = all.find((d) => d.device === device && d.kind === undefined && d.unpaired === undefined);
    if (!found) return false;
    found.unpaired = at;
    this.write(all);
    return true;
  }
  /** A paired device's public key, while it stays paired; `unpairedToo` is the planted wrong program's read. */
  keyOf(device: string, unpairedToo = false): string | undefined {
    const d = this.all().find((x) => x.device === device && x.kind === undefined && (unpairedToo || x.unpaired === undefined));
    return d?.public_key;
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
   * The one verifier for what a paired device signs (#1579): the app's and a phone's requests and a channel's answers.
   * `signature` is `{ signed, sig }`, `sig` Ed25519 over the RFC 8785 bytes of `signed`, which names its device, this
   * hub, when it was signed and every field `scope` holds, each with the value it must have. Each counts only the first
   * time: the `once` it signs is spent here when `scope` asks for one, else the signature itself, as a channel's answer
   * signs none. The signing device once every field holds, or why not, naming the field.
   */
  verify(signature: unknown, hub: string, now: number, scope: Obj, plant?: string): string | { field: string; reason: string } {
    const s = (typeof signature === 'object' && signature !== null ? signature : {}) as { signed?: unknown; sig?: unknown };
    const signed = (typeof s.signed === 'object' && s.signed !== null ? s.signed : {}) as Obj;
    for (const field of ['device', 'hub', 'at', ...Object.keys(scope)]) if (signed[field] === undefined) return { field, reason: `the signature leaves out ${field}, so it covers too little to count` };
    if (signed.hub !== hub) return { field: 'hub', reason: `it was signed for the hub ${String(signed.hub)}, not this one (${hub})` };
    const device = String(signed.device);
    const key = this.keyOf(device, plant === 'keeps-unpaired-key');
    if (!key && plant !== 'trusts-channel-proof') return { field: 'device', reason: `${device} is no device you paired, or you unpaired it, so what it signs counts for nothing` };
    if (plant !== 'trusts-channel-proof' && !verifies(key!, canonicalize(signed as JsonValue), s.sig)) return { field: 'signature', reason: `the signature doesn't verify against ${device}'s paired key` };
    for (const [field, value] of Object.entries(scope)) {
      if (field !== 'once' && signed[field] !== value) return { field, reason: `it signs ${field} ${String(signed[field])}, not ${String(value)}` };
    }
    // A channel's answer is spent by its signature's bytes, so no other spelling of them counts again.
    const once = 'once' in scope ? signed.once : createHash('sha256').update(Buffer.from(String(s.sig), 'base64url')).digest('hex');
    if (typeof once !== 'string' || !once || once.length > 200) return { field: 'once', reason: 'its once-only ID isn\'t a string of 1 to 200 characters' };
    const spent = { field: 'once', reason: `${'once' in scope ? `its once-only ID ${once}` : 'this signature'} was spent already, so it counts only the first time` };
    const table = this.table(now);
    if (table.seen.get(once)) return spent;
    if (plant !== 'signature-skips-time' && (typeof signed.at !== 'number' || Math.abs(now - signed.at) > SIGNED_WITHIN_MS)) return { field: 'at', reason: `it was signed at ${String(signed.at)}, more than 10 minutes from now (${now})` };
    if (table.spend.run(once, now).changes !== 1) return spent;
    return device;
  }

  /** The table of spent once-only IDs, its spent IDs past a day gone: a replay is named as one past its 10 minutes. */
  private table(now: number): Spent {
    this.db ??= openSpent(join(dirname(this.file), 'spent.db'));
    this.db.prune.run(now - SPENT_KEPT_MS);
    return this.db;
  }
}

/** The table of spent once-only IDs, with its time index, beside the devices you paired; only you can read it. */
interface Spent { seen: StatementSync; spend: StatementSync; prune: StatementSync }
function openSpent(file: string): Spent {
  if (!existsSync(file)) writeFileSync(file, '', { mode: 0o600 });
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE IF NOT EXISTS spent (once TEXT PRIMARY KEY, at INTEGER NOT NULL) STRICT; CREATE INDEX IF NOT EXISTS spent_at ON spent (at);');
  return {
    seen: db.prepare('SELECT 1 FROM spent WHERE once = ?'),
    spend: db.prepare('INSERT OR IGNORE INTO spent (once, at) VALUES (?, ?)'),
    prune: db.prepare('DELETE FROM spent WHERE at < ?'),
  };
}

/** Ed25519 over `bytes` by the raw key `key` (base64url), the signature base64url. */
function verifies(key: string, bytes: Uint8Array, sig: unknown): boolean {
  if (typeof sig !== 'string') return false;
  try {
    return verify(null, bytes, createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: key }, format: 'jwk' }), Buffer.from(sig, 'base64url'));
  } catch {
    return false;
  }
}
