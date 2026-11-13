// Test-side tools for #1332's acceptance tests (README): a world under /tmp/dh1332-* with the fixture forge (forge.ts,
// on #1331's and #1325's), a shop repo whose issues carry their blocked-by links and `Runs on:` lines, the hub's checkout
// of it, the real hub (`deep hub run`) with the forge as its GitHub and an agents' app for sessions' own credentials,
// the played agents (fixtures/agent.mjs) as `claude` and `codex` first on the login PATH, `deep` as you run it, and
// readings of the forge, the record and the played agents' own logs. Nothing here stands in for DeepBuild: the hub, its
// record, #1330's starts, the gate's runs, #1331's landing and deep-hook are real. Only the forge (GitHub) and the
// agents (and their model) are played. No network beyond 127.0.0.1, no model; processes are stopped by PID only.
import { AssertionError } from 'node:assert';
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, type TestContext } from 'vitest';
import { allEvents, childEnv, CLI, DEEP_HOOK, DEFAULT_RULES, REPO, SETTINGS, sleep, stopHub, type Ev, type Hub } from '../29/h-d.ts';
import { WorkForge } from './forge.ts';

export { sleep };
export type { Ev };
export const NODE = process.execPath;
export const SHOP = 'acme/shop';
export const PERSON = 'maya';
export const MIN = 60_000;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };

/** The criteria's IDs: `#1332.` and the first 8 hex digits of SHA-256 of each criterion's text, white space collapsed (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #1332.09a2eb02', 2: 'AC2 #1332.4a073ef1', 3: 'AC3 #1332.0ec9d14a', 4: 'AC4 #1332.59986399', 5: 'AC5 #1332.02e0e76f',
  6: 'AC6 #1332.479b1c3f', 7: 'AC7 #1332.dc2b15bb', 8: 'AC8 #1332.6efb16d5', 9: 'AC9 #1332.13dcebe8',
} as const;
/** The criteria's text, as the issue says it. */
export const CRITERION = {
  1: 'On a fixture repo with 6 issues and 7 blocked-by links, one approval runs the set to the end with no app running, and no issue starts before its blockers are done. A planted run that starts one early fails, naming both issues',
  2: 'A blocker closed with its PR unmerged keeps its dependents waiting, naming the PR. One on the baseline list satisfies the link and reads closed before the gate, never PASS',
  3: 'A session killed mid-turn continues as a next attempt in the same worktree with its uncommitted files intact. No issue ever has two live attempts, including across a hub restart',
  4: 'A third replaced attempt raises one ask, and the other issues go on',
  5: 'An issue raising a taste ask gives up its slot within 10 s, and takes the next free one after the answer',
  6: "An issue whose `Runs on:` names a machine the host can't serve starts nothing and reads what it waits for",
  7: '`deep work show` prints the same state words as the record. A planted reader that takes a state from a comment fails, naming the issue',
  8: 'Three attempts on one issue, in Claude Code, then Codex, then Claude Code with another model, each replaced, raise one ask listing the three with agent, model and cause. A planted breaker that counts per agent lets a fourth start and fails, naming the attempt',
  9: "A blocker whose change landed with only a budget window's requirement open, its issue still open naming that requirement, satisfies its dependents' link, and they start. A planted run that keeps them waiting for the window fails, naming both issues",
} as const;
export const named = (n: keyof typeof AC): string => `${AC[n]} ${CRITERION[n]}`;

for (const key of Object.keys(process.env)) if (/^(CLAUDE|DEEP_|CODEX|GH_|GITHUB_|GIT_)/.test(key)) delete process.env[key];

// ---- The repo. Every issue has its suite at the base (`tests/acceptance/<n>/`, so no blind job drafts one) and one
// check, `.deepbuild/checks/i<n>.sh`, a `node --test` of that suite, which reads `src/i<n>.txt` and fails on BROKEN.
export const checkFile = (n: number): string => `.deepbuild/checks/i${n}.sh`;
/** Where the baseline commit lists the issues closed before the gate (README: readings). */
export const BASELINE = '.deepbuild/closed-before-gate.json';
const suiteOf = (n: number): string => [
  "import assert from 'node:assert/strict';",
  "import { readFileSync } from 'node:fs';",
  "import { test } from 'node:test';",
  `test('the shop does ${n}', () => {`,
  `  assert.doesNotMatch(readFileSync(new URL('../../../src/i${n}.txt', import.meta.url), 'utf8'), /BROKEN/);`,
  '});', '',
].join('\n');

