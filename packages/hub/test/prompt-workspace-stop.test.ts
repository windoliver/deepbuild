// #2068 fallback regression: a task from words may still be creating its workspace when the hub stops.
import { spawn } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { hookLine, send, withHub } from './hub.js';
import { ulid } from '../src/wire.js';

it('settles a words task workspace before recording the clean hub stop', async () => {
  await withHub(async (root, home, hub) => {
    const bin = join(home, 'bin'); mkdirSync(bin);
    const began = join(home, 'git-began'), release = join(home, 'git-release');
    // Only the external git executable is gated; every actual command still runs the real git.
    writeFileSync(join(bin, 'git'), `#!${process.execPath}\nconst fs = require('node:fs'), cp = require('node:child_process');
      const args = process.argv.slice(2); const init = args[0] === 'init';
      if (init) fs.writeFileSync(${JSON.stringify(began)}, 'started');
      const run = () => { if (init && !fs.existsSync(${JSON.stringify(release)})) return setTimeout(run, 10);
        const child = cp.spawn('/usr/bin/git', args, { stdio: 'inherit' }); child.on('exit', (code) => process.exit(code ?? 1)); };
      run();\n`);
    chmodSync(join(bin, 'git'), 0o700);
    const path = `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`;
    await hub.restart({ PATH: path });
    const session = '37d93253-5b53-4122-8d0c-0c6f14358bd3';
    const work = join(home, 'outside'); mkdirSync(work);
    const folder = join(home, '.claude', 'projects', 'outside'); mkdirSync(folder, { recursive: true });
    const transcript = join(folder, `${session}.jsonl`); writeFileSync(transcript, '');
    const agent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], { stdio: 'ignore' });
    const hook = (event: string, extra = {}) => send(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event,
      { session_id: session, cwd: work, transcript_path: transcript, hook_event_name: event, ...extra }, { ppid: agent.pid }));
    const wait = async (test: () => boolean) => { for (const end = Date.now() + 5000; !test() && Date.now() < end;) await new Promise((done) => setTimeout(done, 10)); };
    const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
    try {
      await hook('SessionStart', { source: 'startup' });
      await wait(() => Boolean(db.prepare('SELECT 1 FROM events WHERE kind = ? AND session_id = ?').get('session.start', session)));
      const text = 'Make a document for the new checkout flow.';
      appendFileSync(transcript, `${JSON.stringify({ type: 'user', promptId: 'p1', promptSource: 'typed', turnOrigin: 'human', origin: { kind: 'human' }, message: { role: 'user', content: text } })}\n`);
      await hook('UserPromptSubmit', { prompt: text, prompt_id: 'p1' });
      await wait(() => existsSync(began));
      expect(existsSync(began), 'the words task started real workspace creation').toBe(true);
      const stopping = hub.restart({ PATH: path });
      setTimeout(() => writeFileSync(release, 'go'), 250);
      await stopping;
      const events = db.prepare("SELECT kind, log_pos, data FROM events WHERE kind IN ('workspace.created', 'hub.stopped') ORDER BY log_pos").all() as { kind: string; log_pos: number; data: string }[];
      const workspace = events.find((e) => e.kind === 'workspace.created');
      const stopped = events.filter((e) => e.kind === 'hub.stopped').at(-1);
      expect(workspace, 'a clean stop must settle workspace creation, not orphan its git child').toBeDefined();
      expect(workspace!.log_pos, 'workspace creation commits before the final clean-stop event').toBeLessThan(stopped!.log_pos);
      const folder = (JSON.parse(workspace!.data) as { folder: string }).folder;
      expect(readFileSync(join(folder, '.git', 'HEAD'), 'utf8')).toContain('refs/heads/main');
    } finally {
      db.close();
      writeFileSync(release, 'go');
      agent.kill('SIGTERM');
      await new Promise<void>((done) => { if (agent.exitCode !== null || agent.signalCode !== null) done(); else agent.once('exit', () => done()); });
    }
  });
}, 40_000);
