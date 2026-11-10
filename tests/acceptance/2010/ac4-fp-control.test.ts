// #2010.61aa2e8e: a golden step that starts with flush-to-zero set on its thread fails at that step, naming the
// floating-point control register, before any hash is compared.
//
// golden_verify's `ftz_at: k` sets flush-to-zero on the thread that steps the world just before step k starts (README).
// "Before any hash is compared": the run that meets it reports the register's failure and no hash comparison, even when
// an earlier step's hash would also differ (a one-ulp shift at step 60 in the same run).
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, FP_REGISTER, OTHER, TIMEOUT, answered, ask, goldenOf, isObject, none, pileAndFlyer, prebuild, recordGolden, scratch, shift, show,
  verifyGolden, type JsonObject,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[4];
const N = 240;
const FTZ = 120;

/** Fails at step 120 on the floating-point control register, with no hash comparison reported. */
function guardFailures(reply: JsonObject): string[] {
  if (reply['ok'] !== true) return [`golden_verify doesn't answer: ${show(reply)}`];
  const f: string[] = [];
  if (reply['verdict'] !== 'FAIL') f.push(`the verdict is ${show(reply['verdict'])}, not FAIL`);
  const failure = reply['failure'];
  if (!isObject(failure)) return [...f, `no failure is named: ${show(reply)}`];
  if (failure['step'] !== FTZ) f.push(`the failure is at step ${show(failure['step'])}, not ${FTZ}`);
  if (failure['register'] !== FP_REGISTER) f.push(`the failure names register ${show(failure['register'])}, not ${FP_REGISTER} (this machine's floating-point control register)`);
  if ((reply['report'] ?? null) !== null) f.push(`a hash comparison was reported: ${show(reply['report'])}`);
  return f;
}

describe(`${ID} a golden step that starts with flush-to-zero set fails on the floating-point control register`, () => {
  it(`${ID} a step that starts with flush-to-zero set fails at that step, naming ${FP_REGISTER}, before any hash is compared`, () => {
    const w = pileAndFlyer();
    const store = scratch('ac4-store');
    const golden = goldenOf(ask([recordGolden(w, N, store, [OTHER])])[0]!, 'golden');
    const [clean, ftz, both] = ask([
      verifyGolden(golden, w, N, { store }),
      verifyGolden(golden, w, N, { store, ftz_at: FTZ }),
      verifyGolden(golden, w, N, { store, ftz_at: FTZ, shift: shift(60, 'ball', 'linear.x') }),
    ]);
    expect(answered(clean, 'the clean second run')['verdict'], `with the control register as it should be, the run matches: ${show(clean)}`).toBe('PASS');
    expect(clean!['failure'] ?? null, 'and names no failure').toBe(null);
    none(guardFailures(ftz!), `flush-to-zero set before step ${FTZ}: ${show(ftz)}`);
    none(guardFailures(both!), `flush-to-zero set before step ${FTZ}, with step 60's hash also off: the register fails before any hash is compared: ${show(both)}`);
  }, TIMEOUT);
});
