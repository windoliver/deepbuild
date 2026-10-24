// AC11, the preflight's half: the conformance package's kit check finds no problem in the plug-in's kit, so each of
// its rules has the one planted fill that breaks it alone, the unfound-theorem runner among them, and the kit refuses
// each with its own message while its reference runner passes every fixed case.
import { describe, expect, it } from 'vitest';
import { kitProblems } from '../../../packages/conformance/src/index.ts';
import { LEAN_TEST, plugin, requireKani, requireLean } from './helpers.ts';

describe('AC11 the preflight\'s kit check finds no problem in the plug-in\'s check.kind@1 kit', () => {
  it('AC11 kitProblems on the plug-in\'s kit is empty: a planted fill per rule, the unfound-theorem runner refused with its own message, the reference fill passing', async () => {
    const k = (await plugin()).proofKit();
    requireLean();
    requireKani();
    expect(k.planted.map((p) => p.name)).toContain('unfound-theorem');
    expect(kitProblems(k)).toEqual([]);
  }, 3 * LEAN_TEST);
});
