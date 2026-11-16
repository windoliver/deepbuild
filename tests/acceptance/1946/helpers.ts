// Test-side tools for the #1946 acceptance tests (README): a world of a real hub (`deep hub run`) in a temp home whose
// `~/.ssh/config` names one of this Mac's Lima VMs, as a throwaway user the harness makes there (sudo needs its
// password, lingering already on); the hub's socket as the cli role; `deep inbox answer`; `deep` run in a
// pseudo-terminal (BSD `script`) where you type the sudo password once its prompt shows; an agent's session played
// through the real deep-hook and its own `deep mcp` (fixtures/agent.mjs), for root plans; the host's checks, run by the
// real check kinds of packages/checks-host; the harness's own SSH link to the VM as Lima's user, which makes and removes
// the throwaway user and reads the host as root; and the judges a criterion's test and its planted program share.
// No hub or CLI module is imported: the hub, the CLI and deep mcp are driven as built (packages/cli/dist/main.js).
// Adapted from tests/acceptance/1945/helpers.ts (same repo, same license).
//
// Safety: every local folder is under /tmp/dh1946-* and removed after its file; HOME is a temp home for every hub,
// deep command, deep mcp and deep-hook, run without DEEP_*, XDG_*, CLAUDE*, CODEX*, billing keys or NODE_OPTIONS
// (SSH_AUTH_SOCK and PATH kept). The only network is 127.0.0.1 and the VMs through their forwarded ports, read from
// ~/.lima/<vm>/ssh.config at each run. On a VM this file changes only what it made: the user dh1946<id> (its home,
// sessions, user manager, lingering), its sudoers file /etc/sudoers.d/00-dh1946-<id> (checked with visudo -cf before
// it's moved in), any sudoers file made during the test that names that user, the folder /var/lib/dh1946-<id>, the
// root plans' folders made during the test whose script names the test, that user's journal file, and the test package
// dh1946-<id>-pkg; all of it is removed after the file. Lima's own control socket is never used, the VMs are never
// stopped, and Lima's user's lingering, sudo rights, groups and password are never touched. Every local process is one
// this file started, stopped by its PID. No password reaches an argument list or a file the suite keeps.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';
import type { CheckResult } from '../../../packages/conformance/src/index.ts';
import type { MachineSpec, Probe } from '../../../packages/checks-host/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const NODE = process.execPath;
const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
/** The host check kinds (#1943), reached only through their public entry, imported when a test first needs them. */
const hostChecks = (): Promise<typeof import('../../../packages/checks-host/src/index.ts')> => import('../../../packages/checks-host/src/index.ts');

/** Each criterion's ID: `#1946.` and the first 8 hex of SHA-256 of its checkbox text (scripts/proof-change.mjs). */
export const AC = {
  1: '#1946.a67b553d Remove it leaves the host passing the checks it passed before setup',
  2: '#1946.fa254d06 A sudo rule DeepBuild writes for a root plan names the script\'s sha256 digest, so with one byte of the allowed script changed sudo refuses it; the rule shows in the plan as a host change with its undo, and Remove it takes the rule out. A planted rule that names only the path runs the changed script and fails this test',
  3: '#1946.525c8ef7 Remove it, after a setup that enabled a user service as you and installed a package as root, disables the service as you with no root step and removes the package in one root plan; a planted Remove that runs every undo as root leaves the service enabled for your user and fails the host\'s checks, naming the service. An undo stopped after the first of its three steps records the step it undid and the two left',
  4: '#1946.b7aba9e2 After setup writes a user service unit, editing one line of it by hand and then running Remove it keeps the edited file, saves a backup and reports the undo partial, naming the unit; a Remove that writes the recorded version over the edit fails this test',
} as const;

/** The planted wrong programs the criteria name (README, Plants), each selected with DEEP_HUB_PLANT. */
export type Plant = 'sudo-rule-names-path' | 'remove-undoes-all-as-root' | 'remove-overwrites-edit';
export type Vm = 'deep-ubuntu' | 'deep-fedora';
/** The host's name in the world's SSH config. */
export const aliasOf = (vm: Vm): string => (vm === 'deep-ubuntu' ? 'dh-ubuntu' : 'dh-fedora');
/** Any 40-hex commit for runs started as you; a remote run names no commit of this Mac's. */
export const COMMIT = '1946000000000000000000000000000000000000';
/** What the core marks a plan's step with no undo, as it shows it (packages/asks). */
export const CANT_UNDO = "can't undo";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export const parse = (text: string): Line | undefined => { try { const v: unknown = JSON.parse(text); return typeof v === 'object' && v !== null ? (v as Line) : undefined; } catch { return undefined; } };
/** Single-quoted for a POSIX shell. */
export const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

// ---- Temp folders, local processes, and what the suite must never write down.
const made: string[] = [];
/** A fresh folder /tmp/dh1946-<id> (short: the hub's socket fails with EINVAL on a long path) and its id, 8 hex. */
export function tempDir(): { dir: string; id: string } {
  for (;;) {
    const id = randomBytes(4).toString('hex');
    const dir = `/tmp/dh1946-${id}`;
    try { mkdirSync(dir, { mode: 0o700 }); } catch { continue; }
    made.push(dir);
    return { dir: realpathSync(dir), id };
  }
}
const owned = new Set<number>();
export const own = (pid: number | undefined): void => { if (pid) owned.add(pid); };
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const close of closers.splice(0).reverse()) await close().catch(() => undefined);
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  // Twice: a process of a hub's that was still ending can write one more file into its home.
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  await sleep(3000);
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 600_000);
/** Every process under `root` now, each with its start time, from ps. */
function treeOf(root: number): Map<number, string> {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,lstart='], { env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8' }).split('\n')
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(.*?)\s*$/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), start: m[3]! }));
  const found = new Map<number, string>();
  for (let queue = [root]; queue.length;) {
    const parent = queue.shift()!;
    for (const r of rows) if (r.ppid === parent && !found.has(r.pid)) { found.set(r.pid, r.start); queue.push(r.pid); }
  }
  return found;
}
/** Each process of `tree` still running as the same process (its start time unchanged), stopped by its PID. */
function stopTree(tree: Map<number, string>): void {
  if (!tree.size) return;
  const now = new Map(execFileSync('ps', ['-axo', 'pid=,lstart='], { env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8' }).split('\n')
    .map((l) => /^\s*(\d+)\s+(.*?)\s*$/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => [Number(m[1]), m[2]!] as const));
  for (const [pid, start] of tree) if (now.get(pid) === start) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
}
/** Values never written down: each password, the VM's user name and the key paths. */
const hidden: { value: string; as: string }[] = [];
export const hide = (value: string, as: string): void => { if (value && !hidden.some((h) => h.value === value)) hidden.push({ value, as }); };
/** What the suite writes down instead of a password, the VM's user name or a key's path. */
export function redact(text: string): string {
  const home = homedir();
  const sorted = [...hidden].sort((a, b) => b.value.length - a.value.length);
  // Paths under this Mac's home first, then the home itself, then the rest (the VM's user may share the home's name).
  let out = text;
  for (const h of sorted) if (h.value.includes(home)) out = out.split(h.value).join(h.as);
  out = out.split(home).join('~');
  for (const h of sorted) if (!h.value.includes(home)) out = out.split(h.value).join(h.as);
  return out;
}

/** A child's environment: HOME the world's, none of this process's DEEP_/XDG_/CLAUDE/CODEX settings or billing keys. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GEMINI_|GOOGLE_API|GH_|GITHUB_|GIT_|AI_AGENT)/.test(key) || key === 'NODE_OPTIONS' || key === 'NODE_EXTRA_CA_CERTS') continue;
    env[key] = value;
  }
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C' });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}
export interface Ran { code: number | null; stdout: string; stderr: string; ms: number }
export const shown = (r: Ran) => `exit ${r.code} after ${r.ms.toFixed(0)} ms, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;
/** Runs a program to its end without blocking the event loop. */
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: o.cwd ?? '/tmp', env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? 120_000);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${error.message}`, ms: performance.now() - t0 }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, ms: performance.now() - t0 }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}

// ---- A VM's SSH settings, as Lima wrote them in ~/.lima/<vm>/ssh.config. Values are kept as written (quotes too).
interface LimaSsh { vm: Vm; port: number; user: string; identityFile: string; knownHosts: string; hostKeyAlias: string; ciphers: string | undefined }
const unquote = (v: string): string => v.replace(/^"(.*)"$/, '$1');
function limaSsh(vm: Vm): LimaSsh {
  const file = join(homedir(), '.lima', vm, 'ssh.config');
  if (!existsSync(file)) throw Error(`BLOCKED: the Lima VM ${vm} has no SSH config here (~/.lima/${vm}/ssh.config)`);
  const values = new Map<string, string>();
  let alias = '';
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*(\S+)\s+(.+?)\s*$/.exec(raw);
    if (!m || raw.trim().startsWith('#')) continue;
    if (m[1] === 'Host') alias = m[2]!;
    else if (!values.has(m[1]!)) values.set(m[1]!, m[2]!);
  }
  const need = (key: string): string => {
    const v = values.get(key);
    if (!v) throw Error(`BLOCKED: ~/.lima/${vm}/ssh.config names no ${key}`);
    return v;
  };
  const s = { vm, port: Number(need('Port')), user: unquote(need('User')), identityFile: unquote(need('IdentityFile')), knownHosts: unquote(need('UserKnownHostsFile')), hostKeyAlias: values.get('HostKeyAlias') ?? alias, ciphers: values.get('Ciphers') };
  hide(s.user, '<vm-user>');
  hide(s.identityFile, '<lima-key>');
  return s;
}
/** One Host block: Lima's way in (its host key and ciphers) at its forwarded port on 127.0.0.1, as `user` with `key`. */
function hostBlock(name: string, s: LimaSsh, knownHosts: string, user: string, key: string, extra: string[] = []): string {
  return [
    `Host ${name}`, '  HostName 127.0.0.1', `  Port ${s.port}`, `  User ${user}`, `  IdentityFile ${key}`, '  IdentitiesOnly yes',
    '  PreferredAuthentications publickey', '  StrictHostKeyChecking yes', `  UserKnownHostsFile ${knownHosts}`,
    `  HostKeyAlias ${s.hostKeyAlias}`, ...(s.ciphers ? [`  Ciphers ${s.ciphers}`] : []), '  Compression no', '  GSSAPIAuthentication no', ...extra, '',
  ].join('\n');
}

// ---- The harness's own link to a VM, as Lima's user: straight to its forwarded port, its own ControlPath.
export class HostSide {
  private constructor(readonly vm: Vm, readonly ssh: LimaSsh, private readonly config: string) {}
  /** Opens the harness link to `vm`; a VM it can't reach is BLOCKED. */
  static async open(vm: Vm, tmp: string): Promise<HostSide> {
    const s = limaSsh(vm);
    const dir = join(tmp, 's');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const known = join(dir, 'known');
    copyFileSync(s.knownHosts, known);
    const config = join(dir, 'harness');
    writeFileSync(config, hostBlock('dh1946h', s, known, s.user, s.identityFile, ['  BatchMode yes', '  ControlMaster no', `  ControlPath ${join(dir, 'c')}`, '  ServerAliveInterval 5', '  ServerAliveCountMax 6']), { mode: 0o600 });
    const master = spawn('ssh', ['-F', config, '-o', 'ControlMaster=yes', '-o', 'ControlPersist=no', '-N', 'dh1946h'], { stdio: ['ignore', 'ignore', 'pipe'] });
    own(master.pid);
    let err = '';
    master.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
    const h = new HostSide(vm, s, config);
    closers.push(async () => { try { master.kill('SIGTERM'); } catch { /* gone */ } });
    const deadline = Date.now() + 60_000;
    for (;;) {
      const check = await run('ssh', ['-F', config, '-O', 'check', 'dh1946h'], { timeoutMs: 10_000 });
      if (check.code === 0) break;
      if (master.exitCode !== null || Date.now() > deadline) throw Error(`BLOCKED: the VM ${vm} can't be reached over SSH at its forwarded port: ${redact(err.slice(-600))}`);
      await sleep(250);
    }
    return h;
  }
  /** One shell command on the host as Lima's user, through the harness link. */
  sh(command: string, o: { input?: string; timeoutMs?: number } = {}): Promise<Ran> {
    return run('ssh', ['-F', this.config, 'dh1946h', command], { ...(o.input !== undefined ? { input: o.input } : {}), timeoutMs: o.timeoutMs ?? 120_000 });
  }
  /** A script run as root (sudo sh -s), sent on the session's stdin, so nothing in it reaches an argument list or a log. */
  root(script: string, timeoutMs = 300_000): Promise<Ran> { return this.sh('sudo -n sh -s', { input: script, timeoutMs }); }
  async mustRoot(script: string, what: string, timeoutMs = 300_000): Promise<string> {
    const r = await this.root(script, timeoutMs);
    if (r.code !== 0) throw Error(`BLOCKED: on ${this.vm}, ${what} failed: ${redact(shown(r))}`);
    return r.stdout;
  }
}

