// Test-side tools for the #351 acceptance tests: temp folders, a world (the record, the asks core, the supervisor
// and project trust), hosts, test packages copied from fixtures/ (stamped, and signed when a test says so), the
// guide's examples built as a reader builds them, and the guide's drift test run on copies of the contract. Nothing
// here stands in for the installer, the guide or its drift test: the tests reach them only through the surfaces the
// README names (`@deepbuild/extension-host`, `@deepbuild/contracts`, `scripts/guide.mjs`, `docs/extension-guide.md`
// and its examples). The host is loaded lazily, so this file loads at the base, where the surface doesn't exist.
//
// Safety: every folder is under /tmp/dh351-* (real paths); HOME is a temp folder for this process and every child;
// the agent's own CLAUDE_* and DEEP_* variables are removed first; no test touches the real ~/.deepbuild; no network;
// and no process is ever stopped by name or port (each host a test opens is closed, which stops what it started).

import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import type { Asks } from '../../../packages/asks/src/index.ts';
import type { CheckResult, CheckSpec } from '../../../packages/conformance/src/index.ts';
import type { ApiEntry, HubSlot } from '../../../packages/contracts/src/index.ts';
import type { ExtensionHost, Plant, ProjectTrust, ReleaseEntry } from '../../../packages/extension-host/src/index.ts';
import { openRecord, type Connection, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const NODE = process.execPath;
export const DAY = 86_400_000;
/** The public entries the tests reach the surface through (README, The surface under test). */
export const HOST_ENTRY = '../../../packages/extension-host/src/index.ts';
export const ASKS_ENTRY = '../../../packages/asks/src/index.ts';
export const CONTRACTS_ENTRY = '../../../packages/contracts/src/index.ts';
/** The built entry the journey test package imports in the hub (its folder is a temp copy, outside the workspace). */
export const CONFORMANCE_DIST = join(REPO, 'packages/conformance/dist/index.js');
/** The generated extension guide, its two worked examples, and the script that writes it and runs its drift test. */
export const GUIDE = join(REPO, 'docs/extension-guide.md');
export const EXAMPLES = join(REPO, 'docs/extension-guide');
export const GUIDE_SCRIPT = join(REPO, 'scripts/guide.mjs');
export const LANES = join(REPO, 'scripts/lanes.mjs');
export const API_FILE = join(REPO, 'packages/contracts/extension-api.json');
export const TABLE_FILE = join(REPO, 'packages/contracts/hub-slots.json');

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key === 'AI_AGENT') delete process.env[key];
let HOME: string | undefined;
export function home(): string {
  if (!HOME || !existsSync(HOME)) {
    HOME = realpathSync(mkdtempSync('/tmp/dh351-home-'));
    process.env.HOME = HOME;
  }
  return HOME;
}
home();

