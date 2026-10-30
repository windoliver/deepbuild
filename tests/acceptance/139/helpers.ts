// Test-side tools for the #139 acceptance tests: temp folders, the contract step run on a scratch tree, scratch-tree
// edits (a planted removal, a reshaped method, a hub slot without `since`), the previous release's record, the host
// world for the install tests, and break files. Nothing here stands in for the surface: every test reaches it through
// `scripts/contract-diff.mjs`, `scripts/api-surface.mjs`, `scripts/lanes.mjs`, the published contract files, the
// extension host's and the hub's public entries, `deep install` and `deep doctor` (README, The surface under test).
//
// Safety: every folder is under /tmp/dh139-* (real paths); HOME is a temp folder for this process and every child;
// the agent's own CLAUDE_* and DEEP_* variables are removed first; no test touches the real ~/.deepbuild, ~/.claude
// or ~/.codex; the only processes started are the ones a test starts and stops by PID; no network.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import { shownPlanHash, withPlans } from '../plans.ts';
import type { Asks } from '../../../packages/asks/src/index.ts';
import { d1Digest } from '../../../packages/contracts/src/index.ts';
import type { ExtensionHost, Installed, Plant } from '../../../packages/extension-host/src/index.ts';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { openRecord, type Connection, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const NODE = process.execPath;
export const STEP = join(REPO, 'scripts/contract-diff.mjs');
export const API_STEP = join(REPO, 'scripts/api-surface.mjs');
export const DAY = 86_400_000;

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key === 'AI_AGENT') delete process.env[key];
let HOME: string | undefined;
export function home(): string {
  if (!HOME || !existsSync(HOME)) {
    HOME = realpathSync(mkdtempSync('/tmp/dh139-home-'));
    process.env.HOME = HOME;
  }
  return HOME;
}
home();

const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh139-${tag}-`));
  made.push(dir);
  return dir;
}
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const message = (e: unknown): string => String((e as Error)?.message ?? e);
export const read = (path: string): string => readFileSync(path, 'utf8');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;
export const readJson = (path: string): Json => JSON.parse(read(path));
export const writeJson = (path: string, value: unknown): void => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); };

// ---- Running a program: this process's node, a clean environment, a temp HOME, a time limit.
export interface Ran { code: number | null; stdout: string; stderr: string; out: string; timedOut: boolean }
export function childEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('DEEP_') && !key.startsWith('CLAUDE') && key !== 'NODE_OPTIONS') env[key] = value;
  env.HOME = home();
  env.PATH = `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
  for (const [key, value] of Object.entries(extra)) { if (value === undefined) delete env[key]; else env[key] = value; }
  return env;
}
export function run(command: string, args: readonly string[], o: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number | undefined } = {}): Ran {
  const r = spawnSync(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? childEnv(), encoding: 'utf8', timeout: o.timeoutMs ?? 300_000, maxBuffer: 1 << 28 });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', out: `${r.stdout ?? ''}${r.stderr ?? ''}`, timedOut: r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' };
}
export const shown = (r: Ran): string => `exit ${r.code}${r.timedOut ? ' (killed at the timeout)' : ''}, output ${JSON.stringify(r.out.slice(-2500))}`;

