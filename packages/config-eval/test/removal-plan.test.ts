// #2077: the structural removal's planning cohort is fixed by archive order before any replay; other repos never join.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { removalPlan } from '@deepbuild/config-eval';
import { openEvidenceStore } from '@deepbuild/evidence';
import { openRecord, openRecordReader, ulid } from '@deepbuild/record';

it('selects only same-repo held-out tasks with the exact candidate, three repeats and four earlier readings', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'removal-plan-')));
  const repo = join(root, 'repo'), other = join(root, 'other'), file = 'AGENTS.md';
  const at = Date.UTC(2026, 0, 1);
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: new Date(at).toISOString(), GIT_COMMITTER_DATE: new Date(at).toISOString() } });
  for (const cwd of [repo, other]) { mkdirSync(cwd); writeFileSync(join(cwd, file), '- rule\n'); git(cwd, 'init', '-q', '-b', 'main'); git(cwd, 'add', '.'); git(cwd, 'commit', '-qm', 'base'); }
  const store = await openEvidenceStore({ root: join(root, 'evidence') });
  const record = await openRecord({ path: join(root, 'ledger.db'), evidence: store, now: Date.now });
  const ids: string[] = [];
  try {
    for (let i = 0; i < 26; i++) {
      const ts = at + (i + 1) * 1000, session = ulid(ts), cwd = i < 25 ? repo : other;
      const prompt = i === 24 ? 'Build an evaluation experiment.' : `Repair item ${i}.`;
      ids.push(`session:${session}#m${i}`);
      const handle = await record.keep({ writer: 'core', actor: 'you', scope: 'you' }, { bytes: Buffer.from(JSON.stringify({ type: 'user', uuid: `m${i}`, timestamp: new Date(ts).toISOString(), cwd, gitBranch: 'main', message: { role: 'user', content: prompt } }) + '\n'), kind: 'transcript', source: 'fixture' });
      await record.append({ writer: 'app', actor: 'you', scope: 'you' }, { v: 1, id: ulid(ts), ts, kind: 'transcript.archived', data: { session: `session:${session}`, evidence: handle.slice(3) } });
    }
    const reader = openRecordReader({ path: join(root, 'ledger.db'), evidence: store });
    try {
      const input = await removalPlan(reader, (sha) => store.read(sha), { id: 'eval1', repo, file, before: '- rule\n', after: '' });
      expect(input.plan.tasks).toEqual(ids.slice(4, 24).reverse());
      expect(input.plan.fitted).toEqual(ids.slice(0, 4).reverse());
      expect(input.plan.repeats).toBe(3);
      expect(input.plan.variants).toEqual({ base: { name: 'current rule file', files: { [file]: '- rule\n' } }, change: { name: 'removal', files: { [file]: '' } } });
      expect(input.tasks.filter((t) => input.plan.tasks.includes(t.id)).every((t) => t.at > input.plan.cutoff)).toBe(true);
      expect(readFileSync(join(repo, file), 'utf8')).toBe('- rule\n');
    } finally { reader.close(); }
  } finally { await record.close(); rmSync(root, { recursive: true, force: true }); }
}, 60_000);
