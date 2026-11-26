// The gate package's `simulate` as one commit of this checkout's history has it (#3539; README.md, "The package's
// order, to a test"). The spike's readings are of the scheduler at its record's `main`, so the tests run that commit's
// scheduler on the spike's kept scripts and never the working tree's: a later change to the order on main then leaves
// the kept readings as true as they were. The commit's `packages/` is exported from git into a temporary folder, as
// tests/acceptance/2365-redraft-ac5/base.ts exports a merge base: beside it the repo's installed node_modules, the
// workspace's own packages pointing at the export, and the build data its sources read before `tsc` (a package's own
// `node <script>` build steps), made in the export by the commit's own scripts. `simulate` is then loaded from the
// exported public entry, packages/gate/src/index.ts, through from-source.mjs. Nothing is built or written in the
// checkout, and the export is removed when the process ends. Anything missing is BLOCKED, never a pass.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const FROM_SOURCE = fileURLToPath(new URL('./from-source.mjs', import.meta.url));
// deadline: bounds each child this file starts (git, tar, a package's build step), so a hang ends as BLOCKED.
const DEADLINE_MS = 20 * 60_000;
const BIG = 2 ** 31 - 1;

/** Git in this checkout, with nothing from the caller's environment pointing it elsewhere. */
export function git(args, more = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  return spawnSync('git', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: BIG, timeout: DEADLINE_MS, ...more });
}

const made = [];
process.on('exit', () => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** A temporary folder of this process, removed when it ends. */
export function tempDir(name) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `deep-3539-${name}-`)));
  made.push(dir);
  return dir;
}

const blocked = (why) => Error(`BLOCKED: the package's scheduler at the record's main can't be run: ${why}`);

/** The build data a package's sources read: each `node <script>` step its build names before `tsc`, its dependencies' first. */
function buildData(packages, name, commit, done = new Set()) {
  const pkg = packages.get(name);
  if (!pkg || done.has(name)) return;
  done.add(name);
  for (const used of pkg.uses) buildData(packages, used, commit, done);
  const steps = pkg.build.split('&&').map((step) => step.trim());
  for (const step of steps.slice(0, Math.max(0, steps.findIndex((s) => /^tsc\b/.test(s))))) {
    const [cmd, ...args] = step.split(/\s+/);
    if (cmd !== 'node') throw blocked(`the build step \`${step}\` of ${name} at ${commit} isn't a node script, so its build data can't be made in the export`);
    const r = spawnSync(process.execPath, ['--no-warnings', '--import', FROM_SOURCE, ...args], { cwd: pkg.folder, encoding: 'utf8', timeout: DEADLINE_MS });
    if (r.status !== 0) throw blocked(`the build step \`${step}\` of ${name} at ${commit} failed: exit ${r.status} ${r.error?.message ?? ''}\n${String(r.stderr).slice(-2000)}`);
  }
}

/** The commit's `packages/`, exported into a temporary folder with what its sources need to load. */
function exportAt(commit) {
  const dir = tempDir('base');
  const tar = git(['archive', '--format=tar', commit, 'packages'], { encoding: 'buffer' });
  if (tar.status !== 0) throw blocked(`git archive of ${commit} failed: ${String(tar.stderr).trim() || tar.error?.message}`);
  const unpacked = spawnSync('tar', ['-x', '-C', dir], { input: tar.stdout, maxBuffer: BIG, timeout: DEADLINE_MS });
  if (unpacked.status !== 0) throw blocked(`unpacking ${commit} failed: ${String(unpacked.stderr).trim() || unpacked.error?.message}`);
  // Its node_modules: the repo's installed packages, except the workspace's own, which point at the export.
  const modules = join(dir, 'node_modules');
  if (!existsSync(join(REPO, 'node_modules'))) throw blocked('this checkout has no node_modules (npm ci)');
  mkdirSync(join(modules, '@deepbuild'), { recursive: true });
  for (const entry of readdirSync(join(REPO, 'node_modules'))) {
    if (entry === '@deepbuild' || entry === '.bin' || entry.startsWith('.package-lock')) continue;
    symlinkSync(join(REPO, 'node_modules', entry), join(modules, entry));
  }
  const packages = new Map();
  for (const pkg of readdirSync(join(dir, 'packages'))) {
    const manifest = join(dir, 'packages', pkg, 'package.json');
    if (!existsSync(manifest)) continue;
    const read = JSON.parse(readFileSync(manifest, 'utf8'));
    const name = String(read.name ?? '');
    packages.set(name, { folder: join(dir, 'packages', pkg), uses: Object.keys(read.dependencies ?? {}), build: String(read.scripts?.build ?? '') });
    if (name.startsWith('@deepbuild/')) symlinkSync(join(dir, 'packages', pkg), join(modules, name));
    const own = join(REPO, 'packages', pkg, 'node_modules');
    if (existsSync(own) && !existsSync(join(dir, 'packages', pkg, 'node_modules'))) symlinkSync(own, join(dir, 'packages', pkg, 'node_modules'));
  }
  if (!packages.has('@deepbuild/gate')) throw blocked(`${commit} has no @deepbuild/gate package`);
  buildData(packages, '@deepbuild/gate', commit);
  return dir;
}

const loaded = new Map();
/**
 * `simulate`, the export of the gate package's public entry, as `commit` has it. One export per commit and process.
 * Throws an Error whose message starts with BLOCKED when the commit can't be exported or its entry can't be loaded.
 */
export function simulateAt(commit) {
  if (!loaded.has(commit)) {
    loaded.set(commit, (async () => {
      await import('./from-source.mjs');
      const dir = exportAt(commit);
      let entry;
      try {
        entry = await import(pathToFileURL(join(dir, 'packages/gate/src/index.ts')).href);
      } catch (error) {
        throw blocked(`packages/gate/src/index.ts of ${commit} doesn't load: ${error?.message ?? error}`);
      }
      if (typeof entry.simulate !== 'function') throw blocked(`the gate package's public entry at ${commit} exports no simulate`);
      return entry.simulate;
    })());
  }
  return loaded.get(commit);
}