// ---- The contract step (README: the surface under test).
/** The wrong programs the step takes by name, in `DEEP_CONTRACTS_PLANT`. */
export type StepPlant = 'diff-preview' | 'six-kinds-only' | 'pass-every-additive' | 'any-break-file' | 'report-only' | 'unsupported-shim';
export function needStep(script = STEP): void {
  if (!existsSync(script)) throw Error(`${script.slice(REPO.length)} does not exist: the surface this criterion is tested through is not built (README, The surface under test)`);
}
/** `node scripts/contract-diff.mjs <args> --root <tree>`, with a wrong program selected when `plant` is given. */
export function step(args: readonly string[], o: { root?: string; plant?: StepPlant | string | undefined; env?: Record<string, string | undefined>; timeoutMs?: number } = {}): Ran {
  needStep();
  return run(NODE, [STEP, ...args, ...(o.root ? ['--root', o.root] : [])], { env: childEnv({ DEEP_CONTRACTS_PLANT: o.plant, ...o.env }), timeoutMs: o.timeoutMs });
}
/** The step's FAIL lines: `FAIL contracts: <entry>: <reason>`. */
export const failLines = (r: Ran): string[] => r.out.split('\n').filter((l) => l.startsWith('FAIL contracts:'));
/** The diff lines under a failure, each starting `diff: ` at the line's start; a break file quotes one verbatim. */
export const diffLines = (r: Ran): string[] => r.out.split('\n').filter((l) => l.startsWith('diff: '));
type Part = string | RegExp;
const has = (line: string, part: Part): boolean => (typeof part === 'string' ? line.includes(part) : part.test(line));
/** Asserts the step failed (exit 1) with one FAIL line holding every part: the entry and the field, the method and its release… */
export function expectFailNaming(r: Ran, what: string, ...parts: Part[]): void {
  expect(r.code, `${what}: the step exits 1\n${shown(r)}`).toBe(1);
  const lines = failLines(r);
  expect(lines.some((l) => parts.every((p) => has(l, p))), `${what}: a FAIL contracts line names ${parts.map(String).join(' and ')}; the FAIL lines are ${JSON.stringify(lines)}\n${shown(r)}`).toBe(true);
}
export function expectPass(r: Ran, what: string): void {
  expect(r.code, `${what}: the step exits 0\n${shown(r)}`).toBe(0);
  expect(failLines(r), `${what}: no FAIL contracts line`).toEqual([]);
  expect(/^PASS contracts/m.test(r.out), `${what}: a PASS contracts line\n${shown(r)}`).toBe(true);
}

// ---- Scratch trees: a copy of the repo's contract data the step is pointed at with --root.
const DATA = ['extension-api.json', 'hub-slots.json', 'digests.json', 'schemas', 'slots', 'rpc-methods.json', 'canvas-registries.json'];
export interface Tree { root: string }
/** A scratch tree: packages/contracts' published data and the repo's contracts/ folder (shipped pieces, corpus, releases and breaks it has). */
export function scratch(tag = 'tree'): Tree {
  const root = tempDir(tag);
  for (const name of DATA) {
    const from = join(REPO, 'packages/contracts', name);
    if (existsSync(from)) cpSync(from, join(root, 'packages/contracts', name), { recursive: true });
  }
  if (existsSync(join(REPO, 'contracts'))) cpSync(join(REPO, 'contracts'), join(root, 'contracts'), { recursive: true });
  for (const sub of ['releases', 'breaks']) rmSync(join(root, 'contracts', sub), { recursive: true, force: true });
  mkdirSync(join(root, 'contracts/releases'), { recursive: true });
  if (!existsSync(join(root, 'contracts/shipped.json'))) writeJson(join(root, 'contracts/shipped.json'), { pieces: [] });
  return { root };
}
export const at = (t: Tree, rel: string): string => join(t.root, rel);
/** A copy of a tree, with what it holds (a recorded release among it). */
export function fork(t: Tree, tag = 'fork'): Tree {
  const root = tempDir(tag);
  cpSync(t.root, root, { recursive: true });
  return { root };
}
export const API_FILE = 'packages/contracts/extension-api.json';
export const SLOTS_FILE = 'packages/contracts/hub-slots.json';
export const REGISTRIES_FILE = 'packages/contracts/canvas-registries.json';
export const RPC_FILE = 'packages/contracts/rpc-methods.json';
export const SHIPPED_FILE = 'contracts/shipped.json';
export function edit(t: Tree, rel: string, fn: (value: Json) => void): void {
  const path = at(t, rel);
  const value = readJson(path);
  fn(value);
  writeJson(path, value);
}
export const schemaFile = (name: string): string => `packages/contracts/schemas/${name}.json`;
/** Annotations a published schema carries for its history: `x-since`, `x-stability`, `x-tracking`, `x-deprecated_since`, `x-replaced_by`. */
export interface SchemaMeta { since?: string | null; stability?: 'stable' | 'preview'; tracking?: string; deprecated_since?: string; replaced_by?: string }
export const OBJECT = { type: 'object', properties: { id: { type: 'string', minLength: 1 } }, required: ['id'], additionalProperties: false };
/** Adds a schema `<name>.json` to the tree with its history annotations, and its frozen digest to digests.json. */
export function addSchema(t: Tree, name: string, body: Json = OBJECT, meta: SchemaMeta = {}): void {
  const schema = {
    title: name, description: `A scratch kind, ${name}.`, ...body,
    ...(meta.since === null ? {} : { 'x-since': meta.since ?? 'R1' }), 'x-stability': meta.stability ?? 'stable',
    ...(meta.tracking ? { 'x-tracking': meta.tracking } : {}), ...(meta.deprecated_since ? { 'x-deprecated_since': meta.deprecated_since } : {}), ...(meta.replaced_by ? { 'x-replaced_by': meta.replaced_by } : {}),
  };
  writeJson(at(t, schemaFile(name)), schema);
  edit(t, 'packages/contracts/digests.json', (d) => { d[name] = d1Digest(schema); });
}

