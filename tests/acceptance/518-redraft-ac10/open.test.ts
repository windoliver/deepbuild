// AC10 #518.f259d9bf: "With a stub tool whose open takes 2.0 s, the fixture film's wall time grows by at most 0.2 s
// over a stub whose open takes 0 s, since the open overlaps compiles; a planted export that opens the tool after the
// first frame grows by about 2 s and fails, naming the encoder open"
//
// A blind redraft (README). One build, `full,test-encode-tools`: `test-open-2s@1.0.0` and `test-open-0s@1.0.0` are
// this machine's H.264 tool behind a stub open of 2.0 s and of 0 s (518/README: The native test tools), each pinned
// by the export's brief.
//
// The film is a 2 s cut of the export guards' fixture film (48 frames of 160 × 90 at 24 fps, with its tone), exported
// as H.264 with AAC. The open and the compiles are the same for any length, and a short film's wall time is nearly
// all cold start, so the clock is steady against the 0.2 s it judges. 48 frames are more than any ring a tool holds
// (`frame_delay` ≤ 16, so at most 18 slots), so frames drawn ahead can't hide a late open.
//
// A reading is one fresh `deep-show run`, a cold start, timed by this process's clock from the command to its
// answer. The export reads its frames back (`readback: true`, #501) and the evidence store is watched every 20 ms, so
// the moment frame 0's bytes land there is the film's time to its first frame, read from outside. Readings come in
// pairs, one through each stub, the stub that goes first alternating. The growth is the least wall time through the
// 2.0 s stub less the least through the 0 s stub, since what disturbs a run only adds to it. A least time is taken as
// good to its gap to the third least reading of the same stub, so the growth lies between `low` and `high`; pairs are
// added, from 3 to at most 10, until that span is wholly within 0.2 s or wholly over it.
//
// Never a pass: a span that still straddles 0.2 s after 10 pairs is INCONCLUSIVE (the clock can't tell). A growth over
// 0.2 s is INCONCLUSIVE while the one-minute load is above the core count, and INCONCLUSIVE when the film reached its
// first frame sooner than the 2.0 s the open takes: no export can hide the whole of a 2.0 s open in a shorter start,
// so the growth then says nothing of the export. Otherwise it FAILs, naming the encoder open. An export that answers
// `blocked` is BLOCKED. The receipt must time each open (`timing.open`): at least 2.0 s through the 2.0 s stub, under
// 2.0 s through the 0 s stub.
//
// Planted: `export_opens_tool_after_first_frame` (518/README: Planted programs), the order the base has. Its growth
// must fail the same judge, naming the encoder open, and be about 2 s (1.5 to 3 s, the plant's band there).
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, H264_AAC, NATIVE, TIMEOUT, TOOLS, blocked, encoderOf, exportCall, failsNaming, film, filmScenario, hexes, inconclusive, loadProblem, none, num, obj,
  pinned, receiptOf, show, useShow, useTemp, watchShow, watchedFilm, type Planted,
} from '../518/helpers.ts';

const shows = useShow([TOOLS]);
const temp = useTemp();

/** The issue's numbers, in seconds: the slow stub's open, and the most the film's wall time may grow. */
const OPEN = 2.0;
const MOST_GROWTH = 0.2;
/** "About 2 s", as the plant is built to (518/README: Planted programs). */
const ABOUT_2S = [1.5, 3.0] as const;
/** The cut of the fixture film, and one frame's raw BGRA8 bytes. */
const CUT = { seconds: 2, frames: 48, size: [160, 90] as [number, number], frameBytes: 160 * 90 * 4 } as const;
const PAIRS = { least: 3, most: 10 } as const;

/** Notes the run's time now for each file of one frame's bytes that the evidence store holds and `seen` doesn't. */
function sight(evidence: string, seen: Map<string, number>, ms: number): void {
  for (const a of readdirSync(evidence)) {
    let names: string[] = [];
    try { names = readdirSync(join(evidence, a)); } catch { continue; }
    for (const b of names) {
      if (seen.has(a + b)) continue;
      try { if (statSync(join(evidence, a, b)).size === CUT.frameBytes) seen.set(a + b, ms); } catch { /* not there yet, or gone */ }
    }
  }
}

