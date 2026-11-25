// #3172: a custom harness's own `<name>: INCONCLUSIVE; <reason>` line explains its failing exit only when it ran
// nothing: a target that reported a test, or that went on after the line, still reads FAIL.
import assert from 'node:assert/strict';
import test from 'node:test';
import { cargoResults } from '../scripts/lanes.mjs';

const target = '-p replica --test card_size';
const workspace = [{ targets: [{ key: 'card_size card_size.rs', rerun: target }] }];
const run = (...lines) => cargoResults([
  '     Running card_size.rs (target/debug/deps/card_size-0123456789abcdef)',
  ...lines,
  `error: test failed, to rerun pass \`${target}\``,
  '',
  'Caused by:',
  '  process didn\'t exit successfully: `card_size-0123456789abcdef` (exit status: 101)',
].join('\n'), 101, workspace).failures.map(({ id, state }) => `${state} ${id}`);

test('a harness that panics after its INCONCLUSIVE line reads FAIL: the line explains no later failure', () => {
  assert.deepEqual(run(
    'card_size: INCONCLUSIVE; the replica draws on macOS only, so nothing ran',
    'thread \'main\' panicked at card_size.rs:20:5:',
    'assertion failed: drawn',
  ), [`FAIL cargo ${target}`]);
});

test('a harness that reported a test before its INCONCLUSIVE line reads FAIL: it ran something', () => {
  assert.deepEqual(run(
    'test drawn ... ok',
    'card_size: INCONCLUSIVE; the replica draws on macOS only, so nothing ran',
  ), [`FAIL cargo ${target}`]);
});

test('a harness whose last line is its BLOCKED line, after a blank one, reads BLOCKED', () => {
  assert.deepEqual(run('card_size: BLOCKED; no window server', ''), [`BLOCKED cargo ${target}`]);
});
