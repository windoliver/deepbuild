// AC3 #851.b6cf2eb0: "A run paused at step 1,200 for 30 s of wall clock and resumed reaches the same full-state hash at
// step 3,600 as a run never paused; a planted pause that lets the level clock run fails, naming the first step that
// differs"
//
// The fixture shell's pause journey with keys at the reference window, its input's pause {at: 1,200, hold: 30 s, to:
// 3,600}, passes. It plays level 1 twice in the replica: one play never pauses, and in the other every row that holds
// `paused` holds level 1 at level step 1,200, for at least 30 s of the shell's 60 steps a second (1,800 rows). Level 1
// collects at its steps 600, 1,800 and 3,000, so its state moves on both sides of the pause. The full-state hash at a
// level step is the hash of the first row at which level 1 reached it, and both plays' hashes at 3,600 are equal.
// On a replica planted with DEEP_DRIVE_PLANT=pause-runs-level-clock, a paused row holds a level step past 1,200; the
// first level step whose hashes differ between the two plays, as the replica returned them, lies in (1,200, 3,600], and
// the journey fails shell.pause, naming that step.
// The wrong programs: the base, a shell that steps the level behind the pause screen, one that drops the level's
// entries while paused, and a journey that compares only the step reached and not its hash.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, HEX, PAUSE, REFERENCE, SHELL_HZ, TIMEOUT, devicePlays, failuresOf, hashAtLevelStep, hubOnce, journeysInput, macOnly, passed, putShell, rest,
  runJourneys, shown, stepped, word, type Hub, type ShellReply,
} from './helpers.ts';
import { allPrograms, programs, shellDocument } from './shell.ts';

const clean = hubOnce();
const planted = hubOnce({ plant: 'pause-runs-level-clock' });

/** The pause journey's two plays of level 1: the one never paused and the one whose rows hold `paused`. */
async function pauseRuns(h: Hub): Promise<{ result: Awaited<ReturnType<typeof runJourneys>>; never: ShellReply; paused: ShellReply }> {
  const p = programs();
  const piece = putShell(DOC.shell, shellDocument(p), allPrograms(p));
  const result = await runJourneys(h, journeysInput(piece, { journeys: ['pause'], devices: ['keys'], sizes: [REFERENCE] }));
  const plays = devicePlays(h.pool, piece, 'pause', ['keys'], REFERENCE).get('keys')!;
  const never = plays.filter((r) => !stepped(r, 'a pause play').some((x) => x.paused));
  const paused = plays.filter((r) => r.rows.some((x) => x.paused));
  expect([never.length, paused.length], 'the pause journey played level 1 once never paused and once paused').toEqual([1, 1]);
  return { result, never: never[0]!, paused: paused[0]! };
}
/** The first level step in 0..3,600 whose full-state hashes differ between two plays of level 1, or -1. */
function firstDiffering(a: ShellReply, b: ShellReply): number {
  for (let k = 0; k <= PAUSE.to; k++) if (hashAtLevelStep(a.rows, 0, k) !== hashAtLevelStep(b.rows, 0, k)) return k;
  return -1;
}

describe(`${AC[3]} a run paused at step 1,200 for 30 s reaches the same full-state hash at step 3,600 as one never paused`, () => {
  it(`${AC[3]} paused at level step 1,200 for 30 s and resumed, level 1 reaches the never-paused run's full-state hash at level step 3,600`, async () => {
    macOnly();
    const { result, never, paused } = await pauseRuns(await clean());
    passed(result, 'the fixture shell\'s pause journey with keys');
    const held = paused.rows.filter((x) => x.paused);
    expect(held.length, `the paused run holds pause for 30 s of the shell's steps (${PAUSE.hold * SHELL_HZ})`).toBeGreaterThanOrEqual(PAUSE.hold * SHELL_HZ);
    expect([...new Set(held.map((x) => `level ${x.level} step ${x.level_step}`))], 'while paused, level 1\'s clock holds at step 1,200').toEqual([`level 0 step ${PAUSE.at}`]);
    const a = hashAtLevelStep(never.rows, 0, PAUSE.to);
    expect(a, 'the never-paused run reaches level step 3,600 with a full-state hash').toMatch(HEX);
    expect(hashAtLevelStep(paused.rows, 0, PAUSE.to), 'the paused run reaches the same full-state hash at level step 3,600').toBe(a);
  }, TIMEOUT);

  it(`${AC[3]} a planted pause that lets the level clock run fails shell.pause, naming the first level step whose hashes differ`, async () => {
    macOnly();
    const { result, never, paused } = await pauseRuns(await planted());
    expect(paused.rows.some((x) => x.paused && x.level_step > PAUSE.at), 'on the planted replica, level 1\'s clock runs while paused').toBe(true);
    const k = firstDiffering(never, paused);
    expect(k, 'the plays\' hashes first differ at a level step after 1,200').toBeGreaterThan(PAUSE.at);
    expect(k, 'and at or before 3,600').toBeLessThanOrEqual(PAUSE.to);
    expect(result.outcome, `the planted pause journey fails: ${shown(result)}`).toBe('failed');
    const f = failuresOf(result, 'shell.pause');
    expect(f.some((x) => word(`step ${k}`).test(rest(x.message, 'shell.pause'))), `a shell.pause failure names step ${k}: ${shown(result)}`).toBe(true);
  }, TIMEOUT);
});