/** One export, in seconds: its wall time, when frame 0's bytes were first seen, and the open its receipt times. */
interface Reading { wall: number; first: number; open: number }
async function once(tool: string, planted?: Planted): Promise<Reading> {
  const evidence = temp(); const dir = temp();
  const what = `the ${CUT.seconds} s fixture film through ${tool}${planted ? ` (planted ${planted})` : ''}`;
  const ask = exportCall({ out: join(dir, 'film.mp4'), ...H264_AAC, ...pinned(tool), readback: true });
  const sc = filmScenario(evidence, film(evidence, CUT.seconds, { size: CUT.size }), [ask], planted ? { planted } : {});
  const seen = new Map<string, number>();
  const w = await watchShow(shows.bin(TOOLS), sc, { everyMs: 20, timeoutMs: 600_000, tick: (ctl) => sight(evidence, seen, ctl.elapsedMs) });
  const [reply] = watchedFilm(w, 1, what);
  // The stubs stand behind this machine's own H.264 tool (518/README): where the export finds none, nothing was run.
  if (reply!['outcome'] === 'blocked') blocked(`${what}: the export is blocked, so the criterion can't be run on this machine: ${show(reply!)}`);
  const r = receiptOf(reply!, what);
  expect(encoderOf(r.raw, what).tool, `${what}: the receipt's encoder names the stub`).toBe(tool);
  expect(r.frame_hashes.length, `${what}: the film's ${CUT.frames} frames are delivered`).toBe(CUT.frames);
  const frame0 = hexes(obj(reply!['readback'], `${what}: readback`)['frames'], `${what}: readback.frames`)[0] ?? '';
  let first = seen.get(frame0);
  if (first === undefined) {
    // Not seen while the run lasted: it must be there now, and it landed at the run's end.
    const path = join(evidence, frame0.slice(0, 2), frame0.slice(2));
    expect(frame0 !== '' && existsSync(path) && statSync(path).size === CUT.frameBytes, `${what}: with readback the evidence store holds frame 0's ${CUT.frameBytes} raw bytes (#501), ${frame0}`).toBe(true);
    first = w.ms;
  }
  const open = num(obj(r.raw['timing'], `${what}: receipt.timing`)['open'], `${what}: receipt.timing.open (the encoder open, in seconds)`);
  for (const d of [evidence, dir]) rmSync(d, { recursive: true, force: true });
  return { wall: w.ms / 1000, first: first / 1000, open };
}

interface Measured {
  slow: Reading[]; fast: Reading[];
  /** The least wall time through the 2.0 s stub less the least through the 0 s stub, and the span it lies in. */
  growth: number; low: number; high: number;
  /** The film's quickest time to its first frame through the 0 s stub: the most a 2.0 s open could hide behind. */
  room: number; loaded: string | null;
}
const walls = (list: Reading[]): number[] => list.map((r) => r.wall).sort((a, b) => a - b);
/** The growth of three or more pairs. A stub's true least may lie under its least reading by as much as that
 * reading's gap to the third least: the growth is at least `low` and at most `high`. */
function read(slow: Reading[], fast: Reading[], loaded: string | null): Measured {
  const s = walls(slow); const f = walls(fast);
  const growth = s[0]! - f[0]!;
  return { slow, fast, growth, low: growth - (s[2]! - s[0]!), high: growth + (f[2]! - f[0]!), room: Math.min(...fast.map((r) => r.first)), loaded };
}
/** Whether the clock can tell: the growth's span is wholly within the limit or wholly over it. */
const settled = (m: Measured): boolean => m.high <= MOST_GROWTH || m.low > MOST_GROWTH;
/** Pairs of exports, the stub that goes first alternating, until the clock can tell or 10 pairs are in. */
async function measure(planted?: Planted): Promise<Measured> {
  const slow: Reading[] = []; const fast: Reading[] = [];
  let loaded = loadProblem();
  for (let i = 0; i < PAIRS.most; i++) {
    for (const tool of i % 2 === 0 ? [NATIVE.open0s, NATIVE.open2s] : [NATIVE.open2s, NATIVE.open0s]) {
      (tool === NATIVE.open2s ? slow : fast).push(await once(tool, planted));
      loaded ??= loadProblem();
    }
    if (i + 1 >= PAIRS.least && settled(read(slow, fast, loaded))) break;
  }
  return read(slow, fast, loaded);
}

