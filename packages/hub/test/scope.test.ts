// Size and scope spends nothing it can't deliver (#324 beside #325): a stop whose send-back a question holds, or whose
// reply can no longer carry one, records its reading and sends nothing back, so the one send-back is still there for
// a later stop. On a real git repository and a real record; the change is twenty times the usual size.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openRecord, ulid, type RecordStore as Ledger } from '@deepbuild/record';
import { SizeScope } from '../src/scope.js';

const made: string[] = [];
const open: Ledger[] = [];
afterEach(async () => {
  for (const r of open.splice(0)) await r.close();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('#324 a held stop, or one past its reply, sends nothing back and spends nothing; the next stop sends the size back', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'scope324-')));
  made.push(dir);
  const repo = join(dir, 'repo');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=T', '-c', 'user.email=t@example.test', ...args], { cwd: repo, encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  writeFileSync(join(repo, 'a.js'), 'a\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  // Three accepted feature changes of 2 lines in 1 file: the usual size.
  const accepted = [1, 2, 3].map((n) => {
    const base = git('rev-parse', 'HEAD');
    writeFileSync(join(repo, `f${n}.js`), 'x\ny\n');
    git('add', '-A');
    git('commit', '-q', '-m', `feat: ${n}`);
    return { repo, kind: 'feature', base, commit: git('rev-parse', 'HEAD'), accepted_at: n };
  });
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(dir, 'accepted.json'), JSON.stringify({ accepted }));
  writeFileSync(join(repo, 'big.js'), Array.from({ length: 40 }, (_, i) => `exports.v${i} = ${i};`).join('\n') + '\n');

  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  open.push(record);
  const scope = new SizeScope({
    raw: (query, params) => record.raw(query, params), append: async (connection, input) => { await record.append(connection, input); },
    connection: (session) => ({ writer: 'core', actor: 'you', scope: 'you', session }), now: Date.now,
    asks: () => { throw Error('no ask is raised in this test'); }, pin: async () => ({ kind: 'evidence', ref: '0'.repeat(64) }), keep: async () => '0'.repeat(64),
    scopeOf: async () => ({ kind: 'feature', plan: null }), evidence: dir, accepted: join(dir, 'accepted.json'),
  });
  const task = `task:${ulid(Date.now())}`;
  const at = (o: { holds: boolean; deadline: number }) => scope.atStop({ claim: `claim:${ulid(Date.now())}`, task, session: 'session-1', agent: 'claude-code', cwd: repo, base, requirements: [], reached: [], ...o });
  const sized = async () => ((await record.raw(`SELECT data FROM events WHERE kind = 'claim.sized' ORDER BY log_pos`)) as { data: string }[]).map((r) => JSON.parse(r.data) as { over: boolean; usual: unknown; sent_back: string[] });

  // A question holds the send-back: measured and recorded, nothing sent or spent.
  expect(await at({ holds: true, deadline: Date.now() + 60_000 })).toBeUndefined();
  // The reply's time is past: the same.
  expect(await at({ holds: false, deadline: Date.now() - 1 })).toBeUndefined();
  // Neither: the size goes back once, with the numbers.
  const back = await at({ holds: false, deadline: Date.now() + 60_000 });
  expect(back).toContain('40 lines changed (40 added, 0 removed) over 1 files, against a usual 2 lines over 1 files');
  expect(back).toContain('Cut it to what the issue needs, or say why each part is needed.');
  const readings = await sized();
  expect(readings.map((r) => [r.over, r.sent_back])).toEqual([[true, []], [true, []], [true, ['size']]]);
  expect(readings[0]!.usual).toEqual({ lines: 2, files: 1, n: 3 });
});
