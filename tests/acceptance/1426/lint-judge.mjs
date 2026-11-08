// #1426's judges of `check` on a planted tree and stub pinned releases: each answers its failures, one line each, and
// an empty list means the script met the criterion. No judge reaches the network.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cleanEnv, clip, linesOf, mark, naming, plantTree, README, refusals, RELEASES, repoRoot, runIn, SCRIPT, tempRoot, remove, testCell } from './common.mjs';

const COLOR = 'vendor/gpui-pre/src/color.rs';
const RENDERER = 'vendor/gpui-pre-apple/src/metal_renderer.rs';
const GPUI = 'vendor/gpui-pre/src/gpui.rs';

/** The script ran and passed the plant. */
const passes = (run) => run.status === 0 && !refusals(run.output).length;
/** Runs `check` in a fresh plant after `plant(box)`, and answers what `judge(run, planted, box)` says. */
function planted(script, plant, judge) {
  if (!existsSync(script)) return [`no script at ${script}`];
  const box = plantTree();
  try {
    const at = plant(box);
    return judge(runIn(script, box, ['check']), at, box);
  } finally {
    box.remove();
  }
}
const lines = (count, issue, tag) => [mark(issue, tag), ...Array.from({ length: count - 1 }, (_, index) => `pub const PLANTED_${tag.toUpperCase()}_${index}: u8 = ${index};`)];
/** `count` fresh lines with `issue`'s mark at `after`, far from the plant's own hunks. */
const hunk = (box, path, after, count, issue, tag = 'more') => box.insert(path, after, lines(count, issue, tag));

/** The planted tree passes as it stands: every changed file has its row, every hunk its mark. */
export function judgeClean(script) {
  return planted(script, () => null, (run) => (passes(run) ? [] : [`the plant as it stands fails check (exit ${run.status}): ${clip(run.output)}`]));
}

/** Each place a changed file with no row can sit, in each vendored crate. */
const NO_ROW = [
  ['a file of gpui-pre with no row', 'vendor/gpui-pre/src/gpui.rs', 9001],
  ['a nested file of gpui-pre with no row', 'vendor/gpui-pre/src/app/context.rs', 9001],
  ['a file under gpui-pre-apple/vendor with no row', 'vendor/gpui-pre-apple/vendor/gpui/src/color.rs', 9002],
  ['a file of quickjs-jit-runtime with no row', 'vendor/quickjs-jit-runtime/src/engine.rs', 9003],
];

/** AC1: a planted changed file with no row fails, naming it, in every vendored tree; so does a new file. */
export function judgeNoRow(script) {
  const failures = judgeClean(script);
  if (failures.length) return failures;
  for (const [what, path, issue] of NO_ROW) {
    failures.push(...planted(script, (box) => hunk(box, path, 3, 2, issue), (run) => {
      if (run.status === 0) return [`${what} (${path}) passes check`];
      return linesOf(run.output, 'FAIL').some((line) => line.includes(path) && /\bno row\b/.test(line)) ? [] : [`${what} fails check without a FAIL line naming ${path} and "no row": ${clip(run.output)}`];
    }));
  }
  const fresh = 'vendor/gpui-pre/src/planted_fresh.rs';
  failures.push(...planted(script, (box) => box.write(fresh, `${mark(9001)}\npub const PLANTED: u8 = 1;\n`), (run) => (
    run.status !== 0 && linesOf(run.output, 'FAIL').some((line) => line.includes(fresh)) ? [] : [`a new vendored file with no row passes check, or fails without naming ${fresh} (exit ${run.status}): ${clip(run.output)}`])));
  return failures;
}

/** AC1: a planted row with no test fails, naming the row, as does a row whose test isn't there; a row with no issue fails. */
export function judgeRowCells(script) {
  const cases = [
    ['an empty Test cell', { test: '' }],
    ['a dash in the Test cell', { test: '—' }],
    ['a test whose file is gone', { test: testCell('gradient keeps its stops', 'tests/planted/gone.test.mjs') }],
    ['a test its file doesn\'t hold', { test: testCell('no such test') }],
    ['an empty Issue cell', { issue: '' }],
  ];
  const failures = [];
  for (const [what, cells] of cases) {
    failures.push(...planted(script, (box) => box.rows((rows) => { Object.assign(rows[0], cells); }), (run) => {
      if (run.status === 0) return [`a row with ${what} passes check`];
      return linesOf(run.output, 'FAIL').some((line) => line.includes('The planted gradient')) ? [] : [`a row with ${what} fails check without a FAIL line naming The planted gradient: ${clip(run.output)}`];
    }));
  }
  return failures;
}

