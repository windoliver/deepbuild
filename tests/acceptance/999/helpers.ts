// Test-side tools for #999's acceptance tests (README): a world of a real hub (`deep hub run`) in a temp home whose
// `~/.ssh/config` names one Lima VM of this Mac under a name made for the run, reached through a TCP relay of this
// file's on 127.0.0.1, so a test can cut the link and bring it back; the hub's record, followed as it changes over the
// hub's socket; `deep` as you; the harness's own SSH link to the same VM, straight to its forwarded port, which never
// goes through the relay; and a Claude Code session on the host: a long-lived shell there (fixtures/agent.sh) that
// runs the hook commands `deep host add` installed in ~/.claude/settings.json on the host, as Claude Code runs them.
// Nothing here stands in for DeepBuild: every reading comes from the real hub, the `deep` CLI, the record, and the
// deep-hook `deep host add` put on the host.
//
// Adapted, not imported (suites don't import each other): the VM's way in, the relay and the harness link from
// tests/acceptance/1942/helpers.ts; the followed record, the bound and the session's hooks and transcript from
// tests/acceptance/3229/helpers.ts. Same repo, same license.
//
// Safety: every local folder is under /tmp/dh999-* and removed after its test; HOME is the world's for the hub and
// every `deep` command, run without this process's DEEP_*, XDG_*, CLAUDE*, CODEX* or billing settings. The only network
// is 127.0.0.1 and the VM through its forwarded port. On the VM this file makes ~/dh999-<id>/ and the session's
// transcript folder under ~/.claude/projects/, and removes both; what `deep host add` installs there is the hub's, and
// `deep host remove` is asked to take it out. Every process is one this file started, stopped by its PID. No timer
// here waits on its own: each only bounds a wait for an event (scripts/wait-ratchet.mjs).
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

