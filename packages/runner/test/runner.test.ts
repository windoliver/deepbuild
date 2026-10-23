// The runner's rules beyond #159's acceptance suite: a checkout never writes where a case-insensitive filesystem
// would send it outside its folder, and a job starts only once its checkout is whole; a job cancelled while it is
// checked never starts, and one whose budget you declined is refused, never asked again; a lower reading inside the same window, an older window's reading, or a reading that names
// no window is not believed. A real agent's job can start: it writes only its own temp folder, signs in with a
// token the hub hands it, and reaches only its model API, through the runner's forwarder.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openAsks, type Asks } from '@deepbuild/asks';
import { openLedger } from '@deepbuild/budget';
import { openRecord, type RecordStore } from '@deepbuild/record';
import { openSupervisor, type Supervisor } from '@deepbuild/supervisor';
import { openRunner, type Runner } from '../src/index.js';

const ACCOUNT = '0d0d0d0d-1111-4222-8333-444444444444';
const facts = JSON.parse(readFileSync(new URL('../../../adapters/claude-code.facts.json', import.meta.url), 'utf8')) as { versions: string[] };
const resets = () => Math.floor(Date.now() / 1000) + 3 * 3600;
const limits = (used: number, at = resets()) => ({ five_hour: { used_percentage: used, resets_at: at }, seven_day: { used_percentage: 1, resets_at: at } });

let dir: string;
let record: RecordStore;
let sup: Supervisor;
let runner: Runner;
let asks: Asks;

/** A stand-in claude: its version after `slow` seconds, and a final result at once, saying whether `zz-last` is in its folder. */
function claude(slow = 0): string {
  const bin = join(dir, `bin${slow}`);
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), `#!/bin/sh
for a in "$@"; do [ "$a" = --version ] && { sleep ${slow}; echo "${facts.versions.at(-1)} (Claude Code)"; exit 0; }; done
cat >/dev/null
echo '{"type":"system","subtype":"init","session_id":"00000000-0000-4000-8000-0000000000aa"}'
[ -f zz-last ] && last=whole || last=partial
echo '{"type":"result","subtype":"success","is_error":false,"result":"'$last'","total_cost_usd":0.01,"session_id":"00000000-0000-4000-8000-0000000000aa"}'
`, { mode: 0o755 });
  return bin;
}

async function open(bin: string, env: Record<string, string> = {}, keychain?: (service: string) => Promise<string | undefined>): Promise<void> {
  const home = join(dir, 'home');
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT } }));
  record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const ledger = await openLedger({ record, asks, now: Date.now, price: async () => 0.5 });
  sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  runner = await openRunner({
    record, asks, supervisor: sup, ledger, now: Date.now, root: join(dir, 'root'), loginPath: `${bin}:/usr/bin:/bin`, env: { HOME: home, PATH: '/usr/bin:/bin', ...env },
    settings: { plan: { reserve_pct: 10 }, asks: { unblock: { deadline_ms: 86_400_000 } } }, ...(keychain ? { keychain } : {}),
  });
}
const events = async (kind: string) => (await record.read({ after: 0, limit: 100_000 })).filter((e) => e.kind === kind);

beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-runner-test-'))); });
afterEach(async () => {
  await runner?.close();
  await sup?.close();
  await record?.close();
  rmSync(dir, { recursive: true, force: true });
});

it('refuses a checkout whose tree names a link and a path its case folds onto, and writes nothing through the link', async () => {
  await open(claude());
  const victim = join(dir, 'victim.txt');
  writeFileSync(victim, 'yours\n');
  const repo = join(dir, 'repo');
  const git = (args: string[], input?: string) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', ...(input !== undefined ? { input } : {}) }).trim();
  execFileSync('git', ['init', '-q', repo]);
  const link = git(['hash-object', '-w', '--stdin'], victim);
  const blob = git(['hash-object', '-w', '--stdin'], 'planted\n');
  const tree = git(['mktree'], `120000 blob ${link}\tA\n100644 blob ${blob}\ta\n`);
  const commit = git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit-tree', tree, '-m', 'planted']);
  await runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: limits(5) });
  const rec = await runner.submit({ kind: 'draft', agent: 'claude-code', prompt: 'Draft.', checkout: { repo, commit } });
  expect(readFileSync(victim, 'utf8'), 'a file outside the checkout, written through its link').toBe('yours\n');
  expect(rec.state).toBe('refused');
  expect(rec.refused).toMatch(/can't hold safely: a/);
}, 60_000);