// ---- The throwaway user (README, The worlds): sudo needs its password, lingering on, gone after the file.
export interface TestUser { name: string; uid: number; group: string; home: string; key: string; password: string; marks: string }
function setupScript(id: string, name: string, pub: string, password: string): string {
  const M = `/var/lib/dh1946-${id}`;
  return [
    'set -eu',
    `U=${name}; M=${M}`,
    'getent passwd "$U" >/dev/null && { echo "the user $U exists already" >&2; exit 3; }',
    // The harness's root-only folder, first, so the cleanup's stamp and journal list exist whatever fails after it.
    'install -d -m 700 -o root -g root "$M"',
    'touch "$M/stamp"',
    // No subordinate IDs (/etc/subuid and /etc/subgid stay as they are).
    `useradd -m -s /bin/sh -K SUB_UID_COUNT=0 -K SUB_GID_COUNT=0 -c 'dh1946 test user, removed after its test' "$U"`,
    'uid=$(id -u "$U"); G=$(id -gn "$U"); H=$(getent passwd "$U" | cut -d: -f6)',
    'ls /var/log/journal/*/user-"$uid".journal /var/log/journal/*/user-"$uid"@*.journal 2>/dev/null > "$M/journals-before" || true',
    // The password goes to chpasswd on a pipe from printf, a shell builtin: it's in no argument list and no file.
    `printf '%s:%s\\n' "$U" ${q(password)} | chpasswd`,
    'install -d -m 700 -o "$U" -g "$G" "$H/.ssh"',
    `printf '%s\\n' ${q(pub)} > "$H/.ssh/authorized_keys"`,
    'chown "$U:$G" "$H/.ssh/authorized_keys"; chmod 600 "$H/.ssh/authorized_keys"',
    'if command -v restorecon >/dev/null; then restorecon -R "$H/.ssh"; fi',
    // sudo for everything, with the user's password, in a file that sorts before any other there, so a rule a later
    // file holds for the user (DeepBuild's) is the one sudo matches last; checked with visudo before it's moved in.
    't=$(mktemp); printf \'%s ALL=(ALL:ALL) ALL\\n\' "$U" > "$t"; visudo -cf "$t" >/dev/null; install -m 440 -o root -g root "$t" "/etc/sudoers.d/00-dh1946-' + id + '"; rm -f "$t"',
    // Lingering on, as on a host that has run DeepBuild's runs before: no host change for it is recorded here.
    'loginctl enable-linger "$U"',
    // Its home traversable and the test's folder readable, so the harness reads the runs' files without sudo.
    'chmod 711 "$H"',
    `install -d -m 755 -o "$U" -g "$G" "$H/dh1946-${id}"`,
    'i=0; while [ ! -d "/run/user/$uid" ] && [ $i -lt 30 ]; do sleep 1; i=$((i + 1)); done',
    'printf \'ready %s %s %s\\n\' "$uid" "$G" "$H"',
  ].join('\n');
}
function cleanupScript(id: string, name: string): string {
  return [
    `U=${name}; M=/var/lib/dh1946-${id}; P=dh1946-${id}-pkg`,
    // Sudoers files made during the test that name the test user (DeepBuild's rules among them), and the harness's own.
    'if [ -f "$M/stamp" ]; then for f in /etc/sudoers.d/*; do [ -f "$f" ] && [ "$f" -nt "$M/stamp" ] && grep -q "$U" "$f" && rm -f -- "$f"; done; fi',
    `rm -f "/etc/sudoers.d/00-dh1946-${id}"`,
    'if uid=$(id -u "$U" 2>/dev/null); then',
    '  loginctl disable-linger "$U" 2>/dev/null',
    '  loginctl terminate-user "$U" 2>/dev/null',
    '  systemctl stop "user@$uid.service" 2>/dev/null',
    '  i=0; while [ -n "$(ps -o pid= -u "$uid")" ] && [ $i -lt 30 ]; do sleep 1; i=$((i + 1)); done',
    // Last, by PID: what is still running as the test's own user.
    '  p=$(ps -o pid= -u "$uid"); [ -n "$p" ] && kill -KILL $p 2>/dev/null; sleep 1',
    '  userdel -r "$U" 2>/dev/null || userdel -r -f "$U" 2>/dev/null',
    '  [ -s "$M/journals-before" ] || rm -f /var/log/journal/*/user-"$uid".journal /var/log/journal/*/user-"$uid"@*.journal',
    'fi',
    // The root plans' folders made during the test whose script names the test (its user, folder or package).
    'if [ -f "$M/stamp" ] && [ -d /var/lib/deepbuild/plans ]; then',
    '  for d in /var/lib/deepbuild/plans/*/; do [ -d "$d" ] && [ "$d" -nt "$M/stamp" ] && grep -rqs -e "dh1946-' + id + '" -e "$U" "$d" && rm -rf -- "$d"; done',
    '  for d in /var/lib/deepbuild/plans /var/lib/deepbuild; do [ "$d" -nt "$M/stamp" ] && rmdir -- "$d" 2>/dev/null; done',
    'fi',
    'if command -v dpkg >/dev/null && dpkg -s "$P" >/dev/null 2>&1; then dpkg --purge "$P" >/dev/null 2>&1; fi',
    'rm -rf "$M"',
    'echo cleaned',
  ].join('\n');
}
/** Makes the throwaway user on the VM through the harness link; its cleanup is registered before anything is made. */
async function makeUser(h: HostSide, id: string, tmp: string): Promise<TestUser> {
  const name = `dh1946${id}`;
  const keyDir = join(tmp, 'k');
  mkdirSync(keyDir, { mode: 0o700 });
  const key = join(keyDir, 'id');
  const kg = await run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', `dh1946-${id}`, '-f', key]);
  if (kg.code !== 0) throw Error(`BLOCKED: ssh-keygen failed: ${shown(kg)}`);
  hide(key, '<test-key>');
  const password = randomBytes(18).toString('base64url');
  hide(password, '<password>');
  closers.push(async () => {
    const r = await h.root(cleanupScript(id, name), 300_000);
    if (!r.stdout.includes('cleaned')) process.stderr.write(`#1946 harness: removing ${name} from ${h.vm} didn't finish: ${redact(shown(r))}\n`);
  });
  const out = await h.mustRoot(setupScript(id, name, readFileSync(`${key}.pub`, 'utf8').trim(), password), `making the test user ${name}`);
  const m = /ready (\d+) (\S+) (\S+)/.exec(out);
  if (!m) throw Error(`BLOCKED: making the test user ${name} on ${h.vm} said ${JSON.stringify(redact(out))}`);
  return { name, uid: Number(m[1]), group: m[2]!, home: m[3]!, key, password, marks: `/var/lib/dh1946-${id}` };
}