// ---- Temp folders, all removed after the file.
const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh351-${tag}-`));
  made.push(dir);
  return dir;
}

// ---- Connections. The trusted path (the app's card) is the only writer whose answer trusts a key.
export const YOU: Connection = { writer: 'app', actor: 'you', scope: 'you' };
/** An agent's `deep mcp` connection for one of its sessions: its word trusts nothing. */
export const AGENT: Connection = { writer: 'mcp', actor: 'you', scope: 'you', session: '01K8A0000000000000000AGENT', agent: 'claude-code' };

// ---- The surface, loaded lazily so this file loads at the base.
export const host = () => import(new URL(HOST_ENTRY, import.meta.url).href) as Promise<typeof import('../../../packages/extension-host/src/index.ts')>;
export const asksCore = () => import(new URL(ASKS_ENTRY, import.meta.url).href) as Promise<typeof import('../../../packages/asks/src/index.ts')>;
export const contracts = () => import(new URL(CONTRACTS_ENTRY, import.meta.url).href) as Promise<typeof import('../../../packages/contracts/src/index.ts')>;

// ---- The world: a record, the asks core, the supervisor and project trust.
export interface World {
  dir: string;
  /** The ~/.deepbuild the host installs extensions under. */
  home: string;
  record: RecordStore;
  asks: Asks;
  sup: Supervisor;
  trust: ProjectTrust;
  close(): Promise<void>;
}
const worlds: World[] = [];
const hosts: ExtensionHost[] = [];
export async function openWorld(): Promise<World> {
  const dir = tempDir('world');
  const deepHome = join(dir, 'deepbuild');
  mkdirSync(deepHome, { recursive: true });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const { openAsks } = await asksCore();
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } } });
  const { openTrust } = await host();
  const trust = await openTrust({ record, now: Date.now });
  let closed = false;
  const w: World = {
    dir, home: deepHome, record, asks, sup, trust,
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

/** An extension host on a world: `release` is DeepBuild's signed release; `plant` selects a planted wrong program. */
export async function openHost(w: World, options: { release?: ReleaseEntry[]; plant?: Plant } = {}): Promise<ExtensionHost> {
  const { openExtensionHost } = await host();
  const h = await openExtensionHost({
    record: w.record, asks: w.asks, supervisor: w.sup, trust: w.trust, home: w.home, release: options.release ?? [], now: Date.now,
    ...(options.plant ? { plant: options.plant } : {}),
  });
  hosts.push(h);
  await h.ready();
  return h;
}

afterAll(async () => {
  for (const h of hosts.splice(0)) await h.close().catch(() => undefined);
  for (const w of worlds.splice(0)) await w.close().catch(() => undefined);
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (HOME) rmSync(HOME, { recursive: true, force: true });
});

// ---- Test packages.
export interface PackageOptions {
  /** Fields merged over the fixture's deepbuild.json, before the digest is stamped. */
  manifest?: Record<string, unknown>;
  /** Files written over the copy, by relative path. */
  files?: Record<string, string>;
}
const readManifest = (dir: string): Record<string, unknown> => JSON.parse(readFileSync(join(dir, 'deepbuild.json'), 'utf8')) as Record<string, unknown>;
const writeManifest = (dir: string, manifest: Record<string, unknown>): void => writeFileSync(join(dir, 'deepbuild.json'), `${JSON.stringify(manifest, null, 2)}\n`);
/** Sets the manifest's `digest` (the envelope's) to the host's `packageDigest` of the folder, as a package's build does. */
export async function stamp(dir: string): Promise<string> {
  const { packageDigest } = await host();
  const manifest = readManifest(dir);
  manifest.digest = packageDigest(dir);
  writeManifest(dir, manifest);
  expect(packageDigest(dir), 'writing packageDigest into deepbuild.json\'s digest doesn\'t change it (#348)').toBe(manifest.digest);
  return manifest.digest as string;
}
/**
 * A test package in a temp folder: `fixtures/<name>` copied with each `*.fixture` file renamed without that suffix
 * (so neither this suite's Vitest nor its type check picks the packages' code up), the manifest fields and files
 * written over it, and its envelope digest stamped.
 */
export async function pkg(name: string, options: PackageOptions = {}): Promise<string> {
  const dir = tempDir(`pkg-${name}`);
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.endsWith('.fixture')) renameSync(join(dir, entry.name), join(dir, entry.name.slice(0, -'.fixture'.length)));
  }
  for (const [path, text] of Object.entries(options.files ?? {})) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  writeManifest(dir, { ...readManifest(dir), ...(options.manifest ?? {}) });
  await stamp(dir);
  return dir;
}
/** The envelope digest a package's manifest carries. */
export const envelopeDigest = (dir: string): string => readManifest(dir).digest as string;
/** The release entry for a package folder: DeepBuild's signed release listing it. */
export async function releaseEntry(dir: string): Promise<ReleaseEntry> {
  const { packageDigest } = await host();
  const m = readManifest(dir) as { id: string; version: string };
  return { id: m.id, version: m.version, digest: packageDigest(dir) };
}
export async function installAndLoad(h: ExtensionHost, dir: string): Promise<void> {
  const p = await h.install({ from: dir, builtBy: null });
  const c = await h.check(p);
  expect(c.passed, `${p.id} passes conformance: ${JSON.stringify(c)}`).toBe(true);
  const load = await h.load(p);
  expect(load.status, `${p.id} loads: ${JSON.stringify(load)}`).toBe('loaded');
}
/** The installer's refusal of a package folder, as its error's message; null when it installed the package. */
export async function installError(h: ExtensionHost, dir: string): Promise<string | null> {
  try {
    await h.install({ from: dir, builtBy: null });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
/** The installed packages, as id@version. */
export const installedAs = async (h: ExtensionHost): Promise<string[]> => (await h.installed()).map((p) => `${p.id}@${p.version}`);
export const installedIds = async (h: ExtensionHost): Promise<string[]> => (await h.installed()).map((p) => p.id);

// ---- Publisher keys and signatures (README, The surface under test: the signed envelope).
export interface PublisherKey { key: string; privateKey: KeyObject }
/** A new Ed25519 publisher key: `ed25519:<64 lower-case hex of the raw 32-byte public key>`. */
export function newKey(): PublisherKey {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return { key: `ed25519:${raw.toString('hex')}`, privateKey };
}
/** The key's hex, which a refusal naming the key carries. */
export const keyHex = (key: string): string => key.slice('ed25519:'.length);
/**
 * A signed test package: the manifest names `key` as its `publisher_key`, its envelope digest is stamped, and its
 * `signature` is `signer`'s Ed25519 signature, in lower-case hex, of the RFC 8785 bytes of its package.envelope@1
 * fields `{ id, version, digest, publisher_key }`. Signed by another key than the one it names, it doesn't verify.
 */
export async function signedPkg(name: string, options: { manifest: Record<string, unknown>; key: string; signer: KeyObject }): Promise<string> {
  const dir = await pkg(name, { manifest: { ...options.manifest, publisher_key: options.key } });
  const { canonicalize } = await contracts();
  const { packageDigest } = await host();
  const m = readManifest(dir) as { id: string; version: string; digest: string; publisher_key: string } & Record<string, unknown>;
  const envelope = { id: m.id, version: m.version, digest: m.digest, publisher_key: m.publisher_key };
  m.signature = sign(null, canonicalize(envelope), options.signer).toString('hex');
  writeManifest(dir, m);
  expect(packageDigest(dir), 'writing the signature into deepbuild.json leaves packageDigest as it was, as writing the digest does (README: the signed envelope)').toBe(m.digest);
  return dir;
}

// ---- Check runs.
export const SPEC = (kind: string): CheckSpec => ({ kind, runner: 'judge', inputs: [], depth: 'unit', oracle: 'code', contract: null });
/** The kit's known-pass suite, copied, is the checkout a journey runs in. */
export const KNOWN_PASS = join(REPO, 'packages/conformance/fixtures/check-kind/known-pass');
export const COMMAND_SPEC = (kind: string): CheckSpec => ({ kind, runner: 'node --test --test-isolation=none spec/*.test.mjs', inputs: ['src/cart.mjs', 'spec/cart.test.mjs'], depth: 'unit', oracle: 'code', contract: null });
export async function runKnownPass(h: ExtensionHost, kind: string): Promise<CheckResult> {
  const checkout = tempDir('checkout');
  cpSync(KNOWN_PASS, checkout, { recursive: true });
  return h.runCheck(kind, COMMAND_SPEC(kind), { checkout, deadline: 60_000 });
}

// ---- The guide's examples, built as the guide's reader builds them (README, Readings: build).
export type ExampleName = 'typescript' | 'json-rpc';
/** example.json in each example's folder: the run the guide shows, as data. */
export interface ExampleRun {
  /** The check kind the example registers, one its manifest's `checks` lists. */
  check: string;
  /** Each run: the spec passed to the check, and what the check answers. */
  runs: { spec: CheckSpec; expect: { outcome: CheckResult['outcome']; testsRun: number } }[];
}
/** An interpreter's real path on this machine's PATH, for a JSON-RPC package's first line. */
function onPath(name: string): string {
  for (const dir of (process.env.PATH ?? '').split(':').filter((d) => d.startsWith('/'))) {
    const candidate = join(dir, name);
    if (existsSync(candidate) && statSync(candidate).isFile()) return realpathSync(candidate);
  }
  throw Error(`BLOCKED: the JSON-RPC example's interpreter ${name} isn't on PATH, so it can't run on this machine`);
}
/**
 * The example folder `docs/extension-guide/<name>` built into a package in a temp folder: copied, a `main`'s
 * `#!/usr/bin/env <interpreter>` line pointed at that interpreter's real path here and made executable, and the
 * envelope digest stamped.
 */