it('refuses a checkout whose tree writes into a .git of another case', async () => {
  await open(claude());
  const repo = join(dir, 'repo');
  const git = (args: string[], input?: string) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', ...(input !== undefined ? { input } : {}) }).trim();
  execFileSync('git', ['init', '-q', repo]);
  const blob = git(['hash-object', '-w', '--stdin'], '[core]\n\tfsmonitor = /tmp/planted\n');
  const inner = git(['mktree'], `100644 blob ${blob}\tconfig\n`);
  const tree = git(['mktree'], `040000 tree ${inner}\t.GIT\n`);
  const commit = git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit-tree', tree, '-m', 'planted']);
  await runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: limits(5) });
  const rec = await runner.submit({ kind: 'draft', agent: 'claude-code', prompt: 'Draft.', checkout: { repo, commit } });
  expect(rec.state).toBe('refused');
  expect(readFileSync(join(rec.folder, '.git', 'config'), 'utf8'), 'the checkout\'s own git config').not.toMatch(/planted/);
}, 60_000);

it('never starts a job cancelled while its binary is checked, and ends it once', async () => {
  await open(claude(2));
  await runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: limits(5) });
  const submitted = runner.submit({ kind: 'read', agent: 'claude-code', prompt: 'Read.' });
  let id: string | undefined;
  while (!id) { await new Promise((r) => setTimeout(r, 50)); id = (await runner.list())[0]?.job; }
  await new Promise((r) => setTimeout(r, 500));
  expect((await runner.cancel(id)).state).toBe('stopped');
  await submitted;
  await runner.tick();
  await new Promise((r) => setTimeout(r, 1000));
  expect((await events('process.starting')).filter((e) => (e.data as { run: string }).run === id), 'a process of the cancelled job').toEqual([]);
  expect((await events('job.ended')).filter((e) => (e.data as { job: string }).job === id)).toHaveLength(1);
}, 60_000);

it('keeps the higher reading of a window until it resets: a lower one before then is not believed', async () => {
  await open(claude());
  const at = resets();
  await runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: limits(95, at) });
  await runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: limits(0, at) });
  const rec = await runner.submit({ kind: 'read', agent: 'claude-code', prompt: 'Read.' });
  expect(rec.state).toBe('waiting');
  expect(rec.blocked?.cause).toBe('plan window');
  // A reading of the next window, after the reset, is believed.
  await runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: limits(0, at + 5 * 3600) });
  expect((await runner.wait(rec.job)).state).toBe('finished');
}, 60_000);

it('starts a job that needs a checkout only once its checkout is whole', async () => {
  await open(claude());
  const repo = join(dir, 'repo');
  const git = (args: string[], input?: string) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', ...(input !== undefined ? { input } : {}), maxBuffer: 64 * 2 ** 20 }).trim();
  execFileSync('git', ['init', '-q', repo]);
  const blob = git(['hash-object', '-w', '--stdin'], 'x\n');
  const rows = Array.from({ length: 4000 }, (_, i) => `100644 blob ${blob}\tf${String(i).padStart(5, '0')}`);
  rows.push(`100644 blob ${blob}\tzz-last`);
  const tree = git(['mktree'], `${rows.join('\n')}\n`);
  const commit = git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit-tree', tree, '-m', 'many']);
  await runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: limits(5) });
  let done = false;
  const submitted = runner.submit({ kind: 'draft', agent: 'claude-code', prompt: 'Draft.', checkout: { repo, commit } }).finally(() => { done = true; });
  // Readings while the checkout is written: each one is a pass that may start what may start.
  while (!done) { await runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: limits(5) }); await new Promise((r) => setTimeout(r, 10)); }
  const end = await runner.wait((await submitted).job);
  expect(end.state).toBe('finished');
  expect(end.result, 'what the job found in its folder').toBe('whole');
}, 120_000);

