// #405.4e6c0bc7: "A definition's geometry audit on a scene whose working agent declared its floating vase `floating`
// only in the document's own checks is INCONCLUSIVE and asks once whether to approve that exception, never PASS;
// after your yes, or with the same exception named in the locked definition, it passes"
//
// Fixture (helpers.ts `vaseScene`): the working agent alpha shows a scene through deep_show: a 4 m floor, a table on
// it and a vase 0.2 m above the table, resting on nothing. The document's own checks (its envelope's `checks`) hold
// `{kind: geometry.audit, scope: scene, support: {floating: [floor, vase]}}`: the agent's own exception for the vase.
// Two claims of alpha's name the scene as their one deliverable:
//   - A, whose locked definition's one requirement is `{kind: geometry.audit, scope: scene, support: {floating:
//     [floor]}}`: the floor may float, the vase isn't named;
//   - B, the same with `floating: [floor, vase]`: the agent's exception named in the definition itself.
//
// asserts, in one `deep-show run` (show, verdict A, verdict A again, verdict B):
//   - A is INCONCLUSIVE, the claim too, never PASS; the verdict carries exactly one approval ask on A's requirement,
//     with an `id`, naming the vase and `floating`;
//   - asking again: A's second verdict is INCONCLUSIVE, and carries no new approval ask on the requirement (none, or
//     the same ask by its `id`);
//   - B PASSes, nothing raised, no approval ask.
// and in a second run (show, verdict A, the agent's own yes, verdict A, your yes, verdict A):
//   - the working agent's yes is refused (`not_your_decision`) and A stays INCONCLUSIVE;
//   - your yes is answered, and A then PASSes, the claim too, with no approval ask left on the requirement.
import { describe, expect, it } from 'vitest';
import {
  FULL, TIMEOUT, VASE_CHECK, VASE_CHECK_NAMED, answer, approvalAsks, brief, claimId, claimOf, docId, none, passFailures, presented, reqId, rowOf,
  run, scenarioOf, show, useBuilds, useFolders, vaseScene, verdict, type JsonObject,
} from './helpers.ts';

/** The criterion's ID: `#405.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#405.4e6c0bc7';
const bin = useBuilds([FULL]);
const folder = useFolders();

const DOC = docId(1);
const [A, B] = [claimId(1), claimId(2)];
const [REQ_A, REQ_B] = [reqId(1), reqId(2)];
const claims = { [A]: claimOf(DOC, REQ_A, VASE_CHECK), [B]: claimOf(DOC, REQ_B, VASE_CHECK_NAMED) };
const judge = (calls: JsonObject[]): JsonObject[] => run(bin(FULL), scenarioOf(folder(), [DOC], claims, [show(DOC, vaseScene()), ...calls]));

/** A's verdict is INCONCLUSIVE, its requirement too: never PASS. */
function inconclusiveOnA(v: JsonObject, what: string): void {
  const row = rowOf(v, REQ_A, what);
  expect(row.result, `${what}: the requirement covered only by the agent's own exception is INCONCLUSIVE: ${brief(row.raw)}`).toBe('INCONCLUSIVE');
  expect(v['result'], `${what}: so is the claim, never PASS: ${brief(v)}`).toBe('INCONCLUSIVE');
}

describe(`${ID} an exception the working agent declared only in the document's own checks never makes a definition's audit PASS`, () => {
  it(`${ID} the floating vase declared only in the document's own checks is INCONCLUSIVE and asks once, never PASS; your yes, or the exception named in the locked definition, passes it`, () => {
    const [shown, first, again, named] = judge([verdict(A), verdict(A), verdict(B)]);
    presented(shown!, 'the agent\'s scene');

    inconclusiveOnA(first!, 'the first verdict on A');
    const asked = approvalAsks(first!, REQ_A);
    expect(asked.length, `the first verdict asks once whether to approve the exception: ${brief(first!['asks'] ?? null)}`).toBe(1);
    const ask = asked[0]!;
    expect(typeof ask['id'] === 'string' && ask['id'] !== '', `the approval ask has an id: ${brief(ask)}`).toBe(true);
    expect(JSON.stringify(ask).includes('vase') && JSON.stringify(ask).includes('floating'), `the approval ask names the vase and floating: ${brief(ask)}`).toBe(true);

    inconclusiveOnA(again!, 'asking again');
    const repeated = approvalAsks(again!, REQ_A);
    expect(repeated.length <= 1 && repeated.every((a) => a['id'] === ask['id']), `asking again asks nothing new: ${brief(again!['asks'] ?? null)}`).toBe(true);

    none(passFailures(rowOf(named!, REQ_B, 'B'), 'the audit with the exception named in the locked definition'), 'the same exception named in the locked definition passes');
    expect(named!['result'], `B's claim passes: ${brief(named)}`).toBe('PASS');
    expect(approvalAsks(named!, REQ_B), 'B asks nothing').toEqual([]);
  }, TIMEOUT);

  it(`${ID} the working agent's own yes is refused and changes nothing; after your yes the definition's audit passes`, () => {
    const [, before, agentYes, afterAgent, yourYes, after] = judge([verdict(A), answer(A, REQ_A, 'agent'), verdict(A), answer(A, REQ_A, 'you'), verdict(A)]);
    inconclusiveOnA(before!, 'the verdict before any answer');
    expect([agentYes!['outcome'], agentYes!['code']], `the working agent's own yes is refused: ${brief(agentYes)}`).toEqual(['refused', 'not_your_decision']);
    inconclusiveOnA(afterAgent!, 'the verdict after the agent\'s own yes');
    expect(yourYes!['outcome'], `your yes is answered: ${brief(yourYes)}`).toBe('answered');
    none(passFailures(rowOf(after!, REQ_A, 'A after your yes'), 'the audit after your yes'), 'after your yes it passes');
    expect(after!['result'], `A's claim passes after your yes: ${brief(after)}`).toBe('PASS');
    expect(approvalAsks(after!, REQ_A), 'no approval ask is left on the requirement').toEqual([]);
  }, TIMEOUT);
});
