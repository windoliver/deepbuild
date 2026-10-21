// AC3: one kit per hub slot on the one runner, each proven by planted wrong fills that each fail it with their
// own message: the four check runners, the two indexes, the two environments and the stream reader. The kits'
// reference fills pass; a kit that checks only each reply's shape passes every planted fill and is named for it;
// the preflight's kit check names a rule no planted fill isolates and a planted fill the kit admits.
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../../../packages/contracts/src/index.ts';
import { kitProblems, slotKits } from '../../../packages/conformance/src/index.ts';
import type { SlotFill, SlotKit, SlotReport, SlotRunOptions } from '../../../packages/conformance/src/index.ts';
import { clean, cleans, failing, FILLS, kitWith, notPassing, planted, PLANTED, run, shapeOnlyRunKit, slotKit, SLOTS } from './helpers.ts';

type Runner = <F extends SlotFill>(kit: SlotKit<F>, fill: F, options?: SlotRunOptions) => Promise<SlotReport>;

/** The planted fills a runner passed (no FAIL carrying the fill's message), across every kit, by `<slot> <name>`. */
async function plantedPassed(runner: Runner): Promise<string[]> {
  const passed: string[] = [];
  for (const slot of SLOTS) {
    const kit = slotKit(slot);
    for (const name of PLANTED[slot]!) {
      const p = planted(kit, name);
      const report = await runner(kit, p.fill, { seed: 1 });
      if (!failing(report).some((c) => c.message.includes(p.message))) passed.push(`${slot} ${name}`);
    }
  }
  return passed;
}

describe('the slot kits and their reference fills, so every failure below is the fault a planted fill carries', () => {
  it('slotKits() ships a kit for each of the five slots, each naming how many pieces may fill it', () => {
    const slots = slotKits().map((k) => k.slot);
    for (const slot of SLOTS) expect(slots, `a kit for ${slot}`).toContain(slot);
    for (const slot of SLOTS) expect(slotKit(slot).fills, `${slot} fills`).toBe(FILLS[slot]);
    expect(new Set(slots).size, 'one kit per slot').toBe(slots.length);
  });

  it.each(SLOTS)('%s: every reference fill passes every case of its kit, fixed and seeded', async (slot) => {
    const kit = slotKit(slot);
    for (const fill of cleans(kit)) {
      const report = await run(kit, fill, { seed: 1 });
      expect(report.cases.length, `${slot} has cases`).toBeGreaterThan(0);
      expect(notPassing(report.cases), `${slot}: the reference fill ${fill.variant ?? ''} passes`).toEqual([]);
      expect(report.verdict).toBe('PASS');
      expect(report.slot).toBe(slot);
      expect(report.revision).toBe(kit.revision);
      expect(fill.slot).toBe(slot);
    }
  }, 600_000);
});

