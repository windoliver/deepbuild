// Test-side tools for #342's acceptance tests (README): a world (`deep hub run` on an installed root of this suite's own),
// a desktop session played through the real deep-hook binary under an agent process of its own, its transcript or rollout
// written where and as the agent writes it, and what Docker shows. Nothing here stands in for the hub, the archive,
// env-local or Docker; only the desktop apps, which fire the hooks #80 recorded, and the outside provider are played. The
// #332 suite's process tools and client and the #580 suite's reading of a budget are imported, never copied.
//
// Safety: folders are under /tmp/dh332-* (made by the #332 helpers); HOME is a temp folder for this process and every
// child, so no real ~/.claude, ~/.codex or ~/.deepbuild is read; agent processes and hubs are stopped by PID; Docker
// objects are removed only by the project a `deep env up` here reported, or the volume name a test made. No model, no
// sign-in, no registry. DOCKER_HOST and DOCKER_CONFIG must name the real Docker setup, since HOME here is a temp folder (README, Run them).

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { shipped, type JsonObject } from '../../../packages/adapters/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { SETTINGS } from '../29/h-d.ts';
import { alive, childEnv, Client, CLI, git, home, jsonOut, NODE, own, REPO, sleep, tempDir, waitFor, type Hub, type Line, type Ran } from '../332/helpers.ts';

export { Client, sleep, waitFor, type Hub, type Line };
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const SECOND = 1000;
/** Codex Desktop removes a deleted thread's rollout this long after SessionEnd (#80). */
export const ROLLOUT_LEFT_MS = 31 * SECOND;
/** A session's volumes are reaped within this of its end (AC4). */
export const REAP_MS = 30 * SECOND;
/** The image the compose sample runs; a missing one is BLOCKED, naming it. */
export const IMAGE = 'busybox:1.36';

/** `<letters of the session ID>`, as a handle holds it. */
export const letters = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');
const newestVersion = (agent: string): string => {
  const versions = (shipped().get(agent).facts as JsonObject).versions as string[];
  return versions[versions.length - 1]!;
};

