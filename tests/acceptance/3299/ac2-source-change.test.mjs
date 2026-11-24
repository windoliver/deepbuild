// #3299, the second criterion: after a build of deep-show, a change to a committed source file of a crate it digests
// (one canvas module's src/lib.rs, and one file of crates/deep-app) runs deep-show's build script again on the next
// build and gives another source digest. README.md beside this file says what each test reads.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APP_FILE, MODULE_FILE, build, change, keeping, scriptRan, warm } from './helpers.mjs';

const AC2 = 'AC2 #3299.57c89932';

/** A build, a change to `path`'s committed bytes, a build: what the second build did. `path` is put back after. */
function changed(path, line) {
  return keeping([path], () => {
    warm();
    const before = build();
    change(path, line);
    const after = build();
    return { before, after, ran: scriptRan(before, after) };
  });
}

for (const [path, line] of [
  [MODULE_FILE, '\n// #3299 acceptance: a change to this module\'s committed source.\n'],
  [APP_FILE, '\n// #3299 acceptance: a change to this panel\'s committed source.\n'],
]) {
  test(`${AC2}: a change to ${path} runs deep-show's build script again and gives another source digest`, () => {
    const { before, after, ran } = changed(path, line);
    assert.ok(ran, `after a change to ${path}, the next build of deep-show did not run its build script; cargo's reasons: ${after.reasons.join(' | ') || 'none logged'}`);
    assert.ok(before.digest, `deep-show's build script hands the binary no DEEP_SOURCE_DIGEST (${before.output})`);
    assert.notEqual(after.digest, before.digest, `after a change to ${path}, the source digest is still ${before.digest}`);
  });
}
