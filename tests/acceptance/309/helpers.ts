// Test-side tools for #309's acceptance tests (relay@1, the shipped relay and the network seam's macOS backend): the
// binaries built once per file and copied out under their own names; a throwaway certificate authority and a relay
// certificate for 127.0.0.1, made with the openssl CLI in a temporary folder; the shipped relay started on a local
// port and stopped by its PID; a plain TCP pass-through in front of a relay that counts the connections made to it;
// `deep-show run` (one JSON scenario on stdin, #393's convention) run as several processes at once; the relay suite;
// relay@1's frame read field by field in its little-endian layout; the committed digest; the local preflight's lanes.
// Nothing here stands in for a relay, a backend, the relay suite, its reader or the kit.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect, createServer, type Socket } from 'node:net';
import { connect as tlsConnect, createServer as createTlsServer } from 'node:tls';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { d1Digest, type Schema } from '../../../packages/contracts/src/index.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/309 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export const strs = (value: JsonValue | undefined, what: string): string[] => arr(value, what).map((v, i) => str(v, `${what}[${i}]`));
/** A backend as every result names it: `{name, version}`, both non-empty. */
export function backendOf(value: JsonValue | undefined, what: string): { name: string; version: string } {
  const b = obj(value, what);
  const name = str(b['name'], `${what}.name`);
  const version = str(b['version'], `${what}.version`);
  expect(name.length > 0 && version.length > 0, `${what} names the backend and its version: ${JSON.stringify(b)}`).toBe(true);
  return { name, version };
}
/** Bytes written as lowercase hex in a reply. */
export function hexBytes(value: JsonValue | undefined, what: string): Buffer {
  const text = str(value, what);
  expect(/^(?:[0-9a-f]{2})*$/.test(text), `${what} is lowercase hex bytes, got ${text.slice(0, 80)}`).toBe(true);
  return Buffer.from(text, 'hex');
}

// ---------------------------------------------------------------------------------------------------
// Processes: every child a test starts is stopped by its own PID, never by name or port.

const live = new Set<ChildProcess>();
function track(child: ChildProcess): ChildProcess {
  live.add(child);
  child.once('exit', () => live.delete(child));
  return child;
}
/** Stops every child this file started that still runs, by its PID. */
export function useCleanup(): void {
  afterEach(() => { for (const child of live) child.kill('SIGKILL'); live.clear(); });
}

export interface Ran { status: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean }
/** Runs one command without blocking the event loop, so the relays this process started keep being read. */
export function runAsync(argv: string[], options: { input?: string; timeoutMs?: number; cwd?: string } = {}): Promise<Ran> {
  const { input, timeoutMs = 1_200_000, cwd = REPO } = options;
  return new Promise((resolve) => {
    const child = track(spawn(argv[0]!, argv.slice(1), { cwd, stdio: ['pipe', 'pipe', 'pipe'] }));
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout!.setEncoding('utf8').on('data', (d: string) => { stdout += d; });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { stderr += d; });
    // A run that hangs is stopped by its own PID.
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.once('error', (e) => { clearTimeout(timer); resolve({ status: null, signal: null, stdout, stderr: `${argv.join(' ')} could not run: ${e.message}`, timedOut }); });
    child.once('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, stdout, stderr, timedOut }); });
    child.stdin!.on('error', () => {});
    child.stdin!.end(input ?? '');
  });
}
/** The last non-empty stdout line as JSON, or null. */
export function lastJson(stdout: string): JsonValue | null {
  const ls = stdout.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  try { return ls.length ? (JSON.parse(ls.at(-1)!) as JsonValue) : null; } catch { return null; }
}

// ---------------------------------------------------------------------------------------------------
// Builds: each binary built once per file (`cargo build --locked`), copied out of target/debug under its own name.
// deep-show is built apart from the relay's two binaries, so a missing relay crate leaves deep-show's tests running.

export type Bin = 'deep-show' | 'deep-relay' | 'deep-relay-suite';
const GROUPS: Bin[][] = [['deep-show'], ['deep-relay', 'deep-relay-suite']];

