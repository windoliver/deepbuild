// The Linux twin of #1156's live checkpoint (README). The world, the session's script and every reading are
// ../helpers.ts's, imported where they hold on any platform; what differs is what #70 names for Linux: the hub runs as
// the systemd user service `deep setup` installs, and an answer from the CLI counts once polkit confirms you, in
// place of the signed deep-confirm and launchd. What ../helpers.ts keeps to itself (the world's parts) is adapted
// here from it (same repo, same license). Processes are stopped by PID only, never by name or port.

import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import {
  AC4, API_CALL, CLEAN, COMMIT_MESSAGE, COMPUTED, ENV_UP, FIXTURES, HARNESS, MIRROR_PUSH, NESTED, NODE, PADDING, PROMPT, PUSH, QUESTION, REPO, SCENARIO, VALUE, VENDOR,
  Agent, called, childEnv, cleanup, credentialHits, deep, eventsBetween, git, hashes, jsonLines, remoteMain, run, sessionScript, sha256, shown, sleep, startHub, stepsOf, stopHub,
  reportOf, transcriptCalls, waitFor, type Api, type Ev, type Home, type Line, type Ran, type Repo, type Seen, type Stack, type Step, type World,
} from '../helpers.ts';

/** Where the world lives: on Linux only btrfs or XFS can make the copy-on-write copy staging keeps (design, Staging). */
const BASE = '/var/tmp';
const PROOF_DIR = '/tmp/deep-1156-linux-proof';
/** setup's unit (packages/hub/src/service.ts), and the target the test's own user manager starts, which pulls in nothing. */
const UNIT = 'deepbuild-hub.service';
const TARGET = 'dh1156.target';
const POLKIT = ['--dest', 'org.freedesktop.PolicyKit1', '--object-path', '/org/freedesktop/PolicyKit1/Authority'];
/** The base's planted CLI that counts an answer because the peer check found no agent above it (#70's wrong program). */
export const PEER_CHECK = 'answer-on-peer-check';
/** What the run needs of the machine, each named when missing. */
const TOOLS: [string, string][] = [
  ['systemctl', 'the hub as a systemd user service'], ['systemd-run', 'the test\'s own user manager, in a delegated scope of yours'],
  ['dbus-daemon', 'the private bus polkit is stood in on'], ['gdbus', 'driving the polkit stand-in'], ['python3', 'python-dbusmock\'s polkitd template'],
  ['bwrap', 'the platform sandbox\'s Linux backend (#236)'], ['script', 'the harness\'s pseudo-terminal'], ['lsof', 'deep env up\'s ports'],
  ['curl', 'the app\'s call'], ['openssl', 'the sample API\'s test CA'], ['cargo', 'deep-hook'], ['git', 'the fixture repo'],
];

export interface LinuxHome extends Home { runtime: string; bus: string; polkitLog: string; systemd: string }
/** Your answers, as the CLI took them with polkit's prompt cancelled or confirmed (README: Readings, AC4). */
interface Polkit { A: string; B: string; cancelled: Ran; afterCancelled: Ev[]; yes: Ran; checks: number; later: Ran; afterLater: Ev[]; no: Ran }
export interface LinuxWorld extends World { h: LinuxHome; polkit?: Polkit }

// ---- What this file started, stopped by PID, and its folders.
const mine = new Set<number>();
/** The service's hub as last read; the user manager stops it, and this PID is the fallback. */
let hubPid = 0;
const dirs: string[] = [];
const closers: (() => Promise<void>)[] = [];
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
async function stopPids(all: number[]): Promise<void> {
  const pids = all.filter((pid) => pid > 0);
  for (const pid of pids) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 15_000;
  while (pids.some(alive) && Date.now() < deadline) await sleep(100);
  for (const pid of pids) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
}
/** The test's user manager first (its exit.target stops the hub's unit), then the app's PIDs, the bus, and ../helpers.ts's own. */
export async function cleanupLinux(): Promise<void> {
  for (const dir of dirs) {
    const pids = join(dir, 'checkout-web', '.pids');
    if (existsSync(pids)) for (const name of readdirSync(pids)) { const pid = Number(/^app\.(\d+)$/.exec(name)?.[1]); if (pid) mine.add(pid); }
  }
  await stopPids([...mine].reverse());
  await stopPids([hubPid]);
  mine.clear();
  for (const close of closers.splice(0)) await close().catch(() => undefined);
  await cleanup();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}
