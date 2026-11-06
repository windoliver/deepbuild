// Answer routing's extracted record operations run on a real record, including its lifecycle/projection gate.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openRecord, ulid, type Connection } from '@deepbuild/record';
import { Answers, answerText } from '../src/answers.js';

it('offers only unanswered deliveries in the same thread, with words and images intact', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deep-answer-record-'));
  let now = Date.UTC(2026, 9, 31, 12);
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: () => now });
  const core: Connection = { writer: 'core', actor: 'you', scope: 'you' };
  const excluded = new Set<string>();
  const delivered: string[] = [];
  const pin = { kind: 'commit', ref: 'a'.repeat(40) };
  try {
    for (const [session, thread] of [['S1', 'T1'], ['S2', 'T1'], ['S3', 'T3']] as const) {
      await record.append({ ...core, writer: 'hook', session }, {
        v: 1, id: ulid(++now), kind: 'session.start', ts: now,
        data: { agent: 'claude-code', worktree: dir, branch: 'main', thread },
      });
    }
    async function answered(session: string, question: string, image: string | null): Promise<string> {
      const id = ulid(++now);
      await record.append({ ...core, session }, { v: 1, id, kind: 'ask.created', ts: now, data: {
        kind: 'choice', question, options: [{ id: 'keep', label: 'Keep it', decision: 'none' }],
        recommended: 'keep', default: 'keep', deadline: now + 60_000, fallback: 'you', owner: 'you', provisional: false,
        key: 'a'.repeat(64), pinned_to: pin,
      } });
      await record.append(core, { v: 4, id: ulid(++now), kind: 'ask.answered', ts: now, subject: `ask:${id}`, data: {
        answer: 'keep', plan_hash: null, decision: 'none', via: 'card', verified: true, on: pin,
        token: null, words: 'Keep the heading', image,
      } });
      return id;
    }
    const image = 'b'.repeat(64);
    const first = await answered('S1', 'Which heading?', image);
    const other = await answered('S3', 'Unrelated question?', null);
    const answers = new Answers({
      raw: (query, params) => record.raw(query, params), settled: () => record.sync(),
      excluded: id => excluded.has(id), delivered: session => { delivered.push(session); },
      append: async (data, v) => { await record.append(core, { v, id: ulid(++now), kind: 'delivery.outcome', ts: now, subject: data.delivery, data }); },
    });
    const waiting = await answers.waitingFor('S2');
    expect(waiting.map(row => row.id)).toEqual([first]);
    expect(waiting[0]).toMatchObject({ words: 'Keep the heading', image });
    expect(answerText(waiting)).toBe(`DeepBuild delivers your answers:\nYour answer to ask:${first} ("Which heading?"): Keep it (keep) — with your words: "Keep the heading" and a screenshot, sha256 ${image}.`);
    excluded.add(first);
    expect(await answers.waitingFor('S2')).toEqual([]);
    excluded.delete(first);
    await answers.outcome(first, 'next_prompt', 'stalled');
    expect(delivered).toEqual([]);
    expect((await answers.waitingFor('S2')).map(row => row.id)).toEqual([first]);
    await answers.outcome(first, 'next_prompt', 'delivered');
    expect(delivered).toEqual(['S1']);
    expect(await answers.waitingFor('S2')).toEqual([]);
    expect((await answers.waitingFor('S3')).map(row => row.id)).toEqual([other]);
  } finally {
    await record.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
