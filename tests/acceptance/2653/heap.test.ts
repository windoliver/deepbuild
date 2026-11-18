// AC5: on #16's 30-day record the hub's core thread's heap after two full collections is at least 1.5 MB under the
// merge base's (drafted from the report's 2.2 MB). Each side is `deep hub run` started as #16's helpers start it (its
// environment, its own process group, its ready line, stopped by its PID), on #16's 30-day record seeded into its
// home just before, from a tree of its own: this checkout's packages cloned, each linked by name in the tree's
// node_modules, and packages/asks this checkout's built asks core or the merge base's (README: the merge base). A
// preload (`node --import`, test code, no module hook) runs two full collections in the core thread each time the
// test asks and writes that thread's heap. A hub's reading is its heap once settled: read 15 s after its ready line
// and every 15 s after, until two readings in a row are within 0.25 MB. Two hubs a side, in the order ABBA, judged as
// #83's budgets judge a reading: PASS when every reading is at least 1.5 MB under every reading of the merge base,
// FAIL when none is, INCONCLUSIVE between.

import { spawn } from 'node:child_process';
import { constants, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { openRecord } from '../../../packages/record/src/index.ts';
import { cleanup, DAY, hubEnv, installedRoot, makeHome, NODE, own, settle, sleep, stopHub, ulid, type HubProc, type Ready } from '../16/helpers.ts';
import { asksAt, mergeBase, REPO } from './helpers.ts';

afterEach(cleanup, 60_000);

const MB = 2 ** 20;
const UNDER = 1.5 * MB;
/** As the Nov 13 report read the hub, 15 s after the ready line; then again every 15 s. */
const EVERY_MS = 15_000;
/** Two readings in a row this close: the start's work is done and the heap has settled. At most this many readings. */
const SETTLED = 0.25 * MB;
const READINGS = 8;

/** #16's seedHistory (tests/acceptance/16/budgets.test.ts), as written there: 30 days of 20 sessions a day of ten turns, about 3,000 events a day. */
async function seedHistory(root: string, days: number): Promise<void> {
  const end = Date.now() - 60_000;
  let now = end - days * DAY;
  const record = await openRecord({ path: join(root, 'ledger.db'), now: () => now });
  const conn = (session: string) => ({ writer: 'hook', actor: 'you', scope: 'you', session, agent: 'claude-code' });
  let n = 0;
  const seq = (ms: number) => (BigInt(ms) * 1_000_000n + BigInt(++n % 1_000_000)).toString();
  for (let d = 0; d < days; d++) {
    const dayStart = end - (days - d) * DAY;
    for (let s = 0; s < 20; s++) {
      const session = `${ulid(dayStart)}`;
      let at = dayStart + s * 600_000;
      now = at;
      const pending: Promise<unknown>[] = [];
      pending.push(record.append(conn(session), { v: 1, id: ulid(at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree: '~/src/shop', branch: 'main', thread: session } }));
      for (let t = 0; t < 10; t++) {
        at += 1000;
        pending.push(record.append(conn(session), { v: 1, id: ulid(at), kind: 'user.ask', ts: at, seq: seq(at), data: { msg: t, text: 'run the tests and fix what fails', tasks: [], from: 'person' } }));
        for (let k = 0; k < 13; k++) {
          at += 1000;
          const kind = k % 2 === 0 ? 'tool.before' : 'tool.after';
          pending.push(record.append(conn(session), { v: 1, id: ulid(at), kind, ts: at, seq: seq(at), data: { kind: 'shell', paths: [], command: `npm test -- src/${k}.test.ts` } }));
        }
        at += 1000;
        pending.push(record.append(conn(session), { v: 1, id: ulid(at), kind: 'agent.stop', subject: `session:${session}`, ts: at, seq: seq(at), data: { turn: t + 1, did_work: true } }));
      }
      await Promise.all(pending);
    }
  }
  await record.close();
}

/**
 * A tree a hub starts from: every package of this checkout cloned, with `asks` as packages/asks, each linked by its
 * name in the tree's own node_modules; this checkout's third-party modules and other top-level entries (deep-hook's
 * target/ among them) linked. A module hook would do the asks' swap with less, but in the core thread it holds about
 * 1.4 MB more in some hubs and not others (README: AC5), as much as the effect measured.
 */
function hubTree(asks: string, name: string): string {
  const tree = realpathSync(mkdtempSync(join(tmpdir(), `dh2653-hub-${name}-`)));
  for (const entry of readdirSync(REPO)) if (!['packages', 'node_modules', '.git'].includes(entry)) symlinkSync(join(REPO, entry), join(tree, entry));
  for (const pkg of readdirSync(join(REPO, 'packages'))) {
    cpSync(pkg === 'asks' ? asks : join(REPO, 'packages', pkg), join(tree, 'packages', pkg), { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
  }
  mkdirSync(join(tree, 'node_modules/@deepbuild'), { recursive: true });
  for (const entry of readdirSync(join(REPO, 'node_modules'))) if (entry !== '@deepbuild') symlinkSync(join(REPO, 'node_modules', entry), join(tree, 'node_modules', entry));
  for (const link of readdirSync(join(REPO, 'node_modules/@deepbuild'))) symlinkSync(readlinkSync(join(REPO, 'node_modules/@deepbuild', link)), join(tree, 'node_modules/@deepbuild', link));
  return tree;
}
/** Removes a tree: its links first, so nothing they point at is touched. */
function removeTree(tree: string): void {
  for (const dir of [join(tree, 'node_modules/@deepbuild'), join(tree, 'node_modules'), tree]) {
    for (const entry of existsSync(dir) ? readdirSync(dir) : []) if (lstatSync(join(dir, entry)).isSymbolicLink()) unlinkSync(join(dir, entry));
  }
  rmSync(tree, { recursive: true, force: true });
}
/** The asks package the hub's core reaches in a tree: the first node_modules/@deepbuild/asks up from packages/hub/dist, as Node looks. */
const asksIn = (tree: string): string => {
  const first = ['packages/hub/dist', 'packages/hub', 'packages', '.'].map((d) => join(tree, d, 'node_modules/@deepbuild/asks')).find((p) => existsSync(p));
  return first ? realpathSync(first) : 'none';
};

/** `deep hub run` from a tree's CLI, as #16's spawnHub starts it from the checkout's: its own process group, HOME the test's, the preload first. */
function spawnHubIn(tree: string, home: string, preload: string): HubProc {
  const child = spawn(NODE, ['--import', preload, join(tree, 'packages/cli/dist/main.js'), 'hub', 'run'], { cwd: REPO, env: hubEnv({ home }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let err = '';
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  const ready = new Promise<Ready | undefined>((resolve) => {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (!out.includes('\n')) return;
      try {
        const line = JSON.parse(out.split('\n')[0]!) as Ready;
        resolve(line.ready === true ? line : undefined);
      } catch {
        resolve(undefined);
      }
    });
    void exit.then(() => resolve(undefined));
  });
  return { child, pid: child.pid!, stderr: () => err, ready, exit };
}

/** The preload for one hub: nothing outside the core thread; in it, the heap after two full collections each time the test asks. No module hook. */
const preload = (out: string): string => `// #2653 AC5, test code: the hub's core thread's heap after two full collections, written to heap-<k>.json when ${out}/measure-<k> appears.
import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { getHeapStatistics, setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { workerData } from 'node:worker_threads';
const out = ${JSON.stringify(out)};
if (workerData && typeof workerData === 'object' && workerData.core) {
  let k = 1;
  const timer = setInterval(() => {
    if (!existsSync(out + '/measure-' + k)) return;
    setFlagsFromString('--expose-gc');
    const gc = runInNewContext('gc');
    gc({ type: 'major', execution: 'sync' });
    gc({ type: 'major', execution: 'sync' });
    writeFileSync(out + '/heap.part', JSON.stringify(getHeapStatistics()));
    renameSync(out + '/heap.part', out + '/heap-' + k + '.json');
    k++;
  }, 250);
  timer.unref();
}
`;

interface Reading { side: string; used: number; read: number[]; settled: boolean }
/**
 * One hub started from a side's tree on #16's 30-day record, seeded into its home just before, as #16 seeds it, so
 * every hub sees a history of the same age: its core thread's heap after two full collections, once settled.
 */
async function coreHeap(side: string, tree: string): Promise<Reading> {
  const home = makeHome();
  const root = installedRoot(home);
  mkdirSync(root, { recursive: true });
  await seedHistory(root, 30);
  const out = join(home, 'heap');
  mkdirSync(out);
  writeFileSync(join(out, 'preload.mjs'), preload(out));
  const proc = spawnHubIn(tree, home, join(out, 'preload.mjs'));
  const started = await settle(proc, 600_000);
  const read: number[] = [];
  const settledNow = () => read.length >= 2 && Math.abs(read.at(-1)! - read.at(-2)!) <= SETTLED;
  try {
    if (!started.ready) throw Error(`BLOCKED: the hub (${side}) didn't start: ${started.hung ? 'no ready line' : `exit ${JSON.stringify(started.exit)}`}; stderr: ${proc.stderr().slice(0, 2000)}`);
    while (!settledNow() && read.length < READINGS) {
      await sleep(EVERY_MS);
      const k = read.length + 1;
      writeFileSync(join(out, `measure-${k}`), '');
      for (let waited = 0; !existsSync(join(out, `heap-${k}.json`)); waited += 250) {
        if (waited > 300_000) throw Error(`BLOCKED: the hub's core thread (${side}) wrote no heap within 300 s of being asked: ${proc.stderr().slice(-2000)}`);
        await sleep(250);
      }
      read.push((JSON.parse(readFileSync(join(out, `heap-${k}.json`), 'utf8')) as { used_heap_size: number }).used_heap_size);
    }
  } finally {
    await stopHub({ pid: proc.pid, proc });
  }
  return { side, used: read.at(-1)!, read, settled: settledNow() };
}

test("AC5 #2653.b467ea15 on #16's 30-day record the core thread's heap after two full collections is at least 1.5 MB under the merge base's", async (ctx) => {
  const sha = mergeBase();
  const trees = new Map<string, string>();
  try {
    trees.set('this checkout', hubTree(join(REPO, 'packages/asks'), 'here'));
    trees.set('the merge base', hubTree(join(asksAt(sha, 'merge-base'), 'packages/asks'), 'base'));
    // Each side's hub resolves the asks core of its own tree, not this checkout's.
    for (const [side, tree] of trees) expect(asksIn(tree), `BLOCKED unless the hub started from ${side}'s tree runs that tree's asks core`).toBe(join(tree, 'packages/asks'));
    const readings: Reading[] = [];
    for (const side of ['this checkout', 'the merge base', 'the merge base', 'this checkout']) readings.push(await coreHeap(side, trees.get(side)!));
    const ours = readings.filter((r) => r.side === 'this checkout');
    const theirs = readings.filter((r) => r.side === 'the merge base');
    const mb = (xs: Reading[]) => xs.map((r) => (r.used / MB).toFixed(2)).join(' and ');
    const least = Math.min(...theirs.map((r) => r.used)) - Math.max(...ours.map((r) => r.used));
    const most = Math.max(...theirs.map((r) => r.used)) - Math.min(...ours.map((r) => r.used));
    const reading = `the core thread holds ${mb(ours)} MB of heap after two full collections, and on the merge base ${sha.slice(0, 12)} ${mb(theirs)} MB: under it by ${(least / MB).toFixed(2)} to ${(most / MB).toFixed(2)} MB`;
    const each = readings.map((r) => `${r.side}: ${r.read.map((x) => (x / MB).toFixed(2)).join(', ')}${r.settled ? '' : ' (never settled)'}`).join('; ');
    console.log(`AC5 #2653.b467ea15 ${reading} (each hub, ${EVERY_MS / 1000} s apart: ${each})`);
    if (readings.some((r) => !r.settled)) ctx.skip(`INCONCLUSIVE: a hub's heap never settled within ${READINGS} readings: ${each}`);
    expect(most / MB, `${reading}; at least ${UNDER / MB} MB under is needed`).toBeGreaterThanOrEqual(UNDER / MB);
    if (least < UNDER) ctx.skip(`INCONCLUSIVE: ${reading}; the runs straddle ${UNDER / MB} MB under`);
  } finally {
    for (const tree of trees.values()) removeTree(tree);
  }
}, 3_600_000);