/** Each criterion's ID and text: `#999.` and the first 8 hex of SHA-256 of its checkbox text (scripts/proof-change.mjs). */
export const AC = {
  1: '#999.1bb7a56d A Claude Code session on a test host records its tool calls and claim into your hub, shows under the host\'s name, and its claim is gated by a check run on the host; with the link cut for 5 minutes mid-session, its events arrive once and in order after the link returns, and its row reads unknown meanwhile',
  2: '#999.4257f07c A host whose deep-hook is a version older than the hub\'s, within the contract version, keeps recording; one outside it says so on its row and in `deep doctor`, naming both versions',
  3: '#999.9065ba1c Nothing on the host listens on a network port, by its listeners before and after',
} as const;

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const NODE = process.execPath;
const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
const AGENT_SH = fileURLToPath(new URL('./fixtures/agent.sh', import.meta.url));
/** The Lima VM that is the test host: `deep-ubuntu`, as #1942's suite has it, or the one DEEP_TEST_VM names. */
const VM = process.env.DEEP_TEST_VM || 'deep-ubuntu';
/** The VM's name in the harness's own SSH config, which the hub never reads. */
const HARNESS = 'dh999h';
/** A test's own time limit: a loaded Mac starts a hub, installs on the host and runs a claim's checks in minutes. */
export const LIMIT = 1_800_000;
/** How long one command of a session on the host may take: a held stop waits for its claim's checks. */
const COMMAND_MS = 900_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const parseObject = (raw: string): Line | undefined => { try { const v: unknown = JSON.parse(raw); return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Line) : undefined; } catch { return undefined; } };
export const cut = (text: string, n = 1200): string => (text.length > n ? `${text.slice(0, n)}…` : text);
/** An ID with only its letters and digits: a session's ID reads the same in a row, a subject and a hook. */
export const norm = (id: unknown): string => String(id ?? '').replace(/[^0-9A-Za-z]/g, '');
/** A word quoted for a POSIX shell. */
export const q = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`;
const b64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64');

/**
 * Resolves after `ms`. Every caller races it against the event it waits for (a process's end, a recorded event, a
 * reply), so all it can do is turn a hang into a result: this suite has no fixed wait (scripts/wait-ratchet.mjs).
 */
export function bound(ms: number): Promise<void> {
  // deadline: only ever raced against the event a test waits for; it bounds that wait and never waits on its own.
  return new Promise<void>((done) => { setTimeout(done, ms).unref(); });
}

// ---- Temp folders (short: a Unix socket path must fit in 104 bytes on macOS), processes and what closes after a test.
const made: string[] = [];
function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh999-'));
  made.push(dir);
  return dir;
}
const children = new Set<ChildProcess>();
const gone = (c: ChildProcess): boolean => c.exitCode !== null || c.signalCode !== null;
const exitOf = (c: ChildProcess): Promise<void> => (gone(c) ? Promise.resolve() : new Promise((done) => c.once('exit', () => done())));
const closers: (() => Promise<unknown>)[] = [];
/**
 * After each test: what the world opened closes, newest first (the host is asked to take out what `deep host add`
 * installed, the hub stops, the suite's folders on the host go, the links end); then every process this file started
 * is stopped by its own PID (SIGTERM, then SIGKILL), and the local folders are removed.
 */
export async function cleanup(): Promise<void> {
  for (const close of closers.splice(0).reverse()) await Promise.race([close().catch(() => undefined), bound(180_000)]);
  for (const c of children) if (!gone(c)) c.kill('SIGTERM');
  await Promise.race([Promise.all([...children].map(exitOf)), bound(30_000)]);
  for (const c of children) if (!gone(c)) c.kill('SIGKILL');
  await Promise.race([Promise.all([...children].map(exitOf)), bound(5000)]);
  children.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Node and the system's programs (ssh, git, ps): no real agent of this Mac's is on the hub's PATH. */
const PATH = [dirname(NODE), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
/** A child's environment: HOME the world's, PATH above, and no DEEP_, GIT_, XDG_, CLAUDE, CODEX or billing setting of this process's. SSH_AUTH_SOCK stays. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|GIT_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|AWS_BEARER|GH_|GITHUB_|AI_AGENT|NODE_OPTIONS|NODE_EXTRA_CA_CERTS|VITEST)/.test(key)) continue;
    env[key] = value;
  }
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), PATH, LC_ALL: 'C' });
  for (const [key, value] of Object.entries(extra)) { if (value === undefined) delete env[key]; else env[key] = value; }
  return env;
}
export interface Ran { code: number | null; stdout: string; stderr: string }
export const shown = (r: Ran): string => `exit ${r.code}, stdout ${JSON.stringify(cut(r.stdout))}, stderr ${JSON.stringify(cut(r.stderr))}`;
/** Runs a program to its end; one still going at `ms` is stopped by its PID, and its answer says so. */
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; ms?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const ms = o.ms ?? 120_000;
    const child = spawn(command, args, { cwd: o.cwd ?? '/tmp', env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    children.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { stderr += d; });
    // deadline: a program that never ends is stopped by its PID, so its caller gets an answer
    const timer = setTimeout(() => { stderr += `\nstopped at ${ms} ms`; child.kill('SIGKILL'); }, ms);
    const done = (code: number | null, extra = ''): void => { clearTimeout(timer); children.delete(child); resolve({ code, stdout, stderr: stderr + extra }); };
    child.on('error', (error) => done(null, error.message));
    child.on('close', (code) => done(code));
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}

// ---- The VM's SSH settings, as Lima wrote them in ~/.lima/<vm>/ssh.config. Values are kept as written (quotes too).
interface LimaSsh { port: number; user: string; identityFile: string; knownHosts: string; hostKeyAlias: string; ciphers: string | undefined }
function limaSsh(vm: string): LimaSsh {
  const file = join(homedir(), '.lima', vm, 'ssh.config');
  if (!existsSync(file)) throw Error(`BLOCKED: the test host, the Lima VM ${vm}, has no SSH config here (~/.lima/${vm}/ssh.config); start it, or name another with DEEP_TEST_VM`);
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
  return { port: Number(need('Port')), user: need('User'), identityFile: need('IdentityFile'), knownHosts: need('UserKnownHostsFile'), hostKeyAlias: values.get('HostKeyAlias') ?? alias, ciphers: values.get('Ciphers') };
}
const unquote = (v: string): string => v.replace(/^"(.*)"$/, '$1');
/** One Host block for the VM: Lima's way in (its key, user, known host key) at `port` on 127.0.0.1. */
function hostBlock(name: string, s: LimaSsh, port: number, knownHosts: string, extra: string[] = []): string {
  return [
    `Host ${name}`, '  HostName 127.0.0.1', `  Port ${port}`, `  User ${s.user}`, `  IdentityFile ${s.identityFile}`, '  IdentitiesOnly yes',
    '  PreferredAuthentications publickey', '  BatchMode yes', '  StrictHostKeyChecking yes', `  UserKnownHostsFile ${knownHosts}`,
    `  HostKeyAlias ${s.hostKeyAlias}`, ...(s.ciphers ? [`  Ciphers ${s.ciphers}`] : []), '  Compression no', '  GSSAPIAuthentication no', ...extra, '',
  ].join('\n');
}

// ---- The relay: 127.0.0.1:<port> to the VM's forwarded port. The world's SSH config names its port, so it is the
// hub's only way to the host, and cutting it cuts the link.
export class Relay {
  /** While true, every connection is closed as it arrives. */
  down = false;
  /** Connections carried, and connections closed on arrival while the link was cut. */
  opened = 0;
  refused = 0;
  private readonly pairs = new Set<{ client: net.Socket; server: net.Socket }>();
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
    client.on('error', () => undefined);
    if (this.down) { this.refused += 1; client.destroy(); return; }
    this.opened += 1;
    const server = net.connect(this.target, '127.0.0.1');
    const pair = { client, server };
    this.pairs.add(pair);
    const end = (): void => { this.pairs.delete(pair); client.destroy(); server.destroy(); };
    client.on('data', (chunk: Buffer) => { if (!server.destroyed) server.write(chunk); });
    server.on('data', (chunk: Buffer) => { if (!client.destroyed) client.write(chunk); });
    for (const s of [client, server]) { s.on('error', end); s.on('close', end); }
  }
  /** The link is cut: every open connection closes at once, and each new one closes as it arrives. How many were open. */
  cut(): number {
    this.down = true;
    const open = [...this.pairs];
    for (const p of open) { p.client.destroy(); p.server.destroy(); }
    return open.length;
  }
  /** The link is back: connections are carried again. */
  restore(): void { this.down = false; }
  private async close(): Promise<void> {
    this.cut();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

// ---- The harness's own link to the VM: straight to its forwarded port, its own ControlPath, a master this file owns.
export class HostSide {
  /** The host user's home, the test's folder there (absolute) and its sample repo, once made. */
  home = '';
  folder = '';
  private repoMade: string | undefined;
  /** Folders outside `folder` this suite made on the host, removed with it. */
  private readonly extra: string[] = [];
  private constructor(readonly ssh: LimaSsh, readonly config: string) {}
  /** Opens the harness link and makes ~/dh999-<id>/ there, with the session's stand-in; a VM it can't reach is BLOCKED. */
  static async open(tmp: string): Promise<HostSide> {
    const s = limaSsh(VM);
    const dir = join(tmp, 's');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const known = join(dir, 'known');
    copyFileSync(unquote(s.knownHosts), known);
    const config = join(dir, 'harness');
    writeFileSync(config, hostBlock(HARNESS, s, s.port, known, ['  ControlMaster no', `  ControlPath ${join(dir, 'c')}`, '  ServerAliveInterval 5', '  ServerAliveCountMax 6']), { mode: 0o600 });
    const h = new HostSide(s, config);
    // The master says `ready` from the host once it is in, and lives until this file ends it.
    const master = spawn('ssh', ['-F', config, '-o', 'ControlMaster=yes', '-o', 'ControlPersist=no', HARNESS, 'echo dh999-ready; exec cat'], { stdio: ['pipe', 'pipe', 'pipe'] });
    children.add(master);
    master.stdin.on('error', () => undefined);
    let err = '';
    master.stderr.setEncoding('utf8').on('data', (d: string) => { err = (err + d).slice(-4000); });
    const ready = new Promise<boolean>((done) => createInterface({ input: master.stdout }).once('line', (l) => done(l.includes('dh999-ready'))));
    if (!await Promise.race([ready, exitOf(master).then(() => false), bound(60_000).then(() => false)])) {
      throw Error(`BLOCKED: the test host, the Lima VM ${VM}, can't be reached over SSH at its forwarded port: ${h.redact(err.slice(-600))}`);
    }
    h.home = (await h.must('printf %s "$HOME"')).trim();
    h.folder = `${h.home}/dh999-${basename(tmp).slice('dh999-'.length)}`;
    closers.push(() => h.close());
    // The host is one where Claude Code has run: ~/.claude is there, made (and noted) when it isn't.
    await h.must(`mkdir -p ${q(h.folder)} && { [ -d "$HOME/.claude" ] || { mkdir "$HOME/.claude" && : > ${q(`${h.folder}/made-claude`)}; }; }`);
    await h.write(`${h.folder}/agent.sh`, readFileSync(AGENT_SH, 'utf8'));
    return h;
  }
  /** What the suite writes down instead of this Mac's home, the host's home, the VM's user name and the key's path. */
  redact(text: string): string {
    let out = text.split(homedir()).join('~');
    if (this.home) out = out.split(this.home).join('~');
    for (const v of [this.ssh.user, this.ssh.identityFile]) out = out.split(unquote(v)).join('<redacted>');
    return out;
  }
  /** A script on the host, read whole by `sh` before any of it runs, through the harness link. */
  sh(script: string, ms = 120_000): Promise<Ran> {
    return run('ssh', ['-F', this.config, HARNESS, 'sh -s'], { input: `{\n${script}\n}\n`, ms });
  }
  /** A script that must succeed: its stdout. */
  async must(script: string, ms = 120_000): Promise<string> {
    const r = await this.sh(script, ms);
    if (r.code !== 0) throw Error(`BLOCKED: on the test host, the harness's \`${cut(script, 200)}\` failed: ${this.redact(shown(r))}`);
    return r.stdout;
  }
  /** Writes a file on the host, whole. */
  async write(path: string, text: string): Promise<void> {
    await this.must(`mkdir -p ${q(dirname(path))} && base64 -d > ${q(path)} <<'DH999'\n${b64(text)}\nDH999`);
  }
  /** The lines of a file on the host; none when it isn't there. */
  async lines(path: string): Promise<string[]> {
    return (await this.sh(`cat ${q(path)} 2>/dev/null`)).stdout.split('\n').filter((l) => l.trim());
  }
  /**
   * What listens on a network port of the host now, as `ss` there lists it: `tcp <address>:<port>` for each listening
   * TCP socket and `udp <address>:<port>` for each bound UDP one, loopback included, sorted.
   */
  async listeners(): Promise<string[]> {
    const out = await this.must(['command -v ss >/dev/null || { echo "the host has no ss to list its listeners with" >&2; exit 7; }', 'ss -Hltn | awk \'{ print "tcp", $4 }\'', 'ss -Hlun | awk \'{ print "udp", $4 }\''].join('\n'));
    return [...new Set(out.split('\n').map((l) => l.trim()).filter(Boolean))].sort();
  }
  /**
   * The sample repo on the host, made once: ~/dh999-<id>/repo, a git repository on `main` with one commit holding
   * price.txt (20.00, the coupon not taken off) and the drafted check `.deepbuild/checks/price.sh` (README, The sample
   * repo), which notes each of its runs in ~/dh999-<id>/price.starts and passes once price.txt holds 17.00.
   */
  async repo(): Promise<string> {
    if (this.repoMade) return this.repoMade;
    const repo = `${this.folder}/repo`;
    const check = [
      '# The drafted check of the sample repo: the coupon is taken off, so price.txt holds 17.00.',
      '# Each run notes its run token and the unit it runs in, from inside the run.',
      `printf '%s %s\\n' "\${DEEP_RUN_TOKEN:-none}" "$(tail -n 1 /proc/self/cgroup)" >> ${q(`${this.folder}/price.starts`)}`,
      'got=$(cat price.txt 2>/dev/null)',
      'if [ "$got" = 17.00 ]; then echo "price.txt holds 17.00"; else echo "price.txt holds ${got:-nothing}, expected 17.00"; exit 1; fi',
      '',
    ].join('\n');
    await this.must('command -v git >/dev/null || { echo "the host has no git for the sample repo" >&2; exit 7; }');
    await this.write(`${repo}/price.txt`, '20.00\n');
    await this.write(`${repo}/${CHECK}`, check);
    await this.must(`cd ${q(repo)} && git init -q -b main && git add -A && git -c user.name=T -c user.email=t@example.test -c commit.gpgsign=false commit -q -m 'the sample cart'`);
    // Claude Code keeps a session's transcript under ~/.claude/projects/<the folder's path, dashed>/.
    this.extra.push(`${this.home}/.claude/projects/${repo.replace(/[^A-Za-z0-9]/g, '-')}`);
    return (this.repoMade = repo);
  }
  /** Stops the user units the sample check's runs wrote down, and removes this suite's folders on the host, ~/.claude too when the suite made it and it is empty again. */
  private async close(): Promise<void> {
    if (!this.folder) return;
    await this.sh([
      `F=${q(this.folder)}`,
      'toks=$(cat "$F"/*.starts 2>/dev/null | awk \'{ print $1 }\' | grep -v "^none$" | sort -u)',
      'for u in $(systemctl --user list-units --all --plain --no-legend --no-pager 2>/dev/null | awk \'{ print $1 }\'); do',
      '  for t in $toks; do case "$u" in *"$t"*) systemctl --user stop "$u" 2>/dev/null; systemctl --user reset-failed "$u" 2>/dev/null;; esac; done',
      'done',
      `rm -rf ${this.extra.map(q).join(' ')}`,
      '[ -f "$F/made-claude" ] && rmdir "$HOME/.claude/projects" "$HOME/.claude" 2>/dev/null',
      'rm -rf "$F"',
      'true',
    ].join('\n'));
  }
}

