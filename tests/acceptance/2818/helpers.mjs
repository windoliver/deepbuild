// Helpers for #2818's acceptance tests (README: Surface choices). Nothing here imports the code under test: each surface
// is reached by running it, in a sandbox with its own HOME and TMPDIR and with stand-ins first on PATH for what the
// repository doesn't own: gh and GitHub (gh.mjs), cargo (cargo.mjs) and the hub's `deep lease`. The sandbox, and every
// process a test started, by its process group's PID, are removed after the test.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { APPROVERS, people, tag } from '../../fixtures/approver.mjs';

// git reads these ahead of its own discovery, so one left set by whatever started this run would send every git call
// made here, approver.mjs's too, to another repository.
for (const name of Object.keys(process.env)) if (name.startsWith('GIT_')) delete process.env[name];

export { assert };
export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const HERE = fileURLToPath(new URL('./', import.meta.url));
export const KNOWN = 'scripts/known-failures.json';
const CHECK = 'scripts/known-failures-check.mjs';
/** A record runs and reruns its failures on a loaded machine; a hang still ends. */
export const LONG = { timeout: 1_800_000 };
/** The end of a note, as known-failures-check.mjs reads it: `(#<issue>, added <YYYY-MM-DD>)`. */
export const SUFFIX = /\(#(\d+), added (\d{4}-\d{2}-\d{2})\)$/;
const HEX = /\b[0-9a-f]{7,40}\b/g;
/** Whether `text` names the commit `sha` by a word of at least its first seven hex digits. */
export const namesCommit = (text, sha) => [...text.matchAll(HEX)].some(([word]) => sha.startsWith(word));
/** The UTC date of a moment, as YYYY-MM-DD. */
export const day = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
/** known-failures.json as `JSON.stringify(…, null, 2)` writes it, with keys the base's file has. */
export const knownFile = (fields = {}) => `${JSON.stringify({ failures: {}, lint: {}, timing: [], skips: [], ...fields }, null, 2)}\n`;

const q = JSON.stringify;
const script = (path, content) => {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
};
// Left out of every process the sandbox starts: the proof lanes' and the throttle's own variables, a parent runner's,
// git's, gh's token (the stand-in needs none), cargo's jobserver and the agents' own.
const OUT = /^(?:DEEP_|GIT_|GH_|GITHUB_|CARGO_|CLAUDE|ANTHROPIC|OPENAI|CODEX_)|^(?:NODE_TEST_CONTEXT|NODE_OPTIONS|MAKEFLAGS|MFLAGS|RUSTC_WRAPPER|AI_AGENT)$/;

/**
 * A sandbox: its own HOME (so the throttle's table, ~/.deepbuild and git's config are its own), TMPDIR and git
 * identity, and the stand-ins first on PATH. `deep lease -- <command>` runs the command, as scripts/lease asks.
 */
export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2818-')));
  const home = join(dir, 'home'), bin = join(dir, 'bin'), gh = join(dir, 'gh'), temp = join(dir, 'tmp');
  for (const folder of [home, bin, gh, temp]) mkdirSync(folder);
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Fixture\n\temail = fixture@example.invalid\n[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n[core]\n\thooksPath = /dev/null\n');
  script(join(bin, 'gh'), `#!/bin/sh\nT2818_GH=${q(gh)} exec ${q(process.execPath)} ${q(join(HERE, 'gh.mjs'))} "$@"\n`);
  script(join(bin, 'cargo'), `#!/bin/sh\nexec ${q(process.execPath)} ${q(join(HERE, 'cargo.mjs'))} "$@"\n`);
  script(join(bin, 'deep'), '#!/bin/sh\nif [ "$1" = lease ] && [ "$2" = -- ]; then shift 2; exec "$@"; fi\necho "stand-in deep: no $*" >&2\nexit 1\n');
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !OUT.test(name)));
  Object.assign(env, { HOME: home, TMPDIR: temp, XDG_CACHE_HOME: join(home, '.cache'), XDG_CONFIG_HOME: join(home, '.config'), PATH: `${bin}${delimiter}${process.env.PATH}`, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', TZ: 'UTC' });
  const box = { dir, gh, env, children: [] };
  t.after(() => {
    for (const child of box.children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

/** Runs `argv` in the sandbox in a process group of its own, stopped by its PID after `ms`; resolves with its output. */
export function run(box, argv, { cwd = box.dir, env = {}, ms = 600_000 } = {}) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...box.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  // deadline: a program under test that never ends must still end the test.
  const stop = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, ms);
  return new Promise((resolve) => child.on('close', (status, signal) => {
    clearTimeout(stop);
    resolve({ status, signal, stdout, stderr });
  }));
}

const tail = (text, size) => (text.length > size ? `…${text.slice(-size)}` : text);
// affected.mjs's line listing every timed file of the repository says nothing of the fixture.
const brief = (text) => text.replace(/^(TIMED the timed list[^:]*):.*$/m, '$1: …');
/** What a person reads at a failed assertion. */
export const dump = (result) => `exit ${result.status}${result.signal ? ` (${result.signal})` : ''}\nstdout:\n${tail(brief(result.stdout), 8000)}\nstderr:\n${tail(result.stderr, 2500)}`;

const gitIn = (box, cwd) => (...args) => execFileSync('git', args, { cwd, env: box.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
export function write(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
}

/** The scripts the lint lane of a tree's scripts/lanes.mjs runs, read by a child, so nothing here imports it. */
function lintScripts(cwd) {
  const code = `const { checks } = await import(${q(pathToFileURL(join(cwd, 'scripts/lanes.mjs')).href)});
console.log(JSON.stringify(checks.find(({ name }) => name === 'lint').commands.map(([, script]) => script).filter((script) => /^scripts\\/[^/]+\\.mjs$/.test(script ?? ''))));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw Error(`BLOCKED: the lint lane of this checkout's scripts/lanes.mjs could not be read: ${result.stderr}`);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

const VITEST_CONFIG = "import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });\n";

/**
 * The fixture repository a record runs in (README: The fixture repository): main, pushed to a bare `origin`, holding
 * this checkout's scripts/ (the code under test), `known` as its known-failures.json, a vitest config, a folder of
 * links to this checkout's node_modules, and `files`. The lint lane's other scripts read this repository's own tree,
 * not a fixture's, so each is a stub; known-failures-check.mjs stays as it is. Returns its folder and main's head.
 */
export function mainRepo(box, files, known) {
  if (!existsSync(join(CHECKOUT, 'node_modules'))) throw Error('BLOCKED: this checkout has no node_modules; run npm ci --no-audit --no-fund');
  const cwd = join(box.dir, 'repo');
  mkdirSync(cwd);
  cpSync(join(CHECKOUT, 'scripts'), join(cwd, 'scripts'), { recursive: true });
  for (const path of lintScripts(cwd)) if (path !== CHECK) writeFileSync(join(cwd, path), '// A lint stub for #2818: the real one reads the repository, not this fixture.\n');
  // Links, so a tool's cache (vitest's .vite) lands here, never in this checkout's node_modules.
  mkdirSync(join(cwd, 'node_modules'));
  for (const entry of readdirSync(join(CHECKOUT, 'node_modules')).filter((name) => !name.startsWith('.vite'))) symlinkSync(join(CHECKOUT, 'node_modules', entry), join(cwd, 'node_modules', entry));
  write(cwd, { '.gitignore': 'node_modules\n', 'vitest.config.mjs': VITEST_CONFIG, [KNOWN]: known, ...files });
  const git = gitIn(box, cwd);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', "main: the repository #2818's record runs on");
  const origin = join(box.dir, 'origin.git');
  git('init', '-q', '--bare', '-b', 'main', origin);
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'main');
  return { cwd, head: git('rev-parse', 'HEAD') };
}

/** `node scripts/affected.mjs --record <paths>` in the fixture repository, on its main. */
export async function record(box, repo, paths) {
  const result = await run(box, [process.execPath, 'scripts/affected.mjs', '--record', ...paths], { cwd: repo.cwd, ms: 1_500_000 });
  // Stopped, or never given a test grant by the sandbox's own throttle table: the record judged nothing.
  const summary = result.stdout.split('\n').filter((line) => / affected: /.test(line)).at(-1) ?? '';
  if (result.signal || /no job started/.test(summary) || /^BLOCKED throttle\b/m.test(result.stdout)) throw Error(`BLOCKED: the record never ran its jobs, so nothing was judged\n${dump(result)}`);
  return result;
}

/** `node scripts/known-failures-check.mjs` in the fixture repository, with the stand-in gh. */
export const check = (box, repo) => run(box, [process.execPath, CHECK], { cwd: repo.cwd, ms: 300_000 });

/** An issue already on the stand-in's GitHub, from before the record. */
export function seedIssue(box, number, { state = 'OPEN', title = `Fixture issue ${number}`, body = 'An issue of an earlier record.' } = {}) {
  writeFileSync(join(box.gh, `issue-${number}.json`), `${JSON.stringify({ number, title, body, state, comments: [], labels: [] }, null, 2)}\n`);
}
/** Every issue on the stand-in's GitHub; those the stand-in created carry `created`. */
export const issues = (box) => readdirSync(box.gh).filter((name) => /^issue-\d+\.json$/.test(name)).map((name) => JSON.parse(readFileSync(join(box.gh, name), 'utf8'))).sort((a, b) => a.number - b.number);
export const filed = (box) => issues(box).filter(({ created }) => created);
export const shown = (list) => list.map(({ number, state, title, body }) => `#${number} ${state} ${title}\n${body}`).join('\n---\n') || '(none)';

let checkoutGit = null;
const resolved = new Map();
/** Whether `note` names, by seven or more hex digits, a commit of this checkout's history at or before HEAD. */
export function namesMainCommit(note) {
  const git = (args) => spawnSync('git', args, { cwd: CHECKOUT, encoding: 'utf8' });
  checkoutGit ??= git(['rev-parse', '--verify', '--quiet', 'HEAD']).status === 0;
  if (!checkoutGit) throw Error(`BLOCKED: ${CHECKOUT} holds no git history to read the heads its ${KNOWN} names`);
  return [...note.matchAll(HEX)].some(([word]) => {
    if (!resolved.has(word)) {
      const sha = git(['rev-parse', '--verify', '--quiet', `${word}^{commit}`]).stdout.trim();
      resolved.set(word, Boolean(sha) && git(['merge-base', '--is-ancestor', sha, 'HEAD']).status === 0);
    }
    return resolved.get(word);
  });
}

const PLANTED = 9818;
/**
 * The guard's scene (README: The guard's scene): a repository whose main holds the proof lanes (a scripts/proof-guard.mjs),
 * `.deepbuild/approvers` listing the maintainer's security key, and `before` as its known-failures.json; on the branch
 * `refresh`, one commit that rewrites the file as `after(main)` and names the planted issue. approve() tags that commit
 * under deep/approved/ with `items`, signed by the maintainer; guard() runs this checkout's `node scripts/proof.mjs guard`
 * there.
 */
export function guardScene(box, before, after) {
  const cwd = join(box.dir, 'guarded');
  mkdirSync(cwd);
  const git = gitIn(box, cwd);
  const keys = people();
  git('init', '-q', '-b', 'main');
  write(cwd, { 'scripts/proof-guard.mjs': '// The proof lanes are on main.\n', [APPROVERS]: keys.list, [KNOWN]: before });
  git('add', '-A');
  git('commit', '-qm', 'main');
  const main = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '-b', 'refresh');
  write(cwd, { [KNOWN]: after(main) });
  git('add', '-A');
  git('commit', '-qm', `Record main's failures at ${main.slice(0, 10)}\n\nPart of #${PLANTED}`);
  const commit = git('rev-parse', 'HEAD');
  const planted = join(box.dir, 'issues');
  write(planted, { [`${PLANTED}.md`]: `Planted for #2818's guard scene.\n\n### Acceptance criteria\n- [ ] Nothing real\n` });
  return {
    main, commit,
    approve: (items) => tag(cwd, 'deep/approved/1', commit, items, keys.maintainer),
    guard: () => run(box, [process.execPath, join(CHECKOUT, 'scripts/proof.mjs'), 'guard'], { cwd, env: { DEEP_PROOF_ISSUES: planted } }),
  };
}

/** The guard's verdict lines; a run with none never judged the change, so it proves nothing either way. */
export function verdicts(result) {
  const lines = result.stdout.split('\n').filter((line) => /^(?:PASS|FAIL) guard:/.test(line));
  if (!lines.length) throw Error(`BLOCKED: the proof guard reached no verdict, so nothing was judged\n${dump(result)}`);
  return lines;
}
