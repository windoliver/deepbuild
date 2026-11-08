// #1426.fdfd6785's judges: `merge` onto a stub new release that applies cleanly runs the rows' tests on the merged
// tree, and moves the pin only when they pass. Each answers its failures, one line each; an empty list means the
// script met the criterion. The rows' tests are the plant's node --test file (common.mjs): the gradient's reads
// upstream's color line 5, which one stub release rewrites far from any carried hunk. No network, no gpui build.
import { existsSync } from 'node:fs';
import { clip, COLOR, linesOf, newRelease, plantTree, runIn } from './common.mjs';

const MANIFEST = 'vendor/gpui-pre/Cargo.toml';
const FAILING = 'gradient keeps its stops';
const PASSING = ['surface keeps its alpha', 'switch denies the engine'];
const pinOf = (box) => /^version = "([^"]+)"$/m.exec(box.read(MANIFEST))?.[1];
const swap = (text, from, to) => text.replace(`${from}\n`, `${to}\n`);
/** A line saying the test fails, not a line passing it. */
const failing = (output, name) => output.split('\n').some((line) => line.includes(name) && /\b(?:FAIL|fail|fails|failed|failing|not ok)\b/i.test(line) && !/^(?:PASS|ok)\b/.test(line.trim()));

/**
 * gpui-pre 0.3.10: rewrites gpui.rs line 7 and color.rs line `colorLine`, each far from a carried hunk, so the merge
 * is clean. Line 5 breaks the gradient's test; line 20 breaks none.
 */
function scene(colorLine) {
  const box = plantTree();
  newRelease(box, 'gpui-pre', '0.3.9', '0.3.10', (path, text) => {
    if (path === 'src/color.rs') return swap(text, `// upstream color line ${colorLine}`, `// upstream rewrote color line ${colorLine}`);
    if (path === 'src/gpui.rs') return swap(text, '// upstream gpui line 7', '// upstream rewrote gpui line 7');
    return text;
  });
  return box;
}

/** The criterion: a clean merge while the gradient row's test fails leaves the pin at 0.3.9 and names that test alone. */
export function judgePinHeld(script) {
  if (!existsSync(script)) return [`no script at ${script}`];
  const box = scene(5);
  try {
    const run = runIn(script, box, ['merge', 'gpui-pre', '0.3.10']);
    const failures = [];
    if (linesOf(run.output, 'CONFLICT').length || box.read(COLOR).includes('<<<<<<<')) failures.push(`the stub merge is clean, yet merge lists a conflict or leaves markers: ${clip(run.output)}`);
    if (pinOf(box) !== '0.3.9') failures.push(`the pin moved to ${pinOf(box)} though the row's test "${FAILING}" fails on the merged tree: ${clip(run.output)}`);
    if (run.status === 0) failures.push(`merge exits 0 with the pin left for a failing test: ${clip(run.output)}`);
    if (!failing(run.output, FAILING)) failures.push(`merge doesn't name the failing test "${FAILING}" as failing: ${clip(run.output)}`);
    for (const name of PASSING) if (failing(run.output, name)) failures.push(`merge names the passing test "${name}" as failing: ${clip(run.output)}`);
    return failures;
  } finally {
    box.remove();
  }
}

/** The control: the same clean merge with every row's test passing moves the pin to 0.3.10 and names no failing test. */
export function judgePinMoves(script) {
  if (!existsSync(script)) return [`no script at ${script}`];
  const box = scene(20);
  try {
    const run = runIn(script, box, ['merge', 'gpui-pre', '0.3.10']);
    const failures = [];
    if (run.status !== 0) failures.push(`a clean merge whose rows' tests pass exits ${run.status}: ${clip(run.output)}`);
    if (pinOf(box) !== '0.3.10') failures.push(`a clean merge whose rows' tests pass leaves the pin at ${pinOf(box)}: ${clip(run.output)}`);
    if (!box.read(COLOR).includes('// upstream rewrote color line 20')) failures.push("the moved pin's tree lacks the new release's change");
    for (const name of [FAILING, ...PASSING]) if (failing(run.output, name)) failures.push(`merge names the passing test "${name}" as failing: ${clip(run.output)}`);
    return failures;
  } finally {
    box.remove();
  }
}
