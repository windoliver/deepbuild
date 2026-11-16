// #522.ef486477: "In the ball-and-goal lab with eight recorded grabs, scrubbing back and forth across the run 50 times
// reads the bake and never steps the world, leaving the input track's hash, its eight grabs and the bake's key
// unchanged; one grab after a seek back to 2 s forks the track at its step, drops the grabs after it and re-simulates
// only from the checkpoint at or before 2 s, every step before the fork keeping its step hash; and a planted transport
// that forks on a scrub alone changes the bake's key on the first scrub and fails"
//
// The lab (README: Worlds) with its eight grabs at steps 60, 180, …, 900, each released 24 steps later, baked 10 s
// (1,200 steps, a checkpoint every 60) into a store; a view of the same world and track over 10 s with that store is a
// baked session (README: `view`). Fifty scrub frames go back and forth across the run, to steps 1,180, 31, 1,158,
// 53, …; each must read the bake (no step, no restore, the bake's step hash at its step) and leave the track's hash,
// its entries and the key as the view opened them. A seek frame to step 240 (2 s), then a frame with a new grab: it is
// stamped at step 241 (the playhead plus one step's input lead), forks the track there, drops the 12 entries after it
// (six grabs and their releases), restores the checkpoint at step 240 and re-simulates the 960 steps to the end,
// keeping the new bake under its new key; that bake's step hashes 0 … 240 are the first bake's, and all of them a
// straight bake's of the forked track. `--planted fork_on_scrub` forks the track at a scrub alone.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, EIGHT_GRABS, LAB_STEPS, TIMEOUT, ask, bakeCall, caught, entryText, hashesOf, keyOf, lab, live, none, open, prebuild, scratch,
  show, type Frame, type JsonObject, type Opened, type Planted,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[4];
const SPAN = 10;
const TWO = 240;
const STAMP = TWO + 1;
const SCRUBS = Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? LAB_STEPS - 20 - 11 * i : 20 + 11 * i));
const GRAB: JsonObject = { kind: 'grab', target: 'ball', data: { point: [0, 0, 0], plane: 'ground' } };
const grabs = (track: readonly JsonObject[]): JsonObject[] => track.filter((e) => e['kind'] === 'grab');

interface Ran { key: string; straight: string[]; opened: Opened; scrubs: Frame[]; seek: Frame; fork: Frame; store: string }
async function ran(planted?: Planted): Promise<Ran> {
  const store = scratch('ac4');
  const [baked] = ask([bakeCall(lab(), EIGHT_GRABS, LAB_STEPS, { store })]);
  const straight = hashesOf(baked, 'the lab\'s bake');
  const key = keyOf(baked!, 'the lab\'s bake');
  const l = live(planted);
  try {
    const { s, opened } = await open(l, lab(), EIGHT_GRABS, SPAN, store);
    const scrubs: Frame[] = [];
    for (const k of SCRUBS) scrubs.push(await s.frame({ scrub: k }));
    const seek = await s.frame({ seek: TWO });
    const fork = await s.frame({ input: GRAB });
    return { key, straight, opened, scrubs, seek, fork, store };
  } finally { l.stop(); }
}
/** Each scrub reads the bake and changes nothing: a failure names the scrub, its step and what changed. */
function scrubFailures(r: Ran): string[] {
  const f: string[] = [];
  r.scrubs.forEach((fr, i) => {
    const at = `scrub ${i + 1} (to step ${SCRUBS[i]})`;
    if (fr.key !== r.key) f.push(`${at}: the bake's key changed from ${r.key} to ${fr.key}`);
    if (fr.trackHash !== r.opened.trackHash) f.push(`${at}: the input track's hash changed from ${r.opened.trackHash} to ${fr.trackHash}`);
    if (grabs(fr.track).length !== 8 || JSON.stringify(fr.track) !== JSON.stringify(r.opened.track)) f.push(`${at}: the track holds ${grabs(fr.track).length} grabs and ${fr.track.length} entries, not its eight grabs as recorded`);
    if (fr.steps !== 0) f.push(`${at}: the world stepped ${fr.steps} steps`);
    if (fr.restored !== null) f.push(`${at}: it restored the checkpoint at step ${fr.restored}`);
    if (fr.stale || fr.at !== SCRUBS[i]) f.push(`${at}: it shows step ${fr.at}${fr.stale ? ', stale' : ''}`);
    else if (fr.stepHash !== r.straight[fr.at]) f.push(`${at}: it shows a state whose step hash isn't the bake's at step ${fr.at}`);
  });
  return f;
}

