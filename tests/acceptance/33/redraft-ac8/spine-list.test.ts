// #33 AC8, blind redraft, the offline part (README here): `node scripts/spine.mjs list` names each of the 25 spine
// tasks once, each with its merged commit. "Its merged commit" is the merge commit GitHub records (owner, 2026-11-19:
// "Keep GitHub's hash"), which since the 2026-11-09 history rewrite may be outside main's history while main carries a
// copy of it with the same tree. The live re-judge is spine.live.test.ts's, out of scope here.
//
// One judge, `problems`, decides a list. The real list must give none; each planted wrong list (a copy of the real
// output with one thing wrong) must give at least one, the one it was planted for; a legitimate reordering gives none.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { AC8, NODE, REPO, SPINE, must } from '../helpers.ts';

interface Listed { status: number | null; stdout: string }

// git as this checkout reads it, with no inherited GIT_DIR or the like.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const git = (args: string[]) => spawnSync('git', ['-C', REPO, ...args], { encoding: 'utf8', env: ENV, maxBuffer: 1 << 28 });
const out = (args: string[]): string => {
  const r = git(args);
  must(r.status === 0, `${AC8} BLOCKED: git ${args.join(' ')} failed: ${r.stderr.trim()}`);
  return r.stdout;
};

const ROW = /^#(\d+) ([0-9a-f]{40})$/;
// A commit's identity apart from its hash and parents: what the 2026-11-09 rewrite kept.
const FMT = '%T%x01%an%x01%ae%x01%at%x01%B';
let firstParentKeys: Set<string> | undefined;
/** The identities (tree, author, author time, message) of the commits on main's first-parent line: what main merged. */
function mainMerged(): Set<string> {
  if (!firstParentKeys) {
    const main = git(['rev-parse', '--verify', '-q', 'refs/remotes/origin/main']).stdout.trim();
    must(main !== '', `${AC8} BLOCKED: this checkout has no origin/main to read what main merged`);
    firstParentKeys = new Set(out(['log', '--first-parent', `--format=${FMT}%x00`, main]).split('\0').map((s) => s.replace(/^\n/, '')).filter(Boolean));
  }
  return firstParentKeys;
}

/** What's wrong with a `spine.mjs list` result; none means the list is right as far as an offline test can tell. */
function problems(listed: Listed): string[] {
  const found: string[] = [];
  if (listed.status !== 0) found.push(`the list exits ${listed.status}, not 0`);
  const seen = new Map<number, string[]>();
  listed.stdout.split('\n').forEach((line, i) => {
    if (line.trim() === '') return;
    const m = ROW.exec(line);
    if (!m) { found.push(`line ${i + 1} isn't "#<issue> <40-hex merged commit>": ${JSON.stringify(line)}`); return; }
    const n = Number(m[1]);
    seen.set(n, [...(seen.get(n) ?? []), m[2]!]);
  });
  for (const n of SPINE) if (!seen.has(n)) found.push(`spine task #${n} is missing`);
  for (const [n, commits] of seen) {
    if (!SPINE.includes(n)) found.push(`#${n} isn't a spine task`);
    if (commits.length > 1) found.push(`#${n} is named ${commits.length} times`);
  }
  for (const [n, commits] of seen) {
    if (!SPINE.includes(n)) continue;
    for (const c of commits) {
      const type = git(['cat-file', '-t', c]);
      if (type.status !== 0) { found.push(`BLOCKED: #${n}'s commit ${c} isn't in this repo's objects, so nothing can judge it`); continue; }
      if (type.stdout.trim() !== 'commit') { found.push(`#${n}'s ${c} is a ${type.stdout.trim()}, not a commit`); continue; }
      if (git(['merge-base', '--is-ancestor', c, 'refs/remotes/origin/main']).status === 0) continue;
      const key = out(['log', '-1', `--format=${FMT}%x00`, c]).split('\0')[0]!;
      if (!mainMerged().has(key)) found.push(`#${n}'s commit ${c} was never merged: it isn't in main's history and main's first-parent line has no rewritten copy of it (same tree, author, time and message)`);
    }
  }
  return found;
}

