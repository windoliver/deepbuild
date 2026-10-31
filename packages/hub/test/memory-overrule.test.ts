// `deep memory overrule` end to end (#111): a kept lesson's guard goes and it is listed again; a rejection overruled can be said again.
import { afterAll, describe, expect, it } from 'vitest';
import { hook, newSession, payload } from '../../../tests/acceptance/316/helpers.ts';
import { claudeSession, cleanup, compile, decision, deep, memoryHome, toolCallIn, type Mem } from '../../../tests/acceptance/111/helpers.ts';

afterAll(cleanup, 60_000);
const listed = async (m: Mem) => JSON.parse((await deep(m.h.home, ['memory', '--json'])).stdout) as { lessons: { id: string; kind: string }[]; rejected: { decision: string; direction: string }[] };

describe('deep memory overrule', () => {
  it('takes a kept lesson\'s guard off, and the lesson is yours to decide again', async () => {
    const m = memoryHome({ agents: ['claude'] });
    await compile(m);
    const guard = (await listed(m)).lessons.find((l) => l.kind === 'guard')!;
    const kept = await deep(m.h.home, ['memory', 'keep', guard.id]);
    expect(kept.code, kept.stderr).toBe(0);
    const overruled = await deep(m.h.home, ['memory', 'overrule', /decision:[0-9A-Za-z]+/.exec(kept.stdout)![0]]);
    expect(overruled.code, overruled.stderr).toBe(0);
    expect(decision(await toolCallIn(m, m.api, 'make nuke-db'))).toBe('allow');
    expect((await listed(m)).lessons.map((l) => l.id)).toContain(guard.id);
  }, 300_000);

  it('stays overruled across a re-read of the transcript, and a new prompt rejects it again', async () => {
    const m = memoryHome({ agents: ['claude'] });
    claudeSession(m, m.api, { role: 'user', text: 'Not that. rejected: `kafka`.' }, { role: 'assistant', text: 'Noted.' });
    await compile(m);
    const overruled = await deep(m.h.home, ['memory', 'overrule', (await listed(m)).rejected[0]!.decision]);
    expect(overruled.code, overruled.stderr).toBe(0);
    await compile(m);
    expect((await listed(m)).rejected).toEqual([]);
    expect(decision(await toolCallIn(m, m.api, 'sh scripts/live.sh kafka'))).toBe('allow');
    const s = newSession(m.h.home, m.api);
    await hook(m.h.home, s, 'SessionStart', payload(s, 'SessionStart'));
    await hook(m.h.home, s, 'UserPromptSubmit', { ...payload(s, 'UserPromptSubmit'), prompt: 'Again no. rejected: `kafka`.' } as never);
    for (const until = Date.now() + 10_000; Date.now() < until && !(await listed(m)).rejected.length; await new Promise((r) => setTimeout(r, 100)));
    expect((await listed(m)).rejected.map((r) => r.direction)).toEqual(['kafka']);
    expect(decision(await toolCallIn(m, m.api, 'sh scripts/live.sh kafka'))).toBe('deny');
  }, 300_000);
});
