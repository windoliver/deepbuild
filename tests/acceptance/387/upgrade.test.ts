// #387.a793f31b: a canvas module upgrade reruns exactly the checks whose results its version keyed,
// and a stale interned handle from an earlier revision is refused. The upgrade is `test.up` at 1.0.0
// and at 1.1.0, two builds registering the same shapes; a result is reused exactly when its key is
// equal (Content key), so the check-phase nodes whose keys differ between the builds are the reruns
// (README: Readings). The wrong programs: keys without the module's version (nothing reruns), keys that
// take the module-set digest (every check reruns), and handles without a generation.
import { describe, expect, it } from 'vitest';
import {
  CHECK_PHASES, DOC, REGISTRY, board, byId, evalCall, evaluated, internCall, label, nodeId, obj, presented, readClosure, rect, registry, requires, resolveCall,
  run, scenario, show, sorted, useBuilds, useEvidence, type Build, type JsonObject, type JsonValue,
} from './helpers.ts';

const UP_1_0: Build = { set: 'core', with: ['test-up-1-0'] };
const UP_1_1: Build = { set: 'core', with: ['test-up-1-1'] };
const CORE: Build = { set: 'core' };
const builds = useBuilds([UP_1_0, UP_1_1, CORE]);
const evidence = useEvidence();

/** A rect, a label and an item of `test.up@1`, whose check `test.up.audit` its module's version keys. */
const UP_DOC = board('Upgrade', [
  rect('back', [0, 0, 320, 200], 'a0', 'ground'),
  label('cap', 'Module upgrade', [16, 16], 'a1'),
  { id: 'up', kind: 'test.up@1', name: 'Upgraded box', order: 'a2', params: { box: [200, 60, 80, 60], value: 3 } },
], requires({ 'test.up': '^1' }));

const CHECKS: readonly string[] = CHECK_PHASES;

describe('#387.a793f31b a canvas module upgrade reruns exactly the checks whose results its version keyed, and a stale interned handle from an earlier revision is refused', () => {
  it('#387.a793f31b test.up 1.0.0 → 1.1.0: the check-phase nodes whose keys move are exactly those of test.up\'s operators and of operators that read its arrays, and every other node keeps its key and result', () => {
    const one = (build: Build) => {
      const [reg, shown, frame] = run(builds.bin(build), scenario(evidence(), [REGISTRY, show(UP_DOC), evalCall(DOC.a, { t: '0s' })])) as [JsonObject, JsonObject, JsonObject];
      presented(shown, `the document in ${build.with![0]}`);
      return { reg: registry(reg), e: evaluated(frame, `the frame in ${build.with![0]}`) };
    };
    const before = one(UP_1_0);
    const after = one(UP_1_1);
    expect(before.reg.versions['test.up'], 'the first build holds test.up 1.0.0').toBe('1.0.0');
    expect(after.reg.versions['test.up'], 'the second holds test.up 1.1.0').toBe('1.1.0');
    expect(sorted(Object.keys(after.reg.operators)), 'both builds register the same operators').toEqual(sorted(Object.keys(before.reg.operators)));

    const owned = new Set(Object.entries(after.reg.arrays).filter(([, a]) => a['owner'] === 'test.up').map(([name]) => name));
    const keyedByUp = (operator: string): boolean =>
      after.reg.operators[operator]?.module === 'test.up' || [...readClosure(after.reg, operator)].some((r) => owned.has(r));
    const left = byId(before.e);
    const right = byId(after.e);
    expect(sorted([...right.keys()]), 'both frames hold the same nodes').toEqual(sorted([...left.keys()]));
    const checks = after.e.nodes.filter((n) => CHECKS.includes(n.phase));
    const expected = sorted(checks.filter((n) => keyedByUp(n.operator)).map(nodeId));
    expect(expected, 'test.up\'s own check, test.up.audit, is among the checks its version keys').toContain('test.up.audit@up');
    const moved = sorted(checks.filter((n) => left.get(nodeId(n))?.key !== n.key).map(nodeId));
    expect(moved, 'the checks that rerun after the upgrade are exactly those whose results test.up\'s version keyed').toEqual(expected);
    const failures: string[] = [];
    for (const n of after.e.nodes) {
      if (keyedByUp(n.operator)) continue;
      const m = left.get(nodeId(n));
      if (m?.key !== n.key) failures.push(`${nodeId(n)} (${n.phase}) moved its key across the upgrade of test.up, which it doesn't read`);
      if (m?.result !== n.result) failures.push(`${nodeId(n)} (${n.phase}) moved its result across the upgrade of test.up`);
    }
    expect(failures, 'nothing test.up\'s version didn\'t key reruns').toEqual([]);
  }, 600_000);

  it('#387.a793f31b a handle interned in revision 1 is refused with stale_handle in revision 2, for a deleted item and a kept one, while revision 2\'s own handles resolve', () => {
    const rev1 = board('Handles', [rect('p', [16, 16, 64, 40], 'a0'), rect('q', [96, 16, 64, 40], 'a1')]);
    const rev2 = board('Handles', [rect('q', [96, 16, 64, 40], 'a1'), rect('r', [176, 16, 64, 40], 'a2')]);
    const bin = builds.bin(CORE);
    // The handles are the core's values; a first process interns them, a second, which interns the same
    // way (nothing in an interned handle depends on the machine or the run), resolves them.
    const first = run(bin, scenario(evidence(), [show(rev1), internCall(DOC.a, 'p'), internCall(DOC.a, 'q'), show(rev2, { removes: ['p'] }), internCall(DOC.a, 'q'), internCall(DOC.a, 'r')]));
    const handle = (i: number): JsonValue => {
      const h = obj(first[i], `intern reply ${i}`)['handle'];
      expect(h, `intern reply ${i} carries a handle: ${JSON.stringify(first[i])}`).toBeDefined();
      return h!;
    };
    const [p1, q1, q2, r2] = [handle(1), handle(2), handle(4), handle(5)];
    expect(q2, 'q\'s handle in revision 2 is another value than in revision 1 (its generation)').not.toEqual(q1);
    const second = run(bin, scenario(evidence(), [
      show(rev1), internCall(DOC.a, 'p'), internCall(DOC.a, 'q'), resolveCall(DOC.a, p1), resolveCall(DOC.a, q1),
      show(rev2, { removes: ['p'] }), resolveCall(DOC.a, p1), resolveCall(DOC.a, q1), resolveCall(DOC.a, q2), resolveCall(DOC.a, r2),
    ]));
    expect([second[1]!['handle'], second[2]!['handle']], 'interning is the same in a second process').toEqual([p1, q1]);
    expect([second[3]!['id'], second[4]!['id']], 'in revision 1 its own handles resolve').toEqual(['p', 'q']);
    expect(second[6], 'p\'s handle from revision 1 is refused in revision 2 (p was deleted)').toEqual(expect.objectContaining({ code: 'stale_handle' }));
    expect(second[6]!['id'], 'and resolves to no item').toBeUndefined();
    expect(second[7], 'q\'s handle from revision 1 is refused in revision 2 though q is kept').toEqual(expect.objectContaining({ code: 'stale_handle' }));
    expect(second[7]!['id'], 'and resolves to no item').toBeUndefined();
    expect([second[8]!['id'], second[9]!['id']], 'revision 2\'s own handles resolve').toEqual(['q', 'r']);
  }, 600_000);
});
