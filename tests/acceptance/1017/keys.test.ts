// #1017 AC3, Exact keys only: a worktree whose `package-lock.json` matches no kept key gets no `node_modules` and
// installs as it does today. A planted store that clones the nearest key places a package version the lockfile
// doesn't name, and fails, naming the package.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC3, branchWith, contextOf, doneYaml, keptEntries, makeRepo, mustFail, NODE_MODULES, npmFiles, waitBuilt, World, worktree } from './helpers.ts';

/** Each package `node_modules` holds at a version the lockfile doesn't name there (or doesn't name at all). */
function unnamed(wt: string): string[] {
  const lock = JSON.parse(readFileSync(join(wt, 'package-lock.json'), 'utf8')) as { packages: Record<string, { version?: string; link?: boolean }> };
  const out: string[] = [];
  const read = (at: string): string | undefined => { try { return (JSON.parse(readFileSync(join(wt, at, 'package.json'), 'utf8')) as { version?: string }).version; } catch { return undefined; } };
  const installed = Object.keys(JSON.parse(readFileSync(join(wt, 'node_modules', '.package-lock.json'), 'utf8')).packages ?? {}) as string[];
  for (const at of new Set([...installed, 'node_modules/dh-pad'])) {
    if (!existsSync(join(wt, at))) continue;
    const named = lock.packages[at];
    if (named?.link) continue;
    const version = read(at);
    if (!named || named.version !== version) out.push(`${at.replace(/^node_modules\//, '')}@${version} (the lockfile names ${named?.version ?? 'no such package'})`);
  }
  return out;
}

async function scenario(plant?: string): Promise<void> {
  const w = new World({ plant });
  try {
    await w.startHub();
    const files = { ...npmFiles(w, '1.0.0'), '.gitignore': 'node_modules/\n', '.deepbuild/done.yaml': doneYaml([NODE_MODULES]) };
    const repo = makeRepo(w, 'shop', files);
    w.trust(repo);
    const s0 = w.session(repo);
    await s0.start();
    await s0.prompt('Run the tests.');
    await waitBuilt(w, [NODE_MODULES]);
    console.log(`AC3 the store's node_modules entries: ${keptEntries(w, 'node_modules').join(', ')}`);

    // A branch that moves dh-pad to 1.1.0: its lockfile matches no kept key.
    const bumped = npmFiles(w, '1.1.0');
    branchWith(w, repo, 'pad-2', { 'package.json': bumped['package.json']!, 'package-lock.json': bumped['package-lock.json']!, 'lib.test.js': bumped['lib.test.js']!, 'vendor/dh-pad-1.1.0.tgz': bumped['vendor/dh-pad-1.1.0.tgz']! }, 'dh-pad 1.1.0');
    const wt = join(w.dir, 'wt-pad');
    w.trust(wt);
    worktree(w, repo, 'wt-pad', { branch: 'pad-2' });
    const s = w.session(wt);
    const started = await s.start();
    const placed = existsSync(join(wt, 'node_modules'));
    console.log(`AC3 the worktree whose lockfile names dh-pad 1.1.0: node_modules ${placed ? 'placed' : 'not placed'}; its session start said ${JSON.stringify(contextOf(started).slice(0, 600))}`);
    if (placed) {
      const wrong = existsSync(join(wt, 'node_modules', '.package-lock.json')) ? unnamed(wt) : ['node_modules (with no .package-lock.json to read)'];
      expect(wrong, `a worktree whose package-lock.json matches no kept key got node_modules holding a package version its lockfile doesn't name: ${wrong.join(', ')}`).toEqual([]);
    }
    expect(placed, 'a worktree whose package-lock.json matches no kept key gets no node_modules').toBe(false);

    await s.prompt('Install and run the tests.');
    const ci = w.run('npm', ['ci'], wt, 600_000);
    expect(ci.code, `the worktree installs as it does today: \`npm ci\` must succeed: ${ci.out.slice(-1500)}`).toBe(0);
    const test = w.run('npm', ['test'], wt, 600_000);
    expect(test.code, `\`npm test\` passes once installed, with dh-pad 1.1.0: ${test.out.slice(-1500)}`).toBe(0);
  } finally {
    await w.close();
  }
}

describe(`${AC3} exact keys only`, () => {
  it(`${AC3} a worktree whose package-lock.json matches no kept key gets no node_modules and installs as it does today`, async () => {
    await scenario();
  }, 3_600_000);

  it(`${AC3} a planted store that clones the nearest key places a version the lockfile doesn't name, and fails naming the package`, async () => {
    await mustFail('AC3 nearest-key', () => scenario('nearest-key'), ['dh-pad@1.0.0']);
  }, 3_600_000);
});
