// #3562 AC4: `node docs/spikes/3539/reply-hold.mjs --runs 20` on the change reads 20 of 20 for each stop: its
// `turnEnded` returned while its checks waited, and the four runs started in the order they asked. Its output on the
// merge base (0 of 20, and 0 of 20) is kept beside it.
//
// The script is run here, 20 runs, with the `--out <file>` its usage asks for at the base, into a temporary folder
// (README, Open points), and its output read by reply-hold-reading.mjs: an agent's word, or a kept file alone, is no
// reading of the change. Then the two kept outputs, side by side in the spike's own folder: the change's, which must
// read as the run does, and the merge base's, which must hold 20 runs and read 0 of 20, and 0 of 20. The script
// starts no hub; it loads the checkout's packages from their sources, which read two files a build writes.
//
//   node --test tests/acceptance/3562/reply-hold.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { problems, RUNS } from './reply-hold-reading.mjs';

const AC4 = 'AC4 #3562.a7231f2c';
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = 'docs/spikes/3539/reply-hold.mjs';
/** The kept outputs (README, Surfaces): the change's, and beside it the merge base's, where #3539 kept the script's output. */
const KEPT_CHANGE = 'docs/spikes/3539/out/reply-hold.change.json';
const KEPT_BASE = 'docs/spikes/3539/out/reply-hold.json';
/** The two files the packages' sources read that a build writes (docs/spikes/3539/README.md, How to run). */
const BUILT = ['packages/evidence/dist/patterns.json', 'packages/record/dist/versions.json'];

/** A kept output read from the checkout: its JSON, or a failure naming the file. */
function kept(path, what) {
  assert.ok(existsSync(join(REPO, path)), `${path} is not there: ${what} must be kept in the spike's folder`);
  let output;
  try { output = JSON.parse(readFileSync(join(REPO, path), 'utf8')); } catch (error) { assert.fail(`${path} is not JSON: ${error.message}`); }
  return output;
}

test(`${AC4} node ${SCRIPT} --runs ${RUNS} reads ${RUNS} of ${RUNS} for each stop (its turnEnded returned while its checks waited) and ${RUNS} of ${RUNS} for the four runs starting in the order they asked; its output on the merge base (0 of ${RUNS}, and 0 of ${RUNS}) is kept beside it`, { timeout: 900_000 }, () => {
  assert.ok(existsSync(join(REPO, SCRIPT)), `${SCRIPT} is not in this checkout, so \`node ${SCRIPT} --runs ${RUNS}\` reads nothing: the change brings the spike's folder`);
  for (const path of BUILT) if (!existsSync(join(REPO, path))) throw Error(`BLOCKED: ${path} is not built: run npm run build --workspaces, or the two commands under How to run in docs/spikes/3539/README.md`);
  const dir = mkdtempSync(join(tmpdir(), 'dh3562-'));
  try {
    const out = join(dir, 'reply-hold.json');
    const command = `node ${SCRIPT} --runs ${RUNS} --out <file>`;
    // The child is this test's own: past the bound it is stopped by its PID, and the test fails, naming the command.
    const ran = spawnSync(process.execPath, [SCRIPT, '--runs', String(RUNS), '--out', out], { cwd: REPO, encoding: 'utf8', timeout: 600_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 });
    const said = `stdout ${JSON.stringify((ran.stdout ?? '').slice(-600))}, stderr ${JSON.stringify((ran.stderr ?? '').slice(-1500))}`;
    assert.equal(ran.error?.message, undefined, `\`${command}\` did not run to its end within 600 s (${ran.signal ?? 'no signal'}): ${said}`);
    assert.equal(ran.status, 0, `\`${command}\` must exit 0; it exited ${ran.status}: ${said}`);
    assert.ok(existsSync(out), `\`${command}\` exited 0 and wrote no output to its --out file: ${said}`);
    let output;
    try { output = JSON.parse(readFileSync(out, 'utf8')); } catch (error) { assert.fail(`\`${command}\` wrote an output that is not JSON: ${error.message}`); }
    console.log(`AC4 \`${command}\`: runs ${output.runs}; other_turn_end_returned_while_its_second_check_waited ${output.other_turn_end_returned_while_its_second_check_waited}; person_turn_end_returned_while_its_checks_waited ${output.person_turn_end_returned_while_its_checks_waited}; started_as_asked ${output.started_as_asked}; started_orders ${JSON.stringify(output.started_orders)}`);
    assert.deepEqual(problems(output, RUNS), [], `\`${command}\` on this checkout must read ${RUNS} of ${RUNS} for each stop and for the order`);

    // Kept: the change's output, and beside it the merge base's.
    assert.deepEqual(problems(kept(KEPT_CHANGE, "the script's output on the change"), RUNS), [], `${KEPT_CHANGE}, the script's kept output on the change, must read ${RUNS} of ${RUNS} for each stop and for the order`);
    assert.deepEqual(problems(kept(KEPT_BASE, "the script's output on the merge base"), 0), [], `${KEPT_BASE}, the script's output on the merge base kept beside ${KEPT_CHANGE}, must hold ${RUNS} runs and read 0 of ${RUNS} for each stop, and 0 of ${RUNS} for the order`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