// ---- The hub.
export interface Hub { pid: number; socket: string; root: string; child: ChildProcess; output: string[] }
async function startHub(home: string, env: Record<string, string | undefined>): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  const output: string[] = [];
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => output.push(d));
  const ready = await new Promise<Line | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 180_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      output.push(d);
      out += d;
      if (out.includes('\n')) { clearTimeout(timer); resolve(parse(out.split('\n')[0]!)); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(undefined); });
  });
  const hub: Hub = { pid: child.pid!, socket: typeof ready?.socket === 'string' ? ready.socket : join(home, '.deepbuild', 'hub.sock'), root: join(home, '.deepbuild'), child, output };
  closers.push(async () => {
    // The hub's own children are gathered while it stops, and any still running once it has gone are stopped by PID.
    const tree = treeOf(hub.pid);
    try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
    const deadline = Date.now() + 20_000;
    while (alive(hub.pid) && Date.now() < deadline) { for (const [pid, start] of treeOf(hub.pid)) tree.set(pid, start); await sleep(100); }
    if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
    stopTree(tree);
  });
  if (ready?.ready !== true) throw Error(`BLOCKED: the hub didn't start (deep hub run${env.DEEP_HUB_PLANT ? ` with DEEP_HUB_PLANT=${env.DEEP_HUB_PLANT}` : ''}): ${redact(output.join('').slice(-2000))}`);
  return hub;
}

// ---- The world.
export interface World {
  id: string; tmp: string; home: string; vm: Vm; alias: string; hub: Hub; host: HostSide; user: TestUser;
  /** The test's folder on the host, in the test user's home. */
  folder: string;
  /** The world's SSH config, the one the hub and `deep` read and the host link the check kinds are handed. */
  config: string;
  /** The plant this world's hub and every `deep` command it runs are given (README, reading 11). */
  plant: Plant | undefined;
  /** An agent's session, for the root plans an agent proposes. */
  session: Session | undefined;
  /** Asks this suite answered yes to, as you (README, reading 10). */
  answered: Line[];
  confirm: string;
}
export async function openWorld(vm: Vm, o: { plant?: Plant; agent?: boolean } = {}): Promise<World> {
  if (!existsSync(CLI)) throw Error(`BLOCKED: the deep CLI (npm run build --workspaces) is missing at ${CLI}`);
  const { dir: tmp, id } = tempDir();
  const home = join(tmp, 'h');
  mkdirSync(join(home, '.ssh'), { recursive: true, mode: 0o700 });
  mkdirSync(join(home, '.deepbuild'), { recursive: true, mode: 0o700 });
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const host = await HostSide.open(vm, tmp);
  const user = await makeUser(host, id, tmp);
  const alias = aliasOf(vm);
  const known = join(home, '.ssh', 'known_hosts_lima');
  copyFileSync(host.ssh.knownHosts, known);
  const config = join(home, '.ssh', 'config');
  writeFileSync(config, hostBlock(alias, host.ssh, known, user.name, user.key), { mode: 0o600 });
  const hub = await startHub(home, { DEEP_HUB_TEST_CONFIRM: confirm, MCP_TOOL_TIMEOUT: '30000', ...(o.plant ? { DEEP_HUB_PLANT: o.plant } : {}) });
  const w: World = { id, tmp, home, vm, alias, hub, host, user, folder: `${user.home}/dh1946-${id}`, config, plant: o.plant, session: undefined, answered: [], confirm };
  if (o.agent) {
    w.session = new Session(w, join(tmp, 'work'));
    await w.session.start();
  }
  approveChangesAsYou(w);
  return w;
}

/** One call on the hub's socket as the cli role, with the control token and this process for the peer check: the reply line. */
export async function control(w: World, method: string, params: Line, timeoutMs = 120_000): Promise<Line> {
  const token = readFileSync(join(w.hub.root, 'control.token'), 'utf8').trim();
  const start = execFileSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], { env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8' }).trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(w.hub.socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`BLOCKED: the hub gave no answer to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); reject(error); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = parse(buffer.slice(0, i)) ?? {};
        buffer = buffer.slice(i + 1);
        if (step === 0) { step = 1; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token, peer: { pid: process.pid, start } })}\n`); }
        else if (step === 1) { step = 2; sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`); }
        else if (line.id === 1) { clearTimeout(timer); sock.destroy(); resolve(line); }
      }
    });
  });
}
/** A cli call that must succeed: its result. */
export async function must(w: World, method: string, params: Line, timeoutMs = 120_000): Promise<Line> {
  const reply = await control(w, method, params, timeoutMs);
  if (reply.error) throw Error(`${method} ${redact(JSON.stringify(params).slice(0, 300))} was refused: ${redact(JSON.stringify(reply.error).slice(0, 1500))}`);
  return reply.result as Line;
}
/** The hub's record after log position `after`, through events.read on the cli role. */
export async function events(w: World, after = 0): Promise<Line[]> {
  const all: Line[] = [];
  for (let from = after; ;) {
    const read = (await must(w, 'events.read', { after: from, limit: 1000 })).events as Line[] | string;
    const page = (typeof read === 'string' ? JSON.parse(read) : read) as Line[];
    all.push(...page.map((e) => ({ ...e, data: typeof e.data === 'string' ? parse(e.data) ?? {} : e.data ?? {} })));
    if (page.length < 1000) return all;
    from = page[page.length - 1]!.log_pos;
  }
}
export const lastPos = async (w: World): Promise<number> => Math.max(0, ...(await events(w)).map((e) => Number(e.log_pos)));
/** Waits until `pick` finds something in the record; undefined at the deadline. */
export async function awaitEvent(w: World, pick: (all: Line[]) => Line | undefined, timeoutMs: number): Promise<Line | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = pick(await events(w));
    if (found || Date.now() > deadline) return found;
    await sleep(1000);
  }
}
/** `deep <args>` as you, in the world's home, with the world's plant. */
export function deep(w: World, args: readonly string[], timeoutMs = 180_000): Promise<Ran> {
  return run(NODE, [CLI, ...args], { env: childEnv(w.home, { DEEP_HUB_TEST_CONFIRM: w.confirm, ...(w.plant ? { DEEP_HUB_PLANT: w.plant } : {}) }), cwd: w.tmp, timeoutMs });
}

// ---- Asks and their plans, as the record holds them.
export const askCreated = (all: Line[], ask: string): Line | undefined => all.find((e) => e.kind === 'ask.created' && `ask:${String(e.id)}` === ask);
/** The core's plan for an ask (plan.proposed, written by the core), the newest. */
export const planOf = (all: Line[], ask: string): Line | undefined => all.filter((e) => e.kind === 'plan.proposed' && e.writer === 'core' && e.data.ask === ask).at(-1);
export const answerOf = (all: Line[], ask: string): Line | undefined => all.find((e) => e.kind === 'ask.answered' && (e.subject === ask || e.data.ask === ask));
/** The option of an ask whose decision is allow. */
const allowOf = (created: Line | undefined): string | undefined => (created?.data.options as Line[] | undefined)?.find((x) => x.decision === 'allow')?.id;
/** Your yes to an ask, from your terminal: `deep inbox answer <ask> <its allow option>`; what went wrong, or undefined. */
export async function answerYes(w: World, ask: string): Promise<string | undefined> {
  const created = askCreated(await events(w), ask);
  const option = allowOf(created);
  if (!option) return `${ask} offers no option whose decision is allow: ${redact(JSON.stringify(created?.data ?? null).slice(0, 600))}`;
  const r = await deep(w, ['inbox', 'answer', ask, option]);
  return r.code === 0 ? undefined : `deep inbox answer ${ask} ${option} didn't answer it: ${redact(shown(r))}`;
}
/** Whether an ask is a root plan: its question names root (as every root plan's does, "Run this root plan on … as root?"). */
const isRootAsk = (created: Line): boolean => /\broot\b/i.test(String(created.data.question ?? ''));
/**
 * You, in your inbox (README, reading 10): each ask that names the host, offers an allow option and isn't a root plan
 * (the grant for changes as you) is answered yes with `deep inbox answer`, once, two seconds after it shows. Root plans
 * are the tests' to answer.
 */
