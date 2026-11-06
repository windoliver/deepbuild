// #580 AC8: a slow-lane journey on a green stop answered "proceed" runs no start step and starts no app: the warm stack
// stays as the last run left it, and with the lockfile changed, no install runs until a later stop whose reply ends the
// turn lets the journey's run leave the queue. An environment that starts the stack, or installs, at every claim fails
// this test, naming the stop. The "proceed" is the planted sorter's (DEEP_HUB_TEST_SORTER, #321).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Bench, containers, databases, failureOf, inspect, passed, sleep, stepOf, volumes } from './helpers.ts';

let bench: Bench | undefined;
afterEach(async () => { await bench?.close(); bench = undefined; }, 300_000);

const QUESTION = 'Want me to run the e2e suite?';
const STOP = 'stop 2, answered "proceed"';

async function scenario(plant?: string): Promise<void> {
  const b = bench = await Bench.open({ proceed: [QUESTION], ...(plant ? { plant } : {}) });
  const s = await b.session();
  const first = await b.whole(s);
  passed(first);
  const { project } = first.served;
  const db = containers(project, 'db')[0]!;
  const before = {
    logged: b.stepLog().length, apps: b.apps().length, containers: containers(project).sort(), volumes: volumes(project).sort(),
    databases: databases(db).sort(), started: inspect(db).State.StartedAt as string,
  };

  // A turn that changes the lockfile and ends on a question the sorter answers "proceed".
  await b.ask(s);
  const since = await b.pos();
  await s.editCart(since);
  const path = join(s.cwd, 'package-lock.json');
  await s.call('Write', { file_path: path, content: b.w.lock101 }, { effect: () => writeFileSync(path, b.w.lock101) });
  const manifest = join(s.cwd, 'package.json');
  const text = readFileSync(manifest, 'utf8').replace('dh-wire-1.0.0', 'dh-wire-1.0.1');
  await s.call('Write', { file_path: manifest, content: text }, { effect: () => writeFileSync(manifest, text) });
  await s.stop(QUESTION);
  await b.until(async () => (await b.events()).some((e) => e.kind === 'question.proceeded' && e.log_pos > since), 60_000, `the "proceed" for "${QUESTION}"`);
  await sleep(10_000);

  const events = (await b.events()).filter((e) => e.log_pos > since);
  const ranSince = b.stepLog().slice(before.logged).map((l) => l.step);
  expect(ranSince, `${STOP} ran a start step: ${ranSince.join(', ')}`).toEqual([]);
  expect(b.apps().length, `${STOP} started an app`).toBe(before.apps);
  expect(events.filter((e) => e.kind === 'run.started' && e.data.check === first.check).map((e) => e.data.run), `${STOP} started the journey`).toEqual([]);
  expect(events.filter((e) => e.kind === 'stack.served').map((e) => e.data.run), `${STOP} served a stack`).toEqual([]);
  expect(containers(project).sort(), `${STOP} changed the warm stack's containers`).toEqual(before.containers);
  expect(volumes(project).sort(), `${STOP} changed the warm stack's volumes`).toEqual(before.volumes);
  expect(databases(db).sort(), `${STOP} changed the warm stack's databases`).toEqual(before.databases);
  expect(inspect(db).State.StartedAt, `${STOP} restarted db`).toBe(before.started);

  // The later stop, whose reply ends the turn: the journey leaves the queue and the install runs.
  await s.editCart(since + 1);
  const later = await s.stop('Done.');
  const pending = await b.running(s, since, later);
  const served = await b.served(pending);
  expect(stepOf(served, 'install').status, 'the install runs once the run leaves the queue').toBe('ran');
  expect(b.stepLog().slice(before.logged).map((l) => l.step), 'and the sample logged it').toContain('install');
  expect((await b.finished(pending)).outcome).toBe('passed');
}

describe('AC8 #580 a stack starts only for a run that may start', () => {
  it('AC8 a green stop answered "proceed" runs no start step and starts no app, and with the lockfile changed no install runs until a later stop\'s reply ends the turn', async () => {
    await scenario();
  }, 1_500_000);

  it('AC8 (wrong program) an environment that starts the stack, or installs, at every claim (DEEP_HUB_PLANT=env-starts-at-every-claim) fails this test, naming the stop', async () => {
    const failure = await failureOf(() => scenario('env-starts-at-every-claim'));
    expect(failure, 'the planted environment passed').not.toBeNull();
    expect(failure, 'naming the stop').toContain(STOP);
  }, 1_500_000);
});
