// Test-side tools for #1328's acceptance tests (README). A scene is a real hub (`deep hub run --root`, with the real
// runner, supervisor, sandbox, record and asks in it), a real git repository, the real test runner on the fixture's
// tests and the real guard. Only the agent binary (fixtures/fake-claude.pl) and the forge (the hub's recorded GitHub
// answers) stand in. Every name the issue leaves open is in this file alone: README, Surfaces assumed.
//
// Safety: every folder is under /tmp/dh1328-*; HOME is a temp folder for this process and every child; the agent's own
// CLAUDE*, DEEP_* and ANTHROPIC_* variables are removed first; no network and no model; the hub is stopped by its PID.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.pl', import.meta.url));
export const LIMIT = 600_000;
const WAIT_MS = 240_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

for (const key of Object.keys(process.env)) {
  if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key.startsWith('ANTHROPIC_')) delete process.env[key];
}

// ---- The surfaces the issue leaves open (README, Surfaces assumed).
/** The new job kind on the runner. */
const KIND = 'acceptance';
/** Hub control methods, as `job.submit` is one. */
const START = 'acceptance.start', STATUS = 'acceptance.status', DISPUTE = 'acceptance.dispute';
/** The event an attempt's start leaves on the record. */
const ATTEMPT = 'attempt.started';
/** What `acceptance.status` returns once a job has been judged. */
export interface Status {
  state: 'queued' | 'running' | 'done';
  result: 'ready' | 'INVALID' | 'refused' | null;
  why: string | null;
  /** Every job of the issue, oldest first. */
  jobs: string[];
  branch: string | null;
  commit: string | null;
  /** Each new-behavior test's run on the base. */
  base: { test: string; criterion: string; outcome: string; at: string | null }[];
  disputes: Dispute[];
}
/** One dispute as `acceptance.status` lists it. `jobs` are its redrafts, `commit` the swap's, `refused` the drafts it would not keep. */
export interface Dispute { test: string; outcome: 'stands' | 'swapped' | 'asked' | null; jobs: string[]; commit: string | null; refused: { job: string; test: string; why: string }[] }
/** One entry of a job's input record, on its `job.recorded` event. */
export interface Input { kind: 'issue' | 'design' | 'base' | 'criterion'; ref: string; sha256?: string }
/** The guard's variable for the gate identities it accepts, read as $DEEP_APPROVERS is. */
const GATES_VARIABLE = 'DEEP_GATES';
/** What a hub's config.json names beside `runner` and `plan`: its slots, and the key of its gate identity (#1325's stand-in). */
const hubConfig = (loginPath: string, slots: number, key: string | null): Line => ({
  runner: { login_path: loginPath }, plan: { reserve_pct: 10 }, acceptance: { slots }, ...(key ? { gate: { key } } : {}),
});

// ---- The fixture's issue. Its criteria say which is new behavior; `Unchanged:` is one a test must pass on the base.
export const OWNER = 'fixture', NAME = 'widgets', ISSUE = 9001, NEXT = 9002;
export const NEW = 'New behavior: the widget is blue';
export const SAME = 'Unchanged: the widget keeps its name';
export const DESIGN = ['AGENTS.md', 'docs/technical-design.md'];
export const tagOf = (issue: number, text: string): string => `#${issue}.${sha256(text).slice(0, 8)}`;
const linkOf = (issue: number): string => `https://github.com/${OWNER}/${NAME}/issues/${issue}`;
const bodyOf = (issue: number): string => `The widget should be blue, for issue ${issue}.\n\n### Acceptance criteria\n- [ ] ${NEW}\n- [ ] ${SAME}\n`;
export const folderOf = (issue: number): string => `tests/acceptance/${issue}`;

