import { describe, expect, it } from 'vitest';
import { batch, useBinary, check, clone, describeIssues, fixture, issuesOf, UNIT_FAMILIES } from './helpers.ts';
import type { JsonObject, JsonValue } from './helpers.ts';

useBinary();

const params = (doc: JsonObject, id: string): JsonObject => ((doc['items'] as Record<string, JsonObject>)[id]!['params'] as JsonObject);

describe('AC1 a document with a broken reference is refused, and the agent gets the issue by ID', () => {
  it('AC1 a parent that names no item is ref_unresolved, with the item\'s ID, its path and the value', () => {
    const out = check(fixture<JsonObject>('broken-ref.json'));
    expect(out.ok, 'the document with a broken reference passed').toBe(false);
    const issues = issuesOf(out, 'ref_unresolved');
    expect(issues.length, `no ref_unresolved issue: ${describeIssues(out)}`).toBeGreaterThan(0);
    const mine = issues.find((i) => i.ids.includes('sign'));
    expect(mine, `no ref_unresolved issue carries the ID sign: ${describeIssues(out)}`).toBeDefined();
    expect(mine!.path).toBe('items/sign/parent');
    expect(mine!.actual).toBe('ghost');
    expect(mine!.severity).toBe('error');
    expect(mine!.check.length).toBeGreaterThan(0);
  });
});

describe('AC5 unknown fields, unknown kinds and newer majors', () => {
  it('AC5 a field the kind\'s version does not define fails with unknown_field at the field\'s path', () => {
    const out = check(fixture<JsonObject>('unknown-field.json'));
    expect(out.ok, 'a document with an unknown field passed').toBe(false);
    const issue = issuesOf(out, 'unknown_field').find((i) => i.path === 'items/slab/params/glow');
    expect(issue, `no unknown_field at items/slab/params/glow: ${describeIssues(out)}`).toBeDefined();
    expect(issue!.ids).toEqual(['slab']);
  });

  it('AC5 the same field is skipped with a notice when the document requires a newer minor of the kind', () => {
    const doc = clone(fixture<JsonObject>('unknown-field.json'));
    doc['requires'] = { kinds: ['test.slab@3.2'] };
    const out = check(doc);
    expect(out.ok, `a document requiring test.slab@3.2 was refused: ${describeIssues(out)}`).toBe(true);
    expect(issuesOf(out, 'unknown_field')).toEqual([]);
    const notice = out.notices.find((n) => n.code === 'unknown_field' && n.path === 'items/slab/params/glow');
    expect(notice, `no unknown_field notice at items/slab/params/glow: ${JSON.stringify(out.notices)}`).toBeDefined();
    expect(notice!.ids).toEqual(['slab']);
    expect(notice!.severity).toBe('notice');
    // Skipped: the lowered form carries the kind's fields and not the unknown one.
    expect(Object.keys(params(out.lowered, 'slab'))).not.toContain('glow');
    expect(out.draws).toContain('slab');
  });

  it('AC5 an item of a kind the app does not know is skipped with the notice unknown_kind while the rest draws', () => {
    const out = check(fixture<JsonObject>('unknown-kind.json'));
    expect(out.ok, `a document with an unknown kind was refused: ${describeIssues(out)}`).toBe(true);
    const notice = out.notices.find((n) => n.code === 'unknown_kind');
    expect(notice, `no unknown_kind notice: ${JSON.stringify(out.notices)}`).toBeDefined();
    expect(notice!.ids).toEqual(['cube']);
    expect(notice!.path).toBe('items/cube/kind');
    expect(notice!.actual).toBe('test.cube@1');
    expect([...out.draws].sort()).toEqual(['slab']);
    // Kept byte for byte: the unknown item stays in the lowered document as written.
    expect((out.lowered['items'] as JsonObject)['cube']).toEqual((fixture<JsonObject>('unknown-kind.json')['items'] as JsonObject)['cube']);
  });

  it('AC5 a newer major of a known kind is refused with kind_too_new', () => {
    const out = check(fixture<JsonObject>('newer-major.json'));
    expect(out.ok, 'a document with test.slab@4 passed').toBe(false);
    const issue = issuesOf(out, 'kind_too_new')[0];
    expect(issue, `no kind_too_new issue: ${describeIssues(out)}`).toBeDefined();
    expect(issue!.ids).toEqual(['slab']);
    expect(issue!.path).toBe('items/slab/kind');
    expect(issue!.actual).toBe('test.slab@4');
    expect(out.notices.filter((n) => n.code === 'unknown_kind')).toEqual([]);
  });
});

describe('AC6 a literal whose unit does not convert to the field\'s unit fails naming the field and the forms it takes', () => {
  it('AC6 "45deg" in a length field names the field and lists only length units, printed by the unit printer', () => {
    const out = check(fixture<JsonObject>('unit-mismatch.json'));
    expect(out.ok, '"45deg" in a length field passed').toBe(false);
    const issue = issuesOf(out, 'bad_unit').find((i) => i.path === 'items/slab/params/width');
    expect(issue, `no bad_unit issue at items/slab/params/width: ${describeIssues(out)}`).toBeDefined();
    expect(issue!.ids).toEqual(['slab']);
    expect(issue!.actual).toBe('45deg');
    // A check that names the field alone fails here: the forms the field takes must be listed.
    expect(Array.isArray(issue!.forms) && issue!.forms.length > 0, `the issue lists no forms: ${JSON.stringify(issue)}`).toBe(true);
    const forms = issue!.forms!;
    const lengthUnits = Object.keys(UNIT_FAMILIES['m']!);
    const units = forms.map((f) => /^-?[0-9]+(?:\.[0-9]+)?([a-z]+)$/.exec(f)?.[1] ?? `(not a literal: ${f})`);
    expect([...new Set(units)].sort(), 'the forms list exactly the length units').toEqual([...lengthUnits].sort());
    // Printed by the grammar's printer: each form is a valid literal for the field that prints back as itself.
    const printed = batch(['parse', 'unit'], forms.map((text) => ({ text, unit: 'm' })));
    forms.forEach((form, i) => {
      const o = printed[i] as JsonObject;
      expect(o['ok'], `the form ${form} does not parse as a length`).toBe(true);
      expect(o['printed'], `the form ${form} is not the printer's text`).toBe(form);
    });
  });

  it('AC6 a literal that converts, "300 mm" for a length in meters, is read as 0.3 and loses nothing', () => {
    const out = check(fixture<JsonObject>('unit-converts.json'));
    expect(out.ok, `"300 mm" in a length field was refused: ${describeIssues(out)}`).toBe(true);
    const width = params(out.lowered, 'slab')['width'] as JsonValue;
    expect(typeof width).toBe('number');
    expect(width as number).toBeCloseTo(0.3, 6);
    expect(params(out.lowered, 'slab')['height'] as number).toBeCloseTo(2.5, 6);
  });
});
