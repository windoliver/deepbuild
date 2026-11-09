// The issue's Proof, live: three Ctrl-C ends of the Codex CLI on the reference Mac (README: The live runs). It needs a
// person at the terminal and spends plan usage, so it is skipped unless DEEPBUILD_1023_LIVE_SESSIONS names the three
// sessions run by hand; then it reads your own hub, read-only, through `events.read` and `deep hub status`.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLI, NODE, allEvents, run as exec, shown, type Hub } from '../39/helpers.ts';
import { AC, byTask, closedIn, endRead } from './replay.ts';

const SESSIONS = process.env.DEEPBUILD_1023_LIVE_SESSIONS?.split(',').map((s) => s.trim()).filter(Boolean);
const ASK = process.env.DEEPBUILD_1023_LIVE_ASK?.replace(/^ask:/, '');
const ROOT = join(homedir(), '.deepbuild');

describe.skipIf(!SESSIONS)('live: three Ctrl-C ends in the Codex CLI', () => {
  it(`${AC[1]} ${AC[2]} (live) each session run by hand is read as ended, and one ended with no SessionEnd shows closed`, async () => {
    expect(SESSIONS, 'DEEPBUILD_1023_LIVE_SESSIONS must name three sessions, comma-separated, in run order').toHaveLength(3);
    for (const id of SESSIONS!) expect(id, 'each a dashed UUID, as its SessionStart gave it').toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(existsSync(join(ROOT, 'control.token')), `BLOCKED: no hub at ${ROOT}`).toBe(true);
    const events = await allEvents({ socket: join(ROOT, 'hub.sock'), root: ROOT } as Hub);
    const status = await exec(NODE, [CLI, 'hub', 'status']);
    expect(status.code, `BLOCKED: deep hub status must read your hub: ${shown(status)}`).toBe(0);
    const fails: string[] = [];
    SESSIONS!.forEach((id, i) => {
      if (!events.some((e) => e.kind === 'session.start' && e.session === id)) { fails.push(`BLOCKED: run ${i + 1}: the record holds no session.start under ${id}`); return; }
      // Which runs Codex fired SessionEnd in is the record's: a hook's session.end.
      const sessionEnd = events.some((e) => e.kind === 'session.end' && e.session === id && e.writer === 'hook');
      fails.push(...[endRead(events, { n: (i + 1) as 1 | 2 | 3, id, sessionEnd, exitPos: 0 })].filter((f): f is string => f !== undefined));
      if (!sessionEnd && !closedIn(status.stdout, id)) fails.push(`run ${i + 1}: deep hub status doesn't show session ${id} closed: ${status.stdout.slice(0, 400)}`);
      if (ASK && !sessionEnd && events.some((e) => e.kind === 'ask.created' && e.session === id && (e.id === ASK || e.subject === `ask:${ASK}`))) {
        const f = byTask(events, { n: (i + 1) as 1 | 2 | 3, id, ask: ASK, answered: { code: 0, out: '' } });
        if (f) fails.push(f);
      }
    });
    expect(fails, fails.join('\n')).toEqual([]);
  }, 120_000);
});
