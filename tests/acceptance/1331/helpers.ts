// Test-side tools for #1331's acceptance tests (README): a world under /tmp/dh1331-* with the fixture forge (forge.ts),
// a repo of small Vitest checks cloned into the hub's checkout, the real hub (`deep hub run`) with the forge as its
// GitHub, the `deep land` and `deep work` commands as you run them, and readings of the forge and the record. Nothing
// here stands in for DeepBuild: the hub, its record, the gate's runs and carrying, and Vitest are real. Only the forge
// (GitHub) and the agents (a `claude` that records that it was started and does nothing) are played. No network beyond
// 127.0.0.1, no model; processes are stopped by PID only.
import { execFile, spawn } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect } from 'vitest';
import { allEvents, childEnv, CLI, DEFAULT_RULES, REPO, SETTINGS, sleep, stopHub, type Ev, type Hub } from '../29/h-d.ts';
import { installVitest } from '../875/helpers.ts';
import { git as bareGit, LandForge } from './forge.ts';

export { sleep };
export type { Ev };
export const NODE = process.execPath;
export const SHOP = 'acme/shop';
export const PERSON = 'maya';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };

/** The criteria's IDs: `#1331.` and the first 8 hex digits of SHA-256 of each criterion's text, white space collapsed (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #1331.4fa5b9e9', 2: 'AC2 #1331.13b15250', 3: 'AC3 #1331.6af520ad', 4: 'AC4 #1331.df47d8f0',
  5: 'AC5 #1331.493ec9f5', 6: 'AC6 #1331.1f3c4595', 7: 'AC7 #1331.2bc8d32a', 8: 'AC8 #1331.ae56ff0d',
} as const;

for (const key of Object.keys(process.env)) if (/^(CLAUDE|DEEP_|CODEX|GH_|GITHUB_|GIT_)/.test(key)) delete process.env[key];

const made: string[] = [];
const worlds: World[] = [];
afterAll(async () => {
  for (const w of worlds.splice(0)) await w.close();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ---- The repo: checks are Vitest files, one command line each (#875's form, as #1018 uses). `own<i>` reads src/x<i>.ts;
// `c` and `cc` both read src/c.ts, as two checks with different definitions; `flaky` passes and fails on alternate runs (see testFile).
export const CHECKS = ['own1', 'own2', 'own3', 'c', 'cc', 'flaky'] as const;
export const checkFile = (name: string): string => `.deepbuild/checks/${name}.sh`;
const SOURCES: Record<string, string> = { own1: 'x1', own2: 'x2', own3: 'x3', c: 'c', cc: 'c', flaky: 'x1' };
const testFile = (name: string, flipFile: string): string => name === 'flaky'
  // A run may write only its checkout and its temp folder, and may read only its checkout and the tools it names; but it may
  // stat any path. So the run takes its turn from the size of `flipFile` (the world's counter, written by the world's
  // watcher, never by the run), and says it has run by leaving a marker in its own temp folder, which the watcher reads.
  ? `import { statSync, writeFileSync } from 'node:fs';\nimport { join } from 'node:path';\nimport { expect, it } from 'vitest';\nit('flaky', () => {\n  const n = statSync(${JSON.stringify(flipFile)}).size + 1;\n  writeFileSync(join(process.env.TMPDIR!, 'flaky-ran'), ${JSON.stringify(flipFile)});\n  expect(n % 2).toBe(1);\n});\n`
  : `import { expect, it } from 'vitest';\nimport { v } from '../src/${SOURCES[name]}';\nit('${name}', () => { expect(String(v)).not.toContain('BROKEN'); });\n`;
export const BASE_FILES = (flipFile: string): Record<string, string> => ({
  'README.md': '# shop\n',
  'package.json': '{ "name": "shop", "private": true, "type": "module" }\n',
  '.gitignore': 'node_modules/\n',
  'docs/earlier.txt': 'present from the start\n',
  ...Object.fromEntries(['x1', 'x2', 'x3', 'c'].map((n) => [`src/${n}.ts`, `export const v = 'base-${n}';\n`])),
  ...Object.fromEntries(CHECKS.flatMap((n) => [[`test/${n}.test.ts`, testFile(n, flipFile)], [checkFile(n), `node_modules/.bin/vitest run test/${n}.test.ts\n`]])),
});

/** A requirement of a handed definition (#29's shape): `check` names a drafted check file; `extra` holds fields this issue adds. */
export const requirement = (id: string, text: string, check: string | null, extra: Line = {}): Line => ({
  id, text, source_line: 'ask#L1', refuted_by: `a run where ${text.toLowerCase()} does not hold`, check, on_base: 'passes', asserts: [], depth: 'unit', oracle: 'code', near_misses: [], ...extra,
});
/** A definition handed for an issue of the repo (DEEP_HUB_TEST_DRAFTS, `issue` form, as #29 hands one for a work item). */
export const draftFor = (issue: number, requirements: Line[]): Line => ({ issue: `${SHOP}#${issue}`, requirements, deliverables: [], budget: null });