function approveChangesAsYou(w: World): void {
  let busy = false;
  const seen = new Map<string, number>();
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void (async () => {
      const all = await events(w);
      for (const e of all) if (e.kind === 'ask.created' && !seen.has(`ask:${String(e.id)}`)) seen.set(`ask:${String(e.id)}`, Date.now());
      for (const [ask, at] of seen) {
        if (at === 0 || Date.now() - at < 2000) continue;
        seen.set(ask, 0);
        const created = askCreated(all, ask);
        const option = allowOf(created);
        if (!created || !option || isRootAsk(created) || !JSON.stringify(created.data).includes(w.alias) || answerOf(all, ask)) continue;
        const r = await deep(w, ['inbox', 'answer', ask, option]);
        w.answered.push({ ask, question: String(created.data.question ?? '').slice(0, 200), option, code: r.code });
      }
    })().catch(() => undefined).finally(() => { busy = false; });
  }, 1000);
  closers.push(async () => clearInterval(timer));
}

// ---- The host, as you (the world's own SSH config) and as root (the harness link).
/** One shell command on the host as the test user, through the world's SSH config: your own login there. */
export function asYou(w: World, command: string, input?: string): Promise<Ran> {
  return run('ssh', ['-F', w.config, '-o', 'BatchMode=yes', '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '--', w.alias, command], { ...(input !== undefined ? { input } : {}), timeoutMs: 180_000 });
}
export async function mustAsYou(w: World, command: string, input?: string): Promise<string> {
  const r = await asYou(w, command, input);
  if (r.code !== 0) throw Error(`BLOCKED: as the test user on ${w.vm}, \`${redact(command.slice(0, 200))}\` failed: ${redact(shown(r))}`);
  return r.stdout;
}
/** A file's SHA-256 on the host, read as root; '' when there's none. */
export async function shaOnHost(w: World, path: string): Promise<string> {
  const r = await w.host.root(`[ -f ${q(path)} ] && sha256sum < ${q(path)} | cut -d' ' -f1`);
  return r.stdout.trim();
}
/** A file's text on the host, read as root; undefined when there's none. */
export async function readAsRoot(w: World, path: string): Promise<string | undefined> {
  const r = await w.host.root(`[ -f ${q(path)} ] && cat -- ${q(path)}`);
  return r.code === 0 ? r.stdout : undefined;
}
/** A user unit's state for the test user: what is-enabled and is-active say. */
export async function unitState(w: World, unit: string): Promise<{ enabled: string; active: string }> {
  const r = await asYou(w, `systemctl --user is-enabled ${q(unit)} 2>&1 | head -n 1; systemctl --user is-active ${q(unit)} 2>&1 | head -n 1`);
  const [enabled = '', active = ''] = r.stdout.split('\n').map((l) => l.trim());
  return { enabled, active };
}
/** Whether something listens at 127.0.0.1:<port> on the host. */
export async function listensAt(w: World, port: number): Promise<boolean> {
  return (await w.host.sh(`ss -Hltn | awk '{print $4}' | grep -qx '127.0.0.1:${port}'`)).code === 0;
}

// ---- Remote runs started as you (#1942's run.start with a host), each with the changes it makes (README, reading 2).
export interface Change { does: string; changes: string[]; undo: string | null }
export const someClaim = (): string => `claim:dh1946${randomBytes(8).toString('hex')}`;
/** A remote run as you that makes `changes`: started, then waited for to its end (run.finished). What went wrong, or undefined. */
export async function setupAsYou(w: World, script: string, changes: Change[]): Promise<{ run?: string; failed?: string }> {
  const reply = await control(w, 'run.start', { check: 'setup-as-you', claim: someClaim(), commit: COMMIT, argv: ['/bin/sh', '-c', script], cwd: w.folder, host: w.alias, changes }, 600_000);
  if (reply.error) return { failed: `the setup's remote run on ${w.alias} was refused: ${redact(JSON.stringify(reply.error).slice(0, 1200))}` };
  const runId = reply.result?.run;
  if (typeof runId !== 'string') return { failed: `run.start answered no run: ${JSON.stringify(reply.result).slice(0, 400)}` };
  const ended = await awaitEvent(w, (all) => all.find((e) => e.kind === 'run.finished' && e.data.run === runId), 300_000);
  if (!ended) return { run: runId, failed: `BLOCKED: the setup's remote run ${runId} on ${w.alias} didn't end in 5 minutes` };
  if (ended.data.outcome !== 'passed') return { run: runId, failed: `BLOCKED: the setup's remote run ${runId} on ${w.alias} ended ${String(ended.data.outcome)} (exit ${String(ended.data.exit)})` };
  return { run: runId };
}
/** The record's host changes on the host (host.changed), with `grant` when given. */
export const hostChanges = (all: Line[], alias: string, grant?: 'you' | 'root'): Line[] => all.filter((e) => e.kind === 'host.changed' && e.data.host === alias && (!grant || e.data.grant === grant));
/** The change of `all` whose text holds `marker` (its `change`, `changes` or undo), the newest. */
export const changeNaming = (all: Line[], alias: string, marker: string, grant?: 'you' | 'root'): Line | undefined => hostChanges(all, alias, grant).filter((e) => JSON.stringify(e.data).includes(marker)).at(-1);

// ---- One Claude Code session (fixtures/agent.mjs), played through the real deep-hook and its own deep mcp.
export class Session {
  readonly id = randomUUID();
  readonly transcript: string;
  private n = 0;
  private buffer = '';
  private readonly pending = new Map<number, (r: Line) => void>();
  private rpc = 0;
  private mcpReady = false;
  readonly child: ChildProcess;
  constructor(readonly w: World, readonly cwd: string) {
    if (!existsSync(DEEP_HOOK)) throw Error(`BLOCKED: deep-hook (cargo build -p deep-hook) is missing at ${DEEP_HOOK}`);
    mkdirSync(cwd, { recursive: true });
    this.transcript = join(w.home, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    writeFileSync(this.transcript, '');
    this.child = spawn(NODE, [AGENT, DEEP_HOOK, CLI], { cwd: w.tmp, env: childEnv(w.home, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: cwd }), stdio: ['pipe', 'pipe', 'ignore'] });
    own(this.child.pid);
    this.child.stdin!.on('error', () => undefined);
    this.child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const line = parse(this.buffer.slice(0, i));
        this.buffer = this.buffer.slice(i + 1);
        if (line && typeof line.n === 'number') { this.pending.get(line.n)?.(line); this.pending.delete(line.n); }
      }
    });
    this.child.on('exit', () => { for (const [n, done] of [...this.pending]) { this.pending.delete(n); done({ n, failed: 'the session\'s agent process exited' }); } });
    closers.push(async () => { try { this.child.kill('SIGTERM'); } catch { /* gone */ } });
  }
  private send(command: Line): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve) => { this.pending.set(n, resolve); this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`); });
  }
  async hook(event: string, fields: Line = {}): Promise<Line> {
    const body = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', ...fields };
    const r = await this.send({ op: 'hook', args: ['claude-code', event], cwd: this.cwd, input: JSON.stringify(body), timeoutMs: 180_000 });
    if (r.code !== 0) throw Error(`BLOCKED: the ${event} hook (deep-hook) ended ${r.code}: ${String(r.stdout).slice(0, 400)} ${String(r.stderr).slice(0, 400)}`);
    return r;
  }
  start(): Promise<Line> { return this.hook('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' }); }
  private async mcp(method: string, params: Line, notify = false): Promise<Line> {
    const line = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: `${method}#${++this.rpc}`, method, params };
    const r = await this.send({ op: 'mcp', line, timeoutMs: 300_000 });
    if (r.failed) throw Error(`BLOCKED: deep mcp: ${String(r.failed).slice(0, 600)}`);
    own(Number(r.pid));
    return (r.reply ?? {}) as Line;
  }
  /** One deep_* tool call through this session's deep mcp: its result's value (structuredContent or its text's JSON). */
  async tool(name: string, args: Line): Promise<{ isError: boolean; value: Line; text: string }> {
    if (!this.mcpReady) {
      const init = await this.mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-1946', version: '0' } });
      if (!init.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(init).slice(0, 600)}`);
      await this.mcp('notifications/initialized', {}, true);
      this.mcpReady = true;
    }
    // A reply that the hub was unreachable and nothing was recorded is called again, as it says to.
    for (let attempt = 1; ; attempt++) {
      const reply = await this.mcp('tools/call', { name, arguments: args });
      if (reply.error) return { isError: true, value: reply.error as Line, text: JSON.stringify(reply.error) };
      const result = (reply.result ?? {}) as Line;
      const text = Array.isArray(result.content) ? String(result.content.find((c: Line) => c?.type === 'text')?.text ?? '') : '';
      const value = (result.structuredContent ?? parse(text) ?? {}) as Line;
      if (result.isError === true && value.code === 'unavailable' && value.retryable === true && attempt < 10) { await sleep(2000); continue; }
      return { isError: result.isError === true, value, text: text || JSON.stringify(result) };
    }
  }
}

// ---- `deep` in your own terminal: a pseudo-terminal (BSD script), the password typed only once sudo's prompt shows.
// script needs a real pipe on its stdin (Node gives a child a socket, whose tcgetattr fails), so bash execs it with its
// stdin from `cat`, through a process substitution; script passes the command's exit code back.
export interface Terminal { code: number | null; transcript: string; prompts: number; typed: number; timedOut: boolean }
const PROMPT = /pass(word|phrase)[^\n]*:[ \t]*$/i;
// eslint-disable-next-line no-control-regex
const plain = (text: string): string => text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');
export function inTerminal(w: World, args: readonly string[], timeoutMs = 300_000): Promise<Terminal> {
  return new Promise((resolve) => {
    const env = childEnv(w.home, { DEEP_HUB_TEST_CONFIRM: w.confirm, TERM: process.env.TERM && process.env.TERM !== 'dumb' ? process.env.TERM : 'xterm', ...(w.plant ? { DEEP_HUB_PLANT: w.plant } : {}) });
    const child = spawn('/bin/bash', ['-c', 'exec /usr/bin/script -q /dev/null "$@" < <(exec cat 2>/dev/null)', 'bash', NODE, CLI, ...args], { cwd: w.tmp, env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let raw = '';
    let from = 0;
    let prompts = 0;
    let typed = 0;
    let timedOut = false;
    const look = () => {
      const fresh = plain(raw.slice(from));
      if (!PROMPT.test(fresh)) return;
      prompts++;
      from = raw.length;
      // Typed at the prompt, at most twice (a second prompt means the first was refused).
      if (typed < 2) { typed++; child.stdin!.write(`${w.user.password}\n`); }
    };
    child.stdout!.setEncoding('utf8').on('data', (d: string) => { raw += d; look(); });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { raw += d; look(); });
    child.stdin!.on('error', () => undefined);
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000).unref(); }, timeoutMs);
    child.on('exit', () => child.stdin!.end());
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, transcript: plain(raw), prompts, typed, timedOut }); });
  });
}
const said = (t: Terminal): Line => ({ code: t.code, prompts: t.prompts, typed: t.typed, timed_out: t.timedOut, said: redact(t.transcript.slice(-2500)) });

// ---- Root plans (README, reading 3).
export interface Step { does: string; changes: string[]; undo: string | null; package: string | null }
/** The agent proposes a root plan: deep_root_plan through its own deep mcp. The ask's handle, or what the hub said instead. */
export async function proposeRootPlan(w: World, script: string, steps: Step[], sudoRule?: boolean): Promise<{ ask?: string; said: string }> {
  const r = await w.session!.tool('deep_root_plan', { host: w.alias, script, steps, ...(sudoRule === undefined ? {} : { sudo_rule: sudoRule }) });
  const text = redact(r.text.slice(0, 1500));
  if (r.isError) return { said: `deep_root_plan was refused: ${text}` };
  const ask = r.value.ask;
  return typeof ask === 'string' && /^ask:[0-9A-Za-z]+$/.test(ask) ? { ask, said: text } : { said: `deep_root_plan answered no ask: ${text}` };
}
/** Your yes to a root plan, then `deep host run <ask>` in a terminal with your sudo password typed at its prompt. */
export async function approveAndRun(w: World, ask: string): Promise<{ failed?: string; terminal?: Terminal }> {
  await awaitEvent(w, (all) => planOf(all, ask), 60_000);
  const no = await answerYes(w, ask);
  if (no) return { failed: no };
  return { terminal: await inTerminal(w, ['host', 'run', ask]) };
}
/**
 * A root plan's script: it notes as root, in the harness's root-only folder, which variant ran and as whom, then prints
 * one line and exits 0. `V=<letter>` is the one byte a test changes.
 */
export function planScript(marksDir: string, nonce: string, letter: string): string {
  return [
    '#!/bin/sh',
    `# A #1946 acceptance test's root plan: it notes which variant ran and as whom in ${marksDir}/ran, then says one line.`,
    `V=${letter}`,
    `printf 'dh1946 %s variant %s uid %s\\n' ${nonce} "$V" "$(id -u)" >> ${marksDir}/ran 2>/dev/null || echo "dh1946 ${nonce} could not write ${marksDir}/ran" >&2`,
    `printf 'dh1946 %s %s uid %s\\n' ${nonce} "$V" "$(id -u)"`,
    'exit 0',
    '',
  ].join('\n');
}
/** The variant lines root plans of one nonce wrote to the harness's root-only folder. */
export async function marks(w: World, nonce: string): Promise<string[]> {
  return ((await readAsRoot(w, `${w.user.marks}/ran`)) ?? '').split('\n').filter((l) => l.startsWith(`dh1946 ${nonce} variant `));
}

