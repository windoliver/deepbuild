// A running hub replays what deep-hook spooled while it was late (#315): the next hook that reaches it starts the
// replay, so a late event is in the record without waiting for the hub's next start.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../../cli/dist/main.js', import.meta.url));
const SESSION = '6f1c2b9e-1111-4222-8333-444455556666';

/** A hook request as deep-hook writes it, for a Bash call. */
function request(id: string, command: string, extra: Record<string, unknown> = {}): string {
  const payload = { session_id: SESSION, cwd: '/tmp', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, tool_use_id: `toolu_${id}` };
  const seq = String(BigInt(Date.now()) * 1_000_000n);
  return `${JSON.stringify({ v: 1, agent: 'claude-code', event: 'PreToolUse', seq, id, pid: process.pid, ppid: process.ppid, matched: [], payload, ...extra })}\n`;
}

/** Sends one hook request the way deep-hook does: waits for the hello, writes the line, reads the acknowledgement. */
function send(socket: string, line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let got = '';
    sock.on('data', (d) => {
      got += d;
      if (got.split('\n').length === 2) sock.write(line);
      if (got.split('\n').length > 2) { sock.destroy(); resolve(got.split('\n')[1]!); }
    });
    sock.on('error', reject);
  });
}

describe('a running hub', () => {
  it('replays the spool once a hook reaches it, with no restart', async () => {
    const home = realpathSync(mkdtempSync('/tmp/hub-replay-'));
    const root = join(home, '.deepbuild');
    mkdirSync(root, { recursive: true });
    const hub = spawn(process.execPath, [CLI, 'hub', 'run'], { env: { ...process.env, HOME: home }, stdio: ['ignore', 'pipe', 'inherit'] });
    try {
      await new Promise((resolve, reject) => { hub.stdout.once('data', resolve); hub.once('exit', () => reject(Error('the hub exited before it was ready'))); });
      // A call deep-hook let through while the hub was late, spooled after the hub started.
      mkdirSync(join(root, 'spool'), { recursive: true, mode: 0o700 });
      writeFileSync(join(root, 'spool', 'spool.jsonl'), request('01K74FKZVKZGATTBZAEGPRET62', 'ls late', { late: true, matched: ['listing-noted'] }), { mode: 0o600 });
      expect(await send(join(root, 'hub.sock'), request('01K74FKZVKZGATTBZAEGPRET63', 'ls now'))).toContain('"ack"');
      const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
      let row: Record<string, unknown> | undefined;
      let left: string[] = [];
      try {
        // The file goes only after its events are committed FULL: done once both hold.
        for (const until = Date.now() + 5000; Date.now() < until; await new Promise((r) => setTimeout(r, 50))) {
          row = db.prepare("SELECT v, json_extract(data, '$.late') AS late, json_extract(data, '$.matched') AS matched FROM events WHERE id = ?").get('01K74FKZVKZGATTBZAEGPRET62');
          left = readdirSync(join(root, 'spool'));
          if (row && !left.length) break;
        }
      } finally {
        db.close();
      }
      expect(row, 'the spooled late call is in the record while the hub runs').toEqual({ v: 2, late: 1, matched: '["listing-noted"]' });
      expect(left, 'the replayed spool is removed').toEqual([]);
    } finally {
      if (hub.exitCode === null && hub.signalCode === null) {
        const exited = new Promise((resolve) => hub.once('exit', resolve));
        hub.kill('SIGTERM');
        await exited;
      }
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);
});
