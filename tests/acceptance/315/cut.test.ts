// #315 AC10 and AC11: the spool under faults. Every deep-hook process appends its spooled request to the spool as
// one append of one line, so with the hub stopped the hooks of a run land in one spool file (README, The spool).
// AC10: eight deep-hook processes at a time spool 1,000 events and one is killed mid-write
// (DEEP_HOOK_TEST_SPOOL_STALL holds it after part of its line); on start every event whose process exited is in the
// record once, the cut line is recorded naming its offset, and the lines after it are kept. AC11: through #16's test
// VFS (DEEP_HUB_TEST_VFS), power is cut right after the hub removes a replayed 200-event spool; on restart each of
// the 200 is in the record or still in the spool. Each hook's stamp is fixed with DEEP_HOOK_TEST_CLOCK_NS, so the
// test knows every event by its seq.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  alive, bash, buildDeepHook, childEnv, cleanup, makeHome, newSession, own, readSpool, rootOf, run, settleEvents, sleep, startHub, stopHub,
  tempDir, type Ev, type Line, type Session, type SpoolRead,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const BASE_NS = 1_760_013_451_000_000_000n;
const stampOf = (i: number) => (BASE_NS + BigInt(i) * 1000n).toString();

/** Runs hooks 1..n with the hub stopped, `width` at a time, each stamped stampOf(i); `stall` holds hook i mid-write until `release` says so. */
async function spoolMany(home: string, s: Session, binary: string, n: number, width: number, stall?: { index: number; bytes: number; killAfter: number }): Promise<{ killed?: { pid: number; aliveAtKill: boolean } }> {
  let next = 1;
  let done = 0;
  let killed: { pid: number; aliveAtKill: boolean } | undefined;
  let stalled: { pid: number; exit: Promise<void> } | undefined;
  const failures: string[] = [];
  const launch = async (i: number): Promise<void> => {
    const env = { DEEP_HOOK_TEST_CLOCK_NS: stampOf(i), ...(stall && i === stall.index ? { DEEP_HOOK_TEST_SPOOL_STALL: String(stall.bytes) } : {}) };
    if (stall && i === stall.index) {
      const child = spawn(binary, ['claude-code', 'PreToolUse'], { cwd: s.cwd, env: childEnv(home, env), stdio: ['pipe', 'ignore', 'ignore'] });
      own(child.pid);
      child.stdin.end(JSON.stringify(bash(s, `echo ${i}`)));
      stalled = { pid: child.pid!, exit: new Promise((resolve) => child.on('exit', () => resolve())) };
      return;   // it holds its slot until it is killed
    }
    const r = await run(binary, ['claude-code', 'PreToolUse'], { cwd: s.cwd, env: childEnv(home, env), input: JSON.stringify(bash(s, `echo ${i}`)), timeoutMs: 30_000 });
    if (r.code !== 0) failures.push(`hook ${i}: exit ${r.code} ${r.stderr.slice(0, 200)}`);
    done++;
    if (stall && stalled && !killed && done >= stall.killAfter) {
      killed = { pid: stalled.pid, aliveAtKill: alive(stalled.pid) };
      try { process.kill(stalled.pid, 'SIGKILL'); } catch { /* gone */ }
      await stalled.exit;
    }
  };
  const lane = async (): Promise<void> => {
    while (next <= n) {
      const i = next++;
      if (stall && i === stall.index) {
        await launch(i);
        // The stalled process keeps this lane busy until it is killed.
        while (!killed && done < n - 1) await sleep(5);
        continue;
      }
      await launch(i);
    }
  };
  await Promise.all(Array.from({ length: width }, lane));
  if (stall && stalled && !killed) {
    killed = { pid: stalled.pid, aliveAtKill: alive(stalled.pid) };
    try { process.kill(stalled.pid, 'SIGKILL'); } catch { /* gone */ }
    await stalled.exit;
  }
  if (failures.length) throw Error(`BLOCKED: hooks failed with the hub stopped: ${failures.slice(0, 5).join('; ')}`);
  return killed ? { killed } : {};
}

/** The spool's requests by stamp, in spool order. */
const bySeq = (spool: SpoolRead): Map<string, Line> => new Map(spool.requests.map((r) => [r.json.seq as string, r.json]));
/** The first stamp of `wanted`, in spool order, whose event is not in the record exactly once; names its ID. */
function firstLost(spool: SpoolRead, wanted: Set<string>, has: (seq: string, id: string) => boolean): string | undefined {
  for (const r of spool.requests) {
    const seq = r.json.seq as string;
    if (wanted.has(seq) && !has(seq, r.json.id as string)) return `first ID lost: ${r.json.id as string} (seq ${seq}, ${r.file} at byte ${r.offset})`;
  }
  return undefined;
}

