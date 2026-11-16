// Test-side tools for #1335's acceptance tests (README): a world under /tmp/dh1335-* with the fixture forge (forge.ts,
// on #1332's), a shop repo whose issues carry their authors, labels, acceptance criteria and design links, the hub's
// checkout of it, the real hub (`deep hub run`) with the forge as its GitHub and an agents' app for sessions' own
// credentials, #1332's played agents as `claude` and `codex` first on the login PATH, `deep` as you run it, and
// readings of the forge, the record and the played agents' own logs. Nothing here stands in for DeepBuild: the hub, its record,
// #1330's starts, #1332's run, the gate's runs, #1331's landing and deep-hook are real. Only the forge (GitHub) and the
// agents (and their model) are played. No network beyond 127.0.0.1, no model; processes are stopped by PID only.
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import { allEvents, alive, childEnv, CLI, control, DEEP_HOOK, DEFAULT_RULES, REPO, SETTINGS, sleep, stopHub, type Ev, type Hub } from '../29/h-d.ts';
import { checkFile, names, requirement, shown, waitUntil, type Launch, type Line, type Ran } from '../1332/helpers.ts';
import { MAYA, RuleForge, type Author } from './forge.ts';

export { names, shown, sleep, waitUntil };
export type { Ev, Launch, Line, Ran };
export const NODE = process.execPath;
export const SHOP = 'acme/shop';
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
/** The label every rule here names (README: readings). */
export const LABEL = 'checkout';

/** The criteria's IDs: `#1335.` and the first 8 hex digits of SHA-256 of each criterion's text, white space collapsed (scripts/proof-change.mjs). */
export const AC = { 1: 'AC1 #1335.d72bf6b5', 2: 'AC2 #1335.4dced2b8', 3: 'AC3 #1335.5396151b', 4: 'AC4 #1335.adae4f21', 5: 'AC5 #1335.846df82d' } as const;
/** The criteria's text, as the issue says it. */
export const CRITERION = {
  1: "On a fixture forge, an issue added after approval that meets the rule starts with no new approval, and one that doesn't starts nothing. A planted rule that reads the issue's text is refused at approval, naming the rule",
  2: "An issue with the rule's labels written by an outside author never joins, and neither does one a session opens",
  3: "An issue with no acceptance criteria stays out, is named on the run's page and raises no ask",
  4: 'The run goes on past 7 days with no ask, and its weekly notice lists landed, left and spent. At its plan share it starts nothing until the next window, and raises no ask',
  5: 'A fifth attempt in a row ending in anything but PASS pauses the run with one ask',
} as const;
export const named = (n: keyof typeof AC): string => `${AC[n]} ${CRITERION[n]}`;

// ---- The issues. Each is ready to join unless its spec says otherwise: acceptance criteria, as this repo writes them,
// a design link into the repo's own docs/design.md, which main holds, and no dependencies.
export const DESIGN = `**Design:** [The shop](https://github.com/${SHOP}/blob/main/docs/design.md#the-shop)`;
export const bodyOf = (n: number, o: { criteria?: boolean } = {}): string =>
  [`The shop does ${n}.`, '', DESIGN, '', ...(o.criteria === false ? [] : ['### Acceptance criteria', `- [ ] the shop does ${n}`, ''])].join('\n');
/** One issue of the shop: written by you with the rule's label and its criteria, unless said otherwise. */
export interface IssueSpec { author?: Author; labels?: string[]; criteria?: boolean }
/** What a played agent's turn does on each start on an issue (#1332's fixtures/agent.mjs, and this suite's `open-issue`). */
export interface AgentPlan { launches: ('replaced' | 'gated' | 'open-issue')[]; opens?: { title: string; body: string; labels: string[] } }

/** The account Claude Code keeps beside its sign-in (`oauthAccount.accountUuid`), whose plan windows `windows.report` reads. */
const ACCOUNT = '0a0a0a0a-1335-4335-8335-133513351335';
const AGENTS_APP = { id: 913252, slug: 'deepbuild-agents', service: 'deepbuild.github.agents' };
const HOOKS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'SessionEnd'];
const TOOL_HOOKS = new Set(['PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure']);
const CODEX_HOOKS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop'];
const newest = (facts: string): string => (JSON.parse(readFileSync(join(REPO, 'adapters', facts), 'utf8')) as { versions: string[] }).versions.at(-1)!;
const suiteOf = (n: number): string => [
  "import assert from 'node:assert/strict';", "import { readFileSync } from 'node:fs';", "import { test } from 'node:test';",
  `test('the shop does ${n}', () => {`, `  assert.doesNotMatch(readFileSync(new URL('../../../src/i${n}.txt', import.meta.url), 'utf8'), /BROKEN/);`, '});', '',
].join('\n');

