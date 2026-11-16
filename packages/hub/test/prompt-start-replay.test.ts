// #2068: the socket accepts live hooks while startup replays the spool. A duplicate must not form ready -> hook -> ready.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { Conn, nextSeq, ulid } from '../../../tests/acceptance/16/helpers.js';
import { until } from '../../../tests/acceptance/2068/helpers.js';

it('starts when a live issue hook arrives after the startup spool was renamed', async () => {
  const home = mkdtempSync('/tmp/issue-start-');
  const root = join(home, '.deepbuild');
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  const socket = join(root, 'hub.sock');
  let release!: () => void;
  let holding = false;
  const server = createServer((request, response) => {
    if (request.url?.includes('/issues/6?')) { holding = true; release = () => response.writeHead(404).end('{}'); }
    else response.writeHead(404).end('{}');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('no forge address');
  let child: ChildProcess | undefined;
  let connection: Conn | undefined;
  let db: DatabaseSync | undefined;
  try {
    mkdirSync(join(root, 'spool'), { recursive: true });
    writeFileSync(join(root, 'rules.json'), readFileSync(join(repo, 'crates/deep-hook/default-rules.json')));
    const line = (n: number) => ({ v: 1, agent: 'claude-code', event: 'UserPromptSubmit', seq: nextSeq(Date.now()), id: ulid(Date.now()), pid: process.pid, ppid: process.pid,
      matched: [], payload: { session_id: `start-session-${n}`, cwd: home, hook_event_name: 'UserPromptSubmit', prompt: `Fix https://github.com/fixture-2068/widgets/issues/${n}` } });
    const first = line(6), duplicate = line(7);
    writeFileSync(join(root, 'spool', 'spool.jsonl'), `${JSON.stringify(first)}\n${JSON.stringify(duplicate)}\n`);
    child = spawn(process.execPath, [join(repo, 'packages/cli/dist/main.js'), 'hub', 'run'], { stdio: ['ignore', 'pipe', 'pipe'], env: {
      HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, GH_TOKEN: '', DEEP_HUB_TEST_FORGE: `http://127.0.0.1:${address.port}`,
    } });
    let output = '';
    child.stdout!.on('data', (chunk) => { output += String(chunk); });
    await until(() => holding && existsSync(socket), 15_000);
    expect(holding, 'the first spooled issue holds startup inside its read').toBe(true);
    expect(readdirSync(join(root, 'spool')).some((name) => name.startsWith('replay-')), 'spool has already moved aside').toBe(true);
    connection = await Conn.open(socket);
    connection.send(duplicate);
    const ack = await connection.seek((line) => line.ack === duplicate.id);
    expect(ack, 'the live duplicate was acknowledged during startup').toBeDefined();
    release();
    await until(() => output.includes('"ready"'), 5000);
    expect(output, 'startup replay must not await a live settlement that needs ready first').toContain('"ready"');
    db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
    const copies = db.prepare('SELECT count(*) AS n FROM events WHERE id = ?').get(duplicate.id) as { n: number };
    expect(copies.n, 'one identity across startup spool and live hook').toBe(1);
  } finally {
    connection?.close(); db?.close(); server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await until(() => child!.exitCode !== null || child!.signalCode !== null, 3000);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await until(() => child!.exitCode !== null || child!.signalCode !== null, 3000);
    }
    rmSync(home, { recursive: true, force: true });
  }
}, 40_000);
