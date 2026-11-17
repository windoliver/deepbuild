// AC10 #518.f259d9bf: "With a stub tool whose open takes 2.0 s, the fixture film's wall time grows by at most 0.2 s
// over a stub whose open takes 0 s, since the open overlaps compiles; a planted export that opens the tool after the
// first frame grows by about 2 s and fails, naming the encoder open"
//
// One build, `full,test-encode-tools` (README: The native test tools): `test-open-2s@1.0.0` and `test-open-0s@1.0.0`
// are this machine's own H.264 tool behind a stub open, which answers 2.0 s after it is asked, or at once, and
// otherwise encodes as the first-party tool does. They are native so that the film is the fixture film as the issue
// exports it, as H.264 with AAC, whose sound is rendered and held before any frame: an export has that, its pipeline
// compiles and its asset decodes to open the tool beside. The film is the 60 s fixture film (1,440 frames).
//
// Each reading is one fresh `deep-show run`, a cold start, timed from outside from the command to its answer. After
// one warm-up, three pairs are run, the stub that goes first alternating, and the growth is the least time with the
// 2.0 s stub less the least with the 0 s stub: the least of three, since what disturbs a run only adds to it. The
// receipt must also time the open apart (`timing.open`, at least 2.0 s for the 2.0 s stub). A growth over 0.2 s
// fails, naming the encoder open, unless the machine's load is above its core count, when a clock reading counts
// neither way and the test is INCONCLUSIVE. Planted: `export_opens_tool_after_first_frame` (README: Planted
// programs), two pairs, whose growth must be about 2 s.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FILM60, H264_AAC, NATIVE, TIMEOUT, TOOLS, encoderOf, exportCall, failsNaming, film, filmScenario, inconclusive, loadProblem, none, num, obj, pinned, receiptOf,
  useShow, useTemp, watchShow, watchedFilm, type Planted,
} from './helpers.ts';

const shows = useShow([TOOLS]);
const temp = useTemp();
const MOST_GROWTH = 0.2;

/** One export of the 60 s fixture film as H.264 with AAC through a stub: its wall time and the open its receipt
 * times, in seconds. */
async function once(tool: string, planted?: Planted): Promise<{ wall: number; open: number }> {
  const evidence = temp(); const dir = temp();
  const what = `the 60 s fixture film through ${tool}${planted ? ` (planted ${planted})` : ''}`;
  const sc = filmScenario(evidence, film(evidence, FILM60.seconds), [exportCall({ out: join(dir, 'film.mp4'), ...H264_AAC, ...pinned(tool) })], planted ? { planted } : {});
  const w = await watchShow(shows.bin(TOOLS), sc);
  const [reply] = watchedFilm(w, 1, what);
  const r = receiptOf(reply!, what);
  expect(encoderOf(r.raw, what).tool, `${what}: the receipt's encoder names the stub`).toBe(tool);
  expect(r.frame_hashes.length, `${what}: the film's 1,440 frames are delivered`).toBe(FILM60.frames);
  return { wall: w.ms / 1000, open: num(obj(r.raw['timing'], `${what}: receipt.timing`)['open'], `${what}: receipt.timing.open (the encoder open, in seconds)`) };
}
interface Reading { growth: number; slow: number[]; fast: number[]; opens: number[]; loaded: string | null }
/** `pairs` pairs of exports, the stub that goes first alternating: the growth of the least wall time. */
async function measure(pairs: number, planted?: Planted): Promise<Reading> {
  const slow: number[] = []; const fast: number[] = []; const opens: number[] = [];
  let loaded = loadProblem();
  for (let i = 0; i < pairs; i++) {
    for (const tool of i % 2 === 0 ? [NATIVE.open0s, NATIVE.open2s] : [NATIVE.open2s, NATIVE.open0s]) {
      const r = await once(tool, planted);
      if (tool === NATIVE.open2s) { slow.push(r.wall); opens.push(r.open); } else fast.push(r.wall);
      loaded ??= loadProblem();
    }
  }
  return { growth: Math.min(...slow) - Math.min(...fast), slow, fast, opens, loaded };
}
const secs = (list: number[]): string => list.map((s) => s.toFixed(2)).join(', ');
/** The judge of the clock. Each failure starts `encoder open:`. */
function openFailures(r: Reading): string[] {
  return r.growth > MOST_GROWTH ? [`encoder open: the film's wall time grew by ${r.growth.toFixed(2)} s with a 2.0 s open, over ${MOST_GROWTH} s (the 2.0 s stub: ${secs(r.slow)} s; the 0 s stub: ${secs(r.fast)} s)`] : [];
}

describe(`${AC[10]} the encoder's open overlaps the export's preparing`, () => {
  it(`${AC[10]} with a stub tool whose open takes 2.0 s the 60 s fixture film's wall time grows by at most 0.2 s over a stub whose open takes 0 s, and the receipt times the open`, async () => {
    await once(NATIVE.open0s);
    const r = await measure(3);
    console.log(`${AC[10]} the 60 s fixture film: ${secs(r.slow)} s with the 2.0 s open, ${secs(r.fast)} s with the 0 s open; growth ${r.growth.toFixed(2)} s; the open timed at ${secs(r.opens)} s`);
    expect(r.opens.every((o) => o >= 2.0), `the receipt times the 2.0 s stub's open, apart from preparing, as at least the 2.0 s it takes: ${secs(r.opens)} s`).toBe(true);
    const failures = openFailures(r);
    if (failures.length && r.loaded) inconclusive(`${failures.join(' | ')}; and ${r.loaded}, so the clock readings don't count`);
    none(failures, 'the 2.0 s open against the 0 s open');
  }, 2 * TIMEOUT);

  it(`${AC[10]} a planted export that opens the tool after the first frame grows by about 2 s and fails, naming the encoder open`, async () => {
    const r = await measure(2, 'export_opens_tool_after_first_frame');
    console.log(`${AC[10]} planted: ${secs(r.slow)} s with the 2.0 s open, ${secs(r.fast)} s with the 0 s open; growth ${r.growth.toFixed(2)} s`);
    if (r.loaded && !(r.growth > 1.5 && r.growth < 3.0)) inconclusive(`the planted export's growth read ${r.growth.toFixed(2)} s, and ${r.loaded}, so the clock readings don't count`);
    failsNaming(openFailures(r), /^encoder open: the film's wall time grew by \d+\.\d+ s with a 2\.0 s open/, 'the planted export (export_opens_tool_after_first_frame)');
    expect(r.growth > 1.5 && r.growth < 3.0, `the planted export grows by about 2 s: ${r.growth.toFixed(2)} s`).toBe(true);
  }, 2 * TIMEOUT);
});
