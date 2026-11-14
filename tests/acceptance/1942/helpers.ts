// Test-side tools for the #1942 acceptance tests (README): a world of a real hub (`deep hub run`) in a temp home whose
// `~/.ssh/config` names one of this Mac's Lima VMs, reached through a TCP relay of this file's on 127.0.0.1 (so a test
// can count, stall, delay and drop the hub's connections to the host); the hub's socket as the cli role; `deep run
// follow`; `deep inbox answer`; one Claude Code session played through the real deep-hook and its own `deep mcp`
// (fixtures/agent.mjs); the harness's own SSH link to the same VM, straight to its forwarded port, for reading the host
// (its user units, the runs' marker files, its clock); and the judges a criterion's test and its planted hub share.
// No package module is imported; scripts/benchmark.mjs is read for the repo's timing rule.
//
// Safety: every local folder is under /tmp/dh1942-* and removed after its file; HOME is a temp home for every hub,
// deep command, deep mcp and deep-hook, run without DEEP_*, XDG_*, CLAUDE*, CODEX*, billing keys or NODE_OPTIONS
// (SSH_AUTH_SOCK and PATH kept). The only network is 127.0.0.1 and the VMs through their forwarded ports. On a VM this
// file touches only its folder ~/dh1942-<id>/, the processes it started there (by PID) and the user units whose names
// hold a token its runs wrote down or that run in its folder, all removed after the file. Lima's own control socket is
// never used: the harness link has its own ControlPath, and the world's SSH config has none. Every local process is one
// this file started, stopped by its PID. The VM's user name and key paths are never written to a file this suite keeps.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { availableParallelism, homedir, loadavg, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const NODE = process.execPath;
const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));

/** Each criterion's ID: `#1942.` and the first 8 hex of SHA-256 of its checkbox text (scripts/proof-change.mjs). */
export const AC = {
  1: '#1942.4fd41df2 A host that isn\'t in your SSH config is never contacted',
  2: '#1942.dd9b1b61 A model download survives the agent\'s session ending, and the claim waits for it',
  3: '#1942.b3fd8575 Budgets, on the reference Mac in the local preflight, compared with the merge base: a host\'s facts refresh in under 5 s over SSH, and a remote run streams its output with under 500 ms lag',
  4: '#1942.a60bd93f With two remote runs streaming from one host, stalling one run\'s connection for 60 s leaves the other\'s stream within its 500 ms lag, and only the stalled one reconnects; a host link that drops every connection to the host on one stall fails this test, naming the run',
  5: '#1942.be821b2d Dropping the SSH link right after a remote start is sent, the run starts once on the host, read back by its token; a host link that resends on reconnect starts it twice and fails, naming the token',
} as const;

/** The planted wrong programs the criteria name (README, Plants), selected with DEEP_HUB_PLANT. */
export type HubPlant = 'host-link-drops-every-connection' | 'host-link-resends-on-reconnect';
/** The two Lima VMs this Mac runs: real Linux hosts with a user manager, lingering on and no GPU. */
export type Vm = 'deep-ubuntu' | 'deep-fedora';
/** The host's name in the world's SSH config. */
export const aliasOf = (vm: Vm): string => (vm === 'deep-ubuntu' ? 'dh-ubuntu' : 'dh-fedora');
/** Any 40-hex commit for runs started as you; a remote run names no commit of this Mac's. */
export const COMMIT = '1942000000000000000000000000000000000000';
export const LAG_MS = 500;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export const parse = (text: string): Line | undefined => { try { const v: unknown = JSON.parse(text); return typeof v === 'object' && v !== null ? (v as Line) : undefined; } catch { return undefined; } };
/** The 1-minute load average and the core count, for a reading's words. */
export const loadNow = (): number => loadavg()[0]!;
export const CORES = availableParallelism();
export const loaded = (): boolean => loadNow() > CORES;

// ---- Temp folders, local processes and host folders: all gone after the file.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1942-'));
  made.push(dir);
  return dir;
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
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 120_000);

/** A child's environment: HOME the world's, none of this process's DEEP_/XDG_/CLAUDE/CODEX settings or billing keys. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GH_|GITHUB_|GIT_|AI_AGENT)/.test(key) || key === 'NODE_OPTIONS' || key === 'NODE_EXTRA_CA_CERTS') continue;
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
export const shown = (r: Ran) => `exit ${r.code} after ${r.ms.toFixed(0)} ms, stdout ${JSON.stringify(r.stdout.slice(-1200))}, stderr ${JSON.stringify(r.stderr.slice(-1200))}`;
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
interface LimaSsh { vm: Vm; alias: string; port: number; user: string; identityFile: string; knownHosts: string; hostKeyAlias: string; ciphers: string | undefined }
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
  return { vm, alias, port: Number(need('Port')), user: need('User'), identityFile: need('IdentityFile'), knownHosts: need('UserKnownHostsFile'), hostKeyAlias: values.get('HostKeyAlias') ?? alias, ciphers: values.get('Ciphers') };
}
const unquote = (v: string): string => v.replace(/^"(.*)"$/, '$1');
/** One Host block for a VM: Lima's way in (its key, user, known host key) at `port` on 127.0.0.1. */
function hostBlock(name: string, s: LimaSsh, port: number, knownHosts: string, extra: string[] = []): string {
  return [
    `Host ${name}`, '  HostName 127.0.0.1', `  Port ${port}`, `  User ${s.user}`, `  IdentityFile ${s.identityFile}`, '  IdentitiesOnly yes',
    '  PreferredAuthentications publickey', '  BatchMode yes', '  StrictHostKeyChecking yes', `  UserKnownHostsFile ${knownHosts}`,
    `  HostKeyAlias ${s.hostKeyAlias}`, ...(s.ciphers ? [`  Ciphers ${s.ciphers}`] : []), '  Compression no', '  GSSAPIAuthentication no', ...extra, '',
  ].join('\n');
}
/** What the suite writes down instead of the VM's user name and the key's path. */
export function redact(text: string, s?: { user: string; identityFile: string }): string {
  let out = text.split(homedir()).join('~');
  for (const v of [s?.user, s?.identityFile].filter((x): x is string => !!x)) out = out.split(unquote(v)).join('<redacted>');
  return out;
}

