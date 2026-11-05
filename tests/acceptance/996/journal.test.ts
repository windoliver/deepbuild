// #996 AC1: the run journal (`<root>/runs.json`) under faults, through the hub as a process (`deep hub run --root`),
// run.start on its socket, the test VFS (DEEP_HUB_TEST_VFS: its numbered points file and `cutAfter`) and the record
// read through events.read (README, The surface under test).
//
// The cut: a reference pass under the test disk lists every numbered point the hub makes while it starts three runs
// (each its own check, claim and deadline). Then, for each of those points, a fresh hub is cut right after it (kill -9,
// as the VFS does), restarted on the real disk, and must hold in its journal every run whose start it acknowledged,
// with its deadline and owner; the runs it never acknowledged are started again, as a client would, and then all three
// must be there. The journal's writes must themselves be among the numbered points.
//
// The truncation: three runs started, the hub killed, `runs.json` cut to half its bytes; the restart must rebuild the
// three from the record, keep the damaged file aside byte for byte under a name with its time, and record one reading
// naming it. At the base the journal reads the damaged file as empty: the restart has no runs, and the test names them.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  Client, crashHub, journalOf, journalPoint, keptAside, missingRuns, pointsIn, readingsNaming, sleep, startHub, startParams, stopHub, sub, tempDir,
  threeRuns, tryHub, waitFor, watchRoot, type Line, type Point, type RunSpec,
} from './helpers.ts';

/** Polls the journal until it holds `runs` with their owners and deadlines; the problems left at the end, if any. */
async function journalHolds(root: string, runs: RunSpec[], startedAt: number, ms: number): Promise<string[]> {
  const until = Date.now() + ms;
  for (;;) {
    const { entries, problem } = journalOf(root);
    const missing = missingRuns(entries, runs, startedAt);
    if (!missing.length) return [];
    if (Date.now() > until) return problem ? [problem, ...missing] : missing;
    await sleep(100);
  }
}

/** Waits until the points file stops growing for a second (at most `ms`), and returns what it holds. */
async function settledPoints(file: string, ms = 8000): Promise<Point[]> {
  const until = Date.now() + ms;
  let last = -1;
  let since = Date.now();
  for (;;) {
    const now = pointsIn(file).length;
    if (now !== last) { last = now; since = Date.now(); }
    if (Date.now() - since >= 1000 || Date.now() > until) return pointsIn(file);
    await sleep(100);
  }
}

const show = (p: Point | undefined): string => (p ? `${p.n} ${p.kind}${p.mode ? ` (${p.mode})` : ''}` : 'none');