// ---- The hub as a process, and its record followed over its socket (the cli role, with the control token).
/** One event as the hub's stream carries it. */
export interface Ev { id: string; kind: string; log_pos: number; ts: number; seq?: string; writer?: string; subject?: string; session?: string; host?: string; data: Line }
export interface Hub { child: ChildProcess; socket: string; root: string }
/**
 * `deep hub run` in the world's home: the OS confirming you is stubbed (DEEP_HUB_TEST_CONFIRM), its definitions are
 * handed (DEEP_HUB_TEST_DRAFTS) and its clock can be stepped (DEEP_HUB_TEST_CLOCK_STEPS, README: The five minutes). A
 * hub that doesn't start is BLOCKED.
 */
async function startHub(w: Pick<World, 'home' | 'tmp' | 'root'>, plant?: string): Promise<Hub> {
  const env = childEnv(w.home, { DEEP_HUB_TEST_CONFIRM: join(w.tmp, 'confirm'), DEEP_HUB_TEST_DRAFTS: join(w.tmp, 'drafts.json'), DEEP_HUB_TEST_CLOCK_STEPS: '1', DEEP_HUB_PLANT: plant });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: w.tmp, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => { err = (err + d).slice(-20_000); });
  const first = new Promise<Line | undefined>((done) => createInterface({ input: child.stdout! }).once('line', (l) => done(parseObject(l))));
  const ready = await Promise.race([first, exitOf(child).then(() => undefined), bound(300_000).then(() => undefined)]);
  if (ready?.ready !== true) throw Error(`BLOCKED: the hub${plant ? ` with DEEP_HUB_PLANT=${plant}` : ''} did not start: ${cut(err.slice(-1500).split(homedir()).join('~'))}`);
  return { child, socket: String(ready.socket), root: w.root };
}
/** Stops the hub by its PID: SIGTERM, then SIGKILL when it hasn't ended in a minute. */
async function stopHub(hub: Hub): Promise<void> {
  if (!gone(hub.child)) hub.child.kill('SIGTERM');
  await Promise.race([exitOf(hub.child), bound(60_000)]);
  if (!gone(hub.child)) hub.child.kill('SIGKILL');
  await exitOf(hub.child);
}
/** The hub's record, each event as its frame arrives on one `stream.subscribe` from the record's start. */
export class Log {
  readonly events: Ev[] = [];
  /** The hub's hello: its contract and the features it lists. */
  hello: Line = {};
  private readonly wakers = new Set<() => void>();
  private readonly watchers: ((e: Ev) => void)[] = [];
  private readonly replies = new Map<string, (line: Line) => void>();
  private ids = 0;
  private constructor(private readonly sock: net.Socket) {
    let buffer = '';
    let greeted = false;
    sock.setEncoding('utf8').on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = parseObject(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (!line) continue;
        if (!greeted) { greeted = true; this.hello = line; this.wake('hello', line); }
        else if (line.role !== undefined) this.wake('role', line);
        else if (line.event && typeof line.event === 'object' && !('result' in line)) this.take(line.event as Ev);
        else this.wake(String(line.id), line);
      }
    });
    sock.on('error', () => undefined);
  }
  private wake(id: string, line: Line): void { this.replies.get(id)?.(line); this.replies.delete(id); }
  private take(e: Ev): void {
    if (this.events.length && e.log_pos <= this.events[this.events.length - 1]!.log_pos) return;
    this.events.push(e);
    for (const fn of this.watchers) fn(e);
    for (const w of [...this.wakers]) w();
  }
  private reply(id: string, what: string, ms = 180_000): Promise<Line> {
    const got = new Promise<Line>((done) => this.replies.set(id, done));
    return Promise.race([got, bound(ms).then(() => { throw Error(`BLOCKED: no ${what} from the hub within ${ms} ms`); })]);
  }
  static async open(hub: Hub): Promise<Log> {
    const sock = net.connect(hub.socket);
    const r = new Log(sock);
    await r.reply('hello', 'hello');
    const role = r.reply('role', 'cli role');
    sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token: readFileSync(join(hub.root, 'control.token'), 'utf8').trim() })}\n`);
    await role;
    await r.call('stream.subscribe', { after: 0 });
    return r;
  }
  /** One call on the cli role: its result; a refusal throws, naming what the hub said. */
  async call(method: string, params: Line): Promise<Line> {
    const id = `${method}#${++this.ids}`;
    const reply = this.reply(id, `reply to ${method}`);
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const line = await reply;
    if ('error' in line) throw Error(`${method} refused: ${JSON.stringify(line.error)}`);
    return line.result as Line;
  }
  /** Calls `fn` with each event held and each that arrives. */
  watch(fn: (e: Ev) => void): void {
    for (const e of this.events) fn(e);
    this.watchers.push(fn);
  }
  /** Waits for the event that makes `done` hold, at most `ms`; whether it came. The test's own assertions say what is missing. */
  async until(done: (events: readonly Ev[]) => boolean, ms = 600_000): Promise<boolean> {
    if (done(this.events)) return true;
    let wake = (): void => undefined;
    const came = new Promise<boolean>((resolve) => { wake = () => { if (done(this.events)) resolve(true); }; this.wakers.add(wake); });
    const held = await Promise.race([came, bound(ms).then(() => false)]);
    this.wakers.delete(wake);
    return held;
  }
  close(): void { this.sock.destroy(); }
}