/** #1332's played agent with the one behavior this suite adds, `open-issue` (fixtures/open-issue.mjs), dispatched beside its own. */
function playedAgent(): string {
  const source = readFileSync(fileURLToPath(new URL('../1332/fixtures/agent.mjs', import.meta.url)), 'utf8');
  const at = "else if (log.behavior === 'taste') await taste();";
  if (!source.includes(at)) throw Error(`BLOCKED: #1332's played agent no longer dispatches at "${at}"`);
  const module = JSON.stringify(new URL('./fixtures/open-issue.mjs', import.meta.url).href);
  return source.replace(at, `${at}\nelse if (log.behavior === 'open-issue') await (await import(${module})).openIssue({ opens: mine.opens ?? {}, api: plan.api, repo: plan.repo, issue: log.issue, dir: DIR, bash, q, step, work });`);
}

const made: string[] = [];
const worlds: World[] = [];
afterAll(async () => {
  for (const w of worlds.splice(0)) await w.close();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 180_000);

export class World {
  hub!: Hub;
  readonly home: string;
  readonly root: string;
  readonly bin: string;
  readonly checkout: string;
  readonly work: string;
  readonly agents: string;
  readonly loginPath: string;
  /** The hub's clock at its start (DEEP_HUB_TEST_CLOCK), when the world steps it. */
  readonly clockStart: number | undefined;
  /** When the account's current five-hour window resets on the hub's clock, once a reading was reported. */
  resets = 0;
  private readonly started = new Set<number>();
  private constructor(readonly tmp: string, readonly forge: RuleForge, readonly token: string, clock: boolean) {
    this.home = join(tmp, 'h'); this.root = join(this.home, '.deepbuild'); this.bin = join(tmp, 'bin');
    this.checkout = join(tmp, 'checkout'); this.work = join(tmp, 'work'); this.agents = join(tmp, 'agents');
    this.loginPath = [this.bin, dirname(NODE), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
    this.clockStart = clock ? Date.now() : undefined;
  }

  /**
   * The world: `issues` on the forge from #100, suites and handed definitions for `more` numbers after them (issues added
   * or opened later), the played agents' `plan`, the hub's clock stepped by the test (`clock`), and an account whose
   * plan windows are read, with a first reading of 5% (`account`).
   */
  static async open(o: { issues: IssueSpec[]; more?: number; plan?: Record<number, AgentPlan>; clock?: boolean; account?: boolean }): Promise<World> {
    if (!existsSync(CLI)) throw Error(`BLOCKED: the deep CLI (npm run build --workspaces) is not built at ${CLI}`);
    if (!existsSync(DEEP_HOOK)) throw Error(`BLOCKED: deep-hook (cargo build --locked -p deep-hook) is not built at ${DEEP_HOOK}`);
    const tmp = realpathSync(mkdtempSync('/tmp/dh1335-'));
    made.push(tmp);
    const forge = await RuleForge.start(join(tmp, 'forge'), SHOP);
    const w = new World(tmp, forge, forge.gate.person(MAYA.login, true), o.clock === true);
    worlds.push(w);
    mkdirSync(w.root, { recursive: true, mode: 0o700 });
    writeFileSync(join(w.root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
    writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
    for (const f of ['.zprofile', '.zshenv', '.bash_profile', '.profile']) writeFileSync(join(w.home, f), `export PATH="${w.loginPath}"\n`);

    // The agents' app, installed on the forge; its key in the Keychain's test stand-in (#1325).
    const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
    forge.gate.app({ id: AGENTS_APP.id, slug: AGENTS_APP.slug, publicKeyPem: createPublicKey(createPrivateKey(pem)).export({ type: 'spki', format: 'pem' }).toString(), permissions: { metadata: 'read', contents: 'write', pull_requests: 'write', issues: 'write', statuses: 'write' } });
    mkdirSync(join(w.home, 'Library/Keychains'), { recursive: true, mode: 0o700 });
    writeFileSync(join(w.home, 'Library/Keychains/deepbuild-test.json'), JSON.stringify({ [AGENTS_APP.service]: pem }), { mode: 0o600 });
    writeFileSync(join(w.root, 'config.json'), `${JSON.stringify({
      asks: SETTINGS, runner: { login_path: w.loginPath },
      github: { delivery: { [SHOP]: 'on' }, yours: [MAYA.login], agents: { app_id: AGENTS_APP.id, key: AGENTS_APP.service } },
    }, null, 2)}\n`);

    // The played agents, and the hooks setup writes into each agent's own config.
    mkdirSync(w.bin, { recursive: true });
    mkdirSync(w.agents, { recursive: true });
    const program = playedAgent().replace(/^#!.*\n/, `#!${NODE}\n`).replace("'__DIR__'", JSON.stringify(w.agents));
    writeFileSync(join(w.bin, 'claude'), program.replace("'__AGENT__'", "'claude'").replace("'__VERSION__'", JSON.stringify(newest('claude-code.facts.json'))), { mode: 0o755 });
    writeFileSync(join(w.bin, 'codex'), program.replace("'__AGENT__'", "'codex'").replace("'__VERSION__'", JSON.stringify(newest('codex.facts.json'))), { mode: 0o755 });
    mkdirSync(join(w.home, '.claude'), { recursive: true });
    writeFileSync(join(w.home, '.claude/settings.json'), `${JSON.stringify({ hooks: Object.fromEntries(HOOKS.map((h) => {
      const entry = { type: 'command', command: `exec '${DEEP_HOOK}' claude-code ${h}` };
      return [h, [TOOL_HOOKS.has(h) ? { matcher: '*', hooks: [entry] } : { hooks: [entry] }]];
    })) }, null, 2)}\n`);
    mkdirSync(join(w.home, '.codex/sessions'), { recursive: true });
    writeFileSync(join(w.home, '.codex/hooks.json'), `${JSON.stringify({ hooks: Object.fromEntries(CODEX_HOOKS.map((h) => [h, [{ hooks: [{ type: 'command', command: `exec '${DEEP_HOOK}' codex ${h}` }] }]])) }, null, 2)}\n`);
    // Claude Code keeps the account beside its sign-in, in ~/.claude.json; a start reads it in its home, ~/.claude.
    if (o.account) for (const f of ['.claude.json', '.claude/.claude.json']) writeFileSync(join(w.home, f), `${JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT, emailAddress: 'dh1335@example.invalid' }, projects: {} }, null, 2)}\n`);

    // The issues there from the start, numbered from #100.
    o.issues.forEach((spec, i) => w.add(100 + i, spec));
    const numbers = Array.from({ length: o.issues.length + (o.more ?? 0) }, (_, i) => 100 + i);
    const drafts = numbers.map((n) => ({ issue: `${SHOP}#${n}`, requirements: [requirement('R1', `the shop does ${n}`, checkFile(n))], deliverables: [], budget: null }));
    writeFileSync(join(tmp, 'drafts.json'), `${JSON.stringify({ drafts }, null, 2)}\n`);
    writeFileSync(join(tmp, 'work.json'), `${JSON.stringify({ readings: [] }, null, 2)}\n`);

    // main: the shop with its design document, and a suite and a check for every issue number the world may use.
    mkdirSync(w.work);
    await w.git(w.work, 'init', '-q', '-b', 'main');
    await w.git(w.work, 'remote', 'add', 'origin', forge.gate.gitUrl(SHOP));
    w.write(w.work, {
      'README.md': '# shop\n', 'package.json': '{ "name": "shop", "private": true, "type": "module" }\n', '.gitignore': 'node_modules/\n',
      'docs/design.md': '# The shop\'s design\n\n## The shop\n\nThe shop does what each issue names.\n',
      ...Object.fromEntries(numbers.flatMap((n) => [[`src/i${n}.txt`, `open ${n}\n`], [`tests/acceptance/${n}/i${n}.test.mjs`, suiteOf(n)], [checkFile(n), `node --test tests/acceptance/${n}/i${n}.test.mjs\n`]])),
    });
    await w.git(w.work, 'add', '-A');
    await w.git(w.work, 'commit', '-q', '-m', 'Start the shop');
    await w.git(w.work, 'push', '-q', '-u', 'origin', 'main');
    await w.git(tmp, 'clone', '-q', forge.gate.gitUrl(SHOP), w.checkout);
    writeFileSync(join(w.agents, 'plan.json'), `${JSON.stringify({ api: forge.url, repo: SHOP, node: NODE, cli: CLI, issues: o.plan ?? {} }, null, 2)}\n`);
    w.hub = await w.startHub();
    if (o.account) {
      w.resets = (w.clockStart !== undefined ? await w.clock(0) : Date.now()) + 3 * HOUR;
      await w.report(5, w.resets);
    }
    return w;
  }

  /** An issue put on the forge, by its author, with its labels: it must take number `n`. */
  add(n: number, spec: IssueSpec = {}): void {
    const got = this.forge.issue({ title: `Issue ${n}`, body: bodyOf(n, spec), author: spec.author ?? MAYA, labels: spec.labels ?? [LABEL] });
    if (got !== n) throw Error(`BLOCKED: the fixture forge numbered issue ${n} as ${got}`);
  }
  write(dir: string, files: Record<string, string>): void {
    for (const [path, bytes] of Object.entries(files)) { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), bytes); }
  }
  /** git as maya: her name on commits, her token on every request to the forge. */
  git(cwd: string, ...args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('git', ['-C', cwd, '-c', `user.name=${MAYA.login}`, '-c', `user.email=${MAYA.login}@example.invalid`, '-c', 'commit.gpgsign=false', '-c', 'credential.helper=',
        '-c', `http.extraHeader=Authorization: Bearer ${this.token}`, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } },
      (error, stdout, stderr) => (error ? reject(Error(`git ${args.join(' ')}: ${stderr.trim() || error.message}`)) : resolve(stdout)));
    });
  }
  /** Every child's environment: the test home, the login PATH, the hub's test stand-ins, the forge, maya's own login, the clock. */
  env(): NodeJS.ProcessEnv {
    return childEnv(this.home, {
      PATH: this.loginPath, SHELL: '/bin/zsh', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
      DEEP_HUB_TEST_CONFIRM: join(this.tmp, 'confirm'), DEEP_HUB_TEST_DRAFTS: join(this.tmp, 'drafts.json'), DEEP_HUB_TEST_WORK: join(this.tmp, 'work.json'),
      DEEP_HUB_TEST_FORGE: this.forge.url, DEEP_HUB_TEST_KEYCHAIN: join(this.home, 'Library/Keychains/deepbuild-test.json'), GH_TOKEN: this.token,
      ...(this.clockStart !== undefined ? { DEEP_HUB_TEST_CLOCK: String(this.clockStart), DEEP_HUB_TEST_CLOCK_STEPS: '1' } : {}),
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
      throw Error(`BLOCKED: the hub did not start: ${err.slice(-800)}`);
    }
    return { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), home: this.home, root: this.root, child, exit, readyAt: Date.now(), clock: this.clockStart, plant: undefined, stderr: () => err };
  }
  async close(): Promise<void> {
    for (const pid of descendants(this.hub?.pid ?? 0)) this.started.add(pid);
    if (this.hub) await stopHub(this.hub).catch(() => undefined);
    for (const l of this.launches(true)) for (const pid of [l.pid, l.ppid]) this.started.add(pid);
    // Only what is still this world's: a process whose command names its folder or this checkout's builds.
    await stopPids([...this.started].filter((pid) => alive(pid) && [this.tmp, REPO].some((p) => commandOf(pid).includes(p))));
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
  /** `deep work show --json`: the run's page. */
  show(): Promise<Ran> { return this.deep(['work', 'show', '--repo', this.checkout, '--json']); }
  /** Lets a `gated` played agent on the issue go on. */
  go(n: number): void { writeFileSync(join(this.agents, `go-${n}`), ''); }

  // ---- The hub's clock and the account's plan windows.
  /** Steps the hub's clock forward by `ms` (`test.clock`); its time now. */
  async clock(ms: number): Promise<number> { return Number((await control(this.hub, 'test.clock', { advance_ms: ms })).now); }
  /** A reading of the account's five-hour window (`windows.report`): `used` percent, resetting at `resets` on the hub's clock. */
  async report(used: number, resets: number): Promise<void> {
    await control(this.hub, 'windows.report', { agent: 'claude-code', account: ACCOUNT, rate_limits: { five_hour: { used_percentage: used, resets_at: Math.floor(resets / 1000) } } });
  }

  // ---- Readings.
  events(): Promise<Ev[]> { return allEvents(this.hub); }
  /** The asks the record holds besides the run's approval, in order. */
  async asksBesides(approval: string): Promise<Ev[]> { return (await this.events()).filter((e) => e.kind === 'ask.created' && `ask:${e.id}` !== approval); }
  /** The record's starts of a session on issue `n` (#1330's `start.started`). */
  async startsOf(n: number): Promise<Ev[]> { return (await this.events()).filter((e) => e.kind === 'start.started' && e.data.issue === n); }
  /** The played agents' starts, oldest first; ones that played no session (a subcommand) only with `all`. */
  launches(all = false): Launch[] {
    const dir = join(this.agents, 'log');
    if (!existsSync(dir)) return [];
    const out: Launch[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) { try { out.push(JSON.parse(readFileSync(join(dir, f), 'utf8')) as Launch); } catch { /* being written */ } }
    return out.filter((l) => all || !l.refused).sort((a, b) => a.started - b.started);
  }
  on(n: number): Launch[] { return this.launches().filter((l) => l.issue === n); }
  /** Each played agent's start on issue `n`, in words, for a failure message. */
  starts(n: number): string[] { return this.on(n).map((l) => `${l.agent} pid ${l.pid} at ${new Date(l.started).toISOString()}`); }
  /** Whether the issue's change reached main: a merge of a pull request that links it. */
  merged(n: number): boolean { const prs = new Set(this.forge.pullsLinking(n)); return this.forge.merges.some((m) => prs.has(m.pr)); }
  state(n: number): string { return this.forge.issues.get(n)!.state; }
}

// ---- Readings of the run's page and the record (README: readings).
const isObj = (v: unknown): v is Line => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Every object anywhere in a JSON value, shallowest first. */
function objects(v: unknown): Line[] {
  const out: Line[] = [];
  const queue: unknown[] = [v];
  while (queue.length) {
    const x = queue.shift();
    if (Array.isArray(x)) queue.push(...x);
    else if (isObj(x)) { out.push(x); queue.push(...Object.values(x)); }
  }
  return out;
}
/** Whether `deep work show --json` shows the run `ask` paused: the object naming it holds `paused: true`. */
export const pausedOn = (json: Line | null, ask: string): boolean => objects(json).some((o) => o.ask === ask && o.paused === true);
/** The run's weekly notice: the newest event naming the run (its subject, `ask` or data) whose data holds `landed`, `left` and `spent`. */
export function noticeOf(events: readonly Ev[], ask: string): { event: Ev; landed: unknown; left: unknown; spent: unknown } | undefined {
  for (const e of [...events].reverse()) {
    if (e.subject !== ask && e.data?.ask !== ask && !JSON.stringify(e.data ?? null).includes(ask)) continue;
    const held = objects(e.data).find((o) => 'landed' in o && 'left' in o && 'spent' in o);
    if (held) return { event: e, landed: held.landed, left: held.left, spent: held.spent };
  }
  return undefined;
}
/** Whether a notice's list names issue `n`: as a number in it (`[<n>, ...]`, `"issue": <n>`) or as `#<n>` in its text. */
export const lists = (value: unknown, n: number): boolean => new RegExp(`[[,:]\\s*${n}\\s*[,\\]}]|#${n}(?!\\d)`).test(JSON.stringify(value ?? null));
/** Whether a notice's `spent` says something: neither missing nor empty. */
export const said = (v: unknown): boolean => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length) && !(isObj(v) && !Object.keys(v).length);

// ---- Processes: stopped by PID only, and only ones this world started.
function jsonOf(stdout: string): Line | null {
  try { const v = JSON.parse(stdout) as unknown; if (isObj(v)) return v; } catch { /* lines */ }
  for (const line of stdout.split('\n').reverse()) { if (line.trim().startsWith('{')) { try { return JSON.parse(line) as Line; } catch { /* next */ } } }
  return null;
}
function commandOf(pid: number): string {
  try { return execFileSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim(); } catch { return ''; }
}
function descendants(root: number): number[] {
  if (!root) return [];
  const table = spawnSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).stdout.trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number) as [number, number]);
  const out: number[] = [];
  const walk = (p: number): void => { for (const [pid, ppid] of table) if (ppid === p && !out.includes(pid)) { out.push(pid); walk(pid); } };
  walk(root);
  return out;
}
async function stopPids(pids: number[]): Promise<void> {
  for (const pid of pids) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while (pids.some(alive) && Date.now() < deadline) await sleep(100);
  for (const pid of pids) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
}
