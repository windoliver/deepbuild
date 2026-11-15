// #2077: confirmation joins before a prompt; the approved target cannot become a symlink during the eval.
import { chmodSync, existsSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { FILE, RULE, allEvents, cleanup, control, deep, fixture, jobs, lessons, observations, start, stopHub, until, window } from '../../../tests/acceptance/2077/helpers.ts';

afterAll(cleanup, 120_000);
it('two concurrent takes ask the person once and create one eval', async () => {
  const w = await fixture('adopt');
  const asked = join(w.tmp, 'asked');
  writeFileSync(w.confirm, `#!/bin/sh\nprintf 'asked\\n' >> '${asked}'\nsleep 1\n`);
  chmodSync(w.confirm, 0o755);
  const hub = await start(w);
  try {
    const lesson = (await lessons(w)).find((l) => l.text === RULE)!;
    await window(hub, 95, Date.now() + 3600_000);
    const replies = await Promise.all([deep(w, ['memory', 'remove', lesson.id]), deep(w, ['memory', 'remove', lesson.id])]);
    expect(replies.every((r) => r.code === 0)).toBe(true);
    expect(existsSync(asked)).toBe(true);
    expect(readFileSync(asked, 'utf8')).toBe('asked\n');
    expect((await jobs(hub)).filter((j) => j.kind === 'eval')).toHaveLength(1);
  } finally { await stopHub(hub); }
}, 120_000);

it('a replaced target with identical bytes cannot redirect an adopted removal into another file', async () => {
  const w = await fixture('adopt');
  const hub = await start(w);
  try {
    const lesson = (await lessons(w)).find((l) => l.text === RULE)!;
    await window(hub, 5, Date.now() + 3600_000);
    const reply = await deep(w, ['memory', 'remove', lesson.id]);
    expect(reply.code).toBe(0);
    const job = (await jobs(hub)).find((j) => j.kind === 'eval')!;
    expect((await until(() => observations(w), (xs) => xs.some((x) => x.kind === 'work'))).some((x) => x.kind === 'work')).toBe(true);
    const path = join(w.repo, FILE), victim = join(w.tmp, 'person.md'), bytes = readFileSync(path);
    writeFileSync(victim, bytes); unlinkSync(path); symlinkSync(victim, path);
    writeFileSync(w.release, 'go\n');
    const ended = await until(() => control(hub, 'job.status', { job: job.job }), (j) => ['finished', 'refused', 'stopped'].includes(j.state), 120_000);
    expect(['finished', 'refused']).toContain(ended.state);
    expect(readFileSync(victim).equals(bytes)).toBe(true);
    expect((await allEvents(hub)).filter((e) => e.kind === 'decision.created' && e.subject === job.job)).toEqual([]);
  } finally { writeFileSync(w.release, 'go\n'); await stopHub(hub); }
}, 240_000);