// ---- The drafts a stand-in writes. On the base the widget is red; on the work it is blue.
/** Fails on the base at its assertion (line 6) and passes on the work. */
export const BLUE = "assert.equal(colour(), 'blue');";
/** The same, with other bytes, so two agreeing drafts can be told apart. */
export const BLUE_AGAIN = "assert.strictEqual(colour(), 'blue');";
/** Fails on the base at its assertion and on the work too. */
export const NAVY = "assert.equal(colour(), 'navy');";
export const TEAL = "assert.equal(colour(), 'teal');";
/** Passes on the base and on the work: it proves nothing. */
export const HOLLOW = 'assert.ok(colour());';
/** Passes on the work, and fails on the base away from any assertion. */
export const ELSEWHERE = "if (colour() !== 'blue') throw new TypeError('no colour yet');";
export const widgetFile = (issue: number): string => `${folderOf(issue)}/widget.test.mjs`;
export const widgetTest = (issue: number): string => `${widgetFile(issue)} › ${tagOf(issue, NEW)} the widget is blue`;
const widget = (issue: number, assertion: string): string => `import assert from 'node:assert/strict';
import test from 'node:test';
import { colour } from '../../../src/widget.mjs';

test('${tagOf(issue, NEW)} the widget is blue', () => {
  ${assertion}
});
`;
const named = (issue: number): string => `import assert from 'node:assert/strict';
import test from 'node:test';
import { name } from '../../../src/widget.mjs';

test('${tagOf(issue, SAME)} the widget keeps its name', () => {
  assert.equal(name(), 'widget');
});
`;
/** The job's own word on its base failures, the same whatever the test does: only the hub's run is evidence. */
const baseRecord = (issue: number): string => `${widgetFile(issue)}:6 failed on the base at its assertion\n`;
/** What a stand-in does in one job (fixtures/fake-claude.pl). */
export interface Plan { reads?: string[]; writes?: Record<string, string> }
/** A first draft's folder: one test per criterion and the job's record of its base failures. */
export const firstDraft = (issue: number, assertion = BLUE): Plan => ({ writes: { [widgetFile(issue)]: widget(issue, assertion), [`${folderOf(issue)}/name.test.mjs`]: named(issue), [`${folderOf(issue)}/BASE-FAILURE.txt`]: baseRecord(issue) } });
/** A redraft of the disputed test: its one file. */
export const redraft = (issue: number, assertion: string): Plan => ({ writes: { [widgetFile(issue)]: widget(issue, assertion) } });
export const draftBytes = widget;

// ---- Temp folders.
const made: string[] = [];
function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1328-'));
  made.push(dir);
  return dir;
}
export function removeTemp(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
const write = (cwd: string, files: Record<string, string>): void => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  }
};

// ---- HOME: a temp folder with a fake Claude Code sign-in, made once per test file.
const ACCOUNT = '0a0a0a0a-1111-4222-8333-555555555555';
let HOME: string | undefined;
function home(): string {
  if (HOME && existsSync(HOME)) return HOME;
  HOME = tempDir();
  process.env.HOME = HOME;
  write(HOME, {
    '.claude.json': `${JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT, emailAddress: 'dh1328@example.invalid' }, mcpServers: {}, projects: {} })}\n`,
    '.claude/.credentials.json': `${JSON.stringify({ claudeAiOauth: { accessToken: 'made-up', refreshToken: 'made-up', expiresAt: 4102444800000, scopes: ['user:inference'], subscriptionType: 'max' } })}\n`,
    '.claude/settings.json': '{}\n',
  });
  return HOME;
}

// ---- git, with no system or user config.
export function git(cwd: string, ...args: string[]): string {
  return execFileSync('/usr/bin/git', args, {
    cwd, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: '/usr/bin:/bin', HOME: home(), GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'dh1328', GIT_AUTHOR_EMAIL: 'dh1328@example.invalid', GIT_COMMITTER_NAME: 'dh1328', GIT_COMMITTER_EMAIL: 'dh1328@example.invalid' },
  }).trim();
}
/** Every byte under `dir`: files as they are, git objects as git reads them. */
export function everything(dir: string): string {
  const parts: string[] = [];
  const walk = (at: string): void => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      const st = lstatSync(path);
      if (st.isDirectory()) walk(path);
      else if (st.isFile()) parts.push(readFileSync(path).toString('latin1'));
    }
  };
  walk(dir);
  if (existsSync(join(dir, '.git'))) parts.push(execFileSync('/usr/bin/git', ['--git-dir', join(dir, '.git'), 'cat-file', '--batch-all-objects', '--batch'], { encoding: 'latin1', maxBuffer: 256 << 20 }));
  return parts.join('\n');
}

