// #31 AC18 #31.3c1a9f39: a hub started with GIT_DIR and GIT_WORK_TREE naming another repository, and with GIT_CONFIG_PARAMETERS
// set, snapshots and base-checks the repository the claim names, with none of that applied. Through the real hub and
// deep-hook, as AC15's hub test goes (a hub that can't start is BLOCKED, never a pass): the snapshot is read back from the
// record's run.started events and resolved in whatever object store the hub wrote under the world's folder.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, lstatSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { git } from './helpers.ts';
import {
  allEvents, askNamed, BEHAVIOR, CHECK_FILE, childEnv, cleanup, CLI, DEEP_HOOK, draftFor, failureOf, lockedFor, makeWorld, NODE, own, parseObject, REPO, req,
  Session, settle, sleep, stopHub, taskOf, type Ev, type Hub, type World,
} from '../29/h-d.ts';

afterEach(cleanup);
const BUILD_LIMIT = 600_000;

/**
 * `deep hub run` as `startHub` in ../29/h-d.ts starts it, with `env` added to the hub's environment alone (the sessions'
 * deep-hook and the CLI get none of it) and the plant DEEP_HUB_PLANT names. A hub that doesn't start is BLOCKED.
 */
async function startHubWith(w: World, env: Record<string, string>, plant?: string): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], {
    cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    env: childEnv(w.home, { DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_TEST_DRAFTS: w.drafts, DEEP_HUB_TEST_WORK: w.work, DEEP_HUB_PLANT: plant, ...env }),
  });
  own(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  const ready = await Promise.race([
    new Promise<Record<string, unknown> | undefined>((resolve) => {
      child.stdout!.setEncoding('utf8').on('data', (d: string) => {
        out += d;
        if (out.includes('\n')) resolve(parseObject(out.split('\n')[0]!));
      });
    }),
    exit.then(() => undefined),
    sleep(120_000).then(() => undefined),
  ]);
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub${plant ? ` with the plant DEEP_HUB_PLANT=${plant}` : ''} did not start: ${err.slice(-1500)}`);
  return { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), home: w.home, root: w.root, child, exit, readyAt: Date.now(), clock: undefined, plant, stderr: () => err };
}

/**
 * Every `objects` folder under `root` at any depth (not under node_modules): the object stores the hub may have written to.
 * The walk descends into every folder, `objects` included: a bare store at a path named `objects` keeps its own in
 * `<store>/objects`.
 */
function objectDirs(root: string): string[] {
  const found: string[] = [];
  const walk = (d: string): void => {
    let entries: string[];
    try { entries = readdirSync(d); } catch { return; }
    for (const e of entries) {
      if (e === 'node_modules') continue;
      const path = join(d, e);
      try { if (!lstatSync(path).isDirectory()) continue; } catch { continue; }
      if (e === 'objects') found.push(path);
      walk(path);
    }
  };
  walk(root);
  return found;
}
/** Runs git in the claim's repository, reading every object store under the world as alternates, so a snapshot the hub wrote resolves. */
const inWorld = (w: World, args: readonly string[]): string => git(w.repo, args, { GIT_ALTERNATE_OBJECT_DIRECTORIES: objectDirs(w.tmp).join(':') });

const OTHER_FILE = 'OTHER.txt';
const EXTRA = 'src/extra.ts';
interface Observed { commits: string[]; claim: string }
/**
 * One session's turn and stop on the world's repo under `hub`: src/auth.ts edited and src/extra.ts added, both
 * uncommitted. Returns the claim and every commit a run.started of it names: the snapshot the hub made, and the base.
 */
async function stopUnder(w: World, hub: Hub): Promise<Observed> {
  const s = new Session(w);
  await s.start();
  await s.typed(BEHAVIOR);
  await settle(hub, (e) => {
    const ref = taskOf(askNamed(e, s, BEHAVIOR));
    return ref !== undefined && lockedFor(e, ref).length > 0;
  });
  const ref = taskOf(askNamed(await allEvents(hub), s, BEHAVIOR));
  if (!ref) throw Error(`BLOCKED: the prompt "${BEHAVIOR}" opened no task`);
  await s.read('src/auth.ts');
  await s.edit('src/auth.ts', 'token.exp > 0', 'token.exp > Date.now()');
  writeFileSync(join(w.repo, EXTRA), 'export const extra = true;\n');
  await s.stop('Done.');
  const claimOf = (events: readonly Ev[]): string | undefined => {
    const made = events.filter((e) => e.kind === 'claim.made' && e.data.task_ref === ref).at(-1);
    return made ? `claim:${made.id}` : undefined;
  };
  // An event of the claim: by its `subject` or its data's `claim`, as the record writes verdicts and runs.
  const ofClaim = (x: Ev, kind: string, claim: string): boolean => x.kind === kind && (x.subject === claim || x.data.claim === claim);
  // Settles as soon as the claim has a verdict and a recorded run, never later.
  const events = await settle(hub, (e) => {
    const claim = claimOf(e);
    return claim !== undefined && e.some((x) => ofClaim(x, 'verdict.made', claim)) && e.some((x) => ofClaim(x, 'run.started', claim));
  }, 120_000);
  const claim = claimOf(events);
  if (!claim) throw Error(`the stop made no claim for ${ref} (hub stderr: ${hub.stderr().slice(-800)})`);
  const commits = [...new Set(events.filter((e) => ofClaim(e, 'run.started', claim)).map((e) => String(e.data.commit)))];
  return { commits, claim };
}
/** The criterion's assertions, each naming the variable a wrong program would have applied. */
function judge(w: World, o: Observed): void {
  const snapshots = o.commits.filter((c) => c !== w.base);
  expect(snapshots, `the claim ${o.claim} ran its check on one snapshot of the repository it names, ${w.repo}, with GIT_DIR cleared; runs named ${JSON.stringify(o.commits)}`).toHaveLength(1);
  const snapshot = snapshots[0]!;
  const dirs = objectDirs(w.tmp);
  let type: string;
  try { type = inWorld(w, ['cat-file', '-t', snapshot]); } catch (error) {
    throw Error(`the snapshot ${snapshot} resolves in no object store under ${w.tmp} (searched ${dirs.join(', ')}): ${(error as Error).message}`);
  }
  expect(type, `${snapshot} is a commit`).toBe('commit');
  // `<commit> <parent>...`: a root commit (a clean other repo's HEAD) has none, and reads as 'none' rather than a git error.
  const parents = inWorld(w, ['rev-list', '--parents', '-n', '1', snapshot]).split(/\s+/).slice(1);
  expect(parents.join(' ') || 'none', `the snapshot's parent is the HEAD of the repository the claim names, ${w.repo}, not of the one GIT_DIR and GIT_WORK_TREE name`).toBe(w.base);
  const tree = inWorld(w, ['ls-tree', '-r', '--name-only', snapshot]).split('\n');
  expect(tree, `the snapshot holds the claim repo's files, none from the worktree GIT_WORK_TREE names`).not.toContain(OTHER_FILE);
  expect(tree, 'the snapshot holds the edited file').toContain('src/auth.ts');
  expect(inWorld(w, ["show", `${snapshot}:src/auth.ts`]), 'with the turn\'s edit').toContain('token.exp > Date.now()');
  expect(tree, `the snapshot holds ${EXTRA}, which the excludes file GIT_CONFIG_PARAMETERS names would have left out`).toContain(EXTRA);
  expect(o.commits, `the fix check also ran on the merge base ${w.base} of the repository the claim names, not of the one GIT_DIR names`).toContain(w.base);
}