function daemon(command: string, args: string[], env: NodeJS.ProcessEnv): { err: () => string } {
  const child = spawn(command, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
  if (child.pid) mine.add(child.pid);
  let err = '';
  child.stderr.setEncoding('utf8').on('data', (d: string) => (err += d));
  child.on('error', (e) => (err += String(e)));
  return { err: () => err.slice(-1500) };
}

// ---- The machine and the home (README: The world).
const onPath = (bin: string) => (process.env.PATH ?? '').split(':').concat('/usr/bin', '/usr/sbin').some((d) => d && existsSync(join(d, bin)));
/** BLOCKED, naming it, for each thing this machine lacks; the user manager's binary when nothing does. */
export function needLinux(id: string): string {
  if (process.platform !== 'linux') throw Error(`BLOCKED: ${id} is #1156's Linux twin and runs only on Linux; this is ${process.platform}`);
  const missing = TOOLS.filter(([bin]) => !onPath(bin)).map(([bin, why]) => `${bin} (${why})`);
  if (spawnSync('python3', ['-c', 'import dbusmock'], { stdio: 'ignore' }).status !== 0) missing.push('python-dbusmock (the polkit stand-in)');
  const systemd = ['/usr/lib/systemd/systemd', '/lib/systemd/systemd'].find((p) => existsSync(p));
  if (!systemd) missing.push('/usr/lib/systemd/systemd (the test\'s own user manager)');
  if (missing.length) throw Error(`BLOCKED: ${id}: this machine has no ${missing.join(', ')}`);
  return systemd!;
}
function makeHome(claude: string, systemd: string): LinuxHome {
  for (const dist of ['packages/hub/dist/index.js', 'packages/cli/dist/main.js']) if (!existsSync(join(REPO, dist))) throw Error(`BLOCKED: ${dist} is missing; run npm ci and npm run build --workspaces first`);
  const tmp = realpathSync(mkdtempSync(join(BASE, 'dh1156-')));
  dirs.push(tmp);
  writeFileSync(join(tmp, 'cow'), 'cow');
  if (spawnSync('cp', ['--reflink=always', join(tmp, 'cow'), join(tmp, 'cow.copy')]).status !== 0) throw Error(`BLOCKED: ${BASE} can't make a copy-on-write copy (staging needs btrfs, or XFS with reflink, there)`);
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  const runtime = join(tmp, 'r');
  for (const dir of [join(home, '.claude'), join(home, '.config', 'systemd', 'user'), bin, join(tmp, 't'), join(tmp, 'k')]) mkdirSync(dir, { recursive: true });
  mkdirSync(runtime, { mode: 0o700 });
  const script = (name: string, text: string) => { writeFileSync(join(bin, name), text); chmodSync(join(bin, name), 0o755); };
  const cli = join(REPO, 'packages/cli/dist/main.js');
  script('deep', `#!/bin/sh\nexec '${NODE}' '${cli}' "$@"\n`);
  script('sh-login', [
    '#!/bin/sh', `PATH='${bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin'; export PATH`,
    'for a; do shift; case "$a" in -l|-i|--login|-il|-li) ;; -lc|-cl|-ilc|-lic|-ic|-ci) set -- "$@" -c ;; *) set -- "$@" "$a" ;; esac; done', 'exec /bin/sh "$@"', '',
  ].join('\n'));
  symlinkSync(claude, join(bin, 'claude'));
  writeFileSync(join(home, '.claude', 'settings.json'), '{}\n');
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', numStartups: 3 })}\n`);
  writeFileSync(join(home, '.config', 'systemd', 'user', TARGET), '[Unit]\nDescription=dh1156: the test\'s own user manager, which starts nothing of yours\n');
  const sorter = join(tmp, 'sorter.json');
  writeFileSync(sorter, JSON.stringify({ rule: 'planted-proceed-1156', proceed: [QUESTION] }));
  const bus = `unix:path=${join(tmp, 'bus')}`;
  return {
    tmp, home, bin, root: join(home, '.deepbuild'), settings: join(home, '.claude', 'settings.json'), shadow: REPO, cli, helper: '', work: join(tmp, 'k'), built: '', claude: join(bin, 'claude'),
    runtime, bus, polkitLog: join(tmp, 'polkit.log'), systemd,
    // Your session bus and keyring, system bus and user manager are never reached: each is the test's own.
    env: { XDG_RUNTIME_DIR: runtime, DBUS_SYSTEM_BUS_ADDRESS: bus, DBUS_SESSION_BUS_ADDRESS: bus, DEEP_HUB_TEST_MANAGED_SETTINGS: join(tmp, 'no-managed-settings.json'), DEEP_HUB_TEST_SORTER: sorter },
  };
}

// ---- polkit, stood in at its boundary (#70, AC6): python-dbusmock's polkitd template on the test's own bus.
const gdbus = (h: LinuxHome, args: string[]) => run('gdbus', ['call', '--address', h.bus, ...args], { env: childEnv(h), timeoutMs: 20_000 });
async function startBus(h: LinuxHome): Promise<void> {
  const bus = daemon('dbus-daemon', ['--session', '--nofork', '--nopidfile', `--address=${h.bus}`], childEnv(h));
  if (!(await waitFor(() => existsSync(join(h.tmp, 'bus')), 10_000))) throw Error(`BLOCKED: dbus-daemon opened no bus at ${h.bus}: ${bus.err()}`);
  const mock = daemon('python3', ['-m', 'dbusmock', '--system', '--template', 'polkitd', '--logfile', h.polkitLog], childEnv(h));
  const owned = await waitFor(async () => /true/.test((await gdbus(h, ['--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.NameHasOwner', 'org.freedesktop.PolicyKit1'])).stdout), 20_000);
  if (!owned) throw Error(`BLOCKED: python-dbusmock's polkitd template didn't take org.freedesktop.PolicyKit1: ${mock.err()}`);
  await polkit(h, false);
}
/** `true`: polkit confirms you (you typed your login password); `false`: its prompt was cancelled. */
async function polkit(h: LinuxHome, confirms: boolean): Promise<void> {
  const calls: [string, string][] = confirms ? [['AllowUnknown', 'true']] : [['AllowUnknown', 'false'], ['SetAllowed', '@as []']];
  for (const [method, arg] of calls) {
    const r = await gdbus(h, [...POLKIT, '--method', `org.freedesktop.DBus.Mock.${method}`, arg]);
    if (r.code !== 0) throw Error(`BLOCKED: the polkit stand-in took no ${method}(${arg}): ${shown(r)}`);
  }
}
/** How many times polkit was asked whether you are you. */
const polkitChecks = (h: LinuxHome) => (existsSync(h.polkitLog) ? readFileSync(h.polkitLog, 'utf8').split('\n').filter((l) => l.includes('CheckAuthorization')).length : 0);

// ---- The test's own systemd user manager, which `deep setup`'s systemctl reaches through XDG_RUNTIME_DIR.
const systemctl = (h: LinuxHome, ...args: string[]) => run('systemctl', ['--user', ...args], { env: childEnv(h), timeoutMs: 60_000 });
async function startManager(h: LinuxHome, extra: Record<string, string>): Promise<void> {
  const env = childEnv(h, extra);
  const pairs = Object.entries(env).flatMap(([k, v]) => (v === undefined ? [] : [`${k}=${v}`]));
  const manager = daemon('systemd-run', ['--user', '--scope', '--quiet', '-p', 'Delegate=yes', '--', '/usr/bin/env', '-i', ...pairs, h.systemd, '--user', `--unit=${TARGET}`], process.env);
  if (!(await waitFor(async () => (await systemctl(h, 'show-environment')).code === 0, 30_000))) {
    throw Error(`BLOCKED: no user manager of the test's came up through systemd-run --user --scope -p Delegate=yes ${h.systemd} --user: ${manager.err()}`);
  }
  // The unit names PATH and HOME; the rest of the test's environment reaches the hub from its manager.
  const keys = [...Object.keys(h.env), ...Object.keys(extra), 'TMPDIR', 'LC_ALL', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME'];
  const set = await systemctl(h, 'set-environment', ...keys.map((k) => `${k}=${env[k]}`));
  if (set.code !== 0) throw Error(`BLOCKED: the test's user manager took no environment: ${shown(set)}`);
}
const hubAnswers = (h: Home) => new Promise<boolean>((done) => {
  const s = net.connect(join(h.root, 'hub.sock'));
  const end = (v: boolean) => { s.destroy(); done(v); };
  s.once('data', () => end(true));
  s.once('error', () => end(false));
  setTimeout(() => end(false), 2000);
});
async function mainPid(h: LinuxHome): Promise<number> {
  const pid = Number((await systemctl(h, 'show', '-p', 'MainPID', '--value', UNIT)).stdout.trim());
  if (pid > 0) hubPid = pid;
  return pid;
}
async function serviceStart(h: LinuxHome): Promise<void> {
  const r = await systemctl(h, 'start', UNIT);
  if (r.code !== 0 || !(await waitFor(() => hubAnswers(h), 30_000))) throw Error(`BLOCKED: ${UNIT} brought no hub up: ${shown(r)} ${(await systemctl(h, 'status', '--no-pager', UNIT)).stdout.slice(-1500)}`);
  await mainPid(h);
}
export async function serviceStop(h: LinuxHome): Promise<void> {
  await systemctl(h, 'stop', UNIT);
  await waitFor(async () => !(await hubAnswers(h)), 15_000);
}

// ---- The sample API, the fixture repo and fixtures/core.mjs: ../helpers.ts's, which it keeps to itself.
async function startApi(h: Home): Promise<Api> {
  const dir = join(h.tmp, 'tls');
  mkdirSync(dir);
  writeFileSync(join(dir, 'openssl.cnf'), [
    '[req]', 'distinguished_name = dn', '[dn]', '[v3_ca]', 'basicConstraints = critical,CA:TRUE', 'keyUsage = critical,keyCertSign,cRLSign', 'subjectKeyIdentifier = hash',
    '[v3_leaf]', 'basicConstraints = CA:FALSE', 'keyUsage = critical,digitalSignature,keyEncipherment', 'extendedKeyUsage = serverAuth', 'subjectAltName = DNS:localhost,IP:127.0.0.1,IP:::1', '',
  ].join('\n'));
  const ssl = (...args: string[]) => spawnSync('openssl', args, { cwd: dir, stdio: 'ignore', env: { ...process.env, LC_ALL: 'C' } }).status;
  const made = [
    ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=dh1156 sample API test CA', '-config', 'openssl.cnf', '-extensions', 'v3_ca'),
    ssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'api.key', '-out', 'api.csr', '-subj', '/CN=localhost', '-config', 'openssl.cnf'),
    ssl('x509', '-req', '-in', 'api.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'api.pem', '-days', '2', '-extfile', 'openssl.cnf', '-extensions', 'v3_leaf'),
  ];
  if (made.some((s) => s !== 0)) throw Error('BLOCKED: openssl made no test CA for the sample API');
  const seen: Line[] = [];
  const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    req.resume();
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: { ...req.headers } });
      res.writeHead(req.headers.authorization === `Bearer ${VALUE}` ? 200 : 401, { 'content-type': 'application/json' });
      res.end('{}');
    });
  };
  const tls = { key: readFileSync(join(dir, 'api.key')), cert: readFileSync(join(dir, 'api.pem')) };
  const v4 = https.createServer(tls, handler);
  await new Promise<void>((resolve, reject) => { v4.once('error', reject); v4.listen(0, '127.0.0.1', resolve); });
  const { port } = v4.address() as net.AddressInfo;
  const v6 = https.createServer(tls, handler);
  const both = await new Promise<boolean>((resolve) => { v6.once('error', () => resolve(false)); v6.listen(port, '::1', () => resolve(true)); });
  closers.push(async () => { for (const s of both ? [v4, v6] : [v4]) { s.closeAllConnections(); await new Promise<void>((r) => s.close(() => r())); } });
  return { host: `localhost:${port}`, seen, caFile: join(dir, 'ca.pem') };
}
function makeRepo(h: Home, api: Api): Repo {
  const dir = join(h.tmp, 'checkout-web');
  const origin = join(h.tmp, 'origin.git');
  cpSync(join(FIXTURES, 'checkout-web'), dir, { recursive: true });
  const ext = join(dir, 'extensions', 'vendor-guard');
  cpSync(join(FIXTURES, 'vendor-guard'), ext, { recursive: true });
  renameSync(join(ext, 'index.ts.fixture'), join(ext, 'index.ts'));
  mkdirSync(join(dir, '.deepbuild'));
  writeFileSync(join(dir, '.deepbuild', 'done.yaml'), [
    'environment:', `  up: ${JSON.stringify(`${NODE} app.mjs ${api.host}`)}`, '  ports: [web]', '  ready: { http: "http://127.0.0.1:${web}/health", within: 20 }', '  credentials:',
    `    SHOP_API_KEY: { dotfile: "~/.shop/test.env", hosts: [${JSON.stringify(api.host)}], methods: [GET] }`, '',
  ].join('\n'));
  mkdirSync(join(h.home, '.shop'), { recursive: true });
  writeFileSync(join(h.home, '.shop', 'test.env'), `SHOP_API_KEY=${VALUE}\n`, { mode: 0o600 });
  git(h, h.tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  const g = (...args: string[]) => git(h, dir, ...args);
  g('init', '-q', '-b', 'main');
  for (const [k, v] of [['user.name', 'Checkout Dev'], ['user.email', 'checkout@example.invalid'], ['commit.gpgsign', 'false']] as const) g('config', k, v);
  g('remote', 'add', 'origin', origin);
  g('add', '-A');
  g('commit', '-q', '-m', 'Start the checkout page');
  g('push', '-q', 'origin', 'main');
  mkdirSync(join(dir, 'out'));
  for (let i = 0; i < 200; i++) writeFileSync(join(dir, 'out', `bundle-${String(i).padStart(3, '0')}.js`), sha256(`${i}`).repeat(i < 4 ? 1024 : 8));
  cpSync(join(dir, 'out'), join(h.tmp, 'out-copy'), { recursive: true });
  return { dir, origin, out: hashes(join(dir, 'out')) };
}
async function core(h: Home, op: string, args: Line): Promise<Line> {
  const r = await run(NODE, ['--no-warnings', join(FIXTURES, 'core.mjs'), op, JSON.stringify(args)], { env: childEnv(h), cwd: h.tmp, timeoutMs: 1_200_000 });
  const out = jsonLines(r.stdout).at(-1);
  if (r.code !== 0 || !out) throw Error(`BLOCKED: fixtures/core.mjs ${op} failed: ${shown(r)}`);
  return out;
}

// ---- The world: deep-hook built, polkit stood in, `deep setup` with the test's user manager, seeded and padded.
async function makeWorld(claude: string): Promise<LinuxWorld> {
  const systemd = needLinux('#1156');
  const built = await run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { cwd: REPO, env: { ...process.env, CARGO_INCREMENTAL: '0' }, timeoutMs: 1_200_000 });
  if (built.code !== 0) throw Error(`BLOCKED: cargo build -p deep-hook failed: ${built.stderr.slice(-3000)}`);
  const h = makeHome(claude, systemd);
  await startBus(h);
  const api = await startApi(h);
  const repo = makeRepo(h, api);
  await startManager(h, { NODE_EXTRA_CA_CERTS: api.caFile });
  const r = await run(NODE, [h.cli, 'setup'], { env: childEnv(h), cwd: h.tmp, timeoutMs: 300_000 });
  if (r.code !== 0 && r.code !== 4) throw Error(`BLOCKED: deep setup failed: ${shown(r)}`);
  if (!/deep-hook/.test(readFileSync(h.settings, 'utf8'))) throw Error(`BLOCKED: deep setup left no DeepBuild hook entry in ${h.settings}`);
  if ((await systemctl(h, 'is-active', UNIT)).stdout.trim() !== 'active') throw Error(`BLOCKED: deep setup left no hub running as the systemd user service ${UNIT}: ${shown(r)}`);
  await mainPid(h);
  await serviceStop(h);
  await core(h, 'seed', { root: h.root, repo: repo.dir, from: join(repo.dir, 'extensions', 'vendor-guard') });
  const pad = await core(h, 'pad', { root: h.root, events: PADDING }) as { from: number; to: number };
  await serviceStart(h);
  return {
    h, api, repo, pad, session: { id: '', transcript: '' }, clean: { emptied: false }, tests: [], commit: '', remoteBefore: '', remoteAfterUnreadable: '', remoteFinal: '',
    stack: {}, events: [], hits: [], evidenceHolds: false, timing: [], failedTimed: 0, deniedTimed: 0,
  };
}
const recent = (w: World) => eventsBetween(w.h, w.pad.to);
const asksNaming = (events: readonly Ev[], command: string) => events.filter((e) => e.kind === 'ask.created' && String(e.data?.question ?? '').includes(command));
const CLOSING = new Set(['ask.answered', 'ask.defaulted', 'ask.escalated', 'ask.cancelled', 'ask.superseded', 'ask.moot', 'decision.created', 'decision.applied']);
const closing = async (w: World, ask: string) => { await sleep(300); return (await recent(w)).filter((e) => CLOSING.has(e.kind) && (e.subject === ask || e.data?.ask === ask)); };

