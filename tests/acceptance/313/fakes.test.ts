// AC3, AC10, AC12 and AC14: the broken fakes that prove the runner. The five named fakes each fail with their
// own message; every declared item has a fake that mishandles it alone; every adapter rule in adapter.facts@1's
// numbered list has one fake; every fake names the exact codes it raises, and a runner that checks only that
// the expected codes are among those raised is caught.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { kitProblems, proveFake } from '../../../packages/conformance/src/index.ts';
import type { Fake, Fill, Kit, Report } from '../../../packages/conformance/src/index.ts';
import {
  adapterKit, brokenItem, clean, failing, fakeByMessage, FIVE_MESSAGES, kitWith, RULE_PHRASES, rules, run, RUNS, sameSet, shapeOnlyRunKit,
  subsetProveFake, testCase,
} from './helpers.ts';

const kit = adapterKit();

/** The fakes a runner passed (no FAIL naming the fake's message), for the five the issue names. */
function fakesPassed(runner: (kit: Kit, fill: Fill) => Report): string[] {
  const passed: string[] = [];
  for (const message of FIVE_MESSAGES) {
    const fake = fakeByMessage(kit, message);
    const report = runner(kit, fake.fill);
    if (!failing(report).some((c) => c.message.includes(message))) passed.push(fake.name);
  }
  return passed;
}

describe('AC3 each of the five broken fakes fails the runner with its own message, and the five messages differ', () => {
  it.each(FIVE_MESSAGES)('AC3 the fake "%s" fails the runner, and a FAIL carries that message', (message) => {
    const fake = fakeByMessage(kit, message);
    const report = run(kit, fake.fill);
    expect(report.verdict).not.toBe('PASS');
    const named = failing(report).filter((c) => c.message.includes(message));
    expect(named.length, `a FAIL names "${message}" (failures: ${failing(report).map((c) => `${c.id}: ${c.message}`).join(' | ')})`).toBeGreaterThan(0);
    expect(fake.codes.length, 'the fake names the codes it raises').toBeGreaterThan(0);
    for (const c of named) expect(c.codes, `${c.id} raises the fake's codes`).toEqual(expect.arrayContaining(fake.codes));
  });

  it('AC3 the five messages differ from each other, and from every other fake\'s', () => {
    const messages = kit.fakes.map((f) => f.message);
    expect(new Set(messages).size, `fake messages repeat: ${messages.join(' | ')}`).toBe(messages.length);
    expect(new Set(FIVE_MESSAGES).size).toBe(5);
  });

  it('AC3 a runner that passes any of the five fails this test, naming each fake it passed', () => {
    // The runner under test passes none of them; the assertion message names the ones a wrong runner passes.
    const passed = fakesPassed(run);
    expect(passed, `fakes the runner passed: ${passed.join(', ')}`).toEqual([]);
  });

  it('AC3 (wrong program) a runner that checks only the shape of each reply passes all five, and this test names each', () => {
    const passed = fakesPassed(shapeOnlyRunKit);
    expect(passed.length, 'the shape-only stand-in passes every one of the five').toBe(5);
    for (const message of FIVE_MESSAGES) expect(passed).toContain(fakeByMessage(kit, message).name);
    expect(() => expect(passed, `fakes the runner passed: ${passed.join(', ')}`).toEqual([])).toThrow(/fakes the runner passed: .*duplicate/);
  });
});

