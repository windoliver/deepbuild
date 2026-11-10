// The issue's Proof asks for three live Ctrl-C ends in the Codex CLI on the reference Mac. They need a person at a
// terminal running a signed-in `codex --no-daemon` with DeepBuild's hooks trusted, and spend plan usage, so this never
// runs in the lanes: it skips as BLOCKED, and never passes, until run by hand (README: What stays BLOCKED):
//   DEEP_LIVE_1023=1 DEEP_LIVE_1023_SESSIONS=<id1>,<id2>,<id3> npx vitest run --root tests/acceptance/1023 live-ctrl-c.live.test.ts
// It reads your installed hub (`$HOME/.deepbuild`), read-only: `events.read` and `deep hub status`.
import { LIVE_SESSIONS, OPTED, REAL_HOME } from './opted.ts';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLI, NODE } from '../39/helpers.ts';
import { AC1, AC2, allEvents, endProblems, listed, ofSession, run, shownClosed, type Hub, type Line } from './helpers.ts';

const BLOCKED = 'BLOCKED: needs three live Ctrl-C ends of `codex --no-daemon` on the reference Mac, run by hand (DEEP_LIVE_1023=1 and DEEP_LIVE_1023_SESSIONS)';

describe('live Ctrl-C ends in the Codex CLI', () => {
  it(`${AC1} ${AC2} (live) three sessions ended with Ctrl-C each end once on your hub, and each shows closed in deep hub status`, async (ctx) => {
    if (!OPTED) return ctx.skip(BLOCKED);
    expect(LIVE_SESSIONS.length, `${BLOCKED}: DEEP_LIVE_1023_SESSIONS must name the three sessions`).toBe(3);
    const root = join(REAL_HOME, '.deepbuild');
    const hub = { socket: join(root, 'hub.sock'), root } as unknown as Hub;
    const events = await allEvents(hub);
    const status = await run(NODE, [CLI, 'hub', 'status'], { env: { ...process.env, HOME: REAL_HOME } });
    const line = JSON.parse(status.stdout.trim().split('\n').at(-1) ?? '{}') as Line;
    const problems: string[] = [];
    for (const id of LIVE_SESSIONS) {
      const mine = ofSession(events, id);
      if (!mine.length) { problems.push(`session ${id}: not on your hub's record`); continue; }
      const fired = mine.some((e) => e.kind === 'session.end' && e.writer === 'hook');
      // Without a SessionEnd, the end must come after the session's last hook event: its process ended after that.
      const lastHook = Math.max(0, ...mine.filter((e) => e.writer === 'hook').map((e) => e.log_pos));
      problems.push(...endProblems(events, id, fired ? { reason: 'other' } : { before: lastHook }));
      if (!fired && !shownClosed(line, id)) problems.push(`session ${id}: Codex fired no SessionEnd, and deep hub status shows ${JSON.stringify(listed(line, id) ?? null)}, not closed`);
    }
    expect(problems, problems.join('\n')).toEqual([]);
  }, 600_000);
});