// ---- The world.
const opened: World[] = [];
const agents = new Set<Agent>();
export interface World { hub: Hub; client: Client; root: string; repo: string; plant: string | undefined; projects: Set<string>; volumes: Set<string> }
async function runHub(root: string, plant: string | undefined): Promise<Hub> {
  const child: ChildProcess = spawn(NODE, [CLI, 'hub', 'run'], {
    cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    env: childEnv({ DEEP_HUB_PLANT: plant, DEEP_HUB_TEST_FORGE: 'http://127.0.0.1:9', DEEP_HUB_TEST_CONFIRM: join(root, '..', 'confirm'), DEEP_HUB_TEST_DRAFTS: join(root, '..', 'drafts.json'), DEEP_HUB_TEST_WORK: join(root, '..', 'work.json') }),
  });
  own(child.pid);
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
  if (ready?.ready !== true) throw Error(`BLOCKED: the hub${plant ? ` with the plant DEEP_HUB_PLANT=${plant}` : ''} did not start: ${err.slice(-800)}`);
  return { pid: child.pid!, root, socket: String(ready.socket), child, exit, stderr: () => err };
}
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  await Promise.race([hub.exit, sleep(30_000)]);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
}
/** A home with the hub's root laid out as an installed hub's, a git repo with `files`, and the hub on it. */
export async function openWorld(o: { plant?: string; files?: Record<string, string> } = {}): Promise<World> {
  if (!existsSync(CLI)) throw Error(`BLOCKED: the deep CLI (npm run build --workspaces) is not built at ${CLI}`);
  if (!existsSync(DEEP_HOOK)) throw Error(`BLOCKED: deep-hook (cargo build --locked -p deep-hook) is not built at ${DEEP_HOOK}`);
  const h = home();
  const root = join(h, '.deepbuild');
  rmSync(root, { recursive: true, force: true });
  rmSync(join(h, '.claude'), { recursive: true, force: true });
  rmSync(join(h, '.codex'), { recursive: true, force: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  copyFileSync(join(REPO, 'crates/deep-hook/default-rules.json'), join(root, 'rules.json'));
  // The hub refuses an ask with no deadline or default in your settings, so a world needs them as setup writes them.
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS }, null, 2)}\n`);
  writeFileSync(join(h, 'confirm'), 'confirmed\n');
  writeFileSync(join(h, 'drafts.json'), `${JSON.stringify({ drafts: [] })}\n`);
  writeFileSync(join(h, 'work.json'), `${JSON.stringify({ readings: [] })}\n`);
  const dir = tempDir();
  const repo = join(dir, 'repo');
  for (const [path, text] of Object.entries({ '.gitignore': '.pids/\n', 'README.md': 'a sample\n', ...o.files })) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
    if (path.startsWith('bin/')) chmodSync(join(repo, path), 0o755);
  }
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'the sample');
  const hub = await runHub(root, o.plant);
  const w: World = { hub, client: await Client.open(hub), root, repo, plant: o.plant, projects: new Set(), volumes: new Set() };
  opened.push(w);
  return w;
}
/** The hub stopped and started again on the same root: the archive's pass runs at start (#20). */
export async function restartHub(w: World): Promise<void> {
  w.client.close();
  await stopHub(w.hub);
  w.hub = await runHub(w.root, w.plant);
  w.client = await Client.open(w.hub);
}
/** Everything this file left: agents and hubs by PID, Docker objects by the names it recorded. */
export async function closeWorlds(): Promise<void> {
  for (const a of agents) a.stop();
  agents.clear();
  for (const w of opened.splice(0)) {
    w.client.close();
    await stopHub(w.hub);
    for (const p of w.projects) {
      const ids = containers(p);
      if (ids.length) docker(['rm', '-f', ...ids], 120_000);
      const left = composeVolumes(p);
      if (left.length) docker(['volume', 'rm', '-f', ...left], 120_000);
      docker(['network', 'rm', `${p}_default`]);
    }
    for (const v of w.volumes) docker(['volume', 'rm', '-f', v]);
  }
}
export const events = (w: World, kind?: string): Promise<Line[]> => w.client.events(kind);
export const pos = async (w: World): Promise<number> => (await events(w)).reduce((a, e) => Math.max(a, Number(e.log_pos)), 0);
const state = (w: World): string => `the hub (pid ${w.hub.pid}) ${alive(w.hub.pid) ? 'runs' : 'has exited'}, its stderr ends ${JSON.stringify(w.hub.stderr().slice(-300))}`;
export async function until<T>(w: World, probe: () => Promise<T | undefined | false> | T | undefined | false, ms: number, what: string): Promise<T> {
  return waitFor(probe, ms, `${what}; ${state(w)}`);
}

// ---- A session's agent process.
/**
 * The agent's program, placed where an npm install of Claude Code puts it: the hub takes a session's resume from a new
 * process only when that process's arguments read as Claude Code's (#1033), which fixtures/agent.mjs's own path wouldn't.
 */
function agentProgram(): string {
  const folder = join(tempDir(), 'node_modules/@anthropic-ai/claude-code');
  mkdirSync(folder, { recursive: true });
  copyFileSync(join(FIXTURES, 'agent.mjs'), join(folder, 'cli.mjs'));
  return join(folder, 'cli.mjs');
}
class Agent {
  private n = 0;
  private buffer = '';
  private readonly pending = new Map<number, (r: Line) => void>();
  readonly exit: Promise<void>;
  private constructor(private readonly child: ChildProcess) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const line = JSON.parse(this.buffer.slice(0, i)) as Line;
        this.buffer = this.buffer.slice(i + 1);
        this.pending.get(line.n as number)?.(line);
        this.pending.delete(line.n as number);
      }
    });
    child.stdin!.on('error', () => undefined);
    this.exit = new Promise((resolve) => child.on('exit', () => {
      for (const [n, done] of [...this.pending]) { this.pending.delete(n); done({ n, code: null, stdout: '', stderr: 'the agent process exited' }); }
      agents.delete(this);
      resolve();
    }));
  }
  static start(agent: 'claude' | 'codex'): Agent {
    const env = agent === 'claude' ? { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' } : {};
    const a = new Agent(spawn(NODE, [agentProgram(), DEEP_HOOK], { cwd: tempDir(), env: childEnv(env), stdio: ['pipe', 'pipe', 'ignore'] }));
    agents.add(a);
    return a;
  }
  get pid(): number { return this.child.pid!; }
  send(command: Line): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve) => {
      this.pending.set(n, resolve);
      this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    });
  }
  /** Stopped by its PID at the end of a test. */
  stop(): void { try { process.kill(this.pid, 'SIGKILL'); } catch { /* gone */ } }
}

// ---- A desktop session.
export type Kind = 'claude' | 'codex';
const stamp = (d: Date): string => d.toISOString().slice(0, 19).replace(/:/g, '-');
/** A session in the Claude desktop app or Codex Desktop: its hooks, its transcript or rollout, and its Bash tool. */
export class Session {
  readonly id = randomUUID();
  readonly handle: string;
  /** Where the rollout or transcript is now. */
  transcript: string;
  /** Each line written, as the source reads. */
  readonly lines: string[] = [];
  agent: Agent;
  private readonly version: string;
  private parent: string | null = null;
  private prompt = randomUUID();
  private readonly turn = randomUUID();
  constructor(readonly kind: Kind, readonly cwd: string) {
    this.handle = `session:${letters(this.id)}`;
    this.agent = Agent.start(kind);
    this.version = newestVersion(kind);
    const d = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    this.transcript = kind === 'claude'
      ? join(home(), '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`)
      : join(home(), '.codex/sessions', String(d.getUTCFullYear()), pad(d.getUTCMonth() + 1), pad(d.getUTCDate()), `rollout-${stamp(d)}-${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    if (kind === 'codex') this.write(JSON.stringify({ timestamp: d.toISOString(), type: 'session_meta', payload: { session_id: this.id, id: this.id, timestamp: d.toISOString(), cwd, originator: 'Codex Desktop', cli_version: this.version, source: 'vscode' } }));
  }
  private write(line: string): void {
    this.lines.push(line);
    appendFileSync(this.transcript, `${line}\n`);
  }
  /** One message of yours in the transcript or rollout, as the agent writes it. */
  said(text: string): void {
    const at = new Date().toISOString();
    const uuid = randomUUID();
    this.write(JSON.stringify(this.kind === 'claude'
      ? { parentUuid: this.parent, isSidechain: false, type: 'user', message: { role: 'user', content: text }, uuid, timestamp: at, userType: 'external', entrypoint: 'claude-desktop', cwd: this.cwd, sessionId: this.id, version: this.version, gitBranch: 'main', promptId: this.prompt, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' }
      : { timestamp: at, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }));
    this.parent = uuid;
  }
  /** deep-hook, the hook's JSON on stdin, as a child of the session's agent process. */
  async hook(event: string, fields: Line = {}): Promise<Line> {
    const body: Line = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', ...(this.kind === 'claude' ? { prompt_id: this.prompt } : { model: 'gpt-reserve', ...(event === 'SessionStart' || event === 'SessionEnd' ? {} : { turn_id: this.turn }) }), ...fields };
    return this.agent.send({ op: 'hook', args: [this.kind === 'claude' ? 'claude-code' : 'codex', event], cwd: this.cwd, input: JSON.stringify(body) });
  }
  /** The session starts, and the hub comes to know its agent process: two hooks name a process it then watches. */
  async start(source: 'startup' | 'resume' = 'startup'): Promise<void> {
    if (source === 'startup') this.said('look after the shop');
    const r = await this.hook('SessionStart', { source, ...(this.kind === 'claude' ? { model: 'claude-haiku-5-5' } : {}) });
    if (r.code !== 0) throw Error(`BLOCKED: deep-hook's SessionStart ended with ${r.code}: ${String(r.stderr).slice(-400)}`);
    await this.hook('UserPromptSubmit', { prompt: 'look after the shop' });
    await this.bash('true');
  }
  /** One call of the Bash tool: PreToolUse, the command as this agent's child, PostToolUse with what it printed. */
  async bash(command: string): Promise<Ran> {
    const tool_use_id = `toolu_${randomBytes(10).toString('hex')}`;
    const tool_input = { command, description: 'Run a command' };
    await this.hook('PreToolUse', { tool_name: 'Bash', tool_input, tool_use_id });
    const r = await this.agent.send({ op: 'bash', command, cwd: this.cwd });
    const ran: Ran = { code: r.code as number | null, stdout: String(r.stdout), stderr: String(r.stderr) };
    await this.hook('PostToolUse', { tool_name: 'Bash', tool_input, tool_use_id, tool_response: { stdout: ran.stdout, stderr: ran.stderr, interrupted: false, isImage: false } });
    return ran;
  }
  /** `deep env up` through the Bash tool, which must come up. */
  async envUp(): Promise<Line> {
    const ran = await this.bash(`'${NODE}' '${CLI}' env up --json`);
    const out = jsonOut(ran);
    expect(out?.status, `deep env up in ${this.cwd} is ready (exit ${ran.code}, stdout ${ran.stdout.slice(-500)}, stderr ${ran.stderr.slice(-500)})`).toBe('ready');
    return out!;
  }
  /** SessionEnd, reason other: what a desktop app fires before it deletes or archives a session (#80). */
  async end(): Promise<number> {
    const at = Date.now();
    await this.hook('SessionEnd', { reason: 'other' });
    return at;
  }
  /** SIGKILL to the agent's process: no hook fires. */
  async kill(): Promise<void> {
    process.kill(this.agent.pid, 'SIGKILL');
    await this.agent.exit;
  }
  /** A new process of the agent takes the same session up again, as `--resume` does. */
  async resume(): Promise<void> {
    this.agent = Agent.start(this.kind);
    await this.start('resume');
  }
  /** Codex Desktop's Archive: the rollout moves to ~/.codex/archived_sessions, and no hook fires (#80). */
  archiveCodex(): void {
    const to = join(home(), '.codex/archived_sessions', this.transcript.split('/').at(-1)!);
    mkdirSync(dirname(to), { recursive: true });
    renameSync(this.transcript, to);
    this.transcript = to;
  }
  removeSource(): void { rmSync(this.transcript); }
}
export async function session(w: World, kind: Kind, cwd = w.repo): Promise<Session> {
  const s = new Session(kind, cwd);
  await s.start();
  return s;
}