/**
 * The drafted check's body: line 3, the one `asserts` names, exits 0 only once the turn's edit is in src/auth.ts, so it
 * fails on the repo's base and passes on the snapshot, and the fix check gets its base run. (h-d.ts's CHECK_BYTES reads
 * src/auth.js, which the repo never has, so it fails on every head.) Line 3 runs Node's own test runner on TEST_FILE: the
 * tracers see into Node, where `grep` would make the run uncounted (Traced programs), and a line that only exits 0 or 1
 * runs no test, which is INVALID, never a pass (Check health), so the snapshot run would never pass and no base run follow.
 */
const CHECK_BODY = '#!/bin/sh\n# Drafted check: an expired token is rejected.\nnode --test .deepbuild/checks/expired-token.test.mjs\n';
/** The check's one test, beside it: its assertion fails on the base and holds once src/auth.ts has the turn's edit. */
const TEST_FILE = '.deepbuild/checks/expired-token.test.mjs';
const TEST_BODY = [
  "import { test } from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { readFileSync } from 'node:fs';",
  "test('an expired token is rejected: src/auth.ts compares the expiry with Date.now()', () => {",
  "  assert.ok(readFileSync('src/auth.ts', 'utf8').includes('Date.now()'), 'src/auth.ts does not compare with Date.now()');",
  '});',
  '',
].join('\n');
/**
 * The world with the drafted fix check (on_base fails) committed as the repo's HEAD, another repository beside it, and an
 * excludes file naming src/extra.ts. `base` is that HEAD: the merge base of the stop's snapshot.
 */
