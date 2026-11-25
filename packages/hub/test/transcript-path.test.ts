// The hub has a session's transcript copied from the path its hook named (#2316), on a hub hook requests reach the
// way deep-hook sends them: at the session's end, and before a push held in a proceed turn raises its ask (within
// ARCHIVE_WAIT_MS). The agent's projects folder is made one the archive can pass through but not list before the
// session's transcript is written, so the walk, the hub's own pass included, can't reach it: only the named path does.
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { hookLine, reply, send, session, withHub } from './hub.js';
import { first } from './stream.js';

const QUESTION = 'Shall I push the fix to main?';
/**
 * The hub's archive reads Claude Code's folder under HOME only when CLAUDE_CONFIG_DIR is unset: '' makes it skip that.
 * A `claude` that exits 1 comes first on PATH: at SessionStart the hub runs `claude auth status` in the session's home
 * (#1033), and a real one writes `.claude/.claude.json` there and can outlive the hub's stop, racing the home's removal.
 */
const STUB = mkdtempSync(join(tmpdir(), 'hub-2316-stub-'));
writeFileSync(join(STUB, 'claude'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
afterAll(() => rmSync(STUB, { recursive: true, force: true }));
const HOME_ONLY = { CLAUDE_CONFIG_DIR: '', PATH: `${STUB}${delimiter}${process.env.PATH ?? ''}` };
const handle = (id: string) => `session:${id.replace(/-/g, '')}`;

/** Runs `body` with `home`'s Claude Code projects folder unlistable, its mode put back after. */
async function unlistable(home: string, body: (projects: string) => Promise<void>): Promise<void> {
  const projects = join(home, '.claude', 'projects');
  mkdirSync(projects, { recursive: true });
  chmodSync(projects, 0o311);
  try {
    let listed = true;
    try { readdirSync(projects); } catch { listed = false; }
    if (listed) throw Error('BLOCKED: a folder with mode 0311 can still be listed here (root, or mode bits ignored), so this test cannot tell the named path from the walk');
    await body(projects);
  } finally {
    chmodSync(projects, 0o755);
  }
}
const copied = (root: string): string[] => {
  const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
  try { return (db.prepare("SELECT json_extract(data, '$.session') AS s FROM events WHERE kind = 'transcript.archived'").all() as { s: string }[]).map((r) => r.s); } finally { db.close(); }
};
/** Whether the record's first `transcript.archived` comes before its first `ask.created`. */
const copiedBeforeAsk = (root: string): boolean => {
  const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
  const first = (kind: string) => (db.prepare('SELECT MIN(log_pos) AS p FROM events WHERE kind = ?').get(kind) as { p: number | null }).p;
  try { const copy = first('transcript.archived'); const ask = first('ask.created'); return copy !== null && ask !== null && copy < ask; } finally { db.close(); }
};
const line = (id: string, uuid: string, cwd: string, role: 'user' | 'assistant', text: string) =>
  `${JSON.stringify({ type: role, sessionId: id, uuid, cwd, message: { role, content: role === 'user' ? text : [{ type: 'text', text }] } })}\n`;

describe('the hub copies a session from the path its hook named', () => {
  it('when the session ends', async () => {
    await withHub(async (root, home) => {
      await unlistable(home, async () => {
        const id = 'aaaaaaaa-2316-4000-8000-000000000001';
        const s = session(home, id);
        writeFileSync(s.transcript, line(id, 'm1', s.work, 'user', 'fix the checkout total'));
        const sock = join(root, 'hub.sock');
        await send(sock, hookLine('01K74FKZVK8Q2X5R7M3N9P4T70', 'SessionStart', s.payload('SessionStart', { source: 'startup' }), { ppid: process.pid }));
        await send(sock, hookLine('01K74FKZVK8Q2X5R7M3N9P4T71', 'SessionEnd', s.payload('SessionEnd', { reason: 'other' }), { ppid: process.pid }));
        await first(root, 'transcript.archived');
        expect(copied(root), "the session's end copied the transcript at its hook's transcript_path").toEqual([handle(id)]);
      });
    }, HOME_ONLY);
  }, 60_000);

  it('before a push held in a proceed turn raises its ask', async () => {
    const sorter = join('/tmp', `hub-2316-sorter-${process.pid}.json`);
    writeFileSync(sorter, JSON.stringify({ rule: 'planted-proceed-2316', proceed: [QUESTION] }));
    try { await withHub(async (root, home) => {
      writeFileSync(join(root, 'config.json'), JSON.stringify({ asks: { deadline: { authority: '1d' }, default: { authority: 'no' } } }));
      writeFileSync(join(root, 'rules.json'), JSON.stringify({ v: 1, entries: { 'authority-push': { match: 'effect:push', scope: 'all_repos', mode: 'watch', reason: 'A push needs your authority.', next_step: 'Wait for the ask.', fail_closed: false } } }));
      await unlistable(home, async () => {
        const id = 'aaaaaaaa-2316-4000-8000-000000000002';
        const s = session(home, id);
        writeFileSync(s.transcript, line(id, 'm1', s.work, 'user', 'fix the checkout total, then push it') + line(id, 'm2', s.work, 'assistant', QUESTION));
        const sock = join(root, 'hub.sock');
        await send(sock, hookLine('01K74FKZVK8Q2X5R7M3N9P4T80', 'SessionStart', s.payload('SessionStart', { source: 'startup' }), { ppid: process.pid }));
        await send(sock, hookLine('01K74FKZVK8Q2X5R7M3N9P4T81', 'Stop', s.payload('Stop', { stop_hook_active: false, last_assistant_message: QUESTION }), { ppid: process.pid }));
        await first(root, 'question.proceeded', 'BLOCKED: the planted proceed was not recorded, so no turn holds the push');
        if (copied(root).length) throw Error(`BLOCKED: the transcript was copied before the push: ${copied(root).join(', ')}`);
        const held = await reply(sock, hookLine('01K74FKZVK8Q2X5R7M3N9P4T82', 'PreToolUse', s.payload('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git push origin main' }, tool_use_id: 'toolu_01Push2316' }), { ppid: process.pid, matched: ['authority-push'] }));
        expect(`${held.exit} ${held.stdout}${held.stderr}`, 'the push is held by an authority ask').toMatch(/^2 .*waits for ask:/s);
        expect(copied(root), "the held push copied the transcript at its hook's transcript_path").toEqual([handle(id)]);
        expect(copiedBeforeAsk(root), 'the copy landed before the ask was raised').toBe(true);
      });
    }, { ...HOME_ONLY, DEEP_HUB_TEST_SORTER: sorter }); } finally { rmSync(sorter, { force: true }); }
  }, 60_000);

  it('before a push no typed request names raises its ask (#84), with no proceed', async () => {
    await withHub(async (root, home) => {
      writeFileSync(join(root, 'config.json'), JSON.stringify({ asks: { deadline: { authority: '1d' }, default: { authority: 'no' } } }));
      writeFileSync(join(root, 'rules.json'), JSON.stringify({ v: 1, entries: { 'push-needs-ask': { match: 'effect:push', scope: 'all_repos', mode: 'block', reason: 'Pushing goes ahead only when the thread\'s ask names it.', next_step: 'Wait for the ask.', fail_closed: false } } }));
      await unlistable(home, async () => {
        const id = 'aaaaaaaa-2316-4000-8000-000000000003';
        const s = session(home, id);
        writeFileSync(s.transcript, line(id, 'm1', s.work, 'user', 'fix the checkout total and commit it'));
        const sock = join(root, 'hub.sock');
        await send(sock, hookLine('01K74FKZVK8Q2X5R7M3N9P4T90', 'SessionStart', s.payload('SessionStart', { source: 'startup' }), { ppid: process.pid }));
        if (copied(root).length) throw Error(`BLOCKED: the transcript was copied before the push: ${copied(root).join(', ')}`);
        const held = await reply(sock, hookLine('01K74FKZVK8Q2X5R7M3N9P4T91', 'PreToolUse', s.payload('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git push origin main' }, tool_use_id: 'toolu_01Push2316b' }), { ppid: process.pid, matched: ['push-needs-ask'] }));
        expect(`${held.exit} ${held.stdout}${held.stderr}`, 'the push is denied by push-needs-ask and waits for its ask').toMatch(/^2 .*push-needs-ask.*waits for ask:/s);
        expect(copied(root), "the push's ask copied the transcript at its hook's transcript_path").toEqual([handle(id)]);
        expect(copiedBeforeAsk(root), 'the copy landed before the ask was raised').toBe(true);
      });
    }, HOME_ONLY);
  }, 60_000);
});