// ---- The world.
/** Your ask settings (#319's shape), as the suites of #3229 and #3220 write them. */
const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'], fold: 5,
};
/** The prompt every session types, and the drafted check of the sample repo. */
export const PROMPT = 'take the coupon off the cart total in price.txt';
export const CHECK = '.deepbuild/checks/price.sh';
/**
 * The definition handed for PROMPT (DEEP_HUB_TEST_DRAFTS, in #3229's shape): one requirement, judged by the drafted
 * check in the session's repo.
 */
const DRAFT = {
  ask: PROMPT, deliverables: ['price.txt'], budget: null,
  requirements: [{ id: 'R1', text: 'The cart total has the coupon taken off', source_line: 'ask#L1', refuted_by: 'a cart total that ignores the coupon', check: CHECK, on_base: 'passes', asserts: [], depth: 'unit', oracle: 'code', near_misses: [] }],
};
export interface World {
  tmp: string; home: string; root: string;
  /** The host, its name in the world's SSH config, and the relay its Port points at. */
  host: HostSide; alias: string; relay: Relay;
  hub: Hub; log: Log;
  /** Asks this suite answered yes to, as you (README, Grants), by the ask's event; and the answers under way. */
  asked: Set<string>; answering: Promise<void>[];
  redact(text: string): string;
}
/** `deep <args>` as you, in the world's home. */
export const deep = (w: Pick<World, 'home' | 'tmp'>, args: readonly string[], ms = 120_000): Promise<Ran> =>
  run(NODE, [CLI, ...args], { env: childEnv(w.home, { DEEP_DOCTOR_CANVAS_FAULT: 'render_skipped' }), cwd: w.tmp, ms });
