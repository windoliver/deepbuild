// Test-side tools for #1347's acceptance tests (README): a world under /tmp/dh1347-* with the real hub (`deep hub run`)
// under a temp HOME, a workspace #67's `deep workspace new` made, its tasks entered with `deep workspace task`, its
// files committed, the played agents (#1332's fixtures/agent.mjs) as `claude` and `codex` first on the login PATH, and
// a forge that is either unreachable (a 127.0.0.1 port that records each connection and answers nothing) or played
// (forge.ts, for the move to a repo). Readings come from the record (`events.read`), the workspace's own git history
// and files, the played agents' own logs and the forges' own records. Nothing here stands in for DeepBuild. No network
// beyond 127.0.0.1, no model; processes are stopped by PID only, and only ones this world started.
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import { allEvents, childEnv, CLI, DEEP_HOOK, DEFAULT_RULES, REPO, SETTINGS, sleep, stopHub, type Ev, type Hub } from '../29/h-d.ts';
import { changed, CHECK, nodeCheck } from '../67/hub.ts';
import { must, mustFail, requirement, waitUntil, type AgentPlan, type Launch, type Line } from '../1332/helpers.ts';
import { FileForge } from './forge.ts';

export { changed, must, mustFail, requirement, sleep, waitUntil };
export type { AgentPlan, Ev, Launch, Line };
export const NODE = process.execPath;
export const MIN = 60_000;
/** The fixture repo a workspace moves to (AC5), and its admin, whose token is the hub's in that world. */
export const SHOP = 'acme/shop';
export const PERSON = 'maya';

/** The criteria's IDs: `#1347.` and the first 8 hex digits of SHA-256 of each criterion's text, white space collapsed (scripts/proof-change.mjs). */
export const AC = { 1: 'AC1 #1347.7361f8e4', 2: 'AC2 #1347.b6ca1fd3', 3: 'AC3 #1347.8994a8fa', 4: 'AC4 #1347.841043a4', 5: 'AC5 #1347.8f5ee69e' } as const;
/** The criteria's text, as the issue says it. */
export const CRITERION = {
  1: 'A fixture workspace with 6 tasks and 7 blocked-by links runs to the end with no forge configured. A planted run that calls a forge fails, naming the call',
  2: 'No task starts before its blockers finish, and a killed session continues as a next attempt, as on a repo',
  3: "A task's verdict names its commit and its state digests. When a source drifts, the verdict goes stale and only the checks reading it run again",
  4: 'Going back one step restores the last version byte for byte',
  5: 'Moving the workspace to a fixture repo files each open task once, with its links',
} as const;
export const named = (n: keyof typeof AC): string => `${AC[n]} ${CRITERION[n]}`;
/** The planted wrong program of AC1 (README: plants): a run over a workspace's tasks that reads or writes a forge. */
export const PLANT = 'workspace-calls-forge';

