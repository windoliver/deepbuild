// #2980 criterion 2: on darwin a run's memory, and the memory reserved for each settling held grant, is 8 GiB. With
// one test grant held that is still settling, a second top-level test request under readings of load below the cores
// waits, its command not started, at 16 GiB - 1 byte, and is granted at once at exactly 16 GiB.
import test from 'node:test';
import { GiB } from '../2924/helpers.mjs';
import { secondGranted, secondWaits } from './grants.mjs';

const skip = process.platform !== 'darwin' && 'darwin only: a Mac run budgets 8 GiB';

test('#2980.a86df9c6 on darwin, with one settling test grant held, a second request waits at memory 16 GiB - 1 byte, load 1 on 64 cores', { skip, timeout: 180_000 }, async (t) => {
  await secondWaits(t, { memory: 16 * GiB - 1, load: 1, cores: 64 }, 'at 16 GiB - 1 byte with a settling grant held (8 GiB reserved + 8 GiB a run)');
});

test('#2980.a86df9c6 on darwin, with one settling test grant held, a second request is granted at once at exactly 16 GiB, load 1 on 64 cores', { skip, timeout: 180_000 }, async (t) => {
  await secondGranted(t, { memory: 16 * GiB, load: 1, cores: 64 });
});
