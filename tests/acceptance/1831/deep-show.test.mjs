// #1831 AC1, deep-show: with a planted Mac17,10 fingerprint it scales by 1.0, and with a planted Mac14,2
// fingerprint it treats the machine as off the list.
// Through `deep-show run`, as #379's tests drive it: the scenario's `machine` is the fingerprint of the machine the
// hub runs on, and under the planted check `estimates_on_this_machine` (the one place deep-show scales by its
// machine) a board over its class is refused with an estimate from the reference coefficients times the machine's
// factor. A factor of 1.0 gives the refusal a Mac15,7 gets, byte for byte.
// Run: node --test tests/acceptance/1831/deep-show.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, test } from 'node:test';
import { AC1, M2_AIR, M3_PRO, M5_MAX, cargoBuild, root, scratch, show } from './helpers.mjs';

const FILE = 'crates/deep-show/src/hub.rs';
const DOC = '01JB183100000000000000001A';

let blocked = '';
before(() => { blocked = cargoBuild('deep-show'); }, { timeout: 3_600_000 });

/** Five zigzag paths in a core view whose frame caps the document tightens to 0.001 ms, so any estimate is over. */
function board() {
  const items = {};
  [4000, 3000, 2000, 20, 10].forEach((segments, i) => {
    let d = `M0 ${40 + i * 120}`;
    for (let k = 1; k <= segments; k++) d += ` L${((k * 1200) / segments).toFixed(2)} ${40 + i * 120 + (k % 2 ? 20 : 0)}`;
    items[`path-${i}`] = { id: `path-${i}`, kind: 'path@1', name: `Path ${i}`, order: `a${i}`, params: { d, paint: { stroke: { role: 'ink', width: 2 } } } };
  });
  return { format: 1, profile: 'board', title: 'Five paths', description: 'Five zigzag paths of 4,000, 3,000, 2,000, 20 and 10 segments.', size: [1280, 720],
    budget: { class: 'core_view', frame_cpu_ms: 0.001, frame_gpu_ms: 0.001 }, items };
}

/** The over_budget issue deep-show's planted check raises for the board on a hub whose machine is `mac`. */
function refusalOn(bin, directory, { model, chip, memoryGb }) {
  const scenario = {
    evidence: join(directory, `evidence-${model}`), planted: 'estimates_on_this_machine', machine: { model, chip, memoryBytes: memoryGb * 2 ** 30 },
    sessions: { 'sess-alpha': { thread: 'thread-alpha', name: 'Claude Code: charts', process: { pid: 4100, start: 1000 } } },
    panels: { main: { rect: [0, 0, 1280, 720] } }, docs: { [DOC]: { panel: 'main' } },
    calls: [{ call: 'deep_show', session: 'sess-alpha', doc: DOC, document: board(), include: ['issues'] }],
  };
  const run = spawnSync(bin, ['run'], { cwd: root, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1 << 30, timeout: 1_800_000, killSignal: 'SIGKILL' });
  assert.equal(run.status, 0, `deep-show run exits 0 on a ${model}\n${show(run)}`);
  const reply = JSON.parse(run.stdout.trim().split('\n')[0]).replies?.[0];
  const over = (reply?.issues ?? []).filter((issue) => issue.code === 'over_budget');
  assert.equal(over.length, 1, `on a ${model} the board over its class is refused with one over_budget issue: ${JSON.stringify(reply).slice(0, 1500)}`);
  assert.ok(over[0].actual?.cpu_ms > 0, `on a ${model} the refusal carries its estimate: ${JSON.stringify(over[0]).slice(0, 1500)}`);
  return over[0];
}

test(`${AC1} deep-show scales its estimate by 1.0 on a planted Mac17,10, the refusal a Mac15,7 gets, and by another factor on a planted Mac14,2`, { timeout: 3_600_000 }, (t) => {
  assert.equal(blocked, '', blocked);
  const directory = scratch(t, 'deep-1831-show-');
  // Out of target/, where another build may replace it mid-run.
  const bin = join(directory, 'deep-show');
  copyFileSync(join(root, 'target', 'debug', 'deep-show'), bin);

  const reference = refusalOn(bin, directory, M3_PRO);
  const off = refusalOn(bin, directory, M2_AIR);
  assert.notDeepEqual(off.actual, reference.actual, `${FILE}: a Mac14,2 is off the list, so its estimate is scaled away from the reference Mac's: ${JSON.stringify(off.actual)}`);

  const on = refusalOn(bin, directory, M5_MAX);
  t.diagnostic(JSON.stringify({ 'Mac15,7': reference.actual, 'Mac17,10': on.actual, 'Mac14,2': off.actual }));
  assert.deepEqual(on, reference, `${FILE} keeps a reference list without the Mac17,10: the design's third reference Mac must scale by 1.0, the refusal a Mac15,7 gets (cpu_ms ${reference.actual.cpu_ms}), and got cpu_ms ${on.actual.cpu_ms}, ${(on.actual.cpu_ms / reference.actual.cpu_ms).toFixed(2)} times it`);
});
