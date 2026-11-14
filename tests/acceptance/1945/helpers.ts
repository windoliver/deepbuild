// Test-side tools for the #1945 acceptance tests (README): a world of a real hub (`deep hub run`) in a temp home whose
// `~/.ssh/config` names one of this Mac's Lima VMs, reached through a TCP relay of this file's on 127.0.0.1 (so a test
// can cut and refuse the hub's connections to the host), as a throwaway user the harness makes there (sudo needs its
// password, lingering off) or as Lima's own user; the hub's socket as the cli role; `deep inbox answer`; `deep` run in
// a pseudo-terminal (BSD `script`) where you type the sudo password once its prompt shows; an agent's session played
// through the real deep-hook and its own `deep mcp` (fixtures/agent.mjs); a chat channel (packages/channels/chat) whose
// provider is a stand-in here; the harness's own SSH link to the VM as Lima's user, which makes and removes the
// throwaway user and reads the host; and the judges a criterion's test and its planted program share.
// No package module is imported: the hub, the CLI and deep mcp are driven as built (packages/cli/dist/main.js).
//
// Safety: every local folder is under /tmp/dh1945-* and removed after its file; HOME is a temp home for every hub,
// deep command, deep mcp and deep-hook, run without DEEP_*, XDG_*, CLAUDE*, CODEX*, billing keys or NODE_OPTIONS
// (SSH_AUTH_SOCK and PATH kept). The only network is 127.0.0.1 and the VMs through their forwarded ports. On a VM this
// file changes only what it made: the user dh1945<id> (its home, sessions, user manager, lingering), the files
// /etc/sudoers.d/dh1945-<id> and /etc/polkit-1/rules.d/10-dh1945-<id>.rules, the folder /var/lib/dh1945-<id>, the
// folders its root plans ran from, that user's journal file, and for Lima's user its folder ~/dh1945-<id>; all of it
// is removed after the file. Lima's own control socket is never used and the VMs are never stopped. Every local process
// is one this file started, stopped by its PID. No password reaches an argument list or a file the suite keeps: each
// goes to the host on an SSH session's stdin and to `deep` only at the sudo prompt, and the suite writes down neither
// it nor the VM's user name or key paths.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import net from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, zstdDecompressSync } from 'node:zlib';
import { afterAll } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const NODE = process.execPath;
const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
/** The first-party chat channel, installed as you would (deep install), its provider a stand-in of this file's. */
const CHAT = join(REPO, 'packages/channels/chat');

/** Each criterion's ID: `#1945.` and the first 8 hex of SHA-256 of its checkbox text (scripts/proof-change.mjs). */
export const AC = {
  1: '#1945.5592231a The sudo password never reaches the record, a log, an agent or a channel',
  2: '#1945.a62d8bc1 After you approve a root plan, its script changed by one byte where the agent wrote it is refused by `deep` before anything runs as root, naming the hash the plan locked and the one it found; the unchanged script runs from a copy in a folder only root can write, and its output and exit code are recorded as the run\'s evidence. A planted `deep` that runs the script from the agent\'s path runs the changed script and fails this test',
  3: '#1945.fcdd3d22 On a test host with lingering off, the first remote run turns it on, as a recorded host change shown with its undo, before the run starts, and the run keeps going after every SSH session to the host has closed; on a host whose policy needs root for it, the change comes as a root plan. A planted setup that skips lingering loses the run when the last session closes and fails this test, naming the host',
  4: '#1945.a75a14aa A plan that installs a test package whose install script writes a file the package log doesn\'t list says before your yes that what its install scripts did can\'t be undone; a plan that lists the package as fully undoable fails this test',
} as const;

/** The planted wrong programs the criteria name (README, Plants), each selected with DEEP_HUB_PLANT. */
export type HubPlant = 'host-skips-lingering' | 'host-package-fully-undoable';
export type DeepPlant = 'root-plan-runs-agent-path';
export type Vm = 'deep-ubuntu' | 'deep-fedora';
/** The host's name in the world's SSH config. */
export const aliasOf = (vm: Vm): string => (vm === 'deep-ubuntu' ? 'dh-ubuntu' : 'dh-fedora');
/** Any 40-hex commit for runs started as you; a remote run names no commit of this Mac's. */
export const COMMIT = '1945000000000000000000000000000000000000';
/** What the core marks a plan's step with no undo, as it shows it (packages/asks, #69). */
export const CANT_UNDO = "can't undo";
/** The words a step that says what a package's install scripts did uses (README, reading 9). */
export const INSTALL_SCRIPTS = /install(ation)? scripts?|maintainer scripts?|postinst|preinst|scriptlets?/i;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export const parse = (text: string): Line | undefined => { try { const v: unknown = JSON.parse(text); return typeof v === 'object' && v !== null ? (v as Line) : undefined; } catch { return undefined; } };
/** Single-quoted for a POSIX shell. */
export const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

