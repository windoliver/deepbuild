// #689 AC4 #689.a5c89962: #16 AC2 (the app's socket client through the forwarded socket) passes in the unit lane, its
// cargo run downloading no toolchain into the test's `HOME`.
// Run: node --test tests/acceptance/689-redraft-2047/ac4-app-in-unit-lane.test.mjs   (README.md beside this file; it
// builds deep-app's hub_client test first, which takes minutes to an hour on a cold target folder.)
//
// The real `scripts/preflight` in a fixture (helpers.mjs, fixturePreflight), called as the issue's failing case: with
// RUSTUP_HOME and CARGO_HOME unset and the user's own HOME. Its check workload runs one lane, the unit lane of
// scripts/lanes.mjs, whose command is the unit lane's own one-at-a-time vitest block narrowed to #16's test of the app
// (tests/acceptance/16/address.test.ts, "AC2 the app (#34)"), run at this checkout. The preflight, its check workload,
// the lane runner with its throttle and lease, vitest with the repository's config and setup, #16's test and its own
// temporary HOME all run as they are. First on PATH is a cargo that writes down the HOME, RUSTUP_HOME and CARGO_HOME
// each cargo run was given, passes it to rustup's real cargo unchanged, and once that ends notes whether the run's HOME
// holds a .rustup or .cargo folder. Nothing can download a toolchain: auto-install is off and rustup's servers are a
// closed port, so a run that would have downloaded one fails instead.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { AC4, MINUTE, NODE, ROOT, USER_HOME, childEnv, fixturePreflight, inconclusive, inside, leased, makeBox, pinnedInstalled, records, rustupBin, shown, tail, userCargoHome, userRustupHome, withPath } from './helpers.mjs';

const HOUR = 60 * MINUTE;
const SUITE = 'tests/acceptance/16/address.test.ts';
const TITLE = 'AC2 the app (#34)';
const PATTERN = 'AC2 the app \\(#34\\)';
const APP_RUN = ['test', '-p', 'deep-app', '--test', 'hub_client'];

// The cargo first on PATH: the run as given, then the real cargo, then what the run's HOME holds.
const CARGO = (real, log) => `// #689's recording cargo: passes every run to rustup's cargo unchanged.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
const ran = spawnSync(${JSON.stringify(real)}, args, { stdio: 'inherit' });
const home = process.env.HOME ?? '';
const list = (folder) => (home && existsSync(folder) ? readdirSync(folder) : null);
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, cwd: process.cwd(), HOME: process.env.HOME ?? null, RUSTUP_HOME: process.env.RUSTUP_HOME ?? null, CARGO_HOME: process.env.CARGO_HOME ?? null, status: ran.status, signal: ran.signal, homeRustup: list(join(home, '.rustup')), homeToolchains: list(join(home, '.rustup', 'toolchains')), homeCargo: list(join(home, '.cargo')) }) + '\\n');
process.exit(ran.status ?? 1);
`;
// The unit lane's one-at-a-time vitest block, narrowed to #16's test of the app, with vitest's JSON report kept.
const RUNNER = (report) => `// #689's unit-lane command: #16's test of the app, as the unit lane's one-at-a-time vitest block runs it.
import { spawnSync } from 'node:child_process';
const ran = spawnSync(process.execPath, [${JSON.stringify(join(ROOT, 'node_modules/vitest/vitest.mjs'))}, 'run', '--no-file-parallelism', '--reporter=default', '--reporter=json', ${JSON.stringify(`--outputFile.json=${report}`)}, ${JSON.stringify(SUITE)}, '-t', ${JSON.stringify(PATTERN)}], { cwd: ${JSON.stringify(ROOT)}, stdio: 'inherit' });
process.exitCode = ran.status ?? 1;
`;

