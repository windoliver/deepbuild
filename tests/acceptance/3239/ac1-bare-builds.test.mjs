// #3239 AC1: each of the four scripts starts its cargo builds with the cache's wrapper off, by its own setting. Each
// script runs in a sandbox of its own (helpers.mjs) whose cargo home's config names a wrapper that logs each call. The
// test reads which cargo each wrapper call came from, so a script that sets the variable for one cargo and not the next
// is named at the cargo it missed. Then a cargo build started outside the script, in the same sandbox, must still log:
// the script's silence is its own setting, not a wrapper that stopped logging.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { cargoCalls, compiles, ended, fixture, isBuild, launch, outsideBuild, redact, sandbox, tail, targetOf, unitsIn, wrapperCalls } from './helpers.mjs';

const ID = '#3239.ce662817';
const RUN_MS = 1_200_000;
// What a preflight hands perf: its timed check workload, which passed.
const OBSERVED = JSON.stringify({ status: 0, elapsedMs: 60_000, cpuMs: 60_000, peakBytes: 500_000_000, instructions: null });

// How each script starts on a machine, in the fixture. Each returns the runs it made and where a build started outside
// it then runs.
const LEGS = {
  // benchmark.mjs's own cargos are warm()'s; this starts it with no other script in the process.
  'scripts/benchmark.mjs': async (box, repo) => ({ cwd: repo.root, runs: [await ended(launch(box, [process.execPath, box.warm, join(repo.root, 'scripts/benchmark.mjs'), repo.root], { cwd: repo.root }), RUN_MS)] }),
  // perf as the preflight starts it, with a passing check workload: its merge-base copy, its checks and its task.
  'scripts/perf.mjs': async (box, repo) => ({ cwd: repo.root, runs: [await ended(launch(box, [process.execPath, 'scripts/perf.mjs', OBSERVED], { cwd: repo.root }), RUN_MS)] }),
  // The window as the schedule starts it, through throttle.mjs in a checkout of main: a first window marks main, then
  // one commit lands and the next window measures it against its parent.
  'scripts/budget-window.mjs': async (box, repo) => {
    const mac = repo.clone('mac');
    const window = () => ended(launch(box, [process.execPath, 'scripts/throttle.mjs', 'window', '--wait', '5'], { cwd: mac }), RUN_MS);
    const marked = await window();
    repo.push('A change the window measures', { 'Cargo.toml': `${repo.workspace('Cargo.toml')}# measured by the window\n` });
    const measured = await window();
    return { cwd: mac, runs: [marked, measured] };
  },
  // The local preflight: its warm-up builds, its timed checks, then perf.
  'scripts/preflight.mjs': async (box, repo) => ({ cwd: repo.root, runs: [await ended(launch(box, [process.execPath, 'scripts/preflight.mjs'], { cwd: repo.root }), RUN_MS)] }),
};

async function leg(t, script, start) {
  const box = sandbox(t);
  const repo = fixture(box);
  const { cwd, runs } = await start(box, repo);
  const calls = cargoCalls(box);
  const outside = await outsideBuild(box, cwd);
  return { script, box, runs, calls, outside, wrapper: wrapperCalls(box) };
}

// A variable as the cargo was given it: unset, empty, or its value.
const setting = (value) => (value === 'unset' ? 'unset' : value === '=' ? 'empty' : `set to ${value.slice(1)}`);

const said = (calls) => {
  const units = compiles(calls);
  return `${units.length} compiles (${units.map(({ crate }) => crate).join(', ') || 'none'}) and ${calls.length - units.length} other calls`;
};