interface CutRun { spool: SpoolRead; killedSeq: string; aliveAtKill: boolean; events: Ev[] }
async function cutScenario(plant?: string): Promise<CutRun> {
  const binary = await buildDeepHook();
  const home = makeHome();
  const s = newSession(home);
  const { killed } = await spoolMany(home, s, binary, 1000, 8, { index: 400, bytes: 48, killAfter: 650 });
  const spool = readSpool(home);
  const hub = await startHub({ home, ...(plant && { plant }) });
  const wanted = [...Array(1000).keys()].map((k) => stampOf(k + 1)).filter((seq) => seq !== stampOf(400));
  const events = await settleEvents(hub, (all) => { const seqs = new Set(all.filter((e) => e.kind === 'tool.before').map((e) => e.seq)); return wanted.every((w) => seqs.has(w)) && all.some((e) => e.writer === 'core' && typeof e.data?.offset === 'number'); }, { timeoutMs: 120_000, quietMs: 10_000 });
  await stopHub(hub);
  return { spool, killedSeq: stampOf(400), aliveAtKill: killed?.aliveAtKill ?? false, events };
}
function judgeCut(o: CutRun): void {
  expect(o.aliveAtKill, 'the stalled deep-hook was still running, mid-write, when it was killed (DEEP_HOOK_TEST_SPOOL_STALL)').toBe(true);
  expect(o.spool.files.length, `the 1,000 hooks appended to one spool file; the spool holds ${o.spool.files.length} files`).toBe(1);
  expect(o.spool.bad.length, `the spool holds exactly one cut line: ${JSON.stringify(o.spool.bad.map((b) => ({ offset: b.offset, head: b.bytes.slice(0, 60) })))}`).toBe(1);
  const cut = o.spool.bad[0]!;
  const after = o.spool.requests.filter((r) => r.file === cut.file && r.offset > cut.offset);
  expect(after.length, 'lines follow the cut line in its file').toBeGreaterThan(0);
  const exited = new Set([...Array(1000).keys()].map((k) => stampOf(k + 1)).filter((seq) => seq !== o.killedSeq));
  const spooled = bySeq(o.spool);
  const missing = [...exited].filter((seq) => !spooled.has(seq));
  expect(missing, `every exited process's request is in the spool; missing stamps: ${missing.slice(0, 5).join(', ')}`).toEqual([]);
  const recorded = new Map<string, Ev[]>();
  for (const e of o.events) if (e.seq !== undefined) recorded.set(e.seq, [...(recorded.get(e.seq) ?? []), e]);
  const lost = firstLost(o.spool, exited, (seq, id) => (recorded.get(seq) ?? []).filter((e) => e.id === id).length === 1);
  if (lost) throw Error(`not every event whose process exited is in the record once: ${lost}`);
  const named = o.events.filter((e) => e.writer === 'core' && e.data?.offset === cut.offset);
  expect(named.length, `the cut line at byte ${cut.offset} of ${cut.file} is recorded once, naming its offset (a core event with data.offset ${cut.offset}); core events naming an offset: ${JSON.stringify(o.events.filter((e) => e.writer === 'core' && 'offset' in (e.data ?? {})).map((e) => ({ kind: e.kind, data: e.data })))}`).toBe(1);
}

describe('AC10 #315.787a7ca4 eight deep-hook processes spool 1,000 events, one killed mid-write: each exited event recorded once, the cut line recorded naming its offset, the lines after it kept', () => {
  it('AC10 1,000 hooks eight at a time with the hub stopped, hook 400 killed mid-write after 650 more ran, then the hub starts', async () => {
    judgeCut(await cutScenario());
  }, 900_000);

  it('AC10 (wrong program) a hub that stops at the first bad line fails this test, naming the first ID lost', async () => {
    const o = await cutScenario('stops-at-first-bad-line');
    expect(() => judgeCut(o)).toThrow(/first ID lost: [0-9A-HJKMNP-TV-Z]{26}/);
  }, 900_000);
});

interface PowerRun { spool: SpoolRead; cutAt: number | undefined; tries: string[]; events: Ev[]; left: SpoolRead }
interface Point { n: number; kind: string; mode?: string; ids?: string[] }
const points = (file: string): Point[] => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Point) : []);

