// The merge base, as it stands: its sources exported from git (`git merge-base HEAD origin/main`, as #20's budgets
// find it) into a temp folder, and its own transcript archive run there, in a child process, on the transcripts a test
// leaves (base-copy.mjs). That gives "the one copy the merge base stores of the finished file" from the merge base's
// own code, its own scrub included, not from anything the change may have touched. It also gives the perf tasks'
// transcripts from the merge base's own benchmarks/archive.mjs. Anything missing (git, origin/main, the export, its
// build data, the child) fails the test as BLOCKED; nothing here ever passes for want of the merge base.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NODE, REPO, T0, tempDir, type Env } from '../20/helpers.ts';

const CHILD = fileURLToPath(new URL('./base-copy.mjs', import.meta.url));
/** How a child runs the merge base's `.ts` sources as they stand; base-resolve.mjs maps their `.js` imports. */
const FROM_SOURCE = ['--experimental-transform-types', '--conditions=development', '--no-warnings'];
const RESOLVE = new URL('./base-resolve.mjs', import.meta.url).href;
let tree: { dir: string; sha: string } | undefined;

interface Package { folder: string; uses: string[]; build: string }
/**
 * The merge base's build data, made in its export by its own scripts from its own files. Its sources read files
 * that its build writes before `tsc` (at ed03dc60: packages/evidence/dist/patterns.json from build-patterns.mjs,
 * packages/record/dist/versions.json from build-versions.mjs), and the export is not built. So for the package
 * `name` and the workspace packages it depends on, those first, each step its `build` script names before `tsc`
 * runs in its exported folder. A build that starts with `tsc`, or a package with none, runs nothing. A step that
 * is not `node <script>`, or that fails, is BLOCKED: its output is never taken from anywhere else.
 */
function buildData(packages: Map<string, Package>, name: string, sha: string, done = new Set<string>()): void {
  const pkg = packages.get(name);
  if (!pkg || done.has(name)) return;
  done.add(name);
  for (const used of pkg.uses) buildData(packages, used, sha, done);
  const steps = pkg.build.split('&&').map((step) => step.trim());
  for (const step of steps.slice(0, Math.max(0, steps.findIndex((s) => /^tsc\b/.test(s))))) {
    const [cmd, ...args] = step.split(/\s+/);
    if (cmd !== 'node') throw Error(`BLOCKED: the merge base's build step \`${step}\` (${name}, ${sha}) isn't a node script, so its build data can't be made in the export`);
    const r = spawnSync(NODE, [...FROM_SOURCE, '--import', RESOLVE, ...args], { cwd: pkg.folder, encoding: 'utf8', timeout: 300_000 });
    if (r.status !== 0) throw Error(`BLOCKED: the merge base's build step \`${step}\` (${name}, ${sha}) failed: exit ${r.status} ${r.error?.message ?? ''}\n${r.stderr}`);
  }
}