// ---- The hub's socket.
class Client {
  private buffer = '';
  private readonly lines: Line[] = [];
  private ids = 0;
  private constructor(private readonly sock: net.Socket) {
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      this.buffer += chunk;
      for (let at = this.buffer.indexOf('\n'); at >= 0; at = this.buffer.indexOf('\n')) {
        try { this.lines.push(JSON.parse(this.buffer.slice(0, at)) as Line); } catch { /* not a line of ours */ }
        this.buffer = this.buffer.slice(at + 1);
      }
    });
    sock.on('error', () => undefined);
  }
  private async seen(probe: (line: Line) => boolean, what: string): Promise<Line> {
    for (const end = Date.now() + 60_000; Date.now() < end && !this.sock.destroyed; await sleep(20)) {
      const line = this.lines.find(probe);
      if (line) return line;
    }
    throw Error(`BLOCKED: the hub never sent ${what}`);
  }
  static async open(socket: string, token: string): Promise<Client> {
    const sock = net.connect(socket);
    await new Promise<void>((done, failed) => { sock.once('connect', done); sock.once('error', failed); });
    const client = new Client(sock);
    await client.seen(() => true, 'its hello');
    sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
    await client.seen((line) => line.role === 'cli', 'the cli role');
    return client;
  }
  /** The hub's answer to a method: a refusal, such as a method the base lacks, is the caller's to judge. */
  async call(method: string, params: Line): Promise<Line> {
    const id = `${method}#${++this.ids}`;
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    return this.seen((line) => line.id === id, `its reply to ${method}`);
  }
  close(): void { this.sock.destroy(); }
}

// ---- The scene.
export interface StageOptions {
  /** Issue slots the hub runs at once. */
  slots?: number;
  /** Whether the hub holds a gate identity (#1325's stand-in). */
  gate?: boolean;
}
/** What a session was doing, which a blind job must never see. */
export interface Session { branchFile: string; transcript: string; marks: string[] }

export class Stage {
  /** What the stand-in does in each next job, in the order the jobs start. */
  readonly plans: Plan[] = [];
  /** What the work and the dispute carry, which no draft may see. */
  readonly marks = { work: 'WORK-MARK-dh1328', dispute: 'DISPUTE-MARK-dh1328' };
  private readonly planned = new Set<string>();
  private conducting = false;
  private readonly conductor: NodeJS.Timeout;
  private askMark = 0;
  private constructor(
    readonly dir: string, readonly repo: string, readonly base: string, private readonly bin: string, private readonly forge: string,
    readonly gatesFile: string, readonly gateKey: string | null,
    private readonly child: ChildProcess, private readonly exited: Promise<unknown>, private readonly stderr: () => string, private readonly client: Client,
  ) {
    this.conductor = setInterval(() => void this.conduct(), 50);
  }