// ---- Temp folders, local processes, and what the suite must never write down.
const made: string[] = [];
/** A fresh folder /tmp/dh1945-<id> (short: the hub's socket fails with EINVAL on a long path) and its id, 8 hex. */
export function tempDir(): { dir: string; id: string } {
  for (;;) {
    const id = randomBytes(4).toString('hex');
    const dir = `/tmp/dh1945-${id}`;
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
/** One Host block: Lima's way in (its host key and ciphers) at `port` on 127.0.0.1, as `user` with `key`. */
function hostBlock(name: string, s: LimaSsh, port: number, knownHosts: string, user: string, key: string, extra: string[] = []): string {
  return [
    `Host ${name}`, '  HostName 127.0.0.1', `  Port ${port}`, `  User ${user}`, `  IdentityFile ${key}`, '  IdentitiesOnly yes',
    '  PreferredAuthentications publickey', '  StrictHostKeyChecking yes', `  UserKnownHostsFile ${knownHosts}`,
    `  HostKeyAlias ${s.hostKeyAlias}`, ...(s.ciphers ? [`  Ciphers ${s.ciphers}`] : []), '  Compression no', '  GSSAPIAuthentication no', ...extra, '',
  ].join('\n');
}

// ---- The relay: 127.0.0.1:<port> to a VM's forwarded port; it can cut every connection and refuse new ones.
export interface Conn { id: number; opened: number; closed: number | undefined; down: number; client: net.Socket; server: net.Socket }
export class Relay {
  readonly conns: Conn[] = [];
  /** While true, each new connection is counted and closed at once: no SSH session can open through it. */
  refusing = false;
  private constructor(private readonly server: net.Server, readonly port: number, private readonly target: number) {}
  static async open(target: number): Promise<Relay> {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const relay = new Relay(server, (server.address() as net.AddressInfo).port, target);
    server.on('connection', (client) => relay.accept(client));
    closers.push(() => relay.close());
    return relay;
  }
  private accept(client: net.Socket): void {
    const c: Conn = { id: this.conns.length + 1, opened: Date.now(), closed: undefined, down: 0, client, server: client };
    this.conns.push(c);
    if (this.refusing) { c.closed = Date.now(); client.destroy(); return; }
    const server = net.connect(this.target, '127.0.0.1');
    c.server = server;
    const end = () => { if (c.closed === undefined) c.closed = Date.now(); client.destroy(); server.destroy(); };
    client.on('data', (chunk: Buffer) => { if (!server.destroyed) server.write(chunk); });
    server.on('data', (chunk: Buffer) => { c.down += chunk.length; if (!client.destroyed) client.write(chunk); });
    for (const s of [client, server]) { s.on('error', end); s.on('close', end); }
  }
  open(): Conn[] { return this.conns.filter((c) => c.closed === undefined); }
  /** Every open connection cut, and every new one refused until `refuse(false)`. */
  refuse(on: boolean): number {
    this.refusing = on;
    if (!on) return 0;
    const open = this.open();
    for (const c of open) { c.closed = Date.now(); c.client.destroy(); c.server.destroy(); }
    return open.length;
  }
  async close(): Promise<void> {
    this.refuse(true);
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
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
    writeFileSync(config, hostBlock('dh1945h', s, s.port, known, s.user, s.identityFile, ['  BatchMode yes', '  ControlMaster no', `  ControlPath ${join(dir, 'c')}`, '  ServerAliveInterval 5', '  ServerAliveCountMax 6']), { mode: 0o600 });
    const master = spawn('ssh', ['-F', config, '-o', 'ControlMaster=yes', '-o', 'ControlPersist=no', '-N', 'dh1945h'], { stdio: ['ignore', 'ignore', 'pipe'] });
    own(master.pid);
    let err = '';
    master.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
    const h = new HostSide(vm, s, config);
    closers.push(async () => { try { master.kill('SIGTERM'); } catch { /* gone */ } });
    const deadline = Date.now() + 60_000;
    for (;;) {
      const check = await run('ssh', ['-F', config, '-O', 'check', 'dh1945h'], { timeoutMs: 10_000 });
      if (check.code === 0) break;
      if (master.exitCode !== null || Date.now() > deadline) throw Error(`BLOCKED: the VM ${vm} can't be reached over SSH at its forwarded port: ${redact(err.slice(-600))}`);
      await sleep(250);
    }
    return h;
  }
  /** One shell command on the host as Lima's user, through the harness link. */
  sh(command: string, o: { input?: string; timeoutMs?: number } = {}): Promise<Ran> {
    return run('ssh', ['-F', this.config, 'dh1945h', command], { ...(o.input !== undefined ? { input: o.input } : {}), timeoutMs: o.timeoutMs ?? 120_000 });
  }
  /** A command that must succeed: its stdout. */
  async must(command: string, o: { input?: string; timeoutMs?: number } = {}): Promise<string> {
    const r = await this.sh(command, o);
    if (r.code !== 0) throw Error(`BLOCKED: on ${this.vm}, \`${redact(command.slice(0, 200))}\` failed: ${redact(shown(r))}`);
    return r.stdout;
  }
  /** A script run as root (sudo sh -s), sent on the session's stdin, so nothing in it reaches an argument list or a log. */
  root(script: string, timeoutMs = 300_000): Promise<Ran> { return this.sh('sudo -n sh -s', { input: script, timeoutMs }); }
  async mustRoot(script: string, what: string, timeoutMs = 300_000): Promise<string> {
    const r = await this.root(script, timeoutMs);
    if (r.code !== 0) throw Error(`BLOCKED: on ${this.vm}, ${what} failed: ${redact(shown(r))}`);
    return r.stdout;
  }
  /** The host's clock, in s since the epoch. */
  async now(): Promise<number> { return Number((await this.must('date +%s')).trim()); }
}

// ---- The throwaway user (README, The worlds): sudo needs its password, lingering off, gone after the file.
export interface TestUser { name: string; uid: number; group: string; home: string; key: string; password: string; marks: string; since: number }
function setupScript(id: string, name: string, pub: string, password: string, policy: boolean): string {
  const M = `/var/lib/dh1945-${id}`;
  return [
    'set -eu',
    `U=${name}; M=${M}`,
    'getent passwd "$U" >/dev/null && { echo "the user $U exists already" >&2; exit 3; }',
    // The harness's root-only folder, first, so the cleanup's stamp and journal list exist whatever fails after it.
    'install -d -m 700 -o root -g root "$M"',
    'touch "$M/stamp"',
    // No subordinate IDs (/etc/subuid and /etc/subgid stay as they are: on deep-fedora Lima's user holds the whole range).
    `useradd -m -s /bin/sh -K SUB_UID_COUNT=0 -K SUB_GID_COUNT=0 -c 'dh1945 test user, removed after its test' "$U"`,
    'uid=$(id -u "$U"); G=$(id -gn "$U"); H=$(getent passwd "$U" | cut -d: -f6)',
    'ls /var/log/journal/*/user-"$uid".journal /var/log/journal/*/user-"$uid"@*.journal 2>/dev/null > "$M/journals-before" || true',
    // The password goes to chpasswd on a pipe from printf, a shell builtin: it's in no argument list and no file.
    `printf '%s:%s\\n' "$U" ${q(password)} | chpasswd`,
    'install -d -m 700 -o "$U" -g "$G" "$H/.ssh"',
    `printf '%s\\n' ${q(pub)} > "$H/.ssh/authorized_keys"`,
    'chown "$U:$G" "$H/.ssh/authorized_keys"; chmod 600 "$H/.ssh/authorized_keys"',
    'if command -v restorecon >/dev/null; then restorecon -R "$H/.ssh"; fi',
    // sudo for everything, with the user's password; checked with visudo before it's moved in.
    't=$(mktemp); printf \'%s ALL=(ALL:ALL) ALL\\n\' "$U" > "$t"; visudo -cf "$t" >/dev/null; install -m 440 -o root -g root "$t" "/etc/sudoers.d/dh1945-' + id + '"; rm -f "$t"',
    'loginctl disable-linger "$U" 2>/dev/null || true',
    // Its home traversable and the test's folder readable, so the harness reads the runs' files without sudo.
    'chmod 711 "$H"',
    `install -d -m 755 -o "$U" -g "$G" "$H/dh1945-${id}"`,
    ...(policy ? [
      // Lingering needs an admin for this user alone (README, reading 8).
      `f=/etc/polkit-1/rules.d/10-dh1945-${id}.rules`,
      `printf '%s\\n' '// dh1945-${id}: a #1945 acceptance test makes lingering need an admin for ${name} alone; removed after the test' 'polkit.addRule(function (action, subject) {' '  if (action.id == "org.freedesktop.login1.set-self-linger" && subject.user == "${name}") return polkit.Result.AUTH_ADMIN;' '});' > "$f.part"`,
      'chmod 644 "$f.part"; mv "$f.part" "$f"',
    ] : []),
    'printf \'ready %s %s %s %s\\n\' "$uid" "$G" "$H" "$(date +%s)"',
  ].join('\n');
}
function cleanupScript(id: string, name: string): string {
  return [
    `U=${name}; M=/var/lib/dh1945-${id}; P=dh1945-${id}`,
    'if uid=$(id -u "$U" 2>/dev/null); then',
    '  loginctl disable-linger "$U" 2>/dev/null',
    '  loginctl terminate-user "$U" 2>/dev/null',
    '  systemctl stop "user@$uid.service" 2>/dev/null',
    '  i=0; while [ -n "$(ps -o pid= -u "$uid")" ] && [ $i -lt 30 ]; do sleep 1; i=$((i + 1)); done',
    // Last, by PID: what is still running as the test's own user.
    '  p=$(ps -o pid= -u "$uid"); [ -n "$p" ] && kill -KILL $p 2>/dev/null; sleep 1',
    '  userdel -r "$U" 2>/dev/null || userdel -r -f "$U" 2>/dev/null',
    // Its journal file, when it had none before the test.
    '  [ -s "$M/journals-before" ] || rm -f /var/log/journal/*/user-"$uid".journal /var/log/journal/*/user-"$uid"@*.journal',
    'fi',
    `rm -f "/etc/sudoers.d/dh1945-${id}" "/etc/polkit-1/rules.d/10-dh1945-${id}.rules"`,
    // The folders its root plans ran from (each plan noted its copy's path in $M/ran): one made during the test with
    // nothing older in it goes whole; otherwise only the copy. Then each parent made during the test, once empty.
    'if [ -f "$M/ran" ] && [ -f "$M/stamp" ]; then',
    '  sed -n \'s/^dh1945 [0-9a-f]* file [0-9?]* [0-9?]* [0-7?]* //p\' "$M/ran" | sort -u | while read -r f; do',
    '    case "$f" in /*) ;; *) continue ;; esac',
    '    d=$(dirname -- "$f")',
    '    case "$d" in /|/root|/var|/var/lib|/var/tmp|/tmp|/usr|/usr/*bin|/usr/lib|/usr/local|/etc|/opt|/srv|/home|/home/*/dh1945-*|/run|/dev/shm) rm -f -- "$f"; continue ;; esac',
    '    if [ "$(stat -c %u -- "$d" 2>/dev/null)" = 0 ] && [ "$d" -nt "$M/stamp" ] && [ -z "$(find "$d" -mindepth 1 ! -newer "$M/stamp" -print -quit 2>/dev/null)" ] && basename -- "$d" | grep -Eq \'^[0-9A-Za-z_.:-]{8,}$\' && basename -- "$d" | grep -q \'[0-9]\'; then rm -rf -- "$d"; else rm -f -- "$f"; fi',
    '    p=$(dirname -- "$d"); while [ "$p" != / ] && [ "$p" -nt "$M/stamp" ] && rmdir -- "$p" 2>/dev/null; do p=$(dirname -- "$p"); done',
    '  done',
    'fi',
    // A test package, should a run have installed one.
    'if command -v dpkg >/dev/null && dpkg -s "$P" >/dev/null 2>&1; then dpkg --purge "$P" >/dev/null 2>&1; fi',
    'rm -rf "$M" "/var/lib/$P-made"',
    'echo cleaned',
  ].join('\n');
}
/** Makes the throwaway user on the VM through the harness link; its cleanup is registered before anything is made. */
async function makeUser(h: HostSide, id: string, tmp: string, policy: boolean): Promise<TestUser> {
  const name = `dh1945${id}`;
  const keyDir = join(tmp, 'k');
  mkdirSync(keyDir, { mode: 0o700 });
  const key = join(keyDir, 'id');
  const kg = await run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', `dh1945-${id}`, '-f', key]);
  if (kg.code !== 0) throw Error(`BLOCKED: ssh-keygen failed: ${shown(kg)}`);
  hide(key, '<test-key>');
  const password = randomBytes(18).toString('base64url');
  hide(password, '<password>');
  closers.push(async () => {
    const r = await h.root(cleanupScript(id, name), 300_000);
    if (!r.stdout.includes('cleaned')) process.stderr.write(`#1945 harness: removing ${name} from ${h.vm} didn't finish: ${redact(shown(r))}\n`);
  });
  const out = await h.mustRoot(setupScript(id, name, readFileSync(`${key}.pub`, 'utf8').trim(), password, policy), `making the test user ${name}`);
  const m = /ready (\d+) (\S+) (\S+) (\d+)/.exec(out);
  if (!m) throw Error(`BLOCKED: making the test user ${name} on ${h.vm} said ${JSON.stringify(redact(out))}`);
  return { name, uid: Number(m[1]), group: m[2]!, home: m[3]!, key, password, marks: `/var/lib/dh1945-${id}`, since: Number(m[4]) };
}

// ---- The hub.
export interface Hub { pid: number; socket: string; root: string; child: ChildProcess; output: string[] }
async function startHub(home: string, env: Record<string, string | undefined>): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  const output: string[] = [];
  let out = '';
  let size = 0;
  const keep = (d: string) => { if (size < 32_000_000) { output.push(d); size += d.length; } };
  child.stderr!.setEncoding('utf8').on('data', keep);
  const ready = await new Promise<Line | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 180_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      keep(d);
      out += d;
      if (out.includes('\n')) { clearTimeout(timer); resolve(parse(out.split('\n')[0]!)); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(undefined); });
  });
  const hub: Hub = { pid: child.pid!, socket: typeof ready?.socket === 'string' ? ready.socket : join(home, '.deepbuild', 'hub.sock'), root: join(home, '.deepbuild'), child, output };
  closers.push(async () => {
    // The hub's own children (the agents' CLIs it runs among them) are gathered while it stops, and any still running
    // once it has gone are stopped by their PIDs: a child the hub leaves behind would outlive the world's home.
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

// ---- The chat channel's provider, a stand-in: it records every request the channel makes and answers as #65's do.
export class Provider {
  /** Every request, as it came: method, path and body. */
  readonly got: string[] = [];
  private constructor(readonly api: string) {}
  static async start(): Promise<Provider> {
    let self!: Provider;
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = '';
      req.setEncoding('utf8').on('data', (d: string) => (body += d)).on('end', () => {
        self.got.push(`${req.method ?? ''} ${req.url ?? ''} ${body}`);
        const json = (status: number, out: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(out)); };
        if (req.method === 'POST' && req.url === '/messages') return json(200, { ack: `chat-${self.got.length}` });
        if (req.method === 'GET' && req.url?.startsWith('/answers')) return json(200, { answers: [], seen: [], cursor: '0' });
        return json(404, { error: `no ${req.method} ${req.url}` });
      });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    self = new Provider(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
    closers.push(() => new Promise((done) => { server.closeAllConnections(); server.close(() => done()); }));
    return self;
  }
}

// ---- The world.
export interface World {
  id: string; tmp: string; home: string; vm: Vm; alias: string; hub: Hub; host: HostSide; relay: Relay;
  /** The throwaway user the world's SSH config logs in as; undefined when it logs in as Lima's user. */
  user: TestUser | undefined;
  /** The test's folder on the host, in that user's home. */
  folder: string;
  /** Asks this suite answered yes to, as you, from the approver (README, reading 12). */
  answered: Line[];
  /** Root plans the test answers itself: an ask whose plan holds one of these the approver leaves alone. */
  skip: Set<string>;
  /** Every `deep` command's output, unredacted, kept in memory for AC1's search. */
  outputs: string[];
  provider: Provider | undefined;
  confirm: string;
}
export interface WorldOptions {
  /** `test`: a throwaway user (sudo needs its password, lingering off); `lima`: Lima's own user. */
  user: 'test' | 'lima';
  /** The throwaway user's lingering needs an admin (a polkit rule of the test's). */
  policy?: boolean;
  plant?: HubPlant;
  /** A chat channel, installed with deep install, every kind of ask routed to it. */
  channel?: boolean;
  /** deep_* tools' waits end at once (MCP_TOOL_TIMEOUT=30000). */
  noToolWait?: boolean;
  /** Which host asks the approver says yes to, by the ask (ask.created) and its plan (default: every one naming the host). */
  approve?: (created: Line, plan: Line | undefined) => boolean;
}
export async function openWorld(vm: Vm, o: WorldOptions): Promise<World> {
  if (!existsSync(CLI)) throw Error(`BLOCKED: the deep CLI (npm run build --workspaces) is missing at ${CLI}`);
  const { dir: tmp, id } = tempDir();
  const home = join(tmp, 'h');
  mkdirSync(join(home, '.ssh'), { recursive: true, mode: 0o700 });
  mkdirSync(join(home, '.deepbuild'), { recursive: true, mode: 0o700 });
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const host = await HostSide.open(vm, tmp);
  let user: TestUser | undefined;
  let folder: string;
  if (o.user === 'test') {
    user = await makeUser(host, id, tmp, o.policy === true);
    folder = `${user.home}/dh1945-${id}`;
  } else {
    const lima = (await host.must('printf %s "$HOME"')).trim();
    folder = `${lima}/dh1945-${id}`;
    closers.push(async () => { await host.sh(`rm -rf ${q(folder)}`).catch(() => undefined); });
    await host.must(`umask 022 && mkdir -p ${q(folder)}`);
  }
  const relay = await Relay.open(host.ssh.port);
  const alias = aliasOf(vm);
  const known = join(home, '.ssh', 'known_hosts_lima');
  copyFileSync(host.ssh.knownHosts, known);
  writeFileSync(join(home, '.ssh', 'config'), hostBlock(alias, host.ssh, relay.port, known, user?.name ?? host.ssh.user, user?.key ?? host.ssh.identityFile), { mode: 0o600 });
  let provider: Provider | undefined;
  if (o.channel) {
    provider = await Provider.start();
    const routes = [{ kinds: ['authority', 'unblock', 'choice', 'taste', 'exception', 'definition'], to: ['chat'] }];
    writeFileSync(join(home, '.deepbuild', 'channels.json'), `${JSON.stringify({ channels: { chat: { api: provider.api, token: `bot-${id}` } }, routes, quiet: null }, null, 2)}\n`, { mode: 0o600 });
  }
  const hub = await startHub(home, { DEEP_HUB_TEST_CONFIRM: confirm, ...(o.plant ? { DEEP_HUB_PLANT: o.plant } : {}), ...(o.noToolWait ? { MCP_TOOL_TIMEOUT: '30000' } : {}) });
  const w: World = { id, tmp, home, vm, alias, hub, host, relay, user, folder, answered: [], skip: new Set(), outputs: [], provider, confirm };
  if (provider) {
    const r = await deep(w, ['install', CHAT], 600_000);
    if (r.code !== 0) throw Error(`BLOCKED: deep install of the chat channel exited ${r.code}: ${redact(shown(r))}`);
    for (const deadline = Date.now() + 300_000; !provider.got.length; await sleep(500)) {
      if (Date.now() > deadline) throw Error('BLOCKED: the chat channel, installed, never called its provider');
    }
  }
  approveHostAsks(w, o.approve ?? (() => true));
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
/** Waits until `pick` finds something in the record; undefined at the deadline. */
export async function awaitEvent(w: World, pick: (all: Line[]) => Line | undefined, timeoutMs: number): Promise<Line | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = pick(await events(w));
    if (found || Date.now() > deadline) return found;
    await sleep(1000);
  }
}
/** `deep <args>` as you, in the world's home; its output kept for AC1's search. */
export async function deep(w: World, args: readonly string[], timeoutMs = 180_000): Promise<Ran> {
  const r = await run(NODE, [CLI, ...args], { env: childEnv(w.home, { DEEP_HUB_TEST_CONFIRM: w.confirm }), cwd: w.tmp, timeoutMs });
  w.outputs.push(r.stdout, r.stderr);
  return r;
}

// ---- Asks and their plans, as the record holds them.
export const askCreated = (all: Line[], ask: string): Line | undefined => all.find((e) => e.kind === 'ask.created' && `ask:${String(e.id)}` === ask);
/** The core's plan for an ask (plan.proposed, written by the core), the newest. */
export const planOf = (all: Line[], ask: string): Line | undefined => all.filter((e) => e.kind === 'plan.proposed' && e.writer === 'core' && e.data.ask === ask).at(-1);
export const answerOf = (all: Line[], ask: string): Line | undefined => all.find((e) => e.kind === 'ask.answered' && (e.subject === ask || e.data.ask === ask));
/** The option of an ask whose decision is allow. */
export const allowOf = (created: Line | undefined): string | undefined => (created?.data.options as Line[] | undefined)?.find((x) => x.decision === 'allow')?.id;
/** Whether an ask defaults to no: its default option's decision is deny. */
export const defaultsToNo = (created: Line | undefined): boolean => (created?.data.options as Line[] | undefined)?.find((x) => x.id === created?.data.default)?.decision === 'deny';
/** Your yes to an ask, from your terminal: `deep inbox answer <ask> <its allow option>`. */
export async function answerYes(w: World, ask: string): Promise<string | undefined> {
  const created = askCreated(await events(w), ask);
  const option = allowOf(created);
  if (!option) return `${ask} offers no option whose decision is allow: ${redact(JSON.stringify(created?.data ?? null).slice(0, 600))}`;
  const r = await deep(w, ['inbox', 'answer', ask, option]);
  return r.code === 0 ? undefined : `deep inbox answer ${ask} ${option} didn't answer it: ${redact(shown(r))}`;
}
/**
 * You, in your inbox (README, reading 12): each ask that names the host, offers an allow option, and whose question
 * and plan pass `approve` is answered with it by `deep inbox answer`, once, two seconds after it shows. An ask whose
 * plan holds a root plan the test answers itself (w.skip) is left alone.
 */
function approveHostAsks(w: World, approve: (created: Line, plan: Line | undefined) => boolean): void {
  let pos = 0;
  let busy = false;
  const seen = new Map<string, number>();
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void (async () => {
      const all = await events(w);
      for (const e of all) if (e.kind === 'ask.created' && Number(e.log_pos) > pos && !seen.has(`ask:${String(e.id)}`)) seen.set(`ask:${String(e.id)}`, Date.now());
      pos = Math.max(pos, ...all.map((e) => Number(e.log_pos)));
      for (const [ask, at] of seen) {
        if (at === 0 || Date.now() - at < 2000) continue;
        seen.set(ask, 0);
        const created = askCreated(all, ask);
        const plan = planOf(all, ask);
        const text = `${JSON.stringify(created?.data ?? {})} ${JSON.stringify(plan?.data ?? {})}`;
        const option = allowOf(created);
        if (!created || !option || !text.includes(w.alias) || answerOf(all, ask) || [...w.skip].some((s) => text.includes(s)) || !approve(created, plan)) continue;
        const r = await deep(w, ['inbox', 'answer', ask, option]);
        w.answered.push({ ask, question: String(created?.data.question ?? '').slice(0, 200), option, code: r.code });
      }
    })().catch(() => undefined).finally(() => { busy = false; });
  }, 1000);
  closers.push(async () => clearInterval(timer));
}