describe(`${ID} scrubbing reads the bake and keeps the track; a grab after a seek back forks it and re-simulates from the checkpoint at or before 2 s`, () => {
  it(`${ID} 50 scrubs back and forth read the bake, never step, and leave the track's hash, its eight grabs and the bake's key unchanged; a grab after a seek back to 2 s forks at its step, drops the later grabs and re-simulates only from the checkpoint at step ${TWO}`, async () => {
    const r = await ran();
    expect([r.opened.baked, r.opened.key], 'the view plays the stored bake, under its key').toEqual([true, r.key]);
    expect(grabs(r.opened.track).length, 'the track holds the eight recorded grabs').toBe(8);
    none(scrubFailures(r), 'the 50 scrubs');
    expect([r.seek.at, r.seek.steps, r.seek.key], 'the seek back to 2 s reads the bake too').toEqual([TWO, 0, r.key]);

    const f = r.fork;
    expect(f.stamped, 'the grab is stamped on the track').not.toBeNull();
    expect([f.stamped!['step'], f.stamped!['kind'], f.stamped!['target']], `at step ${STAMP}, the playhead plus one step's input lead`).toEqual([STAMP, 'grab', 'ball']);
    expect(f.forkAt, 'it forks the track at its step').toBe(STAMP);
    const later = EIGHT_GRABS.filter((e) => (e['step'] as number) > STAMP);
    expect(f.dropped.map(entryText), 'and drops the entries after it: six grabs and their releases').toEqual(later.map(entryText));
    expect(f.track.map(entryText), 'the forked track: the entries up to the fork, then the new grab').toEqual([...EIGHT_GRABS.filter((e) => (e['step'] as number) <= STAMP), f.stamped!].map(entryText));
    expect(f.key, 'the fork changes the bake\'s key').not.toBe(r.key);
    expect(f.restored, `it re-simulates from the checkpoint at or before 2 s, step ${TWO}`).toBe(TWO);
    expect(f.steps, `only from there: the ${LAB_STEPS - TWO} steps to the end`).toBe(LAB_STEPS - TWO);

    const [kept, fresh] = ask([bakeCall(lab(), f.track, LAB_STEPS, { store: r.store }), bakeCall(lab(), f.track, LAB_STEPS)]);
    expect([kept!['reused'], keyOf(kept!, 'the forked bake')], 'the re-simulated bake is kept in the store under the new key').toEqual([true, f.key]);
    const resim = hashesOf(kept, 'the re-simulated bake');
    expect(resim.slice(0, TWO + 1), `every step before the fork keeps its step hash (0 … ${TWO})`).toEqual(r.straight.slice(0, TWO + 1));
    expect(resim, 'and the re-simulated bake is a straight bake of the forked track').toEqual(hashesOf(fresh, 'a straight bake of the forked track'));
  }, TIMEOUT);

  it(`${ID} a planted transport that forks on a scrub alone (fork_on_scrub) changes the bake's key on the first scrub and fails`, async () => {
    const r = await ran('fork_on_scrub');
    expect(r.scrubs[0]!.key, 'the first scrub changes the bake\'s key').not.toBe(r.key);
    const failures = scrubFailures(r);
    caught(failures, 'fork_on_scrub');
    expect(failures[0], `the judge fails at the first scrub, naming the key: ${show(failures.slice(0, 3))}`).toMatch(/^scrub 1 \(to step \d+\): the bake's key changed/);
  }, TIMEOUT);
});
