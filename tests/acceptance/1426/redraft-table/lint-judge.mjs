// #1426's lint judges: `scripts/vendor-rebase.mjs check` on a planted tree with stub releases (common.mjs), for AC1,
// AC4, AC6, AC7, AC8, AC9's lint half and AC10. Each judge answers its failures, one line each; an empty list means
// the script met the criterion. No judge reaches the network or builds gpui.
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cleanEnv, clip, COLOR, linesOf, mark, passes, planted, plantTree, README, RELEASES, RENDERER, repoRoot, runIn, SCRIPT, testCell } from './common.mjs';

export const GRADIENT = 'The planted gradient';
export const SURFACE = 'The planted surface';
export const SWITCH_ROW = 'The planted switch';

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fails = (run) => linesOf(run.output, 'FAIL');
/** A FAIL line holding `path:line`, and no longer number. */
const namingAt = (run, path, line) => fails(run).filter((text) => new RegExp(`${escape(path)}:${line}(?!\\d)`).test(text));
const naming = (run, ...words) => fails(run).filter((text) => words.every((word) => text.includes(word)));
/** The line number in the plant's `path` of the line `text`, 1-based. */
const lineOf = (box, path, text) => box.read(path).split('\n').indexOf(text) + 1;
const upstreamColor = (box, line) => lineOf(box, COLOR, `// upstream color line ${line}`);
const code = (tag, count) => Array.from({ length: count }, (_, index) => `pub const PLANTED_${tag}_${index}: u8 = ${index};`);

const clean = (script) => planted(script, () => null, (run) => (passes(run) ? [] : [`the plant as it stands fails check (exit ${run.status}): ${clip(run.output)}`]));

/** `check` must refuse what `plant` did, with a FAIL line `ok(run, at)` accepts; `named` says what that line must name. */
const refuses = (script, what, plant, ok, named) => planted(script, plant, (run, at) => {
  if (run.status === 0) return [`${what}: check passes (exit 0): ${clip(run.output)}`];
  return ok(run, at) ? [] : [`${what}: check fails (exit ${run.status}) without a FAIL line naming ${typeof named === 'function' ? named(at) : named}: ${clip(run.output)}`];
});
/** `check` must pass what `plant` did. */
const accepts = (script, what, plant) => planted(script, plant, (run) => (passes(run) ? [] : [`${what}: check fails (exit ${run.status}): ${clip(run.output)}`]));

// ---------------------------------------------------------------------------------------------------------------- AC1

/** Each place under vendor/ a changed file can sit, with no row: each must fail, naming the file. */
const NO_ROW = [
  ['a changed nested file of gpui-pre', 'vendor/gpui-pre/src/app/context.rs', (box, path) => box.insert(path, 5, [mark(9001, 'context'), 'pub const PLANTED_CONTEXT: u8 = 1;'])],
  ['a changed file of gpui-pre-apple\'s own vendored gpui', 'vendor/gpui-pre-apple/vendor/gpui/src/color.rs', (box, path) => box.insert(path, 5, [mark(9001, 'nested color'), 'pub const PLANTED_NESTED: u8 = 1;'])],
  ['a new file in gpui-pre', 'vendor/gpui-pre/src/planted_new.rs', (box, path) => box.write(path, `${mark(9001, 'fresh')}\npub const PLANTED_FRESH: u8 = 1;\n`)],
  ['a changed manifest of gpui-pre', 'vendor/gpui-pre/Cargo.toml', (box, path) => box.write(path, `${box.read(path)}\n# DeepBuild patch (windoliver/deepbuild#9001): planted\n[features]\nplanted = []\n`)],
  ['a changed file of quickjs-jit-runtime', 'vendor/quickjs-jit-runtime/src/engine.rs', (box, path) => box.insert(path, 5, [mark(9003, 'engine'), 'pub const PLANTED_ENGINE: u8 = 1;'])],
  ['a changed Unicode test file', 'vendor/unicode-17.0.0/GraphemeBreakTest.txt', (box, path) => box.write(path, `${box.read(path)}÷ 0041 ÷ 0042 ÷\t#  planted\n`)],
];

