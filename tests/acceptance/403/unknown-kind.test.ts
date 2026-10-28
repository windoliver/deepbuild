// AC2 (#403.a04e255b): "A deliverable document with an item of a kind this build doesn't know makes its
// checks in the claim BLOCKED naming the kind, never PASS, while the rest of the document still draws"
//
// asserts: alpha's board of two rects and a text, plus item `cube` of kind `test.cube@1`, which no module in
// the build registers, is sent by `deep show --check --snap` from alpha's tree for alpha's claim that names
// the board as its deliverable. The board is presented with one snapshot, and that snapshot is byte for byte
// the snapshot of the same board without `cube` (and not an empty board's): the rest still draws. The
// check's `result` is BLOCKED, not PASS, and its `blocked` names `unknown_kind`, `test.cube@1` and `cube`
// (`unknownKindFailures`). The claim's `document.validate` requirement, judged by `verdict`, is BLOCKED the
// same way, and the claim is not PASS. Control: the same board without `cube` passes both. The planted
// `checks_skip_unknown_kind`, checks that skip the item and judge the rest, fails `unknownKindFailures`,
// naming the kind.

import { describe, expect, it } from 'vitest';
import {
  DOC, FULL, IN_ALPHA, VERDICTS, arr, blockedOf, board, claim, claimId, failsNaming, none, obj, outcome, rect, requirement, rowOf, run,
  scenario, str, text, unknownKindFailures, useBuilds, useEvidence, verdictOf,
  type JsonObject,
} from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();

const KIND = 'test.cube@1';
const CLAIM = claimId(2);
const REQ = requirement(2, { kind: 'document.validate' });
const claims = { [CLAIM]: claim([DOC.a], [REQ]) };

const KNOWN: JsonObject[] = [
  rect('a-box', 'Left box', [40, 60, 200, 120], 'a0'),
  rect('b-box', 'Right box', [320, 60, 200, 120], 'a1'),
  text('c-label', 'Label', 'Checks by service', [40, 220], 'a2'),
];
const CUBE: JsonObject = { id: 'cube', kind: KIND, name: 'A cube from a newer release', order: 'a3', params: { box: [240, 200, 80, 80] } };
const WITH_CUBE = board('Checks with a cube', [...KNOWN, CUBE]);
const WITHOUT_CUBE = board('Checks with a cube', KNOWN);
const EMPTY = board('Checks with a cube', []);

const check = (document: JsonObject): JsonObject =>
  ({ call: 'deep show', peer: IN_ALPHA, check: true, claim: CLAIM, doc: DOC.a, document, t: '0s', size: [640, 360], include: ['issues', 'pixels'] });

function shot(reply: JsonObject, what: string): string {
  const shots = arr(reply['snapshots'], `${what}: snapshots`);
  expect(shots.length, `${what}: one snapshot`).toBe(1);
  return str(obj(shots[0], `${what}: snapshots[0]`)['sha256'], `${what}: the snapshot's sha256`);
}

function play(document: JsonObject, planted?: string): JsonObject[] {
  return run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: 'main' }, [check(document), { call: 'verdict', claim: CLAIM }], { claims, ...(planted ? { planted } : {}) }));
}

describe("AC2 a deliverable with an item of a kind the build doesn't know makes its checks in the claim BLOCKED naming the kind, while the rest draws", () => {
  it('#403.a04e255b AC2 deep show --check --snap of the deliverable with a test.cube@1 item: presented and drawn as the board without it, the check BLOCKED naming test.cube@1, never PASS', () => {
    const [withCube] = play(WITH_CUBE);
    const [withoutCube] = play(WITHOUT_CUBE);
    const [empty] = play(EMPTY);
    expect(outcome(withCube!), `the board with the unknown item is presented: ${JSON.stringify(withCube).slice(0, 1200)}`).toBe('presented');
    const drawn = shot(withCube!, 'the board with the unknown item');
    expect(drawn, 'the rest of the board draws: its snapshot is the board without the unknown item').toBe(shot(withoutCube!, 'the board without the unknown item'));
    expect(drawn, 'and something drew: it is not an empty board').not.toBe(shot(empty!, 'an empty board'));
    expect(VERDICTS, `the check's result is a verdict: ${JSON.stringify(withCube!['result'])}`).toContain(withCube!['result']);
    expect(withCube!['result'], 'never PASS').not.toBe('PASS');
    none(unknownKindFailures(String(withCube!['result']), blockedOf(withCube!['blocked']), KIND, 'cube', 'the check in the claim'), 'the check in the claim');
  });

  it("#403.a04e255b AC2 the claim's document.validate requirement on that deliverable is BLOCKED naming test.cube@1, and the claim is not PASS", () => {
    const [, judged] = play(WITH_CUBE);
    const verdict = verdictOf(judged, 'the verdict on the claim');
    const row = rowOf(verdict, String(REQ['id']));
    expect(row, `the requirement is judged, not skipped: ${JSON.stringify(verdict.raw).slice(0, 1200)}`).toBeDefined();
    none(unknownKindFailures(row!.result, row!.blocked, KIND, 'cube', 'the document.validate requirement'), 'the requirement in the claim');
    expect(verdict.result, 'the claim is never PASS on a BLOCKED requirement').not.toBe('PASS');
  });

  it('#403.a04e255b AC2 control: the same deliverable without the unknown item passes its check and its requirement in the claim', () => {
    const [shown, judged] = play(WITHOUT_CUBE);
    expect(outcome(shown!), 'presented').toBe('presented');
    expect(shown!['result'], `the clean deliverable's check passes the claim: ${JSON.stringify(shown).slice(0, 1200)}`).toBe('PASS');
    const verdict = verdictOf(judged, 'the verdict on the claim');
    expect(rowOf(verdict, String(REQ['id']))?.result, 'its requirement passes').toBe('PASS');
    expect(verdict.result, 'and so does the claim').toBe('PASS');
  });

  it('#403.a04e255b AC2 planted checks that skip the unknown item and judge the rest fail this check, naming test.cube@1', () => {
    const [shown, judged] = play(WITH_CUBE, 'checks_skip_unknown_kind');
    failsNaming(unknownKindFailures(String(shown!['result']), blockedOf(shown!['blocked']), KIND, 'cube', 'the check in the claim'), [KIND], 'the check that skips the unknown item');
    const row = rowOf(verdictOf(judged, 'the verdict on the claim'), String(REQ['id']));
    failsNaming(unknownKindFailures(row?.result ?? '(no row)', row?.blocked ?? [], KIND, 'cube', 'the document.validate requirement'), [KIND], 'the requirement that skips the unknown item');
  });
});
