import { describe, expect, it } from 'vitest';
import {
  ALPHA, DOC, IN_ALPHA, PANELS, PROCESSES, READ_CAP, SESSIONS, arr, asIssues, board, capFailures, chars, issueOrder, isObject, outcome, readEvidence,
  run, sorted, str, useEvidence, useShowBinary, type Issue, type JsonObject,
} from './helpers.ts';

useShowBinary();
const evidence = useEvidence();

const MARKS = 5_000;
/** Mark IDs `m-1` … `m-5000`: their code-point order (m-1, m-10, m-100 …) is not their number order. */
const IDS = Array.from({ length: MARKS }, (_, i) => `m-${i + 1}`);

/** 5,000 marks, none of them named, written in a seeded shuffle so input order is no order the reply keeps. */
function unnamedMarks(): JsonObject {
  const order = [...IDS];
  let seed = 393;
  for (let i = order.length - 1; i > 0; i--) {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    const j = seed % (i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const items = order.map((id) => {
    const n = Number(id.slice(2)) - 1;
    return { id, kind: 'rect@1', order: `a${String(n).padStart(4, '0')}`, params: { box: [(n % 100) * 10, Math.floor(n / 100) * 10, 8, 8], paint: { fill: { role: 'ink' } } } };
  });
  return board('Five thousand marks', [1000, 500], items);
}

const scenario = (calls: JsonObject[], planted?: string): JsonObject =>
  ({ evidence: evidence(), sessions: SESSIONS, processes: PROCESSES, panels: PANELS, docs: { [DOC.a]: { panel: 'main' } }, calls, ...(planted ? { planted } : {}) });
const viaMcp = (): JsonObject => ({ call: 'deep_show', session: ALPHA.id, doc: DOC.a, document: unnamedMarks(), include: ['issues'] });
const viaCli = (): JsonObject => ({ call: 'deep show', peer: IN_ALPHA, check: true, doc: DOC.a, document: unnamedMarks(), include: ['issues'] });

/** The full issue list the reply's evidence hash reads back to. */
async function fullList(reply: JsonObject): Promise<Issue[]> {
  const hash = str(reply['issues_evidence'], 'the reply\'s issues_evidence');
  const bytes = await readEvidence(evidence(), hash);
  return asIssues(arr(JSON.parse(bytes.toString('utf8')), 'the issue list read back'), 'the issue list read back');
}

/** Everything the criterion asks of a reply to the 5,000 unnamed marks. */
async function expectCapped(reply: JsonObject, what: string): Promise<void> {
  expect(outcome(reply), `${what}: the document is refused`).toBe('refused');
  const full = await fullList(reply);
  expect(full.length, `${what}: the full list read back from its evidence hash holds 5,000 issues`).toBe(MARKS);
  expect(sorted(full.flatMap((i) => i.ids)), `${what}: one issue per unnamed mark, each naming its mark`).toEqual(sorted(IDS));
  expect(full.filter((i) => i.severity === 'error').length, `${what}: an unnamed mark is an error, so the document is refused`).toBe(MARKS);
  const misordered = full.findIndex((issue, k) => k > 0 && issueOrder(full[k - 1]!, issue) > 0);
  expect(misordered, `${what}: the list is errors first, then by code and ID (first out of order at ${misordered})`).toBe(-1);
  expect(capFailures(reply, full), `${what}: inlined up to the read cap, with truncated`).toEqual([]);
  const truncated = reply['truncated'];
  expect(isObject(truncated) && truncated['total'], `${what}: the refusal counts all 5,000`).toBe(MARKS);
  const inline = arr(reply['issues'], 'issues').length;
  expect(inline, `${what}: some issues are inlined`).toBeGreaterThan(0);
  expect(inline, `${what}: not all of them`).toBeLessThan(MARKS);
}

describe('AC9 5,000 unnamed marks sent with deep_show are refused with 5,000 issues, inlined up to 8,192 characters, errors first then by code and ID, with truncated, and the full list reads back from its evidence hash', () => {
  it('AC9 deep_show\'s reply inlines issues up to the read cap, in order, adds truncated {shown, total: 5000, by_code}, and the full list reads back issue for issue', async () => {
    await expectCapped(run(scenario([viaMcp()])).replies[0]!, 'deep_show');
  }, 120_000);

  it('AC9 `deep show --check` replies the same way, and its check fails', async () => {
    const reply = run(scenario([viaCli()])).replies[0]!;
    await expectCapped(reply, 'deep show --check');
    expect(reply['result'], 'the check of a refused document fails').toBe('FAIL');
  }, 120_000);

  it('AC9 a reply that inlines every issue fails this test, naming the reply\'s size', async () => {
    const reply = run(scenario([viaMcp()], 'inlines_every_issue')).replies[0]!;
    const failures = capFailures(reply, await fullList(reply));
    expect(failures.length, 'the check fails on the planted reply').toBeGreaterThan(0);
    const size = chars(JSON.stringify(reply['issues']));
    expect(size, 'the planted reply really is over the cap').toBeGreaterThan(READ_CAP);
    expect(failures.join('\n'), 'naming the reply\'s size').toContain(String(size));
  }, 120_000);

  it('AC9 a reply that cuts with no truncated fails this test, naming the missing field', async () => {
    const reply = run(scenario([viaMcp()], 'cuts_without_truncated')).replies[0]!;
    const failures = capFailures(reply, await fullList(reply));
    expect(failures.length, 'the check fails on the planted reply').toBeGreaterThan(0);
    expect(failures.join('\n'), 'naming the missing field').toContain('no truncated field');
  }, 120_000);
});
