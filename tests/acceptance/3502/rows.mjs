// How this suite runs a row's test and reads its result (README: Every row's test). A row's Test cell names one test
// by its file and its name in that file's own list, as scripts/vendor-rebase.mjs holds it. Each file is run once,
// with every test this run needs from it, by the runner the script uses for that kind of file; a row then reads PASS,
// FAIL, BLOCKED or INCONCLUSIVE, and only PASS passes. BLOCKED is a test that could not be run here: no file, no test
// by that name, a skipped test, a runner that gave no report, or a test whose own failure says BLOCKED. INCONCLUSIVE
// is a test that ran and whose own judge could not decide here.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { clip, rowName, rowTest, tempDir, tilde } from './common.mjs';

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * A name as a cell writes it, as a pattern for the name its suite lists: a `${...}` in the cell stands for whatever
 * the file's constant holds there, and every other character for itself.
 */
export const namePattern = (name) => name.split(/\$\{[^}]*\}/).map(escape).join('.+?');
const whole = (name) => RegExp(`^${namePattern(name)}$`, 's');
const last = (name) => name.split(' › ').at(-1);

/** What a failed test said of itself: the design's word it starts with, or FAIL. */
function failed(text) {
  const said = /(?:^|\n|: )\s*['"]?(BLOCKED|INCONCLUSIVE)\b[: ]/.exec(text);
  const line = text.split('\n').map((each) => each.trim()).find((each) => each && !/^(?:---|\.\.\.|duration_ms|type:|failureType|code:|name:|stack:|expected:|actual:|operator:)/.test(each)) ?? '';
  return { verdict: said?.[1] ?? 'FAIL', why: tilde(clip(said ? text.slice(said.index).trim().split('\n')[0] : line.replace(/^(?:error|message): /, ''), 500)) };
}

/**
 * node --test's TAP: each test point with its name, whether it passed, its directive and the diagnostic under it.
 * TAP writes a `#` or a `\` of a name behind a `\`, so a name is read back as the file wrote it.
 */
function tapPoints(out) {
  const points = [];
  for (const line of out.split('\n')) {
    const point = /^\s*(not )?ok \d+ - (.*?)(?: # (SKIP|TODO)\b.*)?$/.exec(line);
    if (point) points.push({ name: point[2].replace(/\\([#\\])/g, '$1'), ok: !point[1], skipped: Boolean(point[3]), text: '' });
    else if (points.length) points.at(-1).text += `${line}\n`;
  }
  return points;
}

// A row's test is a run of its own, not a part of the test file that starts it: node's mark of a running test file
// stays behind, or the child would run nothing.
const { NODE_TEST_CONTEXT: _parent, ...ENV } = process.env;
const OPTIONS = { encoding: 'utf8', timeout: 4 * 3_600_000, maxBuffer: 1 << 28, env: ENV };

/**
 * Runs the tests `names` of the file `path` once, in the tree at `root`: for each name, `{verdict, why}`.
 * `.test.mjs` and its kin run under node --test, a `.rs` file under cargo test in its crate, anything else under
 * vitest, each as scripts/vendor-rebase.mjs runs one row's test.
 */
export function runFile(root, path, names) {
  const all = (verdict, why) => new Map(names.map((name) => [name, { verdict, why }]));
  if (!existsSync(join(root, path))) return all('BLOCKED', `no such test file: ${path}`);
  const found = new Map();
  if (/\.test\.[cm]?js$/.test(path)) {
    const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...names.map((name) => `--test-name-pattern=^${namePattern(last(name))}$`), path], { ...OPTIONS, cwd: root });
    const points = tapPoints(run.stdout ?? '');
    if (run.error || !points.length) return all('BLOCKED', `node --test gave no result for ${path} (${run.error?.message ?? `exit ${run.status}`}): ${tilde(clip(`${run.stdout ?? ''}${run.stderr ?? ''}`.slice(-600), 600))}`);
    for (const name of names) found.set(name, points.filter((point) => RegExp(`^${namePattern(last(name))}$`, 's').test(point.name)).map((point) => ({ state: point.skipped ? 'skipped' : point.ok ? 'passed' : 'failed', text: point.text })));
  } else if (path.endsWith('.rs')) {
    let crate = dirname(path);
    while (crate !== '.' && !existsSync(join(root, crate, 'Cargo.toml'))) crate = dirname(crate);
    for (const name of names) {
      const run = spawnSync('cargo', ['test', '--locked', name, '--', '--exact'], { ...OPTIONS, cwd: join(root, crate) });
      found.set(name, [...(run.stdout ?? '').matchAll(/^test (\S+) \.\.\. (\w+)$/gm)].filter(([, each]) => each === name).map(([, , state]) => ({ state: state === 'ok' ? 'passed' : state === 'ignored' ? 'skipped' : 'failed', text: clip(`${run.stdout ?? ''}${run.stderr ?? ''}`.slice(-2000), 2000) })));
    }
  } else {
    const out = join(tempDir('rows'), 'report.json');
    const pattern = names.length === 1 ? namePattern(last(names[0])) : `(?:${names.map((name) => namePattern(last(name))).join('|')})`;
    const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', path, '-t', pattern, '--reporter=json', `--outputFile=${out}`], { ...OPTIONS, cwd: root });
    if (run.error || !existsSync(out)) return all('BLOCKED', `vitest wrote no report for ${path} (${run.error?.message ?? `exit ${run.status}`}): ${tilde(clip(`${run.stdout ?? ''}${run.stderr ?? ''}`.slice(-600), 600))}`);
    const results = JSON.parse(readFileSync(out, 'utf8')).testResults.flatMap(({ assertionResults }) => assertionResults ?? []);
    for (const name of names) found.set(name, results.filter(({ ancestorTitles, title }) => whole(name).test([...ancestorTitles, title].join(' › '))).map(({ status, failureMessages }) => ({ state: status, text: (failureMessages ?? []).join('\n') })));
  }
  return new Map(names.map((name) => {
    const ran = found.get(name) ?? [];
    if (!ran.length) return [name, { verdict: 'BLOCKED', why: `${path} ran no test by that name` }];
    const bad = ran.find(({ state }) => state === 'failed');
    if (bad) return [name, failed(bad.text)];
    const unrun = ran.find(({ state }) => state !== 'passed');
    return [name, unrun ? { verdict: 'BLOCKED', why: `its test was ${unrun.state}, not run` } : { verdict: 'PASS', why: '' }];
  }));
}

const memo = new Map();
/**
 * The verdict of each Test cell in `cells`, each file run once for all of them and never again in this process:
 * a map from the cell to `{verdict, why}`.
 */
export function runCells(root, cells) {
  const byFile = new Map();
  for (const cell of new Set(cells)) {
    const named = rowTest(cell);
    if (!named) memo.set(`${root}\n${cell}`, { verdict: 'BLOCKED', why: `the cell names no test: ${cell || 'empty'}` });
    else if (!memo.has(`${root}\n${cell}`)) byFile.set(named.path, [...(byFile.get(named.path) ?? []), { cell, name: named.name }]);
  }
  for (const [path, wanted] of byFile) {
    const results = runFile(root, path, [...new Set(wanted.map(({ name }) => name))]);
    for (const { cell, name } of wanted) memo.set(`${root}\n${cell}`, results.get(name));
  }
  return new Map(cells.map((cell) => [cell, memo.get(`${root}\n${cell}`)]));
}

/**
 * Each row with its own outcome: one `ROW <issue> <behavior>: <verdict>` line a row, and a failure for every row
 * that doesn't read PASS, naming the row, its verdict and its test.
 */
export function judgeRows(rows, verdicts) {
  const lines = [], failures = [];
  for (const row of rows) {
    const { verdict, why } = verdicts.get(row.test) ?? { verdict: 'BLOCKED', why: 'its test was never run' };
    lines.push(`ROW ${rowName(row)}: ${verdict}${why ? `: ${why}` : ''}`);
    if (verdict !== 'PASS') failures.push(`${verdict} row ${rowName(row)}: its test ${row.test.replace(/^`|`$/g, '')} ${verdict === 'FAIL' ? 'fails' : verdict === 'BLOCKED' ? "can't run" : "can't decide here"}: ${why}`);
  }
  return { lines, failures };
}

/**
 * Criterion 2 on a table: the rows the merge base's table held and this one doesn't, each with the retired row that
 * names it, and what is wrong with either. A merge-base row is still carried while this table holds a row of its
 * issue with its Test cell or its Behavior cell as the merge base wrote it; otherwise it was removed, and the retired
 * rows hold one of its issue and its Test cell whose Upstream change cell names the change: `owner/repo#n`,
 * `owner/repo@<commit>` or a link to the pull request or commit.
 */
export function judgeRetired(baseRows, headRows, retired) {
  const failures = [], removed = [];
  if (retired === null) return { removed, failures: ['the retired rows have no table with the columns Behavior | Issue | Test | Upstream change'] };
  // A row kept word for word is paired first, so rows of one issue that share a test are told apart by what they do.
  const left = [...headRows];
  let gone = [...baseRows];
  for (const cell of ['behavior', 'test']) {
    gone = gone.filter((row) => {
      const kept = left.findIndex((each) => each.issue === row.issue && each[cell] === row[cell]);
      if (kept >= 0) left.splice(kept, 1);
      return kept < 0;
    });
  }
  removed.push(...gone);
  const unused = [...retired];
  for (const row of removed) {
    const at = unused.findIndex((each) => each.issue === row.issue && each.test === row.test);
    if (at < 0) {
      failures.push(`the merge base's row ${rowName(row)} is gone from the table and no retired row of ${row.issue} with its test names the upstream change that met its removal condition (${row.removal})`);
      continue;
    }
    const [entry] = unused.splice(at, 1);
    row.retired = entry;
    if (!entry.behavior) failures.push(`the retired row of ${row.issue} says nothing of what was carried`);
    if (!UPSTREAM.test(entry.upstream)) failures.push(`the retired row ${rowName(entry)} names no upstream change (owner/repo#n, owner/repo@commit or a link to it) that met its removal condition (${row.removal}): "${entry.upstream}"`);
  }
  for (const entry of retired) if (!rowTest(entry.test)) failures.push(`the retired row ${rowName(entry)} names no test: "${entry.test}"`);
  return { removed, failures };
}
const UPSTREAM = /(?:^|[\s(`])[\w.-]+\/[\w.-]+(?:#\d+|@[0-9a-f]{7,40})\b|https:\/\/[\w.-]+\/[\w.-]+\/[\w.-]+\/(?:pull|commit)\/[0-9a-f]+/;

/** A carried row whose own removal condition is a pin the tree has reached: the Scope removes it. */
export function judgeMetByPin(headRows, release, atLeast) {
  return headRows.flatMap((row) => {
    const floor = /\bthe pin moves to gpui-pre (\d+\.\d+\.\d+) or later\b/.exec(row.removal)?.[1];
    return floor && release && atLeast(release, floor) ? [`the row ${rowName(row)} is still carried, and its removal condition is met: the pin is ${release} (${row.removal})`] : [];
  });
}