/** AC1: every vendored file that differs from its release has a row; a changed file with no row fails, naming it. */
export function judgeRowPerFile(script) {
  const failures = clean(script);
  if (failures.length) return failures;
  for (const [what, path, plant] of NO_ROW) failures.push(...refuses(script, `${what} (${path}) with no row`, (box) => plant(box, path), (run) => naming(run, path).length > 0, path));
  // The control: the nested gpui-pre change, listed in the gradient's row, passes.
  const [, path, plant] = NO_ROW[0];
  failures.push(...accepts(script, `${path}'s marked change, listed in the gradient's row`, (box) => {
    plant(box, path);
    box.rows((rows) => { rows[0].files.push(path); });
  }));
  return failures;
}

/** AC1: every row names an issue and a test; a row with none fails, naming the row. */
export function judgeRowFields(script) {
  const failures = clean(script);
  if (failures.length) return failures;
  for (const [what, cell] of [['an empty Test cell', ''], ['a dash in the Test cell', '—']]) {
    failures.push(...refuses(script, `the gradient's row with ${what}`, (box) => box.rows((rows) => { rows[0].test = cell; }), (run) => naming(run, GRADIENT).length > 0, `the row (${GRADIENT})`));
  }
  failures.push(...refuses(script, 'the switch\'s row with an empty Issue cell', (box) => box.rows((rows) => { rows[2].issue = ''; }), (run) => naming(run, SWITCH_ROW).length > 0, `the row (${SWITCH_ROW})`));
  return failures;
}

/** AC1 and invariant 2: a tree whose pinned release can't be read is BLOCKED or INCONCLUSIVE, naming it, never a pass. */
export function judgeMissingRelease(script) {
  if (!existsSync(script)) return [`no script at ${script}`];
  const box = plantTree();
  try {
    rmSync(join(box.releases, 'quickjs-jit-runtime-0.12.11'), { recursive: true, force: true });
    const run = runIn(script, box, ['check']);
    const named = run.output.split('\n').some((line) => /^(?:BLOCKED|INCONCLUSIVE)\b/.test(line) && line.includes('quickjs-jit-runtime'));
    if (run.status === 0) return [`with quickjs-jit-runtime's pinned release missing, check passes (exit 0): ${clip(run.output)}`];
    return named ? [] : [`with quickjs-jit-runtime's pinned release missing, check prints no BLOCKED or INCONCLUSIVE line naming quickjs-jit-runtime: ${clip(run.output)}`];
  } finally {
    box.remove();
  }
}

/**
 * AC1, "each fail the lint lane": the lane named `lint` in `checks` of the table at `lanes` runs `check`, on every
 * change to vendor/, and through runLanes a changed file with no row and a row with no test each fail it as
 * `FAIL lint: ...`, with a line naming it, while the plant as it stands passes. `script` is the file the lane's
 * `scripts/vendor-rebase.mjs` stands for.
 */
