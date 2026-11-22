// AC7 #1250.7b1c7063: "Budgets, on the reference Mac in the local preflight: a 10 s clip of the fixture is written within
// 3 s of the key while the play continues at its frame budget, and keeping the track for a 60-minute play costs under
// 8 MiB"
//
// Through `deep-show run` (full), five runs after a warm-up run, each a fresh process, judged by the perf lane's own
// judgeLimit (scripts/benchmark.mjs) with the one-minute load at each run's start and end: PASS only when all five are
// within, FAIL when all five are over by more than the margin, INCONCLUSIVE otherwise, off a reference Mac, under load,
// or on battery, Low Power Mode or a thermal state other than nominal (The reference Macs). Off a reference Mac the runs
// aren't made: the test reads INCONCLUSIVE at once, as #501's budgets do.
//
// - The clip: the indexed game plays 12 s of the scripted play on the scenario's clock, ⌘⇧C, then the play goes on live
//   on the wall clock for 300 frames (5 s) through #856's paced `frames` from 12 s, while the clip job runs beside it;
//   `clips` then reads the card. Readings: the card's `timing.wall`, seconds from the key to the file under its name
//   (Export's receipt's `wall`), limit 3 s; and the 95th percentile of the 300 frames' `ui_ms`, the frame's time on the
//   UI thread, limit the play's frame budget at 60 fps, 1000/60 ms (Frame budget: each run's p95 over at least 300
//   frames).
// - The track: the 60-minute game (span 3,700 s) loads a 60-minute play's track as a held key writes it, an entry at
//   every step, 216,000 entries (#1164's `track` with `load`), and `track` reads it back with `kept_bytes`, the bytes
//   the app holds to keep it. Limit 8 MiB (8,388,608 bytes).
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, TIMEOUT, arr, blocked, clipsCall, fl, gameDoc, heldTrack, inconclusive, int, judge, load1, num, obj, oneClip, p95, presented, referenceMacProblem,
  runApp, saveClipKey, scriptedPlay, show, showAt, trackCall, useShow, useTemp, writtenFile, type Judged,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const KEY = fl(12);
const WALL_LIMIT = 3;
const FRAME_BUDGET_MS = 1000 / 60;
const TRACK_LIMIT = 8 * 1024 * 1024;
const RUNS = 5;

interface Readings { wall: number; p95: number }
function clipRun(): Readings {
  const evidence = temp(); const state = temp();
  const calls = [
    showAt(DOC.game, gameDoc(evidence)), ...scriptedPlay(KEY), saveClipKey(KEY),
    { call: 'frames', at: KEY, doc: DOC.game, count: 300, from: '720f', step: '1f', paced: true }, clipsCall(KEY),
  ];
  const replies = runApp(shows.bin(FULL), { evidence, state, doc: DOC.game }, calls, 'the clip while the play goes on');
  presented(replies[0]!, 'the game');
  const card = oneClip(replies[calls.length - 1]!, 'save_clip', 'the clip');
  expect(card.range, `a 10 s clip, [2 s, 12 s): ${show(card.raw)}`).toEqual([fl(2), KEY]);
  writtenFile(card, state, DOC.game, 'gif', 'the clip');
  expect(card.wall, `the card gives timing.wall, the seconds from the key to the file: ${show(card.raw)}`).not.toBeNull();
  const frames = arr(obj(replies[calls.length - 2]!, 'frames')['frames'], 'frames.frames').map((f, i) => num(obj(f, `frames[${i}]`)['ui_ms'], `frames[${i}].ui_ms`));
  expect(frames.length, 'the play went on for 300 frames').toBe(300);
  return { wall: card.wall!, p95: p95(frames) };
}
function trackRun(): number {
  const evidence = temp(); const state = temp();
  const held = heldTrack(60);
  const calls = [showAt(DOC.long, gameDoc(evidence, 3700, DOC.long)), trackCall(DOC.long, 0, held), trackCall(DOC.long, 0)];
  const replies = runApp(shows.bin(FULL), { evidence, state, doc: DOC.long }, calls, 'the 60-minute track');
  presented(replies[0]!, 'the 60-minute game');
  const reply = obj(replies[2], 'track');
  expect(arr(reply['track'], 'track.track').length, 'the app keeps all 216,000 entries').toBe(held.length);
  return int(reply['kept_bytes'], 'track.kept_bytes');
}
const line = (what: string, j: Judged, unit: string): string => `${what}: ${j.status} (limit ${j.limit.toFixed(3)} ${unit}; runs ${j.runs.map((r) => r.toFixed(3)).join(', ')}${j.reason ? `; ${j.reason}` : ''})`;

describe(`${AC[7]} budgets: the clip within 3 s of the key while the play keeps its frame budget, and a 60-minute track under 8 MiB`, () => {
  it(`${AC[7]} on a reference Mac, five runs: the 10 s clip written within 3 s of the key, the play's p95 frame time within 1000/60 ms meanwhile, and the 60-minute track kept in under 8 MiB`, async () => {
    const problem = await referenceMacProblem(true);
    if (problem) inconclusive(`the budgets count only on a reference Mac in a fit state, so the runs aren't made here: ${problem}`);
    clipRun();
    const clip: Readings[] = []; const clipLoads: { start: number; end: number }[] = [];
    for (let r = 0; r < RUNS; r++) { const start = load1(); clip.push(clipRun()); clipLoads.push({ start, end: load1() }); }
    const bytes: number[] = []; const trackLoads: { start: number; end: number }[] = [];
    for (let r = 0; r < RUNS; r++) { const start = load1(); bytes.push(trackRun()); trackLoads.push({ start, end: load1() }); }
    const judged: [string, Judged, string][] = [
      ['the clip from the key to its file', await judge(WALL_LIMIT, clip.map((c) => c.wall), clipLoads), 's'],
      ['the play\'s p95 frame time while the clip is written', await judge(FRAME_BUDGET_MS, clip.map((c) => c.p95), clipLoads), 'ms'],
      ['the 60-minute track\'s kept bytes', await judge(TRACK_LIMIT, bytes, trackLoads), 'B'],
    ];
    const lines = judged.map(([what, j, unit]) => line(what, j, unit));
    console.log(`${AC[7]}:\n  ${lines.join('\n  ')}`);
    expect(lines.filter((_, i) => judged[i]![1].status === 'FAIL'), 'no budget fails').toEqual([]);
    const notRun = lines.filter((_, i) => judged[i]![1].status === 'BLOCKED');
    if (notRun.length) blocked(notRun.join('; '));
    const open = lines.filter((_, i) => judged[i]![1].status !== 'PASS');
    if (open.length) inconclusive(open.join('; '));
  }, TIMEOUT * 2);
});
