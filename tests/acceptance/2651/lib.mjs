// #2651 acceptance: what the test files share. The change is the checkout these files are in; the merge base, where a
// criterion compares with it (AC4's values, AC5's budgets), is the built checkout DEEP_2651_BASE names (README: Run).
// Everything is reached from outside the code under test: `deep hub run` of a checkout on a home of its own, its socket
// as deep-hook and the CLI write it, the deep-hook binary itself, the record's SQLite file opened read-only, a probe
// process that loads a checkout's packages through their public entries (probe.mjs), the perf lane's own judge
// (scripts/benchmark.mjs), and two small C programs: rusage.c (a live process's instructions retired) and opens.c (the
// files a process opens). A missing checkout, build, hub or count fails its test as BLOCKED or INCONCLUSIVE.
//
// Safety: every home and folder is under /tmp/dh2651-*, removed after its test; every hub and job this suite starts is
// stopped by its PID (and a job's stand-in by its group, found by the suite's own folder in its command line). Nothing
// is stopped by name or port. No network, no model: the agent is a stand-in (fixtures/fake-claude.pl).
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HERE = fileURLToPath(new URL('.', import.meta.url));
export const CHANGE = resolve(HERE, '../../..');
export const BASE = process.env.DEEP_2651_BASE ? resolve(process.env.DEEP_2651_BASE) : null;
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
export const median = (values) => {
  const s = [...values].sort((a, b) => a - b), m = s.length / 2;
  return s.length % 2 ? s[Math.floor(m)] : (s[m - 1] + s[m]) / 2;
};

/** The issue's criteria, by `#<issue>.<first 8 hex of SHA-256 of the trimmed, space-collapsed text>`. */
export const AC = { 1: '#2651.251a1058', 2: '#2651.306dda20', 3: '#2651.1de95500', 4: '#2651.bc5a8e8d', 5: '#2651.59066289' };

// ---- Checkouts.
const BUILT = ['packages/cli/dist/main.js', 'packages/hub/dist/index.js', 'packages/record/dist/index.js', 'packages/extension-host/dist/index.js'];
/** Why `checkout` can't run, or null. */
export function unbuilt(checkout, files = BUILT) {
  if (!existsSync(checkout)) return `BLOCKED: there is no checkout at ${checkout}`;
  const missing = files.filter((file) => !existsSync(join(checkout, file)));
  return missing.length ? `BLOCKED: ${checkout} is not built (${missing.join(', ')} missing); run npm ci && npm run build --workspaces and cargo build -p deep-hook there` : null;
}
/** Why the change and the merge base can't be compared, or null. */
export function sidesProblem(files = BUILT) {
  if (!BASE) return 'BLOCKED: set DEEP_2651_BASE to a built checkout of the merge base (git merge-base HEAD origin/main; 8bfb6a633 when this suite was written)';
  return unbuilt(BASE, files) ?? unbuilt(CHANGE, files);
}
/** deep-hook as `cargo build -p deep-hook` leaves it in a checkout. */
export const hookBinary = (checkout) => join(checkout, 'target/debug/deep-hook');

// ---- Temp folders: short real paths (a Unix socket path fits in 104 bytes on macOS).
const made = new Set();
export function tempDir(tag = 'x') {
  const dir = realpathSync(mkdtempSync(`/tmp/dh2651-${tag}-`));
  made.add(dir);
  return dir;
}
/** Removes a folder now, and again as the process exits: something a hook started may still write into it. */
export function removeDir(dir) {
  rmSync(dir, { recursive: true, force: true });
}
process.once('exit', () => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });

/** The record's SQLite file, opened read-only with the library the record itself uses. */
export function sqlite(file) {
  const Database = createRequire(join(CHANGE, 'packages/record/package.json'))('better-sqlite3');
  return new Database(file, { readonly: true, fileMustExist: true });
}