/** A requirement of a handed definition (#29's shape, as #1331's suite hands one). */
export const requirement = (id: string, text: string, check: string | null, extra: Line = {}): Line => ({
  id, text, source_line: 'ask#L1', refuted_by: `a run where ${text.toLowerCase()} does not hold`, check, on_base: 'passes', asserts: [], depth: 'unit', oracle: 'code', near_misses: [], ...extra,
});

/** One issue of the shop, in order from #100. */
export interface IssueSpec {
  blockedBy?: number[];
  /** The body's `Runs on:` line. */
  runsOn?: string;
  /** Closed by maya before the run: `before-gate` is on the baseline list, `after-gate` is not. */
  closed?: 'before-gate' | 'after-gate';
  /** The handed definition's requirements; one requirement on the issue's own check by default. */
  requirements?: Line[];
}
/** What a played agent's turn does on each start on an issue (fixtures/agent.mjs), and the models it reports. */
export interface AgentPlan { launches: ('work' | 'replaced' | 'hang' | 'gated' | 'taste')[]; models?: Record<string, string[]> }
/** A pull request from before the run: `files` written on a branch of main, its body linking the issue. */
export interface PrSpec { issue: number; branch: string; files: Record<string, string>; body?: string }

/** One start of a played agent, as its own log says it (fixtures/agent.mjs). */
export interface Launch {
  pid: number; ppid: number; agent: 'claude-code' | 'codex'; issue: number | null; launch: number; behavior: string; model: string; session: string; cwd: string; branch: string;
  started: number; prompt: string | null; steps: { what: string; at: number }[]; found: { status: string; notes: Record<string, string> };
  notes?: string; hanging?: number; worked?: number; answered?: number; stopAt?: number; ended?: number; refused?: string;
}
export interface Ran { code: number | null; stdout: string; stderr: string; json: Line | null }
export const shown = (r: Ran): string => `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;
/** `deep work show`'s rows by issue: the state word and the whole row's text (what it waits for among it). */
export interface Shown { ran: Ran; rows: Map<number, { word: string; text: string }> }

const made: string[] = [];
const worlds: World[] = [];
afterAll(async () => {
  for (const w of worlds.splice(0)) await w.close();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 180_000);

/** The agents' app: a session's own credential is one of its installation tokens (#1325). */
const AGENTS_APP = { id: 913252, slug: 'deepbuild-agents', service: 'deepbuild.github.agents' };
const HOOKS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'SessionEnd'];
const TOOL_HOOKS = new Set(['PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure']);
const CODEX_HOOKS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop'];
const newest = (facts: string): string => (JSON.parse(readFileSync(join(REPO, 'adapters', facts), 'utf8')) as { versions: string[] }).versions.at(-1)!;
const iso = (ms: number | undefined): string => (ms === undefined ? 'never' : new Date(ms).toISOString());
export { iso };

export class World {
  hub!: Hub;
  readonly home: string;
  readonly root: string;
  readonly bin: string;
  readonly checkout: string;
  readonly work: string;
  readonly agents: string;
  readonly loginPath: string;
  /** Every hub this world ran, and what each had started, for the stop at the end. */
  private readonly hubs: Hub[] = [];
  private readonly started = new Set<number>();
  private sampler: NodeJS.Timeout | undefined;
  /** The most live played agents seen at once on each issue, while `watchLive` samples. */
  readonly maxLive = new Map<number, number>();
  private constructor(readonly tmp: string, readonly forge: WorkForge, readonly token: string, readonly plant: string | undefined) {
    this.home = join(tmp, 'h'); this.root = join(this.home, '.deepbuild'); this.bin = join(tmp, 'bin');
    this.checkout = join(tmp, 'checkout'); this.work = join(tmp, 'work'); this.agents = join(tmp, 'agents');
    this.loginPath = [this.bin, dirname(NODE), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
  }

  static async open(o: { issues: IssueSpec[]; plan?: Record<number, AgentPlan>; prs?: PrSpec[]; plant?: string }): Promise<World> {
    if (!existsSync(CLI)) throw Error(`BLOCKED: the deep CLI (npm run build --workspaces) is not built at ${CLI}`);
    if (!existsSync(DEEP_HOOK)) throw Error(`BLOCKED: deep-hook (cargo build --locked -p deep-hook) is not built at ${DEEP_HOOK}`);
    const tmp = realpathSync(mkdtempSync('/tmp/dh1332-'));
    made.push(tmp);
    const forge = await WorkForge.start(join(tmp, 'forge'), SHOP);
    const w = new World(tmp, forge, forge.gate.person(PERSON, true), o.plant);
    worlds.push(w);
    mkdirSync(w.root, { recursive: true, mode: 0o700 });
    writeFileSync(join(w.root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
    writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
    for (const f of ['.zprofile', '.zshenv', '.bash_profile', '.profile']) writeFileSync(join(w.home, f), `export PATH="${w.loginPath}"\n`);

    // The agents' app, installed on the forge with more than a session needs; its key in the Keychain's test stand-in.
    const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
    forge.gate.app({ id: AGENTS_APP.id, slug: AGENTS_APP.slug, publicKeyPem: createPublicKey(createPrivateKey(pem)).export({ type: 'spki', format: 'pem' }).toString(), permissions: { metadata: 'read', contents: 'write', pull_requests: 'write', issues: 'write', statuses: 'write' } });
    mkdirSync(join(w.home, 'Library/Keychains'), { recursive: true, mode: 0o700 });
    writeFileSync(join(w.home, 'Library/Keychains/deepbuild-test.json'), JSON.stringify({ [AGENTS_APP.service]: pem }), { mode: 0o600 });
    writeFileSync(join(w.root, 'config.json'), `${JSON.stringify({
      asks: SETTINGS, runner: { login_path: w.loginPath },
      github: { delivery: { [SHOP]: 'on' }, yours: [PERSON], agents: { app_id: AGENTS_APP.id, key: AGENTS_APP.service } },
    }, null, 2)}\n`);

    // The played agents, and the hooks setup writes into each agent's own config.
    mkdirSync(w.bin, { recursive: true });
    mkdirSync(w.agents, { recursive: true });
    const program = readFileSync(fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url)), 'utf8').replace(/^#!.*\n/, `#!${NODE}\n`).replace("'__DIR__'", JSON.stringify(w.agents));
    writeFileSync(join(w.bin, 'claude'), program.replace("'__AGENT__'", "'claude'").replace("'__VERSION__'", JSON.stringify(newest('claude-code.facts.json'))), { mode: 0o755 });
    writeFileSync(join(w.bin, 'codex'), program.replace("'__AGENT__'", "'codex'").replace("'__VERSION__'", JSON.stringify(newest('codex.facts.json'))), { mode: 0o755 });
    mkdirSync(join(w.home, '.claude'), { recursive: true });
    writeFileSync(join(w.home, '.claude/settings.json'), `${JSON.stringify({ hooks: Object.fromEntries(HOOKS.map((h) => {
      const entry = { type: 'command', command: `exec '${DEEP_HOOK}' claude-code ${h}` };
      return [h, [TOOL_HOOKS.has(h) ? { matcher: '*', hooks: [entry] } : { hooks: [entry] }]];
    })) }, null, 2)}\n`);
    mkdirSync(join(w.home, '.codex/sessions'), { recursive: true });
    writeFileSync(join(w.home, '.codex/hooks.json'), `${JSON.stringify({ hooks: Object.fromEntries(CODEX_HOOKS.map((h) => [h, [{ hooks: [{ type: 'command', command: `exec '${DEEP_HOOK}' codex ${h}` }] }]])) }, null, 2)}\n`);

    // The issues, numbered from #100 in order, each body with its criteria, its `Runs on:` line and its blocked-by links.
    const now = Date.now();
    const baseline: number[] = [];
    o.issues.forEach((spec, i) => {
      const n = 100 + i;
      const body = [`The shop does ${n}.`, '', ...(spec.runsOn ? [`Runs on: ${spec.runsOn}`, ''] : []), '### Acceptance criteria', `- [ ] the shop does ${n}`, '',
        ...(spec.blockedBy?.length ? ['### Depends on', ...spec.blockedBy.map((b) => `- #${b}`), ''] : [])].join('\n');
      const got = forge.issue({ title: `Issue ${n}`, body, blockedBy: spec.blockedBy ?? [], openedAt: spec.closed === 'before-gate' ? now - 60 * 86_400_000 : now - 86_400_000 });
      if (got !== n) throw Error(`BLOCKED: the fixture forge numbered issue ${n} as ${got}`);
      if (spec.closed === 'before-gate') { forge.closeIssue(n, { by: PERSON, at: now - 30 * 86_400_000 }); baseline.push(n); }
      if (spec.closed === 'after-gate') forge.closeIssue(n, { by: PERSON, at: now - 3_600_000 });
    });
    const drafts = o.issues.map((spec, i) => ({ issue: `${SHOP}#${100 + i}`, requirements: spec.requirements ?? [requirement('R1', `the shop does ${100 + i}`, checkFile(100 + i))], deliverables: [], budget: null }));
    writeFileSync(join(tmp, 'drafts.json'), `${JSON.stringify({ drafts }, null, 2)}\n`);
    writeFileSync(join(tmp, 'work.json'), `${JSON.stringify({ readings: [] }, null, 2)}\n`);

    // main: the shop, then the baseline commit, set once, listing the issues closed before the gate.
    mkdirSync(w.work);
    await w.git(w.work, 'init', '-q', '-b', 'main');
    await w.git(w.work, 'remote', 'add', 'origin', forge.gate.gitUrl(SHOP));
    const files: Record<string, string> = {
      'README.md': '# shop\n', 'package.json': '{ "name": "shop", "private": true, "type": "module" }\n', '.gitignore': 'node_modules/\n',
      ...Object.fromEntries(o.issues.flatMap((_, i) => {
        const n = 100 + i;
        return [[`src/i${n}.txt`, `open ${n}\n`], [`tests/acceptance/${n}/i${n}.test.mjs`, suiteOf(n)], [checkFile(n), `node --test tests/acceptance/${n}/i${n}.test.mjs\n`]];
      })),
    };
    w.write(w.work, files);
    await w.git(w.work, 'add', '-A');
    await w.git(w.work, 'commit', '-q', '-m', 'Start the shop');
    if (baseline.length) {
      w.write(w.work, { [BASELINE]: `${JSON.stringify({ closed_before_gate: baseline }, null, 2)}\n` });
      await w.git(w.work, 'add', '-A');
      await w.git(w.work, 'commit', '-q', '-m', 'The gate starts here: the issues closed before it');
    }
    await w.git(w.work, 'push', '-q', '-u', 'origin', 'main');
    for (const p of o.prs ?? []) {
      await w.git(w.work, 'checkout', '-q', '-B', p.branch, 'origin/main');
      w.write(w.work, p.files);
      await w.git(w.work, 'add', '-A');
      await w.git(w.work, 'commit', '-q', '-m', `Change ${p.branch}`);
      await w.git(w.work, 'push', '-q', '-f', 'origin', p.branch);
      forge.pull({ head: p.branch, title: `Change ${p.branch}`, body: p.body ?? `Closes #${p.issue}`, login: PERSON });
    }
    // The hub's checkout of the repo, which the run works in.
    await w.git(tmp, 'clone', '-q', forge.gate.gitUrl(SHOP), w.checkout);
    writeFileSync(join(w.agents, 'plan.json'), `${JSON.stringify({ api: forge.url, repo: SHOP, node: NODE, cli: CLI, issues: o.plan ?? {} }, null, 2)}\n`);
    w.hub = await w.startHub();
    return w;
  }

  write(dir: string, files: Record<string, string>): void {
    for (const [path, bytes] of Object.entries(files)) { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), bytes); }
  }
  /** git as maya: her name on commits, her token on every request to the forge. */
  git(cwd: string, ...args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('git', ['-C', cwd, '-c', `user.name=${PERSON}`, '-c', `user.email=${PERSON}@example.invalid`, '-c', 'commit.gpgsign=false', '-c', 'credential.helper=',
        '-c', `http.extraHeader=Authorization: Bearer ${this.token}`, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } },
      (error, stdout, stderr) => (error ? reject(Error(`git ${args.join(' ')}: ${stderr.trim() || error.message}`)) : resolve(stdout)));
    });
  }
  /** Every child's environment: the test home, the login PATH, the hub's test stand-ins, maya's own forge login, and the plant. */
  env(): NodeJS.ProcessEnv {
    return childEnv(this.home, {
      PATH: this.loginPath, SHELL: '/bin/zsh', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
      DEEP_HUB_TEST_CONFIRM: join(this.tmp, 'confirm'), DEEP_HUB_TEST_DRAFTS: join(this.tmp, 'drafts.json'), DEEP_HUB_TEST_WORK: join(this.tmp, 'work.json'),
      DEEP_HUB_TEST_FORGE: this.forge.url, DEEP_HUB_TEST_KEYCHAIN: join(this.home, 'Library/Keychains/deepbuild-test.json'), GH_TOKEN: this.token,
      ...(this.plant ? { DEEP_HUB_PLANT: this.plant } : {}),
    });
  }
  private async startHub(): Promise<Hub> {
    const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: this.checkout, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: this.env() });
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
  /** The hub stopped as a service is (SIGTERM, by its PID) and started again on the same root. */
  async restartHub(): Promise<void> {
    for (const pid of descendants(this.hub.pid)) this.started.add(pid);
    await stopHub(this.hub);
    this.hub = await this.startHub();
  }
  async close(): Promise<void> {
    if (this.sampler) clearInterval(this.sampler);
    for (const h of this.hubs) for (const pid of descendants(h.pid)) this.started.add(pid);
    for (const h of this.hubs) await stopHub(h).catch(() => undefined);
    for (const l of this.launches(true)) for (const pid of [l.pid, l.ppid]) this.started.add(pid);
    // Only what is still this world's: a process whose command names its folder or this checkout's builds.
    await stopPids([...this.started].filter((pid) => living(pid) && [this.tmp, REPO].some((p) => commandOf(pid).includes(p))));
    await this.forge.close();
  }

  // ---- `deep` as you run it, in the run's checkout.
  deep(args: string[], o: { timeoutMs?: number } = {}): Promise<Ran> {
    return new Promise((resolve) => {
      const child = spawn(NODE, [CLI, ...args], { cwd: this.checkout, env: this.env(), stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout!.setEncoding('utf8').on('data', (d: string) => (stdout += d));
      child.stderr!.setEncoding('utf8').on('data', (d: string) => (stderr += d));
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, o.timeoutMs ?? 300_000);
      child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, json: jsonOf(stdout) }); });
    });
  }
  /** `deep work "<scope>"`: the run's one approval, raised; it prints the ask. */
  run(scope: string): Promise<Ran> { return this.deep(['work', scope, '--repo', this.checkout, '--json']); }
  /** The approval `deep work` raised, as #1330 records it, answered yes on the trusted path with `deep inbox answer`. */
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
  /** `deep work show --json`: each issue's row, by issue. */
  async show(): Promise<Shown> {
    const ran = await this.deep(['work', 'show', '--repo', this.checkout, '--json']);
    return { ran, rows: rowsOf(ran.json) };
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
  /** Lets a `gated` played agent on the issue go on. */
  go(n: number): void { writeFileSync(join(this.agents, `go-${n}`), ''); }
  /** A played agent stopped hard, mid-turn, by its PID (only one this world started). */
  kill(l: Launch): void {
    if (!living(l.pid) || !commandOf(l.pid).includes(this.tmp)) throw Error(`BLOCKED: the played agent ${l.pid} is not this world's live agent`);
    process.kill(l.pid, 'SIGKILL');
  }
  /** Samples how many played agents live on each issue at once, every half second, into `maxLive`. */
  watchLive(): void {
    this.sampler = setInterval(() => {
      const count = new Map<number, number>();
      for (const l of this.launches()) if (l.issue !== null && l.ended === undefined && /^[^Z]+$/.test(statOf(l.pid))) count.set(l.issue, (count.get(l.issue) ?? 0) + 1);
      for (const [n, c] of count) this.maxLive.set(n, Math.max(this.maxLive.get(n) ?? 0, c));
    }, 500);
  }
  /** When the issue's change reached main: the end of the forge's merge of a pull request that links it. */
  landedAt(n: number): number | undefined {
    const prs = new Set(this.forge.pullsLinking(n));
    return this.forge.merges.find((m) => prs.has(m.pr))?.ended;
  }
  merged(n: number): boolean { return this.landedAt(n) !== undefined; }
  state(n: number): string { return this.forge.issues.get(n)!.state; }
  /** The text the issue's body and comments hold. */
  issueText(n: number): string { const i = this.forge.issues.get(n)!; return `${i.body}\n${i.comments.map((c) => c.body).join('\n')}`; }
}