/** Invariant 2: a pinned release that can't be read is never a pass. */
export function judgeMissingRelease(script) {
  if (!existsSync(script)) return [`no script at ${script}`];
  const box = plantTree();
  const empty = tempRoot('empty');
  try {
    const run = runIn(script, box, ['check'], { [RELEASES]: empty });
    if (run.status === 0) return [`check passes with no pinned release to compare with (exit 0): ${clip(run.output)}`];
    return refusals(run.output).some((line) => /^(?:BLOCKED|INCONCLUSIVE)\b/.test(line) && /gpui-pre/.test(line)) ? [] : [`check with no pinned release isn't BLOCKED or INCONCLUSIVE naming the crate: ${clip(run.output)}`];
  } finally {
    box.remove();
    remove(empty);
  }
}

/** AC4: an unmarked hunk in a file with a row fails, naming file and line; a mark next to it, or in it, passes it. */
export function judgeMarks(script) {
  const failures = judgeClean(script);
  failures.push(...planted(script, (box) => box.insert(COLOR, 50, ['pub const PLANTED_UNMARKED: u8 = 1;']), (run, line) => {
    if (run.status === 0) return [`an unmarked hunk at ${COLOR}:${line}, in a file with a row, passes check`];
    return naming(run.output, COLOR, line).length ? [] : [`an unmarked hunk fails check without a FAIL line naming ${COLOR}:${line}: ${clip(run.output)}`];
  }));
  failures.push(...planted(script, (box) => box.insert(COLOR, 50, [mark(9001, 'marked in the hunk'), 'pub const PLANTED_MARKED: u8 = 1;']), (run, line) => (
    passes(run) ? [] : [`a hunk with the mark in it, at ${COLOR}:${line}, fails check: ${clip(run.output)}`])));
  failures.push(...planted(script, (box) => {
    box.insert(COLOR, 50, [mark(9001, 'marks the hunk one line below')]);
    return box.insert(COLOR, 52, ['pub const PLANTED_BESIDE: u8 = 1;']);
  }, (run, line) => (passes(run) ? [] : [`a hunk with the mark next to it, at ${COLOR}:${line}, fails check: ${clip(run.output)}`])));
  return failures;
}

const ROW = (issue, name) => new RegExp(`^ROW ${issue} ${name}: (\\d+) marked, (\\d+) over budget`);
const rowCount = (output, issue, name) => {
  const hit = linesOf(output, 'ROW').map((line) => ROW(issue, name).exec(line)).find(Boolean);
  return hit && { marked: Number(hit[1]), over: Number(hit[2]) };
};

/** AC6: the count of marked hunks is printed per row, follows the tree, and a row with none fails. */
export function judgeCounts(script) {
  const failures = [];
  failures.push(...planted(script, () => null, (run) => {
    const found = [['#9001', 'The planted gradient', 2], ['#9002', 'The planted surface', 2], ['#9003', 'The planted switch', 1]].flatMap(([issue, name, count]) => {
      const row = rowCount(run.output, issue, name);
      return row?.marked === count ? [] : [`row ${issue} prints ${row ? row.marked : 'no count'}, not ${count} marked hunks: ${clip(run.output)}`];
    });
    return found;
  }));
  failures.push(...planted(script, (box) => hunk(box, COLOR, 50, 3, 9001), (run) => (rowCount(run.output, '#9001', 'The planted gradient')?.marked === 3 ? [] : [`a third marked hunk leaves row #9001 not printing 3 marked hunks: ${clip(run.output)}`])));
  failures.push(...planted(script, (box) => box.rows((rows) => {
    rows.push({ ...rows[0], behavior: 'The planted idle row', issue: '#9004', budget: '—' });
  }), (run) => {
    const found = [];
    if (run.status === 0) found.push('a row with no marked hunk passes check');
    if (rowCount(run.output, '#9004', 'The planted idle row')?.marked !== 0) found.push(`the row with no marked hunk doesn't print 0 marked hunks: ${clip(run.output)}`);
    if (!linesOf(run.output, 'FAIL').some((line) => line.includes('The planted idle row'))) found.push(`no FAIL line names the row with no marked hunk: ${clip(run.output)}`);
    return found;
  }));
  return failures;
}