/**
 * You, in your inbox: each ask that names the host and offers an option whose decision is allow is answered with it
 * by `deep inbox answer`, once. No criterion reads these asks (README, Grants).
 */
function approve(w: World): void {
  w.log.watch((e) => {
    if (e.kind !== 'ask.created' || w.asked.has(e.id)) return;
    const option = (e.data.options as Line[] | undefined)?.find((x) => x?.decision === 'allow')?.id;
    if (typeof option !== 'string' || !JSON.stringify(e.data).includes(w.alias)) return;
    w.asked.add(e.id);
    w.answering.push(deep(w, ['inbox', 'answer', `ask:${e.id}`, option]).then(() => undefined));
  });
}
/**
 * A temp home whose `~/.ssh/config` names the VM under a name made for this run (Lima's key, user and host key, at
 * the relay's port), the harness link to the same VM, and a hub run with that home, its record followed. The hub must
 * read the host's facts through the relay first (`deep host facts`, #1942's), so a VM the world can't reach is
 * BLOCKED before any test reads `deep host add`.
 */
export async function openWorld(): Promise<World> {
  for (const [what, path] of [['the deep CLI (npm run build --workspaces)', CLI], ['deep-hook (cargo build --locked -p deep-hook)', DEEP_HOOK]] as const) {
    if (!existsSync(path)) throw Error(`BLOCKED: ${what} is not built at <repo>/${path.slice(REPO.length)}`);
  }
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(join(home, '.ssh'), { recursive: true, mode: 0o700 });
  chmodSync(join(home, '.ssh'), 0o700);
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS, runner: { login_path: PATH } }, null, 2)}\n`);
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  writeFileSync(join(tmp, 'drafts.json'), `${JSON.stringify({ drafts: [DRAFT] }, null, 2)}\n`);
  const host = await HostSide.open(tmp);
  const relay = await Relay.open(host.ssh.port);
  const alias = `box${randomBytes(3).toString('hex')}`;
  const known = join(home, '.ssh', 'known_hosts_lima');
  copyFileSync(unquote(host.ssh.knownHosts), known);
  writeFileSync(join(home, '.ssh', 'config'), hostBlock(alias, host.ssh, relay.port, known), { mode: 0o600 });
  const hub = await startHub({ home, tmp, root });
  const w: World = { tmp, home, root, host, alias, relay, hub, log: await Log.open(hub), asked: new Set(), answering: [], redact: (text) => host.redact(text) };
  approve(w);
  // After the test: what `deep host add` installed on the host is asked back out, with the link up; then the hub the
  // world then has stops, by its PID.
  closers.push(async () => { relay.restore(); await deep(w, ['host', 'remove', alias], 120_000); w.log.close(); await stopHub(w.hub); });
  const facts = await deep(w, ['host', 'facts', alias, '--refresh'], 300_000);
  if (facts.code !== 0 || !relay.opened) throw Error(`BLOCKED: the world's hub couldn't read ${alias}'s facts through the Port its SSH config names (${relay.opened} connections reached the relay): ${w.redact(shown(facts))}`);
  return w;
}
/** The hub stops, by its PID, and starts again on the same home, as an updated hub does: with `plant` when given. Its record is followed anew. */
export async function restartHub(w: World, plant?: string): Promise<void> {
  w.log.close();
  await stopHub(w.hub);
  w.hub = await startHub(w, plant);
  w.log = await Log.open(w.hub);
  approve(w);
}