/** One published extension API entry, with its shape's `d1:` digest. */
export interface ApiOptions { since?: string; stability?: 'stable' | 'preview'; tracking?: string; params?: Json; deprecated_since?: string; replaced_by?: string }
export const PARAMS = { type: 'object', properties: { type: { type: 'string', minLength: 1 } }, required: ['type'], additionalProperties: false };
export function apiEntry(method: string, o: ApiOptions = {}): Json {
  const params = o.params ?? PARAMS;
  const stability = o.stability ?? 'stable';
  return {
    method, variants: null, since: o.since ?? 'R1', stability, ...(stability === 'preview' ? { tracking: o.tracking ?? '#139' } : {}),
    ...(o.deprecated_since ? { deprecated_since: o.deprecated_since } : {}), ...(o.replaced_by ? { replaced_by: o.replaced_by } : {}),
    digest: d1Digest(params), params,
  };
}
/** Adds an API entry; a stable one is also called by a shipped piece of the candidate, unless `orphan`. */
export function addApi(t: Tree, entry: Json, o: { orphan?: boolean } = {}): void {
  edit(t, API_FILE, (api) => { api.push(entry); });
  if (entry.stability === 'stable' && !o.orphan) edit(t, SHIPPED_FILE, (s) => { s.pieces.push({ piece: `scratch/${entry.method}`, calls: [entry.method] }); });
}
/** Reshapes an API entry's params, with its digest following. */
export function reshapeApi(t: Tree, method: string, fn: (params: Json) => void): void {
  edit(t, API_FILE, (api) => {
    const e = api.find((x: Json) => x.method === method);
    if (!e) throw Error(`the scratch tree has no ${method}`);
    fn(e.params);
    e.digest = d1Digest(e.params);
  });
}
export function removeApi(t: Tree, method: string): void {
  edit(t, API_FILE, (api) => { api.splice(api.findIndex((x: Json) => x.method === method), 1); });
  edit(t, SHIPPED_FILE, (s) => { for (const p of s.pieces) p.calls = p.calls.filter((c: string) => c !== method); });
}
/** The previous release's record, written by the step's own `record` from the tree as it is now (README: the previous release). */
export function record(t: Tree, release: string): Json {
  const r = step(['record', '--release', release], { root: t.root });
  expect(r.code, `record ${release} on the unmodified scratch tree\n${shown(r)}`).toBe(0);
  const file = at(t, `contracts/releases/${release}.json`);
  expect(existsSync(file), `record ${release} writes contracts/releases/${release}.json`).toBe(true);
  return readJson(file);
}
export const check = (t: Tree, release: string, o: { plant?: StepPlant | string | undefined; args?: string[] } = {}): Ran => step(['check', '--release', release, ...(o.args ?? [])], { root: t.root, plant: o.plant });