/** What a leg shows against AC1: each cargo the script started that ran under the wrapper, and why a silence proves nothing. */
function findings({ script, box, calls, outside, wrapper }) {
  const found = [];
  const say = (text) => found.push(`${script}: ${redact(box, text)}`);
  if (!calls.some(isBuild)) say('started no cargo build, so no build of it shows the wrapper off');
  calls.forEach((call, index) => {
    const logged = wrapper.filter(({ cargo }) => cargo === call.pid);
    if (logged.length) say(`its cargo ${index + 1} of ${calls.length}, \`cargo ${call.args}\` in ${call.cwd} (RUSTC_WRAPPER ${setting(call.wrapper)}, CARGO_BUILD_RUSTC_WRAPPER ${setting(call.buildWrapper)}), ran under the wrapper: ${said(logged)}`);
  });
  const started = new Set([...calls.map(({ pid }) => pid), String(outside.pid)]);
  const stray = wrapper.filter(({ cargo }) => !started.has(cargo));
  if (stray.length) say(`a cargo it started other than through PATH ran under the wrapper: ${said(stray)}`);
  // Each target folder its builds wrote, by the first build that named it; the sandbox starts with none.
  const targets = new Map();
  calls.forEach((call, index) => {
    if (isBuild(call) && !targets.has(targetOf(call))) targets.set(targetOf(call), `cargo ${index + 1} \`cargo ${call.args}\``);
  });
  for (const [target, first] of targets) if (!unitsIn(target)) say(`its ${first} compiled nothing into ${target}, so its silence proves nothing`);
  const outsideCompiles = compiles(wrapper.filter(({ cargo }) => cargo === String(outside.pid)));
  if (outside.status !== 0 || !outsideCompiles.length) say(`a cargo build started outside it afterwards, in the same sandbox, logged ${outsideCompiles.length} compiles (exit ${outside.status}): the wrapper stopped logging, so the script's silence proves nothing`);
  return found;
}

// The wrapper's log for a script, as the issue's Proof asks: each cargo it started, what the wrapper logged from it, the
// units its target folders hold, and the build started outside it afterwards.
// Calls alike (the same arguments, folder and wrapper setting), as a budget task's rounds are, show as one line.
const log = ({ script, box, calls, wrapper, outside }) => {
  const groups = new Map();
  calls.forEach((call, index) => {
    const key = `${call.args}\0${call.cwd}\0${call.wrapper}`;
    if (!groups.has(key)) groups.set(key, { call, at: [] });
    groups.get(key).at.push(index + 1);
  });
  return [
    `${script}: ${calls.length} cargo calls, ${calls.filter(isBuild).length} of them builds; the wrapper logged ${said(wrapper.filter(({ cargo }) => cargo !== String(outside.pid)))} from them`,
    ...[...groups.values()].map(({ call, at }) => {
      const pids = new Set(calls.filter((_, index) => at.includes(index + 1)).map(({ pid }) => pid));
      return redact(box, `  ${at.length > 1 ? `calls ${at[0]}…${at.at(-1)} (${at.length})` : `call ${at[0]}`}: cargo ${call.args} in ${call.cwd}, RUSTC_WRAPPER ${setting(call.wrapper)}: ${said(wrapper.filter(({ cargo }) => pids.has(cargo)))}${isBuild(call) ? `; ${unitsIn(targetOf(call))} units in ${targetOf(call)}` : ''}`);
    }),
    `  then a build outside it (exit ${outside.status}): ${said(wrapper.filter(({ cargo }) => cargo === String(outside.pid)))}`,
  ].join('\n');
};
const shown = (leg) => [log(leg), ...leg.runs.map((run) => tail(leg.box, run))].join('\n');

test(`${ID} AC1 with the test's own cargo home naming a logging wrapper, no build benchmark.mjs, perf.mjs, budget-window.mjs or preflight.mjs starts logs a call, and a build started outside them still does`, { timeout: 3_600_000 }, async (t) => {
  const legs = await Promise.all(Object.entries(LEGS).map(([script, start]) => leg(t, script, start)));
  for (const one of legs) t.diagnostic(log(one));
  const found = legs.flatMap(findings);
  assert.equal(found.length, 0, `a build these scripts started ran under the cargo home's wrapper:\n${found.join('\n')}\n\n${legs.map(shown).join('\n\n')}`);
});
