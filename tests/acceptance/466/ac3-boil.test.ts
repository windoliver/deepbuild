// AC3 #466.4f5a25b8: A boil with cycle 3 at 12 Hz repeats its drawing exactly every 0.25 s, and the flicker check
// passes it while still failing a seed that follows playback.
//
// A 320 × 180 film at 60 fps, 2 s: a zigzag `path@1` stroked in ink on the ground, under the clean look with
// `time.boil: {hz: 12, amount_px: 2, scope: "all", while: "always", cycle: 3, seed: "item"}`, so the seed is
// ⌊t × 12⌋ mod 3 (Look `look@1`: time).
//   - The drawing: through `deep-show run` (`full`), #387's `eval` with `pixels` at frames 0 to 104 in order, then the
//     same times in a seeded order (a seek to each): the snapshot's SHA-256 at frame n equals frame n + 15's (0.25 s
//     later) for every n to 89; one period (frames 0 to 14) holds exactly three drawings, frames 0, 5 and 10 (seeds 0, 1,
//     2); and each time draws the same bytes sought as played. The planted `boil_ignores_cycle` (seed ⌊t × 12⌋, no
//     cycle) never repeats, and the same judge fails, naming frames 0 and 15.
//   - The flicker check: the film judged by a claim whose requirement is `{kind: "film.flicker"}` (#407's verdict)
//     PASSes with no error or warning; under the planted `boil_seed_follows_playback` (the boil's seed counts the frames
//     drawn since playback began) the same judge fails, the row FAILing with `film.reseed` naming the boil.
import { describe, expect, it } from 'vitest';
import { FLICKER, docId, judge, passFailures } from '../407/helpers.ts';
import {
  AC, DOC, FRAME60, FULL, TIMEOUT, asStored, camera2d, evalCall, failsNaming, film, lookFrom, none, present, presented, rect, show1, shuffled, snapshotOf,
  useEvidence, useShow, withLook, type JsonObject, type Planted,
} from './helpers.ts';

const shows = useShow([FULL]);
const evidence = useEvidence();
const FRAMES = 105;

const boilLook = (): JsonObject => {
  const l = lookFrom('boil-cycle');
  return { ...l, time: { ...(l['time'] as JsonObject), boil: { hz: 12, amount_px: 2, scope: 'all', while: 'always', cycle: 3, seed: 'item' } } };
};
function boilFilm(id = 'boil'): JsonObject {
  const line: JsonObject = { id: 'line', kind: 'path@1', name: 'Zigzag', order: 'c1', params: { d: 'M 40 140 L 100 40 L 160 140 L 220 40 L 280 140', paint: { stroke: { role: 'ink', width: 3 } } } };
  const doc = film(id, [camera2d([320, 180]), rect('back', [0, 0, 320, 180], 'ground'), line], {}, { span: '2s', frame_rate: '60/1' }, [320, 180]);
  return withLook(evidence(), doc, { 'boil-cycle': boilLook() }, 'boil-cycle');
}

/** What is wrong with the drawing's cycle: each failure names the frames it compares. */
function cycleFailures(planted?: Planted): string[] {
  const times = Array.from({ length: FRAMES }, (_, n) => n * FRAME60);
  const order = shuffled(times.map((_, n) => n), 466);
  const calls = [present(DOC.a, boilFilm()), ...times.map((t) => evalCall(DOC.a, t, { pixels: true })), ...order.map((n) => evalCall(DOC.a, times[n]!, { pixels: true }))];
  const replies = show1(shows.bin(FULL), evidence(), calls, planted);
  presented(replies[0]!, 'the boil film');
  const played = times.map((_, n) => snapshotOf(replies[1 + n]!, `the boil film at frame ${n}`).sha256);
  const sought = new Map(order.map((n, k) => [n, snapshotOf(replies[1 + FRAMES + k]!, `the boil film sought to frame ${n}`).sha256]));
  const failures: string[] = [];
  for (let n = 0; n + 15 < FRAMES; n++) if (played[n] !== played[n + 15]) failures.push(`frames ${n} and ${n + 15}, 0.25 s apart, draw different pictures`);
  const period = new Set(played.slice(0, 15));
  if (period.size !== 3) failures.push(`frames 0 to 14, one period of 0.25 s, hold ${period.size} drawings, not 3`);
  if (new Set([played[0], played[5], played[10]]).size !== 3) failures.push('frames 0, 5 and 10 (seeds 0, 1 and 2) are not three different drawings');
  for (let n = 0; n < FRAMES; n++) if (sought.get(n) !== played[n]) failures.push(`frame ${n} sought draws ${String(sought.get(n)).slice(0, 12)}, played ${played[n]!.slice(0, 12)}`);
  return failures;
}
/** The flicker check's row on the boil film: PASS with nothing raised, or what it raised. */
function flickerFailures(planted?: Planted): string[] {
  const doc = asStored(boilFilm(), docId(1));
  const { judged } = judge(shows.bin(FULL), evidence(), [{ name: 'the boil film', doc: docId(1), document: doc, check: FLICKER }], planted ? { planted } : {});
  return passFailures(judged['the boil film']?.row, 'the flicker check on the boil film');
}

describe(`${AC[3]} a boil of three drawings at 12 Hz`, () => {
  it(`${AC[3]} the drawing repeats exactly every 0.25 s, three drawings a period, and each time draws the same sought as played`, () => {
    none(cycleFailures(), 'the boil\'s cycle');
  }, TIMEOUT);

  it(`${AC[3]} (planted) a boil whose seed ignores its cycle never repeats and fails, naming the frames`, () => {
    failsNaming(cycleFailures('boil_ignores_cycle'), ['frames 0 and 15'], 'the planted boil_ignores_cycle');
  }, TIMEOUT);

  it(`${AC[3]} the flicker check passes the boil`, () => {
    none(flickerFailures(), 'the flicker check on the boil');
  }, TIMEOUT);

  it(`${AC[3]} (planted) the flicker check fails a boil whose seed follows playback, naming film.reseed and the boil`, () => {
    const failures = flickerFailures('boil_seed_follows_playback');
    failsNaming(failures, ['FAIL', 'film.reseed', 'boil'], 'the planted boil_seed_follows_playback');
    expect(failures.join(' '), 'the row is FAIL, not INCONCLUSIVE or BLOCKED').toContain('is FAIL');
  }, TIMEOUT);
});