// ---- Remove it (README, readings 4 to 7).
export interface Removal {
  /** Log position just before `deep host remove` ran. */
  from: number;
  command: Ran;
  /** The root plans Remove it raised for the host, in order, each with its plan and how running it went. */
  roots: { ask: string; question: string; plan: Line | undefined; failed?: string; terminal?: Terminal }[];
  /** The record's host.undone events for the host from `from` on, read once everything ran. */
  undone: Line[];
}
/** The root plans asked after `from` that name the host: asks whose question names root and whose ask or plan names it. */
const rootAsksAfter = (all: Line[], from: number, alias: string): Line[] => all.filter((e) => e.kind === 'ask.created' && Number(e.log_pos) > from && isRootAsk(e)
  && `${JSON.stringify(e.data)} ${JSON.stringify(planOf(all, `ask:${String(e.id)}`)?.data ?? {})}`.includes(alias));
/**
 * `deep host remove <host>`, then each root plan it raised for the host approved and run with `deep host run` and your
 * sudo password, then the record's host.undone events for the host once they've settled.
 */
export async function removeIt(w: World): Promise<Removal> {
  const from = await lastPos(w);
  const command = await deep(w, ['host', 'remove', w.alias], 600_000);
  // The root plans: waited for up to a minute, and 5 s past the first.
  let asks: Line[] = [];
  for (let first = 0, deadline = Date.now() + 60_000; Date.now() < deadline && (!first || Date.now() < first + 5000); await sleep(1000)) {
    asks = rootAsksAfter(await events(w), from, w.alias);
    if (asks.length && !first) first = Date.now();
  }
  const roots: Removal['roots'] = [];
  for (const created of asks) {
    const ask = `ask:${String(created.id)}`;
    const ran = await approveAndRun(w, ask);
    roots.push({ ask, question: String(created.data.question ?? ''), plan: planOf(await events(w), ask)?.data, ...ran });
  }
  // The undos' records: as you at once, as root once its plan ran; settled when nothing new came for 5 s (2 minutes at most).
  let undone: Line[] = [];
  for (let quiet = 0, deadline = Date.now() + 120_000; Date.now() < deadline; await sleep(1000)) {
    const now = (await events(w, from)).filter((e) => e.kind === 'host.undone' && e.data.host === w.alias);
    quiet = now.length === undone.length ? quiet + 1 : 0;
    undone = now;
    const roots_done = !roots.length || undone.some((e) => e.data.grant === 'root');
    if (undone.length && roots_done && quiet >= 5) break;
  }
  return { from, command, roots, undone };
}
export const removalSeen = (r: Removal): Line => ({
  command: { code: r.command.code, out: redact(`${r.command.stdout}${r.command.stderr}`.slice(-3000)) },
  roots: r.roots.map((x) => ({ ask: x.ask, question: x.question, plan: x.plan, failed: x.failed, terminal: x.terminal ? said(x.terminal) : undefined })),
  undone: r.undone.map((e) => e.data),
});
const removeSaid = (r: Removal): string => JSON.stringify(redact(`exit ${r.command.code}: ${r.command.stdout}${r.command.stderr}`.slice(-1200)));
/** Whether an undo record's list (undone or left) holds the change: an entry whose `change` is the change's text. */
const lists = (list: unknown, change: Line): boolean => Array.isArray(list) && list.some((x: Line) => x?.change === change.data.change);

// ---- The host's checks (README, reading 8): the machine kind's draft after a probe, run with the real kind.
/** The disk the work may take, in the drafted margin. */
const MARGIN = 1 << 30;
/** What done means for the host before setup: draftMachine after a probe (host.facts, read now), nothing asked of it. */
export async function draftHostChecks(w: World): Promise<MachineSpec[]> {
  const probe = await must(w, 'host.facts', { host: w.alias, refresh: true }, 300_000);
  const { draftMachine } = await hostChecks();
  return draftMachine(probe as unknown as Probe, { services: [], listening: [], disk_bytes: MARGIN, reboot: false }).checks;
}
/** The host's checks run now with the real machine kind over the world's SSH config: each failure's message. */
export async function runHostChecks(w: World, checks: MachineSpec[]): Promise<{ results: CheckResult[]; failures: string[] }> {
  const { hostFill } = await hostChecks();
  const fill = hostFill('machine', { config: w.config });
  const checkout = join(w.tmp, 'checkout');
  mkdirSync(checkout, { recursive: true });
  const results: CheckResult[] = [];
  for (const spec of checks) results.push(await fill.run(spec, { checkout, deadline: 120_000, now: () => Date.now() }));
  const failures = results.flatMap((r) => (r.outcome === 'passed' ? [] : r.failures.length ? r.failures.map((f) => f.message) : [`a check ran ${r.outcome}`]));
  return { results, failures };
}