/** AC7: a marked 9-line hunk fails, naming file, line and size; an 8-line one passes. */
export function judgeHunkBudget(script) {
  const failures = [];
  failures.push(...planted(script, (box) => hunk(box, COLOR, 50, 8, 9001), (run, line) => (passes(run) ? [] : [`a marked 8-line hunk at ${COLOR}:${line} fails check: ${clip(run.output)}`])));
  failures.push(...planted(script, (box) => hunk(box, COLOR, 50, 9, 9001), (run, line) => {
    if (run.status === 0) return [`a marked 9-line hunk at ${COLOR}:${line} passes check`];
    const named = naming(run.output, COLOR, line);
    if (!named.length) return [`a marked 9-line hunk fails check without a FAIL line naming ${COLOR}:${line}: ${clip(run.output)}`];
    return named.some((text) => /\b9 lines\b/.test(text)) ? [] : [`the FAIL line names no size of 9 lines: ${named[0]}`];
  }));
  return failures;
}

/** Scope: 40 added lines a file pass, in hunks within their budget; 41 fail, naming the file and the count. */
export function judgeFileBudget(script) {
  const withRow = (box) => box.rows((rows) => {
    rows.push({ behavior: 'The planted file', issue: '#9005', files: [GPUI], test: testCell('gradient keeps its stops'), budget: '—' });
  });
  const forty = (box) => {
    withRow(box);
    [50, 40, 30, 20, 10].forEach((after, index) => hunk(box, GPUI, after, 8, 9005, `file${index}`));
  };
  const failures = [];
  failures.push(...planted(script, forty, (run) => (passes(run) ? [] : [`40 added lines in ${GPUI}, in five 8-line hunks, fail check: ${clip(run.output)}`])));
  failures.push(...planted(script, (box) => {
    forty(box);
    box.insert(GPUI, 2, [`pub const PLANTED_ONE_MORE: u8 = 1; ${mark(9005, 'one more')}`]);
  }, (run) => {
    if (run.status === 0) return [`41 added lines in ${GPUI} pass check`];
    return linesOf(run.output, 'FAIL').some((line) => line.includes(GPUI) && /\b41\b/.test(line)) ? [] : [`41 added lines fail check without a FAIL line naming ${GPUI} and 41: ${clip(run.output)}`];
  }));
  return failures;
}

/** AC8: an addition over budget, moved to a new file with a one-line `mod`, passes with a row for the new file. */
export function judgeNewFile(script) {
  const fresh = 'vendor/gpui-pre/src/planted_moved.rs';
  const body = lines(60, 9001, 'moved').join('\n');
  const failures = [];
  // The same addition, in place: the budget stands in the way of it.
  failures.push(...planted(script, (box) => box.insert(COLOR, 50, body.split('\n')), (run, line) => (
    run.status !== 0 && naming(run.output, COLOR, line).length ? [] : [`a 60-line addition in place, at ${COLOR}:${line}, isn't refused: ${clip(run.output)}`])));
  const moved = (box) => {
    box.write(fresh, `${body}\n`);
    box.insert(GPUI, 5, [`mod planted_moved; ${mark(9001, 'the addition lives in planted_moved.rs')}`]);
  };
  failures.push(...planted(script, (box) => {
    moved(box);
    box.rows((rows) => { rows[0].files.push(fresh, GPUI); });
  }, (run) => (passes(run) ? [] : [`a 60-line addition moved to a new file, with one marked mod line and a row, fails check: ${clip(run.output)}`])));
  failures.push(...planted(script, (box) => {
    moved(box);
    box.rows((rows) => { rows[0].files.push(GPUI); });
  }, (run) => (run.status !== 0 && linesOf(run.output, 'FAIL').some((line) => line.includes(fresh)) ? [] : [`the moved addition with no row for the new file passes check, or fails without naming ${fresh}: ${clip(run.output)}`])));
  return failures;
}

/** AC9, the lint's half: a raised budget with no reason fails, naming the row. */
export function judgeReason(script) {
  const failures = [];
  for (const budget of ['1 over', '1 over:']) {
    failures.push(...planted(script, (box) => box.rows((rows) => { rows[1].budget = budget; }), (run) => {
      if (run.status === 0) return [`a row raising a budget with the cell "${budget}", no reason, passes check`];
      return linesOf(run.output, 'FAIL').some((line) => line.includes('The planted surface')) ? [] : [`a row with no reason fails without a FAIL line naming The planted surface: ${clip(run.output)}`];
    }));
  }
  return failures;
}

