// The scenarios of criterion 14 and the Scope's resume-skip line, shared by their tests and plants.test.ts: each opens
// its own world (tests/acceptance/85/helpers.ts), with the planted wrong program when one is given, and closes it.
// Every window runs on the virtual clock.

import { expect } from 'vitest';
import { core, hook, inWorld, isObj, MINUTE, nothingTyped, openTasks, provesOf, SECOND, seqAt, STOPS, T0, theOneTask, ulid, YOU, type Planting, type StopInput } from '../helpers.ts';
import { FIVE, rowShowsCause } from '../scenarios.ts';

/** A turn that ended normally: Claude Code's Stop hook, `outcome: finished`, no block (its cause is the closed set's `unknown`), the turn did work (agent.stop@4 fixture 01). */
export const FINISHED: StopInput = { cause: 'unknown', outcome: 'finished', did_work: true, claim: true };

/**
 * Criterion 14: continues are counted per session since its last turn that ended normally. Two transient stops in a
 * row with no normal turn end between them: the first gets the one continue, the second none, and the row shows its
 * cause; a turn that ends normally resets the count, so the next transient stop gets one again, and the one after it
 * none. Nothing is typed in the whole scenario, so a rule that resets only on a prompt you typed fails at the stop
 * after the normal end.
 */
export const countedSinceNormalEnd = (plant?: Planting): Promise<void> =>
  inWorld(plant, async (w) => {
    await w.start('S', 'TS');
    const first = await w.stop('S', STOPS.dropped());
    await w.at(T0 + 5 * SECOND);
    expect((await w.continued('S')).map((c) => [c.because, c.stop]), `the first transient stop (${first}) gets the one automatic continue`).toEqual([['transient', first]]);

    const second = await w.stop('S', { ...STOPS.overloaded(), at: T0 + MINUTE });
    await w.at(T0 + MINUTE + 5 * SECOND);
    expect((await w.continued('S')).map((c) => c.stop), `the second transient stop (${second}), right after a continue with no normal turn end between them, gets none`).toEqual([first]);
    await rowShowsCause(w, 'S', 'rate_limited', 'stopped a second time');
    expect(await openTasks(w), 'a transient stop is no task for you').toEqual([]);
    expect(await w.asks.needsYou(), 'nothing reaches Needs you').toEqual([]);

    // The turn the agent then ran ended normally: a Stop, outcome finished.
    const ended = await w.stop('S', { ...FINISHED, at: T0 + 2 * MINUTE });
    await w.at(T0 + 2 * MINUTE + 5 * SECOND);
    expect((await w.continued('S')).map((c) => c.stop), `a turn that ended normally (stop ${ended}) is never continued`).toEqual([first]);
    await rowShowsCause(w, 'S', 'unknown', 'ended normally');

    const third = await w.stop('S', { ...STOPS.dropped(), at: T0 + 3 * MINUTE });
    await w.at(T0 + 3 * MINUTE + 5 * SECOND);
    expect((await w.continued('S')).map((c) => c.stop), `after a turn that ended normally, the next transient stop (${third}) gets one again`).toEqual([first, third]);

    const fourth = await w.stop('S', { ...STOPS.dropped(), at: T0 + 4 * MINUTE });
    await w.at(T0 + 4 * MINUTE + 5 * SECOND);
    expect((await w.continued('S')).map((c) => c.stop), `the transient stop after that (${fourth}), with no normal end since the continue, gets none: the count is per session since its last normal end`).toEqual([first, third]);
    await rowShowsCause(w, 'S', 'timed_out', 'stopped a fourth time');
    await nothingTyped(w, 'the counted continues');
  });

/** The sessions the Scope line names, beside two that resume: S1 and S5 resume; S2 you stopped, S3's attempt was replaced, S4's task closed. */
export const SKIPPED = { stopped: 'S2', replaced: 'S3', closed: 'S4' } as const;
const RESUMING = ['S1', 'S5'];

