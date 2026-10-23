// #236 AC12: cleanup that didn't finish is its own outcome, holds the next run on that resource and raises one
// unblock ask naming what's left. The pool holds one (fictional) phone number; its release step is planted to
// fail, and its cleanup check passes only once the number's marker file is gone (README, AC12).
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bins, cleanup, runId, sub, tempDir, within } from './helpers.ts';
import { card, dataOf, openWorld, SETTINGS, type World } from './world.ts';
import type { Started, SupervisorOptions } from '../../../packages/supervisor/src/index.ts';

afterEach(cleanup, 30_000);

const NUMBER = '+15550100';
const DEADLINE = SETTINGS.asks.unblock.deadline_ms;

async function phoneWorld(plant?: SupervisorOptions['plant']): Promise<{ w: World; dir: string; marker: string }> {
  const dir = tempDir();
  const state = sub(dir, 'phone');
  const w = await openWorld({
    resources: [{
      kind: 'phone', keys: [NUMBER],
      release: { argv: ['/bin/sh', '-c', 'exit 1'], cwd: state },                                   // planted: it can't release the number
      check: { argv: ['/bin/sh', '-c', 'test ! -e "bound-$DEEP_RESOURCE_KEY"'], cwd: state },       // clean once the marker is gone
    }],
    ...(plant ? { plant } : {}),
  });
  return { w, dir, marker: join(state, `bound-${NUMBER}`) };
}
const needsPhone = (dir: string, run: string) => {
  const b = bins();
  return { run, cwd: sub(dir, run.replace(':', '-')), argv: [b.probe, 'sleep', '50'], grant: { read: [b.dir] }, leases: [{ kind: 'phone' }] };
};

/** The first run takes the number, its cleanup can't release it, and the next run that needs one is held. */
async function heldSecond(w: World, dir: string, marker: string): Promise<{ second: Promise<Started>; run: string }> {
  const first = runId();
  const s1 = await w.sup.start(needsPhone(dir, first));
  if (s1.status !== 'started') throw Error(`BLOCKED: ${first} didn't start: ${JSON.stringify(s1)}`);
  expect(s1.leases).toEqual([{ kind: 'phone', key: NUMBER }]);
  writeFileSync(marker, '');                     // the run used the number, and the release step can't undo it
  await w.sup.wait(first);
  const c1 = await w.sup.cleanup(first);
  expect(c1.outcome, 'cleanup that didn\'t finish is its own outcome').toBe('unfinished');
  expect(c1.left.join(' '), 'cleanup\'s outcome lists what\'s left').toContain(NUMBER);
  const run = runId();
  const second = w.sup.start(needsPhone(dir, run));
  await w.sup.tick();
  expect(await within(second, 1000), `${run} started on a number cleanup didn't release`).toBe('pending');
  const status = await w.sup.status(run);
  expect(status.state).toBe('held');
  expect((status.on ?? []).join(' '), `${run} is held on the number`).toContain(NUMBER);
  return { second, run };
}
async function unblockAsks(w: World) {
  return (await w.events('ask.created')).filter((e) => dataOf(e).kind === 'unblock');
}

/** The deadline half: past it, the number leaves the pool and the held run is BLOCKED naming the kind. */
async function pastDeadline(plant?: SupervisorOptions['plant']): Promise<void> {
  const { w, dir, marker } = await phoneWorld(plant);
  try {
    const { second, run } = await heldSecond(w, dir, marker);
    w.clock.advance(DEADLINE + 1000);
    await w.asks.tick();
    await w.sup.tick();
    const outcome = await within(second, 5000);
    if (outcome === 'pending') throw Error(`${run} still waits on ${NUMBER} past the unblock's deadline`);
    expect(outcome).toEqual({ run, status: 'BLOCKED', cause: 'resource', kind: 'phone' });
    const asks = await unblockAsks(w);
    expect(asks.length, 'one unblock ask was raised for the hold').toBe(1);
    expect((await w.events('ask.defaulted')).some((e) => e.subject === `ask:${asks[0]!.id}` || JSON.stringify(e.data).includes(asks[0]!.id)), 'the ask took its default').toBe(true);
    // The number left the pool: the next run that needs one is BLOCKED at once, naming the kind.
    const third = runId();
    const t = await within(w.sup.start(needsPhone(dir, third)), 5000);
    expect(t).toEqual({ run: third, status: 'BLOCKED', cause: 'resource', kind: 'phone' });
  } finally {
    await w.close();
  }
}

describe('AC12 #236.114db9d6 an unfinished cleanup holds the next run and raises one unblock ask naming what\'s left', () => {
  it('AC12 one unblock ask names the number, with the deadline your settings give an unblock; after you release it, "I did it" runs the cleanup check again and the held run starts', async () => {
    const { w, dir, marker } = await phoneWorld();
    try {
      const { second, run } = await heldSecond(w, dir, marker);
      const asks = await unblockAsks(w);
      expect(asks.length, 'exactly one unblock ask').toBe(1);
      const ask = asks[0]!;
      const data = dataOf(ask) as { deadline: number; default: string; options: { id: string; label: string }[] };
      expect(JSON.stringify(data), 'the ask names the number').toContain(NUMBER);
      expect(Math.abs(data.deadline - (ask.ts + DEADLINE)), 'the deadline is the one your settings give an unblock').toBeLessThanOrEqual(1000);
      const done = data.options.find((o) => /I did it/i.test(o.label));
      expect(done, 'an "I did it" option').toBeDefined();
      const fallback = data.options.find((o) => o.id === data.default);
      expect(fallback?.label, 'the default takes the number out of its pool').toMatch(/pool/i);
      expect((await w.asks.needsYou()).map((c) => c.ask)).toContain(`ask:${ask.id}`);
      // Never the same question twice.
      await w.sup.tick();
      await w.sup.tick();
      expect((await unblockAsks(w)).length, 'a second unblock ask for the same hold').toBe(1);
      // You release it; "I did it" runs the cleanup check again, and the held run starts on the number.
      rmSync(marker);
      await w.asks.answer(card, `ask:${ask.id}`, { option: done!.id });
      await w.sup.tick();
      const started = await within(second, 10_000);
      if (started === 'pending') throw Error(`${run} still waits on ${NUMBER} after "I did it" and a clean check`);
      expect(started.status).toBe('started');
      expect(started.status === 'started' && started.leases).toEqual([{ kind: 'phone', key: NUMBER }]);
      await w.sup.cleanup(run);
    } finally {
      await w.close();
    }
  }, 60_000);

  it('AC12 with no answer past the deadline the number leaves the pool and the held run is BLOCKED naming the kind instead of waiting', async () => {
    await pastDeadline();
  }, 60_000);

  it('AC12 (wrong program) a hold with no ask leaves the run waiting past the deadline and fails this test, naming the number', async () => {
    await expect(pastDeadline('hold-without-ask')).rejects.toThrow(new RegExp(`still waits on \\${NUMBER} past the unblock's deadline`));
  }, 60_000);
});
