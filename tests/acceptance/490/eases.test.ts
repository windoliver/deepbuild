// Criterion 1: "Every closed ease name holds its identities in f64 (ends at 0 and 1, the symmetry of in-out,
// monotonicity over 1,001 samples for monotonic families)"
//
// Through `deep-show run` in the `core` build (text and look only, no motion): deep://registries lists ease@1's
// first-party entries, which must hold every closed name, and the `fn` call reads `ease(<name>, x)` at the 1,001
// points x = i/1000 through the core's closed function list. Each ease at its default params. The identities: exactly
// 0 at 0 and exactly 1 at 1; an in_out ease's e(x) + e(1 − x) = 1 within 1e-12; and, outside the back, elastic and
// bounce families and running_start, e(x_{i+1}) ≥ e(x_i) at every step. No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import { EASES, NOT_MONOTONE, TIMEOUT, fnReplies, none, runShow, scalars, scenario, theRegistry, useEvidence, useShow } from './helpers.ts';

const CORE = 'core';
const shows = useShow([CORE]);
const evidence = useEvidence();
const XS = Array.from({ length: 1001 }, (_, i) => i / 1000);

describe('criterion 1: every closed ease name holds its identities in f64', () => {
  it('criterion 1: ease@1 in a build without motion holds every closed ease name as a first-party entry', () => {
    const bin = shows.bin(CORE);
    const r = theRegistry(runShow(bin, scenario(evidence(), [{ call: 'registries' }]))[0]!, 'ease@1');
    const names = new Set(r.entries.filter((e) => e.origin === 'first_party').map((e) => e.name));
    none(EASES.filter((n) => !names.has(n)).map((n) => `ease@1 holds no first-party entry ${n}`), 'the closed eases in ease@1');
  }, TIMEOUT);

  it('criterion 1: each closed ease reads exactly 0 at 0 and 1 at 1, an in_out ease is symmetric, and a monotonic one never decreases over 1,001 samples', () => {
    const bin = shows.bin(CORE);
    const replies = fnReplies(bin, evidence(), EASES.map((name) => ({ expr: `ease(${name}, x)`, context: 'driver' as const, at: XS })));
    const failures: string[] = [];
    EASES.forEach((name, n) => {
      const v = scalars(replies[n]!, XS.length, `ease(${name}, x)`);
      if (v[0] !== 0) failures.push(`${name} reads ${v[0]} at 0, not 0`);
      if (v[1000] !== 1) failures.push(`${name} reads ${v[1000]} at 1, not 1`);
      if (v.some((y) => y === null)) failures.push(`${name} has a non-finite value`);
      if (name.startsWith('in_out_')) {
        for (let i = 0; i <= 1000; i++) {
          const s = (v[i] ?? NaN) + (v[1000 - i] ?? NaN);
          if (!(Math.abs(s - 1) <= 1e-12)) { failures.push(`${name}: e(${XS[i]}) + e(${XS[1000 - i]}) = ${s}, not 1`); break; }
        }
      }
      if (!NOT_MONOTONE(name)) {
        for (let i = 0; i < 1000; i++) {
          if (!((v[i + 1] ?? NaN) >= (v[i] ?? NaN))) { failures.push(`${name} decreases from ${v[i]} at ${XS[i]} to ${v[i + 1]} at ${XS[i + 1]}`); break; }
        }
      }
    });
    expect(replies.length).toBe(EASES.length);
    none(failures, 'the identities of the closed eases');
  }, TIMEOUT);
});