// ---- The relay: 127.0.0.1:<port> to a VM's forwarded port, counting, stalling, delaying and dropping connections.
export interface Conn {
  id: number; opened: number; closed: number | undefined;
  /** Bytes from the host to ssh (down) and from ssh to the host (up). */
  down: number; up: number;
  stalled: boolean;
  client: net.Socket; server: net.Socket;
}
export class Relay {
  readonly conns: Conn[] = [];
  /** Added to every chunk from the host while above 0 (README, How AC5 drops the link). */
  delayDownMs = 0;
  private constructor(private readonly server: net.Server, readonly port: number, private readonly target: number | undefined) {}
  /** A relay to `target` on 127.0.0.1; with none, a listener that only counts each connection and closes it. */
  static async open(target?: number): Promise<Relay> {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const relay = new Relay(server, (server.address() as net.AddressInfo).port, target);
    server.on('connection', (client) => relay.accept(client));
    closers.push(() => relay.close());
    return relay;
  }
  private accept(client: net.Socket): void {
    const c: Conn = { id: this.conns.length + 1, opened: Date.now(), closed: undefined, down: 0, up: 0, stalled: false, client, server: client };
    this.conns.push(c);
    if (this.target === undefined) { c.closed = Date.now(); client.destroy(); return; }
    const server = net.connect(this.target, '127.0.0.1');
    c.server = server;
    const held: { to: net.Socket; chunk: Buffer }[] = [];
    const end = () => { if (c.closed === undefined) c.closed = Date.now(); client.destroy(); server.destroy(); };
    const send = (to: net.Socket, chunk: Buffer) => { if (c.stalled) held.push({ to, chunk }); else if (!to.destroyed) to.write(chunk); };
    client.on('data', (chunk: Buffer) => { c.up += chunk.length; send(server, chunk); });
    server.on('data', (chunk: Buffer) => {
      c.down += chunk.length;
      if (this.delayDownMs > 0) setTimeout(() => send(client, chunk), this.delayDownMs);
      else send(client, chunk);
    });
    (c as Conn & { flush: () => void }).flush = () => { for (const h of held.splice(0)) if (!h.to.destroyed) h.to.write(h.chunk); };
    for (const s of [client, server]) { s.on('error', end); s.on('close', end); }
  }
  /** The connections still open. */
  open(): Conn[] { return this.conns.filter((c) => c.closed === undefined); }
  /** Nothing passes either way on this connection until it's released: its sockets stop being read. */
  stall(c: Conn): void { c.stalled = true; c.client.pause(); c.server.pause(); }
  release(c: Conn): void {
    if (c.closed !== undefined) return;
    c.stalled = false;
    (c as Conn & { flush?: () => void }).flush?.();
    c.client.resume();
    c.server.resume();
  }
  /** Every open connection cut at once, as a dropped link cuts them. */
  dropAll(): number {
    const open = this.open();
    for (const c of open) { c.closed = Date.now(); c.client.destroy(); c.server.destroy(); }
    return open.length;
  }
  async close(): Promise<void> {
    this.dropAll();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

// ---- The harness's own link to a VM: straight to its forwarded port, its own ControlPath, a master this file owns.
export class HostSide {
  /** The test's folder on the host, absolute, and its name under the user's home. */
  folder = '';
  name = '';
  private constructor(readonly vm: Vm, readonly ssh: LimaSsh, private readonly config: string, private readonly master: ChildProcess) {}
  /** Opens the harness link to `vm` and makes ~/dh1942-<id>/ there; a VM it can't reach is BLOCKED. */
  static async open(vm: Vm, tmp: string): Promise<HostSide> {
    const s = limaSsh(vm);
    const dir = join(tmp, 's');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const known = join(dir, 'known');
    copyFileSync(unquote(s.knownHosts), known);
    const config = join(dir, 'harness');
    writeFileSync(config, hostBlock('dh1942h', s, s.port, known, ['  ControlMaster no', `  ControlPath ${join(dir, 'c')}`, '  ServerAliveInterval 5', '  ServerAliveCountMax 6']), { mode: 0o600 });
    const master = spawn('ssh', ['-F', config, '-o', 'ControlMaster=yes', '-o', 'ControlPersist=no', '-N', 'dh1942h'], { stdio: ['ignore', 'ignore', 'pipe'] });
    own(master.pid);
    let err = '';
    master.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
    const h = new HostSide(vm, s, config, master);
    // The master is up once its socket answers.
    const deadline = Date.now() + 30_000;
    for (;;) {
      const check = await run('ssh', ['-F', config, '-O', 'check', 'dh1942h'], { timeoutMs: 10_000 });
      if (check.code === 0) break;
      if (master.exitCode !== null || Date.now() > deadline) throw Error(`BLOCKED: the VM ${vm} can't be reached over SSH at its forwarded port: ${redact(err.slice(-600), s)}`);
      await sleep(250);
    }
    const home = (await h.sh('printf %s "$HOME"')).stdout;
    h.name = `dh1942-${basename(tmp).slice('dh1942-'.length)}`;
    h.folder = `${home}/${h.name}`;
    const made = await h.sh(`mkdir -p "$HOME/${h.name}" && echo made`);
    if (!made.stdout.includes('made')) throw Error(`BLOCKED: the VM ${vm} didn't make the test's folder: ${redact(shown(made), s)}`);
    closers.push(() => h.close());
    return h;
  }
  /** One shell command on the host, through the harness link. */
  sh(command: string, o: { input?: string; timeoutMs?: number } = {}): Promise<Ran> {
    return run('ssh', ['-F', this.config, 'dh1942h', command], { ...(o.input !== undefined ? { input: o.input } : {}), timeoutMs: o.timeoutMs ?? 60_000 });
  }
  /** A command that must succeed: its stdout. */
  async must(command: string, o: { input?: string; timeoutMs?: number } = {}): Promise<string> {
    const r = await this.sh(command, o);
    if (r.code !== 0) throw Error(`BLOCKED: on ${this.vm}, \`${command.slice(0, 200)}\` failed: ${redact(shown(r), this.ssh)}`);
    return r.stdout;
  }
  /** The lines of a file in the test's folder; none when it doesn't exist. */
  async lines(file: string): Promise<string[]> {
    return (await this.sh(`cat "${this.folder}/${file}" 2>/dev/null`)).stdout.split('\n').filter((l) => l.trim());
  }
  /**
   * Resolves once a file in the test's folder is non-empty, as the host sees it (a loop on the host, 20 ms a turn,
   * which ends by itself at its timeout or once the folder is gone).
   */
  watch(file: string, timeoutMs = 180_000): { seen: Promise<boolean>; stop(): void } {
    const secs = Math.ceil(timeoutMs / 1000);
    const child = spawn('ssh', ['-F', this.config, 'dh1942h', `timeout ${secs} sh -c 'while [ ! -s "${this.folder}/${file}" ] && [ -d "${this.folder}" ]; do sleep 0.02; done; [ -s "${this.folder}/${file}" ] && echo seen'`], { stdio: ['ignore', 'pipe', 'ignore'] });
    own(child.pid);
    const seen = new Promise<boolean>((resolve) => {
      let out = '';
      child.stdout!.setEncoding('utf8').on('data', (d: string) => { out += d; if (out.includes('seen')) resolve(true); });
      child.on('close', () => resolve(out.includes('seen')));
    });
    return { seen, stop: () => { try { child.kill('SIGTERM'); } catch { /* gone */ } } };
  }
  /**
   * The host's clock less this Mac's, in ms: over one SSH session, the host's `date +%s%N` against the midpoint of
   * each round trip, the sample with the shortest trip kept (its error is under half that trip).
   */
  async offset(): Promise<{ offset: number; rtt: number }> {
    const child = spawn('ssh', ['-F', this.config, 'dh1942h', 'while read x; do date +%s%N; done'], { stdio: ['pipe', 'pipe', 'ignore'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
    let buffer = '';
    const waiting: ((line: string) => void)[] = [];
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); waiting.shift()?.(line); }
    });
    let best: { offset: number; rtt: number } | undefined;
    try {
      for (let i = 0; i < 12; i++) {
        const t0 = Date.now();
        const line = await Promise.race([new Promise<string>((resolve) => { waiting.push(resolve); child.stdin!.write('\n'); }), sleep(10_000).then(() => '')]);
        const t1 = Date.now();
        if (!/^\d+$/.test(line.trim())) throw Error(`BLOCKED: the host's clock couldn't be read over SSH: ${JSON.stringify(line)}`);
        const host = Number(BigInt(line.trim()) / 1_000_000n);
        const sample = { offset: host - (t0 + t1) / 2, rtt: t1 - t0 };
        if (!best || sample.rtt < best.rtt) best = sample;
      }
    } finally {
      child.stdin!.end();
      child.kill('SIGTERM');
    }
    return best!;
  }
  /** The user units whose names hold `token`, with their states, as the host's user manager lists them. */
  async unitsHolding(token: string): Promise<{ unit: string; active: string; sub: string }[]> {
    if (!token) return [];
    const out = await this.must('systemctl --user list-units --all --plain --no-legend --no-pager');
    return out.split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => p[0]?.includes(token)).map((p) => ({ unit: p[0]!, active: p[2] ?? '', sub: p[3] ?? '' }));
  }
  /**
   * The tokens the runs wrote down in `<tag>.starts` (README, The runs): one line per start of the run on the host,
   * `<DEEP_RUN_TOKEN> <its cgroup line>`.
   */
  async starts(tag: string): Promise<{ token: string; cgroup: string }[]> {
    return (await this.lines(`${tag}.starts`)).map((l) => { const [token = '', ...rest] = l.split(' '); return { token, cgroup: rest.join(' ') }; });
  }
  /** Stops the user units this file's runs made, the processes it started there, removes its folder, ends its link. */
  async close(): Promise<void> {
    if (this.master.exitCode === null && this.folder) {
      const f = this.folder;
      await this.sh([
        `F="${f}"`,
        'toks=$(cat "$F"/*.starts 2>/dev/null | awk \'{print $1}\' | grep -v "^none$" | sort -u)',
        'for u in $(systemctl --user list-units --all --plain --no-legend --no-pager | awk \'{print $1}\'); do',
        '  hit=; for t in $toks; do case "$u" in *"$t"*) hit=1;; esac; done',
        '  [ -z "$hit" ] && systemctl --user show -p ExecStart -p WorkingDirectory "$u" 2>/dev/null | grep -qF "$F" && hit=1',
        '  [ -n "$hit" ] && { systemctl --user stop "$u" 2>/dev/null; systemctl --user reset-failed "$u" 2>/dev/null; }',
        'done',
        '[ -f "$F/pids" ] && kill $(cat "$F/pids") 2>/dev/null',
        'rm -rf "$F"',
        'true',
      ].join('\n'), { timeoutMs: 120_000 }).catch(() => undefined);
    }
    try { this.master.kill('SIGTERM'); } catch { /* gone */ }
  }
}

