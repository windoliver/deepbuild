// #2980 AC1: machineReadings(), exported by scripts/throttle.mjs, is the {memory, load, cores} the machine's table
// decides on. On darwin memory is kern.memorystatus_level × hw.memsize / 100 as sysctl reads them at the same time
// (within one percentage point of hw.memsize), not os.freemem(); on Linux it is os.freemem(). load is os.loadavg()[0]
// and cores os.cpus().length. Only the readings are taken: no table is read or written here.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpus, freemem, loadavg } from 'node:os';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { GiB, THROTTLE } from '../2924/helpers.mjs';

const darwin = process.platform === 'darwin';
const linux = process.platform === 'linux';

async function machineReadings() {
  const module = await import(pathToFileURL(THROTTLE).href);
  assert.equal(typeof module.machineReadings, 'function', `scripts/throttle.mjs exports no machineReadings(); it exports: ${Object.keys(module).join(', ')}`);
  return module.machineReadings();
}

/** `sysctl -n kern.memorystatus_level hw.memsize`: the free percentage and the bytes. */
function sysctl() {
  const [level, memsize] = execFileSync('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_level', 'hw.memsize'], { encoding: 'utf8' }).trim().split(/\s+/).map(Number);
  assert.ok(Number.isFinite(level) && Number.isFinite(memsize) && memsize > 0, `sysctl read ${level} ${memsize}`);
  return { level, memsize };
}

const between = (value, a, b, slack = 0) => value >= Math.min(a, b) - slack && value <= Math.max(a, b) + slack;
const gib = (bytes) => `${(bytes / GiB).toFixed(2)} GiB`;

/** One call to machineReadings() bracketed by `read` before and after it. */
async function bracketed(read) {
  const before = { ...read(), load: loadavg()[0] };
  const got = await machineReadings();
  const after = { ...read(), load: loadavg()[0] };
  return { before, got, after };
}

test('#2980.AC1 on darwin, machineReadings().memory is kern.memorystatus_level × hw.memsize / 100 as sysctl reads them at the same time, not os.freemem()', { skip: darwin ? false : `darwin only; this is ${process.platform}` }, async () => {
  const { before, got, after } = await bracketed(() => ({ ...sysctl(), freemem: freemem() }));
  assert.equal(typeof got?.memory, 'number', `machineReadings() returned ${JSON.stringify(got)}`);
  assert.equal(before.memsize, after.memsize);
  const onePoint = before.memsize / 100;
  const expected = [before.level, after.level].map((level) => (level * before.memsize) / 100);
  assert.ok(between(got.memory, ...expected, onePoint),
    `memory ${got.memory} (${gib(got.memory)}) isn't kern.memorystatus_level ${before.level}..${after.level}% × hw.memsize ${before.memsize} / 100 (${gib(expected[0])}..${gib(expected[1])}) within one point (${gib(onePoint)}); os.freemem() read ${gib(before.freemem)}..${gib(after.freemem)}`);
});

test('#2980.AC1 on Linux, machineReadings().memory is os.freemem()', { skip: linux ? false : `Linux only; this is ${process.platform}` }, async () => {
  const { before, got, after } = await bracketed(() => ({ freemem: freemem() }));
  assert.equal(typeof got?.memory, 'number', `machineReadings() returned ${JSON.stringify(got)}`);
  // MemAvailable moves between reads; 64 MiB of slack around the bracket allows for that, not for another reading.
  assert.ok(between(got.memory, before.freemem, after.freemem, 64 * 2 ** 20),
    `memory ${got.memory} (${gib(got.memory)}) isn't os.freemem(), read ${before.freemem}..${after.freemem}`);
});

test('#2980.AC1 machineReadings().load is os.loadavg()[0] and cores is os.cpus().length', async () => {
  const { before, got, after } = await bracketed(() => ({}));
  assert.equal(typeof got?.load, 'number', `machineReadings() returned ${JSON.stringify(got)}`);
  assert.ok(between(got.load, before.load, after.load, 0.01), `load ${got.load} isn't os.loadavg()[0], read ${before.load}..${after.load}`);
  assert.equal(got.cores, cpus().length, `cores ${got.cores} isn't os.cpus().length ${cpus().length}`);
});