/** One task as the test enters it: its title, its criteria, and the tasks it is blocked by, as indexes into the list. */
export interface TaskSpec { title: string; criteria: string[]; blockedBy?: number[] }
/** A task entered: its number in the workspace, as `deep workspace task` printed it, and its blockers' numbers. */
export interface Task { n: number; spec: TaskSpec; blockers: number[] }
export interface Ran { code: number | null; stdout: string; stderr: string; json: Line | null }
export const shown = (r: Ran): string => `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;
export const iso = (ms: number | undefined): string => (ms === undefined ? 'never' : new Date(ms).toISOString());
export const real = (p: string): string => { try { return realpathSync(p); } catch { return p; } };

/** A task's own deliverable, which the played agent's `work` rewrites to `done <n>` (fixtures/agent.mjs of #1332). */
export const deliverable = (n: number): string => `src/i${n}.txt`;
/** A task's own check (#67's drafted node:test check), which passes unless its deliverable says BROKEN. */
export const taskCheck = (n: number): { path: string; files: Record<string, string> } => ({
  path: CHECK(`i${n}`), files: nodeCheck(`i${n}`, `!fs.readFileSync('${deliverable(n)}', 'utf8').includes('BROKEN')`),
});
/** A drafted check whose one assertion holds `condition`, JavaScript over `fs` and `state(touch)` (#67's reading of a touch). */
export const stateCheck = (name: string, condition: string): { path: string; files: Record<string, string> } => ({ path: CHECK(name), files: nodeCheck(name, condition) });

const made: string[] = [];
const worlds: World[] = [];
afterAll(async () => {
  for (const w of worlds.splice(0)) await w.close();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 180_000);

// ---- The unreachable forge: what the hub is pointed at when no forge is configured.

/** A 127.0.0.1 port that takes a connection, records its request line, and closes it with no answer. */
export class DeadForge {
  readonly calls: { at: number; line: string }[] = [];
  private constructor(private readonly server: net.Server, readonly url: string) {}
  static async start(): Promise<DeadForge> {
    let forge: DeadForge | undefined;
    const server = net.createServer((sock) => {
      const at = Date.now();
      let got = '';
      let done = false;
      const record = (): void => {
        if (done) return;
        done = true;
        forge!.calls.push({ at, line: got.split('\r\n')[0]!.trim() || `a connection to ${forge!.url} that sent no request` });
        sock.destroy();
      };
      const timer = setTimeout(record, 2000);
      sock.on('data', (d: Buffer) => { got += d.toString('latin1'); if (got.includes('\r\n')) { clearTimeout(timer); record(); } });
      sock.on('end', () => { clearTimeout(timer); record(); });
      sock.on('error', () => undefined);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    forge = new DeadForge(server, `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
    return forge;
  }
  async close(): Promise<void> { await new Promise<void>((resolve) => this.server.close(() => resolve())); }
}

// ---- The world.

const AGENT = fileURLToPath(new URL('../1332/fixtures/agent.mjs', import.meta.url));
const HOOKS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'SessionEnd'];
const TOOL_HOOKS = new Set(['PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure']);
const CODEX_HOOKS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop'];
const newest = (facts: string): string => (JSON.parse(readFileSync(join(REPO, 'adapters', facts), 'utf8')) as { versions: string[] }).versions.at(-1)!;
/** Git as this test runs it, with an identity of its own and no system or global settings. */
const GIT = ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.autocrlf=false'];