export async function buildExample(name: ExampleName): Promise<string> {
  const source = join(EXAMPLES, name);
  expect(existsSync(join(source, 'deepbuild.json')), `the guide's ${name} example is a package folder with a deepbuild.json at ${source}`).toBe(true);
  const dir = tempDir(`example-${name}`);
  cpSync(source, dir, { recursive: true });
  const main = join(dir, 'main');
  if (existsSync(main)) {
    const lines = readFileSync(main, 'utf8').split('\n');
    const env = /^#!\/usr\/bin\/env\s+(\S+)\s*$/.exec(lines[0] ?? '');
    expect(env || lines[0]?.startsWith('#!/'), `${name}'s main starts with #!/usr/bin/env <interpreter> or an absolute #! line: ${lines[0]}`).toBeTruthy();
    if (env) lines[0] = `#!${onPath(env[1]!)}`;
    writeFileSync(main, lines.join('\n'));
    chmodSync(main, 0o755);
  }
  await stamp(dir);
  return dir;
}
export const exampleRun = (dir: string): ExampleRun => JSON.parse(readFileSync(join(dir, 'example.json'), 'utf8')) as ExampleRun;

// ---- The guide's drift test, on copies of the contract.
export const readApi = (): ApiEntry[] => JSON.parse(readFileSync(API_FILE, 'utf8')) as ApiEntry[];
export const readTable = (): HubSlot[] => JSON.parse(readFileSync(TABLE_FILE, 'utf8')) as HubSlot[];
export const ZERO = `d1:${'0'.repeat(64)}`;
export interface Checked { status: number | null; stdout: string; stderr: string; fails: string[] }
/** `node scripts/guide.mjs --check`, on the published contract or on temp copies of it: its status and its `FAIL guide` lines. */
export function runGuideCheck(contract?: { api: readonly ApiEntry[]; table: readonly HubSlot[] }): Checked {
  expect(existsSync(GUIDE_SCRIPT), `the guide's generator and drift test is ${GUIDE_SCRIPT}`).toBe(true);
  const args = [GUIDE_SCRIPT, '--check'];
  if (contract) {
    const dir = tempDir('contract');
    writeFileSync(join(dir, 'extension-api.json'), JSON.stringify(contract.api, null, 2));
    writeFileSync(join(dir, 'hub-slots.json'), JSON.stringify(contract.table, null, 2));
    args.push('--api', join(dir, 'extension-api.json'), '--table', join(dir, 'hub-slots.json'));
  }
  const r = spawnSync(NODE, args, {
    cwd: REPO, encoding: 'utf8', timeout: 300_000, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', NO_COLOR: '1' },
  });
  const stdout = r.stdout ?? '';
  return { status: r.status, stdout, stderr: r.stderr ?? '', fails: stdout.split('\n').filter((line) => line.startsWith('FAIL guide')) };
}
