// A spec check's test in #3220's sample repos (README, The fixture repo), copied in as test/<name>.mjs beside
// test/<name>.json, `{"mib": n, "hold_ms": n}`, and run by the spec's `node --test test/<name>.mjs`. One node:test test:
// it writes `S <ms>` to stdout, allocates <mib> MiB in 1 MiB buffers of random bytes (resident, not compressible),
// holds them for <hold_ms>, writes `E <ms>`, and passes. It reads nothing but its own two files under test/, so its run
// reads none of the code under test (#1018: such a run's key never carries, and every claim runs it).
import { randomFillSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const { mib, hold_ms: hold } = JSON.parse(readFileSync(self.replace(/\.mjs$/, '.json'), 'utf8'));

test(`${basename(self)} holds ${mib} MiB`, async () => {
  process.stdout.write(`S ${Date.now()}\n`);
  const held = [];
  for (let i = 0; i < mib; i++) held.push(randomFillSync(Buffer.allocUnsafeSlow(1024 * 1024)));
  await new Promise((resolve) => setTimeout(resolve, hold));
  process.stdout.write(`E ${Date.now()} ${held.length}\n`);
});
