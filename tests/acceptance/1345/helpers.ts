// Test-side tools for #1345's acceptance tests (README): a world under /tmp/dh1345-* with the fixture forge (forge.ts,
// on #1335's), a shop repo whose issues each carry a requirement checked by code and a taste call (a requirement whose
// oracle is a person), the hub's checkout of it, the real hub (`deep hub run`) with the forge as its GitHub, a standing
// run (#1335) over the repo's issues, #1332's played agents as `claude` and `codex` first on the login PATH, `deep` as
// you run it, your answers on the trusted path, the app drawn headless by the real `deep-drive` over a copy of the
// record, and readings of the forge, the record and the played agents' own logs. Nothing here stands in for DeepBuild:
// the hub, its record, the asks core, #1330's starts, the run, the gate's runs, #1331's landing, deep-hook and the app's
// views are real. Only the forge (GitHub) and the agents (and their model) are played. No network beyond 127.0.0.1,
// no model; processes are stopped by PID only.
import { execFile, execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import { alive, allEvents, childEnv, CLI, control, DEEP_HOOK, DEFAULT_RULES, REPO, run, SETTINGS, sleep, stopHub, type Ev, type Hub } from '../29/h-d.ts';
import { checkFile, names, requirement, rowsOf, shown, waitUntil, type Launch, type Line, type Ran } from '../1332/helpers.ts';
import { MAYA } from '../1335/forge.ts';
import { PagesForge } from './forge.ts';

export { names, shown, sleep, waitUntil };
export type { Ev, Launch, Line, Ran };
export const NODE = process.execPath;
export const SHOP = 'acme/shop';
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
/** The label the standing rule names (README: readings). */
export const LABEL = 'checkout';
/** How long a right program may take to land the first change of a world, under load (README: waits). */
export const FIRST = 25 * MIN;
/** Your visits when a world has them: once a day, up to 20 asks (`asks.batch`, packages/asks/src/showing.ts). */
export const VISITS = { every: '1d', cap: 20 } as const;

/** The criteria's IDs: `#1345.` and the first 8 hex digits of SHA-256 of each criterion's text, white space collapsed (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #1345.21f21363', 2: 'AC2 #1345.ba6681c8', 3: 'AC3 #1345.9c5710a8', 4: 'AC4 #1345.464309b0',
  5: 'AC5 #1345.cdb5061b', 6: 'AC6 #1345.45221c69', 7: 'AC7 #1345.aaa324a9', 8: 'AC8 #1345.69fa185d',
} as const;
/** The criteria's text, as the issue says it. */
export const CRITERION = {
  1: 'A reversible change with one open taste call lands, its issue stays open naming the call, and no view reads PASS. A planted lander that records a PASS fails, naming the claim',
  2: 'A change that reaches a release, or a published page, stays held. A planted lander that lets it through fails, naming the change',
  3: 'Five calls from five issues reach one person as one card, and that day raises one notification',
  4: 'A call unanswered at its deadline takes its recommended answer, the issue closes, and the record reads default, never your answer',
  5: 'A "no" starts an attempt on that issue and raises no second ask',
  6: "Issues blocked by a landed change with an open call start. Issues blocked by a held one don't",
  7: "Five calls from five issues draw as #328's card with five rows, and the tree holds no second batch card. A row whose Send back would revert says so before it's pressed. A planted row that reverts unannounced fails, naming the issue",
  8: 'On the five-row card each row shows when its recommended answer applies, and the five rows add up to the count. A planted card with no time on a row fails, naming the row',
} as const;
export const named = (n: keyof typeof AC): string => `${AC[n]} ${CRITERION[n]}`;

/** The planted wrong programs (README: The plants): the hub's two by plant.ts, the app's two by its `env-plants` feature. */
export const PLANT = {
  /** AC1: the lander records the landing of a change whose only open requirements are taste calls as PASS. */
  landsAsPass: 'lands-as-pass',
  /** AC2: the lander lands a change with an open taste call that reaches a release or a published page, as a reversible one. */
  landsUnreversible: 'lands-unreversible',
  /** AC7: the batched taste card's first row whose Send back reverts doesn't say so. */
  rowRevertsUnannounced: 'card-row-reverts-unannounced',
  /** AC8: the batched taste card draws no time on its first row. */
  rowWithoutTime: 'card-row-without-time',
} as const;

export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };

// ---- The issues and their definitions (README: readings).

