// #2698 AC6: "`deep-status-30` and `deep-mcp-30d` each report their own instructions, their peak, the modules they
// loaded, and an empty Node program's instructions from the same rounds."
//
// Each budget's own command (benchmarks/budgets.json) runs once in this checkout, and its last stdout line is read
// through surface.mjs's commandLine. The test's own reading of an empty Node program, by /usr/bin/time -l, says
// what such a program retires on this machine (README: AC6).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { blocked, inconclusive, median, needsBuild, needsMac, runTask, scratch, show, taskCommand } from './support.mjs';
import { INCONCLUSIVE, commandLine } from './surface.mjs';

/** What each task's last line reports today, which the new readings go beside. */
const TODAY = { 'deep-status-30': ['statusMs', 'sessions'], 'deep-mcp-30d': ['statusP95Ms', 'openItemP95Ms', 'searchP95Ms', 'mcpRssMb'] };
/** The entry of the command each task measures: `deep status` and `deep mcp` are both this file run by Node. */
const COMMAND_ENTRY = 'packages/cli/dist/main.js';
const count = (value) => Number.isSafeInteger(value) && value > 0;

/** The instructions an empty Node program retires here: the median of three runs of the task's own `node` on an empty file. */
function emptyProgram(node) {
  const file = join(scratch('deep-2698-empty-'), 'empty.mjs');
  writeFileSync(file, '');
  return median([0, 1, 2].map(() => {
    const timed = spawnSync('/usr/bin/time', ['-l', node, file], { encoding: 'utf8' });
    const counted = Number(timed.stderr?.match(/^\s*(\d+)\s+instructions retired\s*$/m)?.[1]);
    if (!count(counted)) throw blocked(`this Mac's /usr/bin/time -l reports no instructions retired for an empty Node program, so the test has no reading of its own to hold the task's against: ${timed.error?.message ?? timed.stderr}`);
    return counted;
  }));
}

async function judgeCommand(t, id) {
  needsMac();
  needsBuild();
  const [node, bench] = taskCommand(id);
  const floor = emptyProgram(node);
  const run = await runTask(id);
  t.diagnostic(`${show(run)}\nan empty Node program retires ${floor} instructions here by the test's own reading`);
  assert.equal(run.status, 0, `AC6: ${id} failed\n${show(run)}`);
  for (const name of TODAY[id]) assert.ok(Number.isFinite(run.last[name]) && run.last[name] >= 0, `AC6: ${id}'s last line no longer reports ${name}, which it reports today\n${show(run)}`);
  const line = commandLine(id, run.last);
  if (line.status === INCONCLUSIVE) throw inconclusive(`AC6: ${id} itself reads ${INCONCLUSIVE} here, so its readings prove nothing: ${line.reason}`);

  // Its own instructions, and an empty program's from the same rounds: one count each for every round.
  assert.ok(line.instructions.every(count), `AC6: ${id}'s own instructions are not a count for every round: ${JSON.stringify(line.instructions)}\n${show(run)}`);
  assert.ok(line.emptyInstructions.every(count), `AC6: ${id}'s empty Node program's instructions are not a count for every round: ${JSON.stringify(line.emptyInstructions)}\n${show(run)}`);
  assert.equal(line.emptyInstructions.length, line.instructions.length, `AC6: ${id} reports its own instructions for ${line.instructions.length} rounds and an empty Node program's for ${line.emptyInstructions.length}: not the same rounds\n${show(run)}`);
  for (const [round, empty] of line.emptyInstructions.entries()) {
    assert.ok(empty >= floor / 2 && empty <= floor * 2, `AC6: ${id} round ${round + 1}: ${empty} instructions is not an empty Node program's: by the test's own reading one retires ${floor} here, and this is not within half to twice that\n${show(run)}`);
    // `deep status` starts Node, loads the command and asks the hub, each round: more than starting Node alone.
    if (id === 'deep-status-30') assert.ok(line.instructions[round] > empty, `AC6: ${id} round ${round + 1}: the command's own ${line.instructions[round]} instructions are no more than the empty Node program's ${empty} from the same round\n${show(run)}`);
  }

  // Its peak, in bytes: any Node process's is far above 1 MB.
  assert.ok(line.peaks.length > 0 && line.peaks.every((peak) => Number.isFinite(peak) && peak >= 1e6), `AC6: ${id}'s peak is not a Node process's peak in bytes: ${JSON.stringify(line.peaks)}\n${show(run)}`);

  // The modules the command loaded: its own, so its entry is among them and the benchmark's file is not.
  assert.ok(line.modules.length > 0 && line.modules.every((name) => typeof name === 'string' && name), `AC6: ${id}'s modules are not a name for each module the command loaded: ${JSON.stringify(line.modules).slice(0, 400)}\n${show(run)}`);
  assert.ok(line.modules.some((name) => name.endsWith(COMMAND_ENTRY)), `AC6: ${id}'s ${line.modules.length} modules do not hold the command's own entry, ${COMMAND_ENTRY}, so they are not the modules the command loaded\n${show(run)}`);
  assert.ok(!line.modules.some((name) => name.endsWith(bench)), `AC6: ${id}'s modules hold ${bench}: they are the benchmark's own, not the command's\n${show(run)}`);
}

test('#2698 AC6 deep-status-30 reports its own instructions, its peak, the modules it loaded, and an empty Node program\'s instructions from the same rounds', { timeout: 2_400_000 }, (t) => judgeCommand(t, 'deep-status-30'));

test('#2698 AC6 deep-mcp-30d reports its own instructions, its peak, the modules it loaded, and an empty Node program\'s instructions from the same rounds', { timeout: 2_400_000 }, (t) => judgeCommand(t, 'deep-mcp-30d'));