// ---- The hub.
export interface Hub { pid: number; socket: string; root: string; child: ChildProcess; stderr(): string }
async function startHub(home: string, env: Record<string, string | undefined>): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err = (err + d).slice(-8000)));
  const ready = await new Promise<Line | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (out.includes('\n')) { clearTimeout(timer); resolve(parse(out.split('\n')[0]!)); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(undefined); });
  });
  if (ready?.ready !== true) throw Error(`BLOCKED: the hub didn't start (deep hub run${env.DEEP_HUB_PLANT ? ` with DEEP_HUB_PLANT=${env.DEEP_HUB_PLANT}` : ''}): ${out.slice(0, 500)} ${redact(err.slice(-1500))}`);
  return { pid: child.pid!, socket: typeof ready.socket === 'string' ? ready.socket : join(home, '.deepbuild', 'hub.sock'), root: join(home, '.deepbuild'), child, stderr: () => err };
}

// ---- The world.
export interface World {
  tmp: string; home: string; hub: Hub;
  /** The host, its name in the world's SSH config, and the relay its Port points at. */
  host: HostSide; alias: string; relay: Relay;
  /** AC1's: the relay `Host *` points at, which counts every connection made to it. */
  stranger?: Relay;
  /** Asks this suite answered yes to, as you (README, Grants). */
  answered: Line[];
}
export interface WorldOptions {
  plant?: HubPlant;
  /** Adds a `Host *` block whose HostName and Port lead to a counting listener (AC1). */
  catchAll?: boolean;
  /** deep_ask's and deep_run's wait ends at once (MCP_TOOL_TIMEOUT=30000, #964's way). */
  noToolWait?: boolean;
  /** Answer yes, as you, to each ask that names the host (README, Grants). */
  approve?: boolean;
}
/**
 * A temp home whose `~/.ssh/config` names the VM as `dh-ubuntu` or `dh-fedora` (Lima's key, user and host key, at the
 * relay's port), the harness link to the same VM, and a hub run with that home. A VM it can't reach is BLOCKED.
 */
