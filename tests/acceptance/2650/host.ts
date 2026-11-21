// Test-side tools for #2650's extension-host tests (AC3, AC5): temp folders, a world (the record with its evidence
// store, the asks core, the supervisor and project trust), hosts opened through @deepbuild/extension-host's public
// entry, test plug-ins copied from fixtures/, action calls, and stand-ins for the OS secret store and the network.
// Nothing here stands in for the extension host; its package is loaded lazily, so this file loads at the base.
//
// Safety: every folder is under /tmp/dh2650-* (real paths); HOME is a temp folder for this process; the agent's own
// CLAUDE*, DEEP_* and AI_AGENT variables are removed first; nothing reaches the network or the Keychain; every host a
// test opens is closed after its file, which stops what it started. Nothing is stopped by name or port.
import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import type { ActionResult, ExtensionHost, HttpClient, InstallFrom, Plant, Recording, SecretStore } from '../../../packages/extension-host/src/index.ts';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord, type Connection, type Event, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const HOST_ENTRY = '../../../packages/extension-host/src/index.ts';
const DAY = 86_400_000;

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key === 'AI_AGENT') delete process.env[key];
const HOME = realpathSync(mkdtempSync('/tmp/dh2650-home-'));
process.env.HOME = HOME;

const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh2650-${tag}-`));
  made.push(dir);
  return dir;
}

// ---- IDs.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function base32(value: bigint, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
export const ulid = (ms = Date.now()): string => base32(BigInt(ms), 10) + base32(BigInt(`0x${randomBytes(10).toString('hex')}`), 16);
/** A request ID, as an agent's call through deep-actions carries one. */
export const requestId = (): string => `req-${randomBytes(8).toString('hex')}`;

// ---- Who calls, as the hub's socket proved it.
/** An agent session's call through deep-actions, once the hub's gate let it through: its credential, bound to that session. */
export const agentCall = (session: string): Connection => ({ writer: `mcp:${session}`, actor: 'you', scope: 'you', session, agent: 'claude-code' });

// ---- The world.
export interface World {
  dir: string;
  /** The ~/.deepbuild the host installs extensions under. */
  home: string;
  record: RecordStore;
  sup: Supervisor;
  events(kind?: string): Promise<Event[]>;
  close(): Promise<void>;
}
const worlds: World[] = [];
const hosts: ExtensionHost[] = [];
/** The extension-host package, loaded lazily. */
const host = () => import(new URL(HOST_ENTRY, import.meta.url).href) as Promise<typeof import('../../../packages/extension-host/src/index.ts')>;

export async function openWorld(): Promise<World & { trust: Awaited<ReturnType<Awaited<ReturnType<typeof host>>['openTrust']>> }> {
  const dir = tempDir('world');
  const deepHome = join(dir, 'deepbuild');
  mkdirSync(deepHome, { recursive: true });
  const evidence = await openEvidenceStore({ root: join(dir, 'evidence') });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now, evidence });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } } });
  const { openTrust } = await host();
  const trust = await openTrust({ record, now: Date.now });
  const events = async (kind?: string): Promise<Event[]> => {
    await record.sync();
    const all: Event[] = [];
    for (let after = 0; ;) {
      const page = await record.read({ after, limit: 1000, ...(kind ? { kinds: [kind] } : {}) });
      all.push(...page);
      if (page.length < 1000) break;
      after = page[page.length - 1]!.log_pos;
    }
    return kind ? all.filter((e) => e.kind === kind) : all;
  };
  let closed = false;
  const w = {
    dir, home: deepHome, record, sup, trust, events,
    close: async () => {
      if (closed) return;
      closed = true;
      await sup.close();
      await record.close();
    },
  };
  worlds.push(w);
  return w;
}

/** An in-memory secret store standing in for the OS one: these plug-ins need no secret, so nothing reaches the Keychain. */
const noKeychain = (): SecretStore => {
  const entries = new Map<string, string>();
  return { get: async (k) => entries.get(k), set: async (k, v) => { entries.set(k, v); }, delete: async (k) => { entries.delete(k); } };
};
/** A ready extension host on a world, with no signed release: every test plug-in runs in the sandbox. */
export async function openHost(w: Awaited<ReturnType<typeof openWorld>>, o: { plant?: Plant; http?: HttpClient; replay?: Recording; now?: () => number } = {}): Promise<ExtensionHost> {
  const { openExtensionHost } = await host();
  const h = await openExtensionHost({
    record: w.record, supervisor: w.sup, trust: w.trust, home: w.home, release: [], now: o.now ?? Date.now, secrets: noKeychain(),
    ...(o.plant ? { plant: o.plant } : {}), ...(o.http ? { http: o.http } : {}), ...(o.replay ? { replay: o.replay } : {}),
  });
  hosts.push(h);
  await h.ready();
  return h;
}

afterAll(async () => {
  for (const h of hosts.splice(0)) await h.close().catch(() => undefined);
  for (const w of worlds.splice(0)) await w.close().catch(() => undefined);
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  rmSync(HOME, { recursive: true, force: true });
});

// ---- Test plug-ins.
/**
 * A test plug-in in a temp folder: `fixtures/<name>` copied with each `*.fixture` file renamed without that suffix (so
 * neither this suite's Vitest nor its type check picks the plug-in's code up), and the manifest's `digest` set to the
 * host's own `packageDigest` of the result.
 */
export async function pkg(name: string): Promise<string> {
  const dir = tempDir(`pkg-${name}`);
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  for (const entry of readdirSync(dir)) if (entry.endsWith('.fixture')) renameSync(join(dir, entry), join(dir, entry.slice(0, -'.fixture'.length)));
  const manifestPath = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  const { packageDigest } = await host();
  manifest.digest = packageDigest(dir);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}
/** Install (by no agent), conformance and load, as a person runs an install; each must succeed. */
export async function installAndLoad(h: ExtensionHost, from: string, grant?: InstallFrom['grant']): Promise<void> {
  const p = await h.install({ from, builtBy: null, ...(grant ? { grant } : {}) });
  const checked = await h.check(p);
  expect(checked.passed, `${p.id}@${p.version}'s conformance: ${checked.reasons.join('; ')}`).toBe(true);
  const load = await h.load(p);
  expect(load.status, `${p.id}@${p.version} didn't load: ${JSON.stringify(load)}`).toBe('loaded');
}

