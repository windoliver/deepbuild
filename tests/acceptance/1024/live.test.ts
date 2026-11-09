// The issue's Proof, live: one hub restart mid-session in the Codex CLI on the reference Mac (README: The live run).
// It spends plan usage and needs a person at the terminal, so it is skipped unless DEEPBUILD_1024_LIVE_THREAD names the
// thread of a session run by hand; then it reads your own hub, read-only, through `events.read` and `status.read`.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allEvents, statusRows, type Hub } from '../39/helpers.ts';
import { AC, letters, twoRows } from './replay.ts';

const THREAD = process.env.DEEPBUILD_1024_LIVE_THREAD;
const ROOT = join(homedir(), '.deepbuild');

describe.skipIf(!THREAD)('live: a hub restart mid-session in the Codex CLI', () => {
  it(`${AC[1]} ${AC[2]} (live) the thread run by hand shows as one row under its dashed ID`, async () => {
    const thread = THREAD!;
    expect(thread, 'DEEPBUILD_1024_LIVE_THREAD must be the thread\'s dashed UUID, as its SessionStart gave it').toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(existsSync(join(ROOT, 'control.token')), `BLOCKED: no hub at ${ROOT}`).toBe(true);
    // #39's control calls, pointed at your own hub's socket and token.
    const hub = { socket: join(ROOT, 'hub.sock'), root: ROOT } as Hub;
    const events = await allEvents(hub);
    expect(events.some((e) => e.kind === 'session.start' && e.session === thread), `BLOCKED: the record holds no session.start under ${thread}`).toBe(true);
    expect(events.some((e) => e.kind === 'transcript.archived' && e.data?.session === `session:${letters(thread)}`), `BLOCKED: the record holds no transcript.archived for session:${letters(thread)} yet; wait for the restarted hub's archive pass`).toBe(true);
    const fail = twoRows(await statusRows(hub), thread, 'your hub, status.read');
    expect(fail, fail).toBeUndefined();
  }, 120_000);
});