/**
 * `deep host add <host>`, as you: it must end with exit 0. Where it ends otherwise having asked you something that
 * names the host, the suite answers yes (README, Grants) and runs it once more. Exit 2 is the exit table's "not
 * understood, nothing ran": no such command.
 */
export async function hostAdd(w: World): Promise<void> {
  let ran = await deep(w, ['host', 'add', w.alias], COMMAND_MS);
  if (ran.code !== 0 && ran.code !== 2 && await w.log.until(() => w.asked.size > 0, 15_000)) {
    await Promise.all(w.answering);
    ran = await deep(w, ['host', 'add', w.alias], COMMAND_MS);
  }
  if (ran.code !== 0) throw Error(`\`deep host add ${w.alias}\` must install deep-hook and Claude Code's hooks on the host and end with exit 0: ${w.redact(shown(ran))}`);
}
/** The rows `deep status --json` prints, as you. */
export async function statusRows(w: World): Promise<Line[]> {
  const r = await deep(w, ['status', '--json']);
  const read = parseObject(r.stdout.trim());
  if (!Array.isArray(read?.rows)) throw Error(`\`deep status --json\` printed no rows: ${w.redact(shown(r))}`);
  return read.rows as Line[];
}
/** A session's row among them. */
export const rowOf = (rows: readonly Line[], s: HostSession): Line | undefined => rows.find((r) => norm(r.id) === `session${norm(s.id)}`);
/** Whether an event is the list's row of a session (row.set), by the row's ID. */
export const isRow = (e: Ev, s: HostSession): boolean => e.kind === 'row.set' && norm(e.data.id) === `session${norm(s.id)}`;
/** The host an event carries (README, The host's name on an event): on the event itself or in its data. */
export const hostOf = (e: Ev): unknown => e.host ?? e.data?.host;

// ---- A Claude Code session on the host.
/** What deep-hook's output tells Claude Code: exit 2 or a deny/block decision stops the call; exit 0 with none lets it go. */
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = parseObject(r.stdout.trim());
  const d = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || d === 'deny' || d === 'block') return 'deny';
  return r.code === 0 && (d === undefined || d === 'allow') ? 'allow' : 'other';
}
/**
 * The hook commands Claude Code would run on the host: for each hook event in ~/.claude/settings.json there, the
 * first command entry that runs deep-hook (the background waiter under Stop, marked asyncRewake, is not a hook's own).
 */
