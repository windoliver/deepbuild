// AC9 (#139): the local preflight runs cargo-semver-checks on the canvas module crates and deep-hook, and compares the
// TypeScript extension API with its committed API report, so an interface change shows in the pull request that made it.
// A planted removal of a public function from deep-hook fails, naming the function; a planted change to a method's
// signature without an updated report fails, naming the method; a run that can't complete is BLOCKED, never PASS.
// The step is `scripts/api-surface.mjs [--root <repo>] [--write-report]` (README); its baseline for the crates is the
// commit at HEAD of the repo it is pointed at, its report `contracts/api-report/extension-api.api.md`.
// The planted changes are made in a scratch repo (a copy of this checkout's files, committed once as the baseline) under
// /tmp/dh139-*, never in this checkout.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_STEP, childEnv, edit, needStep, NODE, read, REPO, run, shown, tempDir, type Json, type Ran } from './helpers.ts';

const SKIP = new Set(['tests', 'docs', 'brand', 'benchmarks', 'spikes', 'skills', 'node_modules', 'target', '.git']);
let baseline: string | undefined;
/** A scratch repo holding this checkout's files (tracked, and new ones git doesn't ignore), committed as one baseline. */
function scratchRepo(): string {
  if (baseline) return baseline;
  const dir = tempDir('repo');
  const listed = run('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: REPO });
  for (const file of listed.stdout.split('\0').filter(Boolean)) {
    if (SKIP.has(file.split('/')[0]!) || !existsSync(join(REPO, file)) || !statSync(join(REPO, file)).isFile()) continue;
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    cpSync(join(REPO, file), join(dir, file));
  }
  const ignore = join(dir, '.gitignore');
  writeFileSync(ignore, `${existsSync(ignore) ? read(ignore) : ''}\nnode_modules\n.target\ntarget\n`);
  const git = (...args: string[]) => run('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: dir });
  git('init', '-q');
  git('add', '-A');
  const committed = git('commit', '-q', '-m', 'baseline');
  expect(committed.code, `the scratch repo's baseline commit\n${shown(committed)}`).toBe(0);
  baseline = dir;
  return dir;
}
/** A fresh copy of the baseline repo: its files and its one commit. */
function fresh(): string {
  const dir = tempDir('repo-copy');
  const r = run('git', ['clone', '-q', '--no-hardlinks', scratchRepo(), dir]);
  expect(r.code, `cloning the baseline\n${shown(r)}`).toBe(0);
  symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'));
  return dir;
}
const surface = (root: string, args: string[] = [], env: Record<string, string | undefined> = {}): Ran => {
  needStep(API_STEP);
  return run(NODE, [API_STEP, '--root', root, ...args], { env: childEnv({ CARGO_TARGET_DIR: join(root, '.target'), ...env }), timeoutMs: 1_500_000 });
};
/** A run that can't complete is BLOCKED: a test that needs the tool fails with BLOCKED and the reason, never passes. */
function mustComplete(r: Ran, what: string): void {
  if (r.code === 3 || /^BLOCKED api:/m.test(r.out)) throw Error(`BLOCKED: ${what} could not run: ${r.out.split('\n').find((l) => l.startsWith('BLOCKED')) ?? shown(r)}`);
}
const failures = (r: Ran): string[] => r.out.split('\n').filter((l) => l.startsWith('FAIL api:'));

/** The first public function of deep-hook, and the rewrite that makes every `pub fn` of deep-hook private to the crate. */
function plantRemoval(root: string): string[] {
  const dir = join(root, 'crates/deep-hook/src');
  const names: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.rs'))) {
    const text = readFileSync(join(dir, file), 'utf8');
    for (const m of text.matchAll(/^\s*pub fn (\w+)/gm)) names.push(m[1]!);
    writeFileSync(join(dir, file), text.replace(/^(\s*)pub fn /gm, '$1pub(crate) fn '));
  }
  return names;
}

describe('#139.f5cfafe3 the local preflight runs cargo-semver-checks on the canvas module crates and deep-hook, and compares the TypeScript extension API with its committed report', () => {
  it('AC9 the local preflight\'s lint or interfaces lane runs scripts/api-surface.mjs', async () => {
    const lanes = (await import(new URL('../../../scripts/lanes.mjs', import.meta.url).href)) as { checks: { name: string; commands: string[][] }[] };
    expect(lanes.checks.some((l) => l.commands.some((c) => c.some((a) => a.endsWith('api-surface.mjs')))), `a local lane runs api-surface.mjs: ${JSON.stringify(lanes.checks.map((l) => l.name))}`).toBe(true);
  });

  it('AC9 the unchanged repo passes: cargo-semver-checks over the canvas module crates and deep-hook, and the API report equal to the committed one', () => {
    const r = surface(fresh());
    mustComplete(r, 'the interface check on the unchanged repo');
    expect(r.code, shown(r)).toBe(0);
    expect(failures(r)).toEqual([]);
    expect(r.out, 'it names the crates it checked').toMatch(/deep-hook/);
    expect(r.out, 'and the canvas module crates').toMatch(/deep-canvas/);
    expect(/^PASS api/m.test(r.out), shown(r)).toBe(true);
  }, 1_800_000);

  it('AC9 a planted removal of a public function from deep-hook fails, naming the function', () => {
    const root = fresh();
    const names = plantRemoval(root);
    expect(names.length, 'deep-hook has a public function to remove').toBeGreaterThan(0);
    const r = surface(root);
    mustComplete(r, 'the interface check on the planted removal');
    expect(r.code, `the planted removal fails\n${shown(r)}`).toBe(1);
    expect(failures(r).some((l) => names.some((n) => l.includes(n)) && l.includes('deep-hook')), `a FAIL api line names the removed function and deep-hook (candidates ${names.join(', ')}): ${JSON.stringify(failures(r))}`).toBe(true);
  }, 1_800_000);

  it('AC9 a planted change to a method\'s signature without an updated report fails, naming the method; with the report written, it passes', () => {
    const root = fresh();
    edit({ root }, 'packages/contracts/extension-api.json', (api: Json[]) => {
      const e = api.find((x) => x.method === 'deep.registerCheck');
      e.params.properties.extra = { type: 'string' };
      e.params.required.push('extra');
    });
    // The typed declaration of the method, wherever the repo keeps it: its parameter list gains one parameter.
    for (const rel of ['packages/extension-host/runtime/deep.d.mts', 'packages/extension-host/src/deep.ts', 'packages/extension-host/src/api.ts']) {
      const file = join(root, rel);
      if (existsSync(file)) writeFileSync(file, read(file).replace(/registerCheck\(([^)]*)\)/, (_m, params: string) => `registerCheck(${params}${params.trim() ? ', ' : ''}extra: string)`));
    }
    const r = surface(root);
    mustComplete(r, 'the API report comparison on the planted signature change');
    expect(r.code, `the changed signature fails\n${shown(r)}`).toBe(1);
    expect(failures(r).some((l) => l.includes('registerCheck')), `a FAIL api line names the method: ${JSON.stringify(failures(r))}`).toBe(true);
    const written = surface(root, ['--write-report']);
    mustComplete(written, 'writing the API report');
    expect(written.code, shown(written)).toBe(0);
    const again = surface(root);
    mustComplete(again, 'the API report comparison after the report was written');
    expect(again.code, `with the report updated the change shows in the diff, not in a failure\n${shown(again)}`).toBe(0);
  }, 1_800_000);

  it('AC9 a run that can\'t complete is BLOCKED, never PASS: with cargo-semver-checks off the PATH the step exits 3 and prints BLOCKED api, naming the tool', () => {
    const root = fresh();
    const bare = `${dirname(NODE)}:/usr/bin:/bin`;
    const r = surface(root, [], { PATH: bare, CARGO_HOME: join(root, '.cargo-none') });
    expect(r.code, `exit 3, not 0 and not 1\n${shown(r)}`).toBe(3);
    expect(r.out, 'a BLOCKED api line').toMatch(/^BLOCKED api:/m);
    expect(r.out, 'it names the tool that is missing').toMatch(/semver-checks|cargo/);
    expect(/^PASS api/m.test(r.out), 'and prints no PASS').toBe(false);
  }, 600_000);
});
