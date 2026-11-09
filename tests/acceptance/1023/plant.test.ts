// #1023's AC3 (README): a hub that leaves a Codex session open after its process ends fails this suite, naming the
// session. The checks AC1 and AC2 run are held to it twice: on a record and status that leave a session open, and on a
// planted hub (DEEP_HUB_PLANT=codex-exit-leaves-session-open) replaying run 1, which an implementation must register.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { cleanup, type Ev } from '../39/helpers.ts';
import { AC, PLANT, leftOpen, replay, type Run, type World } from './replay.ts';

let planted: World | Error;
beforeAll(async () => { planted = await replay({ plant: PLANT, only: [1] }).catch((e: Error) => e); }, 600_000);
afterAll(cleanup, 60_000);

describe('a hub that leaves the session open fails, naming it', () => {
  it(`${AC[3]} a record with no end for the session, and a deep hub status that never shows it closed, fail every check, naming the session`, () => {
    const id = randomUUID();
    const ev = (log_pos: number, kind: string, data = {}): Ev => ({ id: `e${log_pos}`, kind, log_pos, ts: log_pos, writer: 'hook', session: id, data });
    // The issue's runs 1 and 3: the turn's events last, nothing after the process ended.
    const events = [ev(1, 'session.start', { source: 'startup' }), ev(2, 'user.ask'), ev(3, 'tool.before'), ev(4, 'tool.after'), ev(5, 'agent.stop')];
    const status = JSON.stringify({ sessions: [{ id, state: 'finished' }] });
    const open: Run = { n: 1, id, sessionEnd: false, pid: 1, exitedAt: 0, exitPos: 5, before: status, polls: [{ at: 1000, text: status }, { at: 59_000, text: status }], ask: 'A1', answered: { code: 0, out: '' } };
    const fails = leftOpen({ events }, open);
    expect(fails.length, 'AC1, AC2 (closed) and AC2 (by its task) each fail').toBe(3);
    for (const f of fails) expect(f, f).toContain(id);
  });

  it(`${AC[3]} a planted hub (DEEP_HUB_PLANT=${PLANT}) that leaves run 1's session open fails, naming it`, () => {
    if (planted instanceof Error) throw Error(`BLOCKED: the planted hub didn't run (an implementation registers ${PLANT}; README: AC3): ${planted.message}`);
    const r = planted.runs[0]!;
    const fails = leftOpen(planted, r);
    expect(fails.length, `the planted hub must fail AC1 or AC2 for session ${r.id}`).toBeGreaterThan(0);
    for (const f of fails) expect(f, f).toContain(r.id);
  });
});
