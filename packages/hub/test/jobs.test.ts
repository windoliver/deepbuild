// The runner inside a real hub (#159): a job that needs a checkout gets one. The hub guards its own root from every
// run's writes (its record, socket and token); its jobs/ folder is left to each run's own grant, or no checkout's
// git could write the job's .git.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { client } from './hub.js';

const ACCOUNT = '0e0e0e0e-1111-4222-8333-444444444444';
const MAIN = new URL('../../cli/dist/main.js', import.meta.url).pathname;
const facts = JSON.parse(readFileSync(new URL('../../../adapters/claude-code.facts.json', import.meta.url), 'utf8')) as { versions: string[] };

let dir: string;
let hub: ChildProcess | undefined;
afterEach(async () => {
  if (hub && hub.exitCode === null) { hub.kill('SIGTERM'); await new Promise((done) => hub!.once('exit', done)); }
  rmSync(dir, { recursive: true, force: true });
});

it('checks out a job\'s base commit inside a real hub, whose root no run may otherwise write', async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-hub-jobs-')));
  const [home, bin, repo, root] = ['home', 'bin', 'repo', 'root'].map((p) => join(dir, p)) as [string, string, string, string];
  for (const p of [home, bin, repo, root]) mkdirSync(p);
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT } }));
  // A stand-in claude: its result says whether the checkout's file is in its folder.
  writeFileSync(join(bin, 'claude'), `#!/bin/sh
for a in "$@"; do [ "$a" = --version ] && { echo "${facts.versions.at(-1)} (Claude Code)"; exit 0; }; done
cat >/dev/null
[ -f notes.md ] && seen=checked-out || seen=empty
echo '{"type":"result","subtype":"success","is_error":false,"result":"'$seen'","total_cost_usd":0,"session_id":"00000000-0000-4000-8000-0000000000ff"}'
`, { mode: 0o755 });
  const git = (...args: string[]) => execFileSync('/usr/bin/git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  writeFileSync(join(repo, 'notes.md'), 'base\n');
  git('add', 'notes.md');
  git('commit', '-q', '-m', 'base');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ runner: { login_path: `${bin}:/usr/bin:/bin` }, plan: { reserve_pct: 10 } }));
  hub = spawn(process.execPath, [MAIN, 'hub', 'run', '--root', root], { stdio: ['ignore', 'pipe', 'inherit'], env: { PATH: '/usr/bin:/bin', HOME: home } });
  const ready = await new Promise<{ socket: string }>((done) => hub!.stdout!.once('data', (d) => done(JSON.parse(String(d).split('\n')[0]!))));
  const call = await client(ready.socket, readFileSync(join(root, 'control.token'), 'utf8').trim());
  const resets = Math.floor(Date.now() / 1000) + 3600;
  await call('windows.report', { agent: 'claude-code', account: ACCOUNT, rate_limits: { five_hour: { used_percentage: 5, resets_at: resets }, seven_day: { used_percentage: 5, resets_at: resets } } });
  const sub = await call('job.submit', { spec: { kind: 'draft', agent: 'claude-code', prompt: 'Draft.', checkout: { repo, commit: git('rev-parse', 'HEAD') } } });
  let rec = sub;
  for (let i = 0; i < 300 && !['finished', 'stopped', 'refused', 'lost'].includes(String(rec.state)); i++) {
    await new Promise((r) => setTimeout(r, 100));
    rec = await call('job.status', { job: sub.job });
  }
  expect(rec.refused, 'its checkout').toBeUndefined();
  expect(rec.state).toBe('finished');
  expect(rec.result, 'what the job saw in its folder').toBe('checked-out');
  await call('hub.stop', {}).catch(() => undefined);
}, 60_000);
