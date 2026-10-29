// Test-side tools for the #44 acceptance tests: temp folders, a world (the record, the asks core, the supervisor that
// is #236's local host@1, project trust, and the kernel's lease table, `@deepbuild/leases`, opened on that record as
// the hub opens it), test packages copied from fixtures/, the admission of a package (install, check, load), and the
// probe each test package reports its `deep.lease` call through. Nothing here stands in for the extension host or
// the lease table: the tests reach the host only through `@deepbuild/extension-host` and the table only through
// `@deepbuild/leases` (README, The surface under test). The host's package is loaded lazily, as #348's tests do.
//
// Safety: every folder is under /tmp/dh44-* (real paths); HOME is a temp folder for this process and every child;
// the agent's own CLAUDE_* and DEEP_* variables are removed first; no test touches the real ~/.deepbuild; and no
// process is ever stopped by name or port (each host a test opens is closed, which stops what it started).

import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import type { CheckSpec } from '../../../packages/conformance/src/index.ts';
import type { ExtensionHost, Installed, Load, Loaded, Plant, ProjectTrust, ReleaseEntry } from '../../../packages/extension-host/src/index.ts';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { openLeases, type LeaseKind, type LeaseResult, type LeaseTable, type LeaseView, type Mode } from '../../../packages/leases/src/index.ts';
import { openRecord, type Event, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';

export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const DAY = 86_400_000;
/** The extension host's public entry (README, The surface under test). */
export const HOST_ENTRY = '../../../packages/extension-host/src/index.ts';

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key === 'AI_AGENT') delete process.env[key];
let HOME: string | undefined;
function home(): string {
  if (!HOME || !existsSync(HOME)) {
    HOME = realpathSync(mkdtempSync('/tmp/dh44-home-'));
    process.env.HOME = HOME;
  }
  return HOME;
}
home();

const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh44-${tag}-`));
  made.push(dir);
  return dir;
}
export const message = (e: unknown): string => String((e as Error)?.message ?? e);

// ---- The lease kinds the tests' manifests declare: lease.kind@1 data, as the design's examples name them.
/** A device rig, matched by exact key. */
export const RIG: LeaseKind = { name: 'device.rig', match: 'exact', cap: 100, cooldown: 0, cost: 0 };
/** Paths in a repo, matched by glob. */
export const TREE: LeaseKind = { name: 'repo.tree', match: 'glob', cap: 100, cooldown: 0, cost: 0 };

// ---- The world.
export interface World {
  dir: string;
  home: string;
  record: RecordStore;
  sup: Supervisor;
  trust: ProjectTrust;
  /** The kernel's one lease table, on the world's record, as the hub opens it (#237). */
  table: LeaseTable;
  events(kind?: string): Promise<Event[]>;
}
const closers: (() => Promise<void>)[] = [];

/** The extension-host package, loaded lazily so this file loads at the base. */
export const host = () => import(new URL(HOST_ENTRY, import.meta.url).href) as Promise<typeof import('../../../packages/extension-host/src/index.ts')>;

export async function openWorld(): Promise<World> {
  const dir = tempDir('world');
  const deepHome = join(dir, 'deepbuild');
  mkdirSync(deepHome, { recursive: true });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } } });
  const table = await openLeases({ record, now: Date.now });
  closers.push(async () => { await sup.close(); await record.close(); });
  const { openTrust } = await host();
  const trust = await openTrust({ record, now: Date.now });
  const events = async (kind?: string): Promise<Event[]> => {
    const all: Event[] = [];
    for (let after = 0; ;) {
      const page = await record.read({ after, limit: 1000 });
      all.push(...page);
      if (page.length < 1000) break;
      after = page[page.length - 1]!.log_pos;
    }
    return kind ? all.filter((e) => e.kind === kind) : all;
  };
  return { dir, home: deepHome, record, sup, trust, table, events };
}

/**
 * An extension host on a world's record, supervisor, trust, home and lease table (`leases`, README, The surface under
 * test), made ready before any package loads, so each package starts at its load.
 */
export async function openHost(w: World, options: { release?: ReleaseEntry[]; plant?: Plant } = {}): Promise<ExtensionHost> {
  const { openExtensionHost } = await host();
  const h = await openExtensionHost({
    record: w.record, supervisor: w.sup, trust: w.trust, home: w.home, release: options.release ?? [], now: Date.now,
    leases: w.table,
    ...(options.plant ? { plant: options.plant } : {}),
  });
  closers.unshift(() => h.close());
  await h.ready();
  return h;
}

afterAll(async () => {
  for (const close of closers.splice(0)) await close().catch(() => undefined);
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (HOME) rmSync(HOME, { recursive: true, force: true });
});

// ---- Test packages.
/** `fixtures/<name>` copied into a temp folder, each `*.fixture` file renamed without that suffix. */
function copyFixture(name: string, tag: string): string {
  const dir = tempDir(tag);
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.fixture')) renameSync(path, path.slice(0, -'.fixture'.length));
    }
  };
  walk(dir);
  return dir;
}

/**
 * The access word `deep.lease` needs, as the extension API schema says, when it is one (null when it needs none):
 * each test package asks for it, so no test depends on which grant, if any, the schema gives the method. The grant
 * a call needs is the schema's to say (#348, README Readings: the extension API schema); #44 says nothing of one.
 */
async function leaseWord(): Promise<string | null> {
  const { EXTENSION_API } = await host();
  return EXTENSION_API.find((m) => m.method === 'deep.lease')?.needs ?? null;
}

/**
 * A test package in a temp folder, `fixtures/<fixture>` with its manifest's fields written over: `id`, the probe's
 * check kind `ext.<plugin>.report` (TypeScript only; the Python package's manifest names its own), `leases` (the
 * manifest's lease kinds, README, The surface under test) when given, and the access word `deep.lease` needs, if
 * any. A `main` gets this machine's python3 on its first line. The manifest's `digest` is the host's
 * `packageDigest` of the result.
 */
export async function pkg(fixture: 'leaser' | 'pylease', options: { id?: string; leases?: unknown[] } = {}): Promise<string> {
  const dir = copyFixture(fixture, `pkg-${fixture}`);
  const main = join(dir, 'main');
  if (existsSync(main)) {
    const lines = readFileSync(main, 'utf8').split('\n');
    lines[0] = `#!${needPython3()}`;
    writeFileSync(main, lines.join('\n'));
    chmodSync(main, 0o755);
  }
  const manifestPath = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  if (options.id) {
    manifest.id = options.id;
    manifest.checks = [`ext.${plugin(options.id)}.report`];
  }
  if (options.leases) manifest.leases = options.leases;
  const word = await leaseWord();
  if (word) manifest.access = { words: [word] };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const { packageDigest } = await host();
  manifest.digest = packageDigest(dir);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}
