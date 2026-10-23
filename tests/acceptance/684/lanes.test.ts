// #684 AC8: when the proof lane runs, and what it reports without its toolchain. The gating runs through
// scripts/lanes.mjs's `checks` and `runLanes` in scratch git repositories, with the lane's commands swapped for one
// that only prints a marker, so these tests see whether the lane ran without building the model. The toolchain test
// runs the real lane in a scratch copy of this checkout that has no toolchain folder. Nothing touches this
// checkout's repository, and every scratch folder is removed afterwards.
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as h from './helpers.ts';

afterAll(() => h.removeScratches());

const MARK = 'MARK the verdict proofs lane ran';
const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'init.defaultBranch=main'];
function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', [...GIT, ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in a scratch repository: ${r.stderr}`);
  return r.stdout;
}
function write(dir: string, path: string, text: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
}
/**
 * A scratch repository whose origin/main holds this checkout's scripts/ and a stand-in for the engine's source, the
 * model and two files that are neither, checked out on a branch `change` at origin/main.
 */
function repository(): string {
  const dir = h.scratchDir('gate');
  cpSync(join(h.ROOT, 'scripts'), join(dir, 'scripts'), { recursive: true });
  write(dir, `${h.ENGINE_SRC}/engine.ts`, readFileSync(join(h.ROOT, h.ENGINE_SRC, 'engine.ts'), 'utf8'));
  write(dir, `${h.MODEL}/Verdicts.lean`, 'namespace Verdicts\nend Verdicts\n');
  write(dir, 'packages/record/src/index.ts', 'export {};\n');
  write(dir, 'docs/notes.md', '# Notes\n');
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(dir, 'checkout', '-q', '-b', 'change');
  return dir;
}
/** Runs `runLanes` on the lane named "verdict proofs" from the repository's scripts/lanes.mjs, its commands swapped for the marker. */
function runLane(dir: string, release: boolean): h.Ran {
  const code = [
    `import { checks, runLanes } from './scripts/lanes.mjs';`,
    `const lane = checks.find((l) => l.name === ${JSON.stringify(h.LANE_NAME)});`,
    `if (!lane) { console.log('NO LANE: scripts/lanes.mjs has no lane named ${h.LANE_NAME}'); process.exit(3); }`,
    `process.exitCode = runLanes([{ ...lane, commands: [[process.execPath, '-e', ${JSON.stringify(`console.log(${JSON.stringify(MARK)})`)}]] }]);`,
  ].join('\n');
  const env = { ...process.env };
  delete env.DEEP_PREFLIGHT;
  if (release) env.DEEP_PREFLIGHT = 'release';
  return h.runNode(['--input-type=module', '-e', code], dir, env);
}
function expectRan(r: h.Ran, why: string): void {
  expect(r.stdout, `${why}: the lane runs\n${h.shown(r)}`).toContain(MARK);
  expect(r.lines.some((l) => l.startsWith(`PASS ${h.LANE_NAME} (`)), h.shown(r)).toBe(true);
  expect(r.status, h.shown(r)).toBe(0);
}
function expectSkipped(r: h.Ran, why: string): void {
  expect(r.status, `${why}\n${h.shown(r)}`).toBe(0);
  expect(r.stdout, `${why}: the lane doesn't run\n${h.shown(r)}`).not.toContain(MARK);
  expect(r.lines.some((l) => l.startsWith(`SKIP ${h.LANE_NAME}:`)), `${why}: a line "SKIP ${h.LANE_NAME}: …" says it didn't run\n${h.shown(r)}`).toBe(true);
  expect(r.lines.some((l) => l.startsWith(`PASS ${h.LANE_NAME}`)), `${why}: a skipped lane never reads as a pass\n${h.shown(r)}`).toBe(false);
}