/** The merge base's sources, exported once per test file: packages/, adapters/ and benchmarks/archive.mjs. */
export function baseTree(): { dir: string; sha: string } {
  if (tree) return tree;
  const mb = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' });
  if (mb.status !== 0) throw Error(`BLOCKED: no merge base (git merge-base HEAD origin/main): ${mb.stderr || mb.error?.message}`);
  const sha = mb.stdout.trim();
  const dir = tempDir('base2365');
  const tar = spawnSync('git', ['archive', '--format=tar', sha, 'packages', 'adapters', 'benchmarks/archive.mjs'], { cwd: REPO, maxBuffer: 2 ** 31 - 1 });
  if (tar.status !== 0) throw Error(`BLOCKED: git archive of the merge base ${sha} failed: ${String(tar.stderr)}`);
  const x = spawnSync('tar', ['-x', '-C', dir], { input: tar.stdout, maxBuffer: 2 ** 31 - 1 });
  if (x.status !== 0) throw Error(`BLOCKED: unpacking the merge base ${sha} failed: ${String(x.stderr)}`);
  // Its node_modules: the repo's installed packages, except the workspace's own, which point at the merge base's.
  const modules = join(dir, 'node_modules');
  mkdirSync(join(modules, '@deepbuild'), { recursive: true });
  for (const entry of readdirSync(join(REPO, 'node_modules'))) {
    if (entry === '@deepbuild' || entry === '.bin' || entry.startsWith('.package-lock')) continue;
    symlinkSync(join(REPO, 'node_modules', entry), join(modules, entry));
  }
  const packages = new Map<string, Package>();
  for (const pkg of readdirSync(join(dir, 'packages'))) {
    const manifest = join(dir, 'packages', pkg, 'package.json');
    if (!existsSync(manifest)) continue;
    const read = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string; dependencies?: Record<string, string>; scripts?: { build?: string } };
    const name = String(read.name ?? '');
    packages.set(name, { folder: join(dir, 'packages', pkg), uses: Object.keys(read.dependencies ?? {}), build: String(read.scripts?.build ?? '') });
    if (name.startsWith('@deepbuild/')) symlinkSync(join(dir, 'packages', pkg), join(modules, name));
    const own = join(REPO, 'packages', pkg, 'node_modules');
    if (existsSync(own) && !existsSync(join(dir, 'packages', pkg, 'node_modules'))) symlinkSync(own, join(dir, 'packages', pkg, 'node_modules'));
  }
  buildData(packages, '@deepbuild/archive', sha);
  tree = { dir, sha };
  return tree;
}

/** What the merge base's archive left after one pass on fresh record and store: each copy it linked, by session, and whether its pass failed. */
export interface BaseRun { sha: string; error: string | null; copies: { session: string; bytes: Buffer }[] }

/** Runs the merge base's archive once over the homes in `env`, with the held values, in a record and store of its own. */
export function baseCopies(env: Env, held: readonly string[]): BaseRun {
  const { dir, sha } = baseTree();
  const work = tempDir('basecopy');
  const job = join(work, 'job.json');
  writeFileSync(job, JSON.stringify({ base: dir, root: join(work, 'root'), out: join(work, 'out'), env, held, now: T0 }));
  const r = spawnSync(NODE, [...FROM_SOURCE, CHILD, job], { cwd: dir, encoding: 'utf8', timeout: 1_800_000, maxBuffer: 64 * 2 ** 20 });
  const manifest = join(work, 'out', 'manifest.json');
  if (r.status !== 0 || !existsSync(manifest)) throw Error(`BLOCKED: the merge base's archive (${sha}) didn't run: exit ${r.status} ${r.error?.message ?? ''}\n${r.stderr}`);
  const m = JSON.parse(readFileSync(manifest, 'utf8')) as { error: string | null; copies: { session: string; file: string }[] };
  const run = { sha, error: m.error, copies: m.copies.map((c) => ({ session: c.session, bytes: readFileSync(c.file) })) };
  rmSync(work, { recursive: true, force: true });
  return run;
}

/** The perf tasks' transcript generator, `transcript(seed, size)`, as the merge base's benchmarks/archive.mjs has it. */
export function perfGenerator(): (seed: number, size: number) => { id: string; lines: string[] } {
  const src = readFileSync(join(baseTree().dir, 'benchmarks/archive.mjs'), 'utf8');
  const t0 = /^const T0 = [^;\n]+;$/m.exec(src)?.[0];
  const fn = /^function transcript\(seed, size\) \{\n[\s\S]*?\n\}$/m.exec(src)?.[0];
  if (!t0 || !fn) throw Error("BLOCKED: the merge base's benchmarks/archive.mjs has no `function transcript(seed, size)` and `const T0` to generate its perf tasks' transcripts");
  return new Function(`${t0}\n${fn}\nreturn transcript;`)() as (seed: number, size: number) => { id: string; lines: string[] };
}
