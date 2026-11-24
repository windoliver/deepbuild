// Loaded first into every node process of a scene (NODE_OPTIONS, helpers.mjs): the machine the scene runs on. Its load
// reads 0, since a top-level timed request waits for a load below the cores, whatever readings a test's table has, and
// the machines this suite runs on are busy. And a job the scene says is refused asks the scene's other table, which
// another holder has for itself, with no wait: the throttle's own refusal, without the 30 minutes.
import { existsSync, readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import { join } from 'node:path';

os.loadavg = () => [0, 0, 0];
syncBuiltinESMExports();

const refused = join(process.env.T3296_STATE ?? '', 'refuse');
if (/\/scripts\/throttle\.mjs$/.test(process.argv[1] ?? '') && process.argv.includes('--') && existsSync(refused)) {
  const words = readFileSync(refused, 'utf8').split('\n').filter(Boolean);
  if (words.some((word) => process.argv.some((arg) => arg.includes(word)))) {
    process.env.DEEP_THROTTLE_TABLE = process.env.T3296_BUSY;
    delete process.env.DEEP_THROTTLE;
    const wait = process.argv.indexOf('--wait');
    if (wait > 0 && wait < process.argv.indexOf('--')) process.argv[wait + 1] = '0';
  }
}