/**
 * A check runs in a sandbox that reads only the folder its Node sits in, so a Node linked to libraries elsewhere, as
 * Homebrew's is, dies at load in every sandboxed check, and no check can pass or fail on this machine. That is BLOCKED,
 * naming it, never read as the work's failure or pass (README, Run them).
 */
export function checksCanRun(): void {
  const node = realpathSync(NODE);
  const linked = spawnSync('otool', ['-L', node], { encoding: 'utf8' }).stdout ?? '';
  const outside = linked.split('\n').slice(1).map((l) => l.trim().split(' ')[0]!).filter((lib) => lib.startsWith('/') && !lib.startsWith('/usr/lib/') && !lib.startsWith('/System/') && !lib.startsWith(dirname(node)));
  if (outside.length) throw Error(`BLOCKED: the Node here (${node}) links ${outside.length} libraries outside its own folder, such as ${outside[0]}, which the check sandbox can't read, so no check can run; use the repo's Node from .node-version as nodejs.org builds it`);
}

// ---- What the archive left.
/** The session's transcript.archived events, in log order. */
export const copiesOf = async (w: World, s: Session): Promise<Line[]> => (await events(w, 'transcript.archived')).filter((e) => e.data?.session === s.handle);
/** The text of an archived copy, read back from the evidence store by its hash. */
export async function copyText(w: World, copy: Line): Promise<string> {
  const store = await openEvidenceStore({ root: join(w.root, 'evidence'), now: Date.now });
  return Buffer.from(await store.read(String(copy.data.evidence))).toString('utf8');
}
/** Waits for the copy that holds `tail`; undefined past `ms`. */
export async function copyHolding(w: World, s: Session, tail: string, ms: number): Promise<{ copy: Line; text: string } | undefined> {
  return waitFor(async () => {
    for (const copy of (await copiesOf(w, s)).reverse()) {
      const text = await copyText(w, copy);
      if (text.includes(tail)) return { copy, text };
    }
    return undefined;
  }, ms, `${s.handle}'s copy`).catch(() => undefined);
}

