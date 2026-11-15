// A running hub writes rules.json again when it can't read it (#2204): deep-hook matches every call against that
// file, so one cut short leaves the hub nothing matched to decide from until the file is back.
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { hookLine, send, withHub } from './hub.js';

const SESSION = '6f1c2b9e-1111-4222-8333-444455552204';
const GUARD = { match: 'kill:by-name', scope: 'all_repos', mode: 'block', reason: 'Killing by name can stop another session.', next_step: 'Kill by PID.', fail_closed: true };
const RULES = `${JSON.stringify({ v: 1, entries: { 'no-kill-by-name': GUARD }, classes: { 'mcp__x__send': 'send' } }, null, 2)}\n`;

/** A PreToolUse as deep-hook writes it for a Bash call it matched against nothing. */
function request(id: string, command: string): string {
  return hookLine(id, 'PreToolUse', { session_id: SESSION, cwd: '/tmp', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, tool_use_id: `toolu_${id}` });
}

/** The entries rules.json holds now. The hub installs entries of its own beside the test's, so the file is never compared whole. */
const entries = (file: string) => (JSON.parse(readFileSync(file, 'utf8')) as { entries: Record<string, unknown> }).entries;

/** The session readings naming rules.json, once `n` are in the record or 5 s have passed. */
async function readings(root: string, n: number): Promise<string[]> {
  const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
  try {
    let found: string[] = [];
    for (const until = Date.now() + 5000; Date.now() < until; await new Promise((r) => setTimeout(r, 50))) {
      found = (db.prepare("SELECT json_extract(data, '$.reading') AS r FROM events WHERE kind = 'session.reading'").all() as { r: string }[]).map((x) => x.r).filter((r) => r.includes('rules.json'));
      if (found.length >= n) break;
    }
    return found;
  } finally {
    db.close();
  }
}

describe('a running hub whose rules.json can no longer be read', () => {
  const spoils: [string, (file: string) => void][] = [
    ['cut to its first 40 bytes', (file) => writeFileSync(file, RULES.slice(0, 40))],
    ['with no entries object', (file) => writeFileSync(file, '{"v":1,"entries":[]}')],
    // Its bytes, size and time stay: only its mode says nobody may read it.
    ['with a mode nobody can read it by', (file) => chmodSync(file, 0o000)],
  ];
  for (const [spoiled, spoil] of spoils) {
    it(`writes the file again as it last read it, before it answers the next hook, and records it once: ${spoiled}`, async () => {
      await withHub(async (root, _home, hub) => {
        const file = join(root, 'rules.json');
        writeFileSync(file, RULES, { mode: 0o600 });
        await hub.restart();
        // A first hook, so the hub has read the file as it is now.
        expect(await send(join(root, 'hub.sock'), request('01K74FKZVKZGATTBZAEGPRE21Z', 'ls'))).toContain('"ack"');
        spoil(file);
        expect(await send(join(root, 'hub.sock'), request('01K74FKZVKZGATTBZAEGPRE220', 'pkill -f node'))).toContain('"ack"');
        expect(entries(file), 'the file is back, with its entry, once the hook is answered').toMatchObject({ 'no-kill-by-name': GUARD });
        expect(await readings(root, 1), 'one reading says the file could not be read').toHaveLength(1);
        // A hook that finds the file readable records nothing more.
        expect(await send(join(root, 'hub.sock'), request('01K74FKZVKZGATTBZAEGPRE221', 'ls'))).toContain('"ack"');
        await new Promise((r) => setTimeout(r, 500));
        expect(await readings(root, 1)).toHaveLength(1);
        expect(entries(file)).toMatchObject({ 'no-kill-by-name': GUARD });
      });
    }, 60_000);
  }

  it('rewrites from a file changed since the last hook: an entry installed between two hooks is kept', async () => {
    await withHub(async (root, _home, hub) => {
      const file = join(root, 'rules.json');
      writeFileSync(file, RULES, { mode: 0o600 });
      await hub.restart();
      const added = RULES.replace('"no-kill-by-name"', '"mine"');
      writeFileSync(file, added);
      // No hook comes: the hub reads the file again within its 5 s check.
      await new Promise((r) => setTimeout(r, 6000));
      writeFileSync(file, 'not JSON');
      expect(await send(join(root, 'hub.sock'), request('01K74FKZVKZGATTBZAEGPRE223', 'ls'))).toContain('"ack"');
      expect(entries(file)).toMatchObject({ mine: GUARD });
    });
  }, 60_000);
});