/** AC10: hunks over budget print per row, and a change that raises a row's count over its number fails. */
export function judgeOverCount(script) {
  const failures = [];
  failures.push(...planted(script, () => null, (run) => {
    const found = [];
    if (rowCount(run.output, '#9002', 'The planted surface')?.over !== 1) found.push(`row #9002 doesn't print 1 hunk over budget: ${clip(run.output)}`);
    if (rowCount(run.output, '#9001', 'The planted gradient')?.over !== 0) found.push(`row #9001 doesn't print 0 hunks over budget: ${clip(run.output)}`);
    return found;
  }));
  failures.push(...planted(script, (box) => hunk(box, RENDERER, 60, 9, 9002), (run) => {
    const found = [];
    if (run.status === 0) found.push('a second hunk over budget in a row whose number is 1 passes check');
    if (rowCount(run.output, '#9002', 'The planted surface')?.over !== 2) found.push(`the row doesn't print 2 hunks over budget: ${clip(run.output)}`);
    if (!linesOf(run.output, 'FAIL').some((line) => line.includes('The planted surface') && /\b2\b/.test(line) && /\b1\b/.test(line))) found.push(`no FAIL line names the row with its count, 2, and its number, 1: ${clip(run.output)}`);
    return found;
  }));
  failures.push(...planted(script, (box) => {
    hunk(box, RENDERER, 60, 9, 9002);
    box.rows((rows) => { rows[1].budget = '2 over: the draw path is two branches now'; });
  }, (run) => (passes(run) ? [] : [`a row whose number covers its two hunks over budget fails check: ${clip(run.output)}`])));
  return failures;
}

/**
 * AC1, the lane: the `lint` lane of the table at `lanes` runs `check` on every change, and through runLanes a planted
 * file with no row and a planted row with no test each fail it, naming them, while the plant as it stands passes.
 */
export async function judgeWiring(lanes, { script = SCRIPT } = {}) {
  const { checks } = await import(pathToFileURL(lanes).href);
  const lint = (checks ?? []).find((lane) => lane.name === 'lint');
  if (!lint) return [`${lanes} has no lint lane in checks`];
  const command = (lint.commands ?? []).find((argv) => argv.some((arg) => String(arg).endsWith(script)));
  if (!command) return [`the lint lane doesn't run ${script}`];
  if (command.at(-1) !== 'check') return [`the lint lane runs ${command.slice(1).join(' ')}, not ${script} check with nothing after it`];
  if (lint.paths && !lint.paths.some((path) => `${README}`.startsWith(path.replace(/\*\*$/, '')))) return [`the lint lane's paths skip a change to vendor/: ${JSON.stringify(lint.paths)}`];
  const absolute = command.map((arg) => (String(arg).endsWith(script) ? join(repoRoot, arg) : arg));
  const lane = (box) => {
    const code = `const { runLanes } = await import(${JSON.stringify(pathToFileURL(join(repoRoot, 'scripts/lanes.mjs')).href)});
      process.exitCode = runLanes([JSON.parse(process.env.DA1426_LANE)], { cwd: ${JSON.stringify(box.root)} });`;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: box.root, encoding: 'utf8', timeout: 180_000, maxBuffer: 64 * 1024 * 1024,
      env: cleanEnv({ HOME: box.dir, [RELEASES]: box.releases, DA1426_LANE: JSON.stringify({ name: 'lint', commands: [absolute], fix: 'Give it a row.' }) }),
    });
    return { status: run.status, output: `${run.stdout ?? ''}${run.stderr ?? ''}` };
  };
  const failures = [];
  const scene = (plant, judge) => {
    const box = plantTree();
    try {
      plant(box);
      failures.push(...judge(lane(box)));
    } finally {
      box.remove();
    }
  };
  scene(() => null, (run) => (run.status === 0 ? [] : [`the lint lane's check fails the plant as it stands (exit ${run.status}): ${clip(run.output)}`]));
  const fails = (what, name) => (run) => (run.status !== 0 && linesOf(run.output, 'FAIL').some((line) => line.startsWith('FAIL lint:')) && linesOf(run.output, 'FAIL').some((line) => line.includes(name)) ? [] : [`the lint lane with ${what} doesn't fail as 'FAIL lint: ...' naming ${name} (exit ${run.status}): ${clip(run.output)}`]);
  scene((box) => hunk(box, GPUI, 3, 2, 9001), fails('a planted changed file with no row', GPUI));
  scene((box) => box.rows((rows) => { rows[0].test = '—'; }), fails('a planted row with no test', 'The planted gradient'));
  return failures;
}