it('never lets an older window\'s reading, past its reset, replace the current one', async () => {
  await open(claude());
  const at = resets();
  await runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: limits(95, at) });
  await runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: limits(0, Math.floor(Date.now() / 1000) - 60) });
  const rec = await runner.submit({ kind: 'read', agent: 'claude-code', prompt: 'Read.' });
  expect(rec.state).toBe('waiting');
  expect(rec.blocked?.cause).toBe('plan window');
}, 60_000);

it('counts a reading that names no window as no reading', async () => {
  await open(claude());
  await runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: {} });
  const rec = await runner.submit({ kind: 'read', agent: 'claude-code', prompt: 'Read.' });
  expect(rec.state).toBe('waiting');
  expect(rec.blocked?.cause).toBe('first reading');
}, 60_000);

it('refuses a job whose budget you declined, and never asks for it again', async () => {
  await open(claude(), { ANTHROPIC_API_KEY: 'sk-placeholder' });
  await runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: limits(5) });
  const rec = await runner.submit({ kind: 'read', agent: 'claude-code', prompt: 'Read.', issue: 'windoliver/deepbuild#159' });
  expect(rec.blocked?.cause).toBe('budget');
  const [ask] = await asks.needsYou();
  await asks.answer({ writer: 'app', actor: 'you', scope: 'you' }, ask!.ask, { option: ask!.options.find((o) => o.decision === 'deny')!.id });
  await runner.tick();
  expect((await runner.status(rec.job)).state).toBe('refused');
  expect(await asks.needsYou(), 'the same question again').toEqual([]);
}, 60_000);

it('remembers a declined budget while the job waits on something else first', async () => {
  await open(claude(), { ANTHROPIC_API_KEY: 'sk-placeholder' });
  await runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: limits(5) });
  const rec = await runner.submit({ kind: 'read', agent: 'claude-code', prompt: 'Read.', issue: 'windoliver/deepbuild#159' });
  const [ask] = await asks.needsYou();
  // At your reserve before the answer is read: the job waits on the plan window instead.
  await runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: limits(95, resets() + 3600) });
  await asks.answer({ writer: 'app', actor: 'you', scope: 'you' }, ask!.ask, { option: ask!.options.find((o) => o.decision === 'deny')!.id });
  expect((await runner.status(rec.job)).blocked?.cause).toBe('plan window');
  await runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: limits(5, resets() + 7200) });
  await runner.tick();
  expect((await runner.status(rec.job)).state).toBe('refused');
  expect(await asks.needsYou(), 'the same question again').toEqual([]);
}, 60_000);

/** A stand-in claude that reports, in its result, what a real one needs from its job: a temp folder it can write,
 * its sign-in token (and whether the refresh token is anywhere in its environment), and the status its proxy
 * answers a CONNECT with, to a host that isn't its model API and to its model API. */
function prober(): string {
  const bin = join(dir, 'prober');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), `#!/bin/sh
for a in "$@"; do [ "$a" = --version ] && { echo "${facts.versions.at(-1)} (Claude Code)"; exit 0; }; done
cat >/dev/null
echo '{"type":"system","subtype":"init","session_id":"00000000-0000-4000-8000-0000000000bb"}'
( echo x > "$CLAUDE_CODE_TMPDIR/probe" && [ "$TMPDIR" = "$CLAUDE_CODE_TMPDIR" ] ) 2>/dev/null && tmp=ok || tmp=no
reach() { hp=\${HTTPS_PROXY#http://}; printf 'CONNECT %s HTTP/1.1\\r\\nHost: %s\\r\\n\\r\\n' "$1" "$1" | /usr/bin/nc -w 3 \${hp%:*} \${hp##*:} | head -1 | cut -d' ' -f2; }
refresh=$(env | /usr/bin/grep -c ref-made-up)
echo '{"type":"result","subtype":"success","is_error":false,"result":"tmp='$tmp' token='"$CLAUDE_CODE_OAUTH_TOKEN"' other='$(reach example.com:443)' api='$(reach api.anthropic.com:443)' refresh='$refresh' tmpdir='"$CLAUDE_CODE_TMPDIR"'","total_cost_usd":0,"session_id":"00000000-0000-4000-8000-0000000000bb"}'
`, { mode: 0o755 });
  return bin;
}

