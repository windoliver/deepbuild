// Helpers for #605's acceptance tests: a scratch copy of the checkout, a fake `gh` on PATH, and one run
// of the catalogue drift lane through scripts/lanes.mjs, as scripts/checks.mjs runs its lanes.
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const BASE = 'f346706';
// The lane is the one entry of `checks` whose name says what it checks (README: The surface).
export const LANE = /catalogue|drift/i;

/**
 * A sandbox under the OS temp folder, removed after the test: `repo/` is a copy of this checkout's working
 * tree (tracked and untracked files git doesn't ignore, plus each package's built dist/), with a fresh
 * `git init` and the checkout's origin URL as its remote, and node_modules linked to the checkout's.
 */
export function makeFixture(t) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'deep-605-')));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  const repo = join(sandbox, 'repo');
  const listed = git(['ls-files', '-z', '-co', '--exclude-standard']).split('\0').filter(Boolean);
  for (const pkg of readdirSync(join(CHECKOUT, 'packages'))) {
    const dist = join('packages', pkg, 'dist');
    if (existsSync(join(CHECKOUT, dist))) listed.push(...walk(dist));
  }
  for (const file of listed) {
    const from = join(CHECKOUT, file);
    if (!existsSync(from) || !statSync(from).isFile()) continue;
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    copyFileSync(from, join(repo, file), constants.COPYFILE_FICLONE);
  }
  symlinkSync(join(CHECKOUT, 'node_modules'), join(repo, 'node_modules'));
  const origin = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: CHECKOUT, encoding: 'utf8' }).stdout.trim();
  spawnSync('git', ['init', '-q'], { cwd: repo });
  if (origin) spawnSync('git', ['remote', 'add', 'origin', origin], { cwd: repo });
  for (const dir of ['home', 'tmp', 'cache', 'config', 'bin']) mkdirSync(join(sandbox, dir));
  return { sandbox, repo };
}

