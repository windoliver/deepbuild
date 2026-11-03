// AC5: "a beside b and b beside a is refused `relation_cycle` naming both; a planted three-item cycle names all three"
//
// No upstream test (the oracle page: "Refusing a relation cycle as relation_cycle, naming the chain, is our check").
import { describe, expect, it } from 'vitest';
import { TIMEOUT, batch, checkAll, errorsOf, listIssues, loadDoc, scratch, show, useRenderBinary } from './helpers.ts';

useRenderBinary();
const store = scratch('store');

describe('AC5 a cycle through relations is refused at check as relation_cycle, naming the chain', () => {
  it('AC5 a beside b and b beside a is refused relation_cycle naming both, and a drawing command refuses it with that code', () => {
    const doc = loadDoc('cycle-two.json');
    const [r] = checkAll([doc], store);
    expect(r!.ok, `the check refuses the cycle: ${show(r!.raw)}`).toBe(false);
    const cycles = errorsOf(r!).filter((e) => e.code === 'relation_cycle');
    expect(cycles.length, `an error relation_cycle; the errors: ${listIssues(errorsOf(r!)).join('; ')}`).toBeGreaterThan(0);
    expect(cycles.some((e) => e.ids.includes('a') && e.ids.includes('b')), `a relation_cycle error names both a and b in its ids: ${cycles.map((e) => show(e.raw)).join('; ')}`).toBe(true);
    // A document the check refuses never draws: geometry answers the check's code (#373: the first error's code).
    const [g] = batch('geometry', [{ doc, item: 'a', store, t: 0 }]);
    expect(g!['ok'], `geometry refuses the cycle: ${show(g)}`).toBe(false);
    expect(g!['code']).toBe('relation_cycle');
  }, TIMEOUT);

  it('AC5 a planted three-item cycle (a beside b, b aligned to c, c onto a) is refused relation_cycle naming all three, and not d, which reads the chain but isn\'t in it', () => {
    const [r] = checkAll([loadDoc('cycle-three.json')], store);
    expect(r!.ok, `the check refuses the cycle: ${show(r!.raw)}`).toBe(false);
    const cycles = errorsOf(r!).filter((e) => e.code === 'relation_cycle');
    expect(cycles.length, `an error relation_cycle; the errors: ${listIssues(errorsOf(r!)).join('; ')}`).toBeGreaterThan(0);
    const chain = cycles.find((e) => ['a', 'b', 'c'].every((id) => e.ids.includes(id)));
    expect(chain, `a relation_cycle error names a, b and c in its ids: ${cycles.map((e) => show(e.raw)).join('; ')}`).toBeDefined();
    expect(chain!.ids, 'the chain is a, b and c alone: d only reads it').not.toContain('d');
  }, TIMEOUT);

  it('AC5 the same relations with no read back (c onto a fixed point) pass the check: a chain is not a cycle', () => {
    const [r] = checkAll([loadDoc('chain.json')], store);
    expect(listIssues(errorsOf(r!)), 'no error: the chain d → a → b → c ends at a point').toEqual([]);
    expect(r!.ok).toBe(true);
  }, TIMEOUT);
});