// ---- Files on the host.
/** A file in the world's user's home, as that user would write it (the throwaway user's through sudo and chown). */
export async function writeAsYou(w: World, path: string, text: string): Promise<void> {
  const r = w.user
    ? await w.host.sh(`sudo -n sh -c 'cat > "$1" && chown "$2" "$1" && chmod 644 "$1"' sh ${q(path)} ${q(`${w.user.name}:${w.user.group}`)}`, { input: text })
    : await w.host.sh(`umask 022 && cat > ${q(path)}`, { input: text });
  if (r.code !== 0) throw Error(`BLOCKED: writing ${path} on ${w.vm} failed: ${redact(shown(r))}`);
}
/** One byte of a file on the host changed in place, as the user who wrote it could; its SHA-256 after. */
export async function setByte(w: World, path: string, offset: number, byte: string): Promise<string> {
  const sudo = w.user ? 'sudo -n ' : '';
  const out = await w.host.must(`printf %s ${q(byte)} | ${sudo}dd of=${q(path)} bs=1 seek=${offset} conv=notrunc status=none && ${sudo}sha256sum ${q(path)}`);
  return out.trim().split(/\s+/)[0] ?? '';
}
/** A file the harness can read on the host (the test's folder is readable by it); empty when it doesn't exist. */
export async function readHost(w: World, path: string): Promise<string> { return (await w.host.sh(`cat ${q(path)} 2>/dev/null`)).stdout; }
/** The lines root plans wrote to the harness's root-only folder, for one plan's nonce. */
export async function marks(w: World, nonce: string): Promise<string[]> {
  if (!w.user) return [];
  return (await w.host.sh(`sudo -n cat ${q(`${w.user.marks}/ran`)} 2>/dev/null`)).stdout.split('\n').filter((l) => l.startsWith(`dh1945 ${nonce} `));
}
/** Your user's lingering on the host, as logind keeps it: `yes` or `no`. */
export async function lingerOf(w: World): Promise<string> {
  const name = w.user?.name ?? w.host.ssh.user;
  const r = await w.host.sh(`loginctl show-user ${q(name)} -p Linger --value 2>/dev/null || { [ -e /var/lib/systemd/linger/${name} ] && echo yes || echo no; }`);
  return r.stdout.trim().split('\n').at(-1) ?? '';
}
/** Your user's SSH sessions on the host now: logind's sessions of that user whose service is sshd. */
export async function sshSessions(w: World): Promise<string[]> {
  const name = w.user!.name;
  const out = await w.host.must(`for s in $(loginctl list-sessions --no-legend 2>/dev/null | awk -v u=${q(name)} '$3 == u {print $1}'); do printf '%s %s\\n' "$s" "$(loginctl show-session "$s" -p Class -p Service -p State -p Remote --value 2>/dev/null | tr '\\n' ' ')"; done`);
  return out.split('\n').filter((l) => / sshd /.test(` ${l} `));
}

