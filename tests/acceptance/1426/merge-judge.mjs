// #1426 AC5's judges: `merge` and `diff` on a planted tree and stub releases, with no network.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { clip, linesOf, mark, newRelease, plantTree, refusals, runIn } from './common.mjs';

const COLOR = 'vendor/gpui-pre/src/color.rs';
const CLEAN_HUNK = 'pub const PLANTED_STOP: u8 = 1;';
const OUR_EDIT = 'pub const PLANTED_CONFLICTS: u8 = 1;';
const THEIR_EDIT = '// upstream rewrote color line 50';
const THEIR_FAR_EDIT = '// upstream rewrote color line 5';

const swap = (text, from, to) => text.replace(`${from}\n`, `${to}\n`);

/** A release 0.3.10 that edits a far line of color.rs and, when `conflict`, the line our carried hunk replaces. */
function scene(box, { conflict }) {
  box.write(COLOR, swap(box.read(COLOR), '// upstream color line 50', `${mark(9001, 'conflicts')} ${OUR_EDIT}`));
  newRelease(box, 'gpui-pre', '0.3.9', '0.3.10', (path, text) => {
    if (path === 'src/color.rs') {
      const far = swap(text, '// upstream color line 5', THEIR_FAR_EDIT);
      return conflict ? swap(far, '// upstream color line 50', THEIR_EDIT) : far;
    }
    if (path === 'src/gpui.rs') return swap(text, '// upstream gpui line 7', '// upstream rewrote gpui line 7');
    return text;
  }, { 'src/added_upstream.rs': '// upstream added this file\n' });
}

/** AC5: `merge` keeps the clean hunk, leaves the conflicting one marked, and lists that one alone. */
export function judgeMerge(script) {
  if (!existsSync(script)) return [`no script at ${script}`];
  const box = plantTree();
  try {
    scene(box, { conflict: true });
    const before = box.read('vendor/quickjs-jit-runtime/src/lib.rs');
    const run = runIn(script, box, ['merge', 'gpui-pre', '0.3.10']);
    const failures = [];
    if (run.status !== 1) failures.push(`merge with a conflict ends with exit ${run.status}, not 1: ${clip(run.output)}`);
    const merged = box.read(COLOR);
    const lines = merged.split('\n');
    const open = lines.findIndex((line) => line.startsWith('<<<<<<<'));
    const middle = lines.findIndex((line) => line.startsWith('======='));
    const close = lines.findIndex((line) => line.startsWith('>>>>>>>'));
    const inside = (text) => lines.findIndex((line) => line.includes(text));
    if (!merged.includes(CLEAN_HUNK)) failures.push('the clean carried hunk is gone after merge');
    else if (open >= 0 && inside(CLEAN_HUNK) > open && inside(CLEAN_HUNK) < close) failures.push('the clean carried hunk sits inside conflict markers');
    if (!merged.includes(THEIR_FAR_EDIT)) failures.push("the new release's change away from any hunk isn't in the merged file");
    if (open < 0 || middle < open || close < middle) failures.push(`the conflicting hunk isn't left between conflict markers: ${clip(merged.slice(0, 400))}`);
    else {
      const body = lines.slice(open, close + 1).join('\n');
      if (!body.includes(OUR_EDIT)) failures.push('our side of the conflict is not between the markers');
      if (!body.includes(THEIR_EDIT)) failures.push("the new release's side of the conflict is not between the markers");
      if (lines.filter((line) => line.startsWith('<<<<<<<')).length !== 1) failures.push('merge marks more than the one conflicting hunk');
    }
    const listed = linesOf(run.output, 'CONFLICT');
    if (!listed.some((line) => line === `CONFLICT ${COLOR}:${open + 1}`)) failures.push(`merge doesn't list the conflicting hunk as CONFLICT ${COLOR}:${open + 1}: ${clip(run.output)}`);
    if (listed.length !== 1) failures.push(`merge lists ${listed.length} conflicts, not the one: ${clip(run.output)}`);
    if (!box.read('vendor/gpui-pre/src/gpui.rs').includes('// upstream rewrote gpui line 7')) failures.push('a file we carry nothing in does not take the new release');
    if (!existsSync(join(box.root, 'vendor/gpui-pre/src/added_upstream.rs'))) failures.push("a file the new release adds isn't in the tree after merge");
    if (box.read('vendor/quickjs-jit-runtime/src/lib.rs') !== before) failures.push('merge of gpui-pre changed another vendored crate');
    return failures;
  } finally {
    box.remove();
  }
}

/** AC5: a merge with nothing in conflict exits 0, lists nothing, moves the pin and passes `check` on the new release. */
export function judgeCleanMerge(script) {
  if (!existsSync(script)) return [`no script at ${script}`];
  const box = plantTree();
  try {
    scene(box, { conflict: false });
    const run = runIn(script, box, ['merge', 'gpui-pre', '0.3.10']);
    const failures = [];
    if (run.status !== 0 || linesOf(run.output, 'CONFLICT').length) failures.push(`a merge with no conflict ends with exit ${run.status} or lists one: ${clip(run.output)}`);
    const merged = box.read(COLOR);
    if (!merged.includes(CLEAN_HUNK) || !merged.includes(OUR_EDIT) || !merged.includes(THEIR_FAR_EDIT)) failures.push('a clean merge lost a carried hunk or the new release\'s change');
    if (merged.includes('<<<<<<<')) failures.push('a clean merge left conflict markers');
    if (!/^version = "0\.3\.10"$/m.test(box.read('vendor/gpui-pre/Cargo.toml'))) failures.push('the pin in vendor/gpui-pre/Cargo.toml did not move to 0.3.10');
    const checked = runIn(script, box, ['check']);
    if (checked.status !== 0 || refusals(checked.output).length) failures.push(`check on the merged tree fails (exit ${checked.status}): ${clip(checked.output)}`);
    return failures;
  } finally {
    box.remove();
  }
}

/** Scope: `diff` shows each carried change against the pinned release, and nothing of a file with none. */
export function judgeDiff(script) {
  if (!existsSync(script)) return [`no script at ${script}`];
  const box = plantTree();
  try {
    const run = runIn(script, box, ['diff']);
    const failures = [];
    if (run.status !== 0) failures.push(`diff ends with exit ${run.status}, not 0: ${clip(run.output)}`);
    if (!run.stdout.split('\n').some((line) => line === `+${mark(9001, 'the first stop')}`)) failures.push(`diff doesn't show the carried line as a + line: ${clip(run.output)}`);
    if (!run.stdout.includes(COLOR.replace('vendor/', ''))) failures.push(`diff doesn't name ${COLOR}: ${clip(run.output)}`);
    if (run.stdout.includes('src/app/context.rs')) failures.push('diff shows a file that does not differ from its release');
    return failures;
  } finally {
    box.remove();
  }
}
