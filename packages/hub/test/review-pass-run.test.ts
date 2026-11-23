// A review pass's run through the hub's kinds (#2748), on a real git repository with the second model's jobs stood in
// for: each ask is a runner job of its own, holding the pass's prompt and one diff, and naming the claim's task as the
// issue whose budget covers it (#325); a replay the record keeps for the answering model isn't asked again. A wrong
// run bills a pass outside the issue's budget, or asks the second model again for a replay it already holds.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import type { CheckSpec } from '@deepbuild/conformance';
import type { JobRecord, JobSpec } from '@deepbuild/runner';
import type { KindsOptions } from '../src/checks-port.js';
import { openKinds } from '../src/kinds.js';

const dir = mkdtempSync(join(tmpdir(), 'deep-pass-run-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const git = (...args: string[]): string => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: dir, env, encoding: 'utf8' }).trim();
function commit(file: string, text: string): string {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), text);
  git('add', '-A');
  git('commit', '-qm', file);
  return git('rev-parse', 'HEAD');
}

it('a pass asks once for the claim and once for each PR it found bugs in, each job under the issue\'s budget, and reads a kept replay as carried', async () => {
  git('init', '-q');
  const first = commit('README.md', '# shop\n');
  const merged = commit('src/old.ts', 'export const a = JSON.parse(raw);\n');
  const base = commit('src/keep.ts', 'export const keep = 1;\n');
  const head = commit('src/new.ts', 'export const b = JSON.parse(raw);\n');
  writeFileSync(join(dir, 'session.jsonl'), `${JSON.stringify({ message: { model: 'claude-haiku-5-5' } })}\n`);

  // The second model: one finding at line 1 of the file its diff adds, answered by another model than the session's.
  const sent: JobSpec[] = [];
  const submit = async (spec: JobSpec): Promise<JobRecord> => {
    sent.push(spec);
    const file = /^\+\+\+ b\/(\S+)$/m.exec(spec.prompt)![1]!;
    return { job: `run:${sent.length}`, state: 'finished', model: 'claude-sonnet-5-5', result: JSON.stringify({ findings: [{ file, line: 1, rule: 'unchecked-parse', quote: 'JSON.parse(raw)' }] }) } as unknown as JobRecord;
  };
  const kinds = await openKinds({ submit, wait: submit, cancel: submit, plant: undefined, store: dir, extensions: () => undefined } as unknown as KindsOptions);
  const pass = { id: 'audit', name: 'a code audit', prompt: 'Audit the change for unchecked input.', found: [{ pr: 12, base: first, head: merged, bugs: [{ file: 'src/old.ts', line: 1 }] }] };
  const spec = { kind: 'review', runner: 'second-model', inputs: [], depth: 'unit', oracle: 'model', contract: null, base, head, rubric: '', since: null, pass, out: ['research'] } as unknown as CheckSpec;
  const of = { claim: 'claim:01', task: 'task:01', agent: 'claude-code', transcript: join(dir, 'session.jsonl') };
  const ctx = { checkout: dir, deadline: 60_000, now: Date.now };

  const ran = await kinds.run(spec, ctx, { ...of, kept: async () => undefined });
  expect(sent.map((s) => /^\+\+\+ b\/(\S+)$/m.exec(s.prompt)![1])).toEqual(['src/new.ts', 'src/old.ts']);
  for (const s of sent) expect(s).toMatchObject({ kind: 'review', task: 'task:01', claim: 'claim:01', issue: 'task:01' });
  for (const s of sent) expect(s.prompt.startsWith(pass.prompt)).toBe(true);
  expect(ran.outcome).toBe('failed');
  expect(ran.pass).toMatchObject({ pass: 'audit', model: 'claude-sonnet-5-5', sent: [{ rule: 'audit', sites: [{ file: 'src/new.ts', line: 1, quote: 'JSON.parse(raw)' }] }], follow_ups: [], replays: [{ pr: 12, head: merged, found: 1, of: 1 }] });
  expect(ran.pass!.replays[0]!.carried).toBeUndefined();
  expect(ran.evidence.join('\n')).toMatch(/out of scope[^\n]*research/);

  // The record keeps that replay for the model that answered: the next run asks for its own diff alone.
  const key = ran.pass!.replays[0]!.key;
  const again = await kinds.run(spec, ctx, { ...of, kept: async (k, model) => (k === key && model === 'claude-sonnet-5-5' ? 1 : undefined) });
  expect(sent.length).toBe(3);
  expect(again.pass!.replays).toEqual([{ pr: 12, head: merged, key, found: 1, of: 1, carried: true }]);
});