// ---- Remote runs started as you (#1942's run.start with a host).
export const someClaim = (): string => `claim:dh1945${randomBytes(8).toString('hex')}`;
export async function startRemote(w: World, check: string, script: string): Promise<{ run?: string; refused?: string }> {
  const reply = await control(w, 'run.start', { check, claim: someClaim(), commit: COMMIT, argv: ['/bin/sh', '-c', script], cwd: w.folder, host: w.alias }, 600_000);
  if (reply.error) return { refused: redact(JSON.stringify(reply.error).slice(0, 1200)) };
  return typeof reply.result?.run === 'string' ? { run: reply.result.run } : { refused: `run.start answered no run: ${JSON.stringify(reply.result).slice(0, 400)}` };
}

// ---- One Claude Code session (fixtures/agent.mjs), played through the real deep-hook and its own deep mcp.
export class Session {
  readonly id = randomUUID();
  readonly transcript: string;
  /** Everything the agent was handed: each hook's output and each deep mcp reply, unredacted, for AC1's search. */
  readonly received: string[] = [];
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
        const raw = this.buffer.slice(0, i);
        const line = parse(raw);
        this.buffer = this.buffer.slice(i + 1);
        this.received.push(raw);
        if (line && typeof line.n === 'number') { this.pending.get(line.n)?.(line); this.pending.delete(line.n); }
      }
    });
    this.child.on('exit', () => { for (const [n, done] of [...this.pending]) { this.pending.delete(n); done({ n, failed: 'the session\'s agent process exited' }); } });
    closers.push(async () => { try { this.child.kill('SIGTERM'); } catch { /* gone */ } });
  }
  get letters(): string { return this.id.replace(/[^0-9A-Za-z]/g, ''); }
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
      const init = await this.mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-1945', version: '0' } });
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
export const inTerminal = (w: World, args: readonly string[], o: { password?: string; plant?: DeepPlant; timeoutMs?: number } = {}): Promise<Terminal> => terminal(w, [NODE, CLI, ...args], o);
function terminal(w: World, argv: readonly string[], o: { password?: string; plant?: DeepPlant; timeoutMs?: number } = {}): Promise<Terminal> {
  return new Promise((resolve) => {
    const env = childEnv(w.home, { DEEP_HUB_TEST_CONFIRM: w.confirm, TERM: process.env.TERM && process.env.TERM !== 'dumb' ? process.env.TERM : 'xterm', ...(o.plant ? { DEEP_HUB_PLANT: o.plant } : {}) });
    const child = spawn('/bin/bash', ['-c', 'exec /usr/bin/script -q /dev/null "$@" < <(exec cat 2>/dev/null)', 'bash', ...argv], { cwd: w.tmp, env, stdio: ['pipe', 'pipe', 'pipe'] });
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
      if (o.password !== undefined && typed < 2) { typed++; child.stdin!.write(`${o.password}\n`); }
    };
    child.stdout!.setEncoding('utf8').on('data', (d: string) => { raw += d; look(); });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { raw += d; look(); });
    child.stdin!.on('error', () => undefined);
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000).unref(); }, o.timeoutMs ?? 300_000);
    // Once script has exited, its stdin's cat is let go.
    child.on('exit', () => child.stdin!.end());
    child.on('close', (code) => {
      clearTimeout(timer);
      w.outputs.push(`(terminal) ${raw}`);
      resolve({ code, transcript: plain(raw), prompts, typed, timedOut });
    });
  });
}

// ---- Root plans (README, readings 1 to 6).
export interface Step { does: string; changes: string[]; undo: string | null; package: string | null }
/**
 * The agent proposes a root plan: deep_root_plan {host, script, steps} through its own deep mcp. Returns the ask's
 * handle, or what the hub said instead.
 */
export async function proposeRootPlan(w: World, s: Session, script: string, steps: Step[]): Promise<{ ask?: string; said: string }> {
  const r = await s.tool('deep_root_plan', { host: w.alias, script, steps });
  const said = redact(r.text.slice(0, 1500));
  if (r.isError) return { said: `deep_root_plan was refused: ${said}` };
  const ask = r.value.ask;
  return typeof ask === 'string' && /^ask:[0-9A-Za-z]+$/.test(ask) ? { ask, said } : { said: `deep_root_plan answered no ask: ${said}` };
}
/**
 * A root plan's script (README, reading 5): it notes as root, in the harness's root-only folder, which variant ran, as
 * whom, from which file and what owns each folder above it, then prints one line and exits 0. `V=<letter>` is the one
 * byte a test changes.
 */
export function planScript(marksDir: string, nonce: string, letter: string): string {
  return [
    '#!/bin/sh',
    `# A #1945 acceptance test's root plan: it notes where it runs from and as whom in ${marksDir}/ran, then says one line.`,
    `V=${letter}`,
    `M=${marksDir}`,
    `N=${nonce}`,
    'case "$0" in */*) self=$(readlink -f -- "$0") ;; *) self=$(readlink -f /proc/$$/fd/0 2>/dev/null || echo unknown) ;; esac',
    '{',
    '  printf \'dh1945 %s variant %s uid %s\\n\' "$N" "$V" "$(id -u)"',
    '  printf \'dh1945 %s file %s %s\\n\' "$N" "$(stat -c \'%u %g %a\' -- "$self" 2>/dev/null || echo \'? ? ?\')" "$self"',
    '  d=$(dirname -- "$self")',
    '  while :; do printf \'dh1945 %s dir %s %s\\n\' "$N" "$(stat -c \'%u %g %a\' -- "$d" 2>/dev/null || echo \'? ? ?\')" "$d"; if [ "$d" = / ] || [ "$d" = . ]; then break; fi; d=$(dirname -- "$d"); done',
    '} >> "$M/ran" 2>/dev/null || echo "dh1945 $N could not write $M/ran" >&2',
    'printf \'dh1945 %s %s uid %s\\n\' "$N" "$V" "$(id -u)"',
    'exit 0',
    '',
  ].join('\n');
}
/** Hex runs of 12 or more characters in a text: the hashes it names, whole or by a prefix. */
const hexRuns = (text: string): string[] => text.match(/[0-9a-f]{12,64}/gi)?.map((h) => h.toLowerCase()) ?? [];
const names = (text: string, hash: string): boolean => hexRuns(text).some((h) => hash.startsWith(h));
/** Whether a folder's mode lets someone other than root write it: by others, or by a group other than root's. */
const othersWrite = (gid: string, mode: number): boolean => (mode & 0o002) !== 0 || ((mode & 0o020) !== 0 && gid !== '0');