/** The taste call of issue `n`: its definition's requirement whose oracle is a person. */
export const tasteText = (n: number): string => `the look of #${n}'s change is right to you`;
const DESIGN = `**Design:** [The shop](https://github.com/${SHOP}/blob/main/docs/design.md#the-shop)`;
/** One issue of the shop, ready to join the standing rule: yours, labelled, with criteria and a design link that resolves. */
export interface IssueSpec {
  /** The issues it is blocked by: its body's `### Depends on` list, which the forge also serves as blocked-by links. */
  blockedBy?: number[];
  /** What landing its change reaches (README: readings): a release, by `.deepbuild/done.yaml`'s `release.paths`, or the published page, by the forge's Pages site. */
  reaches?: 'release' | 'page';
  /** Its every start holds its turn (`gated`), so it is seen starting and makes no change. */
  gated?: boolean;
}
const bodyOf = (n: number, spec: IssueSpec): string => [
  `The shop does ${n}.`, '', DESIGN, '', '### Acceptance criteria', `- [ ] the shop does ${n}`, `- [ ] ${tasteText(n)}`, '',
  ...(spec.blockedBy?.length ? ['### Depends on', ...spec.blockedBy.map((b) => `- #${b}`), ''] : []),
].join('\n');
const suiteOf = (n: number): string => [
  "import assert from 'node:assert/strict';", "import { readFileSync } from 'node:fs';", "import { test } from 'node:test';",
  `test('the shop does ${n}', () => {`, `  assert.doesNotMatch(readFileSync(new URL('../../../src/i${n}.txt', import.meta.url), 'utf8'), /BROKEN/);`, '});', '',
].join('\n');
/** What a world's run is given, and how the hub is set up. */
export interface Options {
  /** The issues, numbered from #100. */
  issues: IssueSpec[];
  /** How many run at once, in the scope's words. */
  atOnce: 'one' | 'two' | 'three' | 'four' | 'five';
  /** Your visits: once a day (VISITS); without, every ask shows when it's raised. */
  visits?: boolean;
  /** The hub's clock is the test's to step, and starts early in a UTC day (DEEP_HUB_TEST_CLOCK). */
  clock?: boolean;
  /** A planted wrong program of the hub's (DEEP_HUB_PLANT). */
  plant?: string;
}

/** The agents' app: a session's own credential is one of its installation tokens (#1325). */
const AGENTS_APP = { id: 913252, slug: 'deepbuild-agents', service: 'deepbuild.github.agents' };
const HOOKS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'SessionEnd'];
const TOOL_HOOKS = new Set(['PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure']);
const CODEX_HOOKS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop'];
const newest = (facts: string): string => (JSON.parse(readFileSync(join(REPO, 'adapters', facts), 'utf8')) as { versions: string[] }).versions.at(-1)!;

/** #1332's played agent with the two turns this suite adds, `slow` and `page` (fixtures/turns.mjs), dispatched beside its own. */
function playedAgent(): string {
  const source = readFileSync(fileURLToPath(new URL('../1332/fixtures/agent.mjs', import.meta.url)), 'utf8');
  const at = "else if (log.behavior === 'taste') await taste();";
  if (!source.includes(at)) blocked(`#1332's played agent no longer dispatches at "${at}"`);
  const module = JSON.stringify(new URL('./fixtures/turns.mjs', import.meta.url).href);
  return source.replace(at, [
    at,
    `else if (log.behavior === 'slow') await (await import(${module})).slow({ step, work });`,
    `else if (log.behavior === 'page') await (await import(${module})).page({ issue: log.issue, writeFile, bash, q, step, work });`,
  ].join('\n'));
}

/** Where the hub's clock starts in a world that steps it: now, or the next UTC midnight when that is under 6 hours away, so a world's day has room. */
function dayStart(): number {
  const now = Date.now();
  const next = (Math.floor(now / DAY) + 1) * DAY;
  return next - now < 6 * HOUR ? next + MIN : now;
}

