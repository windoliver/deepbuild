// AC6: "A test canvas module standing in for a new release's stricter rule, flagging any title over 20
// characters, is added after a board's last good revision, whose title has 24: a patch fixing a typo in one
// axis label is admitted, its reply listing the title's issue as carried, while a patch adding a second
// 24-character title is refused, naming its ID; a planted admission that counts every issue refuses the typo
// fix, and one that matches carried issues by code alone admits the second title, each failing, naming the
// patch"
//
// asserts: in the build with the test canvas module `test.title_cap` (feature `test-title-cap`), the checks
// board as the last release stored it (revision 0, its title `you.title` 24 characters) reads back with a
// `title_too_long` issue on `you.title`; the typo fix to `you.x-label` is applied with that issue in its
// reply marked `carried: true`, and the second 24-character title `you.title-2` is refused with a
// `title_too_long` error naming `you.title-2`, not carried (`admissionFailures`); the board reads back with
// the fix and without the second title. The planted `counts_every_issue` and `matches_carried_by_code` each
// fail `admissionFailures`, naming the typo fix's and the second title's patch.

import { describe, expect, it } from 'vitest';
import {
  DOC, YOU_PEER, admissionFailures, failsNaming, fixture, issues, none, obj, patchId, run, scenario, str, useBuilds, useEvidence,
  type Build, type JsonObject,
} from './helpers.ts';

const TITLE_CAP: Build = { with: 'test-title-cap' };
const builds = useBuilds([TITLE_CAP]);
const evidence = useEvidence();

const BOARD = fixture('checks-board.json');
const CODE = 'title_too_long';
const FIX = patchId(11);
const ADD = patchId(12);

const fix: JsonObject = {
  patch: FIX, doc: DOC.a, base: 0, reason: 'fix the typo in the x axis label',
  ops: [{ op: 'set', id: 'you.x-label', path: 'items/you.x-label/params/text', value: 'Week' }],
};
const add: JsonObject = {
  patch: ADD, doc: DOC.a, base: 0, reason: 'add a second chart title',
  ops: [{ op: 'create', item: { id: 'you.title-2', kind: 'text@1', name: 'Second title', order: 'a4', params: { text: 'Daily retries by service', font: 'body', size: 13, box: { w: 240, h: 20 } }, at: { pos: [16, 40, 0] } } }],
};

function play(planted?: string): JsonObject[] {
  return run(builds.bin(TITLE_CAP), scenario(evidence(), { [DOC.a]: { panel: 'main', document: BOARD } }, [
    { call: 'read', doc: DOC.a },
    { call: 'deep show', peer: YOU_PEER, doc: DOC.a, patch: fix },
    { call: 'deep show', peer: YOU_PEER, doc: DOC.a, patch: add },
    { call: 'read', doc: DOC.a },
  ], planted ? { planted } : {}));
}

describe("AC6 show-time admission refuses a revision only for issues the last good one didn't have, matched by code and item IDs, and returns the others as carried", () => {
  it("AC6 under a stricter title rule added after the board's last good revision, the typo fix is admitted with the title's issue carried, and a second long title is refused naming its ID", () => {
    const [opened, fixed, added, after] = play();
    const had = issues(opened!, 'the stored board read under the new rule');
    expect(had.some((i) => i.code === CODE && i.ids.includes('you.title')), `the stored board's 24-character title is flagged by the new rule: ${JSON.stringify(opened!['issues']).slice(0, 800)}`).toBe(true);
    none(admissionFailures({ patch: FIX, reply: fixed! }, { patch: ADD, reply: added! }, 'you.title', 'you.title-2', CODE), 'show-time admission');
    const items = obj(obj(after!['document'], 'read: document')['items'], 'read: items');
    expect(str(obj(obj(items['you.x-label'], 'you.x-label')['params'], 'params')['text'], 'the x label'), 'the typo fix is in the board').toBe('Week');
    expect(items['you.title-2'], 'the refused second title is not in the board').toBeUndefined();
  });

  it('AC6 a planted admission that counts every issue refuses the typo fix and fails this check, naming the patch', () => {
    const [, fixed, added] = play('counts_every_issue');
    failsNaming(admissionFailures({ patch: FIX, reply: fixed! }, { patch: ADD, reply: added! }, 'you.title', 'you.title-2', CODE), [FIX], 'the admission that counts every issue');
  });

  it('AC6 a planted admission that matches carried issues by code alone admits the second title and fails this check, naming the patch', () => {
    const [, fixed, added] = play('matches_carried_by_code');
    failsNaming(admissionFailures({ patch: FIX, reply: fixed! }, { patch: ADD, reply: added! }, 'you.title', 'you.title-2', CODE), [ADD], 'the admission that matches carried issues by code alone');
  });
});
