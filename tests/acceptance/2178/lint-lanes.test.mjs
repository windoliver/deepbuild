// Acceptance tests for #2178, written blind at base 96a56e88 from the issue, the design and the base (README.md).
// Each runs the command the criterion names on this checkout.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const run = (script) => {
  const env = { ...process.env };
  delete env.DEEP_OPEN_ISSUES; // read the open issues as they are now, not an earlier run's copy
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', env, maxBuffer: 256 * 1024 * 1024 });
  assert.equal(result.error, undefined, String(result.error));
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
};

test('#2178.0caa17d8 `node scripts/repo-rules.mjs` exits 0 on main, with no FAIL deps line', () => {
  const { status, output } = run('scripts/repo-rules.mjs');
  assert.doesNotMatch(output, /^FAIL deps: /m, output);
  assert.deepEqual(output.split('\n').filter((line) => /^(FAIL|INVALID|BLOCKED|INCONCLUSIVE) /.test(line)), [], output);
  assert.equal(status, 0, output);
  assert.match(output, /^PASS deps: /m, output);
});

test('#2178.746911e1 `node scripts/public-text.mjs` reads the open issues and finds no listed name in one', () => {
  const { output } = run('scripts/public-text.mjs');
  // Unread issues are never a pass: the lane must have read them, whatever it found in the change itself.
  assert.doesNotMatch(output, /^INCONCLUSIVE |the open issues were not read/m, output);
  assert.doesNotMatch(output, /^ {2}#\d+:\d+ "/m, output);
  const summary = output.match(/^public text: .* and (\d+) open issues name no studied product$/m) ?? output.match(/^FAIL \d+ studied names in public text \(\d+ in the change, (0) in open issues\)$/m);
  assert.ok(summary, output);
  if (summary[0].startsWith('public text')) assert.ok(Number(summary[1]) > 0, `no open issue was read\n${output}`);
});
