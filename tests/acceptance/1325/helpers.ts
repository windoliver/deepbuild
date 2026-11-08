// Test-side tools for #1325's acceptance tests (README). A world is: a test home outside the temp folders; the fixture
// forge (forge.ts) holding acme/shop, with the gate's app and the agents' app installed on it and maya, the person, as
// its admin; maya's checkout of acme/shop, cloned over HTTP from the forge; the hub as `deep hub run` on the home's
// installed root, with your settings naming both apps and the Keychain stand-in holding their keys; the Claude Code
// stand-in (fixtures/claude.mjs) on the login PATH, which a run's `deep start` launches; and a session in your terminal
// (#342's agent process) when a claim needs one. Nothing here stands in for the hub, deep-hook, git or the record.
//
// Adapted from tests/acceptance/1330/helpers.ts and tests/acceptance/46/helpers.ts (same repo, same license); this
// suite keeps its own copy so a redraft of theirs moves nothing here.
//
// Safety: every folder is under /Users/Shared/dh1325-* (made here, removed at the end); HOME is that folder for every
// child; the apps' keys and the tokens are made here, random, and never leave 127.0.0.1; processes are stopped by PID
// only: the hubs, what they started, and the agent processes this suite started. No model, no sign-in.
import { execFile, execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, createSign, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';
import { GateForge, type App, type Status } from './forge.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
/** #342's desktop agent process: deep-hook runs and Bash commands as its children (imported, not copied). */
const AGENT_PROGRAM = fileURLToPath(new URL('../342/fixtures/agent.mjs', import.meta.url));

/** The criteria's IDs: `#1325.` and the first 8 hex digits of SHA-256 of each criterion's text, white space collapsed (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #1325.49a90c4b',
  2: 'AC2 #1325.22c213fe',
  3: 'AC3 #1325.26d4fba5',
  4: 'AC4 #1325.e743366f',
  5: 'AC5 #1325.818e4076',
} as const;

/** The issue's values. */
export const CONTEXT = 'deepbuild/verdict';
export const SHOP = 'acme/shop';
export const PERSON = 'maya';
export const DEFAULT_BRANCH = 'main';
export const APPROVED_TAGS = 'deep/approved/';
/** The four calls AC2 names, as this suite names them in the record and in its failures (README). */
export const REFUSED_CALLS = ['post-status', 'merge', 'push-default-branch', 'push-approved-tag'] as const;
export type RefusedCall = (typeof REFUSED_CALLS)[number];
/** The apps' IDs and slugs in the fixture forge, and the Keychain services your settings name their keys by. */
export const GATE_APP = { id: 913251, slug: 'deepbuild-gate', service: 'deepbuild.github.gate' };
export const AGENTS_APP = { id: 913252, slug: 'deepbuild-agents', service: 'deepbuild.github.agents' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
for (const key of Object.keys(process.env)) if (/^(CLAUDE|DEEP_|CODEX|GH_|GITHUB_|GIT_)/.test(key)) delete process.env[key];

export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs: number, what: string, everyMs = 200): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(everyMs);
  }
}
/** A judgement: throws naming what it saw. */
export function must(ok: boolean, message: string): asserts ok {
  if (!ok) throw Error(message);
}
/** One reading of a planted program: the message its scenario throws, or null when it holds. BLOCKED is thrown on, never read as the plant's failure. */
export async function failureOf(scenario: () => unknown): Promise<string | null> {
  try {
    await scenario();
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('BLOCKED:')) throw error;
    return message;
  }
}