/** cargo's stderr without its progress lines, for a failure message. */
const cargoErrors = (stderr: string, max = 4000): string =>
  stderr.split('\n').filter((l) => !/Blocking waiting|^\s*Compiling|^\s*Finished|^\s*Downloaded|^\s*Downloading|^\s*Checking|^\s*Locking|^\s*Updating/.test(l)).join('\n').slice(-max);

export interface Bins { bin: (name: Bin) => string }
export function useBins(names: readonly Bin[]): Bins {
  let dir = '';
  const made = new Map<Bin, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-309-bins-'));
    const env = { ...process.env };
    delete env['CARGO_TARGET_DIR'];
    for (const group of GROUPS) {
      const wanted = group.filter((b) => names.includes(b));
      if (!wanted.length) continue;
      // The group is built whole, so one cargo call names both relay binaries.
      const args = ['build', '--locked', ...group.flatMap((b) => ['--bin', b])];
      const r = spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
      const error = r.status === 0 ? '' : `cargo ${args.join(' ')} failed:\n${cargoErrors(r.stderr ?? r.error?.message ?? '')}`;
      for (const b of wanted) {
        const bin = join(dir, b);
        if (error === '') copyFileSync(join(REPO, 'target', 'debug', b), bin);
        made.set(b, { bin, error });
      }
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(name: Bin): string {
      const entry = made.get(name);
      if (!entry) throw Error(`the file didn't list ${name} in useBins`);
      expect(entry.error, `the binary ${name} builds (README: The surface under test)`).toBe('');
      return entry.bin;
    },
  };
}

/** A fresh evidence folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-309-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// Certificates: a throwaway certificate authority and a relay certificate for IP 127.0.0.1 it signed, made fresh in
// a temporary folder for each file and deleted after it. Nothing is installed in a keychain; clients are handed the
// authority's PEM file (`ca`).

export interface Certs { ca: string; cert: string; key: string }
export function useCerts(): () => Certs {
  let dir = '';
  let certs: Certs | null = null;
  let error = '';
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'deep-309-certs-'));
    const at = (f: string): string => join(dir, f);
    // Each name from its own config file (LibreSSL's req lets a config's name win over -subj), a named P-256 curve
    // (LibreSSL writes explicit parameters otherwise), and no extension twice (a duplicate makes a certificate invalid).
    writeFileSync(at('ca.cnf'), '[req]\ndistinguished_name = dn\nprompt = no\n[dn]\nCN = deep-309 throwaway test authority\n[ca]\nbasicConstraints = critical,CA:TRUE\nkeyUsage = critical,keyCertSign,cRLSign\nsubjectKeyIdentifier = hash\n');
    writeFileSync(at('relay.cnf'), '[req]\ndistinguished_name = dn\nprompt = no\n[dn]\nCN = 127.0.0.1\n');
    writeFileSync(at('relay.ext'), 'subjectAltName = IP:127.0.0.1\nbasicConstraints = critical,CA:FALSE\nkeyUsage = critical,digitalSignature\nextendedKeyUsage = serverAuth\nauthorityKeyIdentifier = keyid\n');
    const steps: string[][] = [
      ['ecparam', '-name', 'prime256v1', '-param_enc', 'named_curve', '-out', at('p256.pem')],
      ['req', '-x509', '-new', '-newkey', `ec:${at('p256.pem')}`, '-nodes', '-keyout', at('ca.key'), '-out', at('ca.pem'), '-days', '2', '-config', at('ca.cnf'), '-extensions', 'ca'],
      ['req', '-new', '-newkey', `ec:${at('p256.pem')}`, '-nodes', '-keyout', at('relay.key'), '-out', at('relay.csr'), '-config', at('relay.cnf')],
      ['x509', '-req', '-in', at('relay.csr'), '-CA', at('ca.pem'), '-CAkey', at('ca.key'), '-set_serial', '309', '-out', at('relay.pem'), '-days', '2', '-sha256', '-extfile', at('relay.ext')],
    ];
    for (const args of steps) {
      const r = spawnSync('openssl', args, { cwd: dir, encoding: 'utf8' });
      if (r.status !== 0) { error = `openssl ${args.slice(0, 2).join(' ')} failed: ${r.error?.message ?? r.stderr}`; return; }
    }
    certs = { ca: at('ca.pem'), cert: at('relay.pem'), key: at('relay.key') };
    // The pair must hold up on its own: a TLS handshake to 127.0.0.1 that trusts only the authority, in this process.
    error = await new Promise<string>((resolve) => {
      const server = createTlsServer({ cert: readFileSync(certs!.cert), key: readFileSync(certs!.key) }, (s) => s.end());
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        const c = tlsConnect({ host: '127.0.0.1', port, ca: readFileSync(certs!.ca) }, () => { c.destroy(); server.close(); resolve(''); });
        c.on('error', (e) => { server.close(); resolve(`the throwaway certificate fails a TLS handshake to 127.0.0.1: ${e.message}`); });
      });
    });
  }, 120_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, 'a throwaway certificate authority and relay certificate for 127.0.0.1 were made with openssl').toBe('');
    return certs!;
  };
}

// ---------------------------------------------------------------------------------------------------
// The shipped relay, on 127.0.0.1 at a port it picks (README: The surface under test).

/** A message a planted relay received: its connection, the relay@1 message's name and its bytes. */
export interface Received { conn: number; received: string; bytes: string }
export interface Relay { host: string; url: string; pid: number; received: Received[]; stderr: () => string; stop: () => Promise<void> }