// ---- IDs.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function base32(value, length) {
  let text = '';
  for (let i = 0; i < length; i++) { text = CROCKFORD[Number(value & 31n)] + text; value >>= 5n; }
  return text;
}
export const ulid = (ms = Date.now()) => base32(BigInt(ms), 10) + base32(BigInt(`0x${randomBytes(10).toString('hex')}`), 16);
export const uuid = () => {
  const h = randomBytes(16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
let lastSeq = 0n;
/** deep-hook's stamp: the wall clock in ns when the hook started, as a decimal string, never repeating here. */
export function seqNow() {
  let s = BigInt(Date.now()) * 1_000_000n;
  if (s <= lastSeq) s = lastSeq + 1n;
  lastSeq = s;
  return s.toString();
}
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// ---- The hub: `deep hub run` of one checkout, HOME a temp folder, so its root is <home>/.deepbuild.
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN'];
/** This process's environment less the agent's own and any billing variable, with HOME and the given ones. */
export function childEnv(home, extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('CLAUDE') || key.startsWith('TMUX') || key === 'AI_AGENT' || key === 'NODE_OPTIONS' || key.startsWith('DYLD_') || BILLING.includes(key)) continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), LC_ALL: 'C', ...extra };
}
/** Starts `checkout`'s hub on `home` and waits for its ready line. */
export async function startHub(checkout, home, env = {}) {
  mkdirSync(join(home, '.deepbuild'), { recursive: true });
  const child = spawn(process.execPath, [join(checkout, 'packages/cli/dist/main.js'), 'hub', 'run'], { cwd: checkout, env: childEnv(home, env), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stderr.setEncoding('utf8').on('data', (text) => (output = (output + text).slice(-20_000)));
  const exit = new Promise((done) => child.once('exit', done));
  const ready = await new Promise((done) => {
    let first = '';
    const timer = setTimeout(() => done(null), 300_000);
    child.stdout.setEncoding('utf8').on('data', (text) => {
      first += text;
      if (!first.includes('\n')) return;
      clearTimeout(timer);
      try {
        done(JSON.parse(first.split('\n')[0]));
      } catch {
        done(null);
      }
    });
    child.on('error', () => { clearTimeout(timer); done(null); });
    void exit.then(() => { clearTimeout(timer); done(null); });
  });
  const hub = { child, exit, pid: ready?.pid ?? child.pid, home, root: join(home, '.deepbuild'), socket: ready?.socket ?? join(home, '.deepbuild', 'hub.sock'), output: () => output };
  if (ready?.ready !== true) {
    await stopHub(hub);
    throw Error(`BLOCKED: the hub of ${checkout} didn't start${env.DEEP_HUB_PLANT ? ` with DEEP_HUB_PLANT=${env.DEEP_HUB_PLANT}` : ''}: ${output.slice(-1500) || 'it printed no ready line'}`);
  }
  return hub;
}
/** Stops a hub this suite started, by its PID, and waits for it to go. */
export async function stopHub(hub) {
  if (hub.child.exitCode !== null || hub.child.signalCode !== null) return;
  for (const pid of new Set([hub.child.pid, hub.pid])) {
    try {
      if (pid) process.kill(pid, 'SIGTERM');
    } catch { /* gone already */ }
  }
  await Promise.race([hub.exit, sleep(20_000)]);
  if (hub.child.exitCode === null && hub.child.signalCode === null) hub.child.kill('SIGKILL');
}

/** One connection of the hub's line protocol: `write` a line, `next` the first unread line that matches. */
export function connect(socket) {
  const sock = net.connect(socket);
  const got = [], wakers = new Set();
  let buffer = '', read = 0, ended = null;
  const wake = () => { for (const waker of [...wakers]) waker(); };
  sock.setEncoding('utf8');
  sock.on('data', (chunk) => {
    buffer += chunk;
    for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
      const text = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      try {
        got.push(JSON.parse(text));
      } catch { /* no line of the protocol */ }
    }
    wake();
  });
  sock.on('error', (error) => { ended ??= error.message; wake(); });
  sock.on('close', () => { ended ??= 'the hub closed the connection'; wake(); });
  return {
    write: (line) => sock.write(`${JSON.stringify(line)}\n`),
    close: () => sock.destroy(),
    next: (match, ms, what) => new Promise((done, fail) => {
      const settle = (act, value) => { clearTimeout(timer); wakers.delete(check); act(value); };
      const check = () => {
        for (; read < got.length; read++) if (match(got[read])) return settle(done, got[read++]);
        if (ended) settle(fail, Error(`BLOCKED: no ${what}: ${ended}`));
      };
      const timer = setTimeout(() => settle(fail, Error(`BLOCKED: no ${what} within ${ms / 1000} s`)), ms);
      wakers.add(check);
      check();
    }),
  };
}
/** A cli connection with the control token, kept open: `call(method, params)` gives the result. */
export async function client(hub) {
  const conn = connect(hub.socket);
  await conn.next(() => true, 30_000, 'hello from the hub');
  conn.write({ v: 1, hello: 'cli', token: readFileSync(join(hub.root, 'control.token'), 'utf8').trim() });
  const role = await conn.next((line) => 'role' in line || 'error' in line, 30_000, 'reply to the cli hello');
  if (role.role !== 'cli') throw Error(`BLOCKED: the hub refused the cli hello: ${JSON.stringify(role)}`);
  let calls = 0;
  return {
    close: () => conn.close(),
    call: async (method, params = {}, ms = 300_000) => {
      const id = `${method}#${++calls}`;
      conn.write({ v: 1, id, method, params });
      const reply = await conn.next((line) => line.id === id && ('result' in line || 'error' in line), ms, `reply to ${method}`);
      if ('error' in reply) throw Error(`the hub refused ${method}: ${JSON.stringify(reply.error)}`);
      return reply.result;
    },
  };
}
/** Every event the hub's events.read gives the cli, oldest first; `kinds` narrows it. */
export async function events(c, kinds) {
  const out = [];
  for (let after = 0; ;) {
    const page = await c.call('events.read', { after, limit: 1000, ...(kinds ? { kinds } : {}) });
    const got = page.events ?? [];
    if (!got.length) return out;
    out.push(...got);
    after = got[got.length - 1].log_pos;
  }
}

/** A Claude Code hook payload of `session` working in `cwd`, its transcript under the hub's home. */
export const payloadOf = (home, session, cwd, fields = {}) => ({ session_id: session, transcript_path: join(home, '.claude', 'projects', 'work', `${session}.jsonl`), cwd, permission_mode: 'default', ...fields });
/**
 * deep-hook's part, carried by the test: hello, one hook request line as deep-hook sends it, its acknowledgement and
 * its reply. `onSend` runs just before the request is written. Gives { id, ack, reply, lines }.
 */
export async function sendHook(socket, event, payload, o = {}) {
  const now = Date.now();
  const id = o.id ?? ulid(now);
  const request = { v: 1, agent: 'claude-code', event, seq: o.seq ?? seqNow(), id, pid: process.pid, ppid: process.ppid, matched: [], payload: { ...payload, hook_event_name: event } };
  const conn = connect(socket);
  try {
    await conn.next((line) => 'hello' in line, 30_000, 'hello from the hub');
    o.onSend?.();
    conn.write(request);
    const ack = await conn.next((line) => 'ack' in line || 'exit' in line || 'error' in line, o.ms ?? 120_000, `acknowledgement of ${event}`);
    if ('error' in ack) throw Error(`BLOCKED: the hub refused ${event}: ${JSON.stringify(ack).slice(0, 300)}`);
    const reply = 'exit' in ack ? ack : await conn.next((line) => 'exit' in line || 'error' in line, o.ms ?? 120_000, `reply to ${event}`);
    if ('error' in reply) throw Error(`BLOCKED: the hub refused ${event}: ${JSON.stringify(reply).slice(0, 300)}`);
    return { id, ack, reply };
  } finally {
    conn.close();
  }
}

/** Polls `read` until it gives something, or fails with `problem` after `ms`. */
export async function until(read, ms, problem) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > end) throw Error(typeof problem === 'function' ? problem() : problem);
    await sleep(25);
  }
}