async function hostHooks(w: World): Promise<Record<string, string>> {
  const settings = parseObject((await w.host.sh('cat "$HOME/.claude/settings.json"')).stdout);
  const out: Record<string, string> = {};
  for (const [event, groups] of Object.entries((settings?.hooks ?? {}) as Line)) {
    for (const group of Array.isArray(groups) ? groups as Line[] : []) {
      for (const h of Array.isArray(group?.hooks) ? group.hooks as Line[] : []) {
        if (h?.type === 'command' && typeof h.command === 'string' && h.command.includes('deep-hook') && h.asyncRewake !== true && out[event] === undefined) out[event] = h.command;
      }
    }
  }
  return out;
}
/** The session's Claude Code process on the host (fixtures/agent.sh), started over the harness link. */
class HostAgent {
  private n = 0;
  private readonly pending = new Map<number, (r: Ran) => void>();
  private constructor(private readonly child: ChildProcess, private readonly w: World) {}
  static async start(w: World, cwd: string): Promise<HostAgent> {
    const work = `${w.host.folder}/agent-${randomBytes(3).toString('hex')}`;
    const child = spawn('ssh', ['-F', w.host.config, HARNESS, `exec env CLAUDECODE=1 CLAUDE_CODE_ENTRYPOINT=cli CLAUDE_PROJECT_DIR=${q(cwd)} sh ${q(`${w.host.folder}/agent.sh`)} ${q(work)}`], { stdio: ['pipe', 'pipe', 'pipe'] });
    children.add(child);
    child.stdin.on('error', () => undefined);
    let err = '';
    child.stderr.setEncoding('utf8').on('data', (d: string) => { err = (err + d).slice(-2000); });
    const a = new HostAgent(child, w);
    let ready = (): void => undefined;
    const started = new Promise<boolean>((done) => { ready = () => done(true); });
    createInterface({ input: child.stdout }).on('line', (raw) => {
      if (raw === 'ready') return ready();
      const [n, code, out = '', errText = ''] = raw.split(' ');
      const done = a.pending.get(Number(n));
      a.pending.delete(Number(n));
      done?.({ code: /^\d+$/.test(code ?? '') ? Number(code) : null, stdout: Buffer.from(out.replace(/-$/, ''), 'base64').toString('utf8'), stderr: Buffer.from(errText.replace(/-$/, ''), 'base64').toString('utf8') });
    });
    child.on('exit', () => { for (const done of a.pending.values()) done({ code: null, stdout: '', stderr: `the session's process on the host ended: ${err}` }); a.pending.clear(); });
    if (!await Promise.race([started, exitOf(child).then(() => false), bound(60_000).then(() => false)])) throw Error(`BLOCKED: the session's process didn't start on the test host: ${w.redact(err)}`);
    return a;
  }
  /** One command line, run by `sh -c` in `cwd` on the host as this process's child, `input` on its stdin. */
  run(cwd: string, command: string, input: string, ms = COMMAND_MS): Promise<Ran> {
    const n = ++this.n;
    const answer = new Promise<Ran>((done) => this.pending.set(n, done));
    this.child.stdin!.write(`${n} ${b64(cwd)} ${b64(command)} ${input ? b64(input) : '-'}\n`);
    return Promise.race([answer, bound(ms).then(() => ({ code: null, stdout: '', stderr: `no answer from the session's process on the host in ${ms} ms` }))]);
  }
  /** A command of the harness's own that must succeed there: its stdout. */
  async must(cwd: string, command: string, input: string): Promise<string> {
    const r = await this.run(cwd, command, input, 120_000);
    if (r.code !== 0) throw Error(`BLOCKED: on the test host, the session's \`${cut(command, 200)}\` failed: ${this.w.redact(shown(r))}`);
    return r.stdout;
  }
}
const COVERED = (JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as { versions: string[] }).versions.at(-1)!;
const said = (content: Line[], stop: string): Line => ({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${randomBytes(12).toString('hex')}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 } } });
/** One tool call's hooks as they ended: its PreToolUse, and its PostToolUse when the call was let through. */
export interface Called { id: string; before: Ran; after: Ran | null }

/**
 * A Claude Code session in the sample repo on the host: its transcript there, where Claude Code keeps it, and its
 * hooks, each the command `deep host add` installed, run by the session's own process on the host with the hook's
 * JSON on stdin (README, A session on the host).
 */