// ---- Readings of `deep work show` and the record (README: readings).
/** The issue an object names: its `issue` field, as a number, `#<n>` or `<owner>/<repo>#<n>`. */
export function issueOf(o: Line): number | undefined {
  const v = o.issue;
  if (typeof v === 'number' && Number.isSafeInteger(v)) return v;
  const m = typeof v === 'string' ? /^(?:[\w.-]+\/[\w.-]+)?#?(\d+)$/.exec(v.trim()) : null;
  return m ? Number(m[1]) : undefined;
}
/** Every object in `deep work show --json`'s output that names an issue and holds its state `word`, by issue: the shallowest one for each. */
export function rowsOf(json: unknown): Map<number, { word: string; text: string }> {
  const found = new Map<number, { word: string; text: string; depth: number }>();
  const walk = (v: unknown, depth: number): void => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    if (!v || typeof v !== 'object') return;
    const o = v as Line;
    const n = issueOf(o);
    if (n !== undefined && typeof o.word === 'string' && (found.get(n)?.depth ?? Infinity) > depth) found.set(n, { word: o.word, text: JSON.stringify(o), depth });
    for (const x of Object.values(o)) walk(x, depth + 1);
  };
  walk(json, 0);
  return new Map([...found].map(([n, r]) => [n, { word: r.word, text: r.text }]));
}
/** The record's state word for each issue: the `word` of the newest event whose data names the issue. */
export function recordWords(events: readonly Ev[]): Map<number, { word: string; at: number }> {
  const out = new Map<number, { word: string; at: number }>();
  for (const e of events) {
    const n = e.data && typeof e.data === 'object' ? issueOf(e.data) : undefined;
    if (n !== undefined && typeof e.data.word === 'string') out.set(n, { word: e.data.word, at: e.log_pos });
  }
  return out;
}
/** Whether a text names the issue or pull request number `n` with a `#`, a link or GitHub's words for it. */
export const names = (text: string, n: number): boolean =>
  new RegExp(`(?:#|issues/|pull/|pulls/|\\bissue\\s+|\\bPR\\s*#?|pull request\\s*#?|"(?:issue|pr|pull|pull_request)"\\s*:\\s*)${n}(?!\\d)`, 'i').test(text);
