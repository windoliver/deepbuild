// #210's budget task: the criterion's own timed file, run once (tests/acceptance/210/ac8-budgets.test.ts).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = spawnSync('npx', ['vitest', 'run', '--root', 'tests/acceptance/210', '--testTimeout=7200000', 'ac8-budgets.test.ts'], { cwd: root, stdio: 'inherit' });
process.exit(run.status ?? 1);