/** You, at your terminal: polkit's prompt cancelled, then confirmed for the push, then cancelled for the README's URL; a no last. */
async function answerAsks(w: LinuxWorld, timeoutMs: number): Promise<Polkit | undefined> {
  const { h } = w;
  const held = (command: string) => waitFor(async () => asksNaming(await recent(w), command)[0], timeoutMs);
  const [a, b] = [await held(PUSH), await held(MIRROR_PUSH)];
  if (!a || !b) return undefined;
  w.remoteAfterUnreadable ||= remoteMain(h, w.repo);
  const [A, B] = [`ask:${a.id}`, `ask:${b.id}`];
  const answer = (ask: string, option: string) => deep(h, ['inbox', 'answer', ask, option]);
  await polkit(h, false);
  const cancelled = await answer(A, 'approve');
  const afterCancelled = await closing(w, A);
  await polkit(h, true);
  const before = polkitChecks(h);
  const yes = await answer(A, 'approve');
  const checks = polkitChecks(h) - before;
  await polkit(h, false);
  const later = await answer(B, 'approve');
  const afterLater = await closing(w, B);
  await polkit(h, true);
  const no = await answer(B, 'decline');
  return { A, B, cancelled, afterCancelled, yes, checks, later, afterLater, no };
}
function getJson(port: number, path: string): Promise<Line | undefined> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path, timeout: 15_000 }, (res) => {
      let body = '';
      res.setEncoding('utf8').on('data', (d: string) => (body += d));
      res.on('end', () => { try { resolve(JSON.parse(body) as Line); } catch { resolve(undefined); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(undefined));
  });
}
async function readStack(w: World, up: Seen | undefined, call: Seen | undefined): Promise<Stack> {
  const file = join(w.repo.dir, '.app-port');
  const port = existsSync(file) ? Number(readFileSync(file, 'utf8')) : undefined;
  const stack: Stack = { ...(up ? { up } : {}), ...(port ? { port } : {}) };
  const env = port ? (await getJson(port, '/env'))?.env as Record<string, string> | undefined : undefined;
  if (env) stack.env = env;
  const line = call && jsonLines(call.output.replace(/\\n/g, '\n').replace(/\\"/g, '"')).find((l) => 'status' in l || 'error' in l);
  if (line) stack.call = line;
  return stack;
}
/** The unreadable pushes with the service's hub stopped by its PID; the service starts it again after. */
async function stoppedPushes(w: LinuxWorld, a: Agent): Promise<void> {
  const pid = await mainPid(w.h);
  if (!(pid > 0)) throw Error(`#1156 INCONCLUSIVE: ${UNIT} has no hub PID to stop`);
  await stopPids([pid]);
  const down = async () => { if (await hubAnswers(w.h)) throw Error(`#1156 INCONCLUSIVE: ${UNIT} started the hub again after PID ${pid} was stopped, so no call met a stopped hub`); };
  await down();
  w.computedDown = await a.bash(COMPUTED);
  w.nestedDown = await a.bash(NESTED);
  await down();
  await serviceStart(w.h);
}

/** The real session through the harness, on your sign-in, the hub the service's; you answer its asks while it runs. */
async function liveSession(w: LinuxWorld, token: string): Promise<void> {
  const { h, repo } = w;
  writeFileSync(join(repo.dir, 'SESSION.md'), sessionScript());
  writeFileSync(join(repo.dir, '.git', 'info', 'exclude'), 'SESSION.md\nclean.sh\n', { flag: 'a' });
  const script = join(h.tmp, 'prompt.txt');
  writeFileSync(script, `${PROMPT} Follow SESSION.md in this folder, step by step.`);
  w.remoteBefore = remoteMain(h, repo);
  const asked = answerAsks(w, 1_500_000);
  const ran = await run(NODE, [HARNESS, 'run', '--scenario', SCENARIO, '--workdir', repo.dir, '--script', script, '--pass-env', 'CLAUDE_CODE_OAUTH_TOKEN', '--claude', h.claude, '--timeout-ms', '1800000', '--cost-cap-usd', '5', '--out', join(h.tmp, 'out')], {
    env: childEnv(h, { SHELL: '/bin/bash', CLAUDE_CODE_OAUTH_TOKEN: token }), cwd: REPO, timeoutMs: 2_100_000,
  });
  const line = jsonLines(ran.stdout).find((l) => typeof l.run === 'string' && 'verdict' in l);
  if (!line) throw Error(`BLOCKED: #1156 the harness printed no run line for the ${SCENARIO} scenario: ${shown(ran)}`);
  if (line.verdict === 'BLOCKED') throw Error(`BLOCKED: #1156 the harness's run was BLOCKED: ${line.reason}`);
  if (line.verdict !== 'PASS') throw Error(`#1156 INCONCLUSIVE: the harness's run was ${line.verdict}: ${line.reason}`);
  const answers = await Promise.race([asked, sleep(1000).then(() => undefined)]);
  if (answers) w.polkit = answers;
  w.session = { id: String(line.sessionId), transcript: String(line.transcript) };
  const calls = transcriptCalls(w.session.transcript);
  const one = (command: string) => {
    const found = called(calls, command);
    if (!found.length) throw Error(`#1156 INCONCLUSIVE: the session never ran \`${command}\`; its calls: ${calls.map((c) => `${c.name} ${JSON.stringify(c.input.command ?? c.input.file_path ?? '')}`).join('; ')}`);
    return found;
  };
  [w.computed] = one(COMPUTED);
  [w.nestedUp] = one(NESTED);
  w.tests = one('npm test');
  [w.push] = one(PUSH);
  [w.mirror] = one(MIRROR_PUSH);
  w.retry = one(PUSH).find((c) => c.ran);
  [w.envUp] = one(ENV_UP);
  w.vendor = calls.find((c) => c.name === 'Edit' && String(c.input.file_path).endsWith(VENDOR));
  w.vendorBefore = readFileSync(join(FIXTURES, 'checkout-web', VENDOR), 'utf8');
  w.vendorAfter = readFileSync(join(repo.dir, VENDOR), 'utf8');
  w.commit = git(h, repo.dir, 'rev-parse', 'HEAD');
  w.stack = await readStack(w, w.envUp, one(API_CALL)[0]);
  const [seen] = one(CLEAN);
  const events = await recent(w);
  const staged = events.find((e) => e.kind === 'command.staged' && e.data?.call === seen!.id);
  const after = events.find((e) => e.kind === 'tool.after' && e.data?.call === seen!.id);
  w.clean = { seen: seen!, emptied: hashes(join(repo.dir, 'out')).size === 0, ...(staged && (!after || staged.log_pos < after.log_pos) ? { staged } : {}) };
  if (w.clean.staged) w.clean.undo = await deep(h, ['undo', `staged:${w.clean.staged.id}`]);
  w.clean.after = hashes(join(repo.dir, 'out'));
  // With the hub stopped no session can be asked: a made-up one on the same home sends the same two calls (../README).
  const a = await Agent.start(h, repo.dir, PROMPT);
  await stoppedPushes(w, a);
  await a.end();
}
const bytesOf = (path: string): Buffer | undefined => { try { const raw = readFileSync(path); return path.endsWith('.zst') ? zstdDecompressSync(raw) : raw; } catch { return undefined; } };
const evidence = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? evidence(p) : [p]; }) : []);
/** After the session: the stack down, the service restarted so its pass archives the transcript, every row read, then the card and trust timing with the hub stopped. */
async function readWorld(w: LinuxWorld): Promise<void> {
  const { h, repo } = w;
  await deep(h, ['env', 'down'], { cwd: repo.dir });
  await systemctl(h, 'restart', UNIT);
  await waitFor(() => hubAnswers(h), 30_000);
  await mainPid(h);
  await waitFor(async () => (await recent(w)).some((e) => e.kind === 'transcript.archived' && JSON.stringify(e.data).includes(w.session.id)), 60_000);
  w.events = await recent(w);
  w.remoteFinal = remoteMain(h, repo);
  const mirror = asksNaming(w.events, MIRROR_PUSH)[0];
  const plan = mirror && w.events.find((e) => e.kind === 'plan.proposed' && e.writer === 'core' && e.data?.ask === `ask:${mirror.id}`);
  const first = ((plan?.data.targets ?? []) as Line[]).find((t) => typeof t.first === 'string')?.first as string | undefined;
  if (first) w.cited = (await deep(h, ['read', first])).stdout;
  w.hits = await credentialHits(h, repo, w.pad);
  const stoodIn = [...(w.stack.env?.SHOP_API_KEY ?? '')].reverse().join('');
  w.evidenceHolds = stoodIn !== '' && evidence(join(h.root, 'evidence')).some((p) => bytesOf(p)?.includes(stoodIn));
  await serviceStop(h);
  if (mirror) w.card = await core(h, 'card', { root: h.root, ask: `ask:${mirror.id}` }).catch(() => undefined);
  const data = w.events.filter((e) => e.kind === 'tool.before' && e.session === w.session.id).map((e) => e.data);
  if (data.length) {
    const timed = await core(h, 'time', { root: h.root, repo: repo.dir, from: join(repo.dir, 'extensions', 'vendor-guard'), data, calls: 100, runs: 5 });
    w.timing = timed.runs as Line[];
    w.failedTimed = Number(timed.failed);
    w.deniedTimed = Number(timed.denied);
  }
}