// ---- Action calls.
/** One action call of the plug-in `ext:<id>`@1.0.0, as deep-actions makes it, with the caller and request ID given. */
export function call(h: ExtensionHost, id: string, action: string, input: unknown, caller: Connection, request: string): Promise<ActionResult> {
  return h.callAction({ action, input, caller, request, target: { handle: `ext:${id}`, version: '1.0.0' } });
}
/** A call that must be done; its output. */
export async function done(result: Promise<ActionResult>, what: string): Promise<any> {
  const r = await result;
  expect(r.status, `${what}: ${JSON.stringify(r)}`).toBe('done');
  return (r as { output: unknown }).output;
}

// ---- The network, stood in for at the hub's HTTP client (the host's `http` option): each host a function of the path.
export type Route = (path: string, range: string | undefined) => { status: number; headers?: Record<string, string>; body: string | Buffer };
/**
 * The HTTP client a host is given: a call for `https://<name><path>` goes to the route standing in for that name, its
 * body as text, or as base64 when the hub asks for a file's bytes, as Node's own client gives it. A name no route
 * stands in for is refused before any socket, as a machine with no network refuses it. `asked` keeps every call.
 */
export function network(routes: Record<string, Route>): { client: HttpClient; asked: string[] } {
  const asked: string[] = [];
  const client: HttpClient = async (request) => {
    const url = new URL(request.url);
    asked.push(`${request.method} ${request.url}${request.headers.range ? ` ${request.headers.range}` : ''}`);
    const route = routes[url.host];
    if (!route) throw new TypeError('fetch failed', { cause: Object.assign(new Error(`getaddrinfo ENOTFOUND ${url.hostname}`), { code: 'ENOTFOUND' }) });
    const answer = route(`${url.pathname}${url.search}`, request.headers.range);
    const bytes = Buffer.isBuffer(answer.body) ? answer.body : Buffer.from(answer.body, 'utf8');
    return { status: answer.status, headers: answer.headers ?? {}, body: bytes.toString(request.encoding === 'base64' ? 'base64' : 'utf8') };
  };
  return { client, asked };
}
