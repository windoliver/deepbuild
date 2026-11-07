// AC15 #492.4f0f9de3: A hitstop with hold 140 ms at 1.000 s and 2.000 s and then: lag reads child time 1.000 s at t = 1.070 s,
// 1.360 s at 1.500 s, 2.000 s from t = 2.140 s to 2.280 s and 2.720 s at 3.000 s; with then: rejoin it reads 1.000 s at 1.070 s,
// 1.120 s at 1.200 s, 1.500 s at 1.500 s, 2.000 s at 2.100 s, 2.140 s at 2.210 s and 3.000 s at 3.000 s; each is the same at
// 24 and 60 fps and after a seek, `.active` reads 1 only inside the holds, and a planted hitstop that matches in parent time
// under then: lag holds at child 1.860 s from t = 2.000 s and fails, naming the remap and the flick.
//
// Through `deep-motion eval`. A ruler clip's x reads child time, a driver reads `<remap ID>.active` into a probe item (Time
// remap: "Drivers read"). The holds: under lag, the second match is read in child time, so it starts at parent 2.14 s, the
// child reaching 2 s only then; [1, 1.14) and [2.14, 2.28). Under rejoin [1, 1.14) and [2, 2.14). `.active` is read inside
// and outside each, not on the end flick, which the issue doesn't settle.
// No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import { AC, RULER, TIMEOUT, accepted, evalAll, evalOk, evalPlanted, failsNaming, film, fl, none, place, posOr, rect, useMotion, type Accepted, type JsonObject } from './helpers.ts';

const motion = useMotion();

type Then = 'lag' | 'rejoin';
const stopDoc = (then: Then, fps: number): JsonObject => film(`hitstop-${then}-${fps}`, [rect('dot', [0, 0]), rect('probe', [0, 0])], {
  clips: { ruler: RULER },
  placements: { p: place('ruler', 'dot', { start: '0s' }) },
  time_remaps: { stop: { target: 'p', map: { hitstop: { at: ['1s', '2s'], hold: '0.14s', then } } } },
  drivers: { watch: { target: 'items/probe/at/pos/0', expr: 'a', vars: { a: 'stop.active' } } },
}, { span: '4s', frame_rate: `${fps}/1` });

const READS: Record<Then, [number, number][]> = {
  lag: [[1.07, 1], [1.5, 1.36], [2.14, 2], [2.2, 2], [2.279, 2], [2.28, 2], [3, 2.72]],
  rejoin: [[1.07, 1], [1.2, 1.12], [1.5, 1.5], [2.1, 2], [2.21, 2.14], [3, 3]],
};
const ACTIVE: Record<Then, [number, number][]> = {
  lag: [[0.5, 0], [1.07, 1], [1.5, 0], [2.0, 0], [2.2, 1], [2.5, 0], [3, 0]],
  rejoin: [[0.5, 0], [1.07, 1], [1.2, 0], [1.5, 0], [2.1, 1], [2.21, 0], [3, 0]],
};

/** The check on child time: failures name the remap and the flick. */
function childFailures(a: Accepted, cases: [number, number][], what: string): string[] {
  return a.frames.flatMap((f, i) => {
    const got = posOr(f, 'dot', 0); const want = cases[i]![1];
    return Math.abs(got - want) <= 1e-8 ? [] : [`${what}: remap stop at ${f.t} flicks reads child ${got} s, not ${want} s`];
  });
}

describe(`${AC[15]} the hitstop preset`, () => {
  for (const then of ['lag', 'rejoin'] as const) {
    it(`${AC[15]} then: ${then} reads the issue's child times, the same at 24 and 60 fps and after a seek, and .active is 1 only inside the holds`, () => {
      const cases = READS[then]; const times = cases.map(([s]) => fl(s));
      const [at24, at60, ...seeks] = evalAll(motion.bin(), [{ doc: stopDoc(then, 24), times }, { doc: stopDoc(then, 60), times }, ...times.map((t) => ({ doc: stopDoc(then, 24), times: [t] }))]);
      const a = accepted(at24!, times, `${then} at 24 fps`); const b = accepted(at60!, times, `${then} at 60 fps`);
      none([...childFailures(a, cases, `${then} at 24 fps`), ...childFailures(b, cases, `${then} at 60 fps`)], `then: ${then}`);
      const failures: string[] = [];
      times.forEach((t, i) => {
        const got = posOr(a.frames[i]!, 'dot', 0); const other = posOr(b.frames[i]!, 'dot', 0);
        const seek = posOr(accepted(seeks[i]!, [t], `the seek to ${t}`).frames[0]!, 'dot', 0);
        if (!Object.is(got, other) || !Object.is(got, seek)) failures.push(`at ${t} flicks: 24 fps ${got}, 60 fps ${other}, seek ${seek}`);
      });
      none(failures, 'the same at each rate and after a seek');
      const on = ACTIVE[then]; const seen = evalOk(motion.bin(), { doc: stopDoc(then, 60), times: on.map(([s]) => fl(s)) }, `.active under ${then}`);
      none(seen.frames.flatMap((f, i) => (posOr(f, 'probe', 0) === on[i]![1] ? [] : [`.active at ${on[i]![0]} s reads ${posOr(f, 'probe', 0)}, not ${on[i]![1]}`])), '.active');
    }, TIMEOUT);
  }

  it(`${AC[15]} a planted hitstop that matches in parent time under then: lag holds at child 1.860 s from t = 2.000 s and fails, naming the remap and the flick`, () => {
    const cases = READS.lag; const times = cases.map(([s]) => fl(s));
    const doc = stopDoc('lag', 60);
    const held = evalPlanted(motion.bin(), { doc, times: [fl(2), fl(2.07)], planted: 'hitstop_matches_parent_time' }, 'the plant from 2 s');
    for (const f of held.frames) expect(Math.abs(posOr(f, 'dot', 0) - 1.86), `the plant holds child 1.860 s at ${f.t} flicks: it reads ${posOr(f, 'dot', 0)}`).toBeLessThanOrEqual(1e-8);
    const plant = evalPlanted(motion.bin(), { doc, times, planted: 'hitstop_matches_parent_time' }, 'the plant');
    failsNaming(childFailures(plant, cases, 'the plant'), ['remap stop', `at ${fl(2.14)} flicks`], 'the parent-time hitstop');
  }, TIMEOUT);
});
