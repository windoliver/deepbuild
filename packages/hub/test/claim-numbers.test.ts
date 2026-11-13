// A stated speed through its timing check, and the terms a claim adds on its sample, as the hub runs them (#1863):
// each side's steps through the real supervisor, the timing check and the sample read from the merge base in a real
// bare store that reads the repo's objects as alternates, as the hub's does. The blind suite (tests/acceptance/1863)
// proves the FAILs through deep_claim; these hold what it leaves out: a check the change brings judges nothing, a step
// that fails is a crash rather than a repeat, a missing sample is BLOCKED rather than passed, and the sample the
// terms run on is the merge base's, untouched.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { numbersFill } from '@deepbuild/checks-numbers';
import { openAsks } from '@deepbuild/asks';
import { openRecord, type RecordStore } from '@deepbuild/record';
import { openSupervisor, type Supervisor } from '@deepbuild/supervisor';
import { numbersChecks, runClaimNumbers, type TermsSpec } from '../src/claim-numbers.js';
import type { ClaimRepo, SpeedSpec } from '../src/speed.js';

let dir: string;
let record: RecordStore;
let sup: Supervisor;
let n = 0;
beforeAll(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-claim-numbers-')));
  record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 172_800_000 } } } });
});
afterAll(async () => {
  await sup?.close();
  await record?.close();
  rmSync(dir, { recursive: true, force: true });
}, 60_000);

const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' }).trim();
const write = (root: string, files: Record<string, string>): void => {
  for (const [path, text] of Object.entries(files)) { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), text); }
};
/** A repo whose base commit holds `files`, a bare store reading its objects, and the repo's checkouts of a commit by `git archive`. */
function repo(files: Record<string, string>): { root: string; base: string; claimRepo: ClaimRepo; commit(files: Record<string, string>): string } {
  const root = join(dir, `repo-${n++}`);
  mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  write(root, files);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  const store = join(dir, `store-${n++}`);
  git(dir, 'init', '-q', '--bare', store);
  writeFileSync(join(store, 'objects', 'info', 'alternates'), `${join(root, '.git', 'objects')}\n`);
  const claimRepo: ClaimRepo = {
    supervisor: sup, store,
    checkoutOf: async (commit) => {
      const out = join(dir, `checkout-${n++}`);
      mkdirSync(out);
      execFileSync('sh', ['-c', `git archive ${commit} | tar -x -C '${out}'`], { cwd: root });
      return { dir: out, ended: async () => rmSync(out, { recursive: true, force: true }) };
    },
  };
  return {
    root, base: git(root, 'rev-parse', 'HEAD'), claimRepo,
    commit: (more) => { write(root, more); git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'change'); return git(root, 'rev-parse', 'HEAD'); },
  };
}
const ctx = (checkout: string) => ({ checkout, deadline: 120_000, now: () => Date.now() });
const numbers = async (spec: Parameters<ReturnType<typeof numbersFill>['run']>[0], c: Parameters<ReturnType<typeof numbersFill>['run']>[1]) => numbersFill().run(spec, c);

const TOOLCHAIN = { compiler: 'sh-1', driver: 'none-1', runtime: 'sleep-1' };
const bench = (work: string) => `#!/bin/sh\ncd "$(dirname "$0")" || exit 2\ncase "$1" in\n  warmup) : ;;\n  flush) exit 0 ;;\n  work) ${work} ;;\n  report) printf '%s\\n' '${JSON.stringify({ toolchain: TOOLCHAIN, machine: 'm-1' })}' ;;\nesac\n`;
const timing = (repeats = 2) => `${JSON.stringify({ repeats, machine: 'm-1', toolchain: { baseline: TOOLCHAIN, change: TOOLCHAIN }, warmup: 'sh bench.sh warmup', flush: 'sh bench.sh flush', work: 'sh bench.sh work', report: 'sh bench.sh report' })}\n`;
const speedSpec = (base: string, stated = '1.8× faster than the merge base', file = '.deepbuild/timing/speed.json'): SpeedSpec =>
  ({ kind: 'numbers', runner: 'timing', inputs: [file], depth: 'unit', oracle: 'code', contract: null, stated, file, base });