// ---- AC4 on Linux (README: Readings). Every other criterion is read by ../helpers.ts's stepsOf.
/** An answer polkit didn't confirm: refused with exit 3, naming its ask, which stays open (#880's reading, the ask for the path). */
const refused = (who: string, r: Ran, handle: string, closed: readonly Ev[]): string[] => [
  ...(r.code === 3 ? [] : [`${who} must be refused, exit 3: ${shown(r)}`]),
  ...(`${r.stdout}\n${r.stderr}`.includes(handle) ? [] : [`${who} must be refused naming ${handle}: ${shown(r)}`]),
  ...(closed.length ? [`${who}: ${handle} must stay open: ${closed.map((e) => `${e.kind} ${e.id}`).join(', ')}`] : []),
];
/** AC4: your yes, once polkit confirmed you, runs the push once and origin's main is the session's commit. */
function yesProblems(w: LinuxWorld): string[] {
  const who = `${AC4} \`${PUSH}\``;
  const p = w.polkit;
  if (!p) return [`${who}: no ask was there to answer`];
  const answered = w.events.filter((e) => e.kind === 'ask.answered' && (e.subject === p.A || e.data?.ask === p.A));
  const ran = w.events.filter((e) => e.kind === 'tool.after' && e.data?.command === PUSH && e.data?.outcome !== 'failed');
  return [
    ...(p.yes.code === 0 ? [] : [`${who}: \`deep inbox answer ${p.A} approve\`, once polkit confirmed you, must count: ${shown(p.yes)}`]),
    ...(p.checks > 0 ? [] : [`${who}: the hub never asked polkit to confirm you for ${p.A}`]),
    ...(answered.length === 1 ? [] : [`${who}: ${p.A} must be answered once: the record holds ${answered.length}`]),
    ...(w.retry?.reply && !w.retry.reply.denied && w.retry.ran ? [] : [`${who}: the same call must run once you said yes: ${JSON.stringify(w.retry?.reply?.text ?? 'it was not seen').slice(0, 300)}`]),
    ...(ran.length === 1 ? [] : [`${who} must run once: the record holds ${ran.length} tool.after rows for it`]),
    ...(w.remoteFinal === w.commit ? [] : [`${who}: the remote's \`main\` must equal the session's commit ${w.commit}: it is ${w.remoteFinal}`]),
  ];
}
/** AC4's refusals: polkit's prompt cancelled; and a confirmation polkit gave for the earlier ask, not counted for the next. */
export function refusalProblems(w: LinuxWorld): string[] {
  const p = w.polkit;
  if (!p) return [`${AC4} no ask was there to answer`];
  return [
    ...refused(`${AC4} \`deep inbox answer ${p.A} approve\` with polkit's prompt cancelled`, p.cancelled, p.A, p.afterCancelled),
    ...refused(`${AC4} \`deep inbox answer ${p.B} approve\` after polkit confirmed you for ${p.A}, its prompt now cancelled`, p.later, p.B, p.afterLater),
  ];
}
/** ../helpers.ts's steps, with AC4's reading and its answered row the Linux ones. */
export function linuxSteps(w: LinuxWorld): Step[] {
  const answered = w.polkit && w.events.find((e) => e.kind === 'ask.answered' && (e.subject === w.polkit!.A || e.data?.ask === w.polkit!.A));
  return stepsOf(w).map((s) => (s.ac === AC4 ? { ...s, rows: [...s.rows, ...(answered ? [answered.id] : [])], problems: yesProblems(w) } : s));
}
/** The base's CLI that counts an answer on the peer check, on an ask raised on the session's record, polkit's prompt cancelled. */
export async function peerCheckProblems(w: LinuxWorld): Promise<string[]> {
  const { h } = w;
  await serviceStop(h);
  const plan = { steps: [{ does: `Run \`${PUSH}\``, changes: [PUSH], undo: 'Revert it with a new commit', public: true, cost: 0, targets: [{ kind: 'remote', ref: 'origin' }] }], diff: sha256(`${PUSH} ${COMMIT_MESSAGE}`) };
  const raised = await core(h, 'raise', { root: h.root, session: w.session.id, question: `Run \`${PUSH}\`?`, pinned_to: { kind: 'commit', ref: w.commit }, plan });
  const ask = String(raised.ask).startsWith('ask:') ? String(raised.ask) : `ask:${String(raised.ask)}`;
  const hub = await startHub(h, w.api, PEER_CHECK);
  try {
    await polkit(h, false);
    const r = await deep(h, ['inbox', 'answer', ask, 'approve']);
    return refused(`${AC4} \`deep inbox answer ${ask} approve\` with polkit's prompt cancelled`, r, ask, await closing(w, ask));
  } finally {
    await stopHub(hub);
  }
}

