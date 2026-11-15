// #2513.ea6f22ea: "With that subject, the readings add under 20 ms to a render-back at 1936 × 1584 on the reference Mac"
//
// Fixtures (helpers.ts `fillDoc`, README: Fixtures): criterion 1's frame-filling card at 1936 × 1584, holding beside it
// an invisible stand-in card of the same size in the same place. "On" keeps the card (its snapshot carries readings);
// "off" keeps the stand-in, which shows no px, so there is nothing to read (#1939). Framing reads the kept item's
// bounds, which are the same either way, so the two draw one picture and their render-backs differ by the readings alone.
//
// asserts:
//   - first, on any machine, on the debug build: alpha's deep_show of each, rendered back with pixels at 1936 × 1584,
//     is presented with one snapshot of 1936 × 1584 px; on's carries readings, off's none; both snapshots are the same
//     picture (one SHA-256);
//   - then, only on one of the reference Macs by its hardware (scripts/benchmark.mjs's list; elsewhere INCONCLUSIVE
//     before anything is timed): deep-show built for release, kept open as one `deep-show run` process (#412's
//     budgets), one warm-up run and five, each 20 rounds of the on and off render-backs, the order swapped each round;
//     a run's value is the median of on's wall times less off's (a negative one read as 0). judgeLimit(20 ms) decides:
//     FAIL fails, PASS passes, anything else, such as a loaded Mac's reading, is INCONCLUSIVE, never a pass. A release
//     binary whose seal refuses it (`seal_refused`) presents no render-back, so nothing is timed: INCONCLUSIVE too.
// Wrong programs: the base (the subject's pre-tone px read back to the CPU and measured there, about 130 ms on this
// subject at load 100, by the issue); a reduction slow enough, or reading back enough, to add 20 ms or more; readings
// drawn into the picture.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FRAME, STAND_IN, SUBJECT, Streamed, TIMEOUT, brief, buildInto, docId, fillDoc, hardwareProblem, inconclusive, judgeLimit, lightOf, load,
  median, proof, requireMetal, run, scenarioOf, show, snapshotsOf, useBuild, useFolders, type JsonObject,
} from './helpers.ts';

/** The criterion's ID: `#2513.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#2513.ea6f22ea';
const LIMIT_MS = 20;
const RUNS = 5;
const ROUNDS = 20;
const bin = useBuild();
const folder = useFolders();

const [ON, OFF] = [docId(11), docId(12)];
const onDoc = fillDoc(SUBJECT, true);
const offDoc = fillDoc(STAND_IN, true);

describe(`${ID} the readings' added time on a render-back of the frame-filling card`, () => {
  it(`${ID} the readings add under 20 ms to a render-back at 1936 × 1584 of the frame-filling card, on against off in one process, judged on the reference Mac`, async () => {
    requireMetal('a render-back of the frame-filling card');
    // The structure, on the debug build.
    const [on, off] = run(bin(), scenarioOf(folder(), [ON, OFF], {}, [show(ON, onDoc, FRAME), show(OFF, offDoc, FRAME)]));
    const [onSnaps, offSnaps] = [snapshotsOf(on!, 'the render-back keeping the card'), snapshotsOf(off!, 'the render-back keeping the stand-in')];
    for (const [snaps, what] of [[onSnaps, 'the render-back keeping the card'], [offSnaps, 'the render-back keeping the stand-in']] as const) {
      expect(snaps.map((s) => [s['w'], s['h']]), `${what} returns one snapshot of 1936 × 1584 px`).toEqual([[FRAME[0], FRAME[1]]]);
    }
    proof('the render-backs at 1936 × 1584', { on: onSnaps, off: offSnaps });
    expect(lightOf(onSnaps[0]!), `the render-back keeping the card carries readings: ${brief(onSnaps[0], 600)}`).not.toBeNull();
    expect(lightOf(offSnaps[0]!), `the render-back keeping the stand-in, which shows no px, carries no readings: ${brief(offSnaps[0], 600)}`).toBeNull();
    expect(onSnaps[0]!['sha256'], 'on and off draw the same picture, so their render-backs differ by the readings alone').toBe(offSnaps[0]!['sha256']);

    // The timing, on a reference Mac; a loaded one gives a reading, which the lane's judge reads INCONCLUSIVE.
    const problem = await hardwareProblem();
    if (problem) inconclusive(`the readings' added time is timed only on a reference Mac: ${problem}`);
    const dir = mkdtempSync(join(tmpdir(), 'deep-2513-release-'));
    try {
      const built = buildInto(true, dir);
      expect(built.error, 'deep-show builds for release').toBe('');
      const s = new Streamed(built.path);
      const evidence = folder();
      try {
        const once = async (doc: string, document: JsonObject): Promise<number> => {
          const sent = await s.send(scenarioOf(evidence, [doc], {}, [show(doc, document, FRAME)]));
          expect(sent.replies[0]!['outcome'], `the timed render-back is presented: ${brief(sent.replies[0], 600)}`).toBe('presented');
          return sent.ms;
        };
        const added = async (): Promise<number> => {
          const [ons, offs]: [number[], number[]] = [[], []];
          for (let k = 0; k < ROUNDS; k++) {
            if (k % 2 === 0) { ons.push(await once(ON, onDoc)); offs.push(await once(OFF, offDoc)); }
            else { offs.push(await once(OFF, offDoc)); ons.push(await once(ON, onDoc)); }
          }
          return Math.max(0, median(ons) - median(offs));
        };
        await added();
        const runs: number[] = [];
        const loads: { start: number; end: number }[] = [];
        for (let r = 0; r < RUNS; r++) { const start = load(); runs.push(await added()); loads.push({ start, end: load() }); }
        const v = await judgeLimit(LIMIT_MS, runs, loads);
        proof('the readings\' added time at 1936 × 1584 (ms, five runs, the load at each run\'s start and end)', { ...v, loads });
        expect(v['status'], `the readings add under ${LIMIT_MS} ms to a render-back at 1936 × 1584: ${JSON.stringify(v)}`).not.toBe('FAIL');
        if (v['status'] !== 'PASS') inconclusive(`the readings' added time: ${JSON.stringify(v)}`);
      } finally {
        s.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 4 * TIMEOUT);
});
