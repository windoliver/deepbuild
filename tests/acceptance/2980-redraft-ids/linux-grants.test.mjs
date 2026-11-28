import test from 'node:test';
import { GiB } from '../2924/helpers.mjs';
import { secondGranted, secondWaits } from './grants.mjs';

const skip = process.platform !== 'linux' && 'Linux only: a Spark run budgets 24 GiB';

test('#2980.bc75bb06 on Linux, with one settling test grant held, a second request waits at memory 48 GiB - 1 byte, load 1 on 64 cores', { skip, timeout: 180_000 }, async (t) => {
  await secondWaits(t, { memory: 48 * GiB - 1, load: 1, cores: 64 }, 'at 48 GiB - 1 byte with a settling grant held (24 GiB reserved + 24 GiB a run)');
});

test('#2980.bc75bb06 on Linux, with one settling test grant held, a second request is granted at once at exactly 48 GiB, load 1 on 64 cores', { skip, timeout: 180_000 }, async (t) => {
  await secondGranted(t, { memory: 48 * GiB, load: 1, cores: 64 });
});