const walk = (dir) => readdirSync(join(CHECKOUT, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

export const git = (args) => {
  const r = spawnSync('git', args, { cwd: CHECKOUT, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
};

/** Appends a line to one of the fixture's docs. */
export function plantDocLine(repo, doc, line) {
  appendFileSync(join(repo, doc), `\n${line}\n`);
}

/**
 * Open issues for the fake `gh`, newest first as gh lists them: 40 clean bodies numbered 9640 down to
 * 9601, which name only catalogued kinds and backticked names that aren't kinds. `planted` replaces the
 * body of #9605, the 36th, so a lane that keeps gh's default limit of 30 never sees it.
 */
export function openIssues(planted) {
  return Array.from({ length: 40 }, (_, i) => {
    const number = 9640 - i;
    const body = number === 9605 && planted ? planted : [
      `A clean planted issue body (#605's acceptance tests). It is not a real issue.`,
      '',
      '### Scope',
      `- The hub appends \`verdict.made\` once a check runs, and \`claim.made\` when the agent says it is done (${number}).`,
      '- It reads the event kinds `user.ask`, `tool.before` and `ask.created`.',
      '- Settings live in `rules.json`, and `hold_until_ms` stays a number.',
    ].join('\n');
    return { number, body };
  });
}

/**
 * Puts a fake `gh` first on PATH. Online it answers `gh issue list … --json <fields>` with `issues`, cut
 * to `--limit`/`-L` (30 when absent, as gh does), and `gh auth status`; offline every call but
 * `gh --version` fails as gh does when it can't reach GitHub. Each call's arguments are logged.
 */
export function fakeGh(sandbox, { offline = false, issues = [] } = {}) {
  const data = join(sandbox, 'gh-issues.json');
  writeFileSync(data, JSON.stringify(issues));
  const script = `#!${process.execPath}
const { appendFileSync, readFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(join(sandbox, 'gh.log'))}, JSON.stringify(args) + '\\n');
const value = (...names) => {
  for (let i = 0; i < args.length; i++) {
    for (const n of names) {
      if (args[i] === n) return args[i + 1];
      if (args[i].startsWith(n + '=')) return args[i].slice(n.length + 1);
    }
  }
};
if (args[0] === '--version') { console.log('gh version 2.99.0 (fake, #605 acceptance tests)'); process.exit(0); }
if (${offline}) {
  console.error('error connecting to api.github.com');
  console.error('check your internet connection or https://githubstatus.com');
  process.exit(1);
}
if (args[0] === 'auth' && args[1] === 'status') { console.log('github.com\\n  Logged in to github.com (fake)'); process.exit(0); }
if (args[0] === 'issue' && args[1] === 'list') {
  const fields = value('--json');
  if (!fields) { console.error('fake gh: this test answers gh issue list only with --json'); process.exit(1); }
  const limit = Number(value('--limit', '-L') ?? 30);
  const issues = JSON.parse(readFileSync(${JSON.stringify(data)}, 'utf8')).slice(0, limit);
  const keep = fields.split(',').map((f) => f.trim());
  console.log(JSON.stringify(issues.map((i) => Object.fromEntries(keep.filter((k) => k in i).map((k) => [k, i[k]])))));
  process.exit(0);
}
console.error('fake gh: unsupported command: gh ' + args.join(' '));
process.exit(1);
`;
  const gh = join(sandbox, 'bin', 'gh');
  writeFileSync(gh, script);
  chmodSync(gh, 0o755);
}

export const ghCalls = (sandbox) => (existsSync(join(sandbox, 'gh.log'))
  ? readFileSync(join(sandbox, 'gh.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

/** The sandboxed environment: HOME, TMPDIR and the XDG folders in the sandbox, no GitHub token, fake gh first. */
export function sandboxEnv(sandbox) {
  const env = { ...process.env };
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST', 'GH_REPO']) delete env[key];
  return {
    ...env,
    PATH: [join(sandbox, 'bin'), dirname(process.execPath), env.PATH].join(delimiter),
    HOME: join(sandbox, 'home'),
    TMPDIR: join(sandbox, 'tmp'),
    XDG_CACHE_HOME: join(sandbox, 'cache'),
    XDG_CONFIG_HOME: join(sandbox, 'config'),
    GH_CONFIG_DIR: join(sandbox, 'config', 'gh'),
  };
}

/**
 * Runs the catalogue drift lane alone, in a child process with cwd at `repo`: the fixture's own
 * scripts/lanes.mjs, the one entry of `checks` whose name matches LANE, and `runLanes([lane])`, the call
 * scripts/checks.mjs makes over every lane. Returns the lane's name, the exit status and the output.
 */
export function runLane(repo, env) {
  const program = `
const { checks, runLanes } = await import(${JSON.stringify(pathToFileURL(join(repo, 'scripts', 'lanes.mjs')).href)});
const lanes = checks.filter((lane) => ${LANE}.test(lane.name));
if (lanes.length !== 1) {
  console.log('NO LANE: scripts/lanes.mjs checks has ' + lanes.length + ' lanes matching ${LANE}, of ' + JSON.stringify(checks.map((l) => l.name)));
  process.exit(3);
}
console.log('LANE ' + lanes[0].name);
process.exitCode = runLanes(lanes);
`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: repo, env, encoding: 'utf8', timeout: 300_000, maxBuffer: 1 << 28 });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const name = output.match(/^LANE (.+)$/m)?.[1];
  return { status: r.status, signal: r.signal, output, name, lines: output.split('\n') };
}

/** Fails with the lane's output unless the run found exactly one drift lane. */
export function laneName(run) {
  if (!run.name) throw new Error(`no catalogue drift lane ran:\n${run.output}`);
  return run.name;
}

/** The lane's verdict lines: runLanes prints `PASS <name> (…)` or `<STATE> <name>: <reason>`. */
export const verdicts = (run, name) => run.lines.filter((l) => l.startsWith(`PASS ${name} (`) || new RegExp(`^[A-Z]+ ${escape(name)}:`).test(l));
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
