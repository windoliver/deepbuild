// #490.dfa2703b: "Every closed ease name holds its identities in f64 (ends at 0 and 1, the symmetry of in-out,
// monotonicity over 1,001 samples for monotonic families)"
//
// Through `deep-show run` in the `core` build (no motion): deep://registries lists ease@1's first-party entries, which
// must hold every closed name, and the `fn` call reads `ease(<name>, x)` through the core's closed function list at the
// 1,001 points x = i/1000, each ease at its default params. The identities: exactly 0 at 0 and exactly 1 at 1; an
// in_out ease's e(x) + e(1 − x) = 1 within 1e-12; outside the back, elastic and bounce families and running_start
// (whose shapes leave [0, 1] or turn back by design), e(x_{i+1}) ≥ e(x_i) at every step.
import { describe, it } from 'vitest';
import { EASES, NOT_MONOTONE, TIMEOUT, fnReplies, none, runShow, scalars, scenario, theRegistry, useEvidence, useShow } from './helpers.ts';

const CORE = 'core';
const shows = useShow([CORE]);
const evidence = useEvidence();
const XS = Array.from({ length: 1001 }, (_, i) => i / 1000);

describe('#490.dfa2703b the closed eases hold their identities in f64', () => {
  it('#490.dfa2703b every closed ease name is a first-party entry of ease@1 and reads exactly 0 at 0 and 1 at 1, each in_out ease is symmetric, and each monotonic one never decreases over 1,001 samples', () => {
    const bin = shows.bin(CORE);
    const failures: string[] = [];
    const r = theRegistry(runShow(bin, scenario(evidence(), [{ call: 'registries' }]))[0]!, 'ease@1');
    const listed = new Set(r.entries.filter((e) => e.origin === 'first_party').map((e) => e.name));
    for (const n of EASES) if (!listed.has(n)) failures.push(`ease@1 holds no first-party entry ${n}`);
    const replies = fnReplies(bin, evidence(), EASES.map((name) => ({ expr: `ease(${name}, x)`, context: 'driver' as const, at: XS })));
    EASES.forEach((name, n) => {
      const v = scalars(replies[n]!, XS.length, `ease(${name}, x)`);
      if (v[0] !== 0) failures.push(`${name} reads ${v[0]} at 0, not 0`);
      if (v[1000] !== 1) failures.push(`${name} reads ${v[1000]} at 1, not 1`);
      if (v.some((y) => y === null)) failures.push(`${name} has a value that isn't finite`);
      if (name.startsWith('in_out_')) {
        for (let i = 0; i <= 1000; i++) {
          const s = (v[i] ?? NaN) + (v[1000 - i] ?? NaN);
          if (!(Math.abs(s - 1) <= 1e-12)) { failures.push(`${name}: e(${XS[i]}) + e(${XS[1000 - i]}) = ${s}, not 1 within 1e-12`); break; }
        }
      }
      if (!NOT_MONOTONE(name)) {
        for (let i = 0; i < 1000; i++) {
          if (!((v[i + 1] ?? NaN) >= (v[i] ?? NaN))) { failures.push(`${name} decreases from ${v[i]} at ${XS[i]} to ${v[i + 1]} at ${XS[i + 1]}`); break; }
        }
      }
    });
    none(failures, 'the identities of the closed eases');
  }, TIMEOUT);
});
