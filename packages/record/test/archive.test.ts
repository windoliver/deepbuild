// The archive's text index (#1515) is never a source of truth: a session whose transcript was archived again after it
// was indexed is searched at its newest copy, never at the rows the index still holds for the old one.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openEvidenceStore } from '@deepbuild/evidence';
import { foldText, openRecord, openRecordReader, ulid, type Connection } from '../src/index.js';

const T0 = 1_760_013_451_000;
const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

it('searches a session at its newest archived copy, before and after the index catches up', async () => {
  const root = mkdtempSync(join(tmpdir(), 'deep-archive-index-'));
  roots.push(root);
  const store = await openEvidenceStore({ root: join(root, 'evidence'), now: () => T0 });
  const record = await openRecord({ path: join(root, 'ledger.db'), now: () => T0, evidence: store });
  const S = 'sa1';
  const core: Connection = { writer: 'core', actor: 'you', scope: 'you', session: S };
  await record.append({ ...core, writer: 'hook' }, { v: 1, id: ulid(T0), kind: 'session.start', ts: T0, data: { agent: 'claude-code', worktree: '/tmp/shop', branch: 'main', thread: S } });
  const archive = async (at: number, text: string) => {
    const bytes = new Uint8Array(Buffer.from(`${JSON.stringify({ type: 'user', uuid: 'm1', message: { role: 'user', content: text } })}\n`));
    const put = await store.connect({ role: 'deepbuild', via: 'capture' }).put({ bytes, kind: 'transcript', source: 'claude-code', redaction: 'complete', license: { name: 'own', allows: [] } });
    if (put.status !== 'stored') throw Error('transcript not stored');
    await record.append(core, { v: 1, id: ulid(at), kind: 'transcript.archived', ts: at, data: { session: `session:${S}`, evidence: put.evidence.sha256 } });
  };
  const found = async (word: string) => {
    const reader = openRecordReader({ path: join(root, 'ledger.db'), evidence: store });
    try {
      return { store: (await record.findMessages([[foldText(word)]])).map((m) => `${m.session}#${m.id}`), reader: (await reader.findMessages([[foldText(word)]])).map((m) => `${m.session}#${m.id}`) };
    } finally { reader.close(); }
  };
  await archive(T0 + 1, 'the retryWithBackoffJitter fix');
  await record.indexTranscripts();
  expect(await found('BackoffJit'), 'the indexed copy is found by part of a word').toEqual({ store: [`${S}#m1`], reader: [`${S}#m1`] });
  await archive(T0 + 2, 'the pool fix, rewritten');
  expect(await found('BackoffJit'), 'the old copy\'s rows are not searched once a newer copy is archived').toEqual({ store: [], reader: [] });
  expect(await found('rewritten'), 'the newer copy, not yet indexed, is read from its transcript').toEqual({ store: [`${S}#m1`], reader: [`${S}#m1`] });
  await record.indexTranscripts();
  expect(await found('rewritten'), 'and once indexed, from the index').toEqual({ store: [`${S}#m1`], reader: [`${S}#m1`] });
  expect(await found('BackoffJit')).toEqual({ store: [], reader: [] });
  await record.close();
});
