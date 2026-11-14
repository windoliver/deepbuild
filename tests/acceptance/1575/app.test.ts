// #1575 AC6: the app's stream is the merge base's. The app (crates/deep-app/src/record.rs) says hello as the app,
// reads the inbox and calls stream.subscribe {after} with no scope; a later connection of its resumes from a
// position it holds. Both are compared here, line for line, with what the base hub sent for the same fixture
// session (fixtures/app-stream.golden.json; README, The golden).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { asApp, cleanup, Confirmer, confirmEnv, Conn, fromHere, hookRequest, makeHome, quiet, result, sendHook, settled, startHub, subscribe, tempDir, type Session, type Stream } from './helpers.ts';

afterEach(cleanup, 60_000);
const GOLDEN = fileURLToPath(new URL('./fixtures/app-stream.golden.json', import.meta.url));
const RECORD = process.env.DEEP_1575_RECORD_GOLDEN === '1';   // read by this test only, never by the hub

/** The fixture session: one Claude Code session with a fixed ID and transcript, in fresh folders. */
function fixtureSession(home: string): Session {
  const id = '15750000-aaaa-4bbb-8ccc-000000001575';
  const cwd = join(tempDir(), 'work');
  const transcript = join(home, '.claude/projects/fixture', `${id}.jsonl`);
  mkdirSync(cwd, { recursive: true });
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, `${JSON.stringify({ type: 'user', sessionId: id, message: { role: 'user', content: 'start' } })}\n`);
  return { agent: 'claude-code', id, cwd, transcript };
}
const TURN = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd'];

/**
 * Every line of a subscription, its reply first, with what differs from run to run named instead: the
 * subscription's own id, temp folders, times, and each ULID by the order it first appears in (so the hub's start
 * ID and an event's ID keep their identity across lines).
 */
function normalizer(): (conn: Conn, s: Stream) => string[] {
  const ulids = new Map<string, string>();
  return (conn, s) => conn.received.slice(s.from).filter((r) => r.json?.id === s.sub).map((r) => r.raw
    .replace(JSON.stringify(s.sub), '"<sub>"')
    .replace(/\/private\/tmp\/dh16-[A-Za-z0-9]{6}/g, '<tmp>')
    .replace(/dh16-[A-Za-z0-9]{6}/g, '<tmp>')
    .replace(/1[78]\d{11}(\d{6})?/g, (_all, ns?: string) => (ns ? '<ns>' : '<ms>'))
    .replace(/"tool_use_id":"[^"]*"|"call":"[^"]*"/g, (m) => `${m.slice(0, m.indexOf(':'))}:"<call>"`)
    .replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/g, (id) => ulids.get(id) ?? ulids.set(id, `<ulid ${ulids.size + 1}>`).get(id)!));
}

describe('AC6 #1575.33d5b838 the app\'s stream on a fixture session is frame for frame the merge base\'s', () => {
  it('AC6 #1575.33d5b838 subscribed as the app subscribes, after its inbox read and again from 0, one fixture session\'s turn arrives as the base hub sent it: the same reply and the same frames, in order, nothing more', async () => {
    const hub = await startHub({ home: makeHome(), env: confirmEnv(new Confirmer()) });
    const normal = normalizer();
    const app = await asApp(hub);
    const inbox = result(await app.call('inbox.read', {}));
    const live = await subscribe(app, { after: inbox.log_pos as number });
    const session = fixtureSession(hub.home);
    for (const event of TURN) {
      const r = await sendHook(hub.socket, fromHere(hookRequest(session, event)));
      expect(r.ack, `BLOCKED: setup: the hub acknowledged ${event}`).toBeDefined();
      await settled(app);
    }
    await quiet(app, live);
    const again = await asApp(hub);
    const replay = await subscribe(again, { after: 0 });
    await quiet(again, replay);
    const stream = { live: normal(app, live), replay: normal(again, replay) };
    if (RECORD) {
      mkdirSync(dirname(GOLDEN), { recursive: true });
      writeFileSync(GOLDEN, `${JSON.stringify(stream, null, 1)}\n`);
      throw Error(`recorded ${GOLDEN} from this hub; a recording run never passes. Run again without DEEP_1575_RECORD_GOLDEN.`);
    }
    expect(existsSync(GOLDEN), 'BLOCKED: the golden recorded on the merge base is missing').toBe(true);
    const base = JSON.parse(readFileSync(GOLDEN, 'utf8')) as typeof stream;
    expect(base.live.length, 'BLOCKED: the golden holds the base\'s frames').toBeGreaterThan(TURN.length);
    expect(stream.live, 'the app\'s live stream, line for line the merge base\'s').toEqual(base.live);
    expect(stream.replay, 'the app\'s stream resumed from 0, line for line the merge base\'s').toEqual(base.replay);
  }, 180_000);
});