/** A break file `contracts/breaks/<from>_<to>/<issue>.txt`: the quoted diff line and the workaround. */
export function breakFile(t: Tree, from: string, to: string, issue: string, quoted: string[], workaround = 'Call deep.registerCheck with the new field instead.'): string {
  const path = at(t, `contracts/breaks/${from}_${to}/${issue}.txt`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${quoted.join('\n')}\nworkaround: ${workaround}\n`);
  return path;
}
/** The first release's two-step scene most tests start from: R1 recorded, then a stable method `deep.arrived` added and R2 recorded. */
export function releasesR1R2(): Tree {
  const t = scratch('rel');
  record(t, 'R1');
  addApi(t, apiEntry('deep.arrived', { since: 'R2' }));
  record(t, 'R2');
  return t;
}

// ---- Packages and the host world, for the install tests.
export interface World { dir: string; home: string; record: RecordStore; asks: Asks; sup: Supervisor; close(): Promise<void> }
const worlds: World[] = [];
const hosts: ExtensionHost[] = [];
export const host = () => import('../../../packages/extension-host/src/index.ts');
export const YOU: Connection = { writer: 'app', actor: 'you', scope: 'you' };
export async function openWorld(): Promise<World> {
  const dir = tempDir('world');
  const deepHome = join(dir, 'deepbuild');
  mkdirSync(deepHome, { recursive: true });
  const rec = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = withPlans(await openAsks({ record: rec, now: Date.now, deliver: () => undefined }));
  const sup = await openSupervisor({ record: rec, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } } });
  let closed = false;
  const w: World = { dir, home: deepHome, record: rec, asks, sup, close: async () => { if (closed) return; closed = true; await sup.close(); await rec.close(); } };
  worlds.push(w);
  return w;
}
export interface HostOptions { release?: { id: string; version: string; digest: string }[]; plant?: Plant | string; api?: unknown[] }
export async function openHost(w: World, o: HostOptions = {}): Promise<ExtensionHost> {
  const { openExtensionHost } = await host();
  const options = { record: w.record, asks: w.asks, supervisor: w.sup, trust: await (await host()).openTrust({ record: w.record, now: Date.now }), home: w.home, release: o.release ?? [], now: Date.now, ...(o.plant ? { plant: o.plant } : {}), ...(o.api ? { api: o.api } : {}) };
  const h = await openExtensionHost(options as unknown as Parameters<typeof openExtensionHost>[0]);
  hosts.push(h);
  await h.ready();
  return h;
}
/** A package in a temp folder: deepbuild.json (fields merged over id, version and digest) and an index.ts, the digest stamped. */
export async function makePackage(o: { id: string; version?: string; manifest?: Record<string, unknown>; index: string }): Promise<string> {
  const dir = tempDir(`pkg-${o.id.replace('/', '-')}`);
  writeFileSync(join(dir, 'index.ts'), o.index);
  const manifest: Json = { id: o.id, version: o.version ?? '1.0.0', digest: `d1:${'0'.repeat(64)}`, ...(o.manifest ?? {}) };
  writeJson(join(dir, 'deepbuild.json'), manifest);
  const { packageDigest } = await host();
  manifest.digest = packageDigest(dir);
  writeJson(join(dir, 'deepbuild.json'), manifest);
  expect(packageDigest(dir), 'stamping the digest into deepbuild.json leaves it as it is (#348)').toBe(manifest.digest);
  return dir;
}
export async function releaseOf(...dirs: string[]): Promise<{ id: string; version: string; digest: string }[]> {
  const { packageDigest } = await host();
  return dirs.map((dir) => { const m = readJson(join(dir, 'deepbuild.json')); return { id: m.id, version: m.version, digest: packageDigest(dir) }; });
}
/** What admitting a package came to: the first refusal in install, check and load, or that it loaded. */
export async function admit(h: ExtensionHost, dir: string): Promise<{ ok: true; installed: Installed } | { ok: false; reason: string }> {
  let p: Installed;
  try { p = await h.install({ from: dir, builtBy: null }); } catch (e) { return { ok: false, reason: message(e) }; }
  try {
    const c = await h.check(p);
    if (!c.passed) return { ok: false, reason: c.reasons.join('; ') };
    const l = await h.load(p);
    if (l.status !== 'loaded') return { ok: false, reason: l.reason };
  } catch (e) { return { ok: false, reason: message(e) }; }
  return { ok: true, installed: p };
}
export async function waitUntil<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, ms: number, what: string): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > end) throw Error(`timed out after ${ms} ms waiting for ${what}`);
    await sleep(50);
  }
}
export const approveCard = async (w: World, ask: string): Promise<void> => {
  const card = await w.asks.card(ask);
  const option = card.options.find((o: { decision?: string }) => o.decision === 'allow') ?? card.options[0]!;
  await w.asks.answer(YOU, ask, { option: option.id, plan_hash: await shownPlanHash(w.asks, ask), token: `click-${Date.now()}` });
};

afterAll(async () => {
  for (const h of hosts.splice(0)) await h.close().catch(() => undefined);
  for (const w of worlds.splice(0)) await w.close().catch(() => undefined);
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (HOME) rmSync(HOME, { recursive: true, force: true });
}, 60_000);
