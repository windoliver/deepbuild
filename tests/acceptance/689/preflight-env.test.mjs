// Criterion 3: the preflight's check workload runs with RUSTUP_HOME and CARGO_HOME set to the user's
// ~/.rustup and ~/.cargo when the caller left them unset, and with the caller's own values when set.
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { laneCommands, stubbedPreflight } from './helpers.mjs';

function assertEveryLaneSaw(run, expected) {
  for (const command of laneCommands)
    assert.ok(run.lanes.some((record) => record.command.startsWith(command)), `no lane ran ${command}; preflight printed:\n${run.output}`);
  // Each command by its first two words, with the homes it was started with.
  const line = (command, homes) => `${command.split(' ').slice(0, 2).join(' ')}: RUSTUP_HOME=${homes.RUSTUP_HOME} CARGO_HOME=${homes.CARGO_HOME}`;
  assert.deepEqual(run.lanes.map((record) => line(record.command, record)), run.lanes.map(({ command }) => line(command, expected)),
    `the lanes' commands ran with other homes than ${JSON.stringify(expected)}`);
}

test("criterion 3: with RUSTUP_HOME and CARGO_HOME unset, every lane's commands get the user's ~/.rustup and ~/.cargo", (t) => {
  const run = stubbedPreflight(t)({});
  assertEveryLaneSaw(run, { RUSTUP_HOME: join(homedir(), '.rustup'), CARGO_HOME: join(homedir(), '.cargo') });
});

test("criterion 3: with RUSTUP_HOME and CARGO_HOME set, every lane's commands get the caller's own values", (t) => {
  const homes = { RUSTUP_HOME: '/opt/caller-689/rustup', CARGO_HOME: '/opt/caller-689/cargo' };
  const run = stubbedPreflight(t)(homes);
  assertEveryLaneSaw(run, homes);
});
