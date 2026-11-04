// Criterion 10: "In a build without the motion module, `ease(in_out_cubic, x)` in a test pack kind's rule and in a
// path fn reads the same values at 1,001 points as in the full build; and a planted build that declares ease@1 in the
// motion module refuses that kind rule with module_missing, naming motion, and fails this"
//
// Through `deep-show run` in three builds (README: Test features): `full`; `full,test-leave-out-motion`, the full
// set without the motion module; and `full,test-leave-out-motion,test-ease-in-motion`, the same with ease@1 declared
// by motion (the plant). The kind rule: fixtures/packs/easepack-1.0.0's kind `easepack.probe@1` holds the rule
// `easepack.matches`, `abs(ease(in_out_cubic, x) - y) <= 1e-12`; a board of 1,001 instances at x = i/1000 with y the
// f64 in_out_cubic computed here, plus one instance `bad` 1e-6 off, is presented; in each build exactly `bad` raises
// the rule's issue, so every one of the 1,001 reads within 1e-12 of the same value in both. The path fn: a path@1
// item with `fn: {y: "ease(in_out_cubic, x)", over: [0, 1], samples: 1001}`, read back with the `path` call, draws
// the same 1,001 points bit for bit in both builds, each within 1e-6 of in_out_cubic. No upstream test.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DOC, FIXTURES, TIMEOUT, arr, drawn, failsNaming, inOutCubic, isObject, mentions, none, obj, packAt, present, runShow, scenario, show, start,
  theRegistry, useEvidence, useShow, type JsonObject, type JsonValue, type PackFixture,
} from './helpers.ts';

const FULL = 'full';
const NO_MOTION = 'full,test-leave-out-motion';
const PLANTED = 'full,test-leave-out-motion,test-ease-in-motion';
const shows = useShow([FULL, NO_MOTION, PLANTED]);
const evidence = useEvidence();
const EASEPACK: PackFixture = { id: 'test/easepack', version: '1.0.0', dir: join(FIXTURES, 'packs', 'easepack-1.0.0') };

const XS = Array.from({ length: 1001 }, (_, i) => i / 1000);
const probe = (id: string, n: number, x: number, y: number): [string, JsonObject] =>
  [id, { id, kind: 'easepack.probe@1', name: `Probe ${id}`, order: `a${String(n).padStart(5, '0')}`, params: { x, y }, at: { pos: [(n % 40) * 8, Math.floor(n / 40) * 8, 0] } }];
const PROBES: JsonObject = {
  format: 1, profile: 'board', title: 'Ease probes', description: 'In_out_cubic read by a pack kind\'s rule at 1,001 points, for the #490 suite.', size: [320, 240],
  packs: [packAt(EASEPACK)],
  items: Object.fromEntries([...XS.map((x, i) => probe(`p${i}`, i, x, inOutCubic(x))), probe('bad', 1001, 0.25, inOutCubic(0.25) + 1e-6)]),
};
const CURVE: JsonObject = {
  format: 1, profile: 'board', title: 'Ease curve', description: 'In_out_cubic drawn as a path function at 1,001 points, for the #490 suite.', size: [320, 200],
  items: { curve: { id: 'curve', kind: 'path@1', name: 'Ease curve', order: 'a0', params: { fn: { y: 'ease(in_out_cubic, x)', over: [0, 1], samples: 1001 }, paint: { stroke: { role: 'ink' } } } } },
};

