// The route a review reads a session's model on (#1886): every start the session's record keeps counts, so a session
// started behind a proxy and resumed on the agent's own route still reads as proxied, since its transcript may name the
// proxy's model; one whose start recorded no route, or with no start, has none, and its model reads as unknown.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openRecord, ulid } from '@deepbuild/record';
import { StopJudging, type StopJudgingOptions } from '../src/stop-judging.js';

const OWN = { ANTHROPIC_BASE_URL: false, ANTHROPIC_AUTH_TOKEN: false, CLAUDE_CODE_USE_BEDROCK: false, CLAUDE_CODE_USE_VERTEX: false };

it('reads every start of the session, and none where a start recorded no route', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'route-of-'));
  let now = Date.UTC(2026, 10, 22);
  const record = await openRecord({ path: join(dir, 'record.db'), now: () => now });
  try {
    const start = (session: string, route?: Record<string, boolean>) => record.append({ writer: 'hook', actor: 'you', scope: 'you', session }, {
      v: 3, id: ulid(++now), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree: dir, branch: null, thread: session, loads: [], ...(route ? { route } : {}) },
    });
    await start('resumed', { ...OWN, ANTHROPIC_BASE_URL: true });
    await start('resumed', OWN);
    await start('proxied-later', OWN);
    await start('proxied-later', { ...OWN, ANTHROPIC_BASE_URL: true });
    await start('own', OWN);
    await start('unrecorded');
    await start('then-unrecorded', OWN);
    await start('then-unrecorded');
    const judging = new StopJudging({ settings: {}, services: { record } } as unknown as StopJudgingOptions);
    expect(await judging.routeOf('resumed'), 'started behind a base URL, resumed without it').toEqual({ ...OWN, ANTHROPIC_BASE_URL: true });
    expect(await judging.routeOf('proxied-later'), 'started on its own route, resumed behind a base URL').toEqual({ ...OWN, ANTHROPIC_BASE_URL: true });
    expect(await judging.routeOf('own'), 'on the agent\'s own route').toEqual(OWN);
    expect(await judging.routeOf('unrecorded'), 'a start that recorded no route').toBeNull();
    expect(await judging.routeOf('then-unrecorded'), 'a later start that recorded no route').toBeNull();
    expect(await judging.routeOf('never-started'), 'no start').toBeNull();
  } finally {
    await record.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