/**
 * AC2's judge (README, How AC2 is read): the agent writes a root plan's script on the host and proposes it; you approve
 * it; one byte of the script is changed where the agent wrote it, and `deep host run <ask>` (in a terminal, your sudo
 * password typed at its prompt) must refuse it before anything runs as root, naming both hashes; then the byte is put
 * back and `deep host run <ask>` again must run it from a copy in a folder only root can write, and the record must hold
 * the run with its exit code and its output as evidence.
 */
export async function judgeLocked(w: World, s: Session, letter: 'A' | 'C', plant?: DeepPlant): Promise<{ failures: string[]; seen: Line }> {
  const failures: string[] = [];
  const seen: Line = {};
  const u = w.user!;
  const nonce = randomBytes(6).toString('hex');
  const changed = String.fromCharCode(letter.charCodeAt(0) + 1);
  const text = planScript(u.marks, nonce, letter);
  const path = `${w.folder}/plan-${nonce}.sh`;
  const offset = text.indexOf(`\nV=${letter}\n`) + 3;
  const locked = sha256(text);
  const found = sha256(text.slice(0, offset) + changed + text.slice(offset + 1));
  const output = `dh1945 ${nonce} ${letter} uid 0\n`;
  Object.assign(seen, { script: path, locked, found, expected_output: output, expected_output_sha256: sha256(output) });
  await writeAsYou(w, path, text);
  w.skip.add(nonce).add(locked);
  const steps: Step[] = [{ does: `Note where this script runs from, and as whom, in ${u.marks}/ran`, changes: [`${u.marks}/ran`], undo: `Remove the lines it added to ${u.marks}/ran`, package: null }];
  const proposed = await proposeRootPlan(w, s, path, steps);
  seen.proposed = proposed.said;
  if (!proposed.ask) return { failures: [`the agent's root plan for ${w.alias} wasn't raised: ${proposed.said}`], seen };
  const ask = proposed.ask;
  seen.ask = ask;
  const created = await awaitEvent(w, (all) => (planOf(all, ask) ? askCreated(all, ask) : undefined), 60_000);
  const plan = planOf(await events(w), ask);
  seen.plan = plan?.data;
  if (!created || !plan) return { failures: [`${ask}, the root plan for ${w.alias}, has no ask with the core's plan in the record`], seen };
  if (created.data.kind !== 'authority') failures.push(`${ask}, the root plan, is a ${String(created.data.kind)} ask, not an authority ask`);
  if (!defaultsToNo(created)) failures.push(`${ask}, the root plan, doesn't default to no: its default ${String(created.data.default)} isn't an option that says no`);
  const planText = JSON.stringify(plan.data);
  if (!planText.includes(locked) && !planText.includes(JSON.stringify(text).slice(1, -1))) failures.push(`${ask}'s plan doesn't lock the script: it holds neither the script's SHA-256 ${locked} nor its text`);
  const no = await answerYes(w, ask);
  if (no) return { failures: [...failures, no], seen };

  // One byte changed where the agent wrote the script, after your yes.
  const now = await setByte(w, path, offset, changed);
  if (now !== found) return { failures: [...failures, `BLOCKED: the harness's one-byte change left ${path} with SHA-256 ${now}, not ${found}`], seen };
  const first = await inTerminal(w, ['host', 'run', ask], { password: u.password, ...(plant ? { plant } : {}) });
  const afterFirst = await marks(w, nonce);
  seen.changed_run = { code: first.code, prompts: first.prompts, typed: first.typed, timed_out: first.timedOut, said: redact(first.transcript.slice(-3000)), marks: afterFirst };
  const ranChanged = afterFirst.filter((l) => l.includes(` variant ${changed} `));
  const ranAny = afterFirst.filter((l) => / variant /.test(l));
  if (ranChanged.length) {
    const from = afterFirst.find((l) => / file /.test(l))?.replace(/^dh1945 \S+ file \S+ \S+ \S+ /, '') ?? 'unknown';
    failures.push(`\`deep host run ${ask}\` ran the changed script (variant ${changed}, SHA-256 ${found.slice(0, 12)}) as root on ${w.alias} from ${from}, where the agent wrote it: it ran bytes the plan never locked (${locked.slice(0, 12)})`);
  } else if (ranAny.length) failures.push(`\`deep host run ${ask}\` ran the plan as root on ${w.alias} although its script had changed where the agent wrote it (${found.slice(0, 12)} for ${locked.slice(0, 12)}): it must refuse`);
  if (first.code === 0) failures.push(`\`deep host run ${ask}\` exited 0 on a script changed by one byte: it must refuse it`);
  const missing = [names(first.transcript, locked) ? '' : `the hash the plan locked (${locked})`, names(first.transcript, found) ? '' : `the one it found (${found})`].filter(Boolean);
  if (missing.length) failures.push(`\`deep host run ${ask}\` on the changed script didn't name ${missing.join(' or ')}: it said ${JSON.stringify(redact(first.transcript.slice(-1200)))}`);

  // The byte put back: the unchanged script runs as root from a copy only root can write.
  const back = await setByte(w, path, offset, letter);
  if (back !== locked) return { failures: [...failures, `BLOCKED: putting the byte back left ${path} with SHA-256 ${back}, not ${locked}`], seen };
  // A run of this ask the record holds from here on is this attempt's (the refused one may have been recorded too).
  const from = Math.max(0, ...(await events(w)).map((e) => Number(e.log_pos)));
  const second = await inTerminal(w, ['host', 'run', ask], { password: u.password, ...(plant ? { plant } : {}) });
  const afterSecond = (await marks(w, nonce)).filter((l) => !afterFirst.includes(l));
  seen.unchanged_run = { code: second.code, prompts: second.prompts, typed: second.typed, timed_out: second.timedOut, said: redact(second.transcript.slice(-3000)), marks: afterSecond };
  const variant = afterSecond.find((l) => / variant /.test(l));
  if (!variant) failures.push(`the unchanged script never ran as root on ${w.alias}: \`deep host run ${ask}\` ended ${second.code} (${second.prompts} sudo prompts) and said ${JSON.stringify(redact(second.transcript.slice(-1200)))}`);
  else {
    if (!variant.endsWith(`variant ${letter} uid 0`)) failures.push(`the unchanged script ran on ${w.alias}, but not as root: ${variant}`);
    const file = /^dh1945 \S+ file (\S+) (\S+) (\S+) (.*)$/.exec(afterSecond.find((l) => / file /.test(l)) ?? '');
    const dirs = afterSecond.map((l) => /^dh1945 \S+ dir (\S+) (\S+) (\S+) (.*)$/.exec(l)).filter((m): m is RegExpExecArray => !!m);
    const self = file?.[4] ?? 'unknown';
    seen.copy = { file: self, dirs: dirs.map((m) => `${m[1]} ${m[2]} ${m[3]} ${m[4]}`) };
    if (!file || !self.startsWith('/') || self.startsWith('/dev/') || self.startsWith('/proc/')) failures.push(`the unchanged script didn't run from a file on ${w.alias} (it found itself at ${self}): it must run from a copy in a folder only root can write`);
    else if (self === path) failures.push(`the unchanged script ran from ${path}, where the agent wrote it, not from a copy in a folder only root can write`);
    else {
      if (file[1] !== '0' || othersWrite(file[2]!, parseInt(file[3]!, 8))) failures.push(`the copy ${self} that ran isn't one only root can write: owner ${file[1]}, group ${file[2]}, mode ${file[3]}`);
      const [folder, ...parents] = dirs;
      if (!folder || folder[1] !== '0' || othersWrite(folder[2]!, parseInt(folder[3]!, 8))) failures.push(`the folder holding the copy that ran (${folder?.[4] ?? 'unknown'}) isn't one only root can write: owner ${folder?.[1]}, group ${folder?.[2]}, mode ${folder?.[3]}`);
      for (const p of parents) {
        const mode = parseInt(p[3]!, 8);
        if (p[1] !== '0' || (othersWrite(p[2]!, mode) && (mode & 0o1000) === 0)) failures.push(`a folder above the copy that ran, ${p[4]}, lets someone other than root replace what's in it: owner ${p[1]}, group ${p[2]}, mode ${p[3]}`);
      }
    }
  }
  // Its output and exit code recorded as the run's evidence (README, reading 6).
  const started = await awaitEvent(w, (all) => all.find((e) => e.kind === 'run.started' && e.data.ask === ask && Number(e.log_pos) > from), variant ? 120_000 : 5000);
  const finished = started ? await awaitEvent(w, (all) => all.find((e) => e.kind === 'run.finished' && e.data.run === started.data.run), 120_000) : undefined;
  seen.recorded = { started: started?.data, finished: finished?.data };
  if (!started) failures.push(`the record holds no run of ${ask}'s root plan from its unchanged script (no run.started naming ask ${ask} after it began)`);
  else if (started.data.host !== w.alias) failures.push(`the record's run of ${ask} names host ${JSON.stringify(started.data.host)}, not ${w.alias}`);
  if (started && !finished) failures.push(`the record holds no end for ${String(started.data.run)}, the run of ${ask}'s root plan`);
  if (finished) {
    if (finished.data.exit !== 0) failures.push(`the record keeps no exit code 0 for the run of ${ask}, whose script exited 0: its run.finished has exit ${JSON.stringify(finished.data.exit)}`);
    if (finished.data.outcome !== 'passed') failures.push(`the run of ${ask} exited 0 but the record has it ${JSON.stringify(finished.data.outcome)}`);
    if (!(finished.data.evidence as string[] | undefined)?.includes(sha256(output))) failures.push(`the run of ${ask}'s evidence isn't its output: none of ${JSON.stringify(finished.data.evidence)} is the SHA-256 ${sha256(output).slice(0, 12)} of the line it printed (${JSON.stringify(output)})`);
  }
  return { failures, seen };
}