export async function openWorld(vm: Vm, o: WorldOptions = {}): Promise<World> {
  for (const [what, path] of [['the deep CLI (npm run build --workspaces)', CLI], ['deep-hook (cargo build -p deep-hook)', DEEP_HOOK]] as const) {
    if (!existsSync(path)) throw Error(`BLOCKED: ${what} is missing at ${path}`);
  }
  const tmp = tempDir();
  const home = join(tmp, 'h');
  mkdirSync(join(home, '.ssh'), { recursive: true, mode: 0o700 });
  chmodSync(join(home, '.ssh'), 0o700);
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  const host = await HostSide.open(vm, tmp);
  const relay = await Relay.open(host.ssh.port);
  const stranger = o.catchAll ? await Relay.open() : undefined;
  const alias = aliasOf(vm);
  const known = join(home, '.ssh', 'known_hosts_lima');
  copyFileSync(unquote(host.ssh.knownHosts), known);
  writeFileSync(join(home, '.ssh', 'config'), [
    hostBlock(alias, host.ssh, relay.port, known),
    ...(stranger ? [['Host *', '  HostName 127.0.0.1', `  Port ${stranger.port}`, '  BatchMode yes', ''].join('\n')] : []),
  ].join('\n'), { mode: 0o600 });
  const hub = await startHub(home, {
    DEEP_HUB_TEST_CONFIRM: join(tmp, 'confirm'),
    ...(o.plant ? { DEEP_HUB_PLANT: o.plant } : {}),
    ...(o.noToolWait ? { MCP_TOOL_TIMEOUT: '30000' } : {}),
  });
  const w: World = { tmp, home, hub, host, alias, relay, ...(stranger ? { stranger } : {}), answered: [] };
  if (o.approve) approveHostAsks(w);
  closers.push(async () => {
    try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
    const deadline = Date.now() + 20_000;
    while (alive(hub.pid) && Date.now() < deadline) await sleep(100);
    if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  });
  return w;
}

/** One call on the hub's socket as the cli role, with the control token and this process for the peer check: the reply line. */
export async function control(w: World, method: string, params: Line, timeoutMs = 60_000): Promise<Line> {
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
/** Whether a reply is the hub saying it serves no such method. */
export const unknownMethod = (reply: Line): boolean => reply.error?.code === 'unknown_method' || /serves no method|unknown method/i.test(JSON.stringify(reply.error ?? ''));
/** A cli call that must succeed: its result; a method the hub doesn't serve is named as missing. */
export async function must(w: World, method: string, params: Line, timeoutMs = 60_000): Promise<Line> {
  const reply = await control(w, method, params, timeoutMs);
  if (reply.error) throw Error(`${unknownMethod(reply) ? `the hub serves no ${method} (README, the surface): ` : ''}${method} ${JSON.stringify(params).slice(0, 300)} was refused: ${redact(JSON.stringify(reply.error).slice(0, 1500), w.host.ssh)}`);
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
    await sleep(500);
  }
}
export const runStarted = (all: Line[], run: string): Line[] => all.filter((e) => e.kind === 'run.started' && e.data.run === run);
export const runFinished = (all: Line[], run: string): Line | undefined => all.find((e) => e.kind === 'run.finished' && e.data.run === run);

