// #2077: an eval that would adopt cannot overwrite a user's intervening edit, and taking it twice joins one job.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { FILE, RULE, allEvents, cleanup, control, deep, fixture, jobs, lessons, observations, start, stopHub, until, window } from '../../../tests/acceptance/2077/helpers.ts';

afterAll(cleanup, 120_000);
it('joins one pending removal and leaves changed live bytes untouched when its recorded eval adopts', async () => {
  const w = await fixture('adopt');
  const hub = await start(w);
  try {
    const lesson = (await lessons(w)).find((l) => l.text === RULE)!;
    expect(lesson).toBeDefined();
    const initial = new Set((await jobs(hub)).map((j) => j.job));
    const reset = Date.now() + 3600_000;
    await window(hub, 95, reset);
    const first = await deep(w, ['memory', 'remove', lesson.id]);
    const second = await deep(w, ['memory', 'remove', lesson.id]);
    const added = (await jobs(hub)).filter((j) => !initial.has(j.job));
    expect(added).toHaveLength(1);
    expect(first.stdout).toContain(added[0]!.job);
    expect(second.stdout).toContain(added[0]!.job);
    await window(hub, 5, reset + 3600_000);
    expect((await until(() => observations(w), (xs) => xs.some((x) => x.kind === 'work'))).some((x) => x.kind === 'work')).toBe(true);
    const file = join(w.repo, FILE);
    const changed = Buffer.concat([readFileSync(file), Buffer.from('\r\nA person added this while the eval ran.\r\n')]);
    writeFileSync(file, changed);
    writeFileSync(w.release, 'go\n');
    const end = await until(() => control(hub, 'job.status', { job: added[0]!.job }), (j) => j.state === 'finished', 120_000);
    expect(end.state).toBe('finished');
    expect(end.result).toMatch(/adopt.*changed.*nothing removed/s);
    expect(readFileSync(file).equals(changed)).toBe(true);
    expect((await lessons(w)).map((l) => l.id)).toContain(lesson.id);
    expect((await allEvents(hub)).filter((e) => e.kind === 'decision.created' && e.subject === added[0]!.job)).toEqual([]);
  } finally { writeFileSync(w.release, 'go\n'); await stopHub(hub); }
}, 240_000);