// ---- C helpers, built once per run into a temp folder (macOS; `cc` from the Command Line Tools).
const builds = {};
/** { bin } for rusage.c or { lib } for opens.c, or { blocked } saying why this host can't build it. */
export function cBuild(name) {
  if (builds[name]) return builds[name];
  if (process.platform !== 'darwin') return (builds[name] = { blocked: `INCONCLUSIVE: ${name} runs on macOS only, not ${process.platform}` });
  const dir = tempDir('cc');
  const out = join(dir, name === 'opens' ? 'opens.dylib' : name);
  try {
    execFileSync('cc', ['-O2', '-Wall', '-Werror', ...(name === 'opens' ? ['-dynamiclib'] : []), '-o', out, join(HERE, `${name}.c`)], { stdio: 'pipe' });
  } catch (error) {
    return (builds[name] = { blocked: `INCONCLUSIVE: cc could not build ${name}.c: ${String(error.stderr ?? error.message).slice(0, 300)}` });
  }
  return (builds[name] = name === 'opens' ? { lib: out } : { bin: out });
}
/** The instructions a live process has retired so far, or throws INCONCLUSIVE when the kernel gives none. */
export function instructionsOf(pid) {
  const built = cBuild('rusage');
  if (built.blocked) throw Error(built.blocked);
  const r = spawnSync(built.bin, [String(pid)], { encoding: 'utf8' });
  const n = Number(r.stdout);
  if (r.status !== 0 || !Number.isSafeInteger(n) || n <= 0) throw Error(`INCONCLUSIVE: no instruction count for process ${pid} (rusage exited ${r.status})`);
  return n;
}
/** The perf lane's own judge of paired instruction counts (scripts/benchmark.mjs of this checkout): 2%, sign flips. */
export async function perfJudge() {
  return import(pathToFileURL(join(CHANGE, 'scripts/benchmark.mjs')).href);
}

