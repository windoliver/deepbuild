// #3299, the third criterion: a planted build script that watches the whole crates/deep-app folder, as main does,
// fails the first criterion, naming the rerun cargo gives for it. README.md beside this file says what it reads.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { BUILD_SCRIPT, ROOT, firstCriterion, keeping } from './helpers.mjs';

const AC3 = 'AC3 #3299.acbee1fc';

/** The checkout's own build script with one line planted first in `main`: a watch on the whole crates/deep-app folder. */
const WATCH = '\n    println!("cargo:rerun-if-changed={}", std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().expect("a crate sits in crates/").join("deep-app").display()); // #3299\'s planted watch\n';

test(`${AC3}: a build script that watches the whole crates/deep-app folder fails the first criterion, naming cargo's rerun for it`, () => {
  const { failures } = keeping([BUILD_SCRIPT], () => {
    const source = readFileSync(join(ROOT, BUILD_SCRIPT), 'utf8');
    const at = source.indexOf('fn main() {');
    if (at < 0) throw new Error(`${BUILD_SCRIPT} has no \`fn main() {\` to plant the watch in`);
    const end = at + 'fn main() {'.length;
    writeFileSync(join(ROOT, BUILD_SCRIPT), `${source.slice(0, end)}${WATCH}${source.slice(end)}`);
    return firstCriterion();
  });
  const all = [...failures.writing, ...failures.deleting, ...failures.digest];
  assert.ok(all.length > 0, 'with the planted watch, the first criterion holds');
  assert.match(failures.writing.join('\n'), /stale: changed "[^"]*\/crates\/deep-app"/, `with the planted watch, writing the panel files fails the first criterion but names no rerun of crates/deep-app: ${failures.writing.join('\n')}`);
});
