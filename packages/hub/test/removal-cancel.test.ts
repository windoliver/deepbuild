// #2077: cancelling after an adopt is recorded, but before replacement, must stay cancelled after restart.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, lstatSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openEvidenceStore } from '@deepbuild/evidence';
import { openRecord, ulid } from '@deepbuild/record';
import { RemovalApplication } from '../src/removal-application.js';
import { disk } from '../src/vfs.js';

it('a cancellation at durable intent leaves the file and cannot apply on recovery', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'removal-cancel-')));
  const repo = join(dir, 'repo'), evidence = join(dir, 'evidence'); mkdirSync(repo);
  const path = join(repo, 'AGENTS.md'); writeFileSync(path, '- rule\n');
  const store = await openEvidenceStore({ root: evidence });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now, evidence: store });
  const signal = new AbortController();
  const job = `run:${ulid(Date.now())}`;
  const services = { record, store, root: { evidence }, now: Date.now, durable: { ...disk, point: (kind: string) => { if (kind === 'sync_intent') signal.abort(); } } };
  try {
    await record.append({ writer: 'core', actor: 'you', scope: 'you' }, { v: 1, id: ulid(Date.now()), ts: Date.now(), kind: 'job.recorded', subject: job, data: { job, kind: 'eval', agent: 'claude-code', account: null, folder: dir, prompt: 'a'.repeat(64), waiting: [] } });
    const app = new RemovalApplication(() => services);
    const report = await app.keep(job, { after: { outcome: 'adopt' } }, 'configuration-result');
    const original = lstatSync(path);
    await expect(app.apply({ job, lesson: { id: 'lesson-cancel', text: 'rule', scope: 'all' }, repo, file: 'AGENTS.md', before: '- rule\n', after: '', original: { dev: original.dev, ino: original.ino }, report }, signal.signal)).rejects.toThrow();
    expect(readFileSync(path, 'utf8')).toBe('- rule\n');
    await new RemovalApplication(() => ({ ...services, durable: disk })).recover();
    expect(readFileSync(path, 'utf8')).toBe('- rule\n');
    expect(await record.raw("SELECT 1 FROM events WHERE kind = 'decision.created' AND subject = ?", [job])).toEqual([]);
  } finally { await record.close(); rmSync(dir, { recursive: true, force: true }); }
}, 60_000);