test(`${AC4} #16 AC2's app test passes in the unit lane, its cargo run downloading no toolchain into the test's HOME`, { timeout: 6 * HOUR }, (t) => {
  const bin = rustupBin();
  pinnedInstalled();
  for (const needed of ['node_modules/vitest/vitest.mjs', 'packages/cli/dist/main.js']) {
    if (!existsSync(join(ROOT, needed))) inconclusive(`${needed} is missing; install and build the workspaces first (npm ci; npm run build --workspaces)`);
  }
  assert.ok(readFileSync(join(ROOT, SUITE), 'utf8').includes(`it('${TITLE}`), `${SUITE} holds no test "${TITLE}…"`);
  const box = makeBox(t, 'ac4');

  // Not judged: the test's own build of what #16's test runs, with the user's homes, as the preflight warms its builds,
  // so the lane's run isn't a cold build inside #16's 30-minute limit. The lanes build in the checkout's target/.
  const warm = leased(['cargo', ...APP_RUN, '--locked', '--no-run'], {
    cwd: ROOT, env: childEnv({ PATH: withPath(bin), RUSTUP_HOME: userRustupHome(), CARGO_HOME: userCargoHome(), CARGO_TARGET_DIR: undefined }), log: join(box, 'warm.log'), timeout: 4 * HOUR,
  });
  if (warm.error || warm.signal || warm.timedOut) inconclusive(`the build of deep-app's hub_client test didn't finish: ${warm.error?.message ?? warm.signal}. ${tail(warm.out, 1500)}`);
  t.diagnostic(`warm build: exit ${warm.status} after ${(warm.ms / MINUTE).toFixed(1)} min`);

  const stand = join(box, 'bin'), cargoLog = join(box, 'cargo.jsonl'), report = join(box, 'vitest.json'), runner = join(box, 'unit-16.mjs');
  mkdirSync(stand);
  writeFileSync(join(stand, 'cargo.mjs'), CARGO(join(bin, 'cargo'), cargoLog));
  writeFileSync(join(stand, 'cargo'), `#!/bin/sh\nexec ${JSON.stringify(NODE)} ${JSON.stringify(join(stand, 'cargo.mjs'))} "$@"\n`);
  chmodSync(join(stand, 'cargo'), 0o755);
  writeFileSync(runner, RUNNER(report));
  const select = `(all) => all.filter((lane) => lane.name === 'unit').map(({ paths, ...lane }) => ({ ...lane, commands: [[process.execPath, ${JSON.stringify(runner)}]] }))`;
  const env = childEnv({ HOME: USER_HOME, PATH: withPath(stand, dirname(NODE), bin), RUSTUP_HOME: undefined, CARGO_HOME: undefined, CARGO_TARGET_DIR: undefined });
  const ran = fixturePreflight(box, 'unit', { select, env, timeout: 3 * HOUR });

  assert.match(ran.out, /^RUN unit$/m, `the preflight ran no unit lane. ${shown(ran)}`);
  const runs = records(cargoLog).filter(({ args }) => APP_RUN.every((arg) => args.includes(arg)));
  assert.ok(runs.length, `the unit lane made no cargo run of deep-app's hub_client test. ${shown(ran)}`);
  for (const run of runs) {
    const said = `cargo ${run.args.join(' ')} (HOME ${run.HOME}, RUSTUP_HOME ${run.RUSTUP_HOME ?? 'unset'}, CARGO_HOME ${run.CARGO_HOME ?? 'unset'})`;
    assert.ok(run.HOME && resolve(run.HOME) !== resolve(USER_HOME), `${said}: #16's test gave its cargo run no HOME of its own`);
    // rustup and Cargo take an unset or empty home as <HOME>/.rustup and <HOME>/.cargo.
    const rustup = run.RUSTUP_HOME || join(run.HOME, '.rustup'), cargo = run.CARGO_HOME || join(run.HOME, '.cargo');
    assert.ok(!inside(rustup, run.HOME), `${said}: rustup looked for its toolchains inside the test's HOME, at ${rustup}`);
    assert.ok(!inside(cargo, run.HOME), `${said}: Cargo's home was inside the test's HOME, at ${cargo}`);
    assert.equal(run.homeToolchains?.length ?? 0, 0, `${said}: the test's HOME holds toolchains afterwards: ${run.homeToolchains}`);
    assert.equal(run.status, 0, `${said} failed with ${run.signal ?? `exit ${run.status}`}. ${shown(ran)}`);
  }
  assert.ok(existsSync(report), `vitest wrote no report of #16's test. ${shown(ran)}`);
  const tests = JSON.parse(readFileSync(report, 'utf8')).testResults.flatMap(({ assertionResults }) => assertionResults).filter(({ title }) => title.startsWith(TITLE));
  assert.deepEqual(tests.map(({ status }) => status), ['passed'], `#16's "${TITLE}" test didn't pass once in the unit lane. ${shown(ran)}`);
  assert.match(ran.out, /^PASS unit\b/m, `the unit lane didn't PASS. ${shown(ran)}`);
});