export class World {
  hub!: Hub;
  readonly home: string;
  readonly root: string;
  readonly bin: string;
  readonly agents: string;
  readonly loginPath: string;
  /** The workspace `deep workspace new` made: its project id and its folder. */
  id = '';
  folder = '';
  tasks: Task[] = [];
  /** Each task's record item, by number, and the checks its definition names. */
  readonly items = new Map<number, Line>();
  readonly checks = new Map<number, string[]>();
  dead: DeadForge | undefined;
  forge: FileForge | undefined;
  /** In a world with the played forge: the fixture repo's checkout, and maya's token, the hub's GH_TOKEN. */
  checkout: string | undefined;
  token: string | undefined;
  /** The most live played agents seen at once on each task, while `watchLive` samples. */
  readonly maxLive = new Map<number, number>();
  private readonly hubs: Hub[] = [];
  private readonly started = new Set<number>();
  private sampler: NodeJS.Timeout | undefined;
  private constructor(readonly tmp: string, readonly plant: string | undefined) {
    this.home = join(tmp, 'h'); this.root = join(this.home, '.deepbuild'); this.bin = join(tmp, 'bin'); this.agents = join(tmp, 'agents');
    this.loginPath = [this.bin, dirname(NODE), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
  }

  /**
   * A hub with no forge token, pointed at an unreachable forge (`unreachable`) or at the played forge with maya's token
   * and the fixture repo's checkout (`played`), and a workspace made by #67's `deep workspace new <topic>`.
   */
  static async open(o: { topic: string; forge: 'unreachable' | 'played'; plant?: string }): Promise<World> {
    if (!existsSync(CLI)) throw Error(`BLOCKED: the deep CLI (npm run build --workspaces) is not built at ${CLI}`);
    if (!existsSync(DEEP_HOOK)) throw Error(`BLOCKED: deep-hook (cargo build --locked -p deep-hook) is not built at ${DEEP_HOOK}`);
    const tmp = realpathSync(mkdtempSync('/tmp/dh1347-'));
    made.push(tmp);
    const w = new World(tmp, o.plant);
    worlds.push(w);
    mkdirSync(w.root, { recursive: true, mode: 0o700 });
    writeFileSync(join(w.root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
    // No `github` block: no forge identity, no delivery, no agents' app.
    writeFileSync(join(w.root, 'config.json'), `${JSON.stringify({ asks: SETTINGS, runner: { login_path: w.loginPath } }, null, 2)}\n`);
    writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
    for (const f of ['.zprofile', '.zshenv', '.bash_profile', '.profile']) writeFileSync(join(w.home, f), `export PATH="${w.loginPath}"\n`);

    // The played agents, and the hooks setup writes into each agent's own config.
    mkdirSync(w.bin, { recursive: true });
    mkdirSync(w.agents, { recursive: true });
    const program = readFileSync(AGENT, 'utf8').replace(/^#!.*\n/, `#!${NODE}\n`).replace("'__DIR__'", JSON.stringify(w.agents));
    writeFileSync(join(w.bin, 'claude'), program.replace("'__AGENT__'", "'claude'").replace("'__VERSION__'", JSON.stringify(newest('claude-code.facts.json'))), { mode: 0o755 });
    writeFileSync(join(w.bin, 'codex'), program.replace("'__AGENT__'", "'codex'").replace("'__VERSION__'", JSON.stringify(newest('codex.facts.json'))), { mode: 0o755 });
    mkdirSync(join(w.home, '.claude'), { recursive: true });
    writeFileSync(join(w.home, '.claude/settings.json'), `${JSON.stringify({ hooks: Object.fromEntries(HOOKS.map((h) => {
      const entry = { type: 'command', command: `exec '${DEEP_HOOK}' claude-code ${h}` };
      return [h, [TOOL_HOOKS.has(h) ? { matcher: '*', hooks: [entry] } : { hooks: [entry] }]];
    })) }, null, 2)}\n`);
    mkdirSync(join(w.home, '.codex/sessions'), { recursive: true });
    writeFileSync(join(w.home, '.codex/hooks.json'), `${JSON.stringify({ hooks: Object.fromEntries(CODEX_HOOKS.map((h) => [h, [{ hooks: [{ type: 'command', command: `exec '${DEEP_HOOK}' codex ${h}` }] }]])) }, null, 2)}\n`);

    if (o.forge === 'unreachable') w.dead = await DeadForge.start();
    else await w.fixtureRepo();
    writeFileSync(join(tmp, 'drafts.json'), `${JSON.stringify({ drafts: [] }, null, 2)}\n`);
    writeFileSync(join(tmp, 'work.json'), `${JSON.stringify({ readings: [] }, null, 2)}\n`);
    w.writePlan({});
    w.hub = await w.startHub();

    // The workspace, as #67 makes one.
    const space = await w.deep(['workspace', 'new', o.topic], tmp);
    must(space.code === 0 && typeof space.json?.id === 'string' && typeof space.json?.folder === 'string', `#67's \`deep workspace new ${o.topic}\` makes the workspace: ${shown(space)}`);
    w.id = space.json!.id as string;
    w.folder = real(space.json!.folder as string);
    return w;
  }

  /** The played forge with the fixture repo: one commit on main, pushed with maya's token, and the hub's checkout of it. */
  private async fixtureRepo(): Promise<void> {
    this.forge = await FileForge.start(join(this.tmp, 'forge'), SHOP);
    this.token = this.forge.work.gate.person(PERSON, true);
    const seed = join(this.tmp, 'seed');
    mkdirSync(seed);
    await this.git(seed, 'init', '-q', '-b', 'main');
    await this.git(seed, 'remote', 'add', 'origin', this.forge.work.gate.gitUrl(SHOP));
    writeFileSync(join(seed, 'README.md'), '# shop\n');
    await this.git(seed, 'add', '-A');
    await this.git(seed, 'commit', '-q', '-m', 'Start the shop');
    await this.git(seed, 'push', '-q', '-u', 'origin', 'main');
    this.checkout = join(this.tmp, 'checkout');
    await this.git(this.tmp, 'clone', '-q', this.forge.work.gate.gitUrl(SHOP), this.checkout);
  }

  /** git in a folder, as maya with her token on requests to the played forge; resolves with stdout, rejects naming the call. */
  git(cwd: string, ...args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('git', ['-C', cwd, ...GIT, '-c', 'credential.helper=', ...(this.token ? ['-c', `http.extraHeader=Authorization: Bearer ${this.token}`] : []), ...args],
        { encoding: 'utf8', maxBuffer: 64 << 20, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: this.home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } },
        (error, stdout, stderr) => (error ? reject(Error(`git ${args.join(' ')}: ${String(stderr).trim() || error.message}`)) : resolve(stdout)));
    });
  }
  /** git in the workspace's folder, or undefined where git refuses. */
  private wsGit(...args: string[]): Promise<string | undefined> { return this.git(this.folder, ...args).then((o) => o, () => undefined); }

  /** Every child's environment: the test home, the login PATH, the hub's test stand-ins, the forge's address, maya's token where there is one, and the plant. */
  env(): NodeJS.ProcessEnv {
    return childEnv(this.home, {
      PATH: this.loginPath, SHELL: '/bin/zsh', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
      DEEP_HUB_TEST_CONFIRM: join(this.tmp, 'confirm'), DEEP_HUB_TEST_DRAFTS: join(this.tmp, 'drafts.json'), DEEP_HUB_TEST_WORK: join(this.tmp, 'work.json'),
      DEEP_HUB_TEST_FORGE: this.forge?.url ?? this.dead!.url, GH_TOKEN: this.token, GITHUB_TOKEN: undefined, DEEP_HUB_PLANT: this.plant,
    });
  }
  private async startHub(): Promise<Hub> {
    const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: this.tmp, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: this.env() });
    if (child.pid) this.started.add(child.pid);
    let out = '';
    let err = '';
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
    const exit = new Promise<void>((resolve) => child.on('exit', () => resolve()));
    const ready = await Promise.race([
      new Promise<Line | undefined>((resolve) => child.stdout!.setEncoding('utf8').on('data', (d: string) => { out += d; if (out.includes('\n')) { try { resolve(JSON.parse(out.split('\n')[0]!) as Line); } catch { resolve(undefined); } } })),
      exit.then(() => undefined), sleep(120_000).then(() => undefined),
    ]);
    if (ready?.ready !== true) {
      if (child.pid) try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ }
      throw Error(`BLOCKED: the hub${this.plant ? ` with the plant DEEP_HUB_PLANT=${this.plant}` : ''} did not start (a plant the hub doesn't list stops it): ${err.slice(-800)}`);
    }
    const hub: Hub = { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), home: this.home, root: this.root, child, exit, readyAt: Date.now(), clock: undefined, plant: this.plant, stderr: () => err };
    this.hubs.push(hub);
    return hub;
  }
  async close(): Promise<void> {
    if (this.sampler) clearInterval(this.sampler);
    for (const h of this.hubs) for (const pid of descendants(h.pid)) this.started.add(pid);
    for (const h of this.hubs) await stopHub(h).catch(() => undefined);
    for (const l of this.launches(true)) for (const pid of [l.pid, l.ppid]) this.started.add(pid);
    // Only what is still this world's: a process whose command names its folder or this checkout's builds.
    await stopPids([...this.started].filter((pid) => living(pid) && [this.tmp, REPO].some((p) => commandOf(pid).includes(p))));
    await this.dead?.close();
    await this.forge?.close();
  }

  // ---- `deep` as you run it.
  deep(args: string[], cwd = this.folder || this.tmp, timeoutMs = 300_000): Promise<Ran> {
    return new Promise((resolve) => {
      const child = spawn(NODE, [CLI, ...args], { cwd, env: this.env(), stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout!.setEncoding('utf8').on('data', (d: string) => (stdout += d));
      child.stderr!.setEncoding('utf8').on('data', (d: string) => (stderr += d));
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, timeoutMs);
      child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, json: jsonOf(stdout) }); });
    });
  }
  /**
   * Each task entered in order with `deep workspace task <id> <title> --criterion <text>... --blocked-by <n>...`, which
   * prints `{"task": <its number>}` (README: readings). Stops at the first that fails, saying how.
   */
  async enter(specs: TaskSpec[]): Promise<{ tasks: Task[]; failures: string[] }> {
    const tasks: Task[] = [];
    for (const spec of specs) {
      const blockers = (spec.blockedBy ?? []).map((i) => tasks[i]!.n);
      const args = ['workspace', 'task', this.id, spec.title, ...spec.criteria.flatMap((c) => ['--criterion', c]), ...blockers.flatMap((b) => ['--blocked-by', String(b)])];
      const r = await this.deep(args);
      const n = numberOf(r.json?.task);
      if (r.code !== 0 || n === undefined) return { tasks, failures: [`\`deep ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}\` enters the task and prints {"task": <its number>}: ${shown(r)}`] };
      tasks.push({ n, spec, blockers });
    }
    this.tasks = tasks;
    return { tasks, failures: [] };
  }
  /**
   * The run's inputs once the tasks are in: each task's record item found (README: readings), the workspace's files
   * written and committed (each task's deliverable `src/i<n>.txt` saying `open <n>`, each check, `files`, and `touches`
   * in `.deepbuild/workspace.json`), each task's definition handed through DEEP_HUB_TEST_DRAFTS by its item's
   * `source_id`, and the played agents' plan by task number. `missing` names each task with no record item.
   */
  async prepare(o: { requirements?: (t: Task) => Line[]; files?: Record<string, string>; touches?: Line[]; plan?: Record<number, AgentPlan> } = {}): Promise<{ missing: string[] }> {
    const events = await this.events();
    const missing: string[] = [];
    for (const t of this.tasks) {
      const item = events.filter((e) => e.data && e.data.title === t.spec.title && typeof e.data.source_id === 'string' && Array.isArray(e.data.criteria)).at(-1);
      if (item) this.items.set(t.n, item.data);
      else missing.push(`#${t.n} "${t.spec.title}": no event in the record holds it with work.item@1's source_id, title and criteria`);
    }
    if (missing.length) return { missing };
    const files: Record<string, string> = {};
    const drafts: Line[] = [];
    for (const t of this.tasks) {
      files[deliverable(t.n)] = `open ${t.n}\n`;
      const own = taskCheck(t.n);
      const reqs = o.requirements ? o.requirements(t) : [requirement('R1', t.spec.criteria[0]!, own.path)];
      if (!o.requirements) Object.assign(files, own.files);
      this.checks.set(t.n, reqs.map((r) => String(r.check)).sort());
      drafts.push({ issue: this.items.get(t.n)!.source_id, requirements: reqs, deliverables: [], budget: null });
    }
    Object.assign(files, o.files ?? {});
    for (const [path, bytes] of Object.entries(files)) {
      mkdirSync(dirname(join(this.folder, path)), { recursive: true });
      writeFileSync(join(this.folder, path), bytes, { mode: path.endsWith('.sh') ? 0o755 : 0o644 });
    }
    if (o.touches) {
      const named = join(this.folder, '.deepbuild', 'workspace.json');
      writeFileSync(named, `${JSON.stringify({ ...(JSON.parse(readFileSync(named, 'utf8')) as Line), touches: o.touches }, null, 2)}\n`);
    }
    await this.git(this.folder, 'add', '-A');
    await this.git(this.folder, 'commit', '-q', '-m', 'The work the tasks start from');
    writeFileSync(join(this.tmp, 'drafts.json'), `${JSON.stringify({ drafts }, null, 2)}\n`);
    this.writePlan(o.plan ?? {});
    return { missing };
  }
  private writePlan(issues: Record<number, AgentPlan>): void {
    writeFileSync(join(this.agents, 'plan.json'), `${JSON.stringify({ api: this.forge?.url ?? this.dead?.url ?? '', repo: SHOP, node: NODE, cli: CLI, issues }, null, 2)}\n`);
  }
  /** A host's change log (#67's `host` touch): one JSON line a change, an item's value the last line naming it. */
  hostLog(name: string, items: Record<string, unknown>): string {
    const log = join(this.tmp, `${name}.changes.jsonl`);
    writeFileSync(log, '');
    for (const [item, value] of Object.entries(items)) changed(log, item, value);
    return log;
  }

  /** `deep work "<scope>"` in the workspace's folder: the run's one approval, raised; it prints the ask. */
  run(scope: string): Promise<Ran> { return this.deep(['work', scope, '--repo', this.folder, '--json']); }
  /** The approval `deep work` raised through #1330's start.approve(), answered yes on the trusted path with `deep inbox answer`. */
  async approve(asked: Ran): Promise<{ ask: string; approval: Ev }> {
    const ask = asked.json?.ask;
    expect(typeof ask === 'string' && ask.startsWith('ask:'), `deep work "<scope>" --json prints { "ask": "ask:<id>" }, the approval it raised: ${shown(asked)}`).toBe(true);
    const created = await waitUntil(async () => (await this.events()).find((e) => e.kind === 'ask.created' && `ask:${e.id}` === ask), 30_000);
    expect(created, `the record holds ${ask}'s ask.created`).toBeTruthy();
    expect(created!.data.kind, `${ask} is an authority ask`).toBe('authority');
    const approval = (await this.events()).find((e) => e.kind === 'start.approval' && e.data.ask === ask);
    expect(approval, `deep work raises #1330's approval: start.approve() records start.approval naming ${ask}`).toBeTruthy();
    const yes = ((created!.data.options ?? []) as { id: string; decision?: string }[]).find((x) => x.decision === 'allow');
    expect(yes, `${ask} offers a yes: ${JSON.stringify(created!.data.options)}`).toBeTruthy();
    const answered = await this.deep(['inbox', 'answer', ask, yes!.id]);
    expect(answered.code, `deep inbox answer ${ask} ${yes!.id} (${shown(answered)})`).toBe(0);
    return { ask, approval: approval! };
  }

  // ---- Readings.
  events(): Promise<Ev[]> { return allEvents(this.hub); }
  /** The played agents' starts, oldest first; ones that played no session (a subcommand) only with `all`. */
  launches(all = false): Launch[] {
    const dir = join(this.agents, 'log');
    if (!existsSync(dir)) return [];
    const out: Launch[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) { try { out.push(JSON.parse(readFileSync(join(dir, f), 'utf8')) as Launch); } catch { /* being written */ } }
    return out.filter((l) => all || !l.refused).sort((a, b) => a.started - b.started);
  }
  on(n: number): Launch[] { return this.launches().filter((l) => l.issue === n); }
  /** Lets a `gated` played agent on the task go on. */
  go(n: number): void { writeFileSync(join(this.agents, `go-${n}`), ''); }
  /** A played agent stopped hard, mid-turn, by its PID (only one this world started). */
  kill(l: Launch): void {
    if (!living(l.pid) || !commandOf(l.pid).includes(this.tmp)) throw Error(`BLOCKED: the played agent ${l.pid} is not this world's live agent`);
    process.kill(l.pid, 'SIGKILL');
  }
  /** Samples how many played agents live on each task at once, every half second, into `maxLive`. */
  watchLive(): void {
    this.sampler = setInterval(() => {
      const count = new Map<number, number>();
      for (const l of this.launches()) if (l.issue !== null && l.ended === undefined && /^[^Z]+$/.test(statOf(l.pid))) count.set(l.issue, (count.get(l.issue) ?? 0) + 1);
      for (const [n, c] of count) this.maxLive.set(n, Math.max(this.maxLive.get(n) ?? 0, c));
    }, 500);
  }

  /** The workspace's default branch, `main` (#67 makes it), as it stands. */
  async head(): Promise<string | undefined> { return (await this.wsGit('rev-parse', '--verify', '--quiet', 'refs/heads/main'))?.trim() || undefined; }
  /** Whether a commit of the workspace holds the task's change: its deliverable reads `done <n>`. */
  async holds(commit: string, n: number): Promise<boolean> { return (await this.wsGit('cat-file', '-p', `${commit}:${deliverable(n)}`)) === `done ${n}\n`; }
  /** Whether a commit is in the workspace's own history: an ancestor of its default branch, or its head. */
  async onMain(commit: string): Promise<boolean> { return (await this.wsGit('merge-base', '--is-ancestor', commit, 'refs/heads/main')) !== undefined; }
  /** The PASS verdicts on the task's own checks: the verdict.made events whose requirements name exactly them. */
  passes(events: readonly Ev[], n: number): Ev[] {
    const want = JSON.stringify(this.checks.get(n) ?? []);
    return events.filter((e) => e.kind === 'verdict.made' && e.data.outcome === 'PASS' && Array.isArray(e.data.requirements)
      && JSON.stringify((e.data.requirements as { check?: string }[]).map((r) => String(r.check)).sort()) === want);
  }
  /** Every verdict on the task's own checks, whatever its outcome, by handle. */
  verdictsOf(events: readonly Ev[], n: number): Set<string> {
    const want = JSON.stringify(this.checks.get(n) ?? []);
    return new Set(events.filter((e) => e.kind === 'verdict.made' && Array.isArray(e.data.requirements)
      && JSON.stringify((e.data.requirements as { check?: string }[]).map((r) => String(r.check)).sort()) === want).map((e) => String(e.data.verdict)));
  }
  /** When the workspace's default branch first held the task's change, from the branch's own reflog (to the second, rounded down). */
  async landedAt(n: number): Promise<number | undefined> {
    const log = (await this.wsGit('reflog', 'show', '--date=unix', '--format=%H %gd', 'refs/heads/main')) ?? '';
    for (const line of log.trim().split('\n').reverse()) {
      const m = /^([0-9a-f]{40}) \S*@\{(\d+)\}$/.exec(line.trim());
      if (m && (await this.holds(m[1]!, n))) return Number(m[2]) * 1000;
    }
    return undefined;
  }
  /**
   * Whether the task finished (README: readings): the workspace's default branch holds its change, and a PASS on its
   * own checks covers a commit of that branch holding the change. `verdict` is the newest such PASS, the task's
   * verdict; `at` is when it finished, the later of the first such PASS and the branch first holding the change.
   */
  async finish(n: number, events?: readonly Ev[]): Promise<{ verdict: Ev; at: number } | undefined> {
    const main = await this.head();
    if (!main || !(await this.holds(main, n))) return undefined;
    const covering: Ev[] = [];
    for (const v of this.passes(events ?? await this.events(), n)) {
      const commit = String(v.data.commit);
      if (await this.onMain(commit) && await this.holds(commit, n)) covering.push(v);
    }
    if (!covering.length) return undefined;
    return { verdict: covering.at(-1)!, at: Math.max(covering[0]!.ts, (await this.landedAt(n)) ?? 0) };
  }
  /** The tasks that haven't finished, each with what it lacks, for a failure message. */
  async unfinished(only: Task[] = this.tasks): Promise<string[]> {
    const events = await this.events();
    const main = await this.head();
    const out: string[] = [];
    for (const t of only) {
      if (await this.finish(t.n, events)) continue;
      const onMain = main ? await this.holds(main, t.n) : false;
      out.push(`#${t.n}: ${onMain ? 'its change is on main' : 'its change is not on main'}, ${this.passes(events, t.n).length} PASS on its checks, ${this.on(t.n).length} attempts`);
    }
    return out;
  }
  /** A commit's files, by path: whether it can run and its bytes, as git holds them. */
  async version(commit: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const list = (await this.git(this.folder, 'ls-tree', '-r', '-z', commit)).split('\0').filter(Boolean);
    for (const entry of list) {
      const m = /^(\d+) (\w+) ([0-9a-f]+)\t(.+)$/s.exec(entry);
      if (!m || m[2] !== 'blob') continue;
      const bytes = execFileSync('git', ['-C', this.folder, 'cat-file', 'blob', m[3]!], { maxBuffer: 64 << 20 });
      out[m[4]!] = `${m[1] === '100755' ? 'x' : '-'} ${bytes.toString('base64')}`;
    }
    return out;
  }
  /** Every file of the workspace's folder but git's own: whether it can run and its bytes. */
  files(): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir).sort()) {
        if (name === '.git') continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else out[relative(this.folder, path)] = `${statSync(path).mode & 0o111 ? 'x' : '-'} ${readFileSync(path).toString('base64')}`;
      }
    };
    walk(this.folder);
    return out;
  }
}