/**
 * The Scope line: a resume on a shared task skips a session you paused or stopped, one whose attempt was replaced, and
 * one whose task closed, and records why. Five sessions share a sign-in task; before its check passes, S2 ends
 * (session.end), S3 is replaced by S3b (session.start@4 with `parent: S3`) and S4's task closes (task.closed on the
 * task its prompt opened). The check passes: S1 and S5 resume; S2, S3 and S4 get no session.continued, and each has
 * a session.reading naming the task. "Paused" has no event in the record at the base and isn't driven (README).
 */
export const resumeSkips = (plant?: Planting): Promise<void> =>
  inWorld(plant, async (w) => {
    const stops = new Map<string, string>();
    for (const [i, s] of FIVE.entries()) {
      await w.start(s, `T${i + 1}`);
      stops.set(s, await w.stop(s, { ...STOPS.signIn(), at: T0 + i * SECOND }));
      await w.at(T0 + i * SECOND + SECOND);
    }
    const task = await theOneTask(w, FIVE, 'a revoked sign-in, five sessions stopped');
    // S4's prompt had opened a task of its own, as every prompt that asks for behaviour does.
    const s4Task = `session:${SKIPPED.closed}#1`;
    await w.record.append(core(SKIPPED.closed), { v: 1, id: ulid(T0 + 10 * SECOND), kind: 'task.created', subject: s4Task, ts: T0 + 10 * SECOND, data: { task_ref: s4Task, thread: 'T4', owner: YOU, title: 'Fix the cart total' } });

    // Before the check passes: you stop S2; S3's attempt is replaced; S4's task closes by a verdict.
    const at = T0 + MINUTE;
    await w.record.append(hook(SKIPPED.stopped), { v: 1, id: ulid(at), kind: 'session.end', subject: `session:${SKIPPED.stopped}`, ts: at, seq: seqAt(at), data: { reason: 'prompt_input_exit' } });
    await w.record.append(hook('S3b'), { v: 4, id: ulid(at + 1), kind: 'session.start', ts: at + 1, seq: seqAt(at + 1), data: { agent: 'claude-code', worktree: `${w.dir}/no-repo`, branch: 'main', thread: 'T3', loads: [], parent: SKIPPED.replaced } });
    await w.record.append(core(SKIPPED.closed), { v: 1, id: ulid(at + 2), kind: 'task.closed', subject: s4Task, ts: at + 2, data: { by_verdict: `verdict:${ulid(at + 2)}` } });
    await w.at(at + 5 * SECOND);
    expect(await w.continued(), 'nothing resumes before the check passes').toEqual([]);

    const passedAt = T0 + 5 * MINUTE;
    w.clock.set(passedAt);
    await w.passed(await provesOf(w, task));
    await w.at(passedAt + 30 * SECOND);
    expect((await w.events('ask.moot')).map((e) => e.subject), `task ${task} closes when its check passes`).toContain(task);
    const resumed = await w.continued();
    expect(resumed.map((c) => c.session).sort(), 'the sessions still blocked by the sign-in resume; you stopped S2, S3 was replaced and S4\'s task closed, so the resume skips them').toEqual([...RESUMING].sort());
    for (const c of resumed) {
      expect(c.because, `session ${c.session} resumes because its task closed`).toBe('task_closed');
      expect(c.stop, `session ${c.session} resumes from its stop`).toBe(stops.get(c.session));
    }
    // And records why: a reading on each skipped session naming the task.
    const readings = (await w.events('session.reading')).map((e) => ({ session: e.session ?? String(e.subject ?? '').replace(/^session:/, ''), text: isObj(e.data) ? String(e.data.reading ?? '') : '' }));
    for (const [why, s] of Object.entries(SKIPPED)) {
      const about = readings.filter((r) => r.session === s && r.text.includes(task));
      expect(about.length, `the resume records why it skipped session ${s} (${why}): a session.reading on it naming task ${task}; readings: ${JSON.stringify(readings)}`).toBeGreaterThan(0);
    }
    await nothingTyped(w, 'the resume');
  });
