// Test-side tools for the blind redraft of #1718's criterion-1 tests after #1720 (REDRAFT.md). Everything but the
// reference is #1718's own helpers, imported unchanged: the hub, the Claude Code session bound by its hooks and its
// `deep mcp`, the deep_kinds calls, criterion 1's check (`kindsFailures`, `allFailures`), the installed tree and the
// planted canvas core. What changes is `deep-show run`'s reference: it now holds the first-party packs this checkout
// ships, as the hub's canvas core holds them under #1720 (each folder of `packs/` with a pack.json, offered as
// `{id: "deepbuild/<name>", dir}` and kept only when the canvas core's own pack check installs it). Homes are
// /tmp/dh1718x-* (a socket path must fit in 104 bytes), so the real ~/.deepbuild, ~/.claude and ~/.codex are never
// touched; processes are stopped by PID through #1718's `cleanup`. Nothing is written into the checkout's `packs/`.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import * as h1718 from '../1718/helpers.ts';

export { h1718 };
const { t26 } = h1718;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

// ---------------------------------------------------------------------------------------------------
// Folders, and a session on a hub in a /tmp/dh1718x-* home

const made: string[] = [];
function tempDir(tag = ''): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh1718x-${tag}`));
  made.push(dir);
  return dir;
}
/** #1718's cleanup (every process it and #26 own, by PID, and their folders), then this suite's folders. */
export async function cleanup(): Promise<void> {
  await h1718.cleanup();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/**
 * #1718's `openSession` with the home under /tmp/dh1718x-*: a hub from `deep` (#1718's `startHub`), a Claude Code
 * session in a worktree established through its hooks and recorded by the hub, and the agent's own `deep mcp`
 * (#26's stand-in starts it as its child) initialized.
 */
export async function openSession(deep: string): Promise<h1718.Live> {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  mkdirSync(home);
  const wt = t26.makeWorktree(join(tmp, 'work'));
  const hub = await h1718.startHub(deep, home);
  const agent = t26.Agent.start(home, wt.path);
  const session = agent.session(wt.path, 'draw a box');
  await agent.establish(hub, session, 'draw a box');
  const started = await t26.eventMatching(hub, (e) => e.kind === 'session.start' && e.session === session.id, 10_000);
  if (!started) throw Error(`BLOCKED: the hub recorded no session.start for the session its hooks started (${session.id})`);
  await t26.initialize(agent);
  return { tmp, home, hub, session, agent };
}

// ---------------------------------------------------------------------------------------------------
// The first-party packs this checkout ships, as the hub's canvas core holds them

/** The first-party packs' owner: the castle names `deepbuild/composites@1.0.0`, the familiar pack is `deepbuild/familiar`. */
const OWNER = 'deepbuild';
/** The checkout's first-party packs: each folder of `packs/` with a pack.json. */
export const PACKS = join(h1718.REPO, 'packs');
export interface Pack { folder: string; id: string; version: string; dir: string }
/** Each folder of the checkout's `packs/` holding a pack.json, with its ID `deepbuild/<name>` and the version it gives. */
export function shipped(): Pack[] {
  return readdirSync(PACKS).sort().filter((folder) => existsSync(join(PACKS, folder, 'pack.json'))).map((folder) => {
    const m = JSON.parse(readFileSync(join(PACKS, folder, 'pack.json'), 'utf8')) as { name?: unknown; version?: unknown };
    return { folder, id: `${OWNER}/${String(m.name)}`, version: String(m.version), dir: join(PACKS, folder) };
  });
}

/** `deep-show run` of one scenario: its replies, in call order. */
function onRun(bin: string, scenario: JsonObject): JsonObject[] {
  const evidence = tempDir('ev-');
  const r = spawnSync(bin, ['run'], { cwd: h1718.REPO, input: `${JSON.stringify({ evidence, ...scenario })}\n`, encoding: 'utf8', maxBuffer: 1 << 30, timeout: 600_000, killSignal: 'SIGKILL' });
  if (r.error) throw Error(`${bin} run: ${r.error.message}`);
  expect(r.status, `${bin} run exits 0; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const out = JSON.parse(r.stdout.trim().split('\n')[0]!) as JsonObject;
  expect(out['ok'], `deep-show run took the scenario: ${JSON.stringify(out).slice(0, 600)}`).toBe(true);
  return out['replies'] as JsonObject[];
}

export type Held = { id: string; dir: string }[];
/**
 * The shipped packs as `bin`'s canvas core holds them: every one offered to its store (#306's scenario `packs`), and
 * kept only when its own pack check installs it (#306's `packs` row, state `installed`); a pack the check refuses
 * isn't installed (#1720). At least one must be installed, or this reference is #1718's own and proves nothing new.
 */
export function held(bin: string): Held {
  const offered = shipped();
  expect(offered.length, `the checkout ships first-party packs under ${PACKS}`).toBeGreaterThan(0);
  const [reply] = onRun(bin, { packs: offered.map((p) => ({ id: p.id, dir: p.dir })), calls: [{ call: 'packs' }] });
  const rows = (reply?.['packs'] ?? []) as JsonObject[];
  const kept = offered.filter((p) => rows.some((r) => r['pack'] === p.id && r['version'] === p.version && r['state'] === 'installed'));
  expect(kept.length, `BLOCKED: the canvas core's pack check installs none of the shipped packs: ${JSON.stringify(rows.map((r) => [r['pack'], r['state']]))}`).toBeGreaterThan(0);
  return kept.map((p) => ({ id: p.id, dir: p.dir }));
}

/** `deep-show run` of one scenario holding `packs` in its store and the one deep_kinds call: its reply. */
function kindsOnRun(bin: string, packs: Held, args: h1718.Line): JsonObject {
  const [reply] = onRun(bin, { packs, calls: [{ call: 'deep_kinds', ...args }] });
  expect(reply?.['error'], `deep-show run answers deep_kinds ${String(args.op)} with the shipped packs installed (the reference reply): ${JSON.stringify(reply).slice(0, 600)}`).toBeUndefined();
  return reply!;
}

/**
 * The reference reply of every op of #1718's criterion 1 from `bin` with the shipped packs installed as its canvas core
 * holds them, in the shape #1718's `references` gives (so its `allFailures` takes it); `read`'s example is the first
 * hash of this gallery, as #1718 reads "the gallery's first hash".
 */
export function references(bin: string): { firstHash: string; replies: Map<h1718.Op, JsonObject>; packs: Held } {
  const packs = held(bin);
  const gallery = kindsOnRun(bin, packs, { op: 'gallery' });
  const first = Array.isArray(gallery['examples']) ? (gallery['examples'][0] as JsonObject | undefined) : undefined;
  const hash = first?.['hash'];
  expect(typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash), `deep-show run's gallery lists a first example with a hash: ${JSON.stringify(gallery).slice(0, 400)}`).toBe(true);
  const firstHash = hash as string;
  return { firstHash, packs, replies: new Map(h1718.OPS.map((op) => [op, kindsOnRun(bin, packs, h1718.argsOf(op, firstHash))])) };
}
