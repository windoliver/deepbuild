// #3017.c9b75e03 (AC8): "The table adds under 5 ms to a render-back at 1936 × 1584 on the reference Mac (drafted). A
// reading taken while another GPU job holds a lease reads INCONCLUSIVE, never a number"
//
// Fixture (helpers.ts `grid`, README: Fixtures): criterion 5's thousand boxes at 1936 × 1584 (the same metres, so all
// 1,000 stay in view and the table cuts 800). "On" is the render-back as shipped; "off" is the same render-back under
// planted `visible_table_as_boxes` (the merge base's table: rows from boxes, nothing read from the object-ID pass, the
// same picture), so the two differ by what the table adds (README: Readings).
//
// asserts, in order:
//   - the lease: with a lease file held by another live process (one this test starts and stops by its PID), the
//     timing reads INCONCLUSIVE, draws and times nothing, reports no number, and leaves the holder's lease as it was;
//   - on any machine, on the debug build: on's render-back at 1936 × 1584 is presented with one snapshot of 1936 × 1584
//     px whose table has 200 rows, each `{id, box, px, at}`, and a `cut`; off's draws the same picture (one SHA-256);
//   - then, only on a reference Mac at rest (scripts/benchmark.mjs; else INCONCLUSIVE before timing): deep-show built
//     for release and kept open, under the machine's GPU lease (held by another job: INCONCLUSIVE, no number; lost
//     meanwhile: INCONCLUSIVE), one warm-up run and five of 20 rounds each, on and off alternating which goes first; a
//     run's value is median(on) − median(off) wall time (a negative one read as 0); judgeLimit(5 ms) decides: FAIL
//     fails, PASS passes, anything else INCONCLUSIVE.
// Wrong programs: the base (no table to time); a table that draws a second frame or reads the object-ID pass back
// whole and walks it slowly enough to add 5 ms or more; a timing taken while another GPU job draws.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GPU_LEASE, Streamed, TIMEOUT, brief, buildInto, docId, grid, inconclusive, isObject, judgeLimit, load, median, none, proof, requireMetal, run,
  scenarioOf, shapeFailures, show, snapshotsOf, tableOf, takeGpuLease, timingProblem, useBuild, useFolders, type JsonObject,
} from './helpers.ts';

/** The criterion's ID: `#3017.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const AC8 = '#3017.c9b75e03';
/** The off side: the merge base's table, as a planted program (README: The planted programs). */
const AS_BOXES = 'visible_table_as_boxes';
const LIMIT_MS = 5;
const RUNS = 5;
const ROUNDS = 20;
const BIG: [number, number] = [1936, 1584];
const bin = useBuild();
const folder = useFolders();
const DOC = docId(9);
const doc = grid(BIG);

type Outcome = { status: 'INCONCLUSIVE'; reason: string } | { status: 'READ'; runs: number[]; loads: { start: number; end: number }[] };
/**
 * Takes the GPU lease at `leaseFile`, runs one warm-up and five runs of `round` (each run's value from its rounds),
 * and releases it. Held by another live process, or lost meanwhile: INCONCLUSIVE, with no number.
 */
async function timed(leaseFile: string, value: () => Promise<number>): Promise<Outcome> {
  const lease = takeGpuLease(leaseFile);
  if (!lease.ok) return { status: 'INCONCLUSIVE', reason: lease.reason };
  try {
    await value();
    const runs: number[] = [];
    const loads: { start: number; end: number }[] = [];
    for (let k = 1; k <= RUNS; k++) {
      const start = load();
      runs.push(await value());
      loads.push({ start, end: load() });
      if (!lease.ours()) return { status: 'INCONCLUSIVE', reason: `the machine's GPU lease (${leaseFile}) was taken by another job during run ${k}` };
    }
    return { status: 'READ', runs, loads };
  } finally { lease.release(); }
}

