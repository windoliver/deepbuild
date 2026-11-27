// Helpers for #3580's acceptance tests (README). They reuse #2744's sandbox (a table folder of the test's own through
// DEEP_THROTTLE_TABLE, a temporary HOME, stub commands that note their start and hold until told, every process group
// stopped by its PID after the test), #2902's reads of the sandbox's table.json, and #2833's reading of the test limit
// from scripts/throttle.mjs's LIMITS line; none of them is edited. The machine's ~/.deepbuild/throttle/ is never read
// or written. Nothing here imports the code under test: throttle.mjs is run as a process.
import assert from 'node:assert/strict';
import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dump, running, sandbox, startOf, throttle } from '../2744/helpers.mjs';
import { requestOf, until } from '../2902/helpers.mjs';

export const GiB = 2 ** 30;
// The issue's readings: the Spark at 04:26Z, load 25 on 20 cores with 100 GiB available, then the load dropping to 10.
export const LOADED = { load: 25, cores: 20, memory: 100 * GiB };
export const EASED = { load: 10, cores: 20, memory: 100 * GiB };
// A positive step waits on the stub's start note or the table; this bounds it on a machine under load.
export const GRANT_MS = 60_000;
// A negative ("keeps waiting") needs time: 3 s is about 15 of the throttle's 200 ms polls.
export const WAIT_MS = 3_000;

/**
 * #2744's sandbox with the readings a test's own table decides by (DEEP_THROTTLE_READINGS, section 6), written
 * whole, and DEEP_THROTTLE_RUN unset, so only a request this suite marks is a run's.
 */
export function box3580(t, value = LOADED) {
  const box = sandbox(t);
  delete box.env.DEEP_THROTTLE_RUN;
  delete box.env.DEEP_THROTTLE_READINGS;
  box.readings = join(box.dir, 'readings.json');
  setReadings(box, value);
  box.env.DEEP_THROTTLE_READINGS = box.readings;
  return box;
}
/** Rewrites the readings file; every look of every request reads it again. */
export function setReadings(box, value) {
  writeFileSync(`${box.readings}.tmp`, JSON.stringify(value));
  renameSync(`${box.readings}.tmp`, box.readings);
}

/**
 * A request: `node scripts/throttle.mjs <cls> --wait 10 -- node stub.mjs <name>`, holding its grant until finished.
 * With `run`, it is a run's request as affected.mjs makes it, `DEEP_THROTTLE_RUN=0` (no disk asked).
 */
export function ask(box, name, { cls = 'test', run = false } = {}) {
  if (run) box.env.DEEP_THROTTLE_RUN = '0';
  try {
    return throttle(box, [cls, '--wait', '10'], name);
  } finally {
    delete box.env.DEEP_THROTTLE_RUN;
  }
}

/** Waits until `child`'s request is in the table (or it was granted or ended), and asserts it waits there. */
export async function queued(box, child, ...context) {
  await until(async () => (await requestOf(box, child.pid)) || startOf(box, child.label) || !running(child), GRANT_MS);
  const request = await requestOf(box, child.pid);
  assert.ok(request && running(child) && !startOf(box, child.label), `${child.label} never waited in the table's line\n${dump(box, child, ...context)}`);
  return request;
}

/** Waits until `child`'s stub starts or `ms` pass; returns its start note, or undefined. */
export async function grantWithin(box, child, ms) {
  await until(async () => startOf(box, child.label) || !running(child), ms);
  return startOf(box, child.label);
}

/** Whether a log entry names a request or grant, by its pid (a number) or its ID (a string holding it), at any depth. */
export function names(entry, { pid, id }) {
  const walk = (value) => {
    if (typeof value === 'number') return value === pid;
    if (typeof value === 'string') return value === String(pid) || (typeof id === 'string' && id.length > 0 && value.includes(id));
    if (value && typeof value === 'object') return Object.values(value).some(walk);
    return false;
  };
  return walk(entry);
}