describe('AC10 for every flag, operation and event kind a case declares, the kit holds a broken fake that mishandles only that item, and the case fails it with its own message', () => {
  const declaredItems = (): { caseId: string; key: 'flag' | 'operation' | 'kind'; item: string }[] => kit.cases.flatMap((c) => [
    ...c.declares.flags.map((item) => ({ caseId: c.id, key: 'flag' as const, item: String(item) })),
    ...c.declares.operations.map((item) => ({ caseId: c.id, key: 'operation' as const, item: String(item) })),
    ...c.declares.kinds.map((item) => ({ caseId: c.id, key: 'kind' as const, item })),
  ]);
  const fakeFor = (key: 'flag' | 'operation' | 'kind', item: string): Fake[] => kit.fakes.filter((f) => f.breaks[key] === item);

  it('AC10 the kit declares items, and every fake mishandles exactly one item', () => {
    expect(declaredItems().length, 'the kit\'s cases declare flags, operations or kinds').toBeGreaterThan(0);
    for (const fake of kit.fakes) brokenItem(fake);
  });

  it('AC10 every declared item has exactly one fake that mishandles it alone, and the fakes\' messages are their own', () => {
    const missing: string[] = [];
    const several: string[] = [];
    for (const { key, item } of declaredItems()) {
      const fakes = fakeFor(key, item);
      if (fakes.length === 0) missing.push(`${key} ${item}`);
      if (fakes.length > 1) several.push(`${key} ${item}: ${fakes.map((f) => f.name).join(', ')}`);
    }
    expect(missing, 'declared items with no fake').toEqual([]);
    expect(several, 'declared items with more than one fake').toEqual([]);
    const messages = declaredItems().map(({ key, item }) => fakeFor(key, item)[0]!.message);
    expect(new Set(messages).size, `item fakes share a message: ${messages.join(' | ')}`).toBe(new Set(declaredItems().map((d) => `${d.key} ${d.item}`)).size);
  });

  it('AC10 each case fails the fake of each item it declares, with that fake\'s message, and kills it in the runner\'s own count', () => {
    for (const { caseId, key, item } of declaredItems()) {
      const fake = fakeFor(key, item)[0]!;
      const c = kit.cases.find((k) => k.id === caseId)!;
      const result = run(kitWith(kit, { cases: [c] }), fake.fill).cases.find((r) => r.id === caseId)!;
      expect(result.outcome, `${caseId} on fake ${fake.name} (${key} ${item})`).toBe('FAIL');
      expect(result.message, `${caseId} on fake ${fake.name} carries the fake's message`).toContain(fake.message);
      const onClean = run(kitWith(kit, { cases: [c] }), clean(kit)).cases.find((r) => r.id === caseId)!;
      expect(onClean.killed, `${caseId} kills ${fake.name}`).toContain(fake.name);
      expect(onClean.survived, `${caseId} leaves no fake of its items alive`).toEqual([]);
    }
  });

  it('AC10 a case that calls answerPermission and checks only that a reply came back kills no fake, reads INVALID, and fails this test', () => {
    const request = { kind: 'tool', tool: 'Bash', command: 'npm test' };
    const shallow = testCase('test/shallow-permission', { flags: ['answerPermission'] }, (h) => {
      const delivery = h.permission(request, 'sess_01');
      if (!delivery) h.fail('no reply came back');
    });
    const result = run(kitWith(kit, { cases: [shallow] }), clean(kit)).cases.find((r) => r.id === shallow.id)!;
    expect(result.reached.flags, 'the case reached the flag').toContain('answerPermission');
    expect(result.killed, 'a shape-deep check kills no fake').toEqual([]);
    expect(result.survived.length, 'the answerPermission fake survives it').toBeGreaterThan(0);
    expect(result.outcome).toBe('INVALID');
    // A runner that read it as PASS fails here.
    expect(result.outcome).not.toBe('PASS');
  });
});

