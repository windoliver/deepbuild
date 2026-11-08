// #342 AC3: every outside resource a session created has a teardown task, closed when its check sees the resource gone. The
// issue's scope gives each its cost. The repo's spec says what creates a resource, its cost and the check that proves it
// gone (README, The surface under test), so nothing rests on the agent's word: the hub reads the session's own Bash calls.
// A session creates two instances and a phone number on a fake provider, a boundary DeepBuild doesn't own, then ends. Each
// has its own task at its own cost. "I did it" with the resource still there leaves its task open, by its check; once the
// provider no longer has it, its check passes and its task closes, and the others stay open. A task closed on your word
// fails this test, naming the resource.
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, deep } from '../332/helpers.ts';
import { AC3, checksCanRun, closeWorlds, events, failureOf, FIXTURES, openWorld, session, sleep, until, type Line, type World } from './helpers.ts';

afterEach(async () => { await closeWorlds(); await cleanup(); }, 60_000);

const FAKECLOUD = readFileSync(join(FIXTURES, 'fakecloud.sh'), 'utf8');
const GONE = readFileSync(join(FIXTURES, 'gone-check.mjs'), 'utf8');
const INSTANCE_USD = 49;
const NUMBER_USD = 1.15;
const DONE = [
  'checks:',
  '  instance-gone: { type: command, run: "node --test .deepbuild/checks/gone.test.mjs", min_tests: 1 }',
  '  number-gone: { type: command, run: "node --test .deepbuild/checks/gone.test.mjs", min_tests: 1 }',
  'resources:',
  `  cloud-instance: { created_by: '^\\./bin/fakecloud create instance\\b', key: 'created (\\S+)', cost: ${INSTANCE_USD}, check: instance-gone }`,
  `  phone-number: { created_by: '^\\./bin/fakecloud create number\\b', key: 'created (\\S+)', cost: ${NUMBER_USD}, check: number-gone }`,
  '',
].join('\n');

const CLOSES = ['ask.answered', 'ask.defaulted', 'ask.escalated', 'ask.cancelled', 'ask.superseded', 'ask.moot'];
const naming = (all: Line[], key: string): Line[] => all.filter((e) => e.kind === 'ask.created' && e.data?.kind === 'unblock' && String(e.data.question).includes(key));
/** The open teardown task naming the resource: raised, and not closed by any of the asks core's ends. */
const openTask = (all: Line[], key: string): Line | undefined => naming(all, key).find((t) => !all.some((e) => CLOSES.includes(e.kind) && e.subject === `ask:${t.id}`));
/** "I did it", from your own terminal. A task its check already closed has nothing to answer, which isn't a failure. */
const didIt = (w: World, task: Line) => deep(['inbox', 'answer', `ask:${task.id}`, 'done'], { cwd: w.repo, timeoutMs: 60_000 });
const runsOf = (all: Line[], check: string, since: number, outcome: string): Line[] => all.filter((e) => e.kind === 'run.finished' && e.log_pos > since && e.data?.check === check && e.data?.outcome === outcome);

async function scenario(plant?: string): Promise<void> {
  const w = await openWorld({
    ...(plant ? { plant } : {}),
    files: { '.deepbuild/done.yaml': DONE, '.deepbuild/checks/gone.test.mjs': GONE, 'bin/fakecloud': FAKECLOUD, '.cloud/provider': 'the fake provider\n' },
  });
  const s = await session(w, 'claude');
  const create = async (kind: string): Promise<string> => {
    const r = await s.bash(`./bin/fakecloud create ${kind}`);
    const key = /created (\S+)/.exec(r.stdout)?.[1];
    expect(key, `the provider made a ${kind} (${r.stdout} ${r.stderr})`).toBeDefined();
    return key!;
  };
  const instance = await create('instance');
  const number = await create('number');
  const other = await create('instance');
  await s.end();

  // Each resource has its own task, at its cost, proved by its check.
  await until(w, async () => { const all = await events(w); return [instance, number, other].every((k) => openTask(all, k)); }, 30_000, `a teardown task naming each of ${instance}, ${number}, ${other}`)
    .catch(async (error: Error) => { throw Error(`${error.message}; the unblock tasks raised: ${JSON.stringify((await events(w, 'ask.created')).map((e) => e.data?.question))}`); });
  const all = await events(w);
  const task = (key: string): Line => openTask(all, key)!;
  expect(new Set([instance, number, other].map((k) => task(k).id)).size, 'one task per resource').toBe(3);
  expect(task(instance).data.cost_usd, `${instance}'s task carries its cost`).toBe(INSTANCE_USD);
  expect(task(other).data.cost_usd, `${other}'s task carries its cost`).toBe(INSTANCE_USD);
  expect(task(number).data.cost_usd, `${number}'s task carries its cost`).toBe(NUMBER_USD);
  expect(task(instance).data.proves, `${instance}'s task is proved by its kind's check`).toBe('instance-gone');
  expect(task(number).data.proves, `${number}'s task is proved by its kind's check`).toBe('number-gone');

  // Your word closes nothing: the resource is still there, its check says so, and its task stays open.
  checksCanRun();
  const before = Math.max(...all.map((e) => Number(e.log_pos)));
  await didIt(w, task(instance));
  await until(w, async () => runsOf(await events(w), 'instance-gone', before, 'failed').length > 0, 60_000, `the check instance-gone to run and fail on ${instance}, which still exists`)
    .catch((error: Error) => { throw Error(`the task naming ${instance} closed with no failing check: ${error.message}`); });
  await sleep(1000);
  const open = await until(w, async () => openTask(await events(w), instance), 15_000, `a task naming ${instance}`)
    .catch(() => { throw Error(`the teardown task naming ${instance} closed on your word, with ${instance} still at the provider`); });

  // Gone at the provider: its check sees it, and its task closes. The others stay open.
  const gone = Math.max(...(await events(w)).map((e) => Number(e.log_pos)));
  rmSync(join(w.repo, '.cloud', instance));
  await didIt(w, open);
  await until(w, async () => {
    const now = await events(w);
    return runsOf(now, 'instance-gone', gone, 'passed').length > 0 && !openTask(now, instance);
  }, 60_000, `the check instance-gone to pass and close the task naming ${instance}`);
  const left = await events(w);
  expect(openTask(left, other), `${other} still exists, and its check never passed, so its task stays open`).toBeDefined();
  expect(openTask(left, number), `${number} still exists, and its check never passed, so its task stays open`).toBeDefined();
}

describe(`${AC3} every outside resource a session created has a teardown task, closed when its check sees the resource gone`, () => {
  it('AC3 each resource has a task at its cost; "I did it" with it still there leaves the task open; gone, its check passes and only its task closes', async () => {
    await scenario();
  }, 300_000);

  it('AC3 (wrong program) a task closed on your word (DEEP_HUB_PLANT=teardown-closes-on-word) fails this test, naming the resource', async () => {
    const failure = await failureOf(() => scenario('teardown-closes-on-word'));
    expect(failure, 'the planted hub passed').not.toBeNull();
    expect(failure, 'naming the resource').toMatch(/instance-[0-9a-f]{8}/);
    expect(failure, 'by the task that closed on your word').toMatch(/closed/);
  }, 300_000);
});
