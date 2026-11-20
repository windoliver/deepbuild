// AC2 #2227.5d05bdca: `npm run build --workspaces` reaches `packages/hub/native/build.mjs`.
//
// The hub's build is `tsc -p tsconfig.json && node native/build.mjs`, so native/build.mjs (deep-confirm) runs only once
// the hub's type-check exits 0. The criterion's command runs in a copy of this checkout, never in the checkout itself:
// it rewrites every package's dist/, which other suites run while it writes. The copy holds the files git lists here
// (tracked, and untracked ones it doesn't ignore), cloned where the disk can, and a node_modules whose entries link to
// this checkout's, the workspace packages' own links made anew so they reach the copy's packages, as the proof lanes lay
// out their copies. In the copy, packages/hub/native/build.mjs is a probe that records each time it runs, and from which
// folder, and builds nothing; everything else, the hub's build script included, is this checkout's. The build reaches
// the file when the probe ran from packages/hub. The build's exit status is not the criterion's and isn't asserted.
// At the base the hub's type-check exits 2, so the probe never runs (BASE-FAILURE.txt).
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MINUTES, REPO, errorLines, git, inconclusive, run } from './helpers.ts';

const NATIVE = 'packages/hub/native/build.mjs';
const PROBE = [
  "// #2227 AC2's probe, in the test's copy only: it records that the build ran it, and from where, and builds nothing.",
  "import { appendFileSync } from 'node:fs';",
  "appendFileSync(new URL('./reached.jsonl', import.meta.url), JSON.stringify({ cwd: process.cwd() }) + '\\n');",
  '',
].join('\n');

/**
 * The copy's node_modules: each entry links to this checkout's, but a link of its own that is relative, as a workspace
 * package's is (`@deepbuild/hub` to `../../packages/hub`), is made anew so it reaches the copy's package, and a tool's
 * cache folder is the copy's own and empty.
 */
function linkModules(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const source = join(from, name), target = join(to, name);
    const stat = lstatSync(source);
    if (stat.isSymbolicLink() && !isAbsolute(readlinkSync(source))) symlinkSync(readlinkSync(source), target);
    else if (stat.isDirectory() && name.startsWith('@')) linkModules(source, target);
    else if (stat.isDirectory() && name.startsWith('.') && name !== '.bin') mkdirSync(target);
    else symlinkSync(source, target);
  }
}

/** This checkout's files at `to`: what git lists, tracked or untracked and not ignored, less what the worktree deleted. */
function copyCheckout(to: string): number {
  const made = new Set<string>();
  let copied = 0;
  for (const path of new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean))) {
    const source = join(REPO, path), target = join(to, path);
    let stat;
    try { stat = lstatSync(source); } catch { continue; }
    if (stat.isDirectory()) continue;
    if (!made.has(dirname(target))) { mkdirSync(dirname(target), { recursive: true }); made.add(dirname(target)); }
    if (stat.isSymbolicLink()) symlinkSync(readlinkSync(source), target);
    else copyFileSync(source, target, constants.COPYFILE_FICLONE);
    copied++;
  }
  linkModules(join(REPO, 'node_modules'), join(to, 'node_modules'));
  return copied;
}

describe("#2227 the workspace build reaches the hub's native step", () => {
  it('AC2 #2227.5d05bdca npm run build --workspaces reaches packages/hub/native/build.mjs', async () => {
    if (!existsSync(join(REPO, 'node_modules'))) inconclusive('this checkout has no node_modules (npm ci)');
    expect(existsSync(join(REPO, NATIVE)), `this checkout holds ${NATIVE}, the file the build must reach`).toBe(true);
    const copy = realpathSync(mkdtempSync(join(tmpdir(), 'dh2227-')));
    try {
      const copying = performance.now();
      const copied = copyCheckout(copy);
      const copyS = Math.round((performance.now() - copying) / 1000);
      // A new file in place of the copied one, so nothing is written through a link or a clone's source.
      rmSync(join(copy, NATIVE), { force: true });
      writeFileSync(join(copy, NATIVE), PROBE);
      const built = await run('npm', ['run', 'build', '--workspaces'], copy, 45 * MINUTES);
      const marks = join(copy, dirname(NATIVE), 'reached.jsonl');
      const from = existsSync(marks) ? readFileSync(marks, 'utf8').split('\n').filter(Boolean).map((line) => relative(copy, (JSON.parse(line) as { cwd: string }).cwd) || '.') : [];
      const said = `npm run build --workspaces in a copy of ${copied} files (copied in ${copyS} s) exited ${built.code ?? built.signal} after ${Math.round(built.ms / 1000)} s; its errors:\n${errorLines(built.out)}`;
      expect(from, `the folders ${NATIVE} ran from in the copy's build (none: never reached). ${said}`).toContain('packages/hub');
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  }, 50 * MINUTES);
});
