// Helpers for #1816's acceptance tests (README). A fixture repo the spine judges: a bare origin, the user's repo cloned
// from it (so it has origin/main), this checkout's scripts/*.mjs copied into it so that `scripts/spine.mjs`'s root is
// the fixture, its SPINE table's commit for one task pointed at the fixture's commit, and a fake `gh` first on PATH that
// serves the fixture's issue bodies and records reopenings. Nothing reaches GitHub; nothing touches this checkout's git.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const NODE = process.execPath;

// ---- Criterion IDs: `#1816.` + the first 8 hex of SHA-256 of the criterion's text, trimmed, white space collapsed
// (scripts/proof-change.mjs `criterionId`). README: Criteria.
export const AC1 = 'AC1 #1816.82cb5332';
export const AC2 = 'AC2 #1816.1b37f8c3';
export const AC3 = 'AC3 #1816.7bc2d1b4';
export const AC4 = 'AC4 #1816.c7e80311';
export const AC5 = 'AC5 #1816.6b352974';

export function must(ok: boolean, message: string): asserts ok {
  if (!ok) throw Error(message);
}

/** A fixture issue's criterion ID, as scripts/proof-change.mjs computes it. */
export const idOf = (issue: number, text: string): string => `#${issue}.${createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;

const made: string[] = [];
function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1816-'));
  made.push(dir);
  return dir;
}
export function cleanup(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** The env of every process of a fixture: no git, gh, DEEP or Claude setting of the runner's; HOME and TMPDIR inside it. */
function env(tmp: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(GIT_|DEEP_|XDG_|CLAUDE|GH_|GITHUB_|npm_|VITEST|TEST)/.test(k) || k === 'NODE_OPTIONS') continue;
    out[k] = v;
  }
  return { ...out, HOME: join(tmp, 'home'), TMPDIR: join(tmp, 'tmp'), PATH: `${join(tmp, 'bin')}:${process.env.PATH ?? ''}`, GIT_CONFIG_NOSYSTEM: '1', npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' };
}

export const git = (cwd: string, tmp: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd, env: env(tmp), encoding: 'utf8' }).trim();

function write(dir: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
}

/** The merged commit `node scripts/spine.mjs list` names for a spine task, in this checkout. */
function listedCommit(issue: number): string {
  const r = spawnSync(NODE, ['scripts/spine.mjs', 'list'], { cwd: REPO, encoding: 'utf8' });
  const m = new RegExp(`^#${issue} ([0-9a-f]{40})$`, 'm').exec(r.stdout ?? '');
  must(m !== null, `BLOCKED: \`node scripts/spine.mjs list\` in this checkout names no commit for #${issue}: ${`${r.stdout}${r.stderr}`.slice(0, 400)}`);
  return m[1]!;
}

export interface Fixture {
  tmp: string;
  /** The user's repo: a clone of origin, and the spine's root. */
  root: string;
  /** Issue bodies the fake gh serves (`<n>.md`) and its `reopened.log`. */
  issues: string;
}

/**
 * Origin (bare) with main at one commit of `base`'s files, the user's repo cloned from it with this checkout's
 * scripts/*.mjs copied in, node_modules holding a link to this checkout's typescript (the scripts import it) and a
 * marker package `dh1816-marker`, and the fake gh. Returns the fixture and that base commit.
 */