  static async open(o: StageOptions = {}): Promise<Stage> {
    if (!existsSync(CLI)) throw Error(`BLOCKED: the hub isn't built (${CLI}); run npm run build --workspaces`);
    const dir = tempDir(), h = home();
    const repo = join(dir, 'repo'), bin = join(dir, 'bin'), root = join(dir, 'root');
    mkdirSync(repo);
    mkdirSync(join(bin, 'plans'), { recursive: true });
    mkdirSync(root);
    const versions = (JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as { versions: string[] }).versions;
    writeFileSync(join(bin, 'claude'), readFileSync(FAKE, 'utf8').replace('__VERSION__', versions.at(-1)!), { mode: 0o755 });
    git(repo, 'init', '-q', '-b', 'main');
    write(repo, {
      'package.json': `${JSON.stringify({ name: 'widgets', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2)}\n`,
      'src/widget.mjs': "export const colour = () => 'red';\nexport const name = () => 'widget';\n",
      'scripts/proof-guard.mjs': '// the guard, as main holds it\n',
      'AGENTS.md': '# Rules for this fixture\n',
      'docs/technical-design.md': '# The fixture design\n',
    });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'The base');
    const base = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'update-ref', 'refs/remotes/origin/main', base);

    let gateKey: string | null = null;
    const gatesFile = join(dir, 'gates');
    if (o.gate !== false) {
      gateKey = join(dir, 'gate-key');
      execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'gate@example.invalid', '-f', gateKey], { stdio: ['ignore', 'pipe', 'pipe'] });
      writeFileSync(gatesFile, `gate@example.invalid ${readFileSync(`${gateKey}.pub`, 'utf8')}`);
    }
    writeFileSync(join(root, 'config.json'), `${JSON.stringify(hubConfig(`${bin}:/usr/bin:/bin`, o.slots ?? 2, gateKey), null, 2)}\n`);
    const forge = join(dir, 'forge.json');

    const child = spawn(process.execPath, [CLI, 'hub', 'run', '--root', root], {
      cwd: REPO, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HOME: h, LC_ALL: 'C', DEEP_HUB_TEST_GITHUB: forge },
    });
    let err = '', out = '';
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { err += d; });
    child.stdout!.setEncoding('utf8').on('data', (d: string) => { out += d; });
    const exited = new Promise((done) => child.on('exit', done));
    for (const end = Date.now() + 60_000; !out.includes('\n') && child.exitCode === null && Date.now() < end;) await sleep(20);
    let socket: string | undefined;
    try { socket = (JSON.parse(out.split('\n')[0] ?? '') as Line).socket as string; } catch { /* no ready line */ }
    const client = socket ? await Client.open(socket, readFileSync(join(root, 'control.token'), 'utf8').trim()).catch(() => undefined) : undefined;
    if (!client) {
      try { process.kill(child.pid!, 'SIGKILL'); } catch { /* gone */ }
      throw Error(`BLOCKED: the hub didn't start: ${err.slice(0, 2000)}`);
    }
    const stage = new Stage(dir, repo, base, bin, forge, gatesFile, gateKey, child, exited, () => err, client);
    stage.setBodies({ [ISSUE]: bodyOf(ISSUE), [NEXT]: bodyOf(NEXT) });
    // A window reading with room, so its jobs don't wait for a first one.
    await stage.answered('windows.report', { agent: 'claude-code', account: ACCOUNT, rate_limits: { five_hour: { used_percentage: 5, resets_at: Math.floor(Date.now() / 1000) + 10_800 }, seven_day: { used_percentage: 20, resets_at: Math.floor(Date.now() / 1000) + 400_000 } } });
    const events = await stage.events();
    stage.askMark = events.at(-1)?.log_pos ?? 0;
    return stage;
  }

  async close(): Promise<void> {
    clearInterval(this.conductor);
    this.client.close();
    try { process.kill(this.child.pid!, 'SIGTERM'); } catch { return; }
    await Promise.race([this.exited, sleep(15_000)]);
    if (this.child.exitCode === null) try { process.kill(this.child.pid!, 'SIGKILL'); } catch { /* gone */ }
  }

  /** The stand-in forge: the issues as the hub's recorded GitHub answers hold them, which a test may rewrite between two reads. */
  bodies: Record<number, string> = {};
  setBodies(bodies: Record<number, string>): void {
    Object.assign(this.bodies, bodies);
    const at = `/repos/${OWNER}/${NAME}`;
    const issues = Object.entries(this.bodies).flatMap(([n, body]) => [
      { path: `${at}/issues/${n}`, body: { number: Number(n), title: `Fixture ${n}`, body, html_url: linkOf(Number(n)), user: { login: OWNER, type: 'User' }, updated_at: '2026-11-07T00:00:00Z' } },
      { path: `${at}/issues/${n}/comments`, body: [] },
    ]);
    writeFileSync(`${this.forge}.new`, JSON.stringify({ answers: [{ path: at, body: { owner: { login: OWNER } } }, { path: `${at}/collaborators`, body: [] }, ...issues] }));
    renameSync(`${this.forge}.new`, this.forge);
  }

  /** The hub's reply; a refusal fails here at an assertion, which is where a base without the method fails. */
  async answered(method: string, params: Line): Promise<Line> {
    const reply = await this.client.call(method, params);
    expect(reply.error, `the hub refused ${method} ${JSON.stringify(params).slice(0, 300)}: ${JSON.stringify(reply.error)}`).toBeUndefined();
    return reply.result as Line;
  }

  /** Hands each new job of the kind its plan, keyed by its folder (fixtures/fake-claude.pl). */
  private async conduct(): Promise<void> {
    if (this.conducting) return;
    this.conducting = true;
    try {
      for (const job of ((await this.client.call('job.list', {})).result?.jobs ?? []) as Line[]) {
        if (job.kind !== KIND || this.planned.has(job.job)) continue;
        this.planned.add(job.job);
        const path = join(this.bin, 'plans', `${basename(String(job.folder))}.json`);
        writeFileSync(`${path}.new`, JSON.stringify(this.plans.shift() ?? {}));
        renameSync(`${path}.new`, path);
      }
    } catch { /* the hub is closing */ } finally {
      this.conducting = false;
    }
  }

  // ---- The issue's job.
  start(issue = ISSUE): Promise<Line> {
    return this.answered(START, { issue: linkOf(issue), repo: this.repo, base: this.base, design: DESIGN, command: 'node --test', agent: 'claude-code' });
  }
  async status(issue = ISSUE): Promise<Status> {
    return (await this.answered(STATUS, { issue: linkOf(issue) })) as unknown as Status;
  }
  /** Fails at an assertion when `probe` never holds: a wrong program that hangs is judged, not left waiting. */
  private async until<T>(probe: () => Promise<T | undefined>, what: string): Promise<T> {
    for (const end = Date.now() + WAIT_MS; Date.now() < end; await sleep(100)) {
      const value = await probe();
      if (value !== undefined) return value;
    }
    expect.fail(`${what} never landed within ${WAIT_MS} ms; acceptance jobs: ${JSON.stringify(await this.jobs())}; hub stderr: ${this.stderr().slice(-1500)}`);
  }
  /** The issue's status once its job is judged. */
  judged(issue = ISSUE): Promise<Status> {
    return this.until(async () => { const s = await this.status(issue); return s.state === 'done' ? s : undefined; }, `the job's result on issue ${issue}`);
  }
  /** A first draft taken through the job to `ready`. */
  async ready(issue = ISSUE, assertion = BLUE): Promise<Status> {
    this.plans.push(firstDraft(issue, assertion));
    await this.start(issue);
    const status = await this.judged(issue);
    expect(status.result, `issue ${issue}'s first draft: its result, why ${status.why}`).toBe('ready');
    return status;
  }

  // ---- The record.
  async events(kind?: string): Promise<Line[]> {
    const all: Line[] = [];
    for (let after = 0; ;) {
      const page = (await this.answered('events.read', { after, limit: 1000 })).events as Line[];
      if (!page.length) break;
      all.push(...page);
      after = page.at(-1)!.log_pos as number;
    }
    return kind ? all.filter((e) => e.kind === kind) : all;
  }
  async jobs(): Promise<string[]> {
    return ((await this.answered('job.list', {})).jobs as Line[]).filter((j) => j.kind === KIND).map((j) => String(j.job));
  }
  async folderOfJob(job: string): Promise<string> {
    return String((await this.answered('job.status', { job })).folder);
  }
  /** The job's input record, from its `job.recorded` event. */
  async inputsOf(job: string): Promise<Input[]> {
    const recorded = (await this.events('job.recorded')).find((e) => e.data?.job === job);
    expect(recorded?.data?.inputs, `the job.recorded event of ${job} lists its inputs: ${JSON.stringify(recorded?.data)}`).toBeInstanceOf(Array);
    return recorded!.data.inputs as Input[];
  }
  /** The inputs a first job on this repo must list, exactly. */
  expectedInputs(issue = ISSUE, body = bodyOf(issue)): Input[] {
    return [
      { kind: 'issue', ref: linkOf(issue), sha256: sha256(body) },
      ...DESIGN.map((path): Input => ({ kind: 'design', ref: path, sha256: sha256(readFileSync(join(this.repo, path), 'utf8')) })),
      { kind: 'base', ref: this.base },
    ];
  }
  /** Asks raised since the scene opened. */
  async asks(): Promise<Line[]> {
    return (await this.events('ask.created')).filter((e) => (e.log_pos as number) > this.askMark);
  }
  async attempts(issue = ISSUE): Promise<Line[]> {
    return (await this.events(ATTEMPT)).filter((e) => e.data?.issue === linkOf(issue));
  }
  /** What the stand-in reported of a job: its folder, its stdin, and how each read and write went. */
  async saw(job: string): Promise<{ cwd: string; stdin: string; planned: boolean; reads: { path: string; ok: boolean; error: string }[]; writes: { path: string; ok: boolean; error: string }[] }> {
    const stdout = String((await this.answered('job.output', { job })).stdout);
    for (const line of stdout.split('\n')) {
      let event: Line;
      try { event = JSON.parse(line) as Line; } catch { continue; }
      for (const part of (event.type === 'assistant' ? event.message?.content ?? [] : []) as Line[]) {
        if (part.type !== 'text' || !String(part.text).startsWith('fake:')) continue;
        const report = JSON.parse(String(part.text).slice(5)) as Line;
        return { ...report, stdin: Buffer.from(String(report.stdin), 'base64').toString('utf8') } as Awaited<ReturnType<Stage['saw']>>;
      }
    }
    throw Error(`BLOCKED: the stand-in reported nothing for ${job}: ${stdout.slice(0, 1500)}`);
  }

  // ---- The git repository.
  refs(): string {
    return git(this.repo, 'for-each-ref', '--format=%(refname) %(objectname)');
  }
  /** The checkout the hub was handed, which it never writes in: its HEAD and its files as the base left them. */
  untouched(): void {
    expect(git(this.repo, 'rev-parse', 'HEAD'), 'the repo checkout HEAD').toBe(this.base);
    expect(git(this.repo, 'status', '--porcelain'), 'git status in the repo checkout').toBe('');
  }
  /** A session on another branch, and its transcript, each with a mark. Made before the job starts. */
  session(): Session {
    const marks = ['BRANCH-MARK-dh1328', 'TRANSCRIPT-MARK-dh1328'];
    const worktree = join(this.dir, 'other');
    git(this.repo, 'worktree', 'add', '-q', '-b', 'other', worktree, this.base);
    write(worktree, { 'feature.txt': `the change ${marks[0]}\n` });
    git(worktree, 'add', '-A');
    git(worktree, 'commit', '-q', '-m', 'The change');
    const id = '5c0ffee0-0000-4000-8000-000000001328';
    const transcript = join(home(), '.claude', 'projects', worktree.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
    write(dirname(transcript), { [basename(transcript)]: `${JSON.stringify({ type: 'user', sessionId: id, message: { role: 'user', content: `make the widget blue ${marks[1]}` } })}\n` });
    return { branchFile: join(worktree, 'feature.txt'), transcript, marks };
  }
  /** The attempt's work, on its branch after the first commit: the widget turns blue. Its sha. */
  work(status: Status): string {
    const worktree = join(this.dir, 'session');
    git(this.repo, 'worktree', 'add', '-q', '--detach', worktree, status.commit!);
    write(worktree, { 'src/widget.mjs': `// ${this.marks.work}\nexport const colour = () => 'blue';\nexport const name = () => 'widget';\n` });
    git(worktree, 'add', '-A');
    git(worktree, 'commit', '-q', '-m', `Make the widget blue\n\nPart of #${ISSUE}`);
    const sha = git(worktree, 'rev-parse', 'HEAD');
    git(this.repo, 'update-ref', `refs/heads/${status.branch!}`, sha);
    return sha;
  }
  show(rev: string, path: string): string {
    return execFileSync('/usr/bin/git', ['show', `${rev}:${path}`], { cwd: this.repo, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: home() } });
  }

  // ---- Disputes.
  dispute(work: string, issue = ISSUE): Promise<Line> {
    return this.answered(DISPUTE, { issue: linkOf(issue), test: widgetTest(issue), work, why: `the test is wrong ${this.marks.dispute}` });
  }
  /** The issue's latest dispute once it has an outcome. */
  decided(issue = ISSUE): Promise<Dispute> {
    return this.until(async () => { const d = (await this.status(issue)).disputes.at(-1); return d?.outcome ? d : undefined; }, `the dispute's outcome on issue ${issue}`);
  }
  /** A draft saw the first job's inputs and the criterion, and nothing of the work or the dispute. */
  async blind(job: string, first: Input[]): Promise<void> {
    const inputs = await this.inputsOf(job);
    expect(inputs.filter((i) => i.kind !== 'criterion').sort(byRef), `redraft ${job}: its inputs but the criterion`).toEqual([...first].sort(byRef));
    expect(inputs.filter((i) => i.kind === 'criterion'), `redraft ${job}: its criterion`).toEqual([{ kind: 'criterion', ref: tagOf(ISSUE, NEW), sha256: sha256(NEW) }]);
    const saw = await this.saw(job);
    expect(saw.stdin, `redraft ${job}: its stdin holds the body the first job read`).toContain(bodyOf(ISSUE));
    expect(saw.stdin, `redraft ${job}: its stdin holds the criterion`).toContain(NEW);
    const seen = `${saw.stdin}\n${everything(await this.folderOfJob(job))}`;
    for (const mark of Object.values(this.marks)) expect(seen.includes(mark), `redraft ${job}: its stdin or folder holds ${mark}`).toBe(false);
  }
  /** Waits out what a wrong hub would do next, then says how many jobs and asks there are. */
  async quiet(): Promise<{ jobs: number; asks: number }> {
    await sleep(2500);
    return { jobs: (await this.jobs()).length, asks: (await this.asks()).length };
  }
}
export const byRef = (a: Input, b: Input): number => `${a.kind} ${a.ref}`.localeCompare(`${b.kind} ${b.ref}`);

