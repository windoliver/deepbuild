// #2149 AC1 #2149.715a06c4: `cargo fmt --all -- --check` exits 0 on main.
// Run: node --test tests/acceptance/2149/ac1-fmt-check.test.mjs   (README.md beside this file; one to three minutes)
//
// The issue's command at the checkout's root, with the toolchain the checkout's rust-toolchain.toml pins, under the
// checkout's lease script at a lower priority; its exit code is held to 0. "Main" is the checkout the test runs in.
// Nothing is installed: a toolchain or rustfmt that isn't there, or a run the machine stopped, reads INCONCLUSIVE.
import assert from 'node:assert/strict';
import { join, relative } from 'node:path';
import test from 'node:test';
import { MINUTE, ROOT, cargo, childEnv, makeBox, rustfmtAnswers, shown, world } from './helpers.mjs';

// The criterion's tag: `#2149.<first 8 hex digits of the SHA-256 of its text, trimmed, white space collapsed>`.
const AC1 = 'AC1 #2149.715a06c4';

test(`${AC1} \`cargo fmt --all -- --check\` exits 0 at the checkout's root`, { timeout: 30 * MINUTE }, (t) => {
  const box = makeBox(t, 'ac1');
  rustfmtAnswers(ROOT, box, 'checkout');
  const ran = cargo(['fmt', '--all', '--', '--check'], { cwd: ROOT, env: childEnv(), log: join(box, 'fmt.log') });
  world('cargo fmt --all -- --check', ran);
  const hunks = [...ran.out.matchAll(/^Diff in (.+?):(\d+):?$/gm)].map(([, file, line]) => `${relative(ROOT, file)}:${line}`);
  const files = [...new Set(hunks.map((hunk) => hunk.replace(/:\d+$/, '')))];
  assert.equal(ran.status, 0, `cargo fmt --all -- --check fails at the checkout's root${hunks.length ? `: ${hunks.length} hunks in ${files.length} files, ${files.slice(0, 40).join(', ')}` : ''}. ${shown(ran).split(`${ROOT}/`).join('')}`);
});
