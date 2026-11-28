import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NODE, alive, arm, assert, deep, hello, holding, hubPid, hubRuns, sandbox as firstDraftSandbox, shown, until } from '../2570/helpers.mjs';
import { exiting } from '../2570-redraft-ac1/scene.mjs';

const PRELOAD = fileURLToPath(new URL('./fixtures/closes-stop.mjs', import.meta.url));
const WRAPPER = fileURLToPath(new URL('./fixtures/confirm-in-definition.mjs', import.meta.url));
const SLOW_STOP = fileURLToPath(new URL('../2570-redraft-ac1/fixtures/slow-stop.mjs', import.meta.url));
const q = (s) => JSON.stringify(s);

export function confirming(box, preloadInDefinition) {
  const stub = join(box.dir, 'you-confirm');
  writeFileSync(stub, 'confirmed\n');
  const path = join(box.dir, 'bin', 'confirming-launcher');
  const preload = preloadInDefinition ? pathToFileURL(PRELOAD).href : '';
  writeFileSync(path, `#!/bin/sh\nT2570R5_LAUNCHER=${q(box.env.DEEP_HUB_LAUNCHER)} T2570R5_CONFIRM=${q(stub)} T2570R5_PRELOAD=${q(preload)} exec ${q(NODE)} ${q(WRAPPER)} "$@"\n`);
  chmodSync(path, 0o755);
  box.env.DEEP_HUB_LAUNCHER = path;
  return box;
}

export function sandbox(t, kind, hold = 'fifo') {
  const box = firstDraftSandbox(t, kind);
  const first = hold === 'slow' ? `--import=${SLOW_STOP}` : box.env.NODE_OPTIONS;
  box.env.NODE_OPTIONS = `${first} --import=${PRELOAD}`;
  box.hubLog = kind === 'dev' ? box.log : join(box.launchd, 'job.log');
  return confirming(box, false);
}

export async function stopHub(box) {
  const run = await deep(box, ['hub', 'stop', ...box.flags]);
  assert.equal(run.status, 0, `the scene's own step, deep hub stop${box.kind === 'dev' ? ' --root' : ''}, failed: ${shown(run)}`);
}

export async function exitingHub(box) {
  arm(box);
  const first = await deep(box, ['hub', 'start', ...box.flags]);
  assert.equal(first.status, 0, `the scene's own step: the first hub didn't start: ${shown(first)}`);
  const old = await hubPid(box);
  assert.ok(Number.isSafeInteger(old), "the scene's own step: deep hub status didn't name the first hub's pid");
  assert.ok(hubRuns(box).some((e) => e.event === 'run' && e.pid === old), `the scene's own step: the hold isn't loaded in the first hub (pid ${old})`);
  await stopHub(box);
  const held = await until(() => holding(box), 60_000);
  assert.ok(held, `the scene's own step: the stopped hub (pid ${old}) didn't reach its exit within 60 s`);
  assert.equal(held.pid, old, "the scene's own step: the hub held at its exit isn't the one that was stopped");
  assert.ok(alive(old), `the scene's own step: the stopped hub (pid ${old}) must still be running while held`);
  assert.equal(await hello(box), undefined, "the scene's own step: the stopped hub must no longer answer on its socket");
  return old;
}

export async function slowExitingHub(box) {
  const first = await deep(box, ['hub', 'start', ...box.flags]);
  assert.equal(first.status, 0, `the scene's own step: the first hub didn't start: ${shown(first)}`);
  const old = await hubPid(box);
  assert.ok(Number.isSafeInteger(old), "the scene's own step: deep hub status didn't name the first hub's pid");
  writeFileSync(join(box.hold, 'arm'), '');
  assert.ok(hubRuns(box).some((e) => e.event === 'run' && e.pid === old), `the scene's own step: the hold isn't loaded in the first hub (pid ${old})`);
  await stopHub(box);
  const held = await until(() => hubRuns(box).find((e) => e.event === 'held'), 60_000);
  assert.ok(held, `the scene's own step: the stopped hub (pid ${old}) didn't reach its core's stop within 60 s`);
  assert.equal(held.pid, old, "the scene's own step: the hub held at its stop isn't the one that was stopped");
  assert.ok(exiting(box, old), `the scene's own step: the stopped hub (pid ${old}) must still be running while held`);
  assert.equal(await hello(box), undefined, "the scene's own step: the stopped hub must no longer answer on its socket");
  return { old, heldAt: held.t };
}
