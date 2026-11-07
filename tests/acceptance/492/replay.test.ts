// AC11 #492.2a883e4b: A replay remap with before 1 s, after 0.5 s and rate 0.5 on an occurrence at 4 s shows child time 3 +
// (t − 4) × 0.5 until t = 7 s, then parent time, `.active` reads 1 only inside that span, and an occurrence at 5 s starts no
// second replay; a planted replay at rate 1 ends at 5.5 s and fails.
//
// Through `deep-motion eval`. A ruler clip's x reads child time. Cue markers at 4 s and 5 s are the occurrences (`on: {list:
// "markers.cue"}`, Driver's filter); a driver reads `<remap ID>.active` into a probe item (Time remap). The child time reaches
// tc + after = 4.5 s at t = 4 + 1.5 ÷ 0.5 = 7 s; at rate 1, at t = 5.5 s. No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import { AC, RULER, TIMEOUT, evalOk, evalPlanted, film, fl, none, place, posOr, rect, secs, useMotion, type Accepted } from './helpers.ts';

const motion = useMotion();

const DOC = film('replay', [rect('dot', [0, 0]), rect('probe', [0, 0])], {
  clips: { ruler: RULER },
  placements: { p: place('ruler', 'dot', { start: '0s' }) },
  markers: { hit: { kind: 'cue', t: '4s' }, late: { kind: 'cue', t: '5s' } },
  time_remaps: { again: { target: 'p', map: { replay: { on: { list: 'markers.cue' }, before: '1s', after: '0.5s', rate: '1/2' } } } },
  drivers: { watch: { target: 'items/probe/at/pos/0', expr: 'a', vars: { a: 'again.active' } } },
}, { span: '10s' });
const TIMES = [1, 3.9, 4, 4.5, 5, 5.5, 6, 6.9, 7, 7.5, 9].map(fl);

/** The criterion's reading of child time at parent time s. */
const child = (s: number): number => (s >= 4 && s < 7 ? 3 + (s - 4) * 0.5 : s);
const active = (s: number): number => (s >= 4 && s < 7 ? 1 : 0);

function replayFailures(a: Accepted, what: string): string[] {
  return a.frames.flatMap((f) => {
    const s = secs(f.t); const got = posOr(f, 'dot', 0); const on = posOr(f, 'probe', 0); const out: string[] = [];
    if (!(Math.abs(got - child(s)) <= 1e-8)) out.push(`${what}: child time at ${s} s reads ${got}, not ${child(s)}`);
    if (on !== active(s)) out.push(`${what}: .active at ${s} s reads ${on}, not ${active(s)}`);
    return out;
  });
}

describe(`${AC[11]} a replay on an occurrence`, () => {
  it(`${AC[11]} child time is 3 + (t − 4) × 0.5 until 7 s, then parent time, .active is 1 only inside, and the occurrence at 5 s starts no second replay`, () => {
    none(replayFailures(evalOk(motion.bin(), { doc: DOC, times: TIMES }, 'the replay'), 'the replay'), 'the replay');
  }, TIMEOUT);

  it(`${AC[11]} a planted replay at rate 1 ends at 5.5 s and fails`, () => {
    const plant = evalPlanted(motion.bin(), { doc: DOC, times: TIMES, planted: 'replay_at_rate_1' }, 'the replay at rate 1');
    const at = (s: number): number => posOr(plant.frames[TIMES.indexOf(fl(s))]!, 'dot', 0);
    expect(Math.abs(at(5) - 4), `the plant runs at rate 1 from 3 s at 4 s: at 5 s it reads ${at(5)}`).toBeLessThanOrEqual(1e-8);
    expect(Math.abs(at(5.5) - 5.5), `the plant has ended at 5.5 s: it reads ${at(5.5)}`).toBeLessThanOrEqual(1e-8);
    expect(replayFailures(plant, 'the plant').length, 'the check the real program passes fails on the plant').toBeGreaterThan(0);
  }, TIMEOUT);
});