describe('AC3 each hub slot\'s kit fails each of its planted wrong fills with that fill\'s own message', () => {
  it.each(SLOTS)('%s: the kit lists the planted fills the issue names, each breaking one of its rules, each with its own message and its own codes', (slot) => {
    const kit = slotKit(slot);
    const names = kit.planted.map((p) => p.name);
    for (const name of PLANTED[slot]!) expect(names, `${slot} plants ${name}`).toContain(name);
    expect(new Set(names).size, `planted names repeat: ${names.join(', ')}`).toBe(names.length);
    const messages = kit.planted.map((p) => p.message);
    expect(new Set(messages).size, `planted messages repeat: ${messages.join(' | ')}`).toBe(messages.length);
    expect(kit.rules.length, `${slot} lists its rules`).toBeGreaterThan(0);
    const rules = new Set(kit.rules.map((r) => r.id));
    for (const p of kit.planted) {
      expect(rules, `${p.name} breaks a rule the kit lists (${p.breaks})`).toContain(p.breaks);
      expect(p.message.length, `${p.name} has a message`).toBeGreaterThan(0);
      expect(p.codes.length, `${p.name} names the codes it raises`).toBeGreaterThan(0);
      expect(p.codes.some((c) => !ERROR_CODES.includes(c)), `${p.name} raises a finding of its rule, not only a shape refusal (${p.codes})`).toBe(true);
      expect(p.fill.slot).toBe(slot);
    }
  });

  it.each(SLOTS)('%s: each planted fill fails the kit, a FAIL carries its message and its codes, and no other planted fill\'s message', async (slot) => {
    const kit = slotKit(slot);
    for (const p of kit.planted) {
      const report = await run(kit, p.fill, { seed: 1 });
      expect(report.verdict, `${p.name} fails the kit`).not.toBe('PASS');
      const named = failing(report).filter((c) => c.message.includes(p.message));
      expect(named.length, `a FAIL names "${p.message}" (failures: ${failing(report).map((c) => `${c.id}: ${c.message}`).join(' | ')})`).toBeGreaterThan(0);
      for (const c of named) expect(c.codes, `${c.id} raises ${p.name}'s codes`).toEqual(expect.arrayContaining(p.codes));
      for (const other of kit.planted) if (other !== p) expect(failing(report).some((c) => c.message.includes(other.message)), `${p.name}'s failure doesn't carry ${other.name}'s message`).toBe(false);
    }
  }, 600_000);

  it('AC3 the four check.kind@1 runners, the two indexes, the two environments and the stream reader each fail their kit; a runner that passes any fails this test, naming each fill it passed', async () => {
    const passed = await plantedPassed(run);
    expect(passed, `planted fills the runner passed: ${passed.join(', ')}`).toEqual([]);
  }, 600_000);

  it('AC3 (wrong program) a kit that checks only each reply\'s shape passes every planted fill, and this test names each one it passed', async () => {
    const passed = await plantedPassed(shapeOnlyRunKit);
    const expected = SLOTS.flatMap((slot) => PLANTED[slot]!.map((name) => `${slot} ${name}`));
    expect(passed, 'the shape-only stand-in passes every planted fill the issue names').toEqual(expect.arrayContaining(expected));
    expect(() => expect(passed, `planted fills the runner passed: ${passed.join(', ')}`).toEqual([])).toThrow(/planted fills the runner passed: .*check\.kind@1 crashed-suite/);
  }, 600_000);

  it.each(SLOTS)('%s: each rule has exactly one planted fill that breaks it alone, and the kit has no problems', (slot) => {
    const kit = slotKit(slot);
    for (const rule of kit.rules) {
      const breaking = kit.planted.filter((p) => p.breaks === rule.id);
      expect(breaking.length, `rule ${rule.id} (${rule.rule}) has one planted fill, has ${breaking.map((p) => p.name).join(', ') || 'none'}`).toBe(1);
    }
    expect(kitProblems(kit), `${slot} has no kit problems`).toEqual([]);
  });

  it.each(SLOTS)('%s: the preflight\'s kit check names a rule no planted fill isolates, and a planted fill the kit admits', (slot) => {
    const kit = slotKit(slot);
    const first = planted(kit, PLANTED[slot]![0]!);
    const unproven = kitProblems(kitWith(kit, { planted: kit.planted.filter((p) => p !== first) }));
    expect(unproven.length).toBeGreaterThan(0);
    expect(unproven.some((p) => p.name === first.breaks || p.reason.includes(first.breaks)), `a problem names the rule ${first.breaks}: ${JSON.stringify(unproven)}`).toBe(true);
    // The planted fill replaced by the reference fill: the kit admits it, and the check names the fill.
    const admitted = kitProblems(kitWith(kit, { planted: kit.planted.map((p) => (p === first ? { ...p, fill: clean(kit) } : p)) }));
    expect(admitted.length).toBeGreaterThan(0);
    expect(admitted.some((p) => p.name === first.name || p.reason.includes(first.name)), `a problem names the fill ${first.name}: ${JSON.stringify(admitted)}`).toBe(true);
  }, 600_000);
});