// ---- AC1's search (README, How AC1 is read).
/** Every way the password could be written that this search looks for, by name: plain, hex, URL-encoded, base64 at each of three alignments. */
export function passwordForms(pw: string): Record<string, string> {
  const bytes = Buffer.from(pw, 'utf8');
  const forms: Record<string, string> = { plain: pw, hex: bytes.toString('hex'), HEX: bytes.toString('hex').toUpperCase(), url: encodeURIComponent(pw), json: JSON.stringify(pw).slice(1, -1) };
  for (let k = 0; k < 3; k++) {
    const b64 = Buffer.concat([Buffer.alloc(k, 0x41), bytes]).toString('base64');
    const pure = b64.slice(k ? 4 : 0, 4 * Math.floor((k + bytes.length) / 3));
    forms[`base64@${k}`] = pure;
    forms[`base64url@${k}`] = pure.replace(/\+/g, '-').replace(/\//g, '_');
  }
  return forms;
}
/** Which of `needles` (by name) occur in `hay`. */
export const holds = (hay: string | Buffer, needles: Record<string, string>): string[] => Object.entries(needles).filter(([, v]) => v && hay.includes(v)).map(([k]) => k);
/** Every regular file under `dir`, read (a .zst or .gz one also unpacked), with its path. */
export function filesUnder(dir: string): { path: string; bytes: Buffer }[] {
  const out: { path: string; bytes: Buffer }[] = [];
  const walk = (d: string) => {
    let names: string[];
    try { names = readdirSync(d); } catch { return; }
    for (const name of names) {
      const p = join(d, name);
      let st;
      try { st = lstatSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && st.size < 256_000_000) {
        let bytes: Buffer;
        try { bytes = readFileSync(p); } catch { continue; }
        out.push({ path: p, bytes });
        try { if (name.endsWith('.zst')) out.push({ path: `${p} (unpacked)`, bytes: zstdDecompressSync(bytes) }); } catch { /* not zstd */ }
        try { if (name.endsWith('.gz')) out.push({ path: `${p} (unpacked)`, bytes: gunzipSync(bytes) }); } catch { /* not gzip */ }
      }
    }
  };
  walk(dir);
  return out;
}
/**
 * The host's side of the search, as root: every file written since the test user was made (under the folders that
 * hold files, each its own filesystem's), and the journal since then, held against each set of needles in turn. The
 * needles go in a root-only file of the harness's (left out of the search) on the session's stdin, never an argument.
 */
export async function searchHost(w: World, sets: Record<string, Record<string, string>>): Promise<Record<string, { files: string[]; journal: number }>> {
  const u = w.user!;
  const out: Record<string, { files: string[]; journal: number }> = {};
  for (const [set, needles] of Object.entries(sets)) {
    const P = `${u.marks}/needles`;
    const script = [
      `M=${u.marks}; P=${P}`,
      `printf '%s\\n' ${Object.values(needles).map(q).join(' ')} > "$P"`,
      'for r in / /home /var /root /etc /tmp /var/tmp /run /dev/shm /opt /srv /usr/local; do [ -d "$r" ] && find "$r" -xdev -type f -newer "$M/stamp" -size -64M ! -path "$P" -print0 2>/dev/null; done | sort -zu | xargs -0r grep -lF -f "$P" -- 2>/dev/null | sed \'s/^/file /\'',
      `printf 'journal %s\\n' "$(journalctl --since @${u.since} -o export --no-pager 2>/dev/null | grep -acF -f "$P")"`,
      'rm -f "$P"',
    ].join('\n');
    const r = await w.host.root(script, 600_000);
    const lines = r.stdout.split('\n');
    out[set] = { files: lines.filter((l) => l.startsWith('file ')).map((l) => l.slice(5)), journal: Number(lines.find((l) => l.startsWith('journal '))?.slice(8) ?? 'NaN') };
  }
  return out;
}

/**
 * AC1's judge (README, How AC1 is read): a root plan run with your sudo password typed at its prompt, then the agent's
 * and the channel's chances to receive anything, then every place the criterion names searched for the password in
 * every form `passwordForms` lists. A control value each place must hold first proves the search reaches it.
 */
export async function judgePassword(w: World, s: Session): Promise<{ failures: string[]; seen: Line }> {
  const failures: string[] = [];
  const seen: Line = {};
  const u = w.user!;
  const nonce = randomBytes(6).toString('hex');
  const text = planScript(u.marks, nonce, 'E');
  const path = `${w.folder}/plan-${nonce}.sh`;
  await writeAsYou(w, path, text);
  w.skip.add(nonce).add(sha256(text));
  const proposed = await proposeRootPlan(w, s, path, [{ does: `Note where this script runs from, and as whom, in ${u.marks}/ran`, changes: [`${u.marks}/ran`], undo: `Remove the lines it added to ${u.marks}/ran`, package: null }]);
  seen.proposed = proposed.said;
  if (!proposed.ask) return { failures: [`the agent's root plan for ${w.alias} wasn't raised, so no sudo prompt came to type the password at: ${proposed.said}`], seen };
  const ask = proposed.ask;
  seen.ask = ask;
  const id = ask.slice(4);
  await awaitEvent(w, (all) => planOf(all, ask), 60_000);
  // The channel carries the open ask before you answer it, so its search has something to hold.
  for (const deadline = Date.now() + 120_000; !w.provider?.got.some((g) => g.includes(id)) && Date.now() < deadline;) await sleep(500);
  const no = await answerYes(w, ask);
  if (no) return { failures: [no], seen };
  const t = await inTerminal(w, ['host', 'run', ask], { password: u.password });
  const ran = await marks(w, nonce);
  seen.terminal = { code: t.code, prompts: t.prompts, typed: t.typed, timed_out: t.timedOut, said: redact(t.transcript.slice(-2000)) };
  seen.ran = ran;
  if (!t.typed || !ran.some((l) => l.endsWith('variant E uid 0'))) return { failures: [`BLOCKED: the password was never used: \`deep host run ${ask}\` showed ${t.prompts} sudo prompts, the password was typed ${t.typed} times, and the plan ${ran.length ? 'ran, but not as root' : "didn't run"} (exit ${t.code}): ${JSON.stringify(redact(t.transcript.slice(-1200)))}`], seen };
  // The agent's and the channel's chances to be handed anything: its tools, a prompt, and the channel's next passes.
  for (const [tool, args] of [['deep_status', {}], ['deep_wait', { ask }]] as const) await s.tool(tool, args).catch(() => undefined);
  await s.hook('UserPromptSubmit', { prompt: 'Go on.' }).catch(() => undefined);
  await sleep(15_000);

  const forms = passwordForms(u.password);
  const control = `dh1945-control-${randomBytes(6).toString('hex')}`;
  await w.host.must(`logger -t dh1945 ${q(control)}`);
  await sleep(2000);
  const where: Line = {};
  const leak = (place: string, found: string[]) => { if (found.length) failures.push(`the sudo password reached ${place}, written as ${found.join(', ')}`); };
  // The record: every event as events.read gives it, and every file of the hub's (~/.deepbuild: its ledger, evidence, logs).
  const record = JSON.stringify(await events(w));
  const hubFiles = filesUnder(w.hub.root);
  where.record = { events: record.length, files: hubFiles.length, control: record.includes(ask) && hubFiles.some((f) => f.bytes.includes(id)) };
  if (!where.record.control) failures.push(`BLOCKED: the search of the record can't be trusted: ${ask} isn't in what events.read gives and the hub's files`);
  leak('the record (events.read)', holds(record, forms));
  for (const f of hubFiles) leak(`the hub's file ${redact(f.path.replace(w.tmp, '<world>'))}`, holds(f.bytes, forms));
  // A log: the hub's own output, every deep command's output, every other file of the world, and on the host every file
  // written since the user was made and the journal since then.
  const others = filesUnder(w.tmp).filter((f) => !f.path.startsWith(w.hub.root));
  leak("the hub's output", holds(w.hub.output.join(''), forms));
  for (const out of w.outputs.filter((o) => !o.startsWith('(terminal) '))) leak('a deep command\'s output', holds(out, forms));
  for (const f of others) leak(`the file ${redact(f.path.replace(w.tmp, '<world>'))}`, holds(f.bytes, forms));
  const host = await searchHost(w, { password: forms, control: { nonce, control } });
  where.host = host;
  if (!host.control?.files.some((f) => f === `${u.marks}/ran`) || !(host.control.journal > 0)) failures.push(`BLOCKED: the host's search can't be trusted: it didn't find the run's note in ${u.marks}/ran (${JSON.stringify(host.control?.files ?? [])}) and the line logged to the journal (${host.control?.journal})`);
  for (const f of host.password?.files ?? []) failures.push(`the sudo password reached the file ${f} on ${w.alias}`);
  if (host.password && host.password.journal !== 0) failures.push(`the sudo password reached ${w.alias}'s journal (${host.password.journal} lines)`);
  // An agent: everything the session was handed.
  const agent = s.received.join('\n');
  where.agent = { replies: s.received.length, control: agent.includes(ask) };
  if (!where.agent.control) failures.push(`BLOCKED: the agent's search can't be trusted: what the agent was handed doesn't hold ${ask}, which deep_root_plan answered`);
  leak('the agent', holds(agent, forms));
  // A channel: every request the chat channel made of its provider.
  const channel = w.provider?.got.join('\n') ?? '';
  where.channel = { requests: w.provider?.got.length ?? 0, control: channel.includes(id) };
  if (!where.channel.control) failures.push(`BLOCKED: the channel's search can't be trusted: no request the chat channel made holds ${ask}`);
  leak('the chat channel', holds(channel, forms));
  // Not a place the criterion names: your own terminal, where you typed it (kept for the proof).
  seen.terminal_holds = holds(w.outputs.filter((o) => o.startsWith('(terminal) ')).join(''), forms);
  seen.where = where;
  return { failures, seen };
}

// ---- AC3 (README, How AC3 is read).
const FIRST_RUN = (folder: string): string => [
  'umask 022',
  `printf '%s %s linger=%s\\n' "\${DEEP_RUN_TOKEN:-none}" "$(tail -n 1 /proc/self/cgroup)" "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || echo no)" >> ${q(`${folder}/first.starts`)}`,
  `i=0; while [ $i -lt 900 ]; do date +%s >> ${q(`${folder}/beats`)}; echo "beat $i"; i=$((i + 1)); sleep 1; done`,
].join('\n');
/** The record's host change that turned lingering on for the host: host.changed naming enable-linger, its undo disable-linger. */
export const lingerChange = (all: Line[], alias: string): Line | undefined => all.find((e) => e.kind === 'host.changed' && e.data.host === alias
  && JSON.stringify({ ...e.data, undo: null }).includes('enable-linger') && typeof e.data.undo === 'string' && e.data.undo.includes('disable-linger'));
/** Whether `deep host changes <host>`'s output shows enable-linger with disable-linger on its line or the three after. */
export const showsLinger = (out: string): boolean => {
  const lines = out.split('\n');
  return lines.some((l, i) => l.includes('enable-linger') && lines.slice(i, i + 4).some((m) => m.includes('disable-linger')));
};
const WINDOW_S = 60;
/**
 * AC3's judge for a host whose policy lets you turn lingering on (README, How AC3 is read): the first remote run on a
 * host where your user's lingering is off must find it on as it starts, the record must hold that host change with its
 * undo and `deep host changes` show it, and with every SSH session of your user to the host closed for 60 s the run
 * must keep going. Every failure names the host.
 */
export async function judgeLinger(w: World): Promise<{ failures: string[]; seen: Line }> {
  const failures: string[] = [];
  const seen: Line = {};
  const before = await lingerOf(w);
  seen.linger_before = before;
  if (before !== 'no') return { failures: [`BLOCKED: lingering for the test user on ${w.alias} is ${JSON.stringify(before)} before the first run, not off`], seen };
  const started = await startRemote(w, 'first-remote-run', FIRST_RUN(w.folder));
  seen.run = started;
  if (!started.run) return { failures: [`the first remote run on ${w.alias} was refused: ${started.refused}`], seen };
  const run = started.run;
  let line = '';
  for (const deadline = Date.now() + 300_000; !line && Date.now() < deadline; await sleep(1000)) line = (await readHost(w, `${w.folder}/first.starts`)).split('\n')[0] ?? '';
  const all = await events(w);
  seen.started = all.find((e) => e.kind === 'run.started' && e.data.run === run)?.data;
  if (!line) return { failures: [`${run}, the first remote run on ${w.alias}, never started there (nothing in first.starts in 5 minutes; the record says it started on ${JSON.stringify(seen.started?.host)})`], seen };
  const [, unit = '', linger = ''] = /^\S+ (\S+) linger=(\S+)/.exec(line) ?? [];
  const cgroup = unit.replace(/^\d*::/, '');
  seen.first_line = line.replace(/^\S+/, (t) => `${t.slice(0, 8)}…`);
  if (linger !== 'yes') failures.push(`the first remote run on ${w.alias}, ${run}, started with lingering ${linger || 'unknown'} for your user there: lingering wasn't turned on before it started`);
  const change = lingerChange(all, w.alias);
  seen.change = change?.data;
  if (!change) failures.push(`the record holds no host change on ${w.alias} turning lingering on (host.changed naming enable-linger, its undo naming disable-linger): ${JSON.stringify(all.filter((e) => e.kind === 'host.changed').map((e) => e.data)).slice(0, 600)}`);
  const changes = await deep(w, ['host', 'changes', w.alias]);
  seen.deep_host_changes = { code: changes.code, out: redact(`${changes.stdout}${changes.stderr}`.slice(-2000)) };
  if (changes.code !== 0 || !showsLinger(changes.stdout)) failures.push(`\`deep host changes ${w.alias}\` doesn't show lingering turned on with its undo (enable-linger, undo disable-linger): ${redact(shown(changes))}`);

  // Every SSH session of your user to the host closed, and none opened, for 60 s.
  const cut = w.relay.refuse(true);
  let open = await sshSessions(w);
  for (const deadline = Date.now() + 120_000; open.length && Date.now() < deadline; await sleep(2000)) open = await sshSessions(w);
  seen.closed = { connections_cut: cut, still_open: open };
  if (open.length) {
    failures.push(`a session of your user on ${w.alias} stays open 2 minutes after every connection to it was cut (${open.join('; ')}), so the run's life can't be told apart from it`);
    w.relay.refuse(false);
    return { failures, seen };
  }
  const t0 = await w.host.now();
  const during: string[] = [];
  for (let i = 0; i < WINDOW_S / 5; i++) { await sleep(5000); during.push(...await sshSessions(w)); }
  const t1 = await w.host.now();
  const beats = (await readHost(w, `${w.folder}/beats`)).split('\n').map(Number).filter((n) => n > 0);
  const inWindow = beats.filter((b) => b >= t0 && b <= t1);
  const gaps = [t0, ...inWindow, t1].map((b, i, a) => (i ? b - a[i - 1]! : 0));
  const manager = (await w.host.sh(`systemctl show user@${w.user!.uid}.service -p ActiveState --value`)).stdout.trim();
  const procs = cgroup ? (await w.host.sh(`cat ${q(`/sys/fs/cgroup${cgroup}/cgroup.procs`)} 2>/dev/null | wc -l`)).stdout.trim() : '0';
  seen.window = { from: t0, to: t1, beats: inWindow.length, longest_gap_s: Math.max(...gaps), last_beat_s_before_end: t1 - (beats.at(-1) ?? 0), user_manager: manager, run_processes: Number(procs), sessions_during: during, connections_refused: w.relay.conns.filter((c) => c.opened >= t0 * 1000 - 5000).length };
  w.relay.refuse(false);
  if (during.length) failures.push(`an SSH session of your user opened on ${w.alias} while every connection was refused (${during.join('; ')})`);
  const lost = Math.max(...gaps) > 15 || t1 - (beats.at(-1) ?? 0) > 15 || manager !== 'active' || Number(procs) === 0;
  if (lost) failures.push(`${w.alias} lost ${run} when the last SSH session of your user there closed: in ${t1 - t0} s with no session its longest stretch without a beat was ${Math.max(...gaps)} s, its last beat ${t1 - (beats.at(-1) ?? 0)} s before the end, your user manager there is ${manager || 'gone'} and the run's unit holds ${procs} processes`);
  return { failures, seen };
}
/**
 * AC3's judge for a host whose policy needs root for lingering (README, How AC3 is read): the first remote run there
 * must bring lingering as a root plan, an authority ask that defaults to no whose plan turns it on (enable-linger) with
 * its undo (disable-linger); lingering stays off until you run it; once you approve it, `deep host run <ask>` asks for
 * your sudo password at its prompt and, with it typed, turns lingering on for your user there.
 */
export async function judgeRootLinger(w: World): Promise<{ failures: string[]; seen: Line }> {
  const failures: string[] = [];
  const seen: Line = {};
  const before = await lingerOf(w);
  if (before !== 'no') return { failures: [`BLOCKED: lingering for the test user on ${w.alias} is ${JSON.stringify(before)} before the first run, not off`], seen };
  // Not waited for: the run may wait for the root plan you run.
  let started: { run?: string; refused?: string } = {};
  void startRemote(w, 'first-remote-run', FIRST_RUN(w.folder)).catch((error: Error) => ({ refused: error.message })).then((r) => { started = r; seen.run = r; });
  // The asks naming the host whose plan names enable-linger; once one shows, 20 s more for a later one, then the root
  // plan is the newest whose question names root, else the newest (README, reading 8).
  const lingerAsks = (all: Line[]) => all.filter((e) => e.kind === 'ask.created' && JSON.stringify(e.data).includes(w.alias) && JSON.stringify(planOf(all, `ask:${String(e.id)}`)?.data ?? {}).includes('enable-linger'));
  let asks: Line[] = [];
  let firstAt = 0;
  let landedAt = 0;
  for (const deadline = Date.now() + 300_000; Date.now() < deadline && (!firstAt || Date.now() < firstAt + 20_000) && (firstAt || !landedAt || Date.now() < landedAt + 30_000); await sleep(2000)) {
    asks = lingerAsks(await events(w));
    if (!firstAt && asks.length) firstAt = Date.now();
    if (!landedAt && (await readHost(w, `${w.folder}/first.starts`)).trim()) landedAt = Date.now();
  }
  const found = asks.filter((e) => /root/i.test(String(e.data.question))).at(-1) ?? asks.at(-1);
  seen.lingering_asks = asks.map((e) => ({ ask: `ask:${String(e.id)}`, question: e.data.question }));
  const first = (await readHost(w, `${w.folder}/first.starts`)).split('\n')[0] ?? '';
  seen.first_line = first.replace(/^\S+/, (t) => `${t.slice(0, 8)}…`);
  if (!found) return { failures: [`the first remote run on ${w.alias}, whose policy needs root for lingering, brought no root plan to turn it on (no ask whose plan names enable-linger)${first ? `, and the run started there with ${/linger=\S+/.exec(first)?.[0] ?? 'lingering unknown'}` : ''}${started.refused ? `; run.start said ${started.refused}` : ''}`], seen };
  const ask = `ask:${String(found.id)}`;
  const all = await events(w);
  const plan = planOf(all, ask);
  seen.ask = ask;
  seen.question = found.data.question;
  seen.plan = plan?.data;
  if (found.data.kind !== 'authority') failures.push(`${ask}, the plan for lingering on ${w.alias}, is a ${String(found.data.kind)} ask, not an authority ask`);
  if (!defaultsToNo(found)) failures.push(`${ask}, the root plan for lingering on ${w.alias}, doesn't default to no`);
  const steps = (plan?.data.steps ?? []) as Line[];
  if (!steps.some((st) => JSON.stringify({ ...st, undo: null }).includes('enable-linger') && String(st.undo).includes('disable-linger'))) failures.push(`${ask}'s plan has no step turning lingering on (enable-linger) with its undo (disable-linger): ${JSON.stringify(steps).slice(0, 600)}`);
  const still = await lingerOf(w);
  if (still !== 'no') failures.push(`BLOCKED: lingering on ${w.alias} is ${still} before the root plan ran: the host's policy didn't hold`);
  // Your yes, unless the approver gave it already (a root plan whose question doesn't name root).
  const no = answerOf(await events(w), ask) ? undefined : await answerYes(w, ask);
  if (no) return { failures: [...failures, no], seen };
  const t = await inTerminal(w, ['host', 'run', ask], { password: w.user!.password });
  let after = await lingerOf(w);
  for (const deadline = Date.now() + 30_000; after !== 'yes' && Date.now() < deadline; await sleep(2000)) after = await lingerOf(w);
  seen.terminal = { code: t.code, prompts: t.prompts, typed: t.typed, timed_out: t.timedOut, said: redact(t.transcript.slice(-2000)) };
  seen.linger_after = after;
  if (!t.prompts) failures.push(`\`deep host run ${ask}\` never showed a sudo password prompt on ${w.alias}, so the lingering plan didn't come as a root plan: ${JSON.stringify(redact(t.transcript.slice(-1200)))}`);
  if (after !== 'yes') failures.push(`running ${ask}, the root plan for lingering on ${w.alias}, with your sudo password left lingering ${after}: exit ${t.code}, ${JSON.stringify(redact(t.transcript.slice(-1200)))}`);
  return { failures, seen };
}

// ---- AC4 (README, How AC4 is read).
/** A test package built on the host (dpkg-deb), whose postinst writes a file its file list doesn't hold. */
async function buildPackage(w: World): Promise<{ name: string; deb: string; listed: string; unlisted: string }> {
  const name = `dh1945-${w.id}`;
  const root = `${w.folder}/pkg`;
  const deb = `${w.folder}/${name}_1.0_all.deb`;
  const listed = `/usr/share/${name}/listed`;
  const unlisted = `/var/lib/${name}-made/unlisted`;
  const script = [
    'set -eu', 'umask 022',
    `R=${q(root)}`,
    `mkdir -p "$R/DEBIAN" "$R/usr/share/${name}"`,
    `printf 'a file the package lists\\n' > "$R${listed}"`,
    `printf '%s\\n' 'Package: ${name}' 'Version: 1.0' 'Architecture: all' 'Maintainer: DeepBuild acceptance tests <tests@invalid>' 'Description: a #1945 test package whose install script writes a file its file list does not hold' > "$R/DEBIAN/control"`,
    `printf '%s\\n' '#!/bin/sh' 'set -e' 'mkdir -p ${dirname(unlisted)}' 'echo "written by the postinst of ${name}" > ${unlisted}' > "$R/DEBIAN/postinst"`,
    'chmod 755 "$R/DEBIAN/postinst"',
    `dpkg-deb --root-owner-group --build "$R" ${q(deb)} >/dev/null`,
    `echo contents; dpkg-deb -c ${q(deb)}; echo control; dpkg-deb --ctrl-tarfile ${q(deb)} | tar -t`,
  ].join('\n');
  const out = await w.host.must('sh -s', { input: script });
  const [contents = '', control = ''] = out.split('\ncontrol\n');
  if (!contents.includes(`.${listed}`) || contents.includes('unlisted') || !/postinst/.test(control)) throw Error(`BLOCKED: the test package ${name} isn't as the test needs it (its file list must hold ${listed} and not ${unlisted}, its control a postinst): ${redact(out.slice(0, 1500))}`);
  return { name, deb, listed, unlisted };
}
/**
 * AC4's judge: the agent proposes a root plan whose one step installs the test package with `dpkg -i`, naming the
 * package file and an undo (`dpkg --purge`), as an agent would; before your yes, `deep inbox` must show a step, naming
 * the package, that says what its install scripts did can't be undone.
 */
export async function judgePackage(w: World, s: Session): Promise<{ failures: string[]; seen: Line }> {
  const failures: string[] = [];
  const seen: Line = {};
  const pkg = await buildPackage(w);
  seen.package = { name: pkg.name, file: pkg.deb, lists: pkg.listed, postinst_writes: pkg.unlisted };
  const script = `#!/bin/sh\nset -e\ndpkg -i ${q(pkg.deb)}\n`;
  const path = `${w.folder}/install-${pkg.name}.sh`;
  await writeAsYou(w, path, script);
  w.skip.add(path).add(sha256(script)).add(`install-${pkg.name}`);
  const proposed = await proposeRootPlan(w, s, path, [{ does: `Install the package ${pkg.name} from ${pkg.deb} with dpkg -i`, changes: [`the package ${pkg.name}`, pkg.listed], undo: `dpkg --purge ${pkg.name}`, package: pkg.deb }]);
  seen.proposed = proposed.said;
  if (!proposed.ask) return { failures: [`the plan that installs ${pkg.name} on ${w.alias} wasn't raised: ${proposed.said}`], seen };
  const ask = proposed.ask;
  seen.ask = ask;
  await awaitEvent(w, (all) => planOf(all, ask), 120_000);
  const inbox = await deep(w, ['inbox']);
  const all = await events(w);
  seen.plan = planOf(all, ask)?.data;
  if (answerOf(all, ask)) failures.push(`BLOCKED: ${ask} was answered before the test read it`);
  const lines = inbox.stdout.split('\n');
  const at = lines.findIndex((l) => l.trimEnd().endsWith(ask));
  const block = at < 0 ? [] : [lines[at]!, ...lines.slice(at + 1).filter((_, i, rest) => rest.slice(0, i + 1).every((l) => /^\s{2,}/.test(l)))];
  seen.inbox = block.map(redact);
  if (inbox.code !== 0 || at < 0) return { failures: [...failures, `\`deep inbox\` doesn't show ${ask}, the plan that installs ${pkg.name}, before your yes: ${redact(shown(inbox))}`], seen };
  const stepLines = block.filter((l) => /^\s+\d+\.\s/.test(l));
  const says = stepLines.filter((l) => l.includes(`undo: ${CANT_UNDO}`) && INSTALL_SCRIPTS.test(l) && (l.includes(pkg.name) || l.includes(`${pkg.name}_1.0_all.deb`)));
  seen.says = says;
  if (!says.length) failures.push(`the plan that installs ${pkg.name} on ${w.alias} lists the package as fully undoable before your yes: no step it shows says what ${pkg.name}'s install scripts did can't be undone (it shows ${JSON.stringify(stepLines)})`);
  return { failures, seen };
}

// ---- The proof, rewritten each run under $TMPDIR/deep-1945-proof/.
export const PROOF_DIR = join(tmpdir(), 'deep-1945-proof');
export function proof(name: string, value: unknown): void {
  mkdirSync(PROOF_DIR, { recursive: true });
  writeFileSync(join(PROOF_DIR, name), redact(`${JSON.stringify(value, null, 2)}\n`));
}
