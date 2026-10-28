// AC1 (#403.b719566f): "A PASS on a document that is the work goes stale when any writer's patch makes a new
// revision of it, as a new commit would, and the verdict's key names that revision's hash"
//
// asserts: alpha's claim names the stored checks board as its deliverable, with one requirement whose check
// input is `document.validate`. Judged on revision 0, the claim is PASS, not stale, and its key names the
// board at revision 0's hash (as `revisions` gives it). Then one writer's patch, yours, alpha's or bravo's,
// is applied and makes a new current revision with another hash; the claim's verdicts then list that PASS
// as stale, its key still naming revision 0's hash, and a verdict made after the patch is PASS, keyed by
// the new revision's hash and not stale (`staleFailures`). Without a patch the PASS stays fresh. The planted
// `verdict_keyed_by_doc`, a key naming the document but not its revision, fails `staleFailures`, naming the
// patch.

import { describe, expect, it } from 'vitest';
import {
  ALPHA, BRAVO, DOC, FULL, WORK_ITEMS, YOU_PEER, claim, claimId, current, failsNaming, none, outcome, patchId, rect, requirement, run,
  scenario, staleFailures, storedBoard, useBuilds, useEvidence, verdictList, verdictOf,
  type JsonObject,
} from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();

const CLAIM = claimId(1);
const REQ = requirement(1, { kind: 'document.validate' });
const claims = { [CLAIM]: claim([DOC.a], [REQ]) };
const docs = { [DOC.a]: { panel: 'main', document: storedBoard(WORK_ITEMS) } };

interface Writer { label: string; patch: string; call: (patch: JsonObject) => JsonObject; ops: JsonObject[] }
const WRITERS: Writer[] = [
  {
    label: 'your', patch: patchId(1), call: (patch) => ({ call: 'deep show', peer: YOU_PEER, doc: DOC.a, patch }),
    ops: [{ op: 'set', id: 'you.y-label', path: 'items/you.y-label/params/text', value: 'Checks run' }],
  },
  {
    label: "alpha's", patch: patchId(2), call: (patch) => ({ call: 'deep_show', session: ALPHA.id, doc: DOC.a, patch }),
    ops: [{ op: 'create', item: rect('alpha.marker', 'Alpha marker', [100, 80, 40, 40], 'b0') }],
  },
  {
    label: "bravo's", patch: patchId(3), call: (patch) => ({ call: 'deep_show', session: BRAVO.id, doc: DOC.a, patch }),
    ops: [{ op: 'create', item: rect('bravo.marker', 'Bravo marker', [200, 80, 40, 40], 'c0') }],
  },
];

function play(writer: Writer, planted?: string): { replies: JsonObject[]; failures: string[] } {
  const patch: JsonObject = { patch: writer.patch, doc: DOC.a, base: 0, reason: `${writer.label} edit to the checks board`, ops: writer.ops };
  const replies = run(builds.bin(FULL), scenario(evidence(), docs, [
    { call: 'revisions', doc: DOC.a },
    { call: 'verdict', claim: CLAIM },
    writer.call(patch),
    { call: 'revisions', doc: DOC.a },
    { call: 'verdicts', claim: CLAIM },
    { call: 'verdict', claim: CLAIM },
  ], { claims, ...(planted ? { planted } : {}) }));
  const [before, first, , after, listed, again] = replies;
  return {
    replies,
    failures: staleFailures({
      doc: DOC.a, patch: writer.patch, writer: writer.label, first: verdictOf(first, 'the verdict on revision 0'),
      before: current(before!), after: current(after!), listed: verdictList(listed!), again: verdictOf(again, 'the verdict after the patch'),
    }),
  };
}

describe('AC1 a PASS on a document that is the work is keyed by its revision hash and goes stale when any writer patches it', () => {
  const patched = (writer: Writer): void => {
    const { replies, failures } = play(writer);
    expect(outcome(replies[2]!), `${writer.label} patch ${writer.patch} applies: ${JSON.stringify(replies[2]).slice(0, 1200)}`).toBe('applied');
    none(failures, `the PASS on the work after ${writer.label} patch`);
  };
  it("#403.b719566f AC1 your patch makes a new revision of the deliverable: the PASS keyed by revision 0's hash goes stale, and a new verdict names the new revision's hash", () => patched(WRITERS[0]!));
  it("#403.b719566f AC1 alpha's patch, the claim's own agent's, makes a new revision: the PASS keyed by revision 0's hash goes stale, and a new verdict names the new revision's hash", () => patched(WRITERS[1]!));
  it("#403.b719566f AC1 bravo's patch, another agent's, makes a new revision: the PASS keyed by revision 0's hash goes stale, and a new verdict names the new revision's hash", () => patched(WRITERS[2]!));

  it("#403.b719566f AC1 without a patch the PASS stays fresh: made on revision 0 and listed after a read, it is keyed by revision 0's hash and not stale", () => {
    const replies = run(builds.bin(FULL), scenario(evidence(), docs, [
      { call: 'revisions', doc: DOC.a },
      { call: 'verdict', claim: CLAIM },
      { call: 'read', doc: DOC.a },
      { call: 'verdicts', claim: CLAIM },
    ], { claims }));
    const rev0 = current(replies[0]!);
    const first = verdictOf(replies[1], 'the verdict on revision 0');
    expect(first.result, `the claim on the clean board is PASS: ${JSON.stringify(first.raw).slice(0, 1200)}`).toBe('PASS');
    const listed = verdictList(replies[3]!);
    expect(listed.length, 'the claim lists the one verdict made on it').toBe(1);
    expect(listed[0]!.stale, 'no revision came after it, so the PASS is not stale').toBe(false);
    expect(listed[0]!.keyRevisions.find((r) => r.doc === DOC.a)?.hash, 'its key names revision 0\'s hash').toBe(rev0.hash);
  });

  it('#403.b719566f AC1 a planted verdict keyed by the document alone, not its revision, stays fresh after a patch and fails this check, naming the patch', () => {
    const { failures } = play(WRITERS[1]!, 'verdict_keyed_by_doc');
    failsNaming(failures, [WRITERS[1]!.patch], 'the verdict keyed by the document alone');
  });
});