/** The kind rule's check in one build: the probes are presented, and exactly the instance `bad` raises easepack.matches. */
function ruleFailures(reply: JsonObject, build: string): string[] {
  if (reply['outcome'] !== 'presented') return [`${build}: the probes aren't presented: ${show(reply)}`];
  const issues = (Array.isArray(reply['issues']) ? reply['issues'] : []).filter((i) => isObject(i) && i['code'] === 'easepack.matches');
  const ids = issues.flatMap((i) => (isObject(i) && Array.isArray(i['ids']) ? i['ids'].map(String) : []));
  return ids.length === 1 && ids[0] === 'bad' ? [] : [`${build}: the rule easepack.matches names ${JSON.stringify(ids)}, not exactly the instance bad`];
}
const probesIn = (bin: string): JsonObject => runShow(bin, scenario(evidence(), [present(DOC.a, PROBES)], [EASEPACK]))[0]!;
const curveIn = (bin: string): [number, number][][] => {
  const [shown, path] = runShow(bin, scenario(evidence(), [present(DOC.a, CURVE), { call: 'path', doc: DOC.a, item: 'curve' }]));
  expect(shown!['outcome'], `the curve is presented: ${show(shown)}`).toBe('presented');
  return drawn(path!, 'the ease curve').subpaths;
};

describe('criterion 10: a build without motion resolves ease@1 in a pack kind\'s rule and a path fn', () => {
  it('criterion 10: the build without motion seals without the motion module and lists ease@1, declared by the core', () => {
    const bin = shows.bin(NO_MOTION);
    const [registry, registries] = runShow(bin, scenario(evidence(), [{ call: 'registry' }, { call: 'registries' }]));
    expect(arr(registry!['modules'], 'registry: modules'), 'the build holds no motion module').not.toContain('motion');
    expect(arr(registry!['modules'], 'registry: modules'), 'the build holds marks2d').toContain('marks2d');
    expect(theRegistry(registries!, 'ease@1').owner, 'ease@1 is the core\'s').toBe('core');
  }, TIMEOUT);

  it('criterion 10: ease(in_out_cubic, x) in a test pack kind\'s rule reads within 1e-12 of in_out_cubic at 1,001 points in the full build and in the build without motion alike', () => {
    none([...ruleFailures(probesIn(shows.bin(FULL)), FULL), ...ruleFailures(probesIn(shows.bin(NO_MOTION)), NO_MOTION)], 'the kind rule in both builds');
  }, TIMEOUT);

  it('criterion 10: ease(in_out_cubic, x) in a path fn draws the same 1,001 points in the build without motion as in the full build', () => {
    const full = curveIn(shows.bin(FULL));
    const bare = curveIn(shows.bin(NO_MOTION));
    expect(full.length, 'the full build draws one sub-path').toBe(1);
    expect(full[0]!.length, 'of 1,001 points').toBe(1001);
    none(full[0]!.flatMap(([x, y], i) => (Math.abs(x - XS[i]!) <= 1e-6 && Math.abs(y - inOutCubic(XS[i]!)) <= 1e-6 ? [] : [`point ${i} is (${x}, ${y}), not (${XS[i]}, ${inOutCubic(XS[i]!)})`])), 'the full build\'s curve is in_out_cubic');
    expect(JSON.stringify(bare), 'the build without motion draws the same points, bit for bit').toBe(JSON.stringify(full));
  }, TIMEOUT);

  it('criterion 10: a planted build that declares ease@1 in the motion module refuses the kind rule with module_missing, naming motion, and fails the check', () => {
    const bin = shows.bin(PLANTED);
    const s = start(bin, ['run'], [scenario(evidence(), [present(DOC.a, PROBES)], [EASEPACK])]);
    const out = s.lines as JsonValue[];
    const missing: JsonObject[] = [];
    const walk = (v: JsonValue): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (isObject(v)) { if (v['code'] === 'module_missing') missing.push(v); Object.values(v).forEach(walk); }
    };
    walk(out);
    expect(missing.some((m) => mentions(m, 'motion')), `a module_missing refusal names motion: ${s.stdout.slice(0, 2000)}`).toBe(true);
    const answer = out[0];
    const reply = isObject(answer) && Array.isArray(answer['replies']) && isObject(answer['replies'][0]) ? obj(answer['replies'][0], 'the reply') : { outcome: 'refused', answer: answer ?? null } as JsonObject;
    failsNaming(ruleFailures(reply, PLANTED), [PLANTED], 'the kind rule\'s check in the planted build');
    expect(mentions(out, 'easepack'), 'the refusal is the pack kind\'s').toBe(true);
  }, TIMEOUT);
});
