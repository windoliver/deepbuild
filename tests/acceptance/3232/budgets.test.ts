// AC11: budgets, on the reference Mac in the local preflight, compared with the merge base: a window with 30 quiet
// sessions adds no announcement and no wakeup over 60 s (#2680).
//
// A real hub's record with 30 sessions in three projects, each stopped hours ago with nothing since, and no open ask.
// The replica draws only the frames a real window would (`launch.frames: "dirty"`, #1546), and each frame of its
// clock is reported with whether it drew and what it told (#1482). Sixty seconds of its clock pass with no input and
// no event, a frame each 60th of a second.
// - No announcement: the snapshot's announcements are the same before and after. It names no time, so it runs on any
//   Mac.
// - No wakeup: a frame that drew or told an entity in those 60 s is a wakeup. None is a pass anywhere. A count above
//   none is judged against the merge base's own count over the same record, built only then and only on a fit
//   reference Mac (design: The reference Macs); anywhere else it reads INCONCLUSIVE, never PASS, and nothing is built.
import { afterAll, describe, expect, it } from 'vitest';
import { makeWorld } from '../2018/helpers.ts';
import { BASE, baseDrive, blocked, cleanup, inconclusive, machineProblem, MIN, SECOND, Stage, type World } from './helpers.ts';
import { ID, noneAdded, said, wakeups, type Frame, type Read } from './judges.ts';

afterAll(cleanup, 5 * MIN);
const SESSIONS = 30;
const IDLE_MS = 60 * SECOND;
const HOUR = 60 * MIN;
const PROJECTS = ['docs', 'shop', 'web'] as const;

/** Thirty sessions, ten a project, each stopped three and a half hours ago, two seconds apart: no time the window draws turns over within the minute. */
const quietWorld = (): Promise<World> => makeWorld({
  repos: PROJECTS,
  seed: async (s, T) => {
    for (let i = 0; i < SESSIONS; i++) {
      const key = `s${i}`;
      const at = T - 3 * HOUR - 30 * MIN + i * 2 * SECOND;
      await s.start(key, PROJECTS[i % PROJECTS.length]!, at);
      await s.task(key, `Quiet task ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? 'b' : 'a'}`, at + 200);
      await s.prompt(key, 'tidy up', at + 400);
      await s.stop(key, at + 800, false);
    }
  },
});

interface Idle { before: Read; after: Read; woke: Frame[] }
/** Sixty idle seconds of the window over the world's record, in this checkout's replica or `bin`'s. */
async function idle(w: World, bin?: string): Promise<Idle> {
  const stage = await Stage.on(w, { launch: { frames: 'dirty', read_back: 'off' }, ...(bin ? { bin } : {}) });
  try {
    const rows = (await stage.d.see()).rows.filter((r) => String(r.id).startsWith('session:'));
    if (rows.length !== SESSIONS) blocked(`the fixture didn't hold: the window's list holds ${rows.length} sessions, not ${SESSIONS}`);
    await stage.d.wait(3 * SECOND);
    const before = await stage.read();
    const from = stage.d.t;
    await stage.d.wait(IDLE_MS);
    const to = stage.d.t;
    const after = await stage.read();
    const frames = (await stage.d.close()).frames ?? blocked('close gave no frames report for a replica launched with frames: "dirty"');
    return { before, after, woke: wakeups(frames, from, to) };
  } finally {
    await stage.stop();
  }
}

describe(`AC11 ${ID.budgets} an idle window says nothing and wakes for nothing`, () => {
  it(`AC11 ${ID.budgets}: a window with 30 quiet sessions adds no announcement and no wakeup over 60 s, compared with the merge base, on the reference Mac in the local preflight`, async () => {
    const w = await quietWorld();
    const ours = await idle(w);
    expect(noneAdded({ what: `60 s of a window with ${SESSIONS} quiet sessions and no event`, before: ours.before, after: ours.after })).toEqual([]);
    console.log(`AC11 idle: ${ours.woke.length} wakeups in 60 s of the replica's clock: ${said(ours.woke.map((f) => ({ t: f.t, drawn: f.drawn, notified: f.notified })), 600)}`);
    if (ours.woke.length === 0) return;
    // A count above none is the merge base's to compare with, over the same record, on a fit reference Mac only.
    const problem = await machineProblem();
    if (problem) inconclusive(`the idle window woke ${ours.woke.length} times in 60 s, and the merge base's count is read only on a fit reference Mac in the local preflight (${problem}); nothing was built or compared`);
    const theirs = await idle(w, await baseDrive());
    console.log(`AC11 idle at the merge base ${BASE.slice(0, 12)}: ${theirs.woke.length} wakeups in 60 s`);
    expect(ours.woke.length, `the idle window wakes ${ours.woke.length} times in 60 s where the merge base's wakes ${theirs.woke.length}: ${said(ours.woke, 600)}`).toBeLessThanOrEqual(theirs.woke.length);
  }, 720 * MIN);
});