export async function startRelay(bin: string, certs: Certs, planted?: string): Promise<Relay> {
  const args = ['--listen', '127.0.0.1:0', '--cert', certs.cert, '--key', certs.key, ...(planted ? ['--planted', planted] : [])];
  const child = track(spawn(bin, args, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] }));
  const received: Received[] = [];
  let stderr = '';
  let pending = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => { stderr += d; });
  const listening = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`deep-relay ${args.join(' ')} printed no {"listening"} line within 60 s; stderr: ${stderr.slice(-1500)}`)), 60_000);
    child.once('error', (e) => { clearTimeout(timer); reject(Error(`deep-relay could not start: ${e.message}`)); });
    child.once('exit', (code, signal) => { clearTimeout(timer); reject(Error(`deep-relay ${args.join(' ')} exited ${signal ?? code} before listening; stderr: ${stderr.slice(-1500)}`)); });
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      pending += d;
      const lines = pending.split('\n');
      pending = lines.pop()!;
      for (const line of lines) {
        let value: JsonValue;
        try { value = JSON.parse(line) as JsonValue; } catch { continue; }
        if (!isObject(value)) continue;
        if (typeof value['listening'] === 'string') { clearTimeout(timer); resolve(value['listening']); }
        if (typeof value['received'] === 'string') received.push({ conn: Number(value['conn']), received: value['received'], bytes: String(value['bytes'] ?? '') });
      }
    });
  });
  expect(listening, `deep-relay listens on 127.0.0.1 at the port it picked: ${listening}`).toMatch(/^127\.0\.0\.1:\d+$/);
  const stop = async (): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    await exited;
    clearTimeout(timer);
  };
  return { host: listening, url: `https://${listening}`, pid: child.pid!, received, stderr: () => stderr, stop };
}

/**
 * A plain TCP pass-through on 127.0.0.1 in front of one relay, so the test itself counts the connections a client
 * opens to that relay; TLS runs end to end through it (the relay's certificate names IP 127.0.0.1, any port).
 */
