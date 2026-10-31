// Shared by the #821 acceptance tests. The lanes are reached only through `scripts/lanes.mjs`'s exported
// `checks` and `runLanes`, run in a child `node --input-type=module -e` process whose cwd is a scratch git
// repository; the lane scripts only through their module's `inputs` export (README: Surfaces).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const BASE = 'ff81b0d27e805eb509adb640f4aabe73458b4633'; // origin/main when these tests were drafted
export const lanesUrl = pathToFileURL(join(root, 'scripts/lanes.mjs')).href;
export const scriptUrl = (path) => pathToFileURL(join(root, path)).href;

// No user or system git config reaches a fixture or a lane's git: a global excludes file could hide a new
// .claude/ or AGENTS.md file, and a hook or signing setting could break a commit.
const GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'init.defaultBranch=main'];
export const git = (cwd, ...args) => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...GIT_ENV } });

/** The child's environment: the local preflight (no DEEP_PREFLIGHT), and git that can't climb above the scratch folder. */
function childEnv(cwd) {
  const env = { ...process.env, ...GIT_ENV, GIT_CEILING_DIRECTORIES: dirname(cwd) };
  delete env.DEEP_PREFLIGHT;
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') && !(key in GIT_ENV) && key !== 'GIT_CEILING_DIRECTORIES') delete env[key];
  return env;
}

export function scratch(t, prefix = 'deep-lanes-821-') {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** Writes each file; a null content removes it. */
export function write(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) rmSync(join(cwd, path), { force: true });
    else {
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), content);
    }
  }
}

/**
 * The base every scratch repository starts from: one file for each kind of path the two lanes' scripts read,
 * and one (docs/notes.md) that neither reads. Each is tracked, so a change to it is a tracked diff.
 */
export const BASE_FILES = {
  'README.md': '# Fixture\n',
  'docs/notes.md': 'Notes.\n',
  'AGENTS.md': '# Root rules\n',
  'CLAUDE.md': '@AGENTS.md\n',
  'packages/cli/CLAUDE.md': '# CLI rules\n',
  'skills/x/SKILL.md': '---\nname: x\n---\n',
  '.claude/settings.json': '{}\n',
  '.codex/config.toml': '# fixture\n',
  'lean-toolchain': 'leanprover/lean4:v4.35.0\n',
  'scripts/verdict-proofs.mjs': '// fixture stand-in; never run\n',
  'packages/verdicts/src/x.ts': 'export const x = 1;\n',
  'packages/verdicts/model/X.lean': '-- fixture\n',
};

/**
 * A scratch repository holding `files`, committed, with refs/remotes/origin/main at that commit unless
 * `origin` is false, and HEAD on a branch of its own.
 */
export function repo(t, { files = BASE_FILES, origin = true } = {}) {
  const cwd = scratch(t);
  git(cwd, 'init', '-q');
  write(cwd, files);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'base');
  if (origin) git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(cwd, 'checkout', '-q', '-b', 'change');
  return cwd;
}

export function commit(cwd, message = 'change') {
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', message);
}

function run(cwd, code, arg) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code, JSON.stringify(arg)], { cwd, encoding: 'utf8', env: childEnv(cwd), timeout: 60_000 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return { status: r.status, out, lines: out.split('\n') };
}

export const stubLine = (name) => `STUB RAN ${name}`;

// The real lanes, looked up by name in `checks`, each with its commands replaced by one that only prints
// that it ran. Every other field (name, paths, fix) is the lane's own.
const REAL = `
import { checks, runLanes } from ${JSON.stringify(lanesUrl)};
const names = JSON.parse(process.argv[1]);
const lanes = names.map((name) => {
  const lane = checks.find((l) => l.name === name);
  if (!lane) throw new Error('checks has no lane named ' + name);
  return { ...lane, commands: [[process.execPath, '-e', 'console.log(' + JSON.stringify('STUB RAN ' + name) + ')']] };
});
process.exitCode = await runLanes(lanes, { cwd: process.cwd() });
`;
/** Runs the real lanes `names` through runLanes in cwd, as the local preflight does. */
export const runReal = (cwd, names) => run(cwd, REAL, names);

// Planted lanes, as given (JSON), through the real runLanes.
const PLANTED = `
import { runLanes } from ${JSON.stringify(lanesUrl)};
const lanes = JSON.parse(process.argv[1]).map((lane) => ({ ...lane, commands: lane.commands.map(([command, ...args]) => [command === 'node' ? process.execPath : command, ...args]) }));
process.exitCode = await runLanes(lanes, { cwd: process.cwd() });
`;
export const runPlanted = (cwd, lanes) => run(cwd, PLANTED, lanes);

// A lane script's input predicate: its module's \`inputs\` export, called on each probe.
const INPUTS = `
const [url, probes] = JSON.parse(process.argv[1]);
let result;
try {
  const m = await import(url);
  result = typeof m.inputs === 'function' ? { inputs: Object.fromEntries(probes.map((f) => [f, m.inputs(f) === true])) } : { error: 'the module exports no inputs function (exports: ' + Object.keys(m).join(', ') + ')' };
} catch (error) {
  result = { error: 'import failed: ' + error.message };
}
console.log('INPUTS ' + JSON.stringify(result));
process.exitCode = 0;
`;
/** What the script at `path` (relative to this checkout) says it reads, for each probe; or { error }. */
export function scriptInputs(t, path, probes) {
  const cwd = scratch(t, 'deep-lanes-821-inputs-');
  const r = run(cwd, INPUTS, [scriptUrl(path), probes]);
  const line = r.lines.find((l) => l.startsWith('INPUTS '));
  assert.ok(line, `importing ${path} printed no INPUTS line:\n${r.out}`);
  return JSON.parse(line.slice('INPUTS '.length));
}

// Every lane in `checks` with paths, and the script it runs: the first `scripts/<name>.mjs` argument in its commands.
const PATH_LANES = `
import { checks } from ${JSON.stringify(lanesUrl)};
const script = (lane) => lane.commands.flat().find((a) => typeof a === 'string' && /^scripts\\/[^/]+\\.mjs$/.test(a)) ?? null;
console.log('LANES ' + JSON.stringify(checks.filter((l) => l.paths).map((l) => ({ name: l.name, script: script(l) }))));
`;
export function pathLanes(t) {
  const cwd = scratch(t, 'deep-lanes-821-list-');
  const r = run(cwd, PATH_LANES, null);
  const line = r.lines.find((l) => l.startsWith('LANES '));
  assert.ok(line, `listing checks printed no LANES line:\n${r.out}`);
  return JSON.parse(line.slice('LANES '.length));
}

/**
 * What runLanes did with the lane `name`: 'RUN' or 'SKIP', from its `RUN <name>` / `SKIP <name>: …` line.
 * Fails when it printed neither or both. A RUN must also show the stub's line; a SKIP must not.
 */
export function stateOf(result, name, { stub = true } = {}) {
  const ran = result.lines.some((l) => l === `RUN ${name}` || l.startsWith(`RUN ${name} `));
  const skipped = result.lines.some((l) => l.startsWith(`SKIP ${name}:`) || l === `SKIP ${name}`);
  assert.ok(ran || skipped, `runLanes printed neither RUN ${name} nor SKIP ${name}:\n${result.out}`);
  assert.ok(!(ran && skipped), `runLanes printed both RUN ${name} and SKIP ${name}:\n${result.out}`);
  if (stub) assert.equal(result.lines.includes(stubLine(name)), ran, `the lane's command ${ran ? 'did not run though RUN printed' : 'ran though SKIP printed'}:\n${result.out}`);
  return ran ? 'RUN' : 'SKIP';
}
