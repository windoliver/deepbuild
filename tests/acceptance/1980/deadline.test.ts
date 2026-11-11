// #1980.e07015a3: "An ask past its 14-day deadline on the virtual clock goes to its fallback, and rebuilding the asks
// table from the log sends it there again. The report gives asks per week across the 107 evaluations against what
// routing per job would send, and the owned failures that reached their fallback or default against the 18 that sat
// past 14 days, each a count over its named sample, never a pass or a fail"
//
// One replay of the kept snapshot into a fresh record through the real asks core, on the virtual clock
// (helpers.ts, useReplay). The report test reads the record as the replay left it (World.events), so the first test's
// clock move doesn't touch it.
// asserts:
// 1. Every ask the router raised has a deadline 14 days after it was raised. With the virtual clock moved past every
//    one, each ask that was still open at its deadline closes once, as ask.escalated or ask.defaulted, at or after it,
//    and its asks row reads escalated or defaulted with the fallback its ask.created carries; at least one does. After
//    record.rebuild() each such row reads the same, and an asks core opened on the rebuilt log closes none of them again.
// 2. reportCheck: the report's weeks cover the 107 evaluations, each in its week; each week's asks count equals the asks
//    the record shows the router raised for its evaluations, and its per_job count the newly failing jobs they hold;
//    owned.sat_past_14_days counts 18 and owned.reached the newly failing jobs whose merge's ask the record shows at
//    its fallback or default; each is an integer over a named sample, and nothing in the report is a pass or a fail.
// Wrong program: the merge base, where packages/routing-replay doesn't exist.

import { expect, it } from 'vitest';
import { openAsks } from '../../../packages/asks/src/index.ts';
import {
  DEADLINE, SNAPSHOT, closesOf, dataOf, handleOf, kept, none, readAll, reportCheck, routerAsks, rowOf, stored, useReplay, type Event,
} from './helpers.ts';

const world = useReplay();

it('#1980.e07015a3 an ask past its 14-day deadline on the virtual clock goes to its fallback, and rebuilding the asks table from the log sends it there again', async () => {
  const w = world();
  const { snapshot } = await kept(w, SNAPSHOT);
  const router = routerAsks(w.events, snapshot);
  expect(router.length, 'the router raised asks').toBeGreaterThan(0);
  const failures: string[] = [];
  for (const a of router) {
    const d = dataOf(a);
    if (typeof d.deadline !== 'number' || d.deadline - a.ts !== DEADLINE) failures.push(`ask ${handleOf(a)}: its deadline is not 14 days after it was raised`);
  }
  none(failures, 'every ask the router raised waits 14 days');

  // The virtual clock past every deadline; a second tick a further 14 days on, for an ask the first one only showed.
  const last = Math.max(...router.map((a) => dataOf(a).deadline as number));
  w.clock.set(Math.max(w.clock.now(), last + 1));
  await w.asks.tick();
  w.clock.set(w.clock.now() + DEADLINE);
  await w.asks.tick();
  const after = await readAll(w.record);

  const fellBack: Event[] = [];
  for (const a of router) {
    const handle = handleOf(a);
    const d = dataOf(a);
    const closes = closesOf(after, handle);
    if (closes.length !== 1) { failures.push(`ask ${handle}: closed ${closes.length} times, not once`); continue; }
    const close = closes[0]!;
    if (close.ts < (d.deadline as number)) continue; // closed before its deadline came
    if (close.kind !== 'ask.escalated' && close.kind !== 'ask.defaulted') { failures.push(`ask ${handle}: past its deadline it closed as ${close.kind}, not to its fallback`); continue; }
    const row = await rowOf(w.record, handle);
    if (!row || (row.outcome !== 'escalated' && row.outcome !== 'defaulted') || stored(row.fallback) !== d.fallback) {
      failures.push(`ask ${handle}: its asks row reads ${row?.outcome} with fallback ${String(row?.fallback)}, not at its fallback ${String(d.fallback)}`);
      continue;
    }
    fellBack.push(a);
  }
  none(failures, 'each ask open at its deadline went to its fallback');
  expect(fellBack.length, 'an ask went past its 14-day deadline to its fallback').toBeGreaterThan(0);

  const columns = ['status', 'outcome', 'fallback', 'owner', 'key', 'deadline'];
  const pick = async (a: Event) => {
    const row = await rowOf(w.record, handleOf(a));
    return Object.fromEntries(columns.map((c) => [c, row?.[c]]));
  };
  const before = await Promise.all(fellBack.map(pick));
  await w.record.rebuild();
  const rebuilt = await Promise.all(fellBack.map(pick));
  fellBack.forEach((a, i) => {
    expect(rebuilt[i], `ask ${handleOf(a)}: the asks table rebuilt from the log sends it to its fallback again`).toEqual(before[i]);
  });
  const again = await openAsks({ record: w.record, now: w.clock.now, deliver: () => {} });
  await again.tick();
  const log = await readAll(w.record);
  for (const a of fellBack) expect(closesOf(log, handleOf(a)).length, `ask ${handleOf(a)}: an asks core opened on the rebuilt log doesn't close it again`).toBe(1);
});

it('#1980.e07015a3 the report gives asks per week across the 107 evaluations against what routing per job would send, and the owned failures that reached their fallback or default against the 18 that sat past 14 days, each a count over its named sample, never a pass or a fail', async () => {
  const w = world();
  const { snapshot } = await kept(w, SNAPSHOT);
  none(reportCheck(w.report, snapshot, w.events), 'the report');
});
