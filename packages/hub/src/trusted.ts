// The devices you paired (#34): an answer that saves a decision or changes what a check demands counts when one of
// them signs it, or, from the CLI, once the OS confirms you (confirm.ts); never on the control token or the peer
// check alone. A device is paired once the OS confirms you, so the token can't pair a key of its own.
//
// One verifier for the app, phones and channels (#1579): a signature names the method, the hub, the time and a
// once-only ID beside the hash of the params, so one captured on one call counts for no other method, on no other hub,
// after 10 minutes or a second time. A spent ID stays in a table with a time index until its 10 minutes are over.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { canonicalize, type JsonValue } from '@deepbuild/contracts';
import { Refused, refusal } from './wire.js';

type Obj = Record<string, unknown>;

/** How long a signature counts, either side of the hub's clock. */
const SIGNED_WITHIN_MS = 10 * 60_000;
/** What every signature covers, in the order a refusal checks them. */
const SIGNED_FIELDS = ['device', 'method', 'hub', 'at', 'once', 'params'] as const;
const ONCE = /^[A-Za-z0-9_-]{16,128}$/;
/** Why a signature doesn't count, naming the field. */
interface Unsigned { field: string; reason: string }
/**
 * What a call expects its signature to cover. `retry`: a write with a request ID (#1577), whose retry follows the ID,
 * so a once-only ID already spent doesn't refuse it; its receipt makes it apply once.
 */
interface Expect { method: string; hub: string; params: Obj; now: number; retry?: boolean }
/** The planted wrong programs a verifier can be: #65's, which keeps an unpaired key, and #1579's, which skips the time. */
interface Lapses { unpairedToo?: boolean; skipsTime?: boolean }

/** The lower-case hex SHA-256 of the params' RFC 8785 bytes, with `signature` left out: what `signed.params` holds. */
function paramsHash(params: Obj): string {
  const { signature: _signature, ...body } = params;
  return createHash('sha256').update(canonicalize(body as JsonValue)).digest('hex');
}
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
  private db: Database.Database | undefined;
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
   * The one verifier (#1579): undefined once `signature`, `{signed: {device, method, hub, at, once, params}, sig}`, is a
   * paired device's Ed25519 signature over the RFC 8785 bytes of `signed`, for this method, this hub and these params,
   * within 10 minutes of the hub's clock, with a once-only ID never spent; `more` checks what else the caller needs
   * before the ID is spent. Otherwise why not, naming the field.
   */
  verify(signature: unknown, expect: Expect, lapses: Lapses = {}, more?: () => Unsigned | undefined): Unsigned | undefined {
    const checked = this.check(signature, expect, lapses);
    if ('field' in checked) return checked;
    const why = more?.();
    if (why) return why;
    if (!this.spend(checked.device, checked.once, checked.at, expect.now) && !expect.retry) return { field: 'once', reason: `its once-only ID ${checked.once} was spent already, so it counts once` };
    return undefined;
  }
  /** The paired device whose signature this is, every field holding but its once-only ID, which stays unspent: who a retry comes from (#1577). */
  signer(signature: unknown, expect: Expect): string | undefined {
    const checked = this.check(signature, expect, {});
    return 'field' in checked ? undefined : checked.device;
  }
  private check(signature: unknown, expect: Expect, lapses: Lapses): Unsigned | { device: string; once: string; at: number } {
    const s = (typeof signature === 'object' && signature !== null ? signature : {}) as { signed?: unknown; sig?: unknown };
    const signed = (typeof s.signed === 'object' && s.signed !== null ? s.signed : {}) as Obj;
    for (const field of SIGNED_FIELDS) if (signed[field] === undefined) return { field, reason: `the signature leaves out ${field}, so it covers too little to count` };
    // What it is for comes first, as channels named the hub before the device: one sent to another hub is refused
    // naming hub there, though that hub never paired the device.
    if (signed.method !== expect.method) return { field: 'method', reason: `it was signed for ${String(signed.method)}, not ${expect.method}` };
    if (signed.hub !== expect.hub) return { field: 'hub', reason: `it was signed for the hub ${String(signed.hub)}, not this one (${expect.hub})` };
    const device = String(signed.device);
    const key = this.keyOf(device, lapses.unpairedToo);
    if (!key) return { field: 'device', reason: `${device} is no device you paired, or you unpaired it, so what it signs counts for nothing` };
    if (!verifies(key, canonicalize(signed as JsonValue), s.sig)) return { field: 'signature', reason: `the signature doesn't verify against ${device}'s paired key` };
    if (typeof signed.at !== 'number' || (!lapses.skipsTime && Math.abs(expect.now - signed.at) > SIGNED_WITHIN_MS)) return { field: 'at', reason: `it was signed at ${String(signed.at)}, more than 10 minutes from now` };
    if (typeof signed.once !== 'string' || !ONCE.test(signed.once)) return { field: 'once', reason: 'its once-only ID is not 16 to 128 base64url characters' };
    if (signed.params !== paramsHash(expect.params)) return { field: 'params', reason: 'it signs other params than the ones sent' };
    return { device, once: signed.once, at: signed.at };
  }

  /** Spends a once-only ID: false when it was spent already. IDs past their 10 minutes go, as none of them can count. */
  private spend(device: string, once: string, at: number, now: number): boolean {
    this.db ??= open(join(dirname(this.file), 'spent.db'));
    this.db.prepare('DELETE FROM spent WHERE at < ?').run(now - SIGNED_WITHIN_MS);
    return this.db.prepare('INSERT INTO spent (device, once, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').run(device, once, at).changes === 1;
  }
}

/** The spent once-only IDs: a table keyed by device and ID, with a time index for the IDs that lapse. */
function open(file: string): Database.Database {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE IF NOT EXISTS spent (device TEXT NOT NULL, once TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (device, once)) STRICT; CREATE INDEX IF NOT EXISTS spent_at ON spent (at)');
  return db;
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