// ---- AC1 and AC3: a setup as you and as root, then Remove it.
export interface Flow {
  w: World; unit: string; unitPath: string; port: number; pkg: string;
  checks: MachineSpec[];
  /** The host's checks before setup, after setup and after Remove it: each failure's message. */
  before: string[]; afterSetup: string[]; afterRemove: string[];
  /** The record's host changes the setup made: the service's as you, the package's as root. */
  service: Line | undefined; packageChange: Line | undefined;
  removal: Removal;
  /** What the host says after Remove it. */
  after: { unit: { enabled: string; active: string }; listening: boolean; unitFile: boolean; installed: boolean };
  seen: Line;
}
/**
 * The setup and Remove it (README, How AC1 and AC3 are read): the host's checks drafted and run before setup; a remote
 * run as you that writes and enables the user service dh1946-<id>-web.service, listening on 127.0.0.1:<port>; a root
 * plan the agent proposes that installs the test package dh1946-<id>-pkg, approved and run with your sudo password; the
 * checks again (they must see the setup); then Remove it, each root plan it raises approved and run; the checks again.
 */
export async function setupAndRemove(w: World): Promise<Flow> {
  const seen: Line = {};
  const u = w.user;
  const checks = await draftHostChecks(w);
  seen.checks = checks;
  const before = (await runHostChecks(w, checks)).failures;
  if (before.length) throw Error(`BLOCKED: the host's checks don't pass on ${w.alias} before setup, so passing them again proves nothing: ${redact(before.join(' | '))}`);
  // The service, as you.
  let port = 0;
  for (let i = 0; i < 20 && !port; i++) { const p = 20000 + Math.floor(Math.random() * 30000); if (!(await listensAt(w, p))) port = p; }
  const unit = `dh1946-${w.id}-web.service`;
  const unitDir = `${u.home}/.config/systemd/user`;
  const unitPath = `${unitDir}/${unit}`;
  const unitText = ['[Unit]', 'Description=dh1946 test service, removed after its test', '', '[Service]', `ExecStart=/usr/bin/python3 -m http.server --bind 127.0.0.1 --directory ${w.folder}/www ${port}`, '', '[Install]', 'WantedBy=default.target', ''].join('\n');
  const script = ['set -e', 'umask 022', `mkdir -p ${q(`${w.folder}/www`)} ${q(unitDir)}`, `printf '%s\\n' ${unitText.trimEnd().split('\n').map(q).join(' ')} > ${q(unitPath)}`, 'systemctl --user daemon-reload', `systemctl --user enable --now ${unit}`].join('\n');
  const service = await setupAsYou(w, script, [{
    does: `Write and enable the user service ${unit}, which listens on 127.0.0.1:${port}`,
    changes: [unitPath, `${unitDir}/default.target.wants/${unit}`],
    undo: `systemctl --user disable --now ${unit} && rm -f ${unitPath} && systemctl --user daemon-reload`,
  }]);
  seen.service_run = service;
  if (service.failed) throw Error(service.failed);
  for (let i = 0; i < 20 && !(await listensAt(w, port)); i++) await sleep(1000);
  const state = await unitState(w, unit);
  if (state.enabled !== 'enabled' || !(await listensAt(w, port))) throw Error(`BLOCKED: the setup's service ${unit} on ${w.alias} reads ${JSON.stringify(state)} and ${await listensAt(w, port) ? 'listens' : "doesn't listen"} at 127.0.0.1:${port}`);
  // The package, as root.
  const pkg = `dh1946-${w.id}-pkg`;
  const root = `${w.folder}/pkg`;
  const deb = `${w.folder}/${pkg}_1.0_all.deb`;
  const listed = `/usr/share/${pkg}/listed`;
  await mustAsYou(w, 'sh -s', ['set -eu', 'umask 022', `R=${q(root)}`, `mkdir -p "$R/DEBIAN" "$R/usr/share/${pkg}"`, `printf 'a file the package lists\\n' > "$R${listed}"`,
    `printf '%s\\n' 'Package: ${pkg}' 'Version: 1.0' 'Architecture: all' 'Maintainer: DeepBuild acceptance tests <tests@invalid>' 'Description: a #1946 test package with no install scripts' > "$R/DEBIAN/control"`,
    `dpkg-deb --root-owner-group --build "$R" ${q(deb)} >/dev/null`].join('\n'));
  const install = `${w.folder}/install-${pkg}.sh`;
  await mustAsYou(w, `umask 022 && cat > ${q(install)}`, `#!/bin/sh\nset -e\ndpkg -i ${q(deb)}\n`);
  const proposed = await proposeRootPlan(w, install, [{ does: `Install the package ${pkg} from ${deb}`, changes: [`the package ${pkg}`, listed], undo: `dpkg --purge ${pkg}`, package: deb }]);
  seen.package_plan = proposed.said;
  if (!proposed.ask) throw Error(`BLOCKED: the setup's root plan that installs ${pkg} wasn't raised: ${proposed.said}`);
  const installed = await approveAndRun(w, proposed.ask);
  seen.package_run = installed.terminal ? said(installed.terminal) : installed.failed;
  if ((await w.host.sh(`dpkg -s ${pkg} >/dev/null 2>&1`)).code !== 0) throw Error(`BLOCKED: the setup's root plan ${proposed.ask} didn't install ${pkg} on ${w.alias}: ${JSON.stringify(seen.package_run)}`);
  const afterSetup = (await runHostChecks(w, checks)).failures;
  if (!afterSetup.some((f) => f.includes(`127.0.0.1:${port}`))) throw Error(`BLOCKED: the host's checks don't see the setup on ${w.alias} (no failure for its service at 127.0.0.1:${port}): ${redact(afterSetup.join(' | ') || 'they pass')}`);
  const all = await events(w);
  const serviceChange = changeNaming(all, w.alias, unit, 'you');
  const packageChange = changeNaming(all, w.alias, pkg, 'root');
  seen.changes = hostChanges(all, w.alias).map((e) => e.data);
  // Remove it.
  const removal = await removeIt(w);
  seen.removal = removalSeen(removal);
  const afterRemove = (await runHostChecks(w, checks)).failures;
  const after = {
    unit: await unitState(w, unit), listening: await listensAt(w, port),
    unitFile: (await w.host.root(`[ -e ${q(unitPath)} ]`)).code === 0, installed: (await w.host.sh(`dpkg -s ${pkg} >/dev/null 2>&1`)).code === 0,
  };
  seen.after = { ...after, checks: afterRemove };
  return { w, unit, unitPath, port, pkg, checks, before, afterSetup, afterRemove, service: serviceChange, packageChange, removal, after, seen };
}
/** AC1's judge: the host's checks, which passed before setup and failed after it, pass again after Remove it. */
export function judgeChecks(f: Flow): string[] {
  return f.afterRemove.map((m) => `after Remove it, the host's check fails on ${f.w.alias}, which passed before setup: ${m}`);
}
/**
 * AC3's judge (README, How AC1 and AC3 are read): the setup recorded both changes with their grants; Remove it undid the
 * service as you (record: host.undone grant you listing it; host: not enabled, not listening) with no root step naming
 * it, and raised one root plan that removes the package (record: host.undone grant root listing it; host: purged).
 */
export function judgeGrants(f: Flow): string[] {
  const failures: string[] = [];
  const { w, unit, pkg, removal } = f;
  if (!f.service) failures.push(`the record holds no host change as you for ${unit} on ${w.alias} (host.changed, grant you, naming it), which the setup's remote run made`);
  else if (typeof f.service.data.undo !== 'string' || !f.service.data.undo) failures.push(`the record's host change for ${unit} on ${w.alias} has no undo: ${JSON.stringify(f.service.data).slice(0, 400)}`);
  if (!f.packageChange) failures.push(`the record holds no host change as root for ${pkg} on ${w.alias} (host.changed, grant root, naming it), which the setup's root plan made`);
  // The service: undone as you, never in a root step.
  if (f.after.unit.enabled === 'enabled') failures.push(`after Remove it, ${unit} is still enabled for your user on ${w.alias} (systemctl --user is-enabled says enabled); \`deep host remove ${w.alias}\` said ${removeSaid(removal)}`);
  const checksNaming = f.afterRemove.filter((m) => m.includes(`127.0.0.1:${f.port}`));
  if (checksNaming.length || f.after.listening) failures.push(`the host's checks fail on ${w.alias} after Remove it, naming ${unit}: ${unit} still listens at 127.0.0.1:${f.port} (${checksNaming.join('; ') || 'listening'})`);
  const youUndone = removal.undone.filter((e) => e.data.grant === 'you');
  const rootUndone = removal.undone.filter((e) => e.data.grant === 'root');
  if (f.service && !youUndone.some((e) => lists(e.data.undone, f.service!))) failures.push(`the record holds no undo of ${unit} as you on ${w.alias} (host.undone, grant you, listing it as undone): ${JSON.stringify(removal.undone.map((e) => e.data)).slice(0, 600)}`);
  for (const r of removal.roots) if (JSON.stringify(r.plan ?? {}).includes(unit)) failures.push(`${r.ask}, a root plan Remove it raised on ${w.alias}, has a step naming ${unit}, which your user enabled: it must be undone as you, with no root step`);
  if (f.service && rootUndone.some((e) => lists(e.data.undone, f.service!) || lists(e.data.left, f.service!))) failures.push(`the record undoes ${unit} as root on ${w.alias}: a host.undone with grant root lists it`);
  // The package: one root plan.
  const forPackage = removal.roots.filter((r) => JSON.stringify(r.plan ?? {}).includes(pkg));
  if (removal.roots.length !== 1) failures.push(`Remove it on ${w.alias} raised ${removal.roots.length} root plans, not one (${removal.roots.map((r) => r.ask).join(', ') || 'none'}); \`deep host remove ${w.alias}\` said ${removeSaid(removal)}`);
  if (!forPackage.length) failures.push(`no root plan Remove it raised on ${w.alias} removes ${pkg} (none names it)`);
  for (const r of removal.roots) if (r.failed) failures.push(`${r.ask}, Remove it's root plan, couldn't be approved: ${r.failed}`);
  if (f.after.installed) failures.push(`after Remove it and its root plan ran, ${pkg} is still installed on ${w.alias}: ${JSON.stringify(removal.roots.map((r) => (r.terminal ? redact(r.terminal.transcript.slice(-600)) : r.failed)))}`);
  if (f.packageChange && !rootUndone.some((e) => lists(e.data.undone, f.packageChange!))) failures.push(`the record holds no undo of ${pkg} as root on ${w.alias} (host.undone, grant root, listing it as undone)`);
  return failures;
}

