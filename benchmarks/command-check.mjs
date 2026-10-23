// What counting tests costs a command check, for the perf lane's budgets (issue #30): node
// benchmarks/command-check.mjs. One process opens a record, the asks core and the supervisor in a temp folder,
// writes a Vitest project of 200 tests (its dependencies cloned from the repo's), and runs `vitest run` in it
// through the supervisor's sandbox 10 times as the command check kind (runCommandCheck: its reporter, and reading
// back its report, read trace and output) and 10 times as a plain run, interleaved. The plain run has the kind's
// hermetic environment and the same loaders but asks for no report and reads nothing back, so the difference is the
// counting alone. It prints the median of each as one JSON line; the issue's 1% stays in
// tests/acceptance/30/budgets.test.ts.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openAsks } from '../packages/asks/dist/index.js';
import { runCommandCheck } from '../packages/checks-command/dist/index.js';
import { CHECK_RUNTIME } from '../packages/conformance/dist/index.js';
import { openRecord } from '../packages/record/dist/index.js';
import { openSupervisor } from '../packages/supervisor/dist/index.js';

const ROUNDS = 10;
const TESTS = 200;
const REPO = fileURLToPath(new URL('../', import.meta.url));
const RUNTIME = join(REPO, 'packages/checks-command/runtime');
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-command-bench-')));
const project = join(dir, 'project');
mkdirSync(join(project, 'test'), { recursive: true });
writeFileSync(join(project, 'package.json'), '{ "name": "bench", "private": true, "type": "module" }\n');
const tests = Array.from({ length: TESTS }, (_, i) => `test('adds ${i}', () => {\n  expect(${i} + 1).toBe(${i + 1});\n});\n`).join('\n');
writeFileSync(join(project, 'test/sum.test.ts'), `import { expect, test } from 'vitest';\n\n${tests}`);
execFileSync('/bin/cp', ['-cR', join(REPO, 'node_modules'), join(project, 'node_modules')]);
const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 172_800_000 } } } });
/** One run of the suite through the supervisor, its time in ms; `counted` runs it as the command check kind. */
async function run(i, counted) {
  const handle = `run:BENCH${String(i + 1).padStart(4, '0')}${counted ? 'C' : 'P'}`;
  if (counted) {
    const t0 = performance.now();
    const r = await runCommandCheck({
      host: sup, run: handle, checkout: project, deadline: 600_000,
      spec: { kind: 'command', runner: 'node_modules/.bin/vitest run', inputs: [], depth: 'unit', oracle: 'code', contract: null },
    });
    const ms = performance.now() - t0;
    await sup.cleanup(handle);
    if (r.outcome !== 'passed' || r.testsRun !== TESTS) throw Error(`${handle} ended ${r.outcome} with ${r.testsRun} tests`);
    return ms;
  }
  // Timed from its folders' making to their removal, as the kind's run is.
  const t0 = performance.now();
  const work = join(dir, `run-${i}`);
  mkdirSync(join(work, 'home'), { recursive: true });
  mkdirSync(join(work, 'bin'));
  for (const tool of ['node', 'npm', 'npx']) symlinkSync(realpathSync(join(dirname(process.execPath), tool)), join(work, 'bin', tool));
  const env = {
    LANG: 'en_US.UTF-8', TZ: 'UTC', PATH: [join(work, 'bin'), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'), HOME: join(work, 'home'), TMPDIR: work,
    NO_COLOR: '1', DO_NOT_TRACK: '1', DEEP_CHECK_READS: join(work, 'reads.txt'), DEEP_CHECK_SPAWNS: join(work, 'spawns.jsonl'),
    NODE_OPTIONS: `--import=${join(RUNTIME, 'preload.mjs')} --import=${join(CHECK_RUNTIME, 'tracer.mjs')} --test-reporter=spec --test-reporter-destination=stdout --test-reporter=${join(CHECK_RUNTIME, 'reporter.mjs')} --test-reporter-destination=${join(work, 'report.jsonl')}`,
  };
  const started = await sup.start({
    run: handle, argv: ['/bin/sh', '-c', 'node_modules/.bin/vitest run'], cwd: project, env, inherit: false,
    grant: { read: [dirname(dirname(process.execPath)), CHECK_RUNTIME, RUNTIME], write: [project, work] },
  });
  if (started.status !== 'started') throw Error(`${handle} didn't start: ${JSON.stringify(started)}`);
  const exit = await sup.wait(handle);
  await sup.signal(handle, 'SIGKILL');
  // The kind removes its run's temp folder before it returns; so does the plain run.
  rmSync(work, { recursive: true, force: true });
  const ms = performance.now() - t0;
  await sup.cleanup(handle);
  if (exit.code !== 0) throw Error(`${handle} exited ${exit.code}`);
  return ms;
}
try {
  await run(-1, true);
  const checked = [];
  const plain = [];
  for (let i = 0; i < ROUNDS; i++) {
    checked.push(await run(i, true));
    plain.push(await run(i, false));
  }
  console.log(JSON.stringify({ checkMs: median(checked), plainMs: median(plain) }));
} finally {
  await sup.close();
  await record.close();
  rmSync(dir, { recursive: true, force: true });
}