// ---- Docker. A missing daemon, compose or image is BLOCKED, naming it; nothing is pulled.
export function docker(args: string[], timeoutMs = 60_000): { code: number | null; stdout: string; stderr: string } {
  const r = spawnSync('docker', args, { encoding: 'utf8', env: childEnv(), timeout: timeoutMs });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? String(r.error ?? '') };
}
export function dockerReady(): void {
  const info = docker(['info', '--format', '{{.ServerVersion}}'], 30_000);
  if (info.code !== 0) throw Error(`BLOCKED: the Docker daemon is unreachable (docker info: ${info.stderr.trim().split('\n').slice(-1)[0] || `exit ${info.code}`}); set DOCKER_HOST and DOCKER_CONFIG (README, Run them)`);
  if (docker(['compose', 'version'], 30_000).code !== 0) throw Error('BLOCKED: docker compose is not found; set DOCKER_CONFIG to the folder that names its plugin (README, Run them)');
  if (docker(['image', 'inspect', IMAGE], 30_000).code !== 0) throw Error(`BLOCKED: the image ${IMAGE} isn't local; run docker pull ${IMAGE} once`);
}
const listed = (out: string): string[] => out.split('\n').filter(Boolean);
export const containers = (project: string): string[] => listed(docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`]).stdout);
export const composeVolumes = (project: string): string[] => listed(docker(['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`]).stdout);
export const volumeExists = (name: string): boolean => docker(['volume', 'inspect', name]).code === 0;
/** A volume's identity: a name can come back on a later stack, its creation time doesn't. A gone volume reads as its name alone. */
export const volumeId = (name: string): string => `${name} ${docker(['volume', 'inspect', '--format', '{{.CreatedAt}}', name]).stdout.trim()}`.trim();
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