/** `deep <args>` as you, in the world's home. */
export const deep = (w: World, args: readonly string[], timeoutMs = 120_000): Promise<Ran> => run(NODE, [CLI, ...args], { env: childEnv(w.home), cwd: w.tmp, timeoutMs });

/**
 * You, in your inbox: each ask that names the host (its alias) and offers an option whose decision is allow is
 * answered with it by `deep inbox answer`, once, a second after it's raised. No criterion reads these asks.
 */
function approveHostAsks(w: World): void {
  let pos = 0;
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void (async () => {
      for (const e of await events(w, pos)) {
        pos = Math.max(pos, Number(e.log_pos));
        if (e.kind !== 'ask.created') continue;
        const option = (e.data.options as Line[] | undefined)?.find((x) => x.decision === 'allow')?.id;
        if (typeof option !== 'string' || !JSON.stringify(e.data).includes(w.alias)) continue;
        const r = await deep(w, ['inbox', 'answer', `ask:${String(e.id)}`, option]);
        w.answered.push({ ask: `ask:${String(e.id)}`, kind: e.data.kind, option, code: r.code });
      }
    })().catch(() => undefined).finally(() => { busy = false; });
  }, 1000);
  closers.push(async () => clearInterval(timer));
}

// ---- Remote runs started as you, and followed.
/** A claim handle the record doesn't hold, for a run you start (run.start takes one; the core holds its lease then). */
export const someClaim = (): string => `claim:dh1942${randomBytes(8).toString('hex')}`;
/** run.start on the cli role, naming the host: the run's handle. A refusal fails, naming what the hub said. */
export async function startRemote(w: World, check: string, script: string): Promise<string> {
  const result = await must(w, 'run.start', { check, claim: someClaim(), commit: COMMIT, argv: ['/bin/sh', '-c', script], cwd: w.host.folder, host: w.alias }, 120_000);
  if (typeof result.run !== 'string' || !/^run:[0-9A-Za-z]+$/.test(result.run)) throw Error(`run.start on ${w.alias} answered no run handle: ${JSON.stringify(result).slice(0, 600)}`);
  return result.run;
}
/** Fails unless the record says the run started on the world's host (run.started's `host`, design: a run names its host). */
export async function mustBeOnHost(w: World, run: string, timeoutMs = 30_000): Promise<void> {
  const started = await awaitEvent(w, (all) => runStarted(all, run)[0], timeoutMs);
  if (!started) throw Error(`the record has no run.started for ${run}`);
  if (started.data.host !== w.alias) throw Error(`${run} started on ${JSON.stringify(started.data.host)}, not on the host ${w.alias} it names: the hub ran it where it is, not as a remote run`);
}
/** The shell line every test run begins with: one line in `<tag>.starts`, its run token and its cgroup, per start. */
export const STAMP = (folder: string, tag: string): string => `printf '%s %s\\n' "\${DEEP_RUN_TOKEN:-none}" "$(tail -n 1 /proc/self/cgroup)" >> "${folder}/${tag}.starts"`;

/** A line a follower read, with when it arrived here. */
export interface Got { text: string; at: number }
export interface Follower { lines: Got[]; ended: Promise<Ran>; stop(): void }
/** `deep run follow <run>`: the run's output as it comes, each line with the time it reached this process. */
export function follow(w: World, run: string): Follower {
  const t0 = performance.now();
  const child = spawn(NODE, [CLI, 'run', 'follow', run], { cwd: w.tmp, env: childEnv(w.home), stdio: ['ignore', 'pipe', 'pipe'] });
  own(child.pid);
  const lines: Got[] = [];
  let buffer = '';
  let stderr = '';
  child.stdout!.setEncoding('utf8').on('data', (d: string) => {
    const at = Date.now();
    buffer += d;
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) { lines.push({ text: buffer.slice(0, i), at }); buffer = buffer.slice(i + 1); }
  });
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (stderr = (stderr + d).slice(-4000)));
  const ended = new Promise<Ran>((resolve) => child.on('close', (code) => resolve({ code, stdout: lines.slice(-5).map((l) => l.text).join('\n'), stderr, ms: performance.now() - t0 })));
  return { lines, ended, stop: () => { try { child.kill('SIGTERM'); } catch { /* gone */ } } };
}
/** Waits until a follower has read `n` lines that `match`; fails naming how the follower ended when it ends first. */
export async function readLines(f: Follower, n: number, match: RegExp, timeoutMs: number, what: string): Promise<void> {
  let over: Ran | undefined;
  void f.ended.then((r) => { over = r; });
  const deadline = Date.now() + timeoutMs;
  while (f.lines.filter((l) => match.test(l.text)).length < n) {
    if (over && f.lines.filter((l) => match.test(l.text)).length < n) throw Error(`deep run follow for ${what} ended before its output came: ${shown(over)}`);
    if (Date.now() > deadline) throw Error(`deep run follow for ${what} read ${f.lines.length} lines in ${timeoutMs / 1000} s, ${f.lines.filter((l) => match.test(l.text)).length} of them the run's, not ${n}`);
    await sleep(100);
  }
}
/** A stamped line's lag: when it reached this process less when the host wrote it, on this Mac's clock. */
export function lagOf(line: Got, offset: number): { index: number; written: number; lag: number } | undefined {
  const m = /^dh1942 \S+ (\d+) (\d{15,})/.exec(line.text);
  if (!m) return undefined;
  const written = Number(BigInt(m[2]!) / 1_000_000n) - offset;
  return { index: Number(m[1]), written, lag: line.at - written };
}
/**
 * A run's script: `count` lines `dh1942 <tag> <i> <host ns> [<pad>]`, one every `everyMs`, after its stamp; with `pad`,
 * each line carries that many fresh random base64 characters, so no compression shrinks the stream.
 */