describe('AC8 when the proof lane runs', () => {
  it('AC8 the local preflight doesn\'t run the lane for a change that touches neither the engine\'s source nor the model', () => {
    const dir = repository();
    write(dir, 'docs/notes.md', '# Notes\n\nCommitted.\n');
    write(dir, 'packages/record/src/index.ts', 'export const x = 1;\n');
    git(dir, 'commit', '-q', '-am', 'docs and record');
    appendFileSync(join(dir, 'docs/notes.md'), 'Uncommitted.\n');
    write(dir, 'docs/new.md', 'Untracked.\n');
    expectSkipped(runLane(dir, false), 'committed, uncommitted and untracked changes outside the engine and the model');
  });

  it('AC8 the local preflight runs the lane for a committed change to the engine\'s source', () => {
    const dir = repository();
    appendFileSync(join(dir, h.ENGINE_SRC, 'engine.ts'), '\n// changed\n');
    git(dir, 'commit', '-q', '-am', 'engine');
    expectRan(runLane(dir, false), `a committed change to ${h.ENGINE_SRC}/engine.ts`);
  });

  it('AC8 the local preflight runs the lane for an uncommitted change to the model, and for a new file in it', () => {
    const edited = repository();
    appendFileSync(join(edited, h.MODEL, 'Verdicts.lean'), '-- changed\n');
    expectRan(runLane(edited, false), `an uncommitted change to ${h.MODEL}/Verdicts.lean`);
    const added = repository();
    write(added, `${h.MODEL}/Extra.lean`, '-- new\n');
    expectRan(runLane(added, false), `a new untracked ${h.MODEL}/Extra.lean`);
  });

  it('AC8 the release preflight runs the lane every time, even with no change at all, and npm run release:check is that preflight', () => {
    const clean = repository();
    expectRan(runLane(clean, true), 'the release preflight on a checkout with no change');
    expectSkipped(runLane(clean, false), 'the local preflight on the same checkout');
    const docs = repository();
    write(docs, 'docs/notes.md', '# Notes\n\nChanged.\n');
    expectRan(runLane(docs, true), 'the release preflight on a docs-only change');
    const scripts = (JSON.parse(readFileSync(join(h.ROOT, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {};
    expect(scripts['release:check'] ?? '', 'release:check runs scripts/preflight with DEEP_PREFLIGHT=release').toMatch(/^DEEP_PREFLIGHT=release scripts\/preflight\b/);
  });
});

describe('AC8 without the pinned toolchain', () => {
  it('AC8 the lane reports BLOCKED, naming the toolchain and its version, never a pass', () => {
    const pinFile = join(h.ROOT, 'lean-toolchain');
    expect(existsSync(pinFile), 'lean-toolchain pins the toolchain').toBe(true);
    const pin = readFileSync(pinFile, 'utf8').split('\n')[0]!.trim();
    expect(pin, 'the pin names a released core Lean version').toMatch(/^leanprover\/lean4:v\d+\.\d+\.\d+$/);
    expect(spawnSync('git', ['check-ignore', '-q', `${h.TOOLCHAIN_DIR}/toolchains`], { cwd: h.ROOT }).status, `${h.TOOLCHAIN_DIR}/ is gitignored`).toBe(0);

    // A machine without it: a copy with no toolchain folder, no Lean on PATH, and a home of its own.
    const dir = h.scratchCopy('no-toolchain', { toolchain: false });
    const home = join(dir, '.home');
    mkdirSync(home);
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, DEEP_PREFLIGHT: 'release' };
    for (const key of ['ELAN_HOME', 'ELAN_TOOLCHAIN', 'LEAN_PATH', 'LEAN_SYSROOT', 'LAKE_HOME', 'LAKE']) delete env[key];

    const direct = h.runNode([h.LANE_SCRIPT], dir, env);
    expect(direct.status, h.shown(direct)).not.toBe(0);
    const blocked = h.toolchainBlocked(direct);
    expect(blocked, `a line "BLOCKED toolchain: …"\n${h.shown(direct)}`).not.toBeNull();
    expect(blocked, 'it names the toolchain and its version').toContain(pin);
    expect(direct.lines.filter((l) => /^PASS\b/.test(l) || /^AXIOMS\b/.test(l)), 'nothing reads as passed or proved').toEqual([]);

    const code = [
      `import { checks, runLanes } from './scripts/lanes.mjs';`,
      `const lane = checks.find((l) => l.name === ${JSON.stringify(h.LANE_NAME)});`,
      `if (!lane) { console.log('NO LANE: scripts/lanes.mjs has no lane named ${h.LANE_NAME}'); process.exit(3); }`,
      `process.exitCode = runLanes([lane]);`,
    ].join('\n');
    const viaLanes = h.runNode(['--input-type=module', '-e', code], dir, env);
    expect(viaLanes.status, h.shown(viaLanes)).toBe(1);
    const summary = viaLanes.lines.find((l) => l.startsWith(`BLOCKED ${h.LANE_NAME}: `));
    expect(summary, `the lane summary reads "BLOCKED ${h.LANE_NAME}: …"\n${h.shown(viaLanes)}`).toBeDefined();
    expect(summary).toContain(pin);
    expect(viaLanes.lines.some((l) => l.startsWith(`PASS ${h.LANE_NAME}`)), 'never a pass').toBe(false);
  });
});