export const plugin = (id: string): string => id.slice(id.indexOf('/') + 1);

/** The release entry for a package folder: DeepBuild's signed release listing it, byte for byte. */
export async function releaseEntry(dir: string): Promise<ReleaseEntry> {
  const { packageDigest } = await host();
  const m = JSON.parse(readFileSync(join(dir, 'deepbuild.json'), 'utf8')) as { id: string; version: string };
  return { id: m.id, version: m.version, digest: packageDigest(dir) };
}

// ---- Admission: install, check, load. A refusal at any of the three is the package's refusal; which of them refuses
// a manifest's lease kind is the host's choice (README, Readings: at install or at load).
export interface Admission { installed: Installed | null; load: Load | null; refusal: string | null }
export async function admit(h: ExtensionHost, dir: string): Promise<Admission> {
  let installed: Installed;
  try {
    installed = await h.install({ from: dir, builtBy: null });
  } catch (e) {
    return { installed: null, load: null, refusal: `install refused: ${message(e)}` };
  }
  try {
    const c = await h.check(installed);
    if (!c.passed) return { installed, load: null, refusal: `check failed: ${c.reasons.join('; ')}` };
    const load = await h.load(installed);
    return { installed, load, refusal: load.status === 'refused' ? `load refused: ${load.reason}` : null };
  } catch (e) {
    return { installed, load: null, refusal: `check or load threw: ${message(e)}` };
  }
}
/** A package admitted and loaded, or a failure naming why not. */
export function loaded(a: Admission, what: string): Loaded {
  expect(a.refusal, `${what} loads`).toBeNull();
  expect(a.load?.status, `${what} loads: ${JSON.stringify(a.load)}`).toBe('loaded');
  return a.load as Loaded;
}