describe('a stated speed through its timing check', () => {
  it('is read from the claim\'s words with the timing check it cites, in plain words or backticks', async () => {
    const r = repo({ 'a.txt': 'a\n' });
    const checks = await numbersChecks('It is 1.8× faster than the merge base (timing check .deepbuild/timing/speed.json), and 40 µs at batch 8 (timing check `bench/batch.json`).', r.root, r.base, null);
    expect(checks.map((c) => [c.check.check, c.check.source, c.check.on_base, c.check.covers])).toEqual([
      ['speed: 1.8× faster than the merge base (.deepbuild/timing/speed.json)', 'definition', 'passes', []],
      ['speed: 40 µs at batch 8 (bench/batch.json)', 'definition', 'passes', []],
    ]);
    expect(checks.every((c) => c.spec.runner === 'timing' && (c.spec as SpeedSpec).base === r.base), 'its default baseline is the claim\'s merge base').toBe(true);
    expect(await numbersChecks('It is faster now.', r.root, r.base, null)).toEqual([]);
  });
  // Each repeat's time counts its step's launch through the supervisor (#87 times the work as the platform runs it):
  // 2 s against 0.1 s reaches 1.2× while a launch takes under 9 s, as it does on a machine loaded far past its cores.
  it('passes where every repeat reaches the stated factor', async () => {
    const r = repo({ 'bench.sh': bench('sleep "$(cat delay)"'), delay: '2\n', '.deepbuild/timing/speed.json': timing() });
    r.commit({ delay: '0.1\n' });
    const result = await runClaimNumbers(speedSpec(r.base, '1.2× faster than the merge base'), ctx(r.root), r.claimRepo, numbers);
    expect([result.outcome, result.speed?.outcome], JSON.stringify(result)).toEqual(['passed', 'counts']);
  }, 120_000);
  it('judges nothing by a timing check the change brings: INVALID, naming that the merge base lacks it', async () => {
    const r = repo({ 'bench.sh': bench('sleep "$(cat delay)"'), delay: '1\n' });
    r.commit({ delay: '0.2\n', '.deepbuild/timing/speed.json': timing() });
    const result = await runClaimNumbers(speedSpec(r.base), ctx(r.root), r.claimRepo, numbers);
    expect([result.outcome, result.speed?.outcome], JSON.stringify(result)).toEqual(['uncounted', 'INVALID']);
    expect(result.speed?.reasons.join('\n')).toMatch(/isn't in the merge base/);
  }, 60_000);
  it('is a crash, never a timed repeat, where a side\'s work exits other than 0', async () => {
    const r = repo({ 'bench.sh': bench('exit 3'), '.deepbuild/timing/speed.json': timing() });
    const result = await runClaimNumbers(speedSpec(r.base), ctx(r.root), r.claimRepo, numbers);
    expect(result.outcome, JSON.stringify(result)).toBe('failed');
    expect(result.failures[0]).toMatchObject({ assertion: false });
    expect(result.failures[0]!.message).toMatch(/side's work .* exited 3/);
  }, 120_000);
  it('is a reading where a side reports another machine than its timing check names', async () => {
    const r = repo({ 'bench.sh': bench('sleep 0.1').replace("'m-1'", "'m-2'").replace('"machine":"m-1"', '"machine":"m-2"'), '.deepbuild/timing/speed.json': timing() });
    const result = await runClaimNumbers(speedSpec(r.base), ctx(r.root), r.claimRepo, numbers);
    expect([result.outcome, result.speed?.outcome], JSON.stringify(result)).toEqual(['uncounted', 'reading']);
    expect(result.speed?.reasons.join('\n')).toMatch(/ran on m-2, where the check names m-1/);
  }, 120_000);
});

describe('the terms a claim adds, on its definition\'s sample', () => {
  const BASE = 'SELECT id, total FROM orders WHERE total > 0 ORDER BY id\n';
  const sample = (root: string, statuses: string[]): void => {
    mkdirSync(join(root, 'data'), { recursive: true });
    const db = new DatabaseSync(join(root, 'data/orders.db'));
    db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, total INTEGER NOT NULL, status TEXT NOT NULL)');
    for (const [i, s] of statuses.entries()) db.prepare('INSERT INTO orders (total, status) VALUES (?, ?)').run((i + 1) * 5, s);
    db.close();
  };
  const termsOf = async (r: ReturnType<typeof repo>): Promise<TermsSpec> => {
    const [check] = await numbersChecks('The query skips voided orders.', r.root, r.base, 'data/orders.db');
    expect(check?.spec.runner, 'the diff adds a filter on a definition with a sample').toBe('terms');
    return check!.spec as TermsSpec;
  };
  it('fails, showing the sample, where the filter changes none of its rows; passes where it changes one', async () => {
    const r = repo({ 'queries/paid.sql': BASE });
    sample(r.root, ['paid', 'paid']);
    git(r.root, 'add', '-A');
    git(r.root, 'commit', '-q', '-m', 'sample');
    const base = git(r.root, 'rev-parse', 'HEAD');
    writeFileSync(join(r.root, 'queries/paid.sql'), BASE.replace('total > 0', "total > 0 AND status <> 'void'"));
    const spec = await termsOf({ ...r, base });
    const failed = await runClaimNumbers(spec, ctx(r.root), r.claimRepo, numbers);
    expect(failed.outcome, JSON.stringify(failed)).toBe('failed');
    expect(failed.failures[0]!.message).toMatch(/the filter status <> 'void' changes no result on the sample data\/orders.db: \[\{"id":1,"total":5\},\{"id":2,"total":10\}\]/);

    const v = repo({ 'queries/paid.sql': BASE });
    sample(v.root, ['paid', 'void']);
    git(v.root, 'add', '-A');
    git(v.root, 'commit', '-q', '-m', 'sample');
    writeFileSync(join(v.root, 'queries/paid.sql'), BASE.replace('total > 0', "total > 0 AND status <> 'void'"));
    const passed = await runClaimNumbers(await termsOf({ ...v, base: git(v.root, 'rev-parse', 'HEAD') }), ctx(v.root), v.claimRepo, numbers);
    expect(passed.outcome, JSON.stringify(passed)).toBe('passed');
  }, 60_000);
  it('runs on the sample as the merge base holds it: one the change rewrote, or never committed, is never what the terms are judged on', async () => {
    const r = repo({ 'queries/paid.sql': BASE });
    sample(r.root, ['paid', 'void']);
    git(r.root, 'add', '-A');
    git(r.root, 'commit', '-q', '-m', 'sample');
    const base = git(r.root, 'rev-parse', 'HEAD');
    const bytes = readFileSync(join(r.root, 'data/orders.db'));
    // The change rewrites the sample so the filter would change nothing on it, and adds the filter.
    rmSync(join(r.root, 'data/orders.db'));
    sample(r.root, ['paid', 'paid']);
    writeFileSync(join(r.root, 'queries/paid.sql'), BASE.replace('total > 0', "total > 0 AND status <> 'void'"));
    const result = await runClaimNumbers(await termsOf({ ...r, base }), ctx(r.root), r.claimRepo, numbers);
    expect(result.outcome, JSON.stringify(result)).toBe('passed');
    expect(Buffer.compare(execFileSync('git', ['cat-file', 'blob', `${base}:data/orders.db`], { cwd: r.root }), bytes), 'the merge base\'s sample is untouched').toBe(0);

    const missing = repo({ 'queries/paid.sql': BASE });
    writeFileSync(join(missing.root, 'queries/paid.sql'), BASE.replace('total > 0', "total > 0 AND status <> 'void'"));
    const blocked = await runClaimNumbers(await termsOf(missing), ctx(missing.root), missing.claimRepo, numbers);
    expect(blocked.outcome, JSON.stringify(blocked)).toBe('missing');
    expect(blocked.failures[0]!.message).toMatch(/the sample data\/orders.db the definition names isn't a file in the merge base/);
  }, 60_000);
  it('keeps a failure on a large sample within what the record holds of a finding, naming the filter and the sample', async () => {
    const r = repo({ 'queries/paid.sql': BASE });
    sample(r.root, Array.from({ length: 2000 }, () => 'paid'));
    git(r.root, 'add', '-A');
    git(r.root, 'commit', '-q', '-m', 'sample');
    const base = git(r.root, 'rev-parse', 'HEAD');
    writeFileSync(join(r.root, 'queries/paid.sql'), BASE.replace('total > 0', "total > 0 AND status <> 'void'"));
    const result = await runClaimNumbers(await termsOf({ ...r, base }), ctx(r.root), r.claimRepo, numbers);
    expect(result.outcome, JSON.stringify(result).slice(0, 500)).toBe('failed');
    const [f] = result.failures;
    // run.finished@2 holds each finding, `<test> (<file>:<line>): <message>`, in at most 8192 characters.
    expect(`${f!.test} (${f!.file}:${f!.line}): ${f!.message}`.length).toBeLessThanOrEqual(8192);
    expect(f!.message).toMatch(/^the filter status <> 'void' changes no result on the sample data\/orders.db: \[\{"id":1,"total":5\}/);
  }, 60_000);
});