/** A proxy of yours, on this machine: it answers every CONNECT with 200 and records what it was asked for. */
async function upstream(): Promise<{ url: string; asked: string[]; close: () => Promise<void> }> {
  const asked: string[] = [];
  const server = createServer((socket) => {
    let head = '';
    socket.on('data', (c) => {
      head += c.toString('latin1');
      if (!head.includes('\r\n\r\n')) return;
      asked.push(head.split('\r\n')[0]!);
      socket.end('HTTP/1.1 200 Connection Established\r\n\r\n');
    });
    socket.on('error', () => undefined);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, asked, close: () => new Promise((done) => server.close(() => done())) };
}
const signIn = (expiresAt: number) => JSON.stringify({ claudeAiOauth: { accessToken: 'tok-made-up-159', refreshToken: 'ref-made-up-159', expiresAt } });

it('gives a real agent\'s job what it needs and no more: its own temp folder, your sign-in token, and only its model API, through your proxy', async () => {
  const proxy = await upstream();
  try {
    await open(prober(), { HTTPS_PROXY: proxy.url }, async (service) => (service === 'Claude Code-credentials' ? signIn(Date.now() + 3_600_000) : undefined));
    await runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: limits(5) });
    const rec = await runner.run({ kind: 'read', agent: 'claude-code', prompt: 'Read.' });
    expect(rec.state, JSON.stringify(rec)).toBe('finished');
    const said = Object.fromEntries(String(rec.result).split(' ').map((kv) => kv.split('=') as [string, string]));
    expect(said.tmp, 'a temp folder the job can write').toBe('ok');
    expect(said.token, 'the access token from your Keychain sign-in').toBe('tok-made-up-159');
    expect(said.refresh, 'the refresh token is in the job\'s environment').toBe('0');
    expect(said.other, 'a CONNECT to a host that is not its model API').toBe('403');
    expect(said.api, 'a CONNECT to its model API').toBe('200');
    expect(proxy.asked, 'what your proxy was asked for').toEqual(['CONNECT api.anthropic.com:443 HTTP/1.1']);
    expect(said.tmpdir!.startsWith(rec.folder), 'its temp folder is inside its job folder, where a credential search looks').toBe(false);
    expect(existsSync(said.tmpdir!), 'its temp folder is still there after the job').toBe(false);
  } finally {
    await proxy.close();
  }
}, 60_000);

it('hands a job no token from an expired sign-in', async () => {
  await open(prober(), {}, async () => signIn(Date.now() - 1000));
  await runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: limits(5) });
  const rec = await runner.run({ kind: 'read', agent: 'claude-code', prompt: 'Read.' });
  expect(String(rec.result)).toContain('token= ');
}, 60_000);

it('refuses a job when your HTTPS_PROXY is one the forwarder can\'t use, rather than going around it', async () => {
  await open(prober(), { HTTPS_PROXY: 'https://proxy.example:8443' });
  await runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: limits(5) });
  const rec = await runner.run({ kind: 'read', agent: 'claude-code', prompt: 'Read.' });
  expect(rec.state).toBe('refused');
  expect(rec.refused).toContain('HTTPS_PROXY');
}, 60_000);

/** A stand-in claude that leaves its temp folder holding a folder it made read-only, then answers. */
function locker(): string {
  const bin = join(dir, 'locker');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), `#!/bin/sh
for a in "$@"; do [ "$a" = --version ] && { echo "${facts.versions.at(-1)} (Claude Code)"; exit 0; }; done
cat >/dev/null
mkdir "$TMPDIR/x" && touch "$TMPDIR/x/f" && chmod 500 "$TMPDIR/x"
echo '{"type":"result","subtype":"success","is_error":false,"result":"'"$TMPDIR"'","total_cost_usd":0,"session_id":"00000000-0000-4000-8000-0000000000dd"}'
`, { mode: 0o755 });
  return bin;
}

it('ends a job whose temp folder it made hard to remove, and removes it', async () => {
  await open(locker());
  await runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: limits(5) });
  const rec = await Promise.race([runner.run({ kind: 'read', agent: 'claude-code', prompt: 'Read.' }), new Promise<undefined>((done) => setTimeout(done, 20_000))]);
  expect(rec?.state, 'the job never ended').toBe('finished');
  expect(existsSync(String(rec!.result)), 'its temp folder is still there').toBe(false);
}, 60_000);