export function makeFixture(base: Record<string, string>, issues: Record<number, string>): { fx: Fixture; baseCommit: string } {
  const tmp = tempDir();
  for (const d of ['home', 'tmp', 'bin', 'issues']) mkdirSync(join(tmp, d), { recursive: true });
  const fx: Fixture = { tmp, root: join(tmp, 'repo'), issues: join(tmp, 'issues') };
  for (const [n, body] of Object.entries(issues)) writeFileSync(join(fx.issues, `${n}.md`), body);
  // `gh issue view <n> …` prints the body; `gh issue reopen <n> …` is recorded; anything else fails.
  writeFileSync(join(tmp, 'bin', 'gh'), `#!/bin/sh
dir='${fx.issues}'
if [ "$1" = issue ] && [ "$2" = view ] && [ -f "$dir/$3.md" ]; then cat "$dir/$3.md"; exit 0; fi
if [ "$1" = issue ] && [ "$2" = reopen ]; then printf '%s\\n' "$*" >> "$dir/reopened.log"; exit 0; fi
echo "fake gh: no answer for: $*" >&2; exit 1
`);
  chmodSync(join(tmp, 'bin', 'gh'), 0o755);
  const seed = join(tmp, 'seed');
  mkdirSync(seed);
  git(seed, tmp, 'init', '-q');
  write(seed, base);
  git(seed, tmp, 'add', '-A');
  git(seed, tmp, 'commit', '-q', '-m', 'base');
  git(tmp, tmp, 'clone', '-q', '--bare', seed, 'origin.git');
  git(tmp, tmp, 'clone', '-q', join(tmp, 'origin.git'), 'repo');
  rmSync(seed, { recursive: true, force: true });
  mkdirSync(join(fx.root, 'scripts'));
  for (const f of readdirSync(join(REPO, 'scripts')).filter((f) => f.endsWith('.mjs'))) cpSync(join(REPO, 'scripts', f), join(fx.root, 'scripts', f));
  mkdirSync(join(fx.root, 'node_modules', 'dh1816-marker'), { recursive: true });
  symlinkSync(join(REPO, 'node_modules', 'typescript'), join(fx.root, 'node_modules', 'typescript'));
  write(join(fx.root, 'node_modules', 'dh1816-marker'), { 'package.json': '{"name":"dh1816-marker","version":"1.0.0","main":"index.js"}\n', 'index.js': 'module.exports = "dh1816-marker";\n' });
  // The copied scripts and node_modules are the user's untracked, ignored tooling, as in a real checkout.
  write(join(fx.root, '.git', 'info'), { exclude: 'node_modules/\nscripts/\n' });
  return { fx, baseCommit: git(fx.root, tmp, 'rev-parse', 'HEAD') };
}

/** Commits `files` on the user's repo's current branch; returns the commit. */
export function commit(fx: Fixture, files: Record<string, string>, message: string): string {
  write(fx.root, files);
  git(fx.root, fx.tmp, 'add', '-A');
  git(fx.root, fx.tmp, 'commit', '-q', '-m', message);
  return git(fx.root, fx.tmp, 'rev-parse', 'HEAD');
}

/** Points the fixture's copy of spine.mjs at `to` as the merged commit of spine task `issue` (its table names real commits). */
export function pointSpine(fx: Fixture, issue: number, to: string): void {
  const file = join(fx.root, 'scripts', 'spine.mjs');
  const listed = listedCommit(issue);
  const text = readFileSync(file, 'utf8');
  must(text.includes(listed), `BLOCKED: scripts/spine.mjs doesn't hold #${issue}'s merged commit ${listed} as a literal, so the fixture can't point it at its own commit`);
  writeFileSync(file, text.split(listed).join(to));
}

export interface Judged { issue: number; commit: string; verdict: string; criteria: ({ id: string; outcome: string } & Record<string, unknown>)[]; reopen: { criterion: string } | null; why?: string }
export interface Judging { status: number | null; stdout: string; stderr: string; lines: Judged[] }

/** `node scripts/spine.mjs judge --issue <n>` in the user's repo, the fake gh first on PATH. */
export function judge(fx: Fixture, issue: number): Judging {
  const r = spawnSync(NODE, ['scripts/spine.mjs', 'judge', '--issue', String(issue)], { cwd: fx.root, env: env(fx.tmp), encoding: 'utf8', timeout: 600_000, maxBuffer: 1 << 26 });
  const lines = (r.stdout ?? '').split('\n').filter((l) => l.trim().startsWith('{')).map((l) => JSON.parse(l) as Judged);
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', lines };
}
export const shown = (j: Judging): string => `exit ${j.status}; stdout ${JSON.stringify(j.stdout.slice(-1500))}; stderr ${JSON.stringify(j.stderr.slice(-800))}`;

/** The user's repo's worktrees, as `git worktree list --porcelain` prints them. */
export const worktrees = (fx: Fixture): string => git(fx.root, fx.tmp, 'worktree', 'list', '--porcelain');
