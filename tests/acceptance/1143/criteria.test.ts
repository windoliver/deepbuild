// #1143's three commands, run as the criteria name them on this checkout, and judged by what they print.
// They read the checkout and write nothing in it, except cargo's own build cache under target/.
import { expect, test } from 'vitest';
import { AC, blocked, deepCanvasTargets, eventsTest, inconclusive, judgeClippy, repoRoot, repoRules, run, tail } from './helpers.ts';

const MINUTE = 60_000;

test(`AC1 ${AC[1]} node scripts/repo-rules.mjs on the checkout prints no FAIL line for secrets, deps or cards, and passes each of them`, () => {
  const { lines, output } = repoRules(repoRoot);
  const fails = lines.filter((line) => /^FAIL (secrets|deps|cards):/.test(line));
  expect(fails, 'the FAIL lines repo-rules prints for secrets, deps and cards').toEqual([]);
  // No FAIL line is not enough: a check that couldn't run reads INVALID or BLOCKED, and one that printed nothing proves nothing.
  for (const check of ['secrets', 'deps', 'cards']) {
    if (lines.some((line) => line.startsWith(`PASS ${check}:`))) continue;
    const other = lines.filter((line) => new RegExp(`^(INVALID|BLOCKED) ${check}:`).test(line));
    throw blocked(`repo-rules printed no PASS line for ${check}${other.length ? `: ${other.join('; ')}` : ''}\n${tail(output)}`);
  }
}, 5 * MINUTE);

test(`AC2 ${AC[2]} vitest run packages/contracts/test/events.test.ts passes on the checkout`, () => {
  const { status, assertions, output } = eventsTest(repoRoot);
  const failed = assertions.filter((a) => a.status !== 'passed');
  expect(failed.map((a) => `${a.fullName} (${a.status}): ${a.failureMessages.join(' ').split('\n')[0]}`), 'the tests in events.test.ts that did not pass').toEqual([]);
  expect(assertions.length, 'events.test.ts ran no tests').toBeGreaterThan(0);
  expect(status, `vitest exited ${status}:\n${tail(output)}`).toBe(0);
}, 5 * MINUTE);

test(`AC3 ${AC[3]} cargo clippy --workspace --all-targets --locked -- -D warnings reports no result_large_err in crates/deep-canvas`, () => {
  const { manifest, targets } = deepCanvasTargets(repoRoot);
  // The criterion's command, with clippy's messages as JSON so each one's lint and crate can be read, and --keep-going so
  // a crate that fails to build on this platform (deep-app's macOS-only dependencies, on Linux) doesn't stop cargo
  // before it lints deep-canvas. Neither changes what clippy reports for deep-canvas.
  const args = ['clippy', '--workspace', '--all-targets', '--locked', '--keep-going', '--message-format=json', '--', '-D', 'warnings'];
  const result = run('cargo', args, repoRoot, 90 * MINUTE);
  if (result.error) throw blocked(`cargo clippy could not run: ${result.error.message}`);
  const { largeErr, unchecked } = judgeClippy(result.stdout, manifest, targets);
  expect(largeErr, 'the result_large_err clippy reports in crates/deep-canvas').toEqual([]);
  if (unchecked.length) throw inconclusive(`clippy didn't lint every deep-canvas target, so a result_large_err there can't be ruled out:\n${unchecked.join('\n')}\n${tail(result.stderr, 15)}`);
}, 100 * MINUTE);