export class HostSession {
  readonly id = randomUUID();
  readonly transcript: string;
  private prompt: string | undefined;
  private parent: string | null = null;
  private constructor(readonly w: World, private readonly agent: HostAgent, readonly cwd: string, private readonly hooks: Record<string, string>) {
    this.transcript = `${w.host.home}/.claude/projects/${cwd.replace(/[^A-Za-z0-9]/g, '-')}/${this.id}.jsonl`;
  }
  static async open(w: World): Promise<HostSession> {
    const cwd = await w.host.repo();
    const s = new HostSession(w, await HostAgent.start(w, cwd), cwd, await hostHooks(w));
    await s.agent.must(cwd, `mkdir -p ${q(dirname(s.transcript))} && : > ${q(s.transcript)}`, '');
    return s;
  }
  private async entry(value: Line): Promise<void> {
    const uuid = randomUUID();
    const line = { parentUuid: this.parent, isSidechain: false, ...value, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: this.cwd, sessionId: this.id, version: COVERED, gitBranch: 'main' };
    this.parent = uuid;
    await this.agent.must(this.cwd, `cat >> ${q(this.transcript)}`, `${JSON.stringify(line)}\n`);
  }
  /** One hook, once: the installed command for `event`, the hook's JSON on its stdin. A host with no such command fails. */
  async hook(event: string, fields: Line = {}): Promise<Ran> {
    const command = this.hooks[event];
    if (!command) throw Error(`\`deep host add\` installed no ${event} hook of Claude Code's that runs deep-hook on ${this.w.alias}: ~/.claude/settings.json there holds ${Object.keys(this.hooks).join(', ') || 'none'}`);
    const body = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', ...(this.prompt && event !== 'SessionStart' ? { prompt_id: this.prompt } : {}), ...fields };
    return this.agent.run(this.cwd, command, JSON.stringify(body));
  }
  /**
   * A hook, fired again until the hub's record holds its event, at most six times: past its budget deep-hook lets a call
   * go, and a loaded Mac answers late. Six tries with none recorded fail: the session isn't recording into the hub.
   */
  private async fired(event: string, fields: Line, kind: string, match: (e: Ev) => boolean = () => true): Promise<Ran> {
    const from = this.w.log.events.length;
    for (let n = 1; ; n++) {
      const ran = await this.hook(event, fields);
      if (await this.w.log.until((events) => events.slice(from).some((e) => e.kind === kind && e.session === this.id && match(e)), 30_000)) return ran;
      if (n === 6) throw Error(`the hub's record holds no ${kind} of the session's ${event} hook on ${this.w.alias} after ${n} tries; the last ended ${this.w.redact(shown(ran))}`);
    }
  }
  async start(): Promise<void> {
    const r = await this.fired('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' }, 'session.start');
    if (r.code !== 0) throw Error(`the SessionStart hook on ${this.w.alias} must end with exit 0: ${this.w.redact(shown(r))}`);
  }
  async typed(text: string): Promise<void> {
    this.prompt = randomUUID();
    await this.entry({ promptId: this.prompt, type: 'user', message: { role: 'user', content: text }, turnPosition: { promptIndex: 0, turnIndex: 1 }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
    const r = await this.fired('UserPromptSubmit', { prompt: text }, 'user.ask');
    if (r.code !== 0) throw Error(`the UserPromptSubmit hook on ${this.w.alias} must end with exit 0: ${this.w.redact(shown(r))}`);
  }
  /**
   * One tool call: PreToolUse; when allowed, what the call does (`effect`, its tool response) and PostToolUse. With
   * `live`, each hook is fired until the record holds its event; without, each runs once and nothing is waited for,
   * as while the link is cut.
   */
  async call(tool_name: string, tool_input: Line, effect: () => Promise<Line>, live = true): Promise<Called> {
    const id = `toolu_${randomBytes(12).toString('hex')}`;
    await this.entry(said([{ type: 'tool_use', id, name: tool_name, input: tool_input }], 'tool_use'));
    const pre = { tool_name, tool_input, tool_use_id: id };
    const before = live ? await this.fired('PreToolUse', pre, 'tool.before', (e) => e.data.call === id) : await this.hook('PreToolUse', pre);
    if (decision(before) !== 'allow') return { id, before, after: null };
    const response = await effect();
    await this.entry({ promptId: this.prompt, type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: JSON.stringify(response) }] }, toolUseResult: response });
    const post = { ...pre, tool_response: response, duration_ms: 40 };
    const after = live ? await this.fired('PostToolUse', post, 'tool.after', (e) => e.data.call === id) : await this.hook('PostToolUse', post);
    return { id, before, after };
  }
  /** One Bash call, its command run for real on the host by a shell of the session's own process. */
  bash(command: string, live = true): Promise<Called> {
    return this.call('Bash', { command, description: 'Run a command' }, async () => {
      const ran = await this.agent.run(this.cwd, command, '');
      return { stdout: ran.stdout, stderr: ran.stderr, interrupted: false, isImage: false };
    }, live);
  }
  /** Writes a file of the repo whole (Edit), as the agent does, on the host. */
  async edit(file: string, bytes: string): Promise<void> {
    const path = `${this.cwd}/${file}`;
    const old = await this.agent.must(this.cwd, `cat ${q(path)}`, '');
    const r = await this.call('Edit', { file_path: path, old_string: old, new_string: bytes, replace_all: false }, async () => {
      await this.agent.must(this.cwd, `cat > ${q(path)}`, bytes);
      return { filePath: path, oldString: old, newString: bytes, structuredPatch: [], userModified: false };
    });
    if (!r.after) throw Error(`the Edit of ${file} on ${this.w.alias} must be allowed: ${this.w.redact(shown(r.before))}`);
  }
  /** The agent's last words of the turn, then Stop: the stop makes the claim. */
  async stop(): Promise<Ran> {
    await this.entry(said([{ type: 'text', text: 'Done.' }], 'end_turn'));
    return this.fired('Stop', { stop_hook_active: false, last_assistant_message: 'Done.' }, 'agent.stop');
  }
}

// ---- The proof (the issue's Proof line), rewritten each run under $TMPDIR/deep-999-proof/, redacted.
export function proof(w: World, name: string, value: unknown): void {
  const dir = join(tmpdir(), 'deep-999-proof');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), w.redact(`${JSON.stringify(value, null, 2)}\n`));
}
