// #28 verdicts in the record (packages/record's public entry, a ledger in a temp folder): AC4 (recorded),
// AC25 and AC30.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { markStale, recordVerdict, selectReruns, verdict, verdictHash } from '../../../packages/verdicts/src/index.ts';
import type { ClaimCheck, Run } from '../../../packages/verdicts/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { Connection, RecordStore, Row } from '../../../packages/record/src/index.ts';
import { referenceSelect } from './reference.ts';
import { check, claim, commitOf, DAY, reqId, requirement, run, selectionProblems, T0, ulidAt } from './helpers.ts';

const roots: string[] = [];
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });
async function open(): Promise<RecordStore> {
  const dir = mkdtempSync(join(tmpdir(), 'deep-verdicts-28-'));
  roots.push(dir);
  let t = T0;
  return openRecord({ path: join(dir, 'record.db'), now: () => (t += 1) });
}
const YOU = { actor: 'you', scope: 'you' };
const APP: Connection = { writer: 'app', ...YOU };
const CORE: Connection = { writer: 'core', ...YOU };
const TASK = 'task:01K74FX2B4D6F8H0K2M4P6R8T0';
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const canon = (rows: Row[]): string => JSON.stringify(rows, (_, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v));

async function claimMade(record: RecordStore, at: number, commit: string): Promise<string> {
  const id = ulidAt(at);
  await record.append(APP, { v: 1, id, kind: 'claim.made', ts: at, data: { task_ref: TASK, attempt: 1, commit, scope: 'session' } });
  return id;
}
async function recordRun(record: RecordStore, r: Run): Promise<void> {
  const at = r.ended;
  await record.append(CORE, { v: 1, id: ulidAt(at - 1), kind: 'run.started', ts: at - 1, data: { run: r.run, check: r.check, claim: r.claim, commit: r.commit } });
  await record.append(CORE, {
    v: 1, id: ulidAt(at), kind: 'run.finished', ts: at,
    data: { run: r.run, outcome: r.outcome, tests_run: r.tests_run, passed: r.outcome === 'passed' ? r.tests_run : 0, runs: 1, evidence: [], check: r.check, assertion: null, expected: null, actual: null, step: null, points_to: null, findings: [], environment: 'darwin-arm64' },
  });
}
async function rows(record: RecordStore, table: string, test: (row: Row) => boolean): Promise<Row[]> {
  return (await record.table(table)).rows.filter(test);
}
const claimRow = async (record: RecordStore, id: string): Promise<Row> => {
  const found = await rows(record, 'claims', (r) => str(r.id) === id);
  expect(found, `claims has ${id}`).toHaveLength(1);
  return found[0]!;
};

describe('AC4 a new commit makes the recorded verdict stale', () => {
  it('AC4 markStale appends verdict.stale on another commit, and the row reads stale; on its own commit it appends nothing', async () => {
    const record = await open();
    const P = commitOf('parent'), N = commitOf('next');
    const claimId = await claimMade(record, T0, P);
    const c = check('unit');
    const v = verdict(claim({ claim: `claim:${claimId}`, commit: P, checks: [c], runs: [run(c, P, 'passed')] }));
    const rec = await recordVerdict(record, v, T0 + 10);
    expect(await markStale(record, rec, v, P, T0 + 20)).toBe(false);
    expect(await markStale(record, rec, v, N, T0 + 30)).toBe(true);
    const [row] = await rows(record, 'verdicts', (r) => str(r.id) === rec.id);
    expect(Number(row!.stale)).toBe(1);
    await record.close();
  });
});

describe('AC25 a verdict that rises adds a row and never edits one', () => {
  it('AC25 BLOCKED at once on a missing secret, then FAIL when the unit check fails every real run: two rows, the BLOCKED one as it was, and verdict_id names the FAIL', async () => {
    const record = await open();
    const D = commitOf('D-25');
    const claimId = await claimMade(record, T0, D);
    const handle = `claim:${claimId}`;
    const pay = check('journey:pay', { covers: [reqId(1)] });
    const unit = check('unit', { covers: [reqId(2)] });
    const reqs = [requirement(1), requirement(2)];
    const secret = run(pay, D, 'missing', { claim: handle });
    const blocked = verdict(claim({ claim: handle, commit: D, requirements: reqs, checks: [pay, unit], runs: [secret] }));
    expect(blocked.outcome).toBe('BLOCKED');
    const first = await recordVerdict(record, blocked, T0 + 10);
    const blockedRow = canon(await rows(record, 'verdicts', (r) => str(r.id) === first.id));

    const failed = verdict(claim({ claim: handle, commit: D, requirements: reqs, checks: [pay, unit], runs: [secret, run(unit, D, 'failed', { claim: handle })] }));
    expect(failed.outcome).toBe('FAIL');
    const second = await recordVerdict(record, failed, T0 + 20);
    expect(second.id).not.toBe(first.id);

    const mine = await rows(record, 'verdicts', (r) => str(r.claim_id) === claimId);
    expect(mine.map((r) => str(r.outcome)).sort(), `claim ${claimId} keeps both verdict rows`).toEqual(['BLOCKED', 'FAIL']);
    expect(canon(await rows(record, 'verdicts', (r) => str(r.id) === first.id)), `claim ${claimId}: the BLOCKED row stays as it was`).toBe(blockedRow);
    expect(str((await claimRow(record, claimId)).verdict_id), `claim ${claimId}: verdict_id names the FAIL`).toBe(second.id);
    await record.close();
  });
});