// ---- Readings of the record.
/** A task's number from what names it: a number, `#<n>`, or an ID ending in `#<n>`. */
export function numberOf(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) return v;
  const m = typeof v === 'string' ? /(?:^|#)(\d+)$/.exec(v.trim()) : null;
  return m ? Number(m[1]) : undefined;
}
/**
 * The tasks a record item says it is blocked by: its `blocked_by` (or `blockedBy`, `blockers`) list, each entry a
 * task's number, `#<n>`, the source_id of another task's item, or an object naming one of those.
 */
export function blockedByOf(item: Line, items: ReadonlyMap<number, Line>): number[] | undefined {
  const key = Object.keys(item).find((k) => /^(blocked_?by|blockers)$/i.test(k));
  if (!key || !Array.isArray(item[key])) return undefined;
  const one = (v: unknown): number | undefined => {
    if (v && typeof v === 'object') { const o = v as Line; return one(o.source_id ?? o.task ?? o.number ?? o.issue); }
    for (const [n, other] of items) if (typeof v === 'string' && other.source_id === v) return n;
    return numberOf(v);
  };
  return (item[key] as unknown[]).map(one).filter((n): n is number => n !== undefined).sort((a, b) => a - b);
}

// ---- Processes: stopped by PID only, and only ones this world started.
function jsonOf(stdout: string): Line | null {
  try { const v = JSON.parse(stdout) as unknown; if (v && typeof v === 'object') return v as Line; } catch { /* lines */ }
  for (const line of stdout.split('\n').reverse()) { if (line.trim().startsWith('{')) { try { return JSON.parse(line) as Line; } catch { /* next */ } } }
  return null;
}
function living(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
/** A process's state letters (`Z` for one that has exited and waits to be reaped), or '' for one that is gone. */
function statOf(pid: number): string {
  try { return execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim(); } catch { return ''; }
}
function commandOf(pid: number): string {
  try { return execFileSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim(); } catch { return ''; }
}
function descendants(root: number): number[] {
  const table = spawnSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).stdout.trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number) as [number, number]);
  const out: number[] = [];
  const walk = (p: number): void => { for (const [pid, ppid] of table) if (ppid === p && !out.includes(pid)) { out.push(pid); walk(pid); } };
  walk(root);
  return out;
}
async function stopPids(pids: number[]): Promise<void> {
  for (const pid of pids) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while (pids.some(living) && Date.now() < deadline) await sleep(100);
  for (const pid of pids) if (living(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
}