export function stampedLines(folder: string, tag: string, count: number, everyMs: number, pad = 0): string {
  const padLine = pad ? `P=$(head -c ${Math.ceil((pad * 3) / 4)} /dev/urandom | base64 -w 0)` : 'P=';
  return [
    STAMP(folder, tag),
    `i=0; while [ $i -lt ${count} ]; do ${padLine}; printf 'dh1942 ${tag} %s %s %s\\n' "$i" "$(date +%s%N)" "$P"; i=$((i + 1)); sleep ${(everyMs / 1000).toFixed(3)}; done`,
  ].join('\n');
}

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
  }
  /** The session's handle as the core writes it: `session:<letters>`. */
  get letters(): string { return this.id.replace(/[^0-9A-Za-z]/g, ''); }
  private send(command: Line): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve) => { this.pending.set(n, resolve); this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`); });
  }
  async hook(event: string, fields: Line = {}): Promise<Line> {
    const body = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', ...fields };
    const r = await this.send({ op: 'hook', args: ['claude-code', event], cwd: this.cwd, input: JSON.stringify(body), timeoutMs: 120_000 });
    if (r.code !== 0) throw Error(`BLOCKED: the ${event} hook (deep-hook) ended ${r.code}: ${String(r.stdout).slice(0, 400)} ${String(r.stderr).slice(0, 400)}`);
    return r;
  }
  start(): Promise<Line> { return this.hook('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' }); }
  private async mcp(method: string, params: Line, notify = false): Promise<Line> {
    const line = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: `${method}#${++this.rpc}`, method, params };
    const r = await this.send({ op: 'mcp', line, timeoutMs: 180_000 });
    if (r.failed) throw Error(`BLOCKED: deep mcp: ${String(r.failed).slice(0, 600)}`);
    own(Number(r.pid));
    return (r.reply ?? {}) as Line;
  }
  /** One deep_* tool call through this session's deep mcp: its result's value (structuredContent or its text's JSON). */
  async tool(name: string, args: Line): Promise<{ isError: boolean; value: Line; text: string }> {
    if (!this.mcpReady) {
      const init = await this.mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-1942', version: '0' } });
      if (!init.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(init).slice(0, 600)}`);
      await this.mcp('notifications/initialized', {}, true);
      this.mcpReady = true;
    }
    // A reply that the hub was unreachable and nothing was recorded is called again, as it says to (deep mcp waits 1 s
    // for the hub's hello, which a loaded Mac can miss).
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
  /** SessionEnd, then the agent's process ends, its deep mcp with it. */
  async end(): Promise<void> {
    await this.hook('SessionEnd', { reason: 'prompt_input_exit' });
    const gone = new Promise<void>((resolve) => this.child.once('exit', () => resolve()));
    this.child.kill('SIGTERM');
    await Promise.race([gone, sleep(10_000)]);
    if (this.child.exitCode === null && this.child.signalCode === null) { this.child.kill('SIGKILL'); await gone; }
  }
}

// ---- The repo's timing rule (scripts/benchmark.mjs), for AC3's numbers.
interface Benchmark {
  validateBudgets(current: unknown, base: unknown): void;
  fingerprint(): Record<string, unknown>;
  judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: { start: number; end: number }[] }): { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string };
}
export const benchmark = () => import(join(REPO, 'scripts/benchmark.mjs')) as Promise<Benchmark>;

// ---- The proof, rewritten each run under $TMPDIR/deep-1942-proof/.
export const PROOF_DIR = join(tmpdir(), 'deep-1942-proof');
export function proof(w: World | undefined, name: string, value: unknown): void {
  mkdirSync(PROOF_DIR, { recursive: true });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(join(PROOF_DIR, name), w ? redact(text, w.host.ssh) : redact(text));
}

// ---- Judges: each returns its failures in words; none is a pass.

/**
 * AC4's judge (README, How AC4 stalls a run's connection): two runs on the host, A writing a 4 KB line and B a 400-byte
 * line (fresh random characters) every 100 ms, each followed with `deep run follow`. A's connection is the relay
 * connection carrying the most bytes from the host over 3 s (at least 10 KB/s), B's the next (each must carry its own:
 * B's at least 1.5 KB/s, under a third of A's). A's connection is stalled for 60 s, both ways, then released. B's connection must stay open through the stall, and
 * each of B's lines written during it must reach its follower within 500 ms; A must come back on a new connection
 * before the stall ends. Every failure names the run it is about.
 */
export async function judgeStall(w: World): Promise<{ failures: string[]; lagOnly: boolean; seen: Line }> {
  const failures: string[] = [];
  const seen: Line = {};
  const f = w.host.folder;
  const A = await startRemote(w, 'stall-a', stampedLines(f, 'A', 1300, 100, 4000));
  const B = await startRemote(w, 'stall-b', stampedLines(f, 'B', 1300, 100, 400));
  seen.runs = { A, B };
  await mustBeOnHost(w, A);
  await mustBeOnHost(w, B);
  const fa = follow(w, A);
  const fb = follow(w, B);
  try {
    await readLines(fa, 20, /^dh1942 A /, 90_000, `${A} (A)`);
    await readLines(fb, 20, /^dh1942 B /, 90_000, `${B} (B)`);
    const before = await w.host.offset();
    await sleep(3000);
    const t1 = new Map(w.relay.open().map((c) => [c.id, c.down]));
    await sleep(3000);
    const rates = w.relay.open().map((c) => ({ c, rate: (c.down - (t1.get(c.id) ?? c.down)) / 3 })).sort((x, y) => y.rate - x.rate);
    seen.rates = rates.map((r) => ({ conn: r.c.id, bytes_per_s: Math.round(r.rate) }));
    const a = rates[0];
    const b = rates[1];
    if (!a || a.rate < 10_000) return { failures: [`no one connection to the host carries ${A}'s stream (A writes about 33 KB/s): the busiest carries ${Math.round(a?.rate ?? 0)} B/s (${JSON.stringify(seen.rates)})`], lagOnly: false, seen };
    if (!b || b.rate < 1500 || b.rate > a.rate / 3) return { failures: [`${B}'s stream has no connection of its own beside ${A}'s: the connections carry ${JSON.stringify(seen.rates)} B/s from the host, so stalling one run's connection would stall both`], lagOnly: false, seen };
    const stallAt = Date.now();
    w.relay.stall(a.c);
    const known = new Set(w.relay.conns.map((c) => c.id));
    const bDown: { at: number; down: number; open: boolean }[] = [];
    while (Date.now() < stallAt + 60_000) {
      await sleep(500);
      bDown.push({ at: Date.now() - stallAt, down: b.c.down, open: b.c.closed === undefined });
    }
    const stallEnd = Date.now();
    w.relay.release(a.c);
    await sleep(3000);
    const after = await w.host.offset();
    const offset = (before.offset + after.offset) / 2;
    seen.clock = { before, after };
    seen.stall = { conn_a: a.c.id, conn_b: b.c.id, a_closed_s: a.c.closed === undefined ? null : (a.c.closed - stallAt) / 1000, b_closed_s: b.c.closed === undefined ? null : (b.c.closed - stallAt) / 1000 };
    const fresh = w.relay.conns.filter((c) => !known.has(c.id)).map((c) => ({ id: c.id, opened_s: (c.opened - stallAt) / 1000, down: c.down, closed_s: c.closed === undefined ? null : (c.closed - stallAt) / 1000 }));
    seen.opened_during_stall = fresh;

    // Only the stalled one reconnects: B's connection stays open and keeps carrying B.
    if (b.c.closed !== undefined && b.c.closed < stallEnd) {
      failures.push(`${B} (B) reconnected: its connection to the host closed ${((b.c.closed - stallAt) / 1000).toFixed(1)} s into the 60 s stall of ${A}'s (A's) connection, which alone was stalled`);
    } else {
      const quiet = bDown.findIndex((s, i) => i > 3 && s.down === bDown[i - 4]!.down);
      if (quiet >= 0) failures.push(`${B} (B)'s connection carried nothing for 2 s from ${bDown[quiet - 4]!.at / 1000} s into the stall of ${A}'s connection: B's stream stalled with A's`);
    }
    // B's stream within its 500 ms lag: every B line written during the stall arrives, each within 500 ms.
    const inStall = fb.lines.filter((l) => l.text.startsWith('dh1942 B ')).map((l) => lagOf(l, offset)).filter((x): x is NonNullable<typeof x> => !!x && x.written >= stallAt && x.written <= stallEnd);
    const late = inStall.filter((x) => x.lag >= LAG_MS);
    const worst = inStall.reduce((m, x) => Math.max(m, x.lag), 0);
    seen.b_lag = { lines: inStall.length, worst_ms: Math.round(worst), late: late.length, load: loadNow(), cores: CORES };
    if (inStall.length < 300) failures.push(`${B} (B)'s stream brought ${inStall.length} lines written during the 60 s stall of ${A}'s connection, where it writes about 500: B's stream didn't keep flowing`);
    else {
      const idx = inStall.map((x) => x.index).sort((x, y) => x - y);
      const gaps = idx.filter((v, i) => i > 0 && v !== idx[i - 1]! + 1).length;
      if (gaps) failures.push(`${B} (B)'s stream lost, repeated or reordered lines ${gaps} times during the stall of ${A}'s connection`);
    }
    const lagFailure = late.length ? `${B} (B)'s stream fell outside its ${LAG_MS} ms lag during the stall of ${A}'s connection: ${late.length} of ${inStall.length} lines late, the worst ${Math.round(worst)} ms (1-minute load ${loadNow().toFixed(1)} on ${CORES} cores)` : undefined;
    // The stalled one reconnects: A comes back on a new connection before the stall ends.
    const aBack = fa.lines.filter((l) => l.text.startsWith('dh1942 A ')).map((l) => lagOf(l, offset)).filter((x): x is NonNullable<typeof x> => !!x && x.written > stallAt + 1000 && x.written < stallEnd);
    const carrier = fresh.filter((c) => c.opened_s < 60 && c.down > 50_000);
    seen.a_back = { lines: aBack.length, first_arrived_s: aBack.length ? (Math.min(...aBack.map((x) => x.written + x.lag)) - stallAt) / 1000 : null, carriers: carrier.map((c) => c.id) };
    if (!carrier.length || !aBack.some((x) => x.written + x.lag < stallEnd)) {
      failures.push(`${A} (A) didn't reconnect while its connection was stalled: ${carrier.length ? '' : 'no new connection to the host carried its stream, and '}${aBack.length ? '' : 'none of '}its lines written during the stall ${aBack.length ? 'arrived only after the stall ended' : 'arrived'} (new connections: ${JSON.stringify(fresh)})`);
    }
    const hard = failures.length;
    if (lagFailure) failures.push(lagFailure);
    return { failures, lagOnly: hard === 0 && !!lagFailure, seen };
  } finally {
    fa.stop();
    fb.stop();
  }
}

