import assert from 'node:assert/strict';
import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dump, running, sandbox, startOf, throttle } from '../2744/helpers.mjs';
import { requestOf, until } from '../2902/helpers.mjs';

export const GiB = 2 ** 30;
export const LOADED = { load: 25, cores: 20, memory: 100 * GiB };
export const EASED = { load: 10, cores: 20, memory: 100 * GiB };
export const GRANT_MS = 60_000;
export const WAIT_MS = 3_000;

export function box3580(t, value = LOADED) {
  const box = sandbox(t);
  delete box.env.DEEP_THROTTLE_RUN;
  delete box.env.DEEP_THROTTLE_READINGS;
  box.readings = join(box.dir, 'readings.json');
  setReadings(box, value);
  box.env.DEEP_THROTTLE_READINGS = box.readings;
  return box;
}
export function setReadings(box, value) {
  writeFileSync(`${box.readings}.tmp`, JSON.stringify(value));
  renameSync(`${box.readings}.tmp`, box.readings);
}

export function ask(box, name, { cls = 'test', run = false } = {}) {
  if (run) box.env.DEEP_THROTTLE_RUN = '0';
  try {
    return throttle(box, [cls, '--wait', '10'], name);
  } finally {
    delete box.env.DEEP_THROTTLE_RUN;
  }
}

export async function queued(box, child, ...context) {
  await until(async () => (await requestOf(box, child.pid)) || startOf(box, child.label) || !running(child), GRANT_MS);
  const request = await requestOf(box, child.pid);
  assert.ok(request && running(child) && !startOf(box, child.label), `${child.label} never waited in the table's line\n${dump(box, child, ...context)}`);
  return request;
}

export async function grantWithin(box, child, ms) {
  await until(async () => startOf(box, child.label) || !running(child), ms);
  return startOf(box, child.label);
}

export function names(entry, { pid, id }) {
  const walk = (value) => {
    if (typeof value === 'number') return value === pid;
    if (typeof value === 'string') return value === String(pid) || (typeof id === 'string' && id.length > 0 && value.includes(id));
    if (value && typeof value === 'object') return Object.values(value).some(walk);
    return false;
  };
  return walk(entry);
}
