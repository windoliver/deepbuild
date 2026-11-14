// AC11: "An emitter with life 1.5 s whose span ends at 2 s, and its twin whose rate a channel keys to 0 at 2 s, have no
// particle born after 2 s, and each particle born before then lives out its own life, so the last disappear at 3.5 s and
// the live count between 2 s and 3.5 s equals the closed form's at 100 sampled times; a planted emitter that hides every
// particle at the span's end fails, naming the time"
//
// Two items (below): `ends`, rate 100.3/s with span 2 s, and `keyed`, the same with span 5 s and a channel holding
// `emit.rate` at 100.3 until 2 s and at 0 from then; each life 1.5 s, 256 rows. At this rate the k-th particle is born at
// k ÷ 100.3 s (the first at 0, as the base's emitter births row k at k ÷ rate), so particles 0 to 200 are born before
// 2 s and none at it. For each item the `particles` call lists 201 particles, born at k ÷ 100.3 s within 1e-9 s, each
// ending 1.5 s after its birth within 1e-9 s, the last before 3.5 s; and at 100 times in (2, 3.5) s, each more than
// 1 µs from any birth or end, the CPU's live rows and the compute operator's (captured columns whose age lane isn't
// negative) both number the closed form's 200 − ⌊(t − 1.5) × 100.3⌋ (0 when that is negative), and at 3.5 s none.
// The planted `hides_at_span_end` (README: Planted programs) fails, naming the time.

import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, ac, camera, failsNaming, flicks, fmt, liveRows, none, particlesCall, particlesItem, passed, randomFlicks, reading,
  requireGpu, runGpu, secondsOf, sessionDoc, useBins, useDir, writeJson, SPARK_LOOK, type JsonObject, type Planted,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const RATE = 100.3;
const LIFE = 1.5;
const BORN = 201;
const births = Array.from({ length: BORN }, (_, k) => k / RATE);
const boundary = (t: number): boolean => births.some((b) => Math.abs(t - b) < 1e-6 || Math.abs(t - b - LIFE) < 1e-6);
const TIMES = randomFlicks(4511, 100, 2, 3.5, (t) => !boundary(t));
const closedForm = (t: number): number => Math.max(0, Math.min(BORN, 200 - Math.floor((t - LIFE) * RATE)));

function stopsDoc(): JsonObject {
  const emitter = (span: number, x: number): JsonObject => particlesItem({
    count: 256, emit: { shape: 'point', rate: RATE, span }, life: [LIFE, LIFE],
    motion: { ballistic: { velocity: [0, 0.5, 0], gravity: [0, 0, 0], drag: 0 } }, draw: 'dot', ...SPARK_LOOK,
  }, [x, 0, 0]);
  return sessionDoc('Emitters that stop', { cam: camera([0, 1, 5], [0, 0.8, 0], 50), ends: emitter(2, -0.5), keyed: emitter(5, 0.5) }, {
    transport: { span: '5s' },
    channels: { stop: { target: 'items/keyed/params/emit/rate', type: 'f32', keys: { k0: { t: '0s', value: RATE, interp: 'hold' }, k1: { t: '2s', value: 0, interp: 'hold' } } } },
  });
}

/** Births, ends and live counts of both items against the closed form; each count failure names the time. */
function stopProblems(planted?: Planted): string[] {
  const call = particlesCall({ doc: writeJson(dir(), 'stops.json', stopsDoc()), t: [...TIMES, flicks(3.5)], gpu: true });
  const [reply] = runGpu(bins.bin('deep-gpu'), dir(), [call], planted ? { planted } : {});
  const c = passed(reply!, call, 'the emitters that stop');
  const out: string[] = [];
  for (const id of ['ends', 'keyed']) {
    const r = reading(c, id, id);
    const born = r.particles.map((p) => p.born).sort((a, b) => a - b);
    if (born.length !== BORN || born.some((b, k) => Math.abs(b - births[k]!) > 1e-9)) out.push(`${id}: ${born.length} particles are born, the last at ${fmt(born[born.length - 1] ?? NaN, 9)} s; the closed form bears ${BORN}, at k ÷ ${RATE} s, the last at ${fmt(births[BORN - 1]!, 9)} s`);
    const short = r.particles.filter((p) => Math.abs(p.ends - p.born - LIFE) > 1e-9);
    if (short.length) out.push(`${id}: ${short.length} particles don't live out their 1.5 s, first row ${short[0]!.row}, born at ${fmt(short[0]!.born, 6)} s, ending at ${fmt(short[0]!.ends, 6)} s`);
    if (r.particles.some((p) => p.ends > 3.5)) out.push(`${id}: a particle outlives 3.5 s`);
    for (const s of r.at) {
      const t = secondsOf(s.t);
      const want = t >= 3.5 ? 0 : closedForm(t);
      const cpu = liveRows(s.cpu).length;
      const gpu = liveRows(s.gpu!).length;
      if (cpu !== want || gpu !== want) out.push(`${id} at t = ${fmt(t, 6)} s: ${cpu} particles live on the CPU and ${gpu} in the compute operator's columns; the closed form's ${want}`);
    }
  }
  return out;
}

describe(`${ac(11)} an emitter that stops births only, and each particle lives out its own life`, () => {
  it(`${ac(11)} an emitter whose span ends at 2 s and its twin whose rate a channel keys to 0 at 2 s bear no particle after 2 s, their particles live out 1.5 s, and the live count from 2 to 3.5 s is the closed form's at 100 times`, () => {
    requireGpu();
    expect(TIMES.every((f) => closedForm(secondsOf(f)) >= 0), 'the closed form holds at the sampled times').toBe(true);
    none(stopProblems(), 'the emitters that stop');
  }, TIMEOUT);

  it(`${ac(11)} the planted emitter that hides every particle at the span's end fails, naming the time`, () => {
    requireGpu();
    failsNaming(stopProblems('hides_at_span_end'), ['at t = '], 'the planted hides_at_span_end');
  }, TIMEOUT);
});