/**
 * AC5's judge (README, How AC5 drops the link): with every byte from the host delayed 1 s at the relay, a run is
 * started on the host; the moment its first line lands in `once.starts` (the run has started there, its start's reply
 * still held), every connection to the host is cut and the delay lifted. Then: the host must hold one start of it,
 * a user unit whose name holds its token while it runs, and the hub one run.started and a run.finished `passed`
 * whose stdout evidence is the run's output once. Every failure names the token.
 */
export const ONCE_OUTPUT = `${Array.from({ length: 20 }, (_, i) => `tick ${i + 1}`).join('\n')}\ndone\n`;
export async function judgeOnce(w: World): Promise<{ failures: string[]; token: string; seen: Line }> {
  const failures: string[] = [];
  const seen: Line = {};
  const f = w.host.folder;
  const script = [STAMP(f, 'once'), 'i=0; while [ $i -lt 20 ]; do i=$((i + 1)); echo "tick $i"; sleep 1; done', 'echo done'].join('\n');
  // A link the hub keeps is up first where it keeps one, so the drop cuts a start rather than a first handshake: the
  // host's facts, read now (a hub that keeps none, or serves no facts, goes on all the same).
  await control(w, 'host.facts', { host: w.alias, refresh: true }, 120_000).catch(() => undefined);
  const watcher = w.host.watch('once.starts');
  w.relay.delayDownMs = 1000;
  let reply: Line | undefined;
  const started = control(w, 'run.start', { check: 'once', claim: someClaim(), commit: COMMIT, argv: ['/bin/sh', '-c', script], cwd: f, host: w.alias }, 180_000)
    .catch((error: Error) => ({ error: { message: error.message } }) as Line).then((r) => (reply = r));
  // A start the hub refused, or ran on this Mac, never lands on the host: that ends the wait early.
  let waiting = true;
  const elsewhere = (async (): Promise<false> => {
    for (const deadline = Date.now() + 180_000; waiting && Date.now() < deadline; await sleep(1000)) {
      if (reply?.error) return false;
      const run = reply?.result?.run;
      if (typeof run === 'string') {
        const s = runStarted(await events(w).catch(() => []), run)[0];
        if (s && s.data.host !== w.alias) { seen.started_on = s.data.host; return false; }
      }
    }
    return false;
  })();
  const landed = await Promise.race([watcher.seen, elsewhere]);
  waiting = false;
  w.relay.delayDownMs = 0;
  const cut = w.relay.dropAll();
  watcher.stop();
  seen.dropped = { connections: cut };
  await Promise.race([started, sleep(180_000)]);
  seen.reply = reply;
  if (!landed) {
    const r = reply?.error ? `run.start was refused: ${redact(JSON.stringify(reply.error).slice(0, 800), w.host.ssh)}`
      : seen.started_on !== undefined ? `the record says ${String(reply?.result?.run)} started on ${JSON.stringify(seen.started_on)}, not on ${w.alias}` : `run.start answered ${JSON.stringify(reply?.result).slice(0, 300)}`;
    return { failures: [`the run never started on ${w.alias} (no line in once.starts), so no start was sent to drop: ${r}`], token: '', seen };
  }
  if (!cut) return { failures: ['BLOCKED: no connection to the host was open when the run landed there, so the harness had no link to drop'], token: '', seen };
  const firstStarts = await w.host.starts('once');
  const token = firstStarts[0]?.token ?? '';
  const units = await w.host.unitsHolding(token);
  seen.at_drop = { starts: firstStarts.length, units };
  if (!token || token === 'none') failures.push(`the run on ${w.alias} has no DEEP_RUN_TOKEN in its environment, so it can't be read back by its token`);
  else if (!units.some((u) => u.active === 'active')) failures.push(`no active user unit on ${w.alias} holds the run's token ${token} right after the drop (${JSON.stringify(units)}), so it can't be read back by its token`);
  const run = typeof reply?.result?.run === 'string' ? String(reply.result.run) : undefined;
  if (!run) return { failures: [...failures, `run.start answered no run handle for the run with token ${token}: ${redact(JSON.stringify(reply).slice(0, 800), w.host.ssh)}`], token, seen };
  const end = await awaitEvent(w, (all) => runFinished(all, run), 120_000);
  await sleep(2000);
  const all = await events(w);
  const starts = await w.host.starts('once');
  seen.run = run;
  seen.starts = starts.map((s) => s.token.slice(0, 8));
  seen.finished = end?.data;
  if (starts.length !== 1) failures.push(`the run started ${starts.length} times on ${w.alias} for one remote start, token ${token}${starts.length > 1 ? ` (the starts' tokens: ${starts.map((s) => s.token).join(', ')})` : ''}: after the drop the start must be read back by its token, never sent again`);
  const recorded = runStarted(all, run).length;
  if (recorded !== 1) failures.push(`the record holds ${recorded} run.started events for ${run}, token ${token}`);
  if (!end) failures.push(`the hub never recorded the end of ${run}, token ${token}, which ran on ${w.alias}: it didn't read the run back after the drop`);
  else {
    if (end.data.outcome !== 'passed') failures.push(`${run}, token ${token}, ran to exit 0 on ${w.alias} but the hub recorded it ${JSON.stringify(end.data.outcome)} (${JSON.stringify(end.data.findings ?? []).slice(0, 300)})`);
    if (!(end.data.evidence as string[] | undefined)?.includes(sha256(ONCE_OUTPUT))) failures.push(`${run}, token ${token}: its stdout evidence isn't the run's output once ("tick 1" to "tick 20", then "done"; sha256 ${sha256(ONCE_OUTPUT).slice(0, 12)}), it holds ${JSON.stringify(end.data.evidence)}`);
  }
  return { failures, token, seen };
}
