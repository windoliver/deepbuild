// AC4: two tasks in a workspace finish one at a time; the second's session waits for the test's go until the first has
// finished, so the workspace's version then is the last version. Once the second has finished too, going back one step
// (`deep workspace revert <id>`, naming no commit) gives back that version byte for byte: every file's bytes and mode,
// a CRLF note with no newline at its end, a binary file and a script that runs among them.
import { expect, test } from 'vitest';
import { MIN, named, sleep, waitUntil, World, type Task } from './helpers.ts';

/** What the workspace holds before either task, besides each task's own files: bytes a program that re-renders files would change. */
const KEPT = {
  'notes/itinerary.md': '# Itinerary\r\n\r\n- fly out on the 3rd\r\n- back on the 9th',
  'data/fares.bin': '\u0000ÿ\r\n\u0000\u0001',
  'scripts/remind.sh': '#!/bin/sh\necho "pack the passports"\n',
};

test(named(4), async () => {
  const w = await World.open({ topic: 'Trip plan', forge: 'unreachable' });
  const entered = await w.enter([
    { title: 'Book the flights', criteria: ['The flights are booked'] },
    { title: 'Book the hotel', criteria: ['The hotel is booked'], blockedBy: [0] },
  ]);
  expect(entered.failures, 'each task enters the workspace with `deep workspace task`').toEqual([]);
  const [one, two] = entered.tasks as [Task, Task];
  const prepared = await w.prepare({ files: KEPT, plan: { [two.n]: { launches: ['gated'] } } });
  expect(prepared.missing, 'each task is a record item').toEqual([]);
  const scope = `work through #${one.n} and #${two.n} with Claude Code, one at a time`;
  const asked = await w.run(scope);
  expect(asked.code, `deep work "${scope}" raises the run's one approval and exits 0: exit ${asked.code}, ${asked.stderr.slice(-600)}`).toBe(0);
  await w.approve(asked);

  // The first task finished, and the second's session waits: the workspace's version now is the last version.
  const waiting = await waitUntil(async () => (await w.finish(one.n)) !== undefined && w.on(two.n).some((l) => l.steps.some((s) => s.what === 'turn')), 30 * MIN, 3000);
  expect(waiting, `#${one.n} finishes and #${two.n}'s session starts: ${(await w.unfinished()).join('; ')}`).toBe(true);
  const last = (await w.head())!;
  const version = await w.version(last);
  w.go(two.n);
  await waitUntil(async () => (await w.finish(two.n)) !== undefined, 30 * MIN, 3000);
  expect(await w.unfinished(), 'both tasks finish').toEqual([]);
  await sleep(10_000);
  const now = (await w.head())!;
  expect(await w.version(now), `the second task changed the workspace: ${last} to ${now}`).not.toEqual(version);

  const back = await w.deep(['workspace', 'revert', w.id]);
  expect(back.code, `going back one step, deep workspace revert ${w.id}: exit ${back.code}, ${back.stdout.slice(-600)} ${back.stderr.slice(-600)}`).toBe(0);
  expect(w.files(), `going back one step restores the last version, ${last}, byte for byte`).toEqual(version);
}, 70 * MIN);
