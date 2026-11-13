// Test-side tools for the #1720 acceptance tests: a real hub (`deep hub run`) in a temporary home, a Claude Code session
// bound to it through its hooks (#26's agent stand-in, whose `deep mcp` is its own child), deep_show and deep_kinds called
// over MCP, `deep-show run` for criterion 2's reference answer, the hub's pack store read for criterion 4's count, and
// `deep doctor`. For criterion 3's plant, the installed tree of #41 (`scripts/install-prefix.mjs`), the hub's release,
// with a planted pack folder put beside the first-party packs it ships. Nothing here stands in for the hub, `deep mcp`,
// the canvas core or `deep doctor`. Processes are stopped by PID; folders are /tmp/dh1720-* (a socket path must fit in
// 104 bytes) and every process runs with HOME there, so the real ~/.deepbuild, ~/.claude and ~/.codex are never touched.
// Nothing is written into the checkout's own packs/.

import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect } from 'vitest';
import * as t26 from '../26/helpers.ts';

export { t26 };
export type Line = t26.Line;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
const NODE = process.execPath;
/** The checkout's built CLI: `deep hub run`, `deep mcp`, `deep doctor`. */
export const CHECKOUT_DEEP = t26.CLI;
/** The checkout's first-party packs: every folder of `packs/` with a pack.json. */
export const CHECKOUT_PACKS = join(REPO, 'packs');
/** The design's one-prompt scene, `packs/examples/castle.json`. */
export const CASTLE = join(REPO, 'packs', 'examples', 'castle.json');
/** The planted pack folder of criterion 3: its one recipe's input defaults outside its own range. */
export const PLANT_NAME = 'plant1720';
const PLANT = join(HERE, 'fixtures', `${PLANT_NAME}-1.0.0`);
/** The first-party packs' owner: the castle names `deepbuild/composites@1.0.0`, the familiar pack is `deepbuild/familiar`. */
export const OWNER = 'deepbuild';

// ---------------------------------------------------------------------------------------------------
// Folders and processes

const made: string[] = [];
export function tempDir(tag = ''): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh1720-${tag}`));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
export const own = (pid: number | undefined): void => { if (pid) { owned.add(pid); t26.own(pid); } };
/** Stops every process this suite started, by PID (SIGTERM, then SIGKILL after 3 s), and removes its folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...owned].some(t26.alive) && Date.now() < deadline) await t26.sleep(50);
  for (const pid of owned) if (t26.alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  await t26.cleanup();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------------------------------
// The canvas core the checkout's hub runs, and the deep-hook it needs to start, built once per file

/**
 * Builds `deep-show` and `deep-hook` once per file (`cargo build --locked --bin <each>`: the hub refuses to start
 * without a deep-hook); the check that fails a test, naming the build, when it didn't build.
 */
export function useCanvasCore(): () => void {
  let error = 'not built';
  beforeAll(() => {
    const env = { ...process.env };
    // The hub looks for the canvas core under the checkout's own target folder, so it is built there.
    delete env['CARGO_TARGET_DIR'];
    // One cargo run per binary, so neither changes the features the other is built with.
    for (const bin of ['deep-show', 'deep-hook']) {
      const run = spawnSync('cargo', ['build', '--locked', '--bin', bin], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
      error = run.error ? `cargo could not run: ${run.error.message}` : run.status === 0 ? '' : `cargo build --bin ${bin} failed:\n${run.stderr.slice(-4000)}`;
      if (error) break;
    }
  }, 3_600_000);
  return () => expect(error, 'the canvas core and deep-hook build: cargo build --locked --bin deep-show, then --bin deep-hook').toBe('');
}
/** A checkout's build as the hub finds it (packages/hub/src/canvas.ts `canvasCore`, paths.ts `deepHook`): the newer of target/release and target/debug. */
function checkoutBuild(name: string): string {
  const built = ['release', 'debug'].map((p) => join(REPO, 'target', p, name)).filter((p) => existsSync(p));
  expect(built.length, `BLOCKED: no ${name} is built under ${join(REPO, 'target')}`).toBeGreaterThan(0);
  return built.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]!;
}
/** The canvas core the checkout's hub runs. */
export const checkoutCore = (): string => checkoutBuild('deep-show');

// ---------------------------------------------------------------------------------------------------
// The first-party packs: every folder under a packs/ with a pack.json

export interface FirstParty { folder: string; dir: string; name: string; version: string; id: string; ref: string }
/** Each folder of `root` holding a pack.json, with the name and version that pack.json gives and its `deepbuild/` ID. */
export function firstParty(root: string): FirstParty[] {
  return readdirSync(root).sort().filter((folder) => existsSync(join(root, folder, 'pack.json'))).map((folder) => {
    const manifest = JSON.parse(readFileSync(join(root, folder, 'pack.json'), 'utf8')) as { name?: unknown; version?: unknown };
    const [name, version] = [String(manifest.name), String(manifest.version)];
    return { folder, dir: join(root, folder), name, version, id: `${OWNER}/${name}`, ref: `${OWNER}/${name}@${version}` };
  });
}

// ---------------------------------------------------------------------------------------------------
// The hub, a session bound by its hooks, and its deep mcp

/** `deep hub run` from `deep` (the checkout's CLI or an installed tree's bin/deep) with HOME the test's home. */
export async function startHub(deep: string, home: string): Promise<t26.Hub> {
  const confirm = join(dirname(home), 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const child = spawn(NODE, [deep, 'hub', 'run'], { cwd: REPO, env: t26.childEnv(home, { DEEP_HUB_TEST_CONFIRM: confirm }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const ready = await new Promise<boolean>((resolve) => {
    let first = '';
    const timer = setTimeout(() => resolve(false), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); try { resolve((JSON.parse(first.split('\n')[0]!) as Line).ready === true); } catch { resolve(false); } }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!ready) throw Error(`BLOCKED: the hub (${deep}) didn't start: ${out.slice(0, 2000)}`);
  return { pid: child.pid!, home, socket: join(t26.rootOf(home), 'hub.sock'), child, output: () => out };
}