export async function judgeLane(lanes, { script = join(repoRoot, SCRIPT) } = {}) {
  const { checks } = await import(pathToFileURL(lanes).href);
  const lint = (checks ?? []).find((lane) => lane.name === 'lint');
  if (!lint) return [`${lanes} has no lint lane in checks`];
  const command = (lint.commands ?? []).find((argv) => argv.some((arg) => String(arg).endsWith(SCRIPT)));
  if (!command) return [`the lint lane doesn't run ${SCRIPT}`];
  if (command.at(-1) !== 'check') return [`the lint lane runs ${command.slice(1).join(' ')}, not ${SCRIPT} check`];
  for (const path of ['vendor/gpui-pre/src/app/context.rs', README]) {
    if (lint.paths && !lint.paths.some((glob) => path.startsWith(glob.replace(/\*\*$/, '')))) return [`the lint lane's paths skip a change to ${path}: ${JSON.stringify(lint.paths)}`];
  }
  if (!existsSync(script)) return [`no script at ${script}`];
  const absolute = command.map((arg) => (String(arg).endsWith(SCRIPT) ? script : arg));
  const lane = (box) => {
    const program = `const { runLanes } = await import(${JSON.stringify(pathToFileURL(join(repoRoot, 'scripts/lanes.mjs')).href)});
      process.exitCode = runLanes([JSON.parse(process.env.DA1426_LANE)], { cwd: ${JSON.stringify(box.root)} });`;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
      cwd: box.root, encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024,
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
  const failsLane = (run, word) => run.status !== 0 && fails(run).some((line) => line.startsWith('FAIL lint:')) && fails(run).some((line) => line.includes(word));
  scene(() => null, (run) => (run.status === 0 ? [] : [`the lint lane fails the plant as it stands (exit ${run.status}): ${clip(run.output)}`]));
  const [, path, plant] = NO_ROW[0];
  scene((box) => plant(box, path), (run) => (failsLane(run, path) ? [] : [`the lint lane with ${path} changed and no row doesn't fail as 'FAIL lint: ...' with a line naming the file (exit ${run.status}): ${clip(run.output)}`]));
  scene((box) => box.rows((rows) => { rows[0].test = ''; }), (run) => (failsLane(run, GRADIENT) ? [] : [`the lint lane with a row with no test doesn't fail as 'FAIL lint: ...' with a line naming the row (${GRADIENT}) (exit ${run.status}): ${clip(run.output)}`]));
  return failures;
}

// ---------------------------------------------------------------------------------------------------------------- AC4

/** AC4: an unmarked hunk in color.rs, which has a row, fails naming file and line; a mark in it or next to it passes. */
export function judgeMarks(script) {
  const failures = clean(script);
  if (failures.length) return failures;
  // Far from both of color.rs's marks: a pure addition, and an upstream line rewritten in place.
  failures.push(...refuses(script, 'an unmarked 2-line addition in color.rs', (box) => box.insert(COLOR, upstreamColor(box, 45), code('UNMARKED', 2)),
    (run, at) => namingAt(run, COLOR, at).length > 0, (at) => `${COLOR}:${at}`));
  failures.push(...refuses(script, 'an unmarked rewrite of color.rs\'s upstream line 50', (box) => {
    const at = upstreamColor(box, 50);
    const lines = box.read(COLOR).split('\n');
    lines[at - 1] = '// upstream color line 50, rewritten here';
    box.write(COLOR, lines.join('\n'));
    return at;
  }, (run, at) => namingAt(run, COLOR, at).length > 0, (at) => `${COLOR}:${at}`));
  // A mark in the hunk, first or last, or one unchanged line from it.
  failures.push(...accepts(script, 'a 3-line addition in color.rs whose first line is the mark', (box) => box.insert(COLOR, upstreamColor(box, 45), [mark(9001, 'first'), ...code('FIRST', 2)])));
  failures.push(...accepts(script, 'a 3-line addition in color.rs whose last line is the mark', (box) => box.insert(COLOR, upstreamColor(box, 45), [...code('LAST', 2), mark(9001, 'last')])));
  failures.push(...accepts(script, 'an unmarked line one unchanged line below a marked hunk\'s mark', (box) => {
    box.insert(COLOR, upstreamColor(box, 45), [...code('ABOVE', 1), mark(9001, 'covers the line below too')]);
    box.insert(COLOR, upstreamColor(box, 46), code('BELOW', 1));
  }));
  return failures;
}

// ---------------------------------------------------------------------------------------------------------------- AC6

/** The ROW line for `behavior`: its marked count and its over-budget count, or null. */
export function rowLine(output, behavior) {
  const line = output.split('\n').find((text) => text.startsWith('ROW ') && text.includes(behavior));
  if (!line) return null;
  return { line, marked: Number(/(\d+) marked/.exec(line)?.[1] ?? NaN), over: Number(/(\d+) over budget/.exec(line)?.[1] ?? NaN) };
}

const expectRows = (run, expected, what) => {
  const failures = [];
  for (const [behavior, key, count] of expected) {
    const row = rowLine(run.output, behavior);
    if (!row) failures.push(`${what}: no ROW line for ${behavior}: ${clip(run.output)}`);
    else if (row[key] !== count) failures.push(`${what}: ${behavior}'s ROW line gives ${Number.isNaN(row[key]) ? 'no' : row[key]} ${key === 'marked' ? 'marked' : 'over budget'}, not ${count}: ${row.line}`);
  }
  return failures;
};

/** AC6: each row's count of marked hunks is printed; a new marked hunk moves it; a row with none fails, naming it. */
export function judgeCounts(script) {
  const failures = planted(script, () => null, (run) => [
    ...(passes(run) ? [] : [`the plant as it stands fails check (exit ${run.status}): ${clip(run.output)}`]),
    ...expectRows(run, [[GRADIENT, 'marked', 2], [SURFACE, 'marked', 2], [SWITCH_ROW, 'marked', 1]], 'the plant as it stands'),
  ]);
  if (failures.length) return failures;
  failures.push(...planted(script, (box) => box.insert(COLOR, upstreamColor(box, 45), [mark(9001, 'a third stop'), ...code('THIRD', 1)]), (run) => [
    ...(passes(run) ? [] : [`a third marked hunk in color.rs fails check (exit ${run.status}): ${clip(run.output)}`]),
    ...expectRows(run, [[GRADIENT, 'marked', 3], [SWITCH_ROW, 'marked', 1]], 'with a third marked hunk in color.rs'),
  ]));
  const EMPTY = 'The planted orphan';
  failures.push(...planted(script, (box) => box.rows((rows) => [...rows, { behavior: EMPTY, issue: '#9004', files: [COLOR], test: testCell('gradient keeps its stops'), budget: '—', removal: 'gpui-pre takes the orphan upstream' }]), (run) => {
    const out = expectRows(run, [[EMPTY, 'marked', 0]], 'a row whose issue marks no hunk');
    if (run.status === 0) out.push(`a row whose issue (#9004) marks no hunk passes check: ${clip(run.output)}`);
    else if (!naming(run, EMPTY).length) out.push(`a row whose issue marks no hunk fails check without a FAIL line naming it (${EMPTY}): ${clip(run.output)}`);
    return out;
  }));
  return failures;
}

// ---------------------------------------------------------------------------------------------------------------- AC7

/** AC7: a marked 9-line hunk in color.rs (its row raises nothing) fails, naming file, line and size; 8 lines pass. */
export function judgeHunkBudget(script) {
  const failures = clean(script);
  if (failures.length) return failures;
  failures.push(...refuses(script, 'a marked 9-line hunk in color.rs', (box) => box.insert(COLOR, upstreamColor(box, 45), [mark(9001, 'nine'), ...code('NINE', 8)]),
    (run, at) => namingAt(run, COLOR, at).some((line) => /\b9 lines\b/.test(line)), (at) => `${COLOR}:${at} and "9 lines"`));
  failures.push(...accepts(script, 'a marked 8-line hunk in color.rs', (box) => box.insert(COLOR, upstreamColor(box, 45), [mark(9001, 'eight'), ...code('EIGHT', 7)])));
  return failures;
}

/** AC7's Scope: a file with a row passes at 40 added lines and fails at 41, naming the file and the count. */
export function judgeFileBudget(script) {
  const failures = clean(script);
  if (failures.length) return failures;
  // color.rs carries 5 added lines; five 7-line marked hunks make 40, and a 1-line mark more makes 41. Bottom up, so
  // each upstream line is found before anything moves it.
  const forty = (box) => { for (const line of [55, 50, 45, 40, 35]) box.insert(COLOR, upstreamColor(box, line), [mark(9001, `stop ${line}`), ...code(`STOP${line}`, 6)]); };
  failures.push(...accepts(script, 'color.rs with 40 added lines in hunks of at most 8', forty));
  failures.push(...refuses(script, 'color.rs with 41 added lines in hunks of at most 8', (box) => {
    box.insert(COLOR, upstreamColor(box, 58), [mark(9001, 'one line more')]);
    forty(box);
  }, (run) => fails(run).some((line) => line.includes(COLOR) && /\b41\b/.test(line)), `${COLOR} and 41`));
  return failures;
}

// ---------------------------------------------------------------------------------------------------------------- AC8

const MOVED = 'vendor/gpui-pre/src/planted_stops.rs';
/** AC8: a 60-line pure addition fails in color.rs; moved to a new file with a one-line marked `mod` and a row, it passes. */
export function judgeNewFile(script) {
  const failures = clean(script);
  if (failures.length) return failures;
  const body = [mark(9001, 'the stops, moved out'), ...code('MOVED', 59)];
  failures.push(...refuses(script, 'a marked 60-line addition in color.rs', (box) => box.insert(COLOR, upstreamColor(box, 45), body), (run) => naming(run, COLOR).length > 0, COLOR));
  const move = (box) => {
    box.write(MOVED, `${body.join('\n')}\n`);
    box.insert(COLOR, upstreamColor(box, 45), [`mod planted_stops; ${mark(9001, 'the stops live in planted_stops.rs')}`]);
  };
  failures.push(...accepts(script, `the same addition in ${MOVED}, a one-line marked mod in color.rs, and ${MOVED} in the gradient's row`, (box) => {
    move(box);
    box.rows((rows) => { rows[0].files.push(MOVED); });
  }));
  failures.push(...refuses(script, `the moved addition with no row for ${MOVED}`, move, (run) => naming(run, MOVED).length > 0, MOVED));
  return failures;
}

// ---------------------------------------------------------------------------------------------------------------- AC9

/** AC9's lint half: a row that raises a budget gives its reason; a number with no reason fails, naming the row. */
export function judgeReason(script) {
  const failures = clean(script);
  if (failures.length) return failures;
  for (const budget of ['1 over', '1 over:']) {
    failures.push(...refuses(script, `the surface's row with Budget "${budget}"`, (box) => box.rows((rows) => { rows[1].budget = budget; }), (run) => naming(run, SURFACE).length > 0, `the row (${SURFACE})`));
  }
  failures.push(...accepts(script, 'the surface\'s row raised to "2 over: <reason>"', (box) => box.rows((rows) => { rows[1].budget = '2 over: the draw path and its fallback are one branch each'; })));
  return failures;
}

// --------------------------------------------------------------------------------------------------------------- AC10

const secondBranch = (box) => box.insert(RENDERER, lineOf(box, RENDERER, '// upstream renderer line 60'), [mark(9002, 'a second draw branch'), ...code('BRANCH', 8)]);
/** AC10: each row's hunks over budget are printed; a second 9-line hunk in the row that allows 1 fails, naming it, 2 and 1. */
export function judgeOverCount(script) {
  const failures = planted(script, () => null, (run) => [
    ...(passes(run) ? [] : [`the plant as it stands fails check (exit ${run.status}): ${clip(run.output)}`]),
    ...expectRows(run, [[GRADIENT, 'over', 0], [SURFACE, 'over', 1], [SWITCH_ROW, 'over', 0]], 'the plant as it stands'),
  ]);
  if (failures.length) return failures;
  const raised = (run) => naming(run, SURFACE).some((line) => /\b2\b/.test(line.slice(line.indexOf(SURFACE))) && /\b1\b/.test(line.slice(line.indexOf(SURFACE))));
  failures.push(...planted(script, secondBranch, (run) => {
    const out = expectRows(run, [[SURFACE, 'over', 2]], 'with a second 9-line hunk in metal_renderer.rs');
    if (run.status === 0) out.push(`a second 9-line hunk in the surface's row, which allows 1, passes check: ${clip(run.output)}`);
    else if (!raised(run)) out.push(`a second 9-line hunk in the surface's row fails check without a FAIL line naming the row (${SURFACE}), 2 and 1: ${clip(run.output)}`);
    return out;
  }));
  // A row's count can't borrow another row's number.
  failures.push(...refuses(script, 'a second 9-line hunk in the surface\'s row while the gradient\'s row allows 1 it doesn\'t use', (box) => {
    secondBranch(box);
    box.rows((rows) => { rows[0].budget = '1 over: a spare the gradient never uses'; });
  }, raised, `the row (${SURFACE}), 2 and 1`));
  failures.push(...accepts(script, 'the second 9-line hunk with the surface\'s row raised to "2 over: <reason>"', (box) => {
    secondBranch(box);
    box.rows((rows) => { rows[1].budget = '2 over: the draw path and its fallback are one branch each'; });
  }));
  return failures;
}
