// #2980 criterion 1: `machineReadings()`, exported by scripts/throttle.mjs, is the {memory, load, cores} the machine's
// table decides on. On darwin its memory is kern.memorystatus_level x hw.memsize / 100 as sysctl reads them at the same
// time (within one percentage point of hw.memsize), not os.freemem(); on Linux it is os.freemem(). Its load is
// os.loadavg()[0] and its cores os.cpus().length. Each value is bracketed by readings taken just before and just after
// the call, so a value that moves while the call runs still lands in range. Importing the script runs nothing: its CLI
// runs only when it is node's main script. A missing export fails at an assertion, never at the import.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpus, freemem, loadavg } from 'node:os';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { THROTTLE } from '../2924/helpers.mjs';

const throttle = await import(pathToFileURL(THROTTLE).href);
const sysctl = (name) => Number(execFileSync('/usr/sbin/sysctl', ['-n', name], { encoding: 'utf8' }).trim());

/** Calls machineReadings() between two calls of `around`; returns the readings and both sides. */
async function bracketed(around) {
  assert.equal(typeof throttle.machineReadings, 'function', `scripts/throttle.mjs exports no machineReadings function; its exports: ${Object.keys(throttle).join(', ')}`);
  const before = around();
  const readings = await throttle.machineReadings();
  const after = around();
  assert.equal(typeof readings, 'object', `machineReadings() returned ${JSON.stringify(readings)}`);
  assert.notEqual(readings, null, 'machineReadings() returned null');
  return { readings, before, after };
}

test('#2980.a3bd16e8 on darwin, machineReadings().memory is kern.memorystatus_level x hw.memsize / 100 as sysctl reads them, not os.freemem()', { skip: process.platform !== 'darwin' && 'darwin only: the Mac reads kern.memorystatus_level' }, async () => {
  const memsize = sysctl('hw.memsize');
  assert.ok(memsize > 0, `sysctl hw.memsize read ${memsize}`);
  const { readings, before, after } = await bracketed(() => ({ level: sysctl('kern.memorystatus_level'), free: freemem() }));
  const low = (Math.min(before.level, after.level) - 1) * memsize / 100;
  const high = (Math.max(before.level, after.level) + 1) * memsize / 100;
  const said = `memory ${readings.memory} bytes (${(readings.memory / 2 ** 30).toFixed(2)} GiB); kern.memorystatus_level ${before.level} then ${after.level}, hw.memsize ${memsize}, so ${(low / 2 ** 30).toFixed(2)}-${(high / 2 ** 30).toFixed(2)} GiB; os.freemem() ${before.free} then ${after.free}`;
  assert.equal(typeof readings.memory, 'number', said);
  assert.ok(readings.memory >= low && readings.memory <= high, `machineReadings().memory isn't kern.memorystatus_level x hw.memsize / 100 within one percentage point: ${said}`);
});

test('#2980.a3bd16e8 on Linux, machineReadings().memory is os.freemem()', { skip: process.platform !== 'linux' && 'Linux only: Linux reads os.freemem() (MemAvailable)' }, async () => {
  // MemAvailable moves while anything runs; 64 MiB of slack around the two reads, far below any other reading's gap.
  const slack = 64 * 2 ** 20;
  const { readings, before, after } = await bracketed(() => freemem());
  const said = `memory ${readings.memory}; os.freemem() ${before} then ${after}`;
  assert.equal(typeof readings.memory, 'number', said);
  assert.ok(readings.memory >= Math.min(before, after) - slack && readings.memory <= Math.max(before, after) + slack, `machineReadings().memory isn't os.freemem(): ${said}`);
});

test('#2980.a3bd16e8 machineReadings().load is os.loadavg()[0] and cores is os.cpus().length', async () => {
  const { readings, before, after } = await bracketed(() => loadavg()[0]);
  assert.equal(typeof readings.load, 'number', JSON.stringify(readings));
  assert.ok(readings.load >= Math.min(before, after) && readings.load <= Math.max(before, after), `machineReadings().load ${readings.load} isn't os.loadavg()[0] (${before} then ${after})`);
  assert.equal(readings.cores, cpus().length, `machineReadings().cores isn't os.cpus().length`);
});
