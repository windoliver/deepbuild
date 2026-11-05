// The asks core must use its caller's adapter capabilities, not a second, independently loaded registry.
// These are real record/asks components; the callback is the public capability boundary the hub supplies.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openAsks } from '@deepbuild/asks';
import { openRecord, ulid } from '@deepbuild/record';

for (const [agent, enabled] of [['claude-code', false], ['codex', true]]) {
  test(`automatic continuation uses injected ${agent} capability (${enabled})`, async () => {
    const folder = mkdtempSync(join(tmpdir(), 'deep-adapter-capability-'));
    let now = Date.UTC(2026, 9, 31, 12);
    const record = await openRecord({ path: join(folder, 'ledger.db'), now: () => now });
    try {
      const seen = [];
      const asks = await openAsks({
        record, now: () => now, deliver: () => undefined,
        errorTurnHook: name => { seen.push(name); return enabled; },
      });
      const session = '2d3ffc52-9f60-4e88-a5f1-e0a6f149fd54';
      const connection = { writer: 'hook', actor: 'you', scope: 'you', session, agent };
      await record.append(connection, {
        v: 1, id: ulid(now), kind: 'session.start', ts: now, seq: String(BigInt(now) * 1_000_000n),
        data: { agent, worktree: folder, branch: 'main', thread: session },
      });
      now += 60_000;
      const stopped = ulid(now);
      await record.append(connection, {
        v: 4, id: stopped, kind: 'agent.stop', ts: now, seq: String(BigInt(now) * 1_000_000n),
        subject: `session:${session.replaceAll('-', '')}`,
        data: { turn: 1, did_work: true, claim: false, cause: 'timed_out', usage: null,
          outcome: 'failed', signature: 'sig:1d20a3b4c5d6e7f8', owner: 'service' },
      });
      now += 5000;
      await asks.tick();
      const events = await record.read({ after: 0, limit: 1000 });
      const continued = events.filter(event => event.kind === 'session.continued');
      assert.deepEqual(seen, [agent], 'query the supplied registry with the recorded agent');
      assert.deepEqual(continued.map(event => event.data.stop), enabled ? [stopped] : [],
        'only an adapter that supports error-turn hooks can receive the automatic continuation');
      await asks.tick();
      const again = await record.read({ after: 0, limit: 1000 });
      assert.equal(again.filter(event => event.kind === 'session.continued').length, continued.length,
        'reading the same stop again never issues a second continuation');
    } finally {
      await record.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
}