// ---- AC3: an undo stopped after the first of its three steps.
/**
 * Three changes as you, each a file in its own folder of the test's (p1, p2, p3), made by one remote run; then p2 made
 * read-only (as root, as someone else would), so the undo of the second change fails as you while every file still
 * matches what was written. Remove it must stop after its first step and record that one as undone and the two left,
 * whichever end it starts from; the host must agree with the record.
 */
export async function judgePartial(w: World): Promise<{ failures: string[]; seen: Line }> {
  const failures: string[] = [];
  const seen: Line = {};
  const files = [1, 2, 3].map((n) => `${w.folder}/p${n}/file`);
  const changes: Change[] = files.map((file, i) => ({ does: `Write ${file}, change ${i + 1} of 3`, changes: [file], undo: `rm -f ${file}` }));
  const script = ['set -e', 'umask 022', ...files.map((file, i) => `mkdir -p ${q(dirname(file))} && printf 'change %s\\n' ${i + 1} > ${q(file)}`)].join('\n');
  const setup = await setupAsYou(w, script, changes);
  seen.setup = setup;
  if (setup.failed) return { failures: [setup.failed], seen };
  const all = await events(w);
  const made = changes.map((c) => hostChanges(all, w.alias, 'you').filter((e) => e.data.change === c.does).at(-1));
  seen.changes = made.map((e) => e?.data);
  made.forEach((e, i) => { if (!e) failures.push(`the record holds no host change as you for change ${i + 1} of 3 (${files[i]}) on ${w.alias}`); });
  if (failures.length) return { failures, seen };
  await w.host.root(`chmod 555 ${q(dirname(files[1]!))}`);
  const removal = await removeIt(w);
  seen.removal = removalSeen(removal);
  await w.host.root(`chmod 755 ${q(dirname(files[1]!))}`);
  const present = await Promise.all(files.map(async (f) => (await w.host.root(`[ -e ${q(f)} ]`)).code === 0));
  seen.present = present;
  const [c1, c2, c3] = made as Line[];
  const record = removal.undone.filter((e) => e.data.grant === 'you').at(-1);
  if (!record) return { failures: [`Remove it on ${w.alias} recorded no undo as you (no host.undone, grant you): \`deep host remove ${w.alias}\` said ${removeSaid(removal)}`], seen };
  const d = record.data;
  const undone = [c1!, c2!, c3!].filter((c) => lists(d.undone, c));
  const left = [c1!, c2!, c3!].filter((c) => lists(d.left, c));
  const step = (c: Line) => `change ${made.indexOf(c) + 1}`;
  if (d.partial !== true) failures.push(`Remove it's undo on ${w.alias} stopped at change 2 of 3, whose undo failed, but the record doesn't call it partial: ${JSON.stringify(d).slice(0, 600)}`);
  if (undone.length !== 1 || undone[0] === c2) failures.push(`the record of the undo stopped after its first step on ${w.alias} lists ${undone.map(step).join(', ') || 'nothing'} as undone, not the one step it undid (change 1 or 3): ${JSON.stringify(d).slice(0, 600)}`);
  if (left.length !== 2 || !left.includes(c2!)) failures.push(`the record of the undo stopped after its first step on ${w.alias} lists ${left.map(step).join(', ') || 'nothing'} as left, not the two steps left (change 2 and the other end): ${JSON.stringify(d).slice(0, 600)}`);
  if (undone.some((c) => left.includes(c))) failures.push(`the record lists a step both as undone and as left: ${JSON.stringify(d).slice(0, 600)}`);
  // The host agrees: the undone file is gone, the two left are there.
  [c1!, c2!, c3!].forEach((c, i) => {
    if (undone.includes(c) && present[i]) failures.push(`the record lists ${step(c)} as undone, but ${files[i]} is still on ${w.alias}`);
    if (left.includes(c) && !present[i]) failures.push(`the record lists ${step(c)} as left, but ${files[i]} is gone from ${w.alias}`);
  });
  if (present.filter((p) => !p).length !== 1) failures.push(`after the stopped undo, ${present.filter((p) => !p).length} of the three files are gone from ${w.alias}, not one: it didn't stop after its first step`);
  return { failures, seen };
}

// ---- AC4: an edited unit.
/**
 * Setup writes the user unit dh1946-<id>-edit.service as you (a remote run with its change); one line of it is then
 * edited by hand as your user; Remove it must keep the edited file, save a backup holding the edit, and report the undo
 * partial, naming the unit, in what `deep host remove` says and in the record (host.undone, partial, stopped at the unit
 * with its backup).
 */
export async function judgeEdited(w: World): Promise<{ failures: string[]; seen: Line }> {
  const failures: string[] = [];
  const seen: Line = {};
  const unit = `dh1946-${w.id}-edit.service`;
  const unitDir = `${w.user.home}/.config/systemd/user`;
  const unitPath = `${unitDir}/${unit}`;
  const text = ['[Unit]', 'Description=dh1946 test unit as setup wrote it', '', '[Service]', 'ExecStart=/bin/true', ''].join('\n');
  const setup = await setupAsYou(w, ['set -e', 'umask 022', `mkdir -p ${q(unitDir)}`, `printf '%s\\n' ${text.trimEnd().split('\n').map(q).join(' ')} > ${q(unitPath)}`].join('\n'),
    [{ does: `Write the user unit ${unit}`, changes: [unitPath], undo: `rm -f ${unitPath}` }]);
  seen.setup = setup;
  if (setup.failed) return { failures: [setup.failed], seen };
  const written = await shaOnHost(w, unitPath);
  if (written !== sha256(text)) return { failures: [`BLOCKED: the setup's run left ${unitPath} on ${w.alias} with SHA-256 ${written || 'none'}, not what it wrote`], seen };
  const change = changeNaming(await events(w), w.alias, unitPath, 'you');
  seen.change = change?.data;
  if (!change) failures.push(`the record holds no host change as you for ${unit} on ${w.alias} (host.changed, grant you, naming it), which the setup's remote run made`);
  // One line edited by hand, as your user.
  await mustAsYou(w, `sed -i 's/^Description=.*/Description=edited by hand after setup/' ${q(unitPath)}`);
  const edited = await shaOnHost(w, unitPath);
  const editedText = await readAsRoot(w, unitPath);
  if (!edited || edited === written) return { failures: [...failures, `BLOCKED: editing a line of ${unitPath} by hand didn't change it`], seen };
  seen.edit = { written: written.slice(0, 12), edited: edited.slice(0, 12) };
  const removal = await removeIt(w);
  seen.removal = removalSeen(removal);
  // The edited file kept.
  const now = await shaOnHost(w, unitPath);
  seen.after = now.slice(0, 12);
  if (now !== edited) failures.push(`Remove it didn't keep your edit to ${unit} on ${w.alias}: ${unitPath} there ${now ? `now has SHA-256 ${now.slice(0, 12)}${now === written ? ', the version setup wrote' : ''}` : 'is gone'}, not the edited ${edited.slice(0, 12)}`);
  // Reported partial, naming the unit.
  const out = `${removal.command.stdout}\n${removal.command.stderr}`;
  if (!/partial/i.test(out) || !out.includes(unit)) failures.push(`\`deep host remove ${w.alias}\` didn't report the undo partial, naming ${unit}: it said ${removeSaid(removal)}`);
  const record = removal.undone.find((e) => e.data.partial === true && JSON.stringify(e.data.stopped ?? {}).includes(unit));
  seen.record = record?.data;
  if (!record) failures.push(`the record holds no partial undo on ${w.alias} stopped at ${unit} (host.undone, partial true, stopped naming it): ${JSON.stringify(removal.undone.map((e) => e.data)).slice(0, 600)}`);
  // The backup: where the record says, holding the edit.
  const backup = record?.data.stopped?.backup;
  if (record && (typeof backup !== 'string' || !backup.startsWith('/') || backup === unitPath)) failures.push(`the partial undo of ${unit} on ${w.alias} names no backup (stopped.backup, an absolute path other than the unit's): ${JSON.stringify(record.data.stopped).slice(0, 400)}`);
  else if (record) {
    const kept = await shaOnHost(w, backup as string);
    seen.backup = { path: redact(backup as string), sha256: kept.slice(0, 12) };
    if (kept !== edited) failures.push(`the backup Remove it saved of ${unit} on ${w.alias}, ${redact(backup as string)}, ${kept ? `has SHA-256 ${kept.slice(0, 12)}` : "isn't there"}, not the edited file's ${edited.slice(0, 12)}`);
  }
  seen.edited_text = editedText?.split('\n')[1];
  return { failures, seen };
}

