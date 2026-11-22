// Criterion 1: "A piece that writes xp 1200 into its profile at step 900 and is then closed starts its next session
// with 1200 in its read region at step 0; a replay of that session reads 1200 from its track after the stored record
// has moved on to 2000; a planted reopen that reads the store at replay time reads 2000 and fails, naming the step and
// the array"
//
// Through `deep-logic`, the app (README: The surface under test), one process per session. The hero (hero.ts) starts
// from an empty saves folder, reaches a rest point at step 900 with xp 1200 and writes its profile record; the process
// exits. The next session starts in a new process: the app reopens that record, which enters the session's track at
// step 0 by hash, and step 0 reads a u32 1, xp 1200 and the look; it rests at step 600 with xp 2000, so the stored
// record moves on to 2000. A bake of that session's track (its replay) then reads 1200 at step 0 and writes what the
// session wrote at every step, while a start after it reads 2000. The planted twin `profile_replay_reads_store` runs
// the replay; the same comparison fails on it, naming step 0 and hero.xp.
// Wrong programs it fails: the base (no profile); a record not written at its request, or not whole; a start that
// doesn't reopen it, or reads it in another order; a replay that reopens the store's newest record (the twin) or reads
// zeros; a track without the record's entry.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, bakeOf, failsNaming, kept, none, one, prebuild, useTemp, wroteWhole, type Planted, type StepRecord } from './helpers.ts';
import { HERO, SMALL, defaultLook, piece, readAt, readWith, regions, rest, session, showRead, stepZero, xpAt, type Session } from './hero.ts';

prebuild();
const temp = useTemp();

/** The check: the replay writes, at every step, what the session it replays wrote (README: Criteria to tests). */
function replayDiffers(run: StepRecord[], replay: StepRecord[]): string[] {
  const failures: string[] = [];
  for (const s of run) {
    const r = replay.find((x) => x.step === s.step);
    for (const [name, values] of Object.entries(s.arrays)) {
      const got = r?.arrays[name];
      if (JSON.stringify(got) !== JSON.stringify(values)) failures.push(`step ${s.step}, ${name}: the replay reads ${JSON.stringify(got)}, the session ${JSON.stringify(values)}`);
    }
  }
  return failures;
}

/** Session 1 (rest at 900), session 2 (rest at 600) and the replay of session 2, `planted` on the replay alone. */
function sessionsAndReplay(planted?: Planted): { dir: string; first: Session; second: Session; replay: StepRecord[] } {
  const c = regions(SMALL);
  expect(c.entries.find((e) => e.region === 'reads' && e.name === 'profile')?.size, `the read region has a profile entry of a u32 and 5 i32 (README: The read region): ${JSON.stringify(c.entries)}`).toBe(4 + 4 * (1 + SMALL.look));
  const p = piece(SMALL);
  const dir = temp();
  const first = session(p, dir, 900, [rest(900)], 'session 1 (an empty store; a rest point at step 900)');
  const second = session(p, dir, 600, [rest(600)], 'session 2 (the next session; a rest point at step 600)');
  const replay = bakeOf(one({ call: 'bake', piece: p, steps: 601, track: second.run.track, saves_dir: dir }, 'the replay of session 2: a bake of its track', planted), 'the replay of session 2').steps;
  return { dir, first, second, replay };
}

describe(`${AC[1]} the profile record reopens at the next session's step 0, and a replay reads it from its track`, () => {
  it(`${AC[1]} xp 1200 written at step 900 and the app closed: the next session reads 1200 at step 0; its replay reads 1200 from its track after the stored record has moved on to 2000`, () => {
    const { dir, first, second, replay } = sessionsAndReplay();

    // Session 1: nothing to reopen; the rest point at step 900 writes the record of xp 1200.
    expect(first.opened, 'session 1 starts from an empty store: nothing reopened, nothing damaged, no notice').toEqual({ record: null, damaged: [], notices: [] });
    expect(readAt(first.run.steps.find((s) => s.step === 900)).xpNow, 'session 1 writes xp 1200 at step 900').toBe(xpAt(0, 900));
    expect(first.run.profiles.map((w) => [w.item, w.step]), 'session 1 writes one profile record, at step 900, once the step ends').toEqual([[HERO, 900]]);
    const h1 = first.run.profiles[0]!.hash;
    wroteWhole(dir, first.run.profiles[0]!, 'session 1\'s record');

    // Session 2, after the app was closed: the record reopens at step 0 and enters its track there, by hash.
    expect(second.opened, 'session 2 reopens session 1\'s record, with nothing damaged and no notice').toEqual({ record: h1, damaged: [], notices: [] });
    const read = readAt(stepZero(second.run));
    expect(showRead(read), 'session 2\'s step 0 reads a u32 1, xp 1200 and the look in its read region').toBe(showRead(readWith(1200, defaultLook(SMALL.look))));
    expect(second.run.track.filter((e) => 'profile' in e).map((e) => [e['t'], e['profile']]), 'the record enters session 2\'s track as one entry at step 0, by hash').toEqual([[0, h1]]);
    expect(readAt(second.run.steps.find((s) => s.step === 600)).xpNow, 'session 2 writes xp 2000 at step 600').toBe(2000);
    expect(second.run.profiles.map((w) => w.step), 'session 2 writes its record at step 600: the stored record moves on to 2000').toEqual([600]);
    const h2 = second.run.profiles[0]!.hash;
    expect(h2, 'a record of other numbers').not.toBe(h1);
    wroteWhole(dir, second.run.profiles[0]!, 'session 2\'s record');
    expect(Object.keys(kept(dir)), 'the store keeps both records (the newest and the one before it)').toEqual([`${h1}.profile`, `${h2}.profile`].sort());

    // The replay of session 2 reads 1200 from its track, and writes what session 2 wrote at every step.
    expect(showRead(readAt(replay.find((s) => s.step === 0))), 'the replay\'s step 0 reads 1200 from its track').toBe(showRead(readWith(1200, defaultLook(SMALL.look))));
    expect(replay.length, 'the replay runs steps 0 to 600').toBe(601);
    none(replayDiffers(second.run.steps, replay), 'the replay writes session 2\'s arrays at every step');

    // While the store's newest record is 2000: a start now reopens it.
    const third = session(piece(SMALL), dir, 0, [], 'a start after the replay');
    expect([third.opened.record, readAt(stepZero(third.run)).xp], 'the stored record has moved on to 2000: a start reopens it').toEqual([h2, 2000]);
  }, TIMEOUT);

  it(`${AC[1]} a planted reopen that reads the store at replay time (profile_replay_reads_store) reads 2000 and fails, naming the step and the array`, () => {
    const { second, replay } = sessionsAndReplay('profile_replay_reads_store');
    expect(readAt(replay.find((s) => s.step === 0)).xpNow, 'the planted replay reads the store\'s newest record, xp 2000, at step 0').toBe(2000);
    failsNaming(replayDiffers(second.run.steps, replay), ['step 0', `${HERO}.xp`], 'the replay compared with session 2');
  }, TIMEOUT);
});
