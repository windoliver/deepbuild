// #853.8a18357d: "A logic item that reads the count of particles inside a region gets the reading the module
// published after the step, and a planted logic item that names the buffer is refused at check, naming the buffer"
//
// The drops (helpers.ts: dropsDoc; judges.ts: DROPS). The item `drops` bursts 1,024 particles at 0 s between y = 2
// and 3 m, which fall with nothing to hit, and publishes the reading `in_gate`: its count of particles in the box from
// (0, 0, −1) to (1, 1.9, 1) m, the half of their column where x > 0, below 1.9 m. The logic item `tally` (60 Hz) reads
// `drops.in_gate` and each step writes the value it read into its array `seen`; a driver sets the x of the box
// `gauge` to `tally.seen` (#265's way of reading a logic item's array in `view3d`), so `evaluate` reads at frame k what
// the logic item wrote at step k. The same play reads `drops.buffer` at every frame, and the test counts the particles
// in the gate in each buffer itself.
//
// "Gets the reading the module published after the step": at each step k from 1 to 59 the logic item read the count
// the buffer held after particle step k − 1, the last step before logic step k's time, and 0 at step 0 (README). The
// buffer's own count is 0 at step 0, every particle of the gate's columns (about half of all) at step 33, 0 again at
// step 59, and changes between at least 20 pairs of steps, so a count taken from another step's buffer, a count of
// every particle and no count at all each fail.
//
// The planted logic item is a document (helpers.ts: dropsDoc({namesBuffer: true})): the same scene with `tally`'s
// read written `drops.buffer`. The check both documents meet is `view3d`'s (judges.ts: checkProblems): the document
// that reads the reading is drawn; the one that names the buffer is refused, `{code: "refused", issues}`, with an
// error issue whose `ids` hold `tally` and `drops`, whose `path` is `items/tally/params/reads/0` and whose `actual`
// is `drops.buffer`. At the base no kind `particles.stepped@1` exists and nothing publishes a reading of particles.
import { describe, expect, it } from 'vitest';
import { DROPS, bufferRefusalProblems, checkProblems, gateColumns, gateCount, range, readingProblems, sizeProblem } from './judges.ts';
import {
  DROPPED, GAUGE_PATH, READING, ac, arr, bufferOn, carriedOn, dropsDoc, failsNaming, frameAt, judgesHold, none, putProgram, requireGpu, run, tallyProgram, useBin,
  useOut, view3dCall, view3dFrames, writeJson,
} from './helpers.ts';

const bin = useBin();
const out = useOut();

describe(`${ac(4)} a logic item reads particles through the reading the module publishes after a step, never the buffer`, () => {
  it(`${ac(4)} a logic item that reads the count of particles inside a region gets, at each step, the count the buffer held after the step before; a planted logic item that names the buffer (logic_names_buffer) is refused at check, naming the buffer`, () => {
    judgesHold();
    requireGpu();
    const dir = out();
    const program = tallyProgram();
    const assets = putProgram(dir, program);
    const steps = range(0, DROPS.frames - 1);
    const call = (doc: string) => view3dCall({ doc, frames: DROPS.frames, capture: steps, read: [DROPPED], evaluate: [GAUGE_PATH], assets });
    const [reads, names] = run(bin(), dir, [call(writeJson(dir, 'drops.json', dropsDoc(program))), call(writeJson(dir, 'drops-buffer.json', dropsDoc(program, { namesBuffer: true })))]);

    // The logic item that reads the published reading passes the check, and is drawn.
    const what = `the drops, counted by a logic item that reads ${READING}`;
    none(checkProblems(reads!, what), 'the document whose logic item reads the published reading passes the check');
    const frames = view3dFrames(reads!, what);
    const seen: (number | null)[] = [];
    const strict: number[] = [];
    const loose: number[] = [];
    let columns = 0;
    for (const k of steps) {
      const f = frameAt(frames, k, what);
      expect(carriedOn(f, DROPPED, what).step, `${what}: frame ${k} reads the buffer at step ${k}`).toBe(k);
      const words = bufferOn(dir, f, DROPPED, what).words;
      expect(sizeProblem(words, DROPS.count, `${what} at step ${k}`), 'the buffer is 1,024 particles of 7 f32 words').toBe('');
      const c = gateCount(words, DROPS.count);
      strict.push(c.strict);
      loose.push(c.loose);
      if (k === DROPS.plateau) columns = gateColumns(words, DROPS.count);
      const x = arr(f.values?.[GAUGE_PATH], `${what}: frame ${k}: the gauge's evaluated position, which a driver sets from tally.seen`)[0];
      seen.push(typeof x === 'number' ? x : null);
    }
    none(readingProblems(seen, strict, loose, columns), 'at each step the logic item read the count the module published after the step before');

    // The planted logic item, which names the buffer, fails the same check, naming the buffer.
    failsNaming(checkProblems(names!, 'the drops, counted by a logic item that names the buffer'), ['refused at check', `"${DROPPED}"`], 'the planted logic item that names the buffer (logic_names_buffer)');
    none(bufferRefusalProblems(names!, 'tally', 'drops', DROPPED), 'the refusal is an error issue on the logic item and the particles item, at the read, naming the buffer');
  }, 3_600_000);
});