// ---- AC2: the sudo rule.
/** Every sudo rule line under /etc/sudoers.d naming the test user, outside the harness's own file: `<file>\t<line>`. */
async function rulesFor(w: World): Promise<{ file: string; line: string }[]> {
  const r = await w.host.root(`for f in /etc/sudoers.d/*; do [ -f "$f" ] && [ "$f" != /etc/sudoers.d/00-dh1946-${w.id} ] && grep -H '' "$f" | grep -F ${q(w.user.name)}; done; true`);
  return r.stdout.split('\n').filter(Boolean).map((l) => ({ file: l.slice(0, l.indexOf(':')), line: l.slice(l.indexOf(':') + 1) }));
}
/** The command path a rule line allows: its first word that is an absolute path (`user host = (runas) TAG: [digest] /path`). */
const allowedPath = (line: string): string | undefined => line.split(/[\s,=]+/).find((t) => t.startsWith('/'));
/** The digests a rule line names: each sha256:<hex or base64>, as lower-case hex. */
function digestsOf(line: string): string[] {
  return [...line.matchAll(/sha256:([0-9A-Za-z+/=]+)/g)].map(([, d]) => (/^[0-9A-Fa-f]{64}$/.test(d!) ? d!.toLowerCase() : Buffer.from(d!, 'base64').toString('hex')));
}
/** The script at `path` run as you with `sudo -n`, which never asks for a password: the variant lines it added. */
async function sudoRun(w: World, path: string, nonce: string): Promise<{ ran: Ran; added: string[] }> {
  const before = await marks(w, nonce);
  const ran = await asYou(w, `sudo -n -- ${q(path)}`);
  const after = await marks(w, nonce);
  return { ran, added: after.slice(before.length) };
}
/**
 * AC2's judge (README, How AC2 is read): the agent's root plan asks for its script to be allowed by a sudo rule
 * (deep_root_plan's sudo_rule); its plan shows the rule as a step with its undo; approved and run with your password, the
 * rule is a host change as root with its undo and names the script's sha256 digest; by it, as you with `sudo -n`, the
 * unchanged script runs as root; with one byte of the allowed script changed, sudo refuses it and nothing of it runs;
 * Remove it, its root plan run with your password, takes the rule out.
 */
export async function judgeSudoRule(w: World, letter: 'A' | 'C'): Promise<{ failures: string[]; seen: Line }> {
  const failures: string[] = [];
  const seen: Line = {};
  const nonce = randomBytes(6).toString('hex');
  const changed = String.fromCharCode(letter.charCodeAt(0) + 1);
  const text = planScript(w.user.marks, nonce, letter);
  const locked = sha256(text);
  const offset = text.indexOf(`\nV=${letter}\n`) + 3;
  const script = `${w.folder}/allowed-${nonce}.sh`;
  await mustAsYou(w, `umask 022 && cat > ${q(script)} && chmod 755 ${q(script)}`, text);
  const proposed = await proposeRootPlan(w, script, [{ does: `Note which variant ran, and as whom, in ${w.user.marks}/ran`, changes: [`${w.user.marks}/ran`], undo: `sed -i '/^dh1946 ${nonce} /d' ${w.user.marks}/ran`, package: null }], true);
  seen.proposed = proposed.said;
  if (!proposed.ask) return { failures: [`the agent's root plan asking for a sudo rule on ${w.alias} wasn't raised: ${proposed.said}`], seen };
  const ask = proposed.ask;
  const plan = (await awaitEvent(w, (all) => planOf(all, ask), 60_000))?.data;
  seen.plan = plan;
  const ruleSteps = ((plan?.steps ?? []) as Line[]).filter((s) => `${String(s.does)} ${JSON.stringify(s.changes)}`.includes('/etc/sudoers.d/'));
  if (!ruleSteps.length) failures.push(`${ask}'s plan doesn't show the sudo rule as a host change: no step names a file under /etc/sudoers.d/ (${JSON.stringify(plan?.steps ?? null).slice(0, 600)})`);
  else if (!ruleSteps.some((s) => typeof s.undo === 'string' && s.undo && s.undo !== CANT_UNDO)) failures.push(`${ask}'s plan shows the sudo rule with no undo: ${JSON.stringify(ruleSteps).slice(0, 400)}`);
  const ran = await approveAndRun(w, ask);
  seen.run = ran.terminal ? said(ran.terminal) : ran.failed;
  if (ran.failed) return { failures: [...failures, ran.failed], seen };
  // The rule: in the record as a host change as root with its undo, and on the host naming the digest.
  const rules = await rulesFor(w);
  seen.rules = rules;
  const recorded = (await awaitEvent(w, (all) => hostChanges(all, w.alias, 'root').find((e) => JSON.stringify(e.data.changes ?? []).includes('/etc/sudoers.d/')), 30_000))?.data;
  seen.rule_change = recorded;
  if (!recorded) failures.push(`the record holds no host change as root on ${w.alias} for the sudo rule (host.changed, grant root, changing a file under /etc/sudoers.d/)`);
  else if (typeof recorded.undo !== 'string' || !recorded.undo) failures.push(`the record's host change for the sudo rule on ${w.alias} has no undo: ${JSON.stringify(recorded).slice(0, 400)}`);
  const rule = rules.find((r) => allowedPath(r.line));
  if (!rule) return { failures: [...failures, `no sudo rule under /etc/sudoers.d on ${w.alias} allows a command for your user after ${ask} ran: \`deep host run\` said ${JSON.stringify(seen.run).slice(0, 1200)}`], seen };
  const path = allowedPath(rule.line)!;
  seen.allowed = { file: rule.file, line: redact(rule.line), path };
  if (!digestsOf(rule.line).includes(locked)) failures.push(`the sudo rule ${rule.file} on ${w.alias} doesn't name the script's sha256 digest ${locked.slice(0, 12)}: ${redact(rule.line)}`);
  if ((await shaOnHost(w, path)) !== locked) return { failures: [...failures, `the sudo rule on ${w.alias} allows ${path}, whose bytes aren't the plan's script (${locked.slice(0, 12)})`], seen };
  // By the rule, the unchanged script runs as root with no password.
  const first = await sudoRun(w, path, nonce);
  seen.unchanged = { code: first.ran.code, added: first.added, err: redact(first.ran.stderr.slice(-400)) };
  if (!first.added.some((l) => l.endsWith(`variant ${letter} uid 0`))) failures.push(`the sudo rule on ${w.alias} doesn't let your user run the unchanged script as root without a password: \`sudo -n ${path}\` ${redact(shown(first.ran))}`);
  // One byte of the allowed script changed: sudo must refuse it.
  const found = sha256(text.slice(0, offset) + changed + text.slice(offset + 1));
  const now = (await w.host.root(`printf %s ${changed} | dd of=${q(path)} bs=1 seek=${offset} conv=notrunc status=none && sha256sum < ${q(path)} | cut -d' ' -f1`)).stdout.trim();
  if (now !== found) return { failures: [...failures, `BLOCKED: the harness's one-byte change left ${path} with SHA-256 ${now}, not ${found}`], seen };
  const second = await sudoRun(w, path, nonce);
  seen.changed = { code: second.ran.code, added: second.added, err: redact(second.ran.stderr.slice(-400)) };
  if (second.added.some((l) => l.includes(`variant ${changed} `))) failures.push(`sudo ran the changed script (variant ${changed}, SHA-256 ${found.slice(0, 12)}) as root on ${w.alias} by the rule ${rule.file}, which must name the digest ${locked.slice(0, 12)} so sudo refuses a changed file: ${redact(rule.line)}`);
  else if (second.ran.code === 0) failures.push(`\`sudo -n ${path}\` exited 0 on ${w.alias} with one byte of the allowed script changed: sudo must refuse it`);
  await w.host.root(`printf %s ${letter} | dd of=${q(path)} bs=1 seek=${offset} conv=notrunc status=none`);
  // Remove it takes the rule out.
  const removal = await removeIt(w);
  seen.removal = removalSeen(removal);
  if (!removal.roots.length) failures.push(`Remove it on ${w.alias} raised no root plan to take the sudo rule out: \`deep host remove ${w.alias}\` said ${removeSaid(removal)}`);
  const left = (await rulesFor(w)).filter((r) => r.line.includes(path) || digestsOf(r.line).includes(locked));
  const named = (await w.host.root(`grep -rlF -- ${q(path)} /etc/sudoers /etc/sudoers.d 2>/dev/null; true`)).stdout.split('\n').filter(Boolean);
  seen.after_remove = { rules: left, files_naming_path: named };
  if (left.length || named.length) failures.push(`after Remove it and its root plan ran, the sudo rule for ${path} is still on ${w.alias}: ${[...new Set([...left.map((r) => r.file), ...named])].join(', ')}`);
  const third = await sudoRun(w, path, nonce);
  if (third.added.length) failures.push(`after Remove it, \`sudo -n ${path}\` still ran the script as root on ${w.alias} with no password`);
  return { failures, seen };
}

// ---- The proof, rewritten each run under $TMPDIR/deep-1946-proof/.
export const PROOF_DIR = join(tmpdir(), 'deep-1946-proof');
export function proof(name: string, value: unknown): void {
  mkdirSync(PROOF_DIR, { recursive: true });
  writeFileSync(join(PROOF_DIR, name), redact(`${JSON.stringify(value, null, 2)}\n`));
}
