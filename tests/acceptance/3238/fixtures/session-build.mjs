// #3238 AC5's program a session runs, as it runs `node scripts/affected.mjs`: a process of the session's own, under no
// throttle grant, that starts one command through scripts/lease and ends with its status. The command is the world's
// stub, at $T3238_DIR/stub.mjs, so nothing here names it.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const child = spawn(join(root, 'scripts', 'lease'), [process.execPath, join(process.env.T3238_DIR, 'stub.mjs'), 'hub-job'], { stdio: 'inherit' });
child.on('error', (error) => { console.error(String(error)); process.exit(127); });
child.on('exit', (status, signal) => process.exit(signal ? 128 : status));
