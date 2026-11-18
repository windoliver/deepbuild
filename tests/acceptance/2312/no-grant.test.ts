// AC3: an interpreter path under the user's home folder or the package folder itself still receives no install grant.
//
// The issue's Scope says how the new rule keeps this: the `Versions/<v>` directory is taken as the interpreter's
// install root, "still refusing any path holding homedir() or the package folder". So each test builds a
// framework-shaped tree whose `Versions/<v>` is such a path (your home itself; a folder holding the host's home,
// where every run's package folder is), names its Python.app program on a `main`'s `#!` line with python3 on the
// hub's PATH pointing at it, and reads what the host asks the supervisor to let the run read: nothing that holds
// your home, nothing that holds the package folder. Each test first shows the same tree gets an install grant where
// it holds neither, so the fixture reaches the rule and a host asked for nothing proves nothing.
//
// These guard behavior the base has (README: Result on the base, and the wrong program they fail on).
import { mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { frameworkTree, holds, jsonRpcPackage, needsMac, openHost, openWorld, pathDirFor, withEnv, type AskedStart, type FrameworkPython } from './helpers.ts';

const AC3 = '#2312.06d4f1d2';

/** Installs and checks a package whose main names the tree's program, and returns the starts the host asked for. */
async function startsOf(tree: FrameworkPython, deepHome?: string): Promise<AskedStart[]> {
  const { dir } = await jsonRpcPackage(tree.binary);
  const { h, starts } = await openHost(await openWorld(deepHome));
  const p = await h.install({ from: dir, builtBy: null });
  // The stand-in program registers nothing, so conformance fails; its start is what the test reads.
  await h.check(p);
  expect(starts.length, 'conformance asks the supervisor to start the package\'s main').toBeGreaterThan(0);
  return starts;
}
/** The same shape of tree, holding neither your home nor the package, gets an install grant: the fixture reaches the rule. */
async function reachesTheRule(): Promise<void> {
  const tree = frameworkTree();
  await withEnv({ PATH: `${pathDirFor(tree.binary)}:/usr/bin:/bin` }, async () => {
    for (const start of await startsOf(tree)) {
      expect(start.read.filter((path) => holds(path, tree.binary)), `a tree holding neither your home nor the package gets an install grant: ${JSON.stringify(start.read)}`).not.toEqual([]);
    }
  });
}

describe(`AC3 ${AC3} an interpreter path under the user's home folder or the package folder itself still receives no install grant`, () => {
  it('AC3 an interpreter under your home, whose Versions/<v> is your home, gets no grant holding your home', async () => {
    needsMac();
    await reachesTheRule();
    const tree = frameworkTree();
    await withEnv({ PATH: `${pathDirFor(tree.binary)}:/usr/bin:/bin`, HOME: tree.root }, async () => {
      const yours = realpathSync(homedir());
      expect(yours, 'your home is the tree\'s Versions/<v>, so the interpreter is under your home').toBe(tree.root);
      for (const start of await startsOf(tree)) {
        expect(start.read.filter((path) => holds(path, yours)), `nothing the run is let read holds your home ${yours}`).toEqual([]);
      }
    });
  }, 240_000);

  it('AC3 an interpreter whose Versions/<v> holds the package folder gets no grant holding the package folder', async () => {
    needsMac();
    await reachesTheRule();
    const tree = frameworkTree();
    const deepHome = join(tree.root, 'deepbuild');
    mkdirSync(deepHome);
    await withEnv({ PATH: `${pathDirFor(tree.binary)}:/usr/bin:/bin` }, async () => {
      for (const start of await startsOf(tree, deepHome)) {
        expect(holds(tree.root, start.folder), `the run's package folder ${start.folder} is inside the tree's Versions/<v>`).toBe(true);
        expect(start.read.filter((path) => holds(path, start.folder)), `nothing the run is let read holds its package folder ${start.folder}`).toEqual([]);
      }
    });
  }, 240_000);
});