describe('AC30 a result whose evidence retention removed is never reused', () => {
  it('AC30 35 days on, a new claim at D runs A again instead of carrying it; its FAIL lands on the new claim, and the old claim\'s verdict row, runs and verdict hash are unchanged', async () => {
    const record = await open();
    const C = commitOf('C-30'), D = commitOf('D-30');
    const A: ClaimCheck = check('A', { inputs: ['src/**'], covers: [reqId(1)] });
    const B: ClaimCheck = check('B', { inputs: ['docs/**'], covers: [reqId(2)] });
    const reqs = [requirement(1), requirement(2)];

    const oldId = await claimMade(record, T0, C);
    const oldHandle = `claim:${oldId}`;
    const aAtC = run(A, C, 'passed', { claim: oldHandle, ended: T0 + 5 });
    const bAtC = run(B, C, 'passed', { claim: oldHandle, ended: T0 + 7 });
    await recordRun(record, aAtC);
    await recordRun(record, bAtC);
    const oldVerdict = verdict(claim({ claim: oldHandle, commit: C, requirements: reqs, checks: [A, B], runs: [aAtC, bAtC] }));
    expect(oldVerdict.outcome).toBe('PASS');
    const oldRec = await recordVerdict(record, oldVerdict, T0 + 10);
    const oldHash = verdictHash(oldVerdict);
    const before = {
      verdicts: canon(await rows(record, 'verdicts', (r) => str(r.claim_id) === oldId)),
      runs: canon(await rows(record, 'runs', (r) => str(r.claim_id) === oldId)),
      claim: str((await claimRow(record, oldId)).verdict_id),
    };
    expect(before.claim).toBe(oldRec.id);

    // 35 days later retention has removed A's evidence. D changes docs/guide.md, which no path A reads.
    const later = T0 + 35 * DAY;
    const newId = await claimMade(record, later, D);
    const newHandle = `claim:${newId}`;
    const aGone = { ...aAtC, kept: false };
    const atD = claim({ claim: newHandle, commit: D, requirements: reqs, checks: [A, B], runs: [aGone, bAtC], changes: [{ from: C, paths: ['docs/guide.md'] }], now: later });
    const sel = selectReruns(atD);
    expect(selectionProblems(sel, ['A'], []), `claim ${newHandle}: A runs again`).toEqual([]);
    expect(sel.kept.A ?? []).not.toContain(aAtC.run);
    expect(selectionProblems(referenceSelect(atD, 'carry-removed-evidence'), ['A'], []), 'an engine that carries A to D').toEqual(['A must run again']);

    const aAtD = run(A, D, 'failed', { claim: newHandle, ended: later + 5 });
    const bAtD = run(B, D, 'passed', { claim: newHandle, ended: later + 6 });
    await recordRun(record, aAtD);
    await recordRun(record, bAtD);
    const newVerdict = verdict({ ...atD, runs: [aGone, bAtC, aAtD, bAtD] });
    expect(newVerdict.outcome).toBe('FAIL');
    expect(newVerdict.claim).toBe(newHandle);
    const newRec = await recordVerdict(record, newVerdict, later + 10);

    expect(str((await claimRow(record, newId)).verdict_id), `claim ${newHandle} names its FAIL`).toBe(newRec.id);
    expect(str((await claimRow(record, oldId)).verdict_id), `claim ${oldHandle} keeps its verdict`).toBe(before.claim);
    expect(canon(await rows(record, 'verdicts', (r) => str(r.claim_id) === oldId)), `claim ${oldHandle}: its verdict row is unchanged`).toBe(before.verdicts);
    expect(canon(await rows(record, 'runs', (r) => str(r.claim_id) === oldId)), `claim ${oldHandle}: its runs are unchanged`).toBe(before.runs);
    expect(verdictHash(oldVerdict), `claim ${oldHandle}: its verdict record hash is unchanged`).toBe(oldHash);
    expect(verdictHash(newVerdict)).not.toBe(oldHash);
    await record.close();
  });
});
