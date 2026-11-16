// Oracle port for criterion 3 (AC3 #225.174320e5): the upstream tests' test_flow_speed_only_converts_elapsed_time_once
// and test_flow_initial_phase_and_long_steps_compose (the oracle page: tests/unit/mobjects/test_vector_field.py:15-59,
// pinned at cfd33af5aa), run against our output.
//
// Upstream: stream lines of a constant field over one start, virtual time 1, flow as a trim window whose phase is
// elapsed × speed mod 1 (speed applied once), and one 2.75 s step gives the windows eleven 0.25 s steps give. Ours: a
// film (3 s) holding `lines`, a vector_field@1 with `fn: {x: "1", y: "0"}`, `streams: {starts: {points: [[0, 0, 0]]},
// step: 0.1, time: 1}` and `flow: {speed, flash: 0.3, phase, warm_up}`; `{"call": "vector_field"}`'s `trims` at t. Our
// window is [p, p + flash] (the design's), where upstream writes its own [1.3 p − 0.3, 1.3 p]; the phase p is what both
// pin.
// 1. Speed once: for speed 0.5, 1 and 2 (phase zero, warm_up false) at 0.125, 0.75 and 2.75 s, the window starts at
//    fract(t × speed ÷ 1) within 1e-12 and is 0.3 long within 1e-6. The planted fault, the program's output read
//    against a wrong program's formula: speed applied twice, fract(t × speed²), must fail.
// 2. Steps compose: with warm_up false and true (phase hashed), and with phase zero, warm_up false, playing every
//    0.25 s from 0 to 2.75 s gives at 2.75 s exactly the windows a fresh process seeking to 2.75 s gives; with phase
//    zero they start at 0.75. The planted fault: the play against a seek to 2.5 s, a play one step short, must differ.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, evalAt, failsNaming, field, fieldCall, fieldOf, film, fl, fract, none, present, presented, run, scenario, useBins, useFolders, type JsonObject } from './helpers.ts';

const bin = useBins(['show']);
const folder = useFolders();
const ELAPSED = [0.125, 0.75, 2.75];
const linesFilm = (flow: JsonObject): JsonObject => film('stream lines flowing', [640, 480], [field('lines', 'a0', {
  fn: { x: '1', y: '0' }, streams: { starts: { points: [[0, 0, 0]] }, step: 0.1, time: 1 }, flow: { flash: 0.3, ...flow },
})], { transport: { span: '3s' } });

/** The windows at each of `times` seeked in one fresh process (no frame played before). */
function seeked(flow: JsonObject, times: number[]): [number, number][][] {
  const replies = run(bin('show'), scenario(folder(), [present(linesFilm(flow)), ...times.map((t) => fieldCall('lines', t))]));
  presented(replies[0]!, 'the stream lines film');
  return replies.slice(1).map((r, i) => fieldOf(r, `vector_field lines at ${times[i]} flicks`).trims);
}
/** Played every 0.25 s from 0 to 2.75 s in one session: the windows at 2.75 s. */
function played(flow: JsonObject): [number, number][] {
  const steps = Array.from({ length: 12 }, (_, k) => fl(0.25 * k));
  const replies = run(bin('show'), scenario(folder(), [present(linesFilm(flow)), ...steps.map((t) => evalAt(t)), fieldCall('lines', fl(2.75))]));
  presented(replies[0]!, 'the stream lines film, played');
  return fieldOf(replies[replies.length - 1]!, 'vector_field lines at 2.75 s, played').trims;
}
function speedOnce(phaseOf: (elapsed: number, speed: number) => number): string[] {
  return [0.5, 1, 2].flatMap((speed) => seeked({ speed, phase: 'zero', warm_up: false }, ELAPSED.map(fl)).flatMap((trims, k) => {
    const want = phaseOf(ELAPSED[k]!, speed);
    const [from, to] = trims[0] ?? [NaN, NaN];
    const out: string[] = [];
    if (trims.length !== 1) out.push(`speed ${speed}, ${ELAPSED[k]} s: ${trims.length} windows, not one per stream`);
    if (!(Math.abs(from - want) <= 1e-12)) out.push(`speed ${speed}, ${ELAPSED[k]} s: the window starts at ${from}, not ${want}`);
    if (!(Math.abs(to - from - 0.3) <= 1e-6)) out.push(`speed ${speed}, ${ELAPSED[k]} s: the window [${from}, ${to}] isn't 0.3 long`);
    return out;
  }));
}

describe('oracle: stream lines flow as a trim window in closed form (criterion 3)', () => {
  it('AC3 #225.174320e5 test_flow_speed_only_converts_elapsed_time_once: the window starts at fract(elapsed × speed ÷ time)', () => {
    none(speedOnce((t, speed) => fract(t * speed)), 'speed applied once');
    failsNaming(speedOnce((t, speed) => fract(t * speed * speed)), ['speed 2'], 'the windows read against speed applied twice');
  }, TIMEOUT);

  it('AC3 #225.174320e5 test_flow_initial_phase_and_long_steps_compose: one seek to 2.75 s gives the windows eleven 0.25 s steps give', () => {
    for (const flow of [{ phase: 'hashed', warm_up: false }, { phase: 'hashed', warm_up: true }, { phase: 'zero', warm_up: false }] as JsonObject[]) {
      const [seek, short] = seeked({ speed: 1, ...flow }, [fl(2.75), fl(2.5)]);
      const play = played({ speed: 1, ...flow });
      expect(play, `the played windows equal the seeked ones exactly (${JSON.stringify(flow)})`).toEqual(seek);
      expect(play, `a play one step short gives other windows (${JSON.stringify(flow)})`).not.toEqual(short);
      if (flow['phase'] === 'zero') expect(seek![0]![0], 'with phase zero the window starts at fract(2.75) = 0.75').toBe(0.75);
    }
  }, TIMEOUT);
});
