// #1940.44d6026c: "The loop module seals in a test build without the effects module, and a check input naming
// effects.audit there is BLOCKED with module_missing, naming the effects module, never PASS; a planted loop module that
// registers effects.audit itself, and so depends on effects, is refused at that build's seal, naming effects"
//
// Two deep-show builds (README: Test builds): `full,test-leave-out-effects`, the full set without the effects module
// (#200's feature), the test build; and `full,test-leave-out-effects,test-effects-audit-in-loop`, the same with the
// planted loop module, which registers effects.audit itself and declares effects among its required dependencies.
// asserts, one test per clause:
// 1. the test build starts (the seal runs before any scenario is read) and its `registry` lists loop and not effects;
// 2. there, alpha's claim on a stored board whose one requirement's check input is `effects.audit` (the issue's Fields:
//    `overdraw: {max: 8}`) is judged: the requirement's row is BLOCKED, its `blocked` holds `module_missing` naming
//    the kind effects.audit and the module effects, and neither it nor the claim is PASS. The board holds one rect, so
//    nothing in the document needs effects and the BLOCKED is the check kind's alone (README: Readings);
// 3. the planted build's startup is the seal's refusal (exit 2, one line, `seal_refused`), whose `modules` name the
//    loop module it refuses and effects. That refusal is also the wrong program clause 1's seal check fails on.
import { describe, expect, it } from 'vitest';
import {
  CLAIM, DOC, TIMEOUT, arr, claim, none, obj, rect, refusalLine, reqId, requirement, run, scenario, sealFailures, show, startup, storedBoard,
  strs, useEvidence, useShow, verdictOf, type Verdict,
} from './helpers.ts';

const ID = '#1940.44d6026c';
const NO_EFFECTS = 'full,test-leave-out-effects';
const PLANTED = 'full,test-leave-out-effects,test-effects-audit-in-loop';
const shows = useShow([NO_EFFECTS, PLANTED]);
const evidence = useEvidence();

const KIND = 'effects.audit';
const AUDIT = requirement(reqId(1), { kind: KIND, overdraw: { max: 8 } });
const BOARD = storedBoard('Effects', [rect('you.plot', 'Plot area', [80, 60, 520, 240], 'a0')]);

/** The criterion's check on the verdict: effects.audit BLOCKED with module_missing naming the kind and effects, never PASS. */
function auditFailures(verdict: Verdict): string[] {
  const row = verdict.requirements.find((r) => r.id === AUDIT['id']);
  if (!row) return [`the requirement whose check input names ${KIND} was skipped: the verdict has no row for it: ${show(verdict.raw)}`];
  const failures: string[] = [];
  if (row.result !== 'BLOCKED') failures.push(`the requirement whose check input names ${KIND} was ${row.result}, not BLOCKED: ${show(row.raw)}`);
  const missing = row.blocked.filter((b) => b.code === 'module_missing' && b.kind === KIND);
  if (missing.length === 0) failures.push(`the requirement names no module_missing for ${KIND}: ${show(row.raw['blocked'])}`);
  else if (!missing.some((b) => b.module === 'effects')) failures.push(`the module_missing for ${KIND} names ${missing.map((b) => b.module ?? 'no module').join(', ')}, not the effects module`);
  if (verdict.result === 'PASS') failures.push(`the claim whose requirement names ${KIND} was PASS`);
  return failures;
}

describe(`${ID} effects.audit is the effects module's: the loop module seals without it, and a loop module that registers it is refused`, () => {
  it(`${ID} the loop module seals in a test build without the effects module`, () => {
    const s = startup(shows.bin(NO_EFFECTS), evidence());
    none(sealFailures(s, NO_EFFECTS), 'the build without the effects module');
    const registry = obj(arr(obj(s.lines[0], 'the startup\'s answer')['replies'], 'the startup\'s replies')[0], 'registry');
    const modules = strs(registry['modules'], 'registry: modules');
    expect(modules, 'the build holds the loop module').toContain('loop');
    expect(modules, 'the build holds no effects module').not.toContain('effects');
  }, TIMEOUT);

  it(`${ID} there, a check input naming effects.audit is BLOCKED with module_missing, naming the effects module, never PASS`, () => {
    const [registry, judged] = run(shows.bin(NO_EFFECTS), scenario(evidence(), { [DOC]: BOARD }, [
      { call: 'registry' },
      { call: 'verdict', claim: CLAIM },
    ], { claims: { [CLAIM]: claim([DOC], [AUDIT]) } }));
    expect(strs(registry!['modules'], 'registry: modules'), 'the build holds no effects module').not.toContain('effects');
    none(auditFailures(verdictOf(judged, 'the verdict on the claim')), `the ${KIND} requirement in ${NO_EFFECTS}`);
  }, TIMEOUT);

  it(`${ID} a planted loop module that registers effects.audit itself, and so depends on effects (test-effects-audit-in-loop), is refused at that build's seal, naming effects`, () => {
    const line = refusalLine(startup(shows.bin(PLANTED), evidence()), PLANTED);
    expect(strs(line['modules'], 'the refusal: modules'), `the refusal names the loop module it refuses and effects: ${show(line)}`).toEqual(expect.arrayContaining(['loop', 'effects']));
  }, TIMEOUT);
});