/**
 * The compose sample: one service, `data` a named volume it writes to, `web` the leased port. Its health file is written
 * inside the container, since a bind mount from /tmp reaches no daemon that runs in a VM sharing only HOME (Colima).
 */
const COMPOSE = [
  'name: shop',
  'services:',
  '  web:',
  `    image: ${IMAGE}`,
  '    command: ["sh", "-c", "mkdir -p /www && echo ok > /www/health && echo up >> /data/starts && exec httpd -f -p 3000 -h /www"]',
  '    volumes: ["data:/data"]',
  '    ports: ["${web}:3000"]',
  'volumes:',
  '  data: {}',
  '',
].join('\n');
export const STACK_FILES: Record<string, string> = {
  'docker-compose.yml': COMPOSE,
  '.deepbuild/done.yaml': ['environment:', '  compose: docker-compose.yml', '  ports: [web]', `  ready: { http: ${JSON.stringify('http://127.0.0.1:${web}/health')}, within: 120 }`, ''].join('\n'),
};
/** The world's session has run `deep env up`: the project it reported, and the named volume that stack made. */
export interface Up { project: string; volume: string; port: number }
export async function stackOf(w: World, s: Session): Promise<Up> {
  const out = await s.envUp();
  const project = out.project as string;
  expect(typeof project === 'string' && project.length > 0, `deep env up names its compose project (${JSON.stringify(out)})`).toBe(true);
  w.projects.add(project);
  const volume = `${project}_data`;
  expect(composeVolumes(project), `the stack's named volume ${volume}`).toContain(volume);
  return { project, volume, port: out.ports.web as number };
}
/** A name for a volume made here, recorded so it's removed afterwards. */
export function bareName(w: World): string {
  const name = `dh342-bare-${randomBytes(4).toString('hex')}`;
  w.volumes.add(name);
  return name;
}
/** ms from `from` until the volume is gone, or undefined when it still stands `ms` after `from`. */
export async function goneAfter(volume: string, from: number, ms: number): Promise<number | undefined> {
  for (;;) {
    if (!volumeExists(volume)) return Date.now() - from;
    if (Date.now() - from > ms) return undefined;
    await sleep(100);
  }
}

// ---- Criterion tags: `#342.<first 8 hex of the SHA-256 of the criterion's text>`, as scripts/proof-change.mjs computes them.
export const AC1 = 'AC1 #342.c44dce7a';
export const AC2 = 'AC2 #342.af0f0d14';
export const AC3 = 'AC3 #342.f889fe59';
export const AC4 = 'AC4 #342.70f069fa';
export const AC5 = 'AC5 #342.fe43a696';
export const AC6 = 'AC6 #342.d43f4556';