export interface Door { host: string; url: string; connections: () => number; close: () => Promise<void> }
export async function startDoor(target: string): Promise<Door> {
  const [, port] = target.split(':');
  let connections = 0;
  const sockets = new Set<Socket>();
  const server = createServer((down) => {
    connections += 1;
    const up = connect(Number(port), '127.0.0.1');
    for (const s of [down, up]) { sockets.add(s); s.once('close', () => sockets.delete(s)); s.on('error', () => { down.destroy(); up.destroy(); }); }
    down.pipe(up);
    up.pipe(down);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const host = `127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  return {
    host, url: `https://${host}`, connections: () => connections,
    close: () => new Promise<void>((resolve) => { for (const s of sockets) s.destroy(); server.close(() => resolve()); }),
  };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario on stdin, one answer line `{"ok": true, "replies": [...]}` on stdout.

export async function runShow(bin: string, scenario: JsonObject, what: string, planted?: string, timeoutMs = 1_200_000): Promise<JsonObject[]> {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const label = `deep-show ${args.join(' ')}`;
  const r = await runAsync([bin, ...args], { input: `${JSON.stringify(scenario)}\n`, timeoutMs });
  if (r.timedOut) expect.fail(`${what}: ${label} did not finish within ${timeoutMs} ms`);
  expect(r.status, `${what}: ${label} exits 0 (${r.signal ?? 'no signal'}); stdout: ${r.stdout.slice(0, 800)}; stderr: ${r.stderr.slice(-2000)}`).toBe(0);
  const out = r.stdout.split('\n').filter((l) => l !== '');
  expect(out.length, `${what}: ${label} writes one line for the one scenario`).toBe(1);
  const answer = obj(JSON.parse(out[0]!) as JsonValue, `${what}: the answer`);
  expect(answer['ok'], `${what}: ${label} answers the scenario ok (README: The surface under test); got ${JSON.stringify(answer).slice(0, 800)}`).toBe(true);
  const replies = arr(answer['replies'], `${what}: replies`).map((x, i) => obj(x, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(scenario['calls'], 'calls').length);
  return replies;
}

/** One test client's `relay_client` reply (README: The surface under test). */
export interface Client {
  name: string; backend: { name: string; version: string }; relay: string; hello: { protocol: string; digest: string } | null;
  outcome: string; reason: string | null; match: string; player: number | null; sent: Buffer[]; received: Buffer[];
  reader: { status: string; failures: string[] };
}
export interface ClientRun { name: string; relay: string; match: string; frames: number; players?: number; planted?: string }

/** Test clients on the macOS backend, each its own `deep-show run`, all started together. */
export async function runClients(show: string, out: string, ca: string, runs: ClientRun[]): Promise<Client[]> {
  return Promise.all(runs.map(async (run) => {
    const what = `test client ${run.name}${run.planted ? ` (--planted ${run.planted})` : ''}`;
    const evidence = join(out, `client-${run.name}`);
    mkdirSync(evidence, { recursive: true });
    const call = { call: 'relay_client', relay: run.relay, ca, match: run.match, players: run.players ?? runs.length, frames: run.frames };
    const [reply] = await runShow(show, { evidence, calls: [call] }, what, run.planted, 600_000);
    const r = obj(reply, what);
    const hello = r['hello'] === null ? null : obj(r['hello'], `${what}: hello`);
    const reader = obj(r['reader'], `${what}: reader`);
    return {
      name: run.name,
      backend: backendOf(r['backend'], `${what}: backend`),
      relay: str(r['relay'], `${what}: relay`),
      hello: hello === null ? null : { protocol: str(hello['protocol'], `${what}: hello.protocol`), digest: str(hello['digest'], `${what}: hello.digest`) },
      outcome: str(r['outcome'], `${what}: outcome`),
      reason: r['reason'] === null ? null : str(r['reason'], `${what}: reason`),
      match: str(r['match'], `${what}: match`),
      player: r['player'] === null ? null : num(r['player'], `${what}: player`),
      sent: arr(r['sent'], `${what}: sent`).map((f, i) => hexBytes(f, `${what}: sent[${i}]`)),
      received: arr(r['received'], `${what}: received`).map((f, i) => hexBytes(f, `${what}: received[${i}]`)),
      reader: { status: str(reader['status'], `${what}: reader.status`), failures: strs(reader['failures'], `${what}: reader.failures`) },
    };
  }));
}

/** The macOS backend's name, as every reply names it (README: The surface under test). */
export const MACOS_BACKEND = 'network.macos';

/** A random match ID: 16 bytes as 32 lowercase hex digits. */
export const matchId = (): string => Buffer.from(Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))).toString('hex');

// ---------------------------------------------------------------------------------------------------
// relay@1's frame, read by this file in its documented little-endian layout (the issue's Fields):
// {match: 16 B, player: u8, confirmed: u32, first: u32, count: u16, then each step's entries}.

export const HEADER = 16 + 1 + 4 + 4 + 2;
export interface Frame { match: string; player: number; confirmed: number; first: number; count: number; entries: Buffer }
export function readFrame(bytes: Buffer, what: string): Frame {
  expect(bytes.length, `${what}: a relay@1 frame holds at least its ${HEADER}-byte header, got ${bytes.length} bytes`).toBeGreaterThanOrEqual(HEADER);
  return {
    match: bytes.subarray(0, 16).toString('hex'),
    player: bytes.readUInt8(16),
    confirmed: bytes.readUInt32LE(17),
    first: bytes.readUInt32LE(21),
    count: bytes.readUInt16LE(25),
    entries: bytes.subarray(HEADER),
  };
}
/** The `first` field read big-endian, only to show what a planted writer put there. */
export const firstBigEndian = (bytes: Buffer): number => bytes.readUInt32BE(21);

// ---------------------------------------------------------------------------------------------------
// The relay suite (README: The surface under test).

export interface SuiteConn { match: string; player: number | null; refused: string | null; sent: Buffer[]; received: Buffer[] }
export interface Suite {
  status: string; exit: number | null; hello: { protocol: string; digest: string }; relay: string;
  checks: Record<string, { status: string; failures: string[] }>; connections: SuiteConn[];
}
export async function relaySuite(bin: string, url: string, ca: string, what: string): Promise<Suite> {
  const r = await runAsync([bin, '--relay', url, '--ca', ca], { timeoutMs: 600_000 });
  if (r.timedOut) expect.fail(`${what}: deep-relay-suite did not finish within 600 s`);
  const report = obj(lastJson(r.stdout), `${what}: deep-relay-suite's last stdout line (exit ${r.signal ?? r.status}; stderr: ${r.stderr.slice(-1500)})`);
  expect(report['suite'], `${what}: the report names its suite`).toBe('relay@1');
  const hello = obj(report['hello'], `${what}: hello`);
  const checks = obj(report['checks'], `${what}: checks`);
  return {
    status: str(report['status'], `${what}: status`),
    exit: r.status,
    relay: str(report['relay'], `${what}: relay`),
    hello: { protocol: str(hello['protocol'], `${what}: hello.protocol`), digest: str(hello['digest'], `${what}: hello.digest`) },
    checks: Object.fromEntries(Object.entries(checks).map(([name, c]) => {
      const check = obj(c, `${what}: checks.${name}`);
      return [name, { status: str(check['status'], `${what}: checks.${name}.status`), failures: strs(check['failures'], `${what}: checks.${name}.failures`) }];
    })),
    connections: arr(report['connections'], `${what}: connections`).map((c, i) => {
      const conn = obj(c, `${what}: connections[${i}]`);
      const join = obj(conn['join'], `${what}: connections[${i}].join`);
      return {
        match: str(conn['match'], `${what}: connections[${i}].match`),
        player: typeof join['player'] === 'number' ? join['player'] : null,
        refused: typeof join['refused'] === 'string' ? join['refused'] : null,
        sent: arr(conn['sent'], `${what}: connections[${i}].sent`).map((f, j) => hexBytes(f, `${what}: connections[${i}].sent[${j}]`)),
        received: arr(conn['received'], `${what}: connections[${i}].received`).map((f, j) => hexBytes(f, `${what}: connections[${i}].received[${j}]`)),
      };
    }),
  };
}

// ---------------------------------------------------------------------------------------------------
// relay@1's committed digest: packages/contracts/digests.json's entry `relay@1`, frozen from its contract file
// (packages/contracts/schemas/relay@1.json or slots/relay@1.json) by the contracts' d1 digest.

export function committed(): { digest: string | undefined; file: string | null; fileDigest: string | null } {
  const digests = JSON.parse(readFileSync(join(REPO, 'packages', 'contracts', 'digests.json'), 'utf8')) as Record<string, string>;
  const file = ['schemas', 'slots'].map((d) => join(REPO, 'packages', 'contracts', d, 'relay@1.json')).find((f) => existsSync(f)) ?? null;
  const fileDigest = file ? d1Digest(JSON.parse(readFileSync(file, 'utf8')) as Schema) : null;
  return { digest: digests['relay@1'], file, fileDigest };
}

// ---------------------------------------------------------------------------------------------------
// The local preflight's lanes (scripts/lanes.mjs `checks`).

export interface Lane { name: string; commands: string[][] }
export async function lanes(): Promise<Lane[]> {
  const { checks } = (await import('../../../scripts/lanes.mjs')) as unknown as { checks: Lane[] };
  return checks;
}