// ---- The probe: a package's check kind ext.<plugin>.report calls `deep.lease(resource, mode)` with the request the
// spec's `runner` carries, and reports what came back (README, Readings: the probe).
export interface Seen { result?: LeaseResult | null; error?: string }
export async function lease(h: ExtensionHost, id: string, resource: Record<string, unknown>, mode: Mode): Promise<Seen> {
  const kind = `ext.${plugin(id)}.report`;
  const spec: CheckSpec = { kind, runner: JSON.stringify({ resource, mode }), inputs: [], depth: 'unit', oracle: 'code', contract: null };
  const r = await h.runCheck(kind, spec, { checkout: tempDir('checkout'), deadline: 30_000 });
  const text = r.failures?.[0]?.message;
  if (typeof text !== 'string') return { error: `the probe ${kind} returned no report: ${JSON.stringify(r)}` };
  try {
    return JSON.parse(text) as Seen;
  } catch {
    return { error: `the probe ${kind} returned no report: ${JSON.stringify(r)}` };
  }
}

/** The leases the table holds now on a key of a kind. */
export async function held(w: World, kind: string, key: string): Promise<LeaseView[]> {
  return (await w.table.leases()).filter((v) => v.lease.resource.kind === kind && v.lease.resource.key === key);
}

// ---- The shared assertions; each wrong program's test expects one of them to fail.
/**
 * A grant held by `holder` on host `local`, for exactly that kind, key and mode: as `deep.lease` returned it, in the
 * table's leases, and on record as a `lease.acquired` naming the holder.
 */
export async function grantedTo(w: World, seen: Seen, holder: string, kind: string, key: string, mode: Mode): Promise<void> {
  const what = `deep.lease({kind: ${kind}, key: ${key}}, ${mode}) for ${holder}`;
  expect(seen.error, `${what} rejected`).toBeUndefined();
  expect(seen.result?.status, `${what} returns a grant: ${JSON.stringify(seen)}`).toBe('granted');
  if (seen.result?.status !== 'granted') return;
  const l = seen.result.lease;
  expect(l.holder, `${what}: the lease is held by ${holder}`).toBe(holder);
  expect(l.resource, `${what}: on host local, its kind and key as asked`).toEqual({ host: 'local', kind, key });
  expect(l.mode, `${what}: its mode as asked`).toBe(mode);
  const views = await held(w, kind, key);
  expect(views.map((v) => v.lease), `${what}: the table holds it`).toContainEqual(l);
  const acquired = (await w.events('lease.acquired')).filter((e) => e.subject === l.id);
  expect(acquired.length, `${what}: one lease.acquired on record for ${l.id}`).toBe(1);
  const data = acquired[0]!.data as { holder: string; resource: unknown; mode: string };
  expect(data.holder, `${what}: the record names ${holder}`).toBe(holder);
  expect(data.resource, `${what}: the record's resource is on host local`).toEqual({ host: 'local', kind, key });
}
/** A refusal returned by `deep.lease`, naming the holder in the way, and no lease of the asker's on that key. */
export async function refusedNaming(w: World, seen: Seen, asker: string, holder: string, kind: string, key: string): Promise<void> {
  const what = `${asker}'s deep.lease({kind: ${kind}, key: ${key}})`;
  expect(seen.error, `${what} rejected instead of returning the refusal`).toBeUndefined();
  expect(seen.result?.status, `${what} returns a refusal: ${JSON.stringify(seen)}`).toBe('refused');
  expect(JSON.stringify(seen.result), `${what}: the refusal names the holder ${holder}`).toContain(holder);
  const views = await held(w, kind, key);
  expect(views.filter((v) => v.lease.holder !== holder).map((v) => v.lease), `${what}: only ${holder} holds ${key}`).toEqual([]);
}

// ---- python3 for the JSON-RPC package. A test that needs it fails BLOCKED naming it; it is never skipped.
let python: string | null | undefined;
export function needPython3(): string {
  if (python === undefined) {
    python = null;
    for (const dir of (process.env.PATH ?? '').split(':').filter(Boolean)) {
      const candidate = join(dir, 'python3');
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        const real = realpathSync(candidate);
        const r = spawnSync(real, ['-c', 'import json, sys; print(sys.version_info[0])'], { encoding: 'utf8', timeout: 30_000 });
        if (r.status === 0 && r.stdout.trim() === '3') { python = real; break; }
      }
    }
  }
  if (!python) throw Error('BLOCKED: no working python3 on PATH, so the JSON-RPC test package can\'t run on this machine');
  return python;
}