describe('AC12 the adapter rules are one numbered list in adapter.facts@1, each with one broken fake that fails the runner with that rule\'s message', () => {
  it('AC12 adapter.facts@1 lists the ten rules in the design\'s order, each with an id', () => {
    const list = rules();
    expect(list.length).toBe(RULE_PHRASES.length);
    list.forEach((rule, i) => {
      expect(rule.rule.toLowerCase(), `rule ${i + 1} is ${RULE_PHRASES[i]}`).toContain(RULE_PHRASES[i]!.toLowerCase().replace(/`/g, ''));
      expect(rule.id).toMatch(/^[a-z][a-z0-9_-]*$/);
    });
    expect(new Set(list.map((r) => r.id)).size).toBe(list.length);
  });

  it('AC12 each rule has exactly one broken fake, which fails the runner with its own message', () => {
    const messages = new Map<string, string>();
    for (const rule of rules()) {
      const fakes = kit.fakes.filter((f) => f.breaks.rule === rule.id);
      expect(fakes.length, `rule ${rule.id} (${rule.rule}) has one fake, has ${fakes.map((f) => f.name).join(', ') || 'none'}`).toBe(1);
      const fake = fakes[0]!;
      const report = run(kit, fake.fill);
      expect(report.verdict, `fake ${fake.name} fails the runner`).not.toBe('PASS');
      expect(failing(report).some((c) => c.message.includes(fake.message)), `a FAIL carries "${fake.message}" (failures: ${failing(report).map((c) => c.message).join(' | ')})`).toBe(true);
      messages.set(rule.id, fake.message);
    }
    expect(new Set(messages.values()).size, 'each rule\'s message is its own').toBe(messages.size);
  });

  it('AC12 the five named fakes are among the rule fakes where the design places them: a duplicate ID under ordering, a late event under the stopped turn, another session under one owner, no sign under delivery', () => {
    const byPhrase = (phrase: string) => rules().find((r) => r.rule.toLowerCase().includes(phrase))!.id;
    expect(fakeByMessage(kit, 'duplicate event ID').breaks.rule).toBe(byPhrase('ties by id'));
    expect(fakeByMessage(kit, 'event after stop').breaks.rule).toBe(byPhrase('stopped turn'));
    expect(fakeByMessage(kit, 'answer delivered to another session').breaks.rule).toBe(byPhrase('one owner'));
    expect(fakeByMessage(kit, 'acknowledged with no transcript sign').breaks.rule).toBe(byPhrase('transcript'));
  });

  it('AC12 with the fake for a clock stepped back removed, the preflight\'s kit check fails, naming the rule', () => {
    const clock = rules().find((r) => r.rule.toLowerCase().includes('clock stepped back'))!;
    expect(kitProblems(kit), 'the shipped kit has no problems').toEqual([]);
    const problems = kitProblems(kitWith(kit, { fakes: kit.fakes.filter((f) => f.breaks.rule !== clock.id) }));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.name === clock.id || p.reason.includes(clock.id) || p.reason.toLowerCase().includes('clock stepped back')), `a problem names the rule ${clock.id}: ${JSON.stringify(problems)}`).toBe(true);
  });
});

describe('AC14 every planted entry, broken fake and clean twin names the exact codes it must raise, empty for a twin', () => {
  it('AC14 every fake names codes, and proving it finds exactly those raised: nothing extra, nothing missing', () => {
    for (const fake of kit.fakes) {
      expect(fake.codes.length, `fake ${fake.name} names its codes`).toBeGreaterThan(0);
      const proof = proveFake(kit, fake);
      expect(proof, `fake ${fake.name}`).toMatchObject({ extra: [], missing: [], killed: true });
      expect(sameSet(proof.raised, fake.codes), `${fake.name} raised ${proof.raised} and named ${fake.codes}`).toBe(true);
    }
  });

  it('AC14 every planted entry names exactly its code, and its clean twin names none', () => {
    for (const planted of kit.planted) {
      expect(planted.codes, `${planted.family} ${planted.code}`).toEqual([planted.code]);
      expect(planted.twin.codes, `${planted.family} ${planted.code}'s twin`).toEqual([]);
    }
  });

  it('AC14 a fake that raises its rule\'s code and one more fails its case, naming the extra code', () => {
    // Two fakes composed: the duplicate-ID fake with the other-session fake's delivery raises both rules' codes.
    const duplicate = fakeByMessage(kit, 'duplicate event ID');
    const otherSession = fakeByMessage(kit, 'answer delivered to another session');
    const composed: Fake = { ...duplicate, fill: { ...duplicate.fill, deliver: otherSession.fill.deliver } };
    const proof = proveFake(kit, composed);
    expect(proof.killed).toBe(false);
    expect(proof.extra.length, `extra codes raised: ${proof.extra}`).toBeGreaterThan(0);
    for (const code of otherSession.codes.filter((c) => !duplicate.codes.includes(c))) expect(proof.extra).toContain(code);
    expect(proof.missing).toEqual([]);
  });

  it('AC14 a fake that raises none of its codes (the clean fill under a fake\'s name) fails its case, naming the missing codes', () => {
    const fake = fakeByMessage(kit, 'event after stop');
    const proof = proveFake(kit, { ...fake, fill: clean(kit) });
    expect(proof.killed).toBe(false);
    expect(proof.raised).toEqual([]);
    expect(proof.missing).toEqual(expect.arrayContaining(fake.codes));
    expect(proof.extra).toEqual([]);
  });

  it('AC14 for any set of codes a fake could name, the proof kills it exactly when the set equals what it raises (1,000 cases)', () => {
    const fake = fakeByMessage(kit, 'event after stop');
    const raised = proveFake(kit, fake).raised;
    const pool = [...new Set([...raised, ...kit.fakes.flatMap((f) => f.codes), 'planted_extra'])];
    fc.assert(fc.property(fc.subarray(pool), (named) => {
      const proof = proveFake(kit, { ...fake, codes: named });
      expect(proof.killed, `named ${named} against raised ${raised}`).toBe(sameSet(named, raised));
      expect(sameSet(proof.extra, raised.filter((c) => !named.includes(c)))).toBe(true);
      expect(sameSet(proof.missing, named.filter((c) => !raised.includes(c)))).toBe(true);
    }), RUNS);
  });

  it('AC14 (wrong program) a runner that checks only that the expected codes are among those raised passes the composed fake and fails this test', () => {
    const duplicate = fakeByMessage(kit, 'duplicate event ID');
    const otherSession = fakeByMessage(kit, 'answer delivered to another session');
    const composed: Fake = { ...duplicate, fill: { ...duplicate.fill, deliver: otherSession.fill.deliver } };
    const proof = subsetProveFake(kit, composed);
    expect(proof.killed, 'the subset stand-in passes the fake that raises one more').toBe(true);
    expect(() => expect(proof.killed, `extra codes raised: ${proof.extra}`).toBe(false)).toThrow(/extra codes raised/);
  });
});
