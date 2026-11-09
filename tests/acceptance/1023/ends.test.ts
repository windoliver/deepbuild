// #1023's AC1 and AC2 on one replay (README): three Codex CLI sessions ended with Ctrl-C, run 2 after a SessionEnd
// {reason: "other"}, runs 1 and 3 with none. Each is read as its session's end; the two without a SessionEnd show closed
// in `deep hub status` within a minute of their process ending, and run 3's waiting answer goes by its task.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanup } from '../39/helpers.ts';
import { AC, byTask, closedInTime, endRead, replay, type World } from './replay.ts';

let world: World;
beforeAll(async () => { world = await replay(); }, 600_000);
afterAll(cleanup, 60_000);
const run = (n: 1 | 2 | 3) => world.runs.find((r) => r.n === n)!;

describe('three Ctrl-C ends of a Codex CLI session', () => {
  it(`${AC[1]} each of the three ends is read as its session's end: run 2 by its SessionEnd's reason, runs 1 and 3 by the hub from the process's exit, with a reading saying so`, () => {
    const fails = world.runs.map((r) => endRead(world.events, r)).filter(Boolean);
    expect(fails, fails.join('\n')).toEqual([]);
  });

  it(`${AC[2]} a session ended with no SessionEnd shows closed in deep hub status within a minute of its process ending`, () => {
    const fails = [run(1), run(3)].map(closedInTime).filter(Boolean);
    expect(fails, fails.join('\n')).toEqual([]);
  });

  it(`${AC[2]} the answer waiting for a session ended with no SessionEnd goes by its task, not by a resume`, () => {
    const fail = byTask(world.events, run(3));
    expect(fail, fail).toBeUndefined();
  });
});