/** 200 events spooled; a reference pass finds the spool's removal point; a pass cut right after it; a restart. */
async function powerScenario(plant?: string): Promise<PowerRun> {
  const binary = await buildDeepHook();
  const pristine = makeHome();
  const s = newSession(pristine);
  await spoolMany(pristine, s, binary, 200, 8);
  const spool = readSpool(pristine);
  const wanted = new Set([...Array(200).keys()].map((k) => stampOf(k + 1)));
  const copy = (): string => { const home = makeHome(); cpSync(rootOf(pristine), rootOf(home), { recursive: true }); return home; };

  // The reference pass: every durable write point, numbered.
  const refHome = copy();
  const refPoints = join(tempDir(), 'points.jsonl');
  const ref = await startHub({ home: refHome, vfs: { points: refPoints }, ...(plant && { plant }) });
  await settleEvents(ref, (all) => [...wanted].every((w) => all.some((e) => e.seq === w)), { timeoutMs: 120_000 });
  await stopHub(ref);
  const removal = points(refPoints).find((p) => p.kind === 'spool_removal');
  const tries: string[] = [];
  if (!removal) return { spool, cutAt: undefined, tries: [`the reference pass made no spool_removal point: ${JSON.stringify(points(refPoints).slice(0, 20))}`], events: [], left: spool };

  // The cut pass: power cut right after the removal. The hub's batching can move point numbers, so a pass whose
  // last point isn't the removal is run again (three tries), as #16's crash suite does.
  for (let attempt = 0; attempt < 3; attempt++) {
    const home = copy();
    const file = join(tempDir(), 'points.jsonl');
    const n = removal.n;
    const proc = await startHub({ home, vfs: { points: file, cutAfter: n }, ...(plant && { plant }) }).catch((error: Error) => error);
    const pid = proc instanceof Error ? undefined : proc.pid;
    const deadline = Date.now() + 60_000;
    while (pid && alive(pid) && Date.now() < deadline) await sleep(50);
    if (pid && alive(pid)) { tries.push(`attempt ${attempt + 1}: the hub was still running 60 s after start; cutAfter ${n} never came`); if (!(proc instanceof Error)) await stopHub(proc, 'SIGKILL'); continue; }
    const last = points(file).at(-1);
    if (!last || last.kind !== 'spool_removal' || last.n !== n) { tries.push(`attempt ${attempt + 1}: the cut came after ${JSON.stringify(last)}, not the spool's removal`); continue; }
    // Restart, with no cut: everything durable is replayed, whatever the spool still holds with it.
    const hub = await startHub({ home, ...(plant && { plant }) });
    const events = await settleEvents(hub, (all) => [...wanted].every((w) => all.some((e) => e.seq === w)), { timeoutMs: 60_000, quietMs: 8000 });
    const left = readSpool(home);
    await stopHub(hub);
    return { spool, cutAt: n, tries, events, left };
  }
  return { spool, cutAt: undefined, tries, events: [], left: spool };
}
function judgePower(o: PowerRun): void {
  expect(o.spool.files.length, `the 200 hooks appended to one spool file; the spool holds ${o.spool.files.length} files`).toBe(1);
  expect(o.spool.requests.length, 'the spool holds the 200 requests').toBe(200);
  expect(o.cutAt, `power was cut right after the spool's removal: ${o.tries.join('; ')}`).toBeDefined();
  const leftIds = new Set(o.left.requests.map((r) => r.json.id as string));
  const wanted = new Set(o.spool.requests.map((r) => r.json.seq as string));
  const lost = firstLost(o.spool, wanted, (seq, id) => o.events.some((e) => e.id === id && e.seq === seq) || leftIds.has(id));
  if (lost) throw Error(`after the power cut and a restart, not all 200 are in the record or still in the spool: ${lost}`);
}

describe('AC11 #315.2d265264 power cut right after the hub removes a replayed 200-event spool: on restart all 200 are in the record or still in the spool', () => {
  it('AC11 200 hooks spooled with the hub stopped; the test VFS cuts power right after the spool\'s removal; the hub restarts', async () => {
    judgePower(await powerScenario());
  }, 900_000);

  it('AC11 (wrong program) a hub that removes the spool after a synchronous=NORMAL batch fails this test, naming the first ID', async () => {
    const o = await powerScenario('remove-spool-after-normal');
    expect(() => judgePower(o)).toThrow(/first ID lost: [0-9A-HJKMNP-TV-Z]{26}/);
  }, 900_000);
});