export interface Live { tmp: string; home: string; hub: t26.Hub; session: t26.Session; agent: t26.Agent }
/**
 * A hub from `deep` in a fresh home; a Claude Code session in a worktree, established through its hooks (SessionStart,
 * UserPromptSubmit, PreToolUse, each from a hook process the agent started) and recorded by the hub; the agent's own
 * `deep mcp` (the checkout's, #26's stand-in starts it as its child) initialized.
 */
export async function openSession(deep: string): Promise<Live> {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  mkdirSync(home);
  const wt = t26.makeWorktree(join(tmp, 'work'));
  const hub = await startHub(deep, home);
  const agent = t26.Agent.start(home, wt.path);
  own(agent.pid);
  const session = agent.session(wt.path, 'draw the castle');
  await agent.establish(hub, session, 'draw the castle');
  const started = await t26.eventMatching(hub, (e) => e.kind === 'session.start' && e.session === session.id, 10_000);
  if (!started) throw Error(`BLOCKED: the hub recorded no session.start for the session its hooks started (${session.id})`);
  await t26.initialize(agent);
  return { tmp, home, hub, session, agent };
}

const text = (v: unknown, n = 300): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
/** A tool result that isn't the tool's value: a JSON-RPC error, or isError with its code, path and remediation. */
function notAnswered(name: string, o: t26.Outcome): string | undefined {
  if (o.protocolError) return `${name}: deep mcp answered a JSON-RPC error, not the tool's reply: ${text(o.value, 600)}`;
  if (o.isError) {
    const e = (o.value ?? {}) as Line;
    return `${name}: answered isError: ${String(e.code)} at ${String(e.path)}: ${String(e.remediation ?? e.message ?? text(e))}`;
  }
  if (typeof o.value !== 'object' || o.value === null || Array.isArray(o.value)) return `${name}: the reply is no JSON object: ${text(o.value)}`;
  return undefined;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 1: the castle through deep_show

/**
 * `packs/examples/castle.json`, as it is, sent whole through the agent's `deep mcp` as deep_show's `document` (its JSON
 * text, as the tool's schema types it) for a fresh document ID; every other field left out (null, #26).
 */
export function showCastle(live: Live): Promise<t26.Outcome> {
  return t26.callTool(live.agent, 'deep_show', { doc: t26.ulid(), document: readFileSync(CASTLE, 'utf8') }, 600_000);
}

const PACK_ID = /[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_-]*@\d+\.\d+\.\d+/g;
/** Every object and string in a JSON value, depth first. */
function walk(v: unknown, visit: (node: unknown) => void): void {
  visit(v);
  if (Array.isArray(v)) for (const x of v) walk(x, visit);
  else if (typeof v === 'object' && v !== null) for (const x of Object.values(v)) walk(x, visit);
}
/**
 * Criterion 1's check: the castle is presented, with no `pack_missing` issue and no `unknown_kind` notice anywhere in
 * the reply. A pack_missing is named with the pack IDs its text holds, so the base's refusal names the pack.
 */
export function castleFailures(o: t26.Outcome): string[] {
  const name = 'deep_show castle.json';
  const unanswered = notAnswered(name, o);
  if (unanswered) return [unanswered];
  const reply = o.value as Line;
  const failures: string[] = [];
  const missing = new Set<string>();
  let unknown = 0;
  const unknownIds = new Set<string>();
  walk(reply, (node) => {
    if (typeof node === 'string' && node.includes('pack_missing')) for (const id of node.match(PACK_ID) ?? []) missing.add(id);
    if (typeof node === 'object' && node !== null && !Array.isArray(node)) {
      const n = node as Line;
      if (n.code === 'pack_missing') {
        const named = JSON.stringify(n).match(PACK_ID) ?? [];
        if (named.length) for (const id of named) missing.add(id);
        else missing.add(`${String(n.pack ?? '?')}@${String(n.version ?? '?')}`);
      }
      if (n.code === 'unknown_kind') {
        unknown += 1;
        for (const id of Array.isArray(n.ids) ? n.ids : []) unknownIds.add(String(id));
      }
    }
  });
  if (reply.outcome !== 'presented') failures.push(`${name}: outcome ${String(reply.outcome)}, not presented (${text({ status: reply.status, code: reply.code, cause: reply.cause, reason: reply.reason })})`);
  const sawMissing = text(reply, 1 << 20).includes('pack_missing');
  if (sawMissing) failures.push(`${name}: refused with pack_missing, naming ${missing.size ? [...missing].sort().join(', ') : 'no pack ID'}`);
  if (unknown) failures.push(`${name}: ${unknown} unknown_kind notice(s), on ${[...unknownIds].sort().join(', ') || 'no id'}`);
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// Criteria 2 to 4: deep_kinds through deep mcp, and `deep-show run` for the reference answer

/** One deep_kinds call through a `deep mcp`, with only the fields given (a field left out reads as null, #26). */
export const kindsOverMcp = (m: t26.Mcp, args: Line): Promise<t26.Outcome> => t26.callTool(m, 'deep_kinds', args, 600_000);

/** `deep-show run` of one scenario: its replies, in call order. */
export function onRun(bin: string, scenario: Line): JsonObject[] {
  const evidence = tempDir('ev-');
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify({ evidence, ...scenario })}\n`, encoding: 'utf8', maxBuffer: 1 << 30, timeout: 600_000, killSignal: 'SIGKILL' });
  if (r.error) throw Error(`${bin} run: ${r.error.message}`);
  expect(r.status, `${bin} run exits 0; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const out = JSON.parse(r.stdout.trim().split('\n')[0]!) as JsonObject;
  expect(out['ok'], `deep-show run took the scenario: ${JSON.stringify(out).slice(0, 600)}`).toBe(true);
  return out['replies'] as JsonObject[];
}

/** The familiar pack among `packs` (its pack.json's name is `familiar`), and its alias of `word`. */
export function familiar(word: string): { pack: FirstParty; alias: Line } {
  const pack = firstParty(CHECKOUT_PACKS).find((p) => p.name === 'familiar');
  expect(pack, `the checkout ships the familiar pack under ${CHECKOUT_PACKS}`).toBeDefined();
  const alias = (JSON.parse(readFileSync(join(pack!.dir, 'pack.json'), 'utf8')) as { aliases?: Record<string, Line> }).aliases?.[word];
  expect(alias, `the familiar pack maps ${word}`).toBeDefined();
  return { pack: pack!, alias: alias! };
}

/** `deep-show run`'s answer to `deep_kinds word <word>` with the familiar pack installed in its store (#306's `packs`). */
export function wordOnRun(bin: string, word: string): JsonObject {
  const { pack } = familiar(word);
  const [reply] = onRun(bin, { packs: [{ id: pack.id, dir: pack.dir }], calls: [{ call: 'deep_kinds', op: 'word', word }] });
  expect(reply?.['error'], `deep-show run answers deep_kinds word ${word} (the reference): ${JSON.stringify(reply).slice(0, 600)}`).toBeUndefined();
  return reply!;
}

/**
 * Criterion 2's check: the answer through `deep mcp` is `familiar.box@1` with the familiar pack's own conversion text,
 * and its JSON text equals `deep-show run`'s answer's, byte for byte.
 */
export function wordFailures(word: string, got: t26.Outcome, want: JsonObject): string[] {
  const name = `deep_kinds word ${word}`;
  const unanswered = notAnswered(name, got);
  if (unanswered) return [unanswered];
  const { alias } = familiar(word);
  const value = got.value as Line;
  const failures: string[] = [];
  if (value.target !== 'familiar.box@1') failures.push(`${name}: target ${text(value.target)}, not familiar.box@1 (the reply: ${text(value, 400)})`);
  if (value.conversion !== alias.conversion) failures.push(`${name}: conversion ${text(value.conversion)}, not the familiar pack's ${text(alias.conversion)}`);
  const [a, b] = [JSON.stringify(value), JSON.stringify(want)];
  if (a !== b) failures.push(`${name}: not byte-equal to deep-show run's answer with the pack installed: ${a.slice(0, 400)} against ${b.slice(0, 400)}`);
  return failures;
}

/** Every page of `deep_kinds list` through `m`, from the first, following each page's `next`. */
export async function listing(m: t26.Mcp): Promise<{ pages: Line[]; failure?: string }> {
  const pages: Line[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 500; i++) {
    const o = await kindsOverMcp(m, cursor === undefined ? { op: 'list' } : { op: 'list', cursor });
    const unanswered = notAnswered(`deep_kinds list${cursor === undefined ? '' : ` from ${cursor}`}`, o);
    if (unanswered) return { pages, failure: unanswered };
    pages.push(o.value as Line);
    const next = (o.value as Line).next;
    if (typeof next !== 'string') return { pages };
    cursor = next;
  }
  return { pages, failure: 'deep_kinds list: still a next page after 500' };
}

/**
 * Whether the listing names `pack` with its version: a value `deepbuild/<name>@<version>` (the pack version's ID, as a
 * pack's entries name it at the base), or one object holding both `deepbuild/<name>` and `version: <version>`.
 */
export function listed(pages: readonly Line[], pack: FirstParty): boolean {
  let found = false;
  walk(pages, (node) => {
    if (node === pack.ref) found = true;
    else if (typeof node === 'object' && node !== null && !Array.isArray(node)) {
      const values = Object.values(node as Line);
      if ((node as Line).version === pack.version && values.includes(pack.id)) found = true;
    }
  });
  return found;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 4: the store's own count of each pack version's checks

/**
 * Each count of pack-check runs the hub's pack store keeps for `pack`: the `checks` of every record under
 * `<root>/packs/` (the store packages/hub/src/packs.ts keeps across restarts, one JSON record per pack version) whose
 * `ref` is the version's ID, or whose `id` and `version` are the pack's.
 */
export function storeCounts(home: string, pack: FirstParty): unknown[] {
  const folder = join(t26.rootOf(home), 'packs');
  const counts: unknown[] = [];
  const visit = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      const s = lstatSync(file);
      if (s.isDirectory()) { visit(file); continue; }
      if (!s.isFile() || !name.endsWith('.json')) continue;
      let value: unknown;
      try { value = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
      walk(value, (node) => {
        if (typeof node !== 'object' || node === null || Array.isArray(node)) return;
        const n = node as Line;
        if (n.ref === pack.ref || (n.id === pack.id && n.version === pack.version)) if ('checks' in n) counts.push(n.checks);
      });
    }
  };
  visit(folder);
  return counts;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 3's plant: the installed tree (#41), the hub's release, with a planted pack beside the ones it ships

export interface Installed { prefix: string; tree: string; deep: string; core: string }
/**
 * `node scripts/install-prefix.mjs --prefix <temp>`: the installed tree, whose hub runs the deep-show shipped in its
 * packages/hub/dist. Its deep-hook, which npm would install as the optional package @deepbuild/deep-hook-<platform>-<arch>
 * and the checkout's node_modules doesn't hold, is the checkout's build put where the tree's hub looks next, <tree>/target/debug.
 */
export function install(): Installed {
  const prefix = tempDir('p-');
  const r = spawnSync(NODE, [join(REPO, 'scripts', 'install-prefix.mjs'), '--prefix', prefix], { cwd: REPO, encoding: 'utf8', timeout: 1_200_000, maxBuffer: 1 << 26 });
  expect(r.status, `BLOCKED: scripts/install-prefix.mjs lays out the installed tree: ${(r.stderr || r.stdout).slice(-2000)}`).toBe(0);
  const tree = join(prefix, 'lib', 'node_modules', 'deepbuild');
  const core = join(tree, 'packages', 'hub', 'dist', 'deep-show');
  expect(existsSync(core), `BLOCKED: the installed tree ships the canvas core at ${core}`).toBe(true);
  mkdirSync(join(tree, 'target', 'debug'), { recursive: true });
  copyFileSync(checkoutBuild('deep-hook'), join(tree, 'target', 'debug', 'deep-hook'));
  chmodSync(join(tree, 'target', 'debug', 'deep-hook'), 0o755);
  return { prefix, tree, deep: join(prefix, 'bin', 'deep'), core };
}

/**
 * Each folder of the installed tree that holds the first-party packs it ships: the parent of every pack folder whose
 * pack.json is byte for byte one of the checkout's `packs/*\/pack.json`. Links and node_modules (third-party code) are
 * not walked.
 */
export function shippedPackRoots(tree: string): string[] {
  const ours = new Set(firstParty(CHECKOUT_PACKS).map((p) => readFileSync(join(p.dir, 'pack.json'), 'utf8')));
  const roots = new Set<string>();
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      const s = lstatSync(file);
      if (s.isSymbolicLink()) continue;
      if (s.isDirectory()) { if (name !== 'node_modules') visit(file); continue; }
      if (name === 'pack.json' && ours.has(readFileSync(file, 'utf8'))) roots.add(dirname(dirname(file)));
    }
  };
  visit(tree);
  return [...roots].sort();
}