const made: string[] = [];
const worlds: World[] = [];
const drives = new Set<number>();
afterAll(async () => {
  for (const pid of drives) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  drives.clear();
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
  private readonly started = new Set<number>();
  private constructor(readonly tmp: string, readonly forge: PagesForge, readonly token: string, readonly o: Options, readonly clockStart: number | undefined) {
    this.home = join(tmp, 'h'); this.root = join(this.home, '.deepbuild'); this.bin = join(tmp, 'bin');
    this.checkout = join(tmp, 'checkout'); this.work = join(tmp, 'work'); this.agents = join(tmp, 'agents');
    this.loginPath = [this.bin, dirname(NODE), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
  }

  /** The issues numbered from #100, each played as `slow` (or `page`, or `gated`) on its first start and `gated` on every later one. */
  static async open(o: Options): Promise<World> {
    if (!existsSync(CLI)) blocked(`the deep CLI (npm run build --workspaces) is not built at ${CLI}`);
    await builds();
    const tmp = realpathSync(mkdtempSync('/tmp/dh1345-'));
    made.push(tmp);
    const forge = await PagesForge.start(join(tmp, 'forge'), SHOP, { pages: o.issues.some((i) => i.reaches === 'page') });
    const w = new World(tmp, forge, forge.gate.person(MAYA.login, true), o, o.clock ? dayStart() : undefined);
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
      asks: o.visits ? { ...SETTINGS, batch: VISITS } : SETTINGS, runner: { login_path: w.loginPath },
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

    // The issues, each yours and labelled, and each one's definition: a requirement its check settles and a taste call.
    const numbers = o.issues.map((_, i) => 100 + i);
    o.issues.forEach((spec, i) => {
      const n = 100 + i;
      const got = forge.rule.issue({ title: `Issue ${n}`, body: bodyOf(n, spec), author: MAYA, labels: [LABEL] });
      if (got !== n) blocked(`the fixture forge numbered issue ${n} as ${got}`);
    });
    const drafts = numbers.map((n) => ({
      issue: `${SHOP}#${n}`, deliverables: [], budget: null,
      requirements: [requirement('R1', `the shop does ${n}`, checkFile(n)), requirement('R2', tasteText(n), null, { oracle: 'person' })],
    }));
    writeFileSync(join(tmp, 'drafts.json'), `${JSON.stringify({ drafts }, null, 2)}\n`);
    writeFileSync(join(tmp, 'work.json'), `${JSON.stringify({ readings: [] }, null, 2)}\n`);

    // main: the shop with its design document, a suite and a check for every issue, and what a release ships.
    const released = numbers.filter((_, i) => o.issues[i]!.reaches === 'release');
    mkdirSync(w.work);
    await w.git(w.work, 'init', '-q', '-b', 'main');
    await w.git(w.work, 'remote', 'add', 'origin', forge.gate.gitUrl(SHOP));
    w.write(w.work, {
      'README.md': '# shop\n', 'package.json': '{ "name": "shop", "private": true, "type": "module" }\n', '.gitignore': 'node_modules/\n',
      'docs/design.md': '# The shop\'s design\n\n## The shop\n\nThe shop does what each issue names.\n',
      ...(released.length ? { '.deepbuild/done.yaml': `release:\n  paths:\n${released.map((n) => `    - src/i${n}.txt\n`).join('')}` } : {}),
      ...Object.fromEntries(numbers.flatMap((n) => [[`src/i${n}.txt`, `open ${n}\n`], [`tests/acceptance/${n}/i${n}.test.mjs`, suiteOf(n)], [checkFile(n), `node --test tests/acceptance/${n}/i${n}.test.mjs\n`]])),
    });
    await w.git(w.work, 'add', '-A');
    await w.git(w.work, 'commit', '-q', '-m', 'Start the shop');
    await w.git(w.work, 'push', '-q', '-u', 'origin', 'main');
    await w.git(tmp, 'clone', '-q', forge.gate.gitUrl(SHOP), w.checkout);
    const plan = Object.fromEntries(numbers.map((n, i) => [n, { launches: [o.issues[i]!.gated ? 'gated' : o.issues[i]!.reaches === 'page' ? 'page' : 'slow', 'gated'] }]));
    writeFileSync(join(w.agents, 'plan.json'), `${JSON.stringify({ api: forge.url, repo: SHOP, node: NODE, cli: CLI, issues: plan }, null, 2)}\n`);
    w.hub = await w.startHub();
    return w;
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
  /** Every child's environment: the test home, the login PATH, the hub's test stand-ins, the forge, maya's own login, the clock and the plant. */
  env(): NodeJS.ProcessEnv {
    return childEnv(this.home, {
      PATH: this.loginPath, SHELL: '/bin/zsh', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
      DEEP_HUB_TEST_CONFIRM: join(this.tmp, 'confirm'), DEEP_HUB_TEST_DRAFTS: join(this.tmp, 'drafts.json'), DEEP_HUB_TEST_WORK: join(this.tmp, 'work.json'),
      DEEP_HUB_TEST_FORGE: this.forge.url, DEEP_HUB_TEST_KEYCHAIN: join(this.home, 'Library/Keychains/deepbuild-test.json'), GH_TOKEN: this.token,
      ...(this.clockStart !== undefined ? { DEEP_HUB_TEST_CLOCK: String(this.clockStart), DEEP_HUB_TEST_CLOCK_STEPS: '1' } : {}),
      ...(this.o.plant ? { DEEP_HUB_PLANT: this.o.plant } : {}),
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
      blocked(`the hub${this.o.plant ? ` with the plant DEEP_HUB_PLANT=${this.o.plant}` : ''} did not start (a plant the hub doesn't list stops it): ${err.slice(-800)}`);
    }
    return { pid: Number(ready!.pid ?? child.pid), socket: String(ready!.socket), home: this.home, root: this.root, child, exit, readyAt: Date.now(), clock: this.clockStart, plant: this.o.plant, stderr: () => err };
  }
  /** Stops what this world started and its forge; once, whoever asks first (a test before its next world, or the end). */
  close(): Promise<void> { return (this.closing ??= this.stop()); }
  private closing: Promise<void> | undefined;
  private async stop(): Promise<void> {
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
  /** The standing rule's words: the repo's open issues labelled LABEL, in Claude Code, `atOnce` at a time. */
  get scope(): string { return `work through open issues labelled "${LABEL}" with Claude Code, ${this.o.atOnce} at a time`; }
  /**
   * The standing run: `deep work "<scope>"` raises its one approval, answered yes on the trusted path with `deep inbox
   * answer`, as #1335's suite does. The approval's ask.
   */
  async startRun(): Promise<string> {
    const asked = await this.deep(['work', this.scope, '--repo', this.checkout, '--json']);
    expect(asked.code, `deep work "${this.scope}" raises the standing run's one approval and exits 0: ${shown(asked)}`).toBe(0);
    const ask = asked.json?.ask;
    expect(typeof ask === 'string' && ask.startsWith('ask:'), `deep work "<scope>" --json prints { "ask": "ask:<id>" }, the approval it raised: ${shown(asked)}`).toBe(true);
    const created = await waitUntil(async () => (await this.events()).find((e) => e.kind === 'ask.created' && `ask:${e.id}` === ask), 30_000);
    expect(created, `the record holds ${ask}'s ask.created`).toBeTruthy();
    const yes = ((created!.data.options ?? []) as { id: string; decision?: string }[]).find((x) => x.decision === 'allow');
    expect(yes, `${ask} offers a yes: ${JSON.stringify(created!.data.options)}`).toBeTruthy();
    const answered = await this.deep(['inbox', 'answer', String(ask), yes!.id]);
    expect(answered.code, `deep inbox answer ${String(ask)} ${yes!.id} (${shown(answered)})`).toBe(0);
    return String(ask);
  }
  /** `deep work show --json`: each issue's row, by issue (#1332's reading). */
  async show(): Promise<{ ran: Ran; rows: Map<number, { word: string; text: string }> }> {
    const ran = await this.deep(['work', 'show', '--repo', this.checkout, '--json']);
    return { ran, rows: rowsOf(ran.json) };
  }
  /**
   * Your answer on the trusted path, as `deep inbox answer` sends it: `ask.answer` on the hub's socket as the CLI, the
   * OS confirming you (DEEP_HUB_TEST_CONFIRM), with your words beside the option when you give them.
   */
  async answer(ask: string, option: string, words?: string): Promise<void> {
    await control(this.hub, 'ask.answer', { ask, option, ...(words ? { words } : {}) }, 120_000);
  }

  // ---- The hub's clock.
  /** Steps the hub's clock forward by `ms` (`test.clock`); its time now. */
  async clock(ms: number): Promise<number> { return Number((await control(this.hub, 'test.clock', { advance_ms: Math.max(0, Math.round(ms)) })).now); }
  /** Steps the hub's clock to a minute past the next UTC midnight: your next visit's time. Its time now. */
  async toNextVisit(): Promise<number> {
    const now = await this.clock(0);
    return this.clock((Math.floor(now / DAY) + 1) * DAY + MIN - now);
  }

  // ---- Readings.
  events(): Promise<Ev[]> { return allEvents(this.hub); }
  /** The pull requests whose body links the issue. */
  prs(n: number): number[] { return this.forge.pullsLinking(n); }
  /** The forge's merge of a pull request that links the issue: its change landed on main. */
  mergeOf(n: number): { pr: number; ended: number; sha: string } | undefined { const prs = new Set(this.prs(n)); return this.forge.merges.find((m) => prs.has(m.pr)); }
  merged(n: number): boolean { return this.mergeOf(n) !== undefined; }
  state(n: number): string { return this.forge.issues.get(n)!.state; }
  /** The text the issue's body and comments hold. */
  issueText(n: number): string { const i = this.forge.issues.get(n)!; return `${i.body}\n${i.comments.map((c) => c.body).join('\n')}`; }
  /** A file on the forge's main as it stands, or undefined when main holds none. */
  main(path: string): Promise<string | undefined> {
    return new Promise((resolve) => execFile('git', ['--git-dir', this.forge.bareRepo, 'cat-file', 'blob', `main:${path}`], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' } },
      (error, out) => resolve(error ? undefined : out)));
  }
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
  /** What the forge and the record hold of issue `n`, in words, for a failure message. */
  async about(n: number): Promise<string> {
    const events = await this.events();
    const state = events.filter((e) => e.kind === 'work.state' && e.data?.issue === n).at(-1);
    return [
      `#${n}: ${this.on(n).length} played starts`, `PR ${this.prs(n).map((p) => `#${p}`).join(', ') || 'none'}${this.merged(n) ? ' (merged)' : ''}`,
      `landing.made ${landingsOf(events, n).map((e) => `${String(e.data.step)} ${String(e.data.outcome)}`).join(', ') || 'none'}`,
      `work.state ${state ? `${String(state.data.word)}, waiting on ${String(state.data.waits_on)}` : 'none'}`,
      `taste calls ${callsOf(events, n).length}`, `open asks ${events.filter((e) => e.kind === 'ask.created' && !closing(events, `ask:${e.id}`)).map((e) => String(e.data?.kind)).join(', ') || 'none'}`,
    ].join('; ');
  }
}

// ---- Readings of the record (README: readings).

/** The kinds that close an ask, as the asks projection reads them (#2026's close rule). */
const CLOSES = new Set(['decision.applied', 'ask.answered', 'ask.defaulted', 'ask.escalated', 'ask.cancelled', 'ask.superseded', 'ask.moot']);
const byAgent = (writer: unknown): boolean => writer === 'hook' || String(writer ?? '').startsWith('mcp:');
/** A call: a taste ask the record holds, by its handle (`ask:<ULID>`), and the issue it is about. */
export interface Call { handle: string; id: string; issue: number; data: Line; pos: number; ts: number }
/**
 * The taste calls of issue `n`: each `ask.created` of kind taste whose data holds its taste requirement's text, or,
 * when none does, names the issue (`#<n>`, `issue <n>`, `"issue": <n>`).
 */
export function callsOf(events: readonly Ev[], n: number): Call[] {
  const taste = events.filter((e) => e.kind === 'ask.created' && e.data?.kind === 'taste');
  const by = taste.filter((e) => JSON.stringify(e.data).includes(tasteText(n)));
  return (by.length ? by : taste.filter((e) => names(JSON.stringify(e.data), n))).map((e) => ({ handle: `ask:${e.id}`, id: e.id, issue: n, data: e.data, pos: e.log_pos, ts: e.ts }));
}
/** The event that closed an ask, if one did: an answer, a default and the rest of the closed set, written by anyone but an agent. */
export function closing(events: readonly Ev[], handle: string): Ev | undefined {
  return events.find((e) => !byAgent(e.writer) && ((CLOSES.has(e.kind) && e.kind !== 'decision.applied' && e.subject === handle) || (e.kind === 'decision.applied' && e.data?.ask === handle)));
}
export const openCallsOf = (events: readonly Ev[], n: number): Call[] => callsOf(events, n).filter((c) => !closing(events, c.handle));
/** The record's landings of issue `n`'s change (#1331's `landing.made`), in order. */
export const landingsOf = (events: readonly Ev[], n: number): Ev[] => events.filter((e) => e.kind === 'landing.made' && e.data?.issue === n);
/** The claims the lander judged issue `n`'s change by. */
export const claimsOf = (events: readonly Ev[], n: number): string[] => [...new Set(landingsOf(events, n).map((e) => e.data.claim).filter((c): c is string => typeof c === 'string' && c !== ''))];
/** The record's starts of a session on issue `n` (#1330's `start.started`). */
export const startsOf = (events: readonly Ev[], n: number): Ev[] => events.filter((e) => e.kind === 'start.started' && e.data?.issue === n);
/** A call's option that sends its change back: its id or label says Send back (or no), else the one it doesn't recommend. */
export function sendBackOf(call: Call): string | undefined {
  const options = (Array.isArray(call.data.options) ? call.data.options : []) as { id?: unknown; label?: unknown }[];
  const says = (re: RegExp) => options.find((o) => re.test(String(o.id ?? '')) || re.test(String(o.label ?? '')));
  const picked = says(/send[\s_-]*back/i) ?? says(/^no$/i) ?? options.find((o) => o.id !== call.data.recommended);
  return picked === undefined ? undefined : String(picked.id);
}
/** When a call's default applies: its deadline, as the core last moved it (`deadline.moved`, #908) or as it was raised. */
export function deadlineOf(events: readonly Ev[], call: Call): number {
  const moved = events.filter((e) => e.kind === 'deadline.moved' && e.subject === call.handle).at(-1);
  return Number(moved?.data.deadline ?? call.data.deadline);
}
/** Whether an `ask.batched` (the asks core's showing, at a visit or at once) lists the ask. */
export const lists = (e: Ev, handle: string): boolean => e.kind === 'ask.batched' && Array.isArray(e.data?.asks) && (e.data.asks as Line[]).some((a) => a?.ask === handle);
/** Whether a text names the call: its handle or ULID (a `deepbuild://ask/<ULID>` link among them), its question, or the taste requirement it asks about. */
export const namesCall = (text: string, call: Call): boolean => text.includes(call.id) || text.includes(tasteText(call.issue))
  || (typeof call.data.question === 'string' && call.data.question !== '' && text.includes(call.data.question));
export const said = (e: Ev | undefined): string => (e ? `${e.kind} at log_pos ${e.log_pos} ${JSON.stringify(e.data).slice(0, 600)}` : 'none');

// ---- The app, drawn headless by the real `deep-drive` (#124) over a copy of the world's record (README: the app).

/** Builds the suite runs, in one grant of the machine's build throttle, copied out of the target folder by name. */
const BIN = join(tmpdir(), `dh1345-bin-${userInfo().uid}-${createHash('sha256').update(REPO).digest('hex').slice(0, 8)}`);
const target = (name: string): string => join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', name);
const COPIES = ['deep-drive-plain', 'deep-drive-plants'];
/** What the Rust build reads: a copy older than any of these is built again. */
const SOURCES = ['Cargo.toml', 'Cargo.lock', '.cargo', 'rust-toolchain.toml', 'crates', 'vendor', 'contracts', 'brand', 'adapters', 'packages/contracts/schemas'];
function newestMtime(path: string): number {
  if (!existsSync(path)) return 0;
  const s = statSync(path);
  if (!s.isDirectory()) return s.mtimeMs;
  return readdirSync(path).filter((n) => n !== 'target' && n !== 'node_modules' && n !== '.git').reduce((m, n) => Math.max(m, newestMtime(join(path, n))), s.mtimeMs);
}
let built: Promise<void> | undefined;
/**
 * deep-hook into the checkout's target, where the hub and the hooks look for it, and `deep-drive` plain and with
 * `env-plants`: each one older than the sources, or missing, is built; BLOCKED when the build fails.
 */
export function builds(): Promise<void> {
  built ??= (async () => {
    if (process.platform !== 'darwin') blocked(`the app draws headless on macOS only; this is ${process.platform}`);
    const sources = Math.max(...SOURCES.map((p) => newestMtime(join(REPO, p))));
    const fresh = (file: string): boolean => existsSync(file) && statSync(file).mtimeMs > sources;
    const q = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`;
    const cargo = 'cargo build --locked -q';
    const steps = [
      ...(fresh(DEEP_HOOK) ? [] : [`${cargo} -p deep-hook --bin deep-hook`]),
      ...COPIES.filter((copy) => !fresh(join(BIN, copy))).reverse().flatMap((copy) => [
        `${cargo} -p deep-replica ${copy === 'deep-drive-plants' ? '--features env-plants ' : ''}--bin deep-drive`,
        `cp ${q(target('deep-drive'))} ${q(join(BIN, copy))}`,
      ]),
    ];
    if (!steps.length) return;
    mkdirSync(BIN, { recursive: true });
    const script = steps.join(' && ');
    const r = await run(NODE, ['scripts/throttle.mjs', 'build', '--wait', '120', '--', '/bin/sh', '-c', script], { cwd: REPO, env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' }, timeoutMs: 300 * MIN });
    if (r.code !== 0) blocked(`the build failed (exit ${r.code}): ${(r.stderr || r.stdout).slice(-2000)}`);
  })();
  return built;
}

export interface SNode { role: string; name: string | null; value: unknown; id?: string | null; bounds: number[]; children: SNode[] }
export const flat = (n: SNode | undefined, into: SNode[] = []): SNode[] => { if (!n) return into; into.push(n); for (const c of n.children ?? []) flat(c, into); return into; };
/** Every string a node and what it holds show: names, and values that are text or numbers, the drawn runs among them. */
export const stringsOf = (n: SNode | undefined): string[] => flat(n).flatMap((x) => [x.name ?? '', typeof x.value === 'string' ? x.value : typeof x.value === 'number' ? String(x.value) : '']).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
/** What `see` showed: the window's tree, the list's rows as the record table builds them, the address the window shows. */
export interface Seen { tree: SNode; rows: Line[]; address: string | null }
export interface Posted { t: number; ask: string | null; session: string; text: string }
export interface Drawn { seen: Seen; notifications: Posted[] }
const FLICKS = 705_600_000;
/** The window the app is drawn at: the reference width, tall enough that a card of five rows draws whole. */
const SIZE = [1512, 2000];

class Drive {
  private buffer = '';
  private readonly waiting: ((line: Line) => void)[] = [];
  private exited = false;
  private err = '';
  t = 0;
  private constructor(private readonly child: ChildProcess) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const raw = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        let parsed: Line;
        try { parsed = JSON.parse(raw) as Line; } catch { parsed = { unparsed: raw }; }
        this.waiting.shift()?.(parsed);
      }
    });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.err = (this.err + d).slice(-4000); });
    child.on('exit', () => { this.exited = true; for (const wake of this.waiting.splice(0)) wake({ exited: true }); });
  }
  static async start(w: World, plant?: string): Promise<Drive> {
    await builds();
    const out = mkdtempSync(join(w.tmp, 'drive-'));
    const child = spawn(join(BIN, plant ? 'deep-drive-plants' : 'deep-drive-plain'), ['--out', out], { cwd: REPO, env: childEnv(w.home, { DEEP_HUB_PLANT: plant }), stdio: ['pipe', 'pipe', 'pipe'] });
    if (child.pid) drives.add(child.pid);
    const d = new Drive(child);
    const ready = await d.next(10 * MIN);
    if (ready.ready !== true) blocked(`deep-drive didn't say {"ready": true}: ${JSON.stringify(ready).slice(0, 300)} ${d.err.slice(-600)}`);
    return d;
  }
  private next(ms: number): Promise<Line> {
    if (this.exited) return Promise.resolve({ exited: true });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: ms }), ms);
      this.waiting.push((line) => { clearTimeout(timer); resolve(line); });
    });
  }
  /** One call that must answer ok; BLOCKED naming `what` and the replica's own error otherwise. */
  async must(what: string, args: Line): Promise<Line> {
    const reply = this.next(10 * MIN);
    this.child.stdin!.write(`${JSON.stringify(args)}\n`);
    const got = await reply;
    if (got.exited || got.timedOut || got.unparsed !== undefined) blocked(`deep-drive gave no JSON reply to ${what}: ${JSON.stringify(got).slice(0, 300)} ${this.err.slice(-600)}`);
    if (got.ok !== true) blocked(`deep-drive refused ${what}: ${JSON.stringify(got.error ?? got).slice(0, 600)}`);
    if (typeof got.t === 'number') this.t = got.t;
    return got;
  }
  async stop(): Promise<void> {
    try { this.child.stdin!.end(); } catch { /* closed */ }
    const by = Date.now() + 5000;
    while (!this.exited && Date.now() < by) await sleep(20);
    if (!this.exited) try { process.kill(this.child.pid!, 'SIGKILL'); } catch { /* gone */ }
    if (this.child.pid) drives.delete(this.child.pid);
  }
}

/**
 * The app over a copy of the world's record taken now (`launch.from: "record_copy"`), in the plain `deep-drive` or,
 * with `plant`, the `env-plants` one: `open`'s address if given, the replica's clock run `waitMs` so its notifier posts
 * what is due, then `see`, then `close`, whose trace holds what it posted to its model of Notification Center.
 */
export async function draw(w: World, o: { plant?: string; open?: string; waitMs?: number } = {}): Promise<Drawn> {
  const d = await Drive.start(w, o.plant);
  try {
    await d.must('the launch over a copy of the record', { call: 'launch', launch: { from: 'record_copy', size: SIZE } });
    if (o.open) await d.must(`the open of ${o.open}`, { call: 'open', open: { address: o.open } });
    const ms = o.waitMs ?? 3000;
    await d.must(`the replica's clock running ${ms} ms`, { call: 'wait_for', wait_for: { t: d.t + Math.round((ms * FLICKS) / 1000) }, timeout: ms + 2000 });
    const seen = await d.must('see', { call: 'see' });
    const closed = await d.must('close', { call: 'close' });
    const trace = JSON.parse(readFileSync(String(closed.trace?.path), 'utf8')) as { notifications?: Posted[] };
    return { seen: { tree: (seen.snapshot as { tree: SNode }).tree, rows: Array.isArray(seen.rows) ? seen.rows as Line[] : [], address: (seen.address ?? null) as string | null }, notifications: trace.notifications ?? [] };
  } finally {
    await d.stop();
  }
}

// ---- The judges (README: How each criterion is read). Each returns its failures, each naming what it is about.

/**
 * AC1: issue `n`'s reversible change, with one taste call open, landed; its issue stays open naming the call; and no
 * view reads PASS: the record's landing, verdict and state word for it, `deep work show`, the forge's commit statuses,
 * and the app's list, drawn over a copy of the record. Every failure names the change's claim.
 */
export async function landedFailures(w: World, n: number): Promise<string[]> {
  const events = await w.events();
  const claims = claimsOf(events, n);
  const who = `#${n}'s change (${claims.length ? `claim ${claims.join(', claim ')}` : 'no claim the lander judged'}, PR ${w.prs(n).map((p) => `#${p}`).join(', ') || 'none'})`;
  const out: string[] = [];
  if (!w.merged(n)) out.push(`${who} didn't land: no pull request linking #${n} merged`);
  if (w.state(n) !== 'open') out.push(`${who} landed with its taste call open, so its issue stays open, but #${n} is ${w.state(n)}`);
  const open = openCallsOf(events, n);
  if (open.length !== 1) out.push(`${who}: the record holds ${open.length} open taste calls for #${n}, not one: ${callsOf(events, n).map((c) => `${c.handle} (${closing(events, c.handle)?.kind ?? 'open'})`).join(', ') || 'none'}`);
  else if (!namesCall(w.issueText(n), open[0]!)) out.push(`${who}: #${n}'s issue doesn't name its call ${open[0]!.handle} ("${String(open[0]!.data.question ?? '').slice(0, 160)}") in its body or comments: ${JSON.stringify(w.issueText(n).slice(-800))}`);
  for (const e of landingsOf(events, n)) if (e.data.outcome === 'PASS') out.push(`${who}: the record's landing.made (step ${String(e.data.step)}) reads PASS for claim ${String(e.data.claim)}`);
  for (const e of events) if (e.kind === 'verdict.made' && claims.includes(String(e.data.claim)) && e.data.outcome === 'PASS') out.push(`${who}: the record's verdict.made reads PASS for claim ${String(e.data.claim)}`);
  for (const e of events) if (e.kind === 'work.state' && e.data.issue === n && e.data.word === 'PASS') out.push(`${who}: the record's work.state reads PASS for #${n}`);
  const page = await w.show();
  if (page.ran.code !== 0) out.push(`${who}: deep work show --json didn't answer: ${shown(page.ran)}`);
  if (page.rows.get(n)?.word === 'PASS') out.push(`${who}: deep work show reads PASS for #${n}: ${page.rows.get(n)!.text.slice(0, 300)}`);
  for (const s of w.forge.statuses) if (/^\s*PASS\b/.test(s.description)) out.push(`${who}: the forge's commit status ${s.context} on ${s.sha.slice(0, 12)} reads "${s.description}"`);
  const { seen } = await draw(w);
  for (const node of flat(seen.tree)) if (typeof node.id === 'string' && /^(?:ask|session|quiet):.+:word$/.test(node.id) && node.name === 'PASS') out.push(`${who}: the app's list reads PASS on its row ${node.id.slice(0, -':word'.length)}`);
  for (const row of seen.rows) if (row.word === 'PASS') out.push(`${who}: the app's list reads PASS on its row ${String(row.id)}`);
  return out;
}

/** AC2: issue `n`'s change, which reaches `what`, stays held: its pull request unmerged and no landing of it recorded. Every failure names the change. */
export async function heldFailures(w: World, n: number, what: string): Promise<string[]> {
  const events = await w.events();
  const who = `#${n}'s change (PR ${w.prs(n).map((p) => `#${p}`).join(', ') || 'none'})`;
  const out: string[] = [];
  const merged = w.mergeOf(n);
  if (merged) out.push(`${who} reaches ${what}, yet it landed: PR #${merged.pr} merged as ${merged.sha.slice(0, 12)}`);
  for (const e of landingsOf(events, n)) if (e.data.step === 'landed') out.push(`${who} reaches ${what}, yet the record's landing.made says it landed: ${said(e)}`);
  return out;
}

/** The rows of the batched taste card in a drawn window: each node `card-row:<ULID>`, by the call's ULID. */
const rowsOfCard = (tree: SNode): SNode[] => flat(tree).filter((x) => typeof x.id === 'string' && x.id.startsWith('card-row:'));
const rowName = (c: Call): string => `#${c.issue}'s row card-row:${c.id} (${c.handle})`;
/**
 * AC7: the calls draw as one batched taste card, `question-card`, with a row `card-row:<ULID>` for each call and no
 * other, inside it; each row offers Yes and Send back; and a row whose Send back reverts its change says "reverts this
 * change" before it's pressed, one whose Send back starts an attempt "starts another attempt". Each failure names the issue.
 */
export function cardFailures(seen: Seen, calls: readonly Call[], sendBack: (c: Call) => 'reverts' | 'attempts'): string[] {
  const out: string[] = [];
  const nodes = flat(seen.tree);
  const cards = nodes.filter((x) => x.id === 'question-card');
  if (cards.length !== 1) out.push(`the tree holds ${cards.length} cards (question-card) where the calls of ${calls.map((c) => `#${c.issue}`).join(', ')} draw as one batched taste card (${seen.address ?? 'no address'})`);
  const inCard = new Set(flat(cards[0]));
  const rows = rowsOfCard(seen.tree);
  for (const extra of rows.filter((r) => !calls.some((c) => r.id === `card-row:${c.id}`))) out.push(`the tree holds a row ${String(extra.id)} that is none of the calls' (${calls.map((c) => c.handle).join(', ')})`);
  for (const c of calls) {
    const mine = rows.filter((r) => r.id === `card-row:${c.id}`);
    if (mine.length !== 1) { out.push(`${rowName(c)}: the tree holds ${mine.length} such rows, not one`); continue; }
    const row = mine[0]!;
    if (!inCard.has(row)) out.push(`${rowName(c)} is drawn outside the one card: a second batch card`);
    const texts = stringsOf(row);
    if (!texts.some((t) => /\byes\b/i.test(t))) out.push(`${rowName(c)} offers no Yes: ${JSON.stringify(texts).slice(0, 500)}`);
    if (!texts.some((t) => /\bsend back\b/i.test(t))) out.push(`${rowName(c)} offers no Send back: ${JSON.stringify(texts).slice(0, 500)}`);
    const words = sendBack(c) === 'reverts' ? 'reverts this change' : 'starts another attempt';
    const wrong = sendBack(c) === 'reverts' ? 'starts another attempt' : 'reverts this change';
    if (!texts.some((t) => t.toLowerCase().includes(words))) out.push(`${rowName(c)}: its Send back ${sendBack(c) === 'reverts' ? 'reverts the change that landed' : 'starts another attempt'}, and the row doesn't say "${words}" before it's pressed: ${JSON.stringify(texts).slice(0, 500)}`);
    if (texts.some((t) => t.toLowerCase().includes(wrong))) out.push(`${rowName(c)} says "${wrong}" under its Send back, which ${sendBack(c) === 'reverts' ? 'reverts the change' : 'starts another attempt'}`);
  }
  return out;
}

/**
 * AC8: each row of the card shows when its call's recommended answer applies, as the list's row for that call shows
 * it (`ask:<ULID>:time`, #1461), and the card's rows add up to the count (`heading:needs-you`'s value, #2026). Each
 * failure names the row.
 */
export function timeFailures(seen: Seen, calls: readonly Call[]): string[] {
  const out: string[] = [];
  const nodes = flat(seen.tree);
  const rows = rowsOfCard(seen.tree);
  const value = nodes.find((x) => x.id === 'heading:needs-you')?.value;
  const count = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  if (count !== rows.length || rows.length !== calls.length) out.push(`the card's ${rows.length} rows add up to the count only when the count reads ${rows.length}; Needs you's count reads ${JSON.stringify(value ?? null)} with ${calls.length} calls open`);
  for (const c of calls) {
    const row = rows.find((r) => r.id === `card-row:${c.id}`);
    if (!row) { out.push(`${rowName(c)} isn't on the card`); continue; }
    const time = nodes.find((x) => x.id === `${c.handle}:time`)?.name?.replace(/\s+/g, ' ').trim();
    if (!time) { out.push(`${rowName(c)}: the list has no row for ${c.handle} to say when its recommended answer applies`); continue; }
    if (!stringsOf(row).some((t) => t.includes(time))) out.push(`${rowName(c)} shows no time when its recommended answer applies ("${time}", as the list's row for ${c.handle} shows it): ${JSON.stringify(stringsOf(row)).slice(0, 500)}`);
  }
  return out;
}

// ---- Processes: stopped by PID only, and only ones this world started.
function jsonOf(stdout: string): Line | null {
  try { const v = JSON.parse(stdout) as unknown; if (v && typeof v === 'object' && !Array.isArray(v)) return v as Line; } catch { /* lines */ }
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
