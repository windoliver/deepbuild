// #2146 AC2: a code added to a schema with no mapping still fails the lint, naming the code. The lint's
// `code mappings` lines are unmappedCodes()'s entries, one line each, so the tests widen one published enum with a
// code nothing maps and read what unmappedCodes names over those schemas, as tests/acceptance/313/codes.test.ts does
// for the verdict, refusal and exit families. Here: the doctor family (the issue's `doctor service_unpromoted`
// line) and every list of state words that holds PASS (the issue's `verdict queued` lines come from row.set's word).
import { describe, expect, it } from 'vitest';
import { codeFamilies, judge, unmappedCodes } from '../../../packages/conformance/src/index.ts';
import { PLANTED, publishedEnums, widened } from './helpers.ts';

const key = (u: { family: string; code: string }): string => `${u.family} ${u.code}`;
/** What the lint names over the widened schemas that it doesn't name over the published ones. */
const newlyNamed = (schema: string, pointer: string): { family: string; code: string }[] => {
  const before = new Set(unmappedCodes().map(key));
  return unmappedCodes(widened(schema, pointer, PLANTED)).filter((u) => !before.has(key(u)));
};

// Every published enum that lists PASS among its values: verdict lists, and state lists such as a row's word.
const withPass = publishedEnums().filter((e) => e.values.includes('PASS'));
if (!withPass.some((e) => e.schema.startsWith('row.set@') && e.values.includes('queued'))) throw Error('no row.set schema lists its state words beside PASS; the issue\'s `verdict queued` lines come from that list');

describe('#2146.bd46e9b3 AC2: A code added to a schema with no mapping still fails it, naming the code', () => {
  it(`#2146.bd46e9b3 AC2: a doctor code added to the doctor family's enum (doctor.item's code) with no mapping is named: doctor ${PLANTED}`, () => {
    const doctor = codeFamilies().find((f) => f.family === 'doctor')!;
    expect(doctor.schema).toMatch(/^doctor\.item@\d+$/);
    expect(doctor.codes).toContain('unknown');
    expect(doctor.codes).not.toContain(PLANTED);
    expect(newlyNamed(doctor.schema, doctor.pointer)).toEqual([{ family: 'doctor', code: PLANTED }]);
    // Nothing maps it, so a doctor item that carries it is INVALID, naming it, never a success.
    const judged = judge('doctor', PLANTED);
    expect({ verdict: judged.verdict, listed: judged.listed }).toEqual({ verdict: 'INVALID', listed: false });
    expect(judged.message).toContain(PLANTED);
  });

  it.each(withPass.map((e) => [e.schema, e.pointer || '(root)', e.pointer] as const))(`#2146.bd46e9b3 AC2: a word added to %s's list at %s, which holds PASS, with no mapping is named: ${PLANTED}`, (schema, _shown, pointer) => {
    const named = newlyNamed(schema, pointer);
    expect(named.length, `${schema}${pointer} widened with ${PLANTED} names something new`).toBeGreaterThan(0);
    expect(named.map((u) => u.code)).toEqual(named.map(() => PLANTED));
  });
});