/** The asks the record holds besides the run's approval, in order. */
export async function asksBesides(w: World, approval: string): Promise<Ev[]> {
  return (await w.events()).filter((e) => e.kind === 'ask.created' && `ask:${e.id}` !== approval);
}

// ---- Waiting and judging.
/** The probe's first value that is neither undefined nor false, or undefined once `ms` has passed. */
export async function waitUntil<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, ms: number, everyMs = 1000): Promise<T | undefined> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined && v !== false) return v;
    if (Date.now() >= deadline) return undefined;
    await sleep(everyMs);
  }
}
/** `ok` or throw: the thrown message is what a failing criterion says, and what a plant's failure must name. */
export function must(ok: boolean, message: string): asserts ok { if (!ok) throw new AssertionError({ message }); }
/** Asserts a judgement fails on the planted wrong program and that the failure names each of `want`. */
export async function mustFail(what: string, judge: () => unknown | Promise<unknown>, want: string[]): Promise<void> {
  let message: string | null = null;
  try { await judge(); } catch (error) {
    const m = error instanceof Error ? error.message : String(error);
    if (m.startsWith('BLOCKED:')) throw error;
    message = m;
  }
  expect(message, `${what}: the planted wrong program passed the judgement, so it proves nothing`).not.toBeNull();
  for (const n of want) expect(message, `${what}: the failure must name ${n}`).toContain(n);
}
/**
 * A budget read under load, as the repo reads one (design: Load): over budget while the 1-minute load is at or above
 * the cores reads INCONCLUSIVE, a skip that is never a pass; over budget below that is a failure.
 */
export function withinBudget(ctx: TestContext, ms: number, budget: number, what: string, load: number): void {
  if (ms <= budget) return;
  const cores = availableParallelism();
  if (load >= cores) ctx.skip(`INCONCLUSIVE: ${what} took ${ms} ms, past ${budget} ms, at a 1-minute load of ${load.toFixed(1)} on ${cores} cores`);
  expect(ms, `${what} within ${budget} ms (1-minute load ${load.toFixed(1)} on ${cores} cores)`).toBeLessThanOrEqual(budget);
}
export const load = (): number => loadavg()[0]!;
export const real = (p: string): string => { try { return realpathSync(p); } catch { return p; } };

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