describe(`${AC8} the table's added time on a render-back at 1936 × 1584`, () => {
  it(`${AC8} the table adds under 5 ms to a render-back at 1936 × 1584 on the reference Mac, a reading taken while another GPU job holds the lease reading INCONCLUSIVE`, async () => {
    requireMetal('a render-back of the thousand boxes');

    // The lease: another GPU job holds it, so nothing is drawn or timed and no number is reported.
    const dir = mkdtempSync(join(tmpdir(), 'deep-3017-lease-'));
    const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'], { stdio: 'ignore' });
    try {
      expect(holder.pid, 'the other GPU job started').toBeDefined();
      const file = join(dir, 'lease');
      writeFileSync(file, String(holder.pid));
      let drew = 0;
      const got = await timed(file, async () => { drew++; return 1.5; });
      expect(got.status, 'a reading while another GPU job holds the lease is INCONCLUSIVE').toBe('INCONCLUSIVE');
      expect(drew, 'nothing is drawn or timed while the lease is held').toBe(0);
      expect(JSON.stringify(got), 'it reports no number').not.toMatch(/runs|\d+\.\d+ ?ms/);
      expect((got as { reason: string }).reason, 'it names the holder').toContain(String(holder.pid));
      expect(readFileSync(file, 'utf8'), 'the holder\'s lease is left as it was').toBe(String(holder.pid));
    } finally {
      if (holder.pid !== undefined) try { process.kill(holder.pid, 'SIGKILL'); } catch { /* gone */ }
      rmSync(dir, { recursive: true, force: true });
    }

    // The structure, on the debug build.
    const [on] = run(bin(), scenarioOf(folder(), [DOC], [show(DOC, doc, BIG)]));
    const onSnaps = snapshotsOf(on!, 'the render-back as shipped');
    expect(onSnaps.map((s) => [s['w'], s['h']]), 'the render-back as shipped returns one snapshot of 1936 × 1584 px').toEqual([[BIG[0], BIG[1]]]);
    const t = tableOf(on!, 'the render-back at 1936 × 1584');
    proof('the render-back at 1936 × 1584', { on: onSnaps, rows: t.rows.length, cut: t.cut ?? null });
    const failures = shapeFailures(t, BIG, 'the render-back at 1936 × 1584');
    if (t.rows.length !== 200) failures.push(`the render-back at 1936 × 1584 holds ${t.rows.length} rows, not the 200 it keeps of 1,000 that show`);
    if (!isObject(t.cut)) failures.push(`the render-back at 1936 × 1584 carries no cut (${brief(t.cut, 80)}), though it left 800 rows out`);
    none(failures, 'the timed render-back carries the table');
    const [off] = run(bin(), scenarioOf(folder(), [DOC], [show(DOC, doc, BIG)], AS_BOXES));
    const offSnaps = snapshotsOf(off!, `the render-back under ${AS_BOXES}`);
    proof(`the render-back at 1936 × 1584 under ${AS_BOXES}`, offSnaps);
    expect(offSnaps.map((s) => s['sha256']), 'on and off draw the same picture, so their render-backs differ by the table alone').toEqual([onSnaps[0]!['sha256']]);

    // The timing, on a reference Mac at rest, under the machine's GPU lease.
    const problem = await timingProblem();
    if (problem) inconclusive(`the table's added time is timed only on a reference Mac at rest: ${problem}`);
    const out = mkdtempSync(join(tmpdir(), 'deep-3017-release-'));
    try {
      const built = buildInto(true, out);
      expect(built.error, 'deep-show builds for release').toBe('');
      const s = new Streamed(built.path);
      const evidence = folder();
      try {
        const once = async (planted?: string): Promise<number> => {
          const sent = await s.send(scenarioOf(evidence, [DOC], [show(DOC, doc, BIG)], planted));
          expect(sent.replies[0]!['outcome'], `the timed render-back is presented: ${brief(sent.replies[0] as JsonObject, 600)}`).toBe('presented');
          return sent.ms;
        };
        const added = async (): Promise<number> => {
          const [ons, offs]: [number[], number[]] = [[], []];
          for (let k = 0; k < ROUNDS; k++) {
            if (k % 2 === 0) { ons.push(await once()); offs.push(await once(AS_BOXES)); }
            else { offs.push(await once(AS_BOXES)); ons.push(await once()); }
          }
          return Math.max(0, median(ons) - median(offs));
        };
        const got = await timed(GPU_LEASE, added);
        if (got.status !== 'READ') inconclusive(got.reason);
        const v = await judgeLimit(LIMIT_MS, got.runs, got.loads);
        proof('the table\'s added time at 1936 × 1584 (ms, five runs, the load at each run\'s start and end)', { ...v, loads: got.loads });
        expect(v['status'], `the table adds under ${LIMIT_MS} ms to a render-back at 1936 × 1584: ${JSON.stringify(v)}`).not.toBe('FAIL');
        if (v['status'] !== 'PASS') inconclusive(`the table's added time: ${JSON.stringify(v)}`);
      } finally {
        s.close();
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 4 * TIMEOUT);
});