const realList = (): Listed => {
  const r = spawnSync(NODE, ['scripts/spine.mjs', 'list'], { cwd: REPO, encoding: 'utf8', env: ENV, timeout: 120_000 });
  must(r.error === undefined, `${AC8} BLOCKED: node scripts/spine.mjs list didn't run: ${String(r.error)}`);
  return { status: r.status, stdout: r.stdout };
};

/** The real output with task #n's line replaced (null drops it). */
const withRow = (real: Listed, n: number, line: string | null): Listed => ({
  status: real.status,
  stdout: real.stdout.split('\n').flatMap((l) => (l.startsWith(`#${n} `) ? (line === null ? [] : [line]) : [l])).join('\n'),
});
const commitOf = (real: Listed, n: number): string => {
  const line = real.stdout.split('\n').find((l) => l.startsWith(`#${n} `));
  must(line !== undefined && ROW.test(line), `${AC8} the real list must name #${n} to plant a twin from it: ${JSON.stringify(line)}`);
  return ROW.exec(line)![2]!;
};

describe(`${AC8} spine.mjs list names each of the 25 spine tasks once, with its merged commit (offline)`, () => {
  const real = realList();

  it(`${AC8} the real list: 25 rows, exactly the spine tasks, each commit a commit main merged`, () => {
    const found = problems(real);
    must(found.length === 0, `${AC8} node scripts/spine.mjs list is wrong:\n${found.join('\n')}\n--- output:\n${real.stdout}`);
    expect(real.stdout.split('\n').filter((l) => l.trim() !== '')).toHaveLength(25);
  });

  it(`${AC8} control: the same rows in another order are accepted`, () => {
    const reversed: Listed = { status: 0, stdout: real.stdout.split('\n').filter((l) => l.trim() !== '').reverse().join('\n') + '\n' };
    const found = problems(reversed);
    must(found.length === 0, `${AC8} a legitimate reordering was rejected:\n${found.join('\n')}`);
  });

  const twins: [string, () => Listed, RegExp][] = [
    ['a spine task left out (#44)', () => withRow(real, 44, null), /spine task #44 is missing/],
    ['a task that isn\'t on the spine (#33) added', () => ({ status: 0, stdout: `${real.stdout}#33 ${commitOf(real, 14)}\n` }), /#33 isn't a spine task/],
    ['a task named twice (#13)', () => ({ status: 0, stdout: `${real.stdout}#13 ${commitOf(real, 13)}\n` }), /#13 is named 2 times/],
    ['a short hash for #13', () => withRow(real, 13, `#13 ${commitOf(real, 13).slice(0, 12)}`), /line \d+ isn't/],
    ['a hash with no object behind it for #13', () => {
      const c = commitOf(real, 13);
      return withRow(real, 13, `#13 ${c.slice(0, 39)}${c.endsWith('0') ? '1' : '0'}`);
    }, /BLOCKED: #13's commit/],
    ['the merged commit\'s tree, not a commit, for #13', () => withRow(real, 13, `#13 ${out(['rev-parse', `${commitOf(real, 13)}^{tree}`]).trim()}`), /#13's [0-9a-f]{40} is a tree, not a commit/],
    ['the pull request\'s head, never merged itself, for #13', () => withRow(real, 13, `#13 ${out(['rev-parse', `${commitOf(real, 13)}^2`]).trim()}`), /#13's commit [0-9a-f]{40} was never merged/],
    ['the right rows from a list that exits 1', () => ({ status: 1, stdout: real.stdout }), /exits 1/],
    ['no rows at all', () => ({ status: 0, stdout: '' }), /spine task #12 is missing/],
  ];
  it.each(twins)(`${AC8} planted wrong list rejected: %s`, (_name, make, expected) => {
    const found = problems(make());
    must(found.some((f) => expected.test(f)), `${AC8} the planted wrong list passed or was rejected for another reason (want ${expected}): ${JSON.stringify(found)}`);
  });
});
