// #1880.f9683a09 No new comparison against an agent's name: `tests/agent-name-branches.test.mjs` passes with its list
// unchanged.
//
// Three tests: the named suite run as it is (`node --test`), its list (`tests/agent-name-branches.json`) equal to the
// base commit's, and the same scan the suite makes, widened from packages/hub/src to the packages this issue's change
// reaches (packages/reading/src and packages/runner/src beside the hub's), finding no comparison against an agent's name
// that the base commit didn't have. The third reads the criterion's own words, "no new comparison against an agent's
// name", over code the suite's list doesn't cover; README says why.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, BASE, REPO } from './helpers.ts';

const SUITE = 'tests/agent-name-branches.test.mjs';
const LIST = 'tests/agent-name-branches.json';
const SCANNED = ['packages/hub/src', 'packages/reading/src', 'packages/runner/src'];
// The suite's own pattern (tests/agent-name-branches.test.mjs), repeated here: that file runs its tests when imported.
const AGENTS = 'claude-code|claude|codex|pi|paseo|cursor|opencode|grok';
const BRANCH = new RegExp(`[\\w$.?!\\[\\]]+\\s*[!=]==?\\s*'(?:${AGENTS})'|'(?:${AGENTS})'\\s*[!=]==?\\s*[\\w$.?!\\[\\]]+`, 'g');

const sources = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return sources(path);
  return /\.(ts|mts|mjs|js)$/.test(name) && !/\.test\.[mc]?[jt]s$/.test(name) ? [path] : [];
});
/** Each comparison against an agent's name under `base`'s scanned folders, by file and expression, with its count. */
function comparisons(base: string): Map<string, number> {
  const found = new Map<string, number>();
  for (const dir of SCANNED) {
    let files: string[];
    try { files = sources(join(base, dir)); } catch { continue; }
    for (const file of files) {
      readFileSync(file, 'utf8').split('\n').forEach((line) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        for (const [expression] of line.matchAll(BRANCH)) {
          const key = `${relative(base, file)} ${expression.replace(/\s+/g, ' ')}`;
          found.set(key, (found.get(key) ?? 0) + 1);
        }
      });
    }
  }
  return found;
}
const git = (...args: string[]) => spawnSync('git', ['-C', REPO, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

describe(`${AC.noNameBranch} no new comparison against an agent's name`, () => {
  it(`${AC.noNameBranch} tests/agent-name-branches.test.mjs passes`, () => {
    const ran = spawnSync(process.execPath, ['--test', SUITE], { cwd: REPO, encoding: 'utf8', timeout: 300_000 });
    expect(ran.status, `node --test ${SUITE}:\n${ran.stdout}\n${ran.stderr}`).toBe(0);
  }, 320_000);

  it(`${AC.noNameBranch} tests/agent-name-branches.json is unchanged from the base commit`, () => {
    const was = git('show', `${BASE}:${LIST}`);
    expect(was.status, `git show ${BASE}:${LIST}: ${was.stderr}`).toBe(0);
    expect(JSON.parse(readFileSync(join(REPO, LIST), 'utf8')), `${LIST} against ${BASE}`).toEqual(JSON.parse(was.stdout));
  });

  it(`${AC.noNameBranch} the hub, reading and runner sources hold no comparison against an agent's name the base commit didn't`, () => {
    const copy = mkdtempSync(join(tmpdir(), 'dh1880-base-'));
    try {
      const archive = spawnSync('sh', ['-c', `git -C "$1" archive "$2" ${SCANNED.join(' ')} | tar -x -C "$3"`, 'sh', REPO, BASE, copy], { encoding: 'utf8' });
      expect(archive.status, `git archive ${BASE}: ${archive.stderr}`).toBe(0);
      const before = comparisons(copy);
      const now = comparisons(REPO);
      const added = [...now].filter(([key, n]) => n > (before.get(key) ?? 0)).map(([key, n]) => `${key} (${before.get(key) ?? 0} at the base, ${n} now)`);
      expect(added, 'comparisons against an agent\'s name added since the base').toEqual([]);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });
});