function worldWithOther(): { w: World; env: Record<string, string>; restore: () => void } {
  const made = makeWorld({ drafts: [draftFor(BEHAVIOR, { requirements: [req('R1', 'An expired token is rejected', { check: CHECK_FILE, asserts: [`${CHECK_FILE}:3`] })] })] });
  writeFileSync(join(made.repo, CHECK_FILE), CHECK_BODY, { mode: 0o755 });
  writeFileSync(join(made.repo, TEST_FILE), TEST_BODY);
  git(made.repo, ['add', '-A']);
  git(made.repo, ['commit', '-q', '-m', 'the drafted check']);
  const w: World = { ...made, base: git(made.repo, ['rev-parse', 'HEAD']) };
  const other = join(w.tmp, 'other');
  mkdirSync(other);
  git(other, ['init', '-q', '-b', 'main']);
  writeFileSync(join(other, OTHER_FILE), 'the other repository\n');
  git(other, ['add', '-A']);
  git(other, ['commit', '-q', '-m', 'other']);
  const excludes = join(w.tmp, 'excludes');
  writeFileSync(excludes, `${EXTRA}\n`);
  // The hub's temp folder is the world's, so an object store anywhere it may put one is under w.tmp.
  const tmp = join(w.tmp, 't');
  mkdirSync(tmp);
  const savedTmp = process.env.TMPDIR;
  process.env.TMPDIR = tmp;
  const restore = (): void => {
    if (savedTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = savedTmp;
  };
  const env = { GIT_DIR: join(other, '.git'), GIT_WORK_TREE: other, GIT_CONFIG_PARAMETERS: `'core.excludesFile=${excludes}'` };
  return { w, env, restore };
}
function built(): void {
  // A copy of the tracked files has no target/. A failed build, or no cargo, leaves the binary missing: BLOCKED below.
  if (!existsSync(DEEP_HOOK)) spawnSync('cargo', ['build', '-p', 'deep-hook'], { cwd: REPO, stdio: 'inherit', timeout: BUILD_LIMIT });
  for (const [what, path] of [['the deep CLI (npm run build)', CLI], ['deep-hook (cargo build -p deep-hook)', DEEP_HOOK]] as const) {
    if (!existsSync(path)) throw Error(`BLOCKED: ${what} is not built at ${path}`);
  }
}

describe('AC18 #31.3c1a9f39 a hub started with GIT_DIR, GIT_WORK_TREE and GIT_CONFIG_PARAMETERS snapshots and base-checks the repository the claim names', () => {
  it('AC18 the snapshot\'s parent is the claim repo\'s HEAD, its tree holds the edit and the file the excludes would hide and nothing of the other repo, and the base run is on the claim repo\'s base', async () => {
    built();
    const { w, env, restore } = worldWithOther();
    try {
      const hub = await startHubWith(w, env);
      try {
        judge(w, await stopUnder(w, hub));
      } finally {
        await stopHub(hub);
      }
    } finally {
      restore();
    }
  }, 300_000 + BUILD_LIMIT);

  it('AC18 (wrong program) a gate whose git inherits the hub\'s environment snapshots the other repository and fails this test, naming the variable', async () => {
    built();
    const { w, env, restore } = worldWithOther();
    try {
      const hub = await startHubWith(w, env, 'git-inherits-env');
      try {
        const o = await stopUnder(w, hub);
        const message = await failureOf(() => judge(w, o));
        expect(message, 'git-inherits-env: the planted wrong program passed the assertion, so the assertion proves nothing').not.toBeNull();
        expect(message, 'git-inherits-env: the failure must name the variable').toMatch(/GIT_DIR|GIT_WORK_TREE|GIT_CONFIG_PARAMETERS/);
      } finally {
        await stopHub(hub);
      }
    } finally {
      restore();
    }
  }, 300_000 + BUILD_LIMIT);
});