/** A hub for one test, stopped by its PID whatever the test does. */
export async function withStage<T>(options: StageOptions, play: (stage: Stage) => Promise<T>): Promise<T> {
  const stage = await Stage.open(options);
  try {
    return await play(stage);
  } finally {
    await stage.close();
  }
}

/** One scene several tests read: it plays once, and each reads its facts or its failure. */
export const once = <T>(play: () => Promise<T>): (() => Promise<T>) => {
  let played: Promise<T> | undefined;
  return () => (played ??= play());
};

// ---- The real guard, in a checkout of `sha`.
/** A checkout of `sha` the guard reads, its tags and refs shared with the repo. */
export function checkoutOf(repo: string, sha: string, name: string): string {
  const cwd = join(dirname(repo), name);
  git(repo, 'worktree', 'add', '-q', '--detach', cwd, sha);
  return cwd;
}
/** `node scripts/proof.mjs guard`, with no person's approvers and, when `gates` names it, the gate identity accepted. */
export function runGuard(cwd: string, dir: string, gates: string | null): { status: number | null; refused: string[]; text: string } {
  if (!existsSync(join(REPO, 'node_modules/typescript'))) throw Error('BLOCKED: the guard needs the repo install (npm ci)');
  const issues = join(dir, 'issues');
  write(issues, { [`${ISSUE}.md`]: bodyOf(ISSUE) });
  const run = spawnSync(process.execPath, [join(REPO, 'scripts/proof.mjs'), 'guard'], {
    cwd, encoding: 'utf8', timeout: 120_000,
    env: { ...process.env, HOME: home(), DEEP_PROOF_ISSUES: issues, DEEP_APPROVERS: join(dir, 'no-approvers'), [GATES_VARIABLE]: gates ?? join(dir, 'no-gates') },
  });
  return { status: run.status, refused: run.stdout.split('\n').filter((line) => line.startsWith('FAIL guard:')), text: `exit ${run.status}\n${run.stdout}\n${run.stderr}` };
}
/** Signs `items` for `commit` with the gate's key, under the ref folder the hub's own tag on its swap sits in. */
export function gateTag(cwd: string, key: string, likeRef: string, commit: string, items: string[]): void {
  const name = `${dirname(likeRef).replace(/^refs\/tags\//, '')}/planted`;
  git(cwd, '-c', 'gpg.format=ssh', '-c', `user.signingkey=${key}`, 'tag', '-s', '-m', items.map((item) => `Approves: ${item}`).join('\n'), name, commit);
}
