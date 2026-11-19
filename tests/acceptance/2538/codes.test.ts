// #2538 AC1: doctor.item@1's code enum lists the three codes `deep doctor` emits, and judge('doctor', code) reads
// each as listed with verdict FAIL. The enum is read from the schema file on disk; judge is the conformance
// package's, over the published schemas.
import { describe, expect, it } from 'vitest';
import { judge } from '../../../packages/conformance/src/index.ts';
import { CODES, listedCodes } from './helpers.ts';

describe('#2538.d5c537a3 AC1: `doctor.item@1`\'s `code` enum lists `polkit_action_missing`, `hooks_modified` and `mod_overrides_guard`, and `judge(\'doctor\', code)` reads each as listed with verdict FAIL', () => {
  it('#2538.d5c537a3 AC1: packages/contracts/schemas/doctor.item@1.json lists the three codes in its code enum, and still lists the reader\'s fallback `unknown` and `healthy`', () => {
    const listed = listedCodes();
    expect(listed).toEqual(expect.arrayContaining([...CODES]));
    expect(listed).toEqual(expect.arrayContaining(['healthy', 'unknown']));
    expect(new Set(listed).size).toBe(listed.length);
  });

  it.each(CODES)('#2538.d5c537a3 AC1: judge(\'doctor\', \'%s\') reads it as listed, verdict FAIL', (code) => {
    const read = judge('doctor', code);
    expect({ family: read.family, code: read.code, listed: read.listed, verdict: read.verdict }).toEqual({ family: 'doctor', code, listed: true, verdict: 'FAIL' });
  });
});