// ---- AC3's agent: the stand-in `claude` (fixtures/fake-claude.pl), and a Claude Code sign-in under the hub's HOME.
export const ACCOUNT = '0a0a0a0a-1111-4222-8333-265126512651';
/** The newest version the Claude Code facts cover, so the runner takes the stand-in as a covered CLI. */
export function coveredVersion(checkout = CHANGE) {
  return JSON.parse(readFileSync(join(checkout, 'adapters/claude-code.facts.json'), 'utf8')).versions.at(-1);
}
/** Installs the stand-in as `<dir>/claude`; gives its path. */
export function installClaude(dir) {
  mkdirSync(dir, { recursive: true });
  const text = readFileSync(join(HERE, 'fixtures/fake-claude.pl'), 'utf8')
    .replace("'__VERSION__'", `'${coveredVersion()}'`).replace('__SLOW__', '0').replace('__EVIL__', '0').replace('__STARTUP__', '0');
  const path = join(dir, 'claude');
  writeFileSync(path, text, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}
/** A made-up Claude Code sign-in under `home`: ~/.claude.json with the account, and credentials that reach nothing. */
export function signIn(home) {
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT, emailAddress: 'dh2651@example.invalid', organizationUuid: 'org-dh2651' }, mcpServers: {}, projects: {} })}\n`);
  writeFileSync(join(home, '.claude', '.credentials.json'), `${JSON.stringify({ claudeAiOauth: { accessToken: `sk-ant-oat01-dh2651FAKE${'x'.repeat(40)}`, refreshToken: `sk-ant-ort01-dh2651FAKE${'y'.repeat(40)}`, expiresAt: 4102444800000, scopes: ['user:inference'], subscriptionType: 'max' } })}\n`, { mode: 0o600 });
  writeFileSync(join(home, '.claude', 'settings.json'), '{}\n');
}
/** A window reading with room, as the status line forwarder sends it: 5% of the five-hour window used. */
export function room(c) {
  const resets = Math.floor((Date.now() + 3 * 3_600_000) / 1000);
  return c.call('windows.report', { agent: 'claude-code', account: ACCOUNT, rate_limits: { five_hour: { used_percentage: 5, resets_at: resets }, seven_day: { used_percentage: 20, resets_at: resets + 5 * 86_400 } } });
}
/** Stops what a hub's jobs left running: the stand-ins whose command line names this suite's `dir`, by PID. */
export function stopLeftovers(dir) {
  let table = '';
  try {
    table = execFileSync('ps', ['-A', '-ww', '-o', 'pid=,args='], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return; }
  for (const line of table.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m || Number(m[1]) === process.pid || !m[2].includes(dir)) continue;
    try { process.kill(Number(m[1]), 'SIGKILL'); } catch { /* gone */ }
  }
}

/** Machine state for each reading: load and thermal state, never a gate (README). */
export function machine() {
  const read = (cmd, ...args) => { try { return execFileSync(cmd, args, { encoding: 'utf8' }).trim(); } catch { return '?'; } };
  return `load ${read('sysctl', '-n', 'vm.loadavg')}; ${read('pmset', '-g', 'therm').split('\n').filter((l) => l.trim()).join(' ').replace(/\s+/g, ' ')}`;
}