export interface Ran { code: number | null; stdout: string; stderr: string; json: Line | null; ms: number }
export interface Round { held: { pr: number; issue: number; reason: string }[]; sent_back: { pr?: number; issue: number; files: string[] }[]; stopped: { commit?: string; files: string[] } | null; joined: { pr: number; issue: number }[]; landed: { pr: number; issue: number }[] }

export class World {
  hub!: Hub;
  readonly home: string;
  readonly root: string;
  readonly checkout: string;
  readonly work: string;
  readonly token: string;
  readonly log: string;
  readonly flip: string;
  readonly base: string;
  private branches = 0;
  private ticker: NodeJS.Timeout | undefined;
  private constructor(readonly tmp: string, readonly forge: LandForge, readonly plant: string | undefined, token: string, base: string) {
    this.home = join(tmp, 'h'); this.root = join(this.home, '.deepbuild'); this.checkout = join(tmp, 'checkout'); this.work = join(tmp, 'work');
    this.log = join(this.home, 'claude.log'); this.flip = join(tmp, 'flip'); this.token = token; this.base = base;
  }

  static async open(o: { drafts: Line[]; plant?: string; drop?: { nth: number; path: string } }): Promise<World> {
    if (!existsSync(CLI)) throw Error(`BLOCKED: the deep CLI (npm run build --workspaces) is not built at ${CLI}`);
    const tmp = realpathSync(mkdtempSync('/tmp/dh1331-'));
    made.push(tmp);
    const home = join(tmp, 'h');
    const root = join(home, '.deepbuild');
    mkdirSync(root, { recursive: true, mode: 0o700 });
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
    writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS, github: { delivery: { [SHOP]: 'on' }, yours: [PERSON] } }, null, 2)}\n`);
    writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
    writeFileSync(join(tmp, 'drafts.json'), `${JSON.stringify({ drafts: o.drafts }, null, 2)}\n`);
    writeFileSync(join(tmp, 'work.json'), `${JSON.stringify({ readings: [] }, null, 2)}\n`);
    // The agent stand-in: `claude` and `codex` first on PATH. Starting one is recorded and does nothing.
    const bin = join(tmp, 'bin');
    mkdirSync(bin);
    for (const name of ['claude', 'codex']) {
      writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $* (cwd $PWD)" >> '${join(home, 'claude.log')}'\nexit 0\n`);
      chmodSync(join(bin, name), 0o755);
    }
    const forge = await LandForge.start(join(tmp, 'forge'), SHOP);
    if (o.drop) forge.drop = o.drop;
    const token = forge.gate.person(PERSON, true);
    const w = new World(tmp, forge, o.plant, token, '');
    worlds.push(w);
    mkdirSync(w.work);
    await w.git(w.work, 'init', '-q', '-b', 'main');
    await w.git(w.work, 'remote', 'add', 'origin', forge.gate.gitUrl(SHOP));
    for (const [path, bytes] of Object.entries(BASE_FILES(w.flip))) { mkdirSync(join(w.work, path, '..'), { recursive: true }); writeFileSync(join(w.work, path), bytes); }
    await w.git(w.work, 'add', '-A');
    await w.git(w.work, 'commit', '-q', '-m', 'Start the shop');
    await w.git(w.work, 'push', '-q', '-u', 'origin', 'main');
    // The hub's checkout: a clone of origin with Vitest installed (ignored by the repo's .gitignore).
    await w.git(tmp, 'clone', '-q', forge.gate.gitUrl(SHOP), w.checkout);
    installVitest(w.checkout);
    (w as { base: string }).base = (await w.git(w.work, 'rev-parse', 'HEAD')).trim();
    writeFileSync(w.flip, '');
    w.watch();
    w.hub = await w.startHub();
    return w;
  }

  /** git as maya: her name on commits, her token on every request to the forge. */
  git(cwd: string, ...args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('git', ['-C', cwd, '-c', `user.name=${PERSON}`, '-c', `user.email=${PERSON}@example.invalid`, '-c', 'commit.gpgsign=false', '-c', 'credential.helper=',
        '-c', `http.extraHeader=Authorization: Bearer ${this.token}`, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } },
      (error, stdout, stderr) => (error ? reject(Error(`git ${args.join(' ')}: ${stderr.trim() || error.message}`)) : resolve(stdout)));
    });
  }
  private env(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
    return childEnv(this.home, {
      PATH: `${join(this.tmp, 'bin')}:${dirOf(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
      DEEP_HUB_TEST_CONFIRM: join(this.tmp, 'confirm'), DEEP_HUB_TEST_DRAFTS: join(this.tmp, 'drafts.json'), DEEP_HUB_TEST_WORK: join(this.tmp, 'work.json'),
      DEEP_HUB_TEST_FORGE: this.forge.url, GH_TOKEN: this.token, ...extra,
    });
  }
  private async startHub(): Promise<Hub> {
    const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: this.checkout, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: this.env(this.plant ? { DEEP_HUB_PLANT: this.plant } : {}) });
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
      throw Error(`BLOCKED: the hub${this.plant ? ` with the plant DEEP_HUB_PLANT=${this.plant}` : ''} did not start (a plant the base doesn't list stops it): ${err.slice(-800)}`);
    }
    return { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), home: this.home, root: this.root, child, exit, readyAt: Date.now(), clock: undefined, plant: this.plant, stderr: () => err };
  }
  /** One byte more in `flip` for each run of the `flaky` check, counted from the marker the run leaves in its own temp folder, so runs alternate pass, fail. */
  private watch(): void {
    const seen = new Set<string>();
    this.ticker = setInterval(() => {
      try {
        const root = realpathSync(tmpdir());
        for (const dir of readdirSync(root)) {
          if (!dir.startsWith('deep-check-') || seen.has(dir)) continue;
          const marker = join(root, dir, 'flaky-ran');
          if (!existsSync(marker) || readFileSync(marker, 'utf8') !== this.flip) continue;
          seen.add(dir);
          appendFileSync(this.flip, 'x');
        }
      } catch { /* a folder removed under the scan: the next tick reads again */ }
    }, 10);
  }
  async close(): Promise<void> {
    if (this.ticker) clearInterval(this.ticker);
    if (this.hub) {
      const kids = await new Promise<number[]>((resolve) => execFile('pgrep', ['-P', String(this.hub.pid)], (_e, out) => resolve(out.split('\n').filter(Boolean).map(Number))));
      await stopHub(this.hub).catch(() => undefined);
      for (const pid of kids) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
    }
    await this.forge.close();
  }

  // ---- The forge's side: issues, branches, pull requests.
  issue(title: string): number { return this.forge.issue({ title, body: `### Acceptance criteria\n- [ ] ${title}\n` }); }
  /** A branch of main's current head with `files` written, pushed by maya; returns its head. */
  async branch(name: string, files: Record<string, string>): Promise<string> {
    await this.git(this.work, 'fetch', '-q', 'origin');
    await this.git(this.work, 'checkout', '-q', '-B', name, 'origin/main');
    for (const [path, bytes] of Object.entries(files)) { mkdirSync(join(this.work, path, '..'), { recursive: true }); writeFileSync(join(this.work, path), bytes); }
    await this.git(this.work, 'add', '-A');
    await this.git(this.work, 'commit', '-q', '-m', `Change ${name}`);
    await this.git(this.work, 'push', '-q', '-f', 'origin', name);
    this.branches++;
    return (await this.git(this.work, 'rev-parse', 'HEAD')).trim();
  }
  /** Opens a pull request of `branch` that links `issue`. */
  pr(branch: string, issue: number, o: { body?: string; daysIdle?: number } = {}): number {
    return this.forge.pull({ head: branch, title: `Change ${branch}`, body: o.body ?? `Closes #${issue}`, login: PERSON, ...(o.daysIdle === undefined ? {} : { daysIdle: o.daysIdle }) });
  }
  /** Branch, issue and PR in one: a change to `files` for a new issue. */
  async change(name: string, files: Record<string, string>, o: { body?: string } = {}): Promise<{ issue: number; pr: number; head: string }> {
    const issue = this.issue(`Issue for ${name}`);
    const head = await this.branch(name, files);
    return { issue, pr: this.pr(name, issue, o), head };
  }

  // ---- `deep` as you run it.
  deep(args: string[], o: { timeoutMs?: number } = {}): Promise<Ran> {
    const t0 = Date.now();
    return new Promise((resolve) => {
      const child = spawn(NODE, [CLI, ...args], { cwd: this.checkout, env: this.env(), stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout!.setEncoding('utf8').on('data', (d: string) => (stdout += d));
      child.stderr!.setEncoding('utf8').on('data', (d: string) => (stderr += d));
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, o.timeoutMs ?? 300_000);
      child.on('close', (code) => {
        clearTimeout(timer);
        let json: Line | null = null;
        for (const line of stdout.split('\n').reverse()) { if (line.trim().startsWith('{')) { try { json = JSON.parse(line) as Line; break; } catch { /* next */ } } }
        resolve({ code, stdout, stderr, json, ms: Date.now() - t0 });
      });
    });
  }
  /** `deep land judge`: each open linked pull request judged on its merge with the default branch's head; nothing lands. */
  judge(): Promise<Ran> { return this.deep(['land', 'judge', '--repo', this.checkout, '--json']); }
  /** `deep land`: one landing round. */
  land(): Promise<Ran> { return this.deep(['land', '--repo', this.checkout, '--json']); }
  /** `deep work --issues <n,...> --once`: one pass of a run over a fixed set of issues. */
  workOnce(issues: number[]): Promise<Ran> { return this.deep(['work', '--repo', this.checkout, '--issues', issues.join(','), '--once', '--json']); }
  /** `node scripts/main-watch.mjs status`, run in the hub's checkout, as #1333's gate: exit 0 `landings open`, 1 `landings paused: …`. */
  watchStatus(): Promise<{ code: number | null; out: string }> {
    return new Promise((resolve) => execFile(NODE, [join(REPO, 'scripts/main-watch.mjs'), 'status'], { cwd: this.checkout, env: this.env(), encoding: 'utf8' }, (e, out, err) => resolve({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, out: `${out}${err}` })));
  }

  // ---- Readings.
  events(): Promise<Ev[]> { return allEvents(this.hub); }
  async runs(): Promise<{ check: string; commit: string; run: string }[]> {
    return (await this.events()).filter((e) => e.kind === 'run.started').map((e) => ({ check: String(e.data.check), commit: String(e.data.commit), run: String(e.data.run) }));
  }
  /** How many runs of each drafted check the record shows started, by check name. */
  async runCounts(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const r of await this.runs()) { const name = /([^/]+?)(?:\.sh)?$/.exec(r.check)?.[1] ?? r.check; out[name] = (out[name] ?? 0) + 1; }
    return out;
  }
  async asks(): Promise<Ev[]> { return (await this.events()).filter((e) => e.kind === 'ask.created'); }
  /** Main's first-parent line, oldest first, after the base commit. */
  async landings(): Promise<string[]> {
    return (await bareGit(this.forge.bareRepo, ['rev-list', '--first-parent', '--reverse', `${this.base}..main`])).out.split('\n').filter(Boolean);
  }
  async mainHead(): Promise<string> { return (await bareGit(this.forge.bareRepo, ['rev-parse', 'refs/heads/main'])).out; }
  async treeOf(sha: string): Promise<string> { return (await bareGit(this.forge.bareRepo, ['rev-parse', `${sha}^{tree}`])).out; }
  async filesOf(sha: string): Promise<string[]> { return (await bareGit(this.forge.bareRepo, ['ls-tree', '-r', '--name-only', sha])).out.split('\n').filter(Boolean); }
  /** The trees of every commit that holds a success verdict status (`deepbuild/verdict`, #46) in the forge. */
  async verdictTrees(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const s of this.forge.gate.statuses) if (s.context === 'deepbuild/verdict' && s.state === 'success') out.set(await this.treeOf(s.sha), s.sha);
    return out;
  }
  /** The text the issue's body and comments hold. */
  issueText(n: number): string { const i = this.forge.issues.get(n)!; return `${i.body}\n${i.comments.map((c) => c.body).join('\n')}`; }
  claudeStarts(): string { return existsSync(this.log) ? readFileSync(this.log, 'utf8') : ''; }
}
const dirOf = (p: string): string => p.slice(0, p.lastIndexOf('/'));

/** Asserts a judgement fails on the planted wrong program and that the failure names each of `names`. */
export async function mustFail(what: string, judge: () => unknown | Promise<unknown>, names: string[]): Promise<void> {
  let message: string | null = null;
  try { await judge(); } catch (error) {
    const m = error instanceof Error ? error.message : String(error);
    if (m.startsWith('BLOCKED:')) throw error;
    message = m;
  }
  expect(message, `${what}: the planted wrong program passed the judgement, so it proves nothing`).not.toBeNull();
  for (const n of names) expect(message, `${what}: the failure must name ${n}`).toContain(n);
}
/** `ok` or throw: the thrown message is what a failing criterion says (and what a plant's failure must name). */
export function must(ok: boolean, message: string): asserts ok { if (!ok) throw Error(message); }
