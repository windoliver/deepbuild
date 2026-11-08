// #1426.5f9ac1c5's judges: `merge gpui-pre 0.3.10` onto a stub new release (common.mjs) keeps a clean carried hunk and
// leaves a conflicting one between conflict markers, listing it as `CONFLICT <path>:<line>`. With the Scope, `diff`
// prints our change against the release. Each answers its failures, one line each; an empty list means the script met
// the criterion. No network, no gpui build.
import { existsSync } from 'node:fs';
import { clip, COLOR, linesOf, newRelease, passes, plantTree, runIn } from './common.mjs';

const MANIFEST = 'vendor/gpui-pre/Cargo.toml';
const UPSTREAM_ADDED = '// upstream added after color line 28';
const REWRITTEN = '// upstream rewrote color line 50';
const OTHERS = ['vendor/gpui-pre-apple/src/metal_renderer.rs', 'vendor/quickjs-jit-runtime/src/lib.rs'];
const pinOf = (box) => /^version = "([^"]+)"$/m.exec(box.read(MANIFEST))?.[1];

/**
 * gpui-pre 0.3.10. Ours carries two hunks in color.rs: `PLANTED_STOP` after upstream line 10 and `PLANTED_END`,
 * `PLANTED_MID` after upstream line 28. The release rewrites line 50, far from both, and, when `conflict`, adds a line
 * of its own after line 28, where our second hunk sits.
 */
function scene(conflict) {
  const box = plantTree();
  newRelease(box, 'gpui-pre', '0.3.9', '0.3.10', (path, text) => {
    if (path !== 'src/color.rs') return text;
    let next = text.replace('// upstream color line 50\n', `${REWRITTEN}\n`);
    if (conflict) next = next.replace('// upstream color line 28\n', `// upstream color line 28\n${UPSTREAM_ADDED}\n`);
    return next;
  });
  return box;
}

/** The conflict blocks of a file's text: each `{ at, ours, theirs }`, `at` being the `<<<<<<<` line, 1-based. */
function blocks(text) {
  const found = [];
  let open = null;
  text.split('\n').forEach((line, index) => {
    if (line.startsWith('<<<<<<<')) open = { at: index + 1, lines: [] };
    else if (open && line.startsWith('>>>>>>>')) { found.push({ at: open.at, body: open.lines.join('\n') }); open = null; }
    else if (open) open.lines.push(line);
  });
  return found;
}

/** The criterion: the clean hunk stays, the far change lands, the conflicting hunk is marked with both sides, and listed alone. */
export function judgeMergeConflict(script) {
  if (!existsSync(script)) return [`no script at ${script}`];
  const box = scene(true);
  try {
    const others = Object.fromEntries(OTHERS.map((path) => [path, box.read(path)]));
    const run = runIn(script, box, ['merge', 'gpui-pre', '0.3.10']);
    const failures = [];
    const text = box.read(COLOR);
    const found = blocks(text);
    const outside = found.reduce((rest, block) => rest.replace(block.body, ''), text);
    if (run.status === 0) failures.push(`merge exits 0 with a conflict left in ${COLOR}: ${clip(run.output)}`);
    if (!outside.includes('pub const PLANTED_STOP: u8 = 1;') || !outside.includes('DeepBuild patch (windoliver/deepbuild#9001): the first stop')) failures.push(`the clean carried hunk (PLANTED_STOP and its mark) isn't in the merged ${COLOR} outside the conflict markers`);
    if (!text.includes(REWRITTEN) || text.includes('// upstream color line 50\n')) failures.push(`the new release's rewrite of line 50, far from any carried hunk, didn't land in ${COLOR}`);
    const conflict = found.find((block) => block.body.includes('PLANTED_END') && block.body.includes(UPSTREAM_ADDED));
    if (!conflict) failures.push(`the conflicting hunk isn't left between conflict markers holding both our PLANTED_END and the release's added line: ${found.length} block(s) in ${COLOR}`);
    const listed = linesOf(run.output, 'CONFLICT');
    const names = (line, at) => new RegExp(`${COLOR.replace(/[.]/g, '\\.')}:${at}(?!\\d)`).test(line);
    if (conflict && !listed.some((line) => names(line, conflict.at))) failures.push(`merge doesn't list the conflict as CONFLICT ${COLOR}:${conflict.at}: ${clip(run.output)}`);
    if (listed.length !== found.length || listed.some((line) => !found.some((block) => names(line, block.at)))) failures.push(`merge lists ${listed.length} CONFLICT line(s), not the ${found.length} conflict(s) it left: ${listed.join(' | ') || '(none)'}`);
    for (const path of OTHERS) if (box.read(path) !== others[path]) failures.push(`merge gpui-pre changed ${path}, another tree`);
    return failures;
  } finally {
    box.remove();
  }
}

/** A merge with no conflict: exit 0, the pin moves, both carried hunks stay with their marks, and `check` passes it. */
export function judgeMergeClean(script) {
  if (!existsSync(script)) return [`no script at ${script}`];
  const box = scene(false);
  try {
    const run = runIn(script, box, ['merge', 'gpui-pre', '0.3.10']);
    const failures = [];
    const text = box.read(COLOR);
    if (run.status !== 0) failures.push(`a merge with no conflict exits ${run.status}: ${clip(run.output)}`);
    if (linesOf(run.output, 'CONFLICT').length || text.includes('<<<<<<<')) failures.push(`a merge with no conflict lists a conflict or leaves markers: ${clip(run.output)}`);
    if (pinOf(box) !== '0.3.10') failures.push(`a merge with no conflict, whose rows' tests pass, leaves the pin at ${pinOf(box)}`);
    for (const line of ['pub const PLANTED_STOP: u8 = 1;', 'pub const PLANTED_END: u8 = 2;', REWRITTEN]) if (!text.includes(line)) failures.push(`the merged ${COLOR} lacks "${line}"`);
    const after = runIn(script, box, ['check']);
    if (!passes(after)) failures.push(`check fails the merged tree against gpui-pre 0.3.10 (exit ${after.status}): ${clip(after.output)}`);
    return failures;
  } finally {
    box.remove();
  }
}

/** Scope, `diff`: our carried lines against the release, exit 0, and no file that doesn't differ. */
export function judgeDiff(script) {
  if (!existsSync(script)) return [`no script at ${script}`];
  const box = plantTree();
  try {
    const run = runIn(script, box, ['diff']);
    const failures = [];
    if (run.status !== 0) failures.push(`diff exits ${run.status}: ${clip(run.output)}`);
    if (!run.stdout.split('\n').some((line) => line === '+pub const PLANTED_STOP: u8 = 1;')) failures.push(`diff doesn't show color.rs's carried line as "+pub const PLANTED_STOP: u8 = 1;": ${clip(run.output)}`);
    if (!run.stdout.includes('color.rs') || !run.stdout.includes('metal_renderer.rs') || !run.stdout.includes('quickjs-jit-runtime/src/lib.rs')) failures.push(`diff doesn't name each changed file (color.rs, metal_renderer.rs, quickjs-jit-runtime/src/lib.rs): ${clip(run.output)}`);
    for (const same of ['app/context.rs', 'src/gpui.rs', 'LineBreakTest.txt']) if (run.stdout.includes(same)) failures.push(`diff names ${same}, which doesn't differ from its release`);
    return failures;
  } finally {
    box.remove();
  }
}
