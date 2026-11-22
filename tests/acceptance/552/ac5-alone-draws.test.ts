// AC5 #552.eff354f2: The dice piece played alone in a replica twice from one seed rolls the same 200 values both times,
// with no commitment on its track; a planted module that takes a lone piece's bits from the secure source rolls other
// values the second time and fails, naming the first step that differs; and replayed with its 50th attack and every
// later entry stamped one step later, it rolls the same 200 values, while a planted draw that hashes the step in place
// of the draw's number rolls other values from the 50th attack on and fails, naming that draw
//
// The replica is #184's `deep-drive` play mode, built with `env-plants`: `{call: "play", document, assets, seed: 552,
// span: {steps: 900}, track, values}` plays criterion 3's dice piece (with draw_after) alone, given a track of 200
// attacks by player 1, attack n at step 10 + 4n, with no bot (README: The replica). Its bits are the replica's own, at
// the step after each attack. "Replayed with its 50th attack and every later entry stamped one step later": the same
// play given that track with attacks 50 to 200 one step later; the replica writes the bits again. The plants are
// DEEP_DRIVE_PLANT's `alone-bits-from-secure` and `draw-hashes-step` (README: Planted twins). The first attack lands at
// step 10, so its bits, and a lone piece's first draw, come at step 11. Wrong programs it fails: the merge base (no
// net.draws); a lone piece that commits, takes no bits, takes them from the clock or the secure source, or draws
// from the step; a draw off the recorded track.
import { describe, it } from 'vitest';
import { ALONE_STEPS, ATTACKS, DICE, MOVED_FROM, aloneStep, aloneTrack, diceDoc, diceProgram } from './fixtures.ts';
import { AC, TIMEOUT, drawKind, drivePlay, failsNaming, isObject, none, playedOf, show, stampOf, useDrive, type Dice } from './helpers.ts';
import type { DrivePlant, JsonObject } from './fixtures.ts';

const drive = useDrive();
const FIRST_DRAW_STEP = aloneStep(0) + 1;

async function play(what: string, o: { moved?: boolean; plant?: DrivePlant } = {}): Promise<ReturnType<typeof playedOf>> {
  const program = diceProgram();
  const call: JsonObject = {
    call: 'play', document: diceDoc(program), assets: { [program.sha]: program.bytes.toString('base64') }, seed: 552, span: { steps: ALONE_STEPS },
    track: aloneTrack({ moved: o.moved === true }), values: ['count', 'drawn', 'hi', 'lo', 'roll', 'step'].map((n) => `${DICE}.${n}`), frames: [],
  };
  return playedOf(await drivePlay(drive(), call, what, o.plant), what);
}
/** Two plays from one seed: every step's arrays alike; a failure names the first step that differs. */
function twiceFailures(a: string[], b: string[], what: string): string[] {
  const k = a.findIndex((x, i) => x !== b[i]);
  if (a.length !== b.length) return [`${what}: the plays ran ${a.length} and ${b.length} steps`];
  return k < 0 ? [] : [`${what}: the second play rolls other values, first at step ${k}`];
}
/** The moved replay against the first play, attack by attack: the same roll and draw for each, its step moved from
 * the 50th; a failure names the first draw (by its number) that differs. */
function movedFailures(first: Dice, moved: Dice, what: string): string[] {
  const f: string[] = [];
  for (let n = 0; n < ATTACKS; n++) {
    const shift = n + 1 >= MOVED_FROM ? 1 : 0;
    if (moved.step[n] !== first.step[n]! + shift) { f.push(`${what}: attack ${n + 1} is read at step ${moved.step[n]}, not ${first.step[n]! + shift}`); break; }
  }
  const n = first.roll.findIndex((r, i) => r !== moved.roll[i] || first.lo[i] !== moved.lo[i] || first.hi[i] !== moved.hi[i]);
  if (n >= 0) f.push(`${what}: draw ${n + 1} (attack ${n + 1}'s) differs: roll ${first.roll[n]} became ${moved.roll[n]}, bits ${first.hi[n]}:${first.lo[n]} became ${moved.hi[n]}:${moved.lo[n]}`);
  return f;
}
/** A lone piece's track: no commitment; one reveal for each attack, player 1's, by `net`, at the next step, naming the
 * attack's step; every attack resolved by a draw. */
function trackFailures(entries: JsonObject[], last: Dice, what: string): string[] {
  const f: string[] = [];
  const commits = entries.filter((e) => drawKind(e) === 'draw.commit');
  if (commits.length) f.push(`${what}: the track holds ${commits.length} commitments, the first ${show(commits[0], 300)}`);
  const reveals = entries.filter((e) => drawKind(e) === 'draw.reveal');
  if (reveals.length !== ATTACKS) f.push(`${what}: the track holds ${reveals.length} reveals, not one for each of the ${ATTACKS} attacks`);
  for (let n = 0; n < Math.min(ATTACKS, reveals.length); n++) {
    const e = reveals[n]!;
    const value = isObject(e['value']) ? e['value'] : {};
    if (e['writer'] !== 'net' || e['player'] !== 1 || stampOf(e) !== aloneStep(n) + 1 || value['step'] !== aloneStep(n)) { f.push(`${what}: reveal ${n + 1} is ${show(e, 300)}, not player 1's by net at step ${aloneStep(n) + 1} for step ${aloneStep(n)}`); break; }
  }
  if (last.count !== ATTACKS || last.drawn.some((d) => d !== 1)) f.push(`${what}: the piece counts ${last.count} attacks, ${last.drawn.filter((d) => d === 1).length} resolved by a draw, not ${ATTACKS} and ${ATTACKS}`);
  return f;
}

describe(`${AC[5]} a lone piece's draws in a replica`, () => {
  it(`${AC[5]} played alone twice from one seed it rolls the same 200 values, with no commitment on its track, and replayed with the 50th attack and every later one a step later it rolls the same 200 values`, async () => {
    const first = await play('AC5 the first play');
    const second = await play('AC5 the second play');
    const moved = await play('AC5 the moved replay', { moved: true });
    none([
      ...trackFailures(first.entries, first.last, 'AC5 the first play'),
      ...twiceFailures(first.steps, second.steps, 'AC5'),
      ...movedFailures(first.last, moved.last, 'AC5 the moved replay'),
    ], 'a lone piece draws the same 200 rolls from one seed, with no commitment, and keeps them when its actions move');
  }, TIMEOUT);

  it(`${AC[5]} a planted module that takes a lone piece's bits from the secure source rolls other values the second time and fails, naming step ${FIRST_DRAW_STEP}`, async () => {
    const first = await play('AC5 planted: the first play', { plant: 'alone-bits-from-secure' });
    const second = await play('AC5 planted: the second play', { plant: 'alone-bits-from-secure' });
    failsNaming(twiceFailures(first.steps, second.steps, 'AC5 planted'), [new RegExp(`first at step ${FIRST_DRAW_STEP}$`)], 'the lone piece whose bits come from the secure source');
  }, TIMEOUT);

  it(`${AC[5]} a planted draw that hashes the step in place of the draw's number rolls other values from the 50th attack on and fails, naming that draw`, async () => {
    const first = await play('AC5 planted: the first play', { plant: 'draw-hashes-step' });
    const moved = await play('AC5 planted: the moved replay', { moved: true, plant: 'draw-hashes-step' });
    failsNaming(movedFailures(first.last, moved.last, 'AC5 planted'), [new RegExp(`draw ${MOVED_FROM} \\(attack ${MOVED_FROM}'s\\) differs`)], 'the draw that hashes the step');
  }, TIMEOUT);
});
