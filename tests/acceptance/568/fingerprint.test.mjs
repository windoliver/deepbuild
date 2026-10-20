// #568 acceptance: the live `fingerprint()` from scripts/benchmark.mjs, read on this Mac. It
// checks every field against the machine's own tools and doesn't ask which verdict it would get.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { api, FIELDS } from './helpers.mjs';

const read = (command, ...args) => execFileSync(command, args, { encoding: 'utf8' }).trim();

test('the live fingerprint on this Mac has every field, and its macOS build is sw_vers -buildVersion', async () => {
  if (process.platform !== 'darwin') assert.fail('BLOCKED: the live fingerprint is read on macOS');
  const { fingerprint } = await api('fingerprint');
  const live = await fingerprint();
  for (const field of FIELDS) assert.ok(live?.[field] !== undefined && live[field] !== null && live[field] !== '', `missing ${field}: ${JSON.stringify(live)}`);
  assert.equal(live.macosBuild, read('sw_vers', '-buildVersion'));
  assert.equal(live.model, read('sysctl', '-n', 'hw.model'));
  assert.equal(live.chip, read('sysctl', '-n', 'machdep.cpu.brand_string'));
  assert.equal(live.memoryBytes, Number(read('sysctl', '-n', 'hw.memsize')));
  assert.ok(['ac', 'battery'].includes(live.power), `power ${live.power}`);
  assert.equal(live.power, /'AC Power'/.test(read('pmset', '-g', 'ps')) ? 'ac' : 'battery');
  assert.equal(typeof live.lowPowerMode, 'boolean');
  assert.equal(live.lowPowerMode, /lowpowermode\s+1/.test(read('pmset', '-g')));
  assert.ok(['nominal', 'fair', 'serious', 'critical'].includes(live.thermalState), `thermal state ${live.thermalState}`);
});