it('removes the temp folder of a job a hub crash cut', async () => {
  const bin = join(dir, 'sleeper');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), `#!/bin/sh
for a in "$@"; do [ "$a" = --version ] && { echo "${facts.versions.at(-1)} (Claude Code)"; exit 0; }; done
cat >/dev/null
echo '{"type":"system","subtype":"init","session_id":"00000000-0000-4000-8000-0000000000ee"}'
exec /bin/sleep 30
`, { mode: 0o755 });
  await open(bin);
  await runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: limits(5) });
  const rec = await runner.submit({ kind: 'read', agent: 'claude-code', prompt: 'Read.' });
  const id = rec.job.slice(rec.job.indexOf(':') + 1);
  const temps = () => readdirSync(realpathSync(tmpdir())).filter((n) => n.startsWith(`deep-job-${id}-`));
  expect(temps().length, 'the running job has its temp folder').toBe(1);
  // The hub dies with the job running: nothing of it ends the job.
  await runner.close();
  await sup.close();
  await record.close();
  record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  runner = await openRunner({
    record, asks, supervisor: sup, ledger: await openLedger({ record, asks, now: Date.now, price: async () => 0.5 }), now: Date.now, root: join(dir, 'root'),
    loginPath: '/usr/bin:/bin', env: { HOME: join(dir, 'home'), PATH: '/usr/bin:/bin' }, settings: { plan: { reserve_pct: 10 }, asks: { unblock: { deadline_ms: 86_400_000 } } },
  });
  await runner.tick();
  expect(['stopped', 'stopping']).toContain((await runner.status(rec.job)).state);
  expect(temps(), 'the cut job\'s temp folder').toEqual([]);
}, 60_000);

it('reads a result that names its own stop as that cause', async () => {
  await open(printing([{ type: 'result', subtype: 'error_max_turns', is_error: true, total_cost_usd: 0, session_id: '00000000-0000-4000-8000-0000000000cc' }]));
  await runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: limits(5) });
  const rec = await runner.run({ kind: 'read', agent: 'claude-code', prompt: 'Read.' });
  expect(rec.state).toBe('stopped');
  expect(rec.stop?.cause).toBe('max_turns');
}, 60_000);


/** A stand-in claude whose run prints these stream-json lines after its init, as Claude Code 2.1.304 prints them. */
function printing(lines: object[]): string {
  const bin = join(dir, `printing${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), `#!/bin/sh
for a in "$@"; do [ "$a" = --version ] && { echo "${facts.versions.at(-1)} (Claude Code)"; exit 0; }; done
cat >/dev/null
echo '{"type":"system","subtype":"init","session_id":"00000000-0000-4000-8000-0000000000cc"}'
${lines.map((l) => `echo '${JSON.stringify(l)}'`).join('\n')}
`, { mode: 0o755 });
  return bin;
}

it('reads a job that got no answer as stopped, by the error its stream-json names, never finished', async () => {
  const session = '00000000-0000-4000-8000-0000000000cc';
  // As a signed-out Claude Code prints it: a synthetic message marked an API error, then a result marked an error.
  await open(printing([
    { type: 'assistant', message: { id: 'm1', model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: 'Not logged in · Please run /login' }] }, error: 'authentication_failed', is_api_error_message: true, session_id: session },
    { type: 'result', subtype: 'success', is_error: true, terminal_reason: 'api_error', result: 'Not logged in · Please run /login', total_cost_usd: 0, session_id: session },
  ]));
  await runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: limits(5) });
  const signedOut = await runner.run({ kind: 'read', agent: 'claude-code', prompt: 'Read.' });
  expect(signedOut.state).toBe('stopped');
  expect(signedOut.stop?.cause).toBe('sign_in_required');
  await runner.close();
  await sup.close();
  await record.close();
  // A result marked an error with no error that names a cause.
  await open(printing([{ type: 'result', subtype: 'success', is_error: true, result: 'Something failed.', total_cost_usd: 0, session_id: session }]));
  await runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: limits(5) });
  const failed = await runner.run({ kind: 'read', agent: 'claude-code', prompt: 'Read.' });
  expect(failed.state).toBe('stopped');
  expect(failed.stop?.cause).toBe('unknown');
}, 60_000);