const secs = (list: number[]): string => list.map((s) => s.toFixed(2)).join(', ');
function report(m: Measured): string {
  const row = (list: Reading[]): string => `wall ${secs(list.map((r) => r.wall))} s, first frame at ${secs(list.map((r) => r.first))} s, open timed at ${secs(list.map((r) => r.open))} s`;
  return `growth ${m.growth.toFixed(2)} s (between ${m.low.toFixed(2)} and ${m.high.toFixed(2)} s) over ${m.slow.length} pairs; the 2.0 s open: ${row(m.slow)}; the 0 s open: ${row(m.fast)}${m.loaded ? `; ${m.loaded}` : ''}`;
}
/** The criterion's judge of the clock. Its failure starts `encoder open:`. */
function openFailures(m: Measured): string[] {
  return m.growth > MOST_GROWTH ? [`encoder open: the film's wall time grew by ${m.growth.toFixed(2)} s through the tool whose open takes ${OPEN.toFixed(1)} s, over ${MOST_GROWTH} s, so the open isn't hidden behind the film's preparing (${report(m)})`] : [];
}
/** The receipt times each open: the 2.0 s stub's as the 2.0 s it takes or more, the 0 s stub's as less. */
function timedOpens(m: Measured, what: string): void {
  expect(m.slow.every((r) => r.open >= OPEN), `${what}: the receipt times the 2.0 s stub's open, apart from preparing, as at least the 2.0 s it takes: ${secs(m.slow.map((r) => r.open))} s`).toBe(true);
  expect(Math.min(...m.fast.map((r) => r.open)) < OPEN, `${what}: the receipt times the 0 s stub's open as less than the other stub's 2.0 s: ${secs(m.fast.map((r) => r.open))} s`).toBe(true);
}

describe(`${AC[10]} the encoder's open is hidden behind the film's preparing`, () => {
  it(`${AC[10]} with a stub tool whose open takes 2.0 s the fixture film's wall time grows by at most 0.2 s over a stub whose open takes 0 s, and the receipt times each open`, async () => {
    const m = await measure();
    console.log(`${AC[10]} ${report(m)}`);
    timedOpens(m, 'the export');
    if (!settled(m)) inconclusive(`after ${m.slow.length} pairs the clock can't tell whether the growth is within ${MOST_GROWTH} s: ${report(m)}`);
    const failures = openFailures(m);
    if (failures.length && m.loaded) inconclusive(`${failures.join(' | ')}; and ${m.loaded}, so the clock readings don't count`);
    if (failures.length && m.room < OPEN) inconclusive(`${failures.join(' | ')}; but the film reached its first frame ${m.room.toFixed(2)} s after the command at its quickest, sooner than the ${OPEN.toFixed(1)} s the open takes: no export can hide the whole of that open behind so short a start on this machine, so the growth says nothing of where this one opens its tool`);
    none(failures, 'the 2.0 s open against the 0 s open');
  }, TIMEOUT);

  it(`${AC[10]} a planted export that opens the tool after the first frame grows by about 2 s and fails, naming the encoder open`, async () => {
    const planted: Planted = 'export_opens_tool_after_first_frame';
    const m = await measure(planted);
    console.log(`${AC[10]} planted ${planted}: ${report(m)}`);
    timedOpens(m, `the planted export (${planted})`);
    const about = m.growth > ABOUT_2S[0] && m.growth < ABOUT_2S[1];
    // Outside the band, the reading counts only on a quiet machine whose clock puts the whole span outside it.
    if (!about && (m.loaded !== null || (m.low < ABOUT_2S[1] && m.high > ABOUT_2S[0]))) inconclusive(`the planted export's growth can't be told from about 2 s: ${report(m)}`);
    failsNaming(openFailures(m), /^encoder open: the film's wall time grew by \d+\.\d\d s/, `the planted export (${planted})`);
    expect(about, `the planted export grows by about 2 s (${ABOUT_2S[0]} to ${ABOUT_2S[1]} s): ${report(m)}`).toBe(true);
  }, TIMEOUT);
});
