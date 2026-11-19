// #1831 AC1, the canvas cost writer: with a planted Mac17,10 fingerprint `benchmarks/canvas.mjs` writes its costs,
// and with a planted Mac14,2 fingerprint it treats the machine as off the list and writes nothing.
// `node benchmarks/canvas.mjs costs --write` runs for real (the release deep-show's `costs` call and, on macOS,
// deep-gpu's passes on this machine's GPU) with a fake `sysctl`, `pmset` and `osascript` first on its PATH. It
// writes crates/deep-canvas/costs.json beside its own file, so it runs from a scratch folder that links to this
// checkout except for a copy of canvas.mjs and a copy of costs.json: the checked-in file is never written.
// Run: node --test tests/acceptance/1831/canvas.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { before, test } from 'node:test';
import { AC1, M2_AIR, M5_MAX, buildEnv, cargoBuild, fakeMachine, root, scratch, show } from './helpers.mjs';

const FILE = 'benchmarks/canvas.mjs';
const COSTS = join('crates', 'deep-canvas', 'costs.json');

// canvas.mjs builds the release deep-show itself; the debug deep-gpu that times the passes on macOS is built here.
let blocked = '';
before(() => { if (process.platform === 'darwin') blocked = cargoBuild('deep-gpu'); }, { timeout: 3_600_000 });

// `to`: a folder whose entries link to `from`'s, but for `own`, the names the caller makes itself.
function linked(from, to, own) {
  mkdirSync(to);
  for (const name of readdirSync(from)) if (!own.includes(name)) symlinkSync(join(from, name), join(to, name));
}

// The scratch copy of the checkout: links, with its own canvas.mjs and costs.json. Its `cargo` builds in the
// checkout, whose target/ the copy links to, so the workspace isn't built again under another path.
function copyOfCheckout(directory) {
  const copy = join(directory, 'checkout');
  linked(root, copy, ['.git', 'target', 'benchmarks', 'crates']);
  symlinkSync(join(root, 'target'), join(copy, 'target'));
  linked(join(root, 'benchmarks'), join(copy, 'benchmarks'), ['canvas.mjs']);
  copyFileSync(join(root, FILE), join(copy, FILE));
  linked(join(root, 'crates'), join(copy, 'crates'), ['deep-canvas']);
  linked(join(root, 'crates', 'deep-canvas'), join(copy, 'crates', 'deep-canvas'), ['costs.json']);
  copyFileSync(join(root, COSTS), join(copy, COSTS));
  const bin = join(directory, 'cargo-bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'cargo'), `#!/bin/sh\nPATH='${buildEnv().PATH}'\ncd '${root}' && exec cargo "$@"\n`);
  chmodSync(join(bin, 'cargo'), 0o755);
  return { copy, cargo: bin };
}

/** `costs --write` in the copy on the machine `mac` describes: the run, and the copy's costs.json after it. */
function writeOn({ copy, cargo }, directory, mac) {
  const env = { ...buildEnv(), PATH: [fakeMachine(directory, mac), cargo, buildEnv().PATH].join(delimiter) };
  const run = spawnSync(process.execPath, [join(copy, FILE), 'costs', '--write'], { cwd: copy, encoding: 'utf8', env, maxBuffer: 1 << 28, timeout: 3_000_000, killSignal: 'SIGKILL' });
  return { run, costs: readFileSync(join(copy, COSTS), 'utf8') };
}

test(`${AC1} \`node benchmarks/canvas.mjs costs --write\` writes its costs on a planted Mac17,10 (M5 Max, 64 GB), and refuses on a planted Mac14,2, leaving the costs as they were`, { timeout: 7_200_000 }, (t) => {
  assert.equal(blocked, '', blocked);
  const directory = scratch(t, 'deep-1831-canvas-');
  const tree = copyOfCheckout(directory);
  const checkedIn = readFileSync(join(root, COSTS), 'utf8');
  try {
    const off = writeOn(tree, directory, M2_AIR);
    assert.notEqual(off.run.status, 0, `${FILE}: on a Mac14,2, off the list, --write fails\n${show(off.run)}`);
    assert.match(off.run.stderr, /Mac14,2|reference Mac/, `${FILE}: on a Mac14,2 it fails because the machine is off the list, and says so\n${show(off.run)}`);
    assert.equal(off.costs, checkedIn, `${FILE}: on a Mac14,2 the costs stay as they were`);

    const on = writeOn(tree, directory, M5_MAX);
    assert.equal(on.run.status, 0, `${FILE} keeps a reference list without the Mac17,10: on the design's third reference Mac --write must write the costs\n${show(on.run)}`);
    const written = JSON.parse(on.costs);
    assert.deepEqual({ model: written.fingerprint?.model, chip: written.fingerprint?.chip, memoryBytes: written.fingerprint?.memoryBytes },
      { model: 'Mac17,10', chip: 'Apple M5 Max', memoryBytes: 64 * 2 ** 30 }, `${FILE}: the costs it wrote carry the Mac17,10's fingerprint: ${on.costs.slice(0, 600)}`);
    assert.ok(Object.keys(written.terms ?? {}).length > 0, `${FILE}: the costs it wrote hold the measured terms: ${on.costs.slice(0, 600)}`);
  } finally {
    assert.equal(readFileSync(join(root, COSTS), 'utf8'), checkedIn, `the checkout's own ${COSTS} was written by this test`);
  }
});