describe('AC1 #996.015d2487 under the test disk, a cut at each numbered point while the hub starts three runs leaves all three in the journal with their deadlines and owners; runs.json truncated to half is rebuilt from the record and kept aside', () => {
  it('AC1 cut right after each numbered point the hub makes while it starts three runs: each restart holds every run it acknowledged, and then all three, with their deadlines and owners; the journal\'s writes are numbered points', async () => {
    const dir = tempDir();
    const cwd = sub(dir, 'work');
    const runs = threeRuns(cwd);

    // The reference pass: every numbered point, and the ones made while the three runs start.
    const refRoot = join(sub(dir, 'ref'), 'root');
    watchRoot(refRoot);
    const refFile = join(dir, 'ref', 'points.jsonl');
    const ref = await startHub(refRoot, { vfs: { points: refFile } });
    let window: Point[];
    try {
      const client = await Client.open(ref);
      const before = pointsIn(refFile).length;
      for (const r of runs) await client.call('run.start', startParams(r));
      client.close();
      window = (await settledPoints(refFile)).slice(before);
    } finally {
      await stopHub(ref);
    }
    console.log(`#996 AC1: the points the hub made while it started three runs (${window.length}): ${window.map(show).join(', ')}`);
    if (!window.length) throw Error('BLOCKED: the reference pass made no numbered point while it started three runs');

    const problems: string[] = [];
    const journalWrites = window.filter(journalPoint);
    if (journalWrites.length < runs.length) {
      problems.push(`the journal's writes aren't numbered durable write points: starting three runs made ${journalWrites.length} point(s) naming the journal or runs.json, among ${window.map(show).join(', ')}`);
    }

    // A cut after each point, then a restart on the real disk.
    const unreached: string[] = [];
    const cuts: string[] = [];
    for (const point of window) {
      let done = false;
      const tries: string[] = [];
      for (let attempt = 1; attempt <= 3 && !done; attempt++) {
        const passDir = sub(dir, `cut-${point.n}-${attempt}`);
        const root = join(passDir, 'root');
        watchRoot(root);
        const file = join(passDir, 'points.jsonl');
        const { hub, failed } = await tryHub(root, { vfs: { points: file, cutAfter: point.n } });
        if (!hub) { tries.push(`attempt ${attempt}: the cut came before the hub was ready (${String(failed).slice(0, 200)})`); continue; }
        const acknowledged: RunSpec[] = [];
        const startedAt = Date.now();
        try {
          const client = await Client.open(hub);
          for (const r of runs) {
            try {
              await client.call('run.start', startParams(r), 10_000);
              acknowledged.push(r);
            } catch {
              break;
            }
          }
          client.close();
        } catch {
          // The cut came while the connection opened: nothing was acknowledged.
        }
        const cut = await Promise.race([hub.exit.then(() => true), sleep(10_000).then(() => false)]);
        if (!cut) {
          await stopHub(hub, 'SIGKILL');
          tries.push(`attempt ${attempt}: the hub ran on past its three starts; point ${point.n} never came`);
          continue;
        }
        const last = pointsIn(file).at(-1);
        if (!last || last.n !== point.n) { tries.push(`attempt ${attempt}: the cut came after ${show(last)}, not point ${point.n}`); continue; }
        done = true;
        cuts.push(show(last));
        // The restart, on the real disk.
        const again = await startHub(root);
        try {
          const held = await journalHolds(root, acknowledged, startedAt, 15_000);
          for (const h of held) problems.push(`cut after point ${show(last)} with ${acknowledged.length} start(s) acknowledged: ${h}`);
          // The starts it never acknowledged are sent again, as a client would; then all three are in flight.
          const rest = runs.filter((r) => !acknowledged.includes(r));
          if (rest.length) {
            const client = await Client.open(again);
            for (const r of rest) await client.call('run.start', startParams(r));
            client.close();
          }
          if (!held.length) for (const h of await journalHolds(root, runs, startedAt, 15_000)) problems.push(`cut after point ${show(last)}, all three started: ${h}`);
        } finally {
          await stopHub(again);
        }
      }
      if (!done) unreached.push(`point ${show(point)}: ${tries.join('; ')}`);
    }
    console.log(`#996 AC1: cut after ${cuts.length} of ${window.length} points: ${cuts.join(', ')}`);
    if (unreached.length) problems.push(`the hub couldn't be cut at every point: ${unreached.join(' | ')}`);
    expect(problems, `cutting the hub at each numbered point while it starts three runs:\n${problems.join('\n')}`).toEqual([]);
  }, 1_200_000);

  it('AC1 runs.json truncated to half after a crash: the restart rebuilds the three runs from the record with their deadlines and owners, keeps the damaged file aside byte for byte under a name with its time, and records one reading naming it', async () => {
    const dir = tempDir();
    const cwd = sub(dir, 'work');
    const root = join(dir, 'root');
    watchRoot(root);
    const runs = threeRuns(cwd);
    const hub = await startHub(root);
    const startedAt = Date.now();
    let lastBefore = 0;
    try {
      const client = await Client.open(hub);
      const ids: string[] = [];
      for (const r of runs) ids.push(String((await client.call('run.start', startParams(r))).run));
      const held = await journalHolds(root, runs, startedAt, 15_000);
      if (held.length) throw Error(`BLOCKED: before the crash the journal doesn't hold the three runs: ${held.join('; ')}`);
      // Their starts are in the record, which is what a rebuild reads.
      await waitFor(async () => {
        const started = (await client.events()).filter((e: Line) => e.kind === 'run.started').map((e: Line) => String(e.data?.run ?? e.subject));
        return ids.every((id) => started.includes(id));
      }, 15_000, `run.started in the record for ${ids.join(', ')}`);
      lastBefore = Math.max(0, ...(await client.events()).map((e: Line) => Number(e.log_pos)));
      client.close();
    } catch (e) {
      await stopHub(hub);
      throw e;
    }
    await crashHub(hub);

    const file = join(root, 'runs.json');
    const whole = readFileSync(file);
    const damaged = Buffer.from(whole.subarray(0, Math.floor(whole.length / 2)));
    writeFileSync(file, damaged);

    const again = await startHub(root);
    const problems: string[] = [];
    try {
      const held = await journalHolds(root, runs, startedAt, 20_000);
      if (held.length) problems.push(`the restart doesn't hold the three runs it rebuilds from the record: ${held.join('; ')}`);
      const aside = await waitFor(() => { const k = keptAside(root, 'runs.json', damaged); return k.found ? k : undefined; }, 10_000, 'the damaged runs.json kept aside').catch(() => keptAside(root, 'runs.json', damaged));
      if (!aside.found) problems.push(`the damaged runs.json isn't kept aside: ${aside.problem}`);
      const client = await Client.open(again);
      const after = (await client.events()).filter((e: Line) => Number(e.log_pos) > lastBefore);
      client.close();
      const readings = readingsNaming(after, 'runs.json');
      if (readings.length !== 1) problems.push(`the restart recorded ${readings.length} readings naming runs.json, not one: ${JSON.stringify(readings.map((e) => ({ kind: e.kind, data: e.data }))).slice(0, 600)}`);
    } finally {
      await stopHub(again);
    }
    expect(problems, `after runs.json was truncated to half (${whole.length} → ${damaged.length} bytes) and the hub restarted:\n${problems.join('\n')}`).toEqual([]);
  }, 180_000);
});