/** The issue's Proof, kept under PROOF_DIR, with polkit's log beside it. */
function writeProof(w: LinuxWorld, steps: readonly Step[], report: unknown): void {
  rmSync(PROOF_DIR, { recursive: true, force: true });
  mkdirSync(PROOF_DIR, { recursive: true });
  const kept = new Set(['tool.before', 'command.staged', 'ask.created', 'ask.answered', 'plan.proposed', 'decision.created', 'decision.applied', 'question.proceeded']);
  const put = (name: string, value: unknown) => writeFileSync(join(PROOF_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
  if (existsSync(w.session.transcript)) copyFileSync(w.session.transcript, join(PROOF_DIR, 'transcript.jsonl'));
  if (existsSync(w.h.polkitLog)) copyFileSync(w.h.polkitLog, join(PROOF_DIR, 'polkit.log'));
  put('hook-replies.json', steps.map((s) => ({ step: s.step, reply: s.reply })));
  put('record.json', w.events.filter((e) => kept.has(e.kind)));
  put('refs.json', { before: w.remoteBefore, afterUnreadable: w.remoteAfterUnreadable, final: w.remoteFinal, commit: w.commit });
  put('hashes.json', { before: [...w.repo.out], afterUndo: [...w.clean.after ?? []] });
  put('credential-search.json', { hits: w.hits, evidenceHolds: w.evidenceHolds });
  put('latencies.json', { vendorReplyMs: w.vendor?.reply?.ms ?? null, trust: w.timing });
  put('answers.json', w.polkit ?? null);
  put('report.json', report);
}
/** The whole checkpoint on Linux: the world, the real session, what it left, and the proof files. */
export async function checkpoint(token: string, claude: string): Promise<LinuxWorld> {
  const w = await makeWorld(claude);
  await liveSession(w, token);
  await readWorld(w);
  const steps = linuxSteps(w);
  writeProof(w, steps, reportOf(steps));
  return w;
}