// ---- Folders and processes: a test home outside /tmp and /var/folders, which the session's sandbox lets it write
// and AC3's reading walks on its own; processes stopped by PID only.
const made: string[] = [];
function testHome(): string {
  if (!existsSync('/Users/Shared')) throw Error('BLOCKED: /Users/Shared is missing; the test home must be outside the temp folders');
  const dir = realpathSync(mkdtempSync('/Users/Shared/dh1325-'));
  made.push(dir);
  return dir;
}
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  try { return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}
function descendants(root: number): number[] {
  const table = spawnSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).stdout.trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number) as [number, number]);
  const out: number[] = [];
  const walk = (p: number): void => { for (const [pid, ppid] of table) if (ppid === p) { out.push(pid); walk(pid); } };
  walk(root);
  return out;
}
async function stopPids(pids: number[]): Promise<void> {
  for (const pid of pids) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while (pids.some(alive) && Date.now() < deadline) await sleep(100);
  for (const pid of pids) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
}
const commandOf = (pid: number): string => {
  try { return execFileSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim(); } catch { return ''; }
};
export const sh = (...words: string[]): string => words.map((w) => `'${w.replace(/'/g, `'\\''`)}'`).join(' ');

// ---- The hub's line protocol, as the CLI role.
export class Client {
  private buffer = '';
  private readonly lines: Line[] = [];
  private ids = 0;
  private constructor(private readonly sock: net.Socket) {
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      this.buffer += chunk;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        try { this.lines.push(JSON.parse(this.buffer.slice(0, i)) as Line); } catch { /* not a line */ }
        this.buffer = this.buffer.slice(i + 1);
      }
    });
    sock.on('error', () => undefined);
  }
  static async open(socket: string, root: string): Promise<Client> {
    const sock = net.connect(socket);
    await new Promise<void>((resolve, reject) => { sock.once('connect', resolve); sock.once('error', reject); });
    const c = new Client(sock);
    await waitFor(() => c.lines.length > 0, 5000, "the hub's hello");
    sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token: readFileSync(join(root, 'control.token'), 'utf8').trim() })}\n`);
    await waitFor(() => c.lines.some((l) => l.role === 'cli'), 5000, 'the cli role');
    return c;
  }
  async call(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<Line> {
    const id = `${method}#${++this.ids}`;
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await waitFor(() => this.lines.find((l) => l.id === id), timeoutMs, `the reply to ${method}`, 50);
    if ('error' in reply) throw Error(`${method} refused: ${JSON.stringify(reply.error)}`);
    return reply.result as Line;
  }
  async events(kind?: string): Promise<Line[]> {
    const out: Line[] = [];
    for (let after = 0; ;) {
      const events = (await this.call('events.read', { after, limit: 1000 })).events as Line[];
      if (!events.length) break;
      out.push(...events);
      after = events[events.length - 1]!.log_pos as number;
    }
    return kind ? out.filter((e) => e.kind === kind) : out;
  }
  close(): void { this.sock.destroy(); }
}
export const mentions = (value: unknown, id: string): boolean => JSON.stringify(value).toLowerCase().includes(id.toLowerCase());

// ---- The apps' keys: RSA, PKCS#1 PEM, as GitHub hands an app's private key over; random, made per world.
interface Key { pem: string; publicPem: string; der1: string; der8: string }
function makeKey(given?: string): Key {
  const pem = given ?? generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const key = createPrivateKey(pem);
  return {
    pem, publicPem: createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString(),
    der1: (key.export({ type: 'pkcs1', format: 'der' })).toString('base64'), der8: (key.export({ type: 'pkcs8', format: 'der' })).toString('base64'),
  };
}
/** live.test.ts alone: a real repo on GitHub, your token for it, and the two apps' IDs and keys. */
export interface Live { repo: string; token: string; gate: { id: number; pem: string }; agents: { id: number; pem: string } }
/** An app's JWT, as its owner signs one: what the test does as the person who made the app. */
function jwtOf(app: { id: number }, key: Key): string {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iat: now - 30, exp: now + 540, iss: app.id })}`;
  const signer = createSign('RSA-SHA256');
  signer.update(body);
  return `${body}.${signer.sign(key.pem).toString('base64url')}`;
}

// ---- The world.
const ASKS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
const HOOKS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'SessionEnd'];
const TOOL_HOOKS = new Set(['PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure']);
const hookGroups = (): Line => Object.fromEntries(HOOKS.map((h) => {
  const entry = { type: 'command', command: `exec '${DEEP_HOOK}' claude-code ${h}` };
  return [h, [TOOL_HOOKS.has(h) ? { matcher: '*', hooks: [entry] } : { hooks: [entry] }]];
}));
function newestClaude(): string {
  const facts = JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as Line;
  return (facts.versions as string[]).at(-1)!;
}

export interface Ran { code: number | null; stdout: string; stderr: string; out: Line | undefined }
export const shown = (r: Pick<Ran, 'code' | 'stdout' | 'stderr'>): string => `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;
function jsonOut(stdout: string): Line | undefined {
  for (const line of stdout.trim().split('\n').reverse()) {
    try { const v = JSON.parse(line) as unknown; if (v && typeof v === 'object' && !Array.isArray(v)) return v as Line; } catch { /* not JSON */ }
  }
  return undefined;
}
export interface Hub { pid: number; socket: string; child: ChildProcess; stderr(): string }
export interface Started { run: string; worktree: string; out: Line }

