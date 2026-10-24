// #569 criteria 8 and 9, wiring only: the proof lanes (`node scripts/proof.mjs [--release] [lane ...]`) run in this
// repo's preflight. The local preflight (`npm run preflight`) runs proof.mjs once with no mode; the release preflight
// (`npm run release:check`, its environment read from that script) runs it once with `--release` and never without.
// The full preflight takes 10-25 minutes and isn't run: scripts/checks.mjs, the lane runner scripts/preflight.mjs
// calls, runs in a child process whose spawnSync only records each lane command (git still runs, read-only, so
// path-gated lanes gate as they would). Nothing is written into this checkout.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const PROOF = 'scripts/proof.mjs';

// Preloaded into the child: every spawnSync but git's prints its command and reports success.
const recorder = `
const cp = process.getBuiltinModule('node:child_process');
const { syncBuiltinESMExports } = process.getBuiltinModule('node:module');
const real = cp.spawnSync;
cp.spawnSync = (command, args = [], options) => {
  if (command === 'git') return real(command, args, options);
  process.stdout.write('SPAWN ' + JSON.stringify([command, ...args]) + '\\n');
  return { status: 0, signal: null, stdout: '', stderr: '', output: [] };
};
syncBuiltinESMExports();`;

/** The proof.mjs invocations the preflight's lanes would make, each as the arguments after the script. */
function proofRuns(env) {
  const r = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(recorder)}`, 'scripts/checks.mjs'],
    { cwd: root, env, encoding: 'utf8', maxBuffer: 2 ** 26 });
  const spawned = r.stdout.split('\n').filter((l) => l.startsWith('SPAWN ')).map((l) => JSON.parse(l.slice(6)));
  assert.ok(spawned.length > 0, `the lanes ran no command at all:\n${r.stdout}\n${r.stderr}`);
  return spawned.flatMap((argv) => {
    const at = argv.findIndex((a, i) => i > 0 && (a === PROOF || a.endsWith(`/${PROOF}`)));
    return at < 0 ? [] : [argv.slice(at + 1)];
  });
}
const { DEEP_PREFLIGHT, ...localEnv } = process.env;
const { scripts } = JSON.parse(readFileSync(new URL('package.json', `file://${root}`), 'utf8'));
/** An npm script's leading `KEY=value` assignments, once the rest is checked to be `scripts/preflight`. */
function preflightEnv(name) {
  const words = scripts[name]?.trim().split(/\s+/) ?? [];
  const assigned = words.filter((w) => /^[A-Z_][A-Z0-9_]*=/.test(w));
  assert.deepEqual(words.slice(assigned.length).map((w) => w.replace(/^\.\//, '')), ['scripts/preflight'], `npm run ${name}`);
  assert.match(readFileSync(new URL('scripts/preflight.mjs', `file://${root}`), 'utf8'), /scripts\/checks\.mjs/,
    'the preflight runs its lanes through scripts/checks.mjs');
  return Object.fromEntries(assigned.map((w) => [w.slice(0, w.indexOf('=')), w.slice(w.indexOf('=') + 1)]));
}

test('#569.f7197598 the local preflight (npm run preflight) runs scripts/proof.mjs exactly once, with no mode', () => {
  const env = preflightEnv('preflight');
  assert.deepEqual(env, {}, 'the local preflight sets no release mode');
  assert.deepEqual(proofRuns(localEnv), [[]], `expected one run of ${PROOF} with no arguments`);
});

test('#569.60ea8a8b #569.f7197598 the release preflight (npm run release:check) runs scripts/proof.mjs exactly once, with --release, and never without', () => {
  const env = preflightEnv('release:check');
  assert.equal(env.DEEP_PREFLIGHT, 'release', 'release:check is the base\'s release preflight');
  const runs = proofRuns({ ...localEnv, ...env });
  assert.deepEqual(runs.filter((args) => !args.includes('--release')), [], `${PROOF} without --release at release`);
  assert.deepEqual(runs, [['--release']], `expected one run of ${PROOF} --release, with no lane names`);
});
