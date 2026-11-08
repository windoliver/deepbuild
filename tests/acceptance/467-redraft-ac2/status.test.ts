// AC2 #467.93e9eaf5: Glow, the inner shade, bevel and satin on text each reuse the shaped run and count in the fit
// check: the inner ones stay inside the coverage and the outer ones inside the item's bounds; a still card with all
// four costs nothing per frame after its first; each matches its CPU reference within one 8-bit code value on 99.9% of
// pixels; and a status role is refused
//
// Blind redraft of ../467/paint.test.ts's "a status role is refused in each of the four" (README: what was disputed).
// This file carries only the criterion's last clause. Through `deep-canvas-render check` (every platform): a status role
// in each of the four is the check's only error, the base's `status_color_unbound`, naming the text; the same four in
// data roles pass. Every document ID is inside the ID grammar.
import { describe, expect, it } from 'vitest';
import { AC, ALL_FOUR, card, check, describeErrors, useBin, type JsonObject } from '../467/helpers.ts';

const ID = AC[2];
const bin = useBin('deep-canvas-render');

describe(`${ID} a status role in glow, the inner shade, bevel or satin`, () => {
  it(`${ID} a status role is refused in each of the four`, () => {
    const cases: [string, string, JsonObject][] = [
      ['glow', 'status-glow', { glow: { role: 'status.pass' } }],
      ['the inner shade', 'status-inner-shade', { shade: { kind: 'inner', role: 'status.pass' } }],
      ['bevel', 'status-bevel', { bevel: { highlight: { role: 'status.pass' }, shadow: { role: 'dark' } } }],
      ['satin', 'status-satin', { satin: { role: 'status.pass' } }],
    ];
    for (const [name, docId, paint] of cases) {
      const { answer, errors } = check(bin(), card(docId, paint));
      expect(answer['ok'], `${name} naming status.pass is refused at check: ${describeErrors(errors)}`).toBe(false);
      expect(errors.map((e) => e.code), `${name}: the only error is the status-color rule's`).toEqual(['status_color_unbound']);
      expect(errors[0]!.ids, `${name}: the refusal names the text`).toContain('word');
    }
    const { errors } = check(bin(), card('status-none', ALL_FOUR));
    expect(describeErrors(errors), 'the same four in data roles pass the check').toBe('none');
  });
});