/** The planted pack folder copied into `root`, beside the shipped ones, as `plant1720-1.0.0/`. */
export function plant(root: string): string {
  const to = join(root, `${PLANT_NAME}-1.0.0`);
  cpSync(PLANT, to, { recursive: true });
  return to;
}

/** `deep-show run`'s pack check of the planted folder (#306's `packs` call): its row, which must be refused. */
export function plantRowOnRun(bin: string): Line | undefined {
  const [reply] = onRun(bin, { packs: [{ id: `${OWNER}/${PLANT_NAME}`, dir: PLANT }], calls: [{ call: 'packs' }] });
  return ((reply?.['packs'] ?? []) as Line[]).find((r) => r.pack === `${OWNER}/${PLANT_NAME}`);
}

export interface DoctorItem { item: string; agent: string; code: string; level: string; evidence: string; fix: string }
/**
 * `deep doctor --json` from `deep` with HOME the test's home, one doctor.item@1 per line. Its PATH holds Node's folder
 * and the system folders only, so no claude or codex of this machine is run.
 */
export async function doctor(deep: string, home: string): Promise<{ ran: t26.Ran; items: DoctorItem[] }> {
  const env = t26.childEnv(home, { PATH: `${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`, SHELL: '/bin/sh', NO_COLOR: '1' });
  const ran = await t26.run(NODE, [deep, 'doctor', '--json'], { env, cwd: home, timeoutMs: 600_000 });
  const items = ran.stdout.split('\n').filter((l) => l.trim().startsWith('{')).flatMap((l) => { try { return [JSON.parse(l) as DoctorItem]; } catch { return []; } });
  return { ran, items };
}