const worlds: World[] = [];
afterAll(async () => {
  for (const w of worlds.splice(0)) await w.close();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 180_000);

export class World {
  hub!: Hub;
  client!: Client;
  /** maya's own forge token: what `gh auth token` gives the hub on your machine, and what you push with. */
  readonly personToken: string;
  readonly gate: App;
  readonly agents: App;
  /** maya's checkout of acme/shop: main at `base`, on `feature` at `head`, the head of pull request `pr`. */
  base = '';
  head = '';
  pr = 0;
  private readonly agentsProcs = new Set<ChildProcess>();
  /** The repo, the REST root and the default branch: the fixture forge's acme/shop, or a live repo on GitHub. */
  readonly name: string;
  readonly apiRoot: string;
  defaultBranch = DEFAULT_BRANCH;
  private constructor(readonly home: string, readonly root: string, readonly bin: string, readonly loginPath: string, readonly repo: string, readonly forge: GateForge,
    readonly keys: { gate: Key; agents: Key }, readonly plant: string | undefined, readonly live: Live | undefined) {
    this.personToken = live?.token ?? forge.person(PERSON, true);
    this.name = live?.repo ?? SHOP;
    this.apiRoot = live ? 'https://api.github.com' : forge.url;
    this.gate = forge.app({ id: live?.gate.id ?? GATE_APP.id, slug: GATE_APP.slug, publicKeyPem: keys.gate.publicPem, permissions: { metadata: 'read', contents: 'read', pull_requests: 'read', statuses: 'write' } });
    // The agents' app is installed with more than a session needs, statuses included, so how narrow a session's
    // credential is is the hub's doing (README: The world).
    this.agents = forge.app({ id: live?.agents.id ?? AGENTS_APP.id, slug: AGENTS_APP.slug, publicKeyPem: keys.agents.publicPem, permissions: { metadata: 'read', contents: 'write', pull_requests: 'write', issues: 'write', statuses: 'write' } });
  }

  static async open(o: { plant?: string; live?: Live } = {}): Promise<World> {
    if (!existsSync(CLI)) throw Error(`BLOCKED: the deep CLI (npm run build --workspaces) is not built at ${CLI}`);
    if (!existsSync(DEEP_HOOK)) throw Error(`BLOCKED: deep-hook (cargo build --locked -p deep-hook) is not built at ${DEEP_HOOK}`);
    if (!existsSync('/usr/bin/sandbox-exec')) throw Error('BLOCKED: /usr/bin/sandbox-exec is missing; the stand-in agent enforces its sandbox with Seatbelt (macOS only)');
    const home = testHome();
    const root = join(home, '.deepbuild');
    mkdirSync(root, { recursive: true, mode: 0o700 });
    copyFileSync(join(REPO, 'crates/deep-hook/default-rules.json'), join(root, 'rules.json'));
    const bin = join(home, 'bin');
    const loginPath = [bin, dirname(NODE), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
    for (const f of ['.zprofile', '.zshenv', '.bash_profile', '.profile']) writeFileSync(join(home, f), `export PATH="${loginPath}"\n`);
    writeFileSync(join(home, 'confirm'), 'confirmed\n');
    mkdirSync(bin, { recursive: true });
    const program = readFileSync(join(FIXTURES, 'claude.mjs'), 'utf8').replace(/^#!.*\n/, `#!${NODE}\n`)
      .replace("'__VERSION__'", JSON.stringify(newestClaude())).replace("'__LOGDIR__'", JSON.stringify(join(home, '.standin')));
    writeFileSync(join(bin, 'claude'), program, { mode: 0o755 });
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude/settings.json'), `${JSON.stringify({ hooks: hookGroups() }, null, 2)}\n`);
    // The apps' keys in the Keychain (its test stand-in, DEEP_HUB_TEST_KEYCHAIN), kept in the Keychains folder, which
    // a session's sandbox can't read; your settings name them by service.
    const keys = { gate: makeKey(o.live?.gate.pem), agents: makeKey(o.live?.agents.pem) };
    mkdirSync(join(home, 'Library/Keychains'), { recursive: true, mode: 0o700 });
    writeFileSync(join(home, 'Library/Keychains/deepbuild-test.json'), JSON.stringify({ [GATE_APP.service]: keys.gate.pem, [AGENTS_APP.service]: keys.agents.pem }), { mode: 0o600 });
    writeFileSync(join(root, 'config.json'), `${JSON.stringify({
      asks: ASKS, runner: { login_path: loginPath },
      github: {
        // The live run posts nothing: its delivery rule is off.
        delivery: { [o.live?.repo ?? SHOP]: o.live ? 'off' : 'on' }, yours: [PERSON],
        gate: { app_id: o.live?.gate.id ?? GATE_APP.id, key: GATE_APP.service },
        agents: { app_id: o.live?.agents.id ?? AGENTS_APP.id, key: AGENTS_APP.service },
      },
    }, null, 2)}\n`);
    const forge = await GateForge.start(join(home, 'forge'));
    const repo = join(home, 'src', 'shop');
    const w = new World(home, root, bin, loginPath, repo, forge, keys, o.plant, o.live);
    worlds.push(w);
    if (o.live) await w.seedLive();
    else {
      forge.repo(SHOP);
      await w.seed();
    }
    w.hub = await w.runHub();
    w.client = await Client.open(w.hub.socket, root);
    return w;
  }

  /**
   * maya's git in her checkout: her name on commits, her token on every request to the forge, no helper of this
   * machine asked. Asynchronous: the fixture forge answers from this same process. Rejects with git's stderr.
   */
  personGit(...args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('git', ['-C', this.repo, '-c', `user.name=${PERSON}`, '-c', `user.email=${PERSON}@example.invalid`, '-c', 'commit.gpgsign=false', '-c', 'credential.helper=',
        '-c', `http.extraHeader=Authorization: Bearer ${this.personToken}`, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } },
      (error, stdout, stderr) => (error ? reject(Error(`git ${args.join(' ')}: ${stderr.trim() || error.message}`)) : resolve(stdout.trim())));
    });
  }
  /** acme/shop: main with the shop, pushed by maya; `feature` one commit ahead, pushed by her; pull request #1 of it into main. */
  private async seed(): Promise<void> {
    mkdirSync(this.repo, { recursive: true });
    writeFileSync(join(this.repo, 'README.md'), '# shop\n');
    writeFileSync(join(this.repo, 'total.js'), 'export const total = (n) => n * 1.07;\n');
    await this.personGit('init', '-q', '-b', DEFAULT_BRANCH);
    await this.personGit('add', '-A');
    await this.personGit('commit', '-q', '-m', 'Start the shop');
    await this.personGit('remote', 'add', 'origin', this.forge.gitUrl(SHOP));
    await this.personGit('push', '-q', '-u', 'origin', DEFAULT_BRANCH);
    this.base = await this.personGit('rev-parse', 'HEAD');
    await this.personGit('checkout', '-q', '-b', 'feature');
    writeFileSync(join(this.repo, 'total.js'), 'export const total = (n) => n * 1.08;\n');
    await this.personGit('commit', '-q', '-am', 'Use the new rate');
    await this.personGit('push', '-q', '-u', 'origin', 'feature');
    this.head = await this.personGit('rev-parse', 'HEAD');
    await this.personGit('remote', 'set-head', 'origin', DEFAULT_BRANCH);
    this.pr = this.forge.inner.pull({ repo: SHOP, head: 'feature', base: DEFAULT_BRANCH, title: 'Use the new rate' });
  }
  /** The live repo: cloned with your token; a proof branch one commit ahead of the default branch, pushed by you, and one pull request of it. */
  private async seedLive(): Promise<void> {
    const about = await this.api('GET', `/repos/${this.name}`, undefined, this.personToken);
    if (about.status !== 200) throw Error(`BLOCKED: ${this.name} must be readable with DEEPBUILD_1325_LIVE_TOKEN: ${about.status}`);
    this.defaultBranch = String(about.json.default_branch);
    mkdirSync(dirname(this.repo), { recursive: true });
    execFileSync('git', ['-c', 'credential.helper=', '-c', `http.extraHeader=Authorization: Bearer ${this.personToken}`, 'clone', '-q', `https://github.com/${this.name}.git`, this.repo], { env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' }, stdio: 'ignore' });
    this.base = await this.personGit('rev-parse', 'HEAD');
    const branch = `deepbuild-1325-proof-${Date.now()}`;
    await this.personGit('checkout', '-q', '-b', branch);
    writeFileSync(join(this.repo, 'deepbuild-1325-proof.md'), `A proof branch for #1325, made ${new Date().toISOString()}; it is deleted at the end.\n`);
    await this.personGit('add', '-A');
    await this.personGit('commit', '-q', '-m', 'DeepBuild #1325 proof');
    await this.personGit('push', '-q', '-u', 'origin', branch);
    this.head = await this.personGit('rev-parse', 'HEAD');
    this.proofBranch = branch;
    const pull = await this.api('POST', `/repos/${this.name}/pulls`, { title: 'DeepBuild #1325 proof (closed at the end)', head: branch, base: this.defaultBranch }, this.personToken);
    if (pull.status !== 201) throw Error(`BLOCKED: the proof's pull request must open: ${pull.status} ${JSON.stringify(pull.json)}`);
    this.pr = Number(pull.json.number);
  }
  proofBranch = '';

  /** Every child's environment: the test home, the login PATH, no helper of this machine's git, and the plant when there is one. */
  env(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: this.home, PATH: `${this.loginPath}:${process.env.PATH ?? ''}`, SHELL: '/bin/zsh', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...(this.plant ? { DEEP_HUB_PLANT: this.plant } : {}) };
    for (const [k, v] of Object.entries(extra)) { if (v === undefined) delete env[k]; else env[k] = v; }
    return env;
  }
  /** The hub: `deep hub run`, the forge as its GitHub, maya's own token as the forge login it holds, and the test stand-ins for your confirmation, the Keychain and a planted verdict. */
  private async runHub(): Promise<Hub> {
    const child = spawn(NODE, [CLI, 'hub', 'run'], {
      cwd: this.home, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
      env: this.env({
        DEEP_HUB_TEST_CONFIRM: join(this.home, 'confirm'), DEEP_HUB_TEST_FORGE: this.apiRoot, DEEP_HUB_TEST_KEYCHAIN: join(this.home, 'Library/Keychains/deepbuild-test.json'),
        DEEP_HUB_TEST_VERDICT: '1', GH_TOKEN: this.personToken,
      }),
    });
    let out = '';
    let err = '';
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
    const exit = new Promise((resolve) => child.on('exit', resolve));
    const ready = await Promise.race([
      new Promise<Line | undefined>((resolve) => {
        child.stdout!.setEncoding('utf8').on('data', (d: string) => {
          out += d;
          if (out.includes('\n')) { try { resolve(JSON.parse(out.split('\n')[0]!) as Line); } catch { resolve(undefined); } }
        });
      }),
      exit.then(() => undefined),
      sleep(120_000).then(() => undefined),
    ]);
    if (ready?.ready !== true) {
      if (child.pid && alive(child.pid)) try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ }
      throw Error(`BLOCKED: the hub${this.plant ? ` with DEEP_HUB_PLANT=${this.plant}` : ''} did not start (a hub that doesn't list a plant refuses to start): ${err.slice(-800)}`);
    }
    return { pid: child.pid!, socket: String(ready.socket), child, stderr: () => err };
  }
  async close(): Promise<void> {
    this.client?.close();
    const pids = new Set<number>(this.hub ? descendants(this.hub.pid) : []);
    for (const s of this.standIns()) if (alive(s.pid) && commandOf(s.pid).includes(this.home)) pids.add(s.pid);
    for (const a of this.agentsProcs) if (a.pid) pids.add(a.pid);
    if (this.hub) pids.add(this.hub.pid);
    await stopPids([...pids]);
    await this.forge.close();
  }

  /** `deep` as you run it in your terminal. */
  deep(args: string[], o: { timeoutMs?: number } = {}): Promise<Ran> {
    return new Promise((resolve) => {
      const child = spawn(NODE, [CLI, ...args], { cwd: this.home, env: this.env(), stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout!.setEncoding('utf8').on('data', (d: string) => (stdout += d));
      child.stderr!.setEncoding('utf8').on('data', (d: string) => (stderr += d));
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, o.timeoutMs ?? 180_000);
      child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, out: jsonOut(stdout) }); });
    });
  }
  events(kind?: string): Promise<Line[]> { return this.client.events(kind); }

  // ---- The rules (README: The surface, `deep gate rules`), put on the forge as you would put them: by maya, its admin.
  async applyRules(): Promise<Line[]> {
    const r = await this.deep(['gate', 'rules', '--json']);
    must(r.code === 0 && Array.isArray(r.out?.rulesets) && r.out!.rulesets.length > 0, `deep gate rules --json must exit 0 and print { "rulesets": [...] }, the rulesets the forge needs: ${shown(r)}`);
    for (const body of r.out!.rulesets as Line[]) {
      const res = await this.api('POST', `/repos/${SHOP}/rulesets`, body, this.personToken);
      must(res.status === 201, `the forge took ruleset ${JSON.stringify(body.name)} as GitHub's API takes one (POST /repos/{owner}/{repo}/rulesets): ${res.status} ${JSON.stringify(res.json)}`);
    }
    return r.out!.rulesets as Line[];
  }
  /** One call to the forge's API. */
  async api(method: string, path: string, body: unknown, token: string | null): Promise<{ status: number; json: Line }> {
    const res = await fetch(`${this.apiRoot}${path}`, {
      method, headers: { accept: 'application/vnd.github+json', 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let json: Line = {};
    try { json = JSON.parse(text) as Line; } catch { /* none */ }
    return { status: res.status, json };
  }
  /** A token of an app, as the person who made the app mints one with its key: through the forge's own route, by JWT. */
  async mint(which: 'gate' | 'agents', permissions?: Record<string, 'read' | 'write'>): Promise<string> {
    const app = which === 'gate' ? this.gate : this.agents;
    const jwt = jwtOf(app, this.keys[which]);
    const res = await this.api('POST', `/app/installations/${app.installation}/access_tokens`, permissions ? { permissions } : {}, jwt);
    if (res.status !== 201) throw Error(`BLOCKED: the fixture forge didn't mint a token of ${app.slug}: ${res.status} ${JSON.stringify(res.json)}`);
    return String(res.json.token);
  }
  /** The pull request's mergeable_state once the forge has computed it. */
  async pullState(): Promise<string> {
    return waitFor(async () => {
      const r = await this.api('GET', `/repos/${SHOP}/pulls/${this.pr}`, undefined, this.personToken);
      return r.json.mergeable_state && r.json.mergeable_state !== 'unknown' ? String(r.json.mergeable_state) : undefined;
    }, 20_000, `pull request #${this.pr}'s mergeable_state`);
  }
  loginOf(app: App): string { return this.forge.loginOf(app); }

  // ---- A run you approved (#1330's surface), and a session started under it.
  async approveRun(): Promise<void> {
    const r = await this.deep(['start', 'approve', '--repo', this.repo, '--issues', '1325', '--agents', 'claude-code', '--home', `claude-code=${join(this.home, '.claude')}`,
      '--at-once', '3', '--plan-share', '100', ...(this.live ? ['--host', 'api.github.com', '--host', 'github.com'] : ['--host', '127.0.0.1']), '--json']);
    const handle = r.out?.ask;
    if (r.code !== 0 || typeof handle !== 'string') throw Error(`BLOCKED: deep start approve (#1330) must raise its ask: ${shown(r)}`);
    const id = handle.slice(4);
    const created = await waitFor(async () => (await this.events('ask.created')).find((e) => mentions(e, id)), 15_000, `the ask.created of ${handle}`);
    const yes = ((created.data?.options ?? []) as { id: string; decision?: string }[]).find((x) => x.decision === 'allow');
    const a = await this.deep(['inbox', 'answer', handle, yes?.id ?? 'allow']);
    if (a.code !== 0) throw Error(`BLOCKED: deep inbox answer ${handle} must approve the run: ${shown(a)}`);
  }
  /** `deep start` under the run: the stand-in's prompt carries its tags (README: The stand-in agent). */
  async start(prompt: string): Promise<Started> {
    const r = await this.deep(['start', '--repo', this.repo, '--issue', '1325', '--agent', 'claude-code', '--prompt', prompt, '--json']);
    if (r.code !== 0 || r.out?.status !== 'started') throw Error(`BLOCKED: deep start (#1330) must start the session under the approved run: ${shown(r)}`);
    return { run: String(r.out.run), worktree: String(r.out.worktree), out: r.out };
  }
  standIns(): Line[] {
    const dir = join(this.home, '.standin');
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith('.json')).flatMap((f) => {
      try { return [JSON.parse(readFileSync(join(dir, f), 'utf8')) as Line]; } catch { return []; }
    });
  }
  /**
   * The session's stand-in in the worktree, once its turn is done (and, with `ended`, once its session ended). Only a
   * session's own log: one the stand-in `refused` (a subcommand such as `claude plugin list`, which the hub runs in the
   * same folder with its own environment) is not a session (README: Redraft).
   */
  standIn(worktree: string, o: { ended?: boolean; ms?: number } = {}): Promise<Line> {
    const want = realOr(worktree);
    return waitFor(() => this.standIns().find((s) => realOr(String(s.cwd)) === want && !s.refused && s.done === true && (!o.ended || typeof s.ended === 'number')), o.ms ?? 240_000,
      `the claude stand-in in ${worktree} to finish (seen: ${JSON.stringify(this.standIns().map((s) => ({ cwd: s.cwd, done: s.done, bash: (s.bash as Line[]).length })))})`)
      .catch((e: Error) => { throw Error(`BLOCKED: ${e.message}`); });
  }

  // ---- The gate's PASS on the pull request's head: a session in your terminal claims it, and the verdict is planted on
  // that claim (test.verdict), so the hub's poster (#46) posts its status with whatever identity it posts with.
  async gatePass(): Promise<Status> {
    const s = new DesktopSession(this, this.repo);
    this.agentsProcs.add(s.child);
    await s.start();
    const said = await s.mcp('deep_claim', { task_ref: `task:${ulidLike()}`, attempt: 1, commit: this.head, scope: 'session', predictions: null });
    const claim = /claim:[0-9A-Z]{26}/.exec(said)?.[0];
    if (!claim) throw Error(`BLOCKED: deep_claim must answer with the claim's handle: ${said.slice(0, 1200)}`);
    // Only a status posted after the PASS is the PASS's (README: Redraft); any poster, so a wrong one is named.
    const passAt = Date.now();
    await this.client.call('test.verdict', { session: s.id, claim, outcome: 'PASS', requirements: [{ req: 'req:01K74G0A1B2C3D4E5F6G7H8J9K#R1', outcome: 'PASS', check: 'unit', smallest: null, points_to: null }] })
      .catch((e: Error) => { throw Error(`BLOCKED: the hub must serve test.verdict with DEEP_HUB_TEST_VERDICT=1: ${e.message}`); });
    await waitFor(async () => (await this.events('verdict.made')).some((e) => e.data?.claim === claim && e.data?.outcome === 'PASS'), 30_000, `the planted PASS on ${claim}`)
      .catch((e: Error) => { throw Error(`BLOCKED: ${e.message}`); });
    return waitFor(() => this.forge.statusesOf(this.head).find((x) => x.context === CONTEXT && x.at >= passAt), 60_000, `a ${CONTEXT} status on ${this.head} after the PASS`)
      .catch(() => { throw Error(`the hub posted no ${CONTEXT} status on ${this.head} within 60 s of a PASS on it`); });
  }
  /** A session in your terminal in a checkout, live while the world is. */
  async liveSession(cwd: string): Promise<DesktopSession> {
    const s = new DesktopSession(this, cwd);
    this.agentsProcs.add(s.child);
    await s.start();
    return s;
  }

  // ---- The gate's credential, as the forge and the test know it: the app's key in each of its forms, and every token
  // and JWT of the gate's app the forge has seen. Labels name the kind, never the value.
  gateSecrets(): { label: string; value: string }[] {
    const chunks = (b64: string, form: string) => Array.from({ length: Math.floor(b64.length / 64) }, (_, i) => ({ label: `the gate app's private key (${form})`, value: b64.slice(i * 64, i * 64 + 64) }));
    return [
      ...chunks(this.keys.gate.der1, 'PKCS#1'), ...chunks(this.keys.gate.der8, 'PKCS#8'),
      ...[...this.forge.tokens.values()].filter((t) => t.app === this.gate.id).map((t) => ({ label: `an installation token of ${GATE_APP.slug}`, value: t.token })),
      ...this.forge.jwts.filter((j) => j.app === this.gate.id).map((j) => ({ label: `a JWT of ${GATE_APP.slug}`, value: j.jwt })),
    ];
  }
  /** The label of a gate secret the text holds, or undefined. */
  holdsGateSecret(text: string): string | undefined {
    const flat = text.replace(/\\n/g, '\n').replace(/[\r\n]/g, '');
    return this.gateSecrets().find((s) => text.includes(s.value) || flat.includes(s.value))?.label;
  }
  /** What a session's GH_TOKEN is, as the forge knows it. */
  credentialOf(token: string | undefined): { agents: boolean; what: string } {
    if (!token) return { agents: false, what: 'unset' };
    const login = this.forge.users.get(token);
    if (login) return { agents: false, what: `${login}'s own token` };
    const t = this.forge.tokens.get(token);
    if (!t) return { agents: false, what: 'a token the forge never issued' };
    if (t.app === this.gate.id) return { agents: false, what: `an installation token of the gate's app, ${GATE_APP.slug}` };
    return { agents: true, what: `an installation token of ${AGENTS_APP.slug}` };
  }
}

export const realOr = (p: string): string => { try { return realpathSync(p); } catch { return p; } };
const ulidLike = () => { const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; return Array.from({ length: 26 }, () => chars[Math.floor(Math.random() * 32)]).join(''); };
/** A prompt for the stand-in: each command one Bash call, in order; `exit` ends the session after the turn. */
export const promptOf = (commands: string[], o: { exit?: boolean } = {}): string =>
  `Work on issue 1325. ${commands.map((c) => `[standin:bash:${Buffer.from(c).toString('base64url')}]`).join(' ')}${o.exit ? ' [standin:exit]' : ''}`;
/** The command a session runs to make forge calls with its credential (fixtures/forge-calls.mjs). */
export function forgeCalls(w: World, calls: string[], tag: string): string {
  return sh(NODE, join(FIXTURES, 'forge-calls.mjs'), JSON.stringify({ api: w.apiRoot, repo: w.name, head: w.head, pr: w.pr, branch: `agent-${tag}`, tag: `${APPROVED_TAGS}1325-${tag}`, base: w.defaultBranch, calls }));
}
export const digestOf = (s: string): string => createHash('sha256').update(s).digest('hex');
export const tag = (): string => randomBytes(3).toString('hex');

// ---- A session in your terminal, in Claude Code: its agent process, deep-hook and its Bash commands as children.
export class DesktopSession {
  readonly id = randomUUID();
  private n = 0;
  private buffer = '';
  private readonly pending = new Map<number, (r: Line) => void>();
  readonly child: ChildProcess;
  readonly transcript: string;
  constructor(readonly w: World, readonly cwd: string) {
    this.child = spawn(NODE, [AGENT_PROGRAM, DEEP_HOOK], { cwd, env: w.env({ CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' }), stdio: ['pipe', 'pipe', 'ignore'] });
    this.child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const line = JSON.parse(this.buffer.slice(0, i)) as Line;
        this.buffer = this.buffer.slice(i + 1);
        this.pending.get(line.n as number)?.(line);
        this.pending.delete(line.n as number);
      }
    });
    this.child.stdin!.on('error', () => undefined);
    this.transcript = join(w.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
  }
  private send(command: Line): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve) => { this.pending.set(n, resolve); this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`); });
  }
  hook(event: string, fields: Line = {}): Promise<Line> {
    const body = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', ...fields };
    return this.send({ op: 'hook', args: ['claude-code', event], cwd: this.cwd, input: JSON.stringify(body) });
  }
  async start(): Promise<void> {
    appendFileSync(this.transcript, `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'look after the shop' }, uuid: randomUUID(), timestamp: new Date().toISOString(), cwd: this.cwd, sessionId: this.id, userType: 'external', entrypoint: 'cli' })}\n`);
    const r = await this.hook('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
    if (r.code !== 0) throw Error(`BLOCKED: deep-hook's SessionStart ended with ${r.code}: ${String(r.stderr).slice(-400)}`);
    await this.hook('UserPromptSubmit', { prompt: 'look after the shop' });
  }
  /** One Bash tool call: PreToolUse, then the command as the agent's child, then PostToolUse. */
  async bash(command: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
    const tool_use_id = `toolu_${randomBytes(10).toString('hex')}`;
    const tool_input = { command, description: 'Run a command' };
    await this.hook('PreToolUse', { tool_name: 'Bash', tool_input, tool_use_id });
    const r = await this.send({ op: 'bash', command, cwd: this.cwd });
    await this.hook('PostToolUse', { tool_name: 'Bash', tool_input, tool_use_id, tool_response: { stdout: r.stdout, stderr: r.stderr, interrupted: false, isImage: false } });
    return { code: r.code as number | null, stdout: String(r.stdout), stderr: String(r.stderr) };
  }
  /**
   * One call of a deep MCP tool: its PreToolUse, then `deep mcp` as the agent's own child serving the call, then
   * PostToolUse. #342's agent process answers once its child ends, and deep mcp serves until it is stopped, so it runs
   * under an alarm that keeps its PID (perl's alarm, then exec) and ends it 15 s on; its reply is out long before.
   */
  async mcp(tool: string, args: Line): Promise<string> {
    const tool_use_id = `toolu_${randomBytes(10).toString('hex')}`;
    const tool_name = `mcp__deep__${tool}`;
    await this.hook('PreToolUse', { tool_name, tool_input: args, tool_use_id });
    const input = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } },
    ].map((m) => `${JSON.stringify(m)}\n`).join('');
    const r = await this.send({ op: 'bash', command: `exec /usr/bin/perl -e 'alarm 15; exec @ARGV' ${sh(NODE, CLI, 'mcp')}`, cwd: this.cwd, input });
    await this.hook('PostToolUse', { tool_name, tool_input: args, tool_use_id, tool_response: String(r.stdout) });
    return `${String(r.stdout)}${String(r.stderr)}`;
  }
}
