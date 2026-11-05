// The channels, for the perf lane's budgets (issue #65): node benchmarks/channels.mjs. Against a hub in a temp HOME,
// the four channel plug-ins (packages/channels/*) are installed with `deep install` and pointed at one stand-in
// provider on 127.0.0.1; then an agent paseo runs asks for your authority, and the time from its permission request
// to its card at the provider is read, with each plug-in's resident memory once the card is there. It prints one JSON
// line: {"reach_ms", "rss_mb": {paseo, chat, email, text}}. The issue's 10 s and 50 MB stay in
// tests/acceptance/65/budgets.test.ts. It stops only the hub and the provider it started.
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const { ulid } = await import(join(REPO, 'packages/record/dist/index.js'));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const NAMES = ['paseo', 'chat', 'email', 'text'];

// Under /tmp: the hub's socket path must stay short.
const dir = realpathSync(mkdtempSync('/tmp/deep-ch-'));
const home = join(dir, 'h');
const root = join(home, '.deepbuild');
mkdirSync(root, { recursive: true, mode: 0o700 });
const confirm = join(dir, 'confirm');
writeFileSync(confirm, 'confirmed\n');
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEEP_') && !k.startsWith('CLAUDE'))), HOME: home, DEEP_HUB_TEST_CONFIRM: confirm };

// The provider: every card acknowledged, no answers; each first card's arrival kept by its thread.
const arrived = new Map();
const provider = createServer((req, res) => {
  let body = '';
  req.setEncoding('utf8').on('data', (d) => (body += d)).on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.method === 'POST') {
      try { const key = JSON.parse(body).item.thread_key; if (!arrived.has(key)) arrived.set(key, Date.now()); } catch { /* not a card */ }
      return res.end(JSON.stringify({ ack: `bench-${arrived.size}` }));
    }
    res.end(JSON.stringify({ answers: [], seen: [], cursor: '0' }));
  });
});
await new Promise((done) => provider.listen(0, '127.0.0.1', done));
const api = `http://127.0.0.1:${provider.address().port}`;
writeFileSync(join(root, 'channels.json'), JSON.stringify({
  channels: Object.fromEntries(NAMES.map((n) => [n, { api, ...(n === 'chat' ? { token: 'bench-token' } : {}) }])),
  routes: [{ kinds: ['authority', 'unblock', 'choice', 'taste', 'exception', 'definition'], to: NAMES }], quiet: null,
}), { mode: 0o600 });

// The ask settings setup drafts, and the agent's folder a project you trust (Claude Code's workspace trust).
writeFileSync(join(root, 'config.json'), JSON.stringify({ asks: {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'], fold: 5,
} }));
const cwd = join(dir, 'repo');
mkdirSync(cwd);
execFileSync('git', ['init', '-q'], { cwd });
writeFileSync(join(home, '.claude.json'), JSON.stringify({ projects: { [cwd]: { hasTrustDialogAccepted: true } } }));
const hub = spawn(process.execPath, [CLI, 'hub', 'run'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const socket = join(root, 'hub.sock');
try {
  await new Promise((done, fail) => { hub.stdout.on('data', done); hub.on('exit', () => fail(Error('the hub exited before it was ready'))); });
  for (const n of NAMES) execFileSync(process.execPath, [CLI, 'install', join(REPO, 'packages/channels', n)], { env, stdio: ['ignore', 'ignore', 'inherit'], timeout: 300_000 });
  // One hook line on its own connection, as paseo's plugin sends it; resolves once the hub acknowledges it.
  const session = randomUUID();
  const hook = (event, fields) => new Promise((done, fail) => {
    const sock = connect(socket);
    setTimeout(() => fail(Error(`the hub didn't acknowledge ${event} within 60 s`)), 60_000).unref();
    let greeted = false;
    sock.setEncoding('utf8').on('data', (chunk) => {
      for (const raw of chunk.split('\n').filter(Boolean)) {
        if (!greeted) {
          greeted = true;
          const payload = { hook_event_name: event, session_id: session, cwd, provider: 'copilot', paseo_agent: session, bind: session, ...fields };
          sock.write(`${JSON.stringify({ v: 1, agent: 'paseo', event, seq: (BigInt(Date.now()) * 1_000_000n).toString(), id: ulid(Date.now()), pid: process.pid, ppid: process.pid, matched: [], payload })}\n`);
        } else if (raw.includes('"ack"')) done(sock);
      }
    }).on('error', () => done(sock));
  });
  (await hook('agent.turn.before', { turn_id: 't-bench' })).destroy();
  await sleep(3000);
  const before = new Set(arrived.keys());
  const asked = Date.now();
  const held = await hook('agent.permission.before', { request_id: 'perm_bench', permission_kind: 'tool', tool_name: 'Bash', tool_input: { command: 'git push origin main' }, title: 'Run git push origin main' });
  let reach;
  for (const end = Date.now() + 60_000; Date.now() < end && reach === undefined; await sleep(20)) {
    const key = [...arrived.keys()].find((k) => !before.has(k));
    if (key) reach = arrived.get(key) - asked;
  }
  held.destroy();
  // Each plug-in's sandboxed process, by the install folder its runner was started on.
  const ps = execFileSync('/bin/ps', ['-axo', 'pid=,rss=,command='], { encoding: 'utf8' }).split('\n');
  const idOf = (folder) => { try { return JSON.parse(readFileSync(join(folder, 'deepbuild.json'), 'utf8')).id; } catch { return undefined; } };
  const runners = ps.map((l) => l.trim().split(/\s+/)).filter((f) => f.some((x) => x.endsWith('runtime/runner.mjs')) && f.at(-2)?.startsWith(root));
  const rss = Object.fromEntries(NAMES.map((n) => {
    const f = runners.find((x) => idOf(x.at(-2)) === `deepbuild/channel-${n}`);
    return [n, f ? Math.round((Number(f[1]) / 1024) * 10) / 10 : null];
  }));
  console.log(JSON.stringify({ reach_ms: reach ?? null, rss_mb: rss }));
} finally {
  hub.kill('SIGTERM');
  await new Promise((done) => { hub.once('exit', done); setTimeout(done, 10_000); });
  provider.closeAllConnections();
  provider.close();
  rmSync(dir, { recursive: true, force: true });
}
