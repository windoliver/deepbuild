// The #2569 suite's starter: it starts the bench as #1477's own tests do (tests/acceptance/1477/helpers.ts, `oneLine`
// and `measure`: spawnSync from the checkout's root, pipes for its output, a SIGKILL timeout), and waits for it. The
// test kills this process by its PID while the bench runs, as a test run that dies does, and reads the process table
// for what it left.
//
//   node starter.mjs <cwd> <bench> <args...>
import { spawnSync } from 'node:child_process';

const [cwd, bench, ...args] = process.argv.slice(2);
const run = spawnSync(bench, args, { cwd, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 900_000, killSignal: 'SIGKILL' });
process.stdout.write(run.stdout ?? '');
process.exitCode = run.status ?? 1;
