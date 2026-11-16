// #2077: history after the replay cutoff must not supply the evidence selecting an inactivity removal.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { openRecord, ulid } from '@deepbuild/record';
import { BEFORE, FILE, RULE, cleanup, control, deep, fixture, jobs, lessons, observations, start, stopHub, until, window } from '../../../tests/acceptance/2077/helpers.ts';

afterAll(cleanup, 120_000);
it('does not adopt when the rule was still in use before the held-out cohort, even though it is unused now', async () => {
  const w = await fixture('adopt');
  const at = Date.now() - 70 * 86_400_000, session = ulid(at);
  const record = await openRecord({ path: join(w.root, 'ledger.db'), now: Date.now });
  try {
    const hook = { writer: 'hook', actor: 'you', scope: 'you', session, project: 'fixture-2077', agent: 'claude-code' };
    await record.append(hook, { v: 1, id: ulid(at), ts: at, kind: 'session.start', data: { agent: 'claude-code', worktree: w.repo, branch: 'main', thread: session } });
    await record.append(hook, { v: 3, id: ulid(at + 1), ts: at + 1, kind: 'tool.before', data: { kind: 'read', paths: [join(w.repo, 'legacy/old.ts')], command: null, call: 'old-use' } });
  } finally { await record.close(); }
  writeFileSync(w.release, 'go\n');
  const hub = await start(w);
  try {
    const lesson = (await lessons(w)).find((l) => l.text === RULE)!;
    expect(lesson, 'the rule has no use in the last 60 days now').toBeDefined();
    await window(hub, 5, Date.now() + 3600_000);
    expect((await deep(w, ['memory', 'remove', lesson.id])).code).toBe(0);
    const job = (await jobs(hub)).find((j) => j.kind === 'eval')!;
    const ended = await until(() => control(hub, 'job.status', { job: job.job }), (j) => ['finished', 'refused', 'stopped'].includes(j.state), 120_000);
    expect(readFileSync(join(w.repo, FILE), 'utf8'), 'the 20 replay tasks are only 7–26 days old, so the old use is inside the 60 days BEFORE their cutoff').toBe(BEFORE);
    expect(ended.refused ?? ended.result).toMatch(/INCONCLUSIVE.*cutoff/s);
    expect(observations(w)).toEqual([]);
    expect((await lessons(w)).map((l) => l.id)).toContain(lesson.id);
  } finally { await stopHub(hub); }
}, 180_000);
