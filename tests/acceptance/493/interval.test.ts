// AC11 #493.219170de: Each interval form rounds outward: exp and sin over [1, 1] give ranges that hold e and sin(1),
// checked against 40 digits of each, while a planted form that rounds its ends to nearest returns one double for each,
// on one side of the true value, and fails; and a kept 0.2 m box whose x a driver sets to 1/(t − 1.01) m in a 2 s shot
// is refused at check, naming the box and the span around 1.01 s that its bound can't settle, though every 60 fps sample
// is finite, while a planted framer that fits its samples frames it.
//
// The forms through `deep-show run`'s `fn` call (#490: `over` → `bounds`), with the plant `planted: "rounds_to_nearest"`;
// each bound end, an f64, is compared exactly with 40 significant digits of e and sin(1) in integer arithmetic. The
// Oracle's upstream lane: inari's IEEE 1788 cases for exp and sin (vendored in fixtures/itf1788-exp-sin.json, every case
// with finite input ends), which our forms, widened by libm's error bound, must enclose, each end within 1e-12 of the
// tight one. The framing through `deep-motion eval`: the refusal names `spike` and carries `span: [from, to]` in flicks
// around 1.01 s (README: Choices); the plant is `framer_fits_samples`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FIXTURES, FLICKS, TIMEOUT, arr, box3d, camera3d, evalOne, evalPlanted, failsNaming, film, fl, frames60, isObject, itemPos, mentions, none, obj,
  runShow, scenario, shot, show, useEvidence, useMotion, useShow, type JsonObject, type JsonValue,
} from './helpers.ts';

const shows = useShow(['full']);
const motion = useMotion();
const evidence = useEvidence();

/** 40 significant digits of e and of sin(1). */
const TRUE: Record<string, string> = { exp: '2.718281828459045235360287471352662497757', sin: '0.8414709848078965066525023216302989996226' };

/** An f64 exactly, as a fraction n ÷ 2^k (k ≥ 0) of BigInts. */
function exact(x: number): { n: bigint; k: bigint } {
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, x);
  const bits = view.getBigUint64(0); const sign = bits >> 63n ? -1n : 1n;
  const e = Number((bits >> 52n) & 0x7ffn); const m = bits & ((1n << 52n) - 1n);
  const mant = e === 0 ? m : m | (1n << 52n); const pow = (e === 0 ? 1 : e) - 1075;
  return pow >= 0 ? { n: sign * (mant << BigInt(pow)), k: 0n } : { n: sign * mant, k: BigInt(-pow) };
}
/** The sign of x − d, for an f64 x and a decimal text d (no exponent), exactly. */
function compare(x: number, d: string): number {
  const [int, frac = ''] = d.replace('-', '').split('.');
  const neg = d.startsWith('-'); const digits = BigInt(`${int}${frac}`) * (neg ? -1n : 1n); const scale = 10n ** BigInt(frac.length);
  const { n, k } = exact(x);
  const left = n * scale; const right = digits * (1n << k);
  return left === right ? 0 : left > right ? 1 : -1;
}

interface Bound { lo: number | null; hi: number | null }
function boundsOf(reply: JsonObject, n: number, what: string): Bound[] {
  const list = arr(reply['bounds'], `${what}: bounds`);
  expect(list.length, `${what}: one bound per range`).toBe(n);
  return list.map((b, i) => {
    const o = obj(b, `${what}: bounds[${i}]`);
    const end = (v: JsonValue | undefined): number | null => (typeof v === 'number' ? v : null);
    return { lo: end(o['lo']), hi: end(o['hi']) };
  });
}
const fnOver = (expr: string, ranges: number[][], planted?: string): JsonObject => ({ call: 'fn', expr, over: ranges, ...(planted ? { planted } : {}) });

/** The criterion's hold check: the bound over [1, 1] holds the true value strictly inside, not one double on one side. */
function holdFailures(fn: string, b: Bound): string[] {
  if (b.lo === null || b.hi === null) return [`${fn} over [1, 1]: the bound [${b.lo}, ${b.hi}] is unbounded`];
  const failures: string[] = [];
  if (!(compare(b.lo, TRUE[fn]!) < 0)) failures.push(`${fn} over [1, 1]: the bound's lower end ${b.lo} isn't below the true ${TRUE[fn]}`);
  if (!(compare(b.hi, TRUE[fn]!) > 0)) failures.push(`${fn} over [1, 1]: the bound's upper end ${b.hi} isn't above the true ${TRUE[fn]}`);
  if (b.lo === b.hi) failures.push(`${fn} over [1, 1]: the bound is the one double ${b.lo}`);
  return failures;
}

interface Case { fn: string; over: [string, string]; expect: [string | null, string | null] }
const ITF = JSON.parse(readFileSync(join(FIXTURES, 'itf1788-exp-sin.json'), 'utf8')) as { cases: Case[] };

describe(`${AC[11]} interval forms round outward, and framing refuses a bound it can't settle`, () => {
  it(`${AC[11]} exp and sin over [1, 1] give ranges that hold e and sin(1), checked against 40 digits of each`, () => {
    const [e, s] = runShow(shows.bin('full'), scenario(evidence(), [fnOver('exp(x)', [[1, 1]]), fnOver('sin(x)', [[1, 1]])]));
    none([...holdFailures('exp', boundsOf(e!, 1, 'exp')[0]!), ...holdFailures('sin', boundsOf(s!, 1, 'sin')[0]!)], 'the forms over [1, 1]');
  }, TIMEOUT);

  it(`${AC[11]} the forms enclose inari's IEEE 1788 exp and sin cases (the Oracle's upstream lane), each end within 1e-12 of the tight one`, () => {
    const groups = ['exp', 'sin'].map((fn) => ITF.cases.filter((c) => c.fn === fn));
    const replies = runShow(shows.bin('full'), scenario(evidence(), groups.map((g) => fnOver(`${g[0]!.fn}(x)`, g.map((c) => [Number(c.over[0]), Number(c.over[1])])))));
    const failures: string[] = [];
    groups.forEach((g, gi) => boundsOf(replies[gi]!, g.length, g[0]!.fn).forEach((b, i) => {
      const c = g[i]!; const [lo, hi] = c.expect.map((v) => (v === null ? null : Number(v))) as [number | null, number | null];
      const name = `${c.fn} over [${c.over.join(', ')}]`;
      const tol = (v: number): number => 1e-12 * Math.max(1, Math.abs(v));
      if (lo !== null && !(b.lo === null ? lo < -1e300 : b.lo <= lo && lo - b.lo <= tol(lo))) failures.push(`${name}: lower end ${b.lo}, upstream ${lo}`);
      if (hi === null ? b.hi !== null && b.hi < 1.7976931348623157e308 : !(b.hi === null ? hi > 1e300 : b.hi >= hi && b.hi - hi <= tol(hi))) failures.push(`${name}: upper end ${b.hi}, upstream ${String(hi)}`);
    }));
    none(failures, 'the forms against the IEEE 1788 cases');
  }, TIMEOUT);

  it(`${AC[11]} a planted form that rounds its ends to nearest returns one double for each, on one side of the true value, and fails`, () => {
    const [e, s] = runShow(shows.bin('full'), scenario(evidence(), [fnOver('exp(x)', [[1, 1]], 'rounds_to_nearest'), fnOver('sin(x)', [[1, 1]], 'rounds_to_nearest')]));
    const be = boundsOf(e!, 1, 'planted exp')[0]!; const bs = boundsOf(s!, 1, 'planted sin')[0]!;
    expect([be.lo === be.hi, bs.lo === bs.hi], `the plant returns one double for each: ${show(e!['bounds'])} ${show(s!['bounds'])}`).toEqual([true, true]);
    failsNaming([...holdFailures('exp', be), ...holdFailures('sin', bs)], ['exp over [1, 1]', 'sin over [1, 1]'], 'the hold check on the plant');
  }, TIMEOUT);

  const SPIKE = film('spike', [camera3d({ orbit: { azimuth: 0, elevation: 0, distance: 10 } }), box3d('spike', [0, 0, 0], 0.2)], {
    drivers: { pole: { target: 'items/spike/at/pos/0', expr: '1 / (t - 1.01)', vars: { t: 'time' } } },
    shots: { s: shot(0, 2, { frame: { keep: ['spike'] } }) },
  }, { span: '2s' });
  const TIMES = frames60(0, 2);

  /** The refusal check: refused, naming the box, with a span around 1.01 s inside the shot. */
  function spikeFailures(answer: JsonObject): string[] {
    if (answer['ok'] !== false) return [`the box spike is framed, not refused: its bound near 1.01 s is never settled (${show(answer).slice(0, 200)})`];
    const failures: string[] = [];
    if (!mentions(answer, 'spike')) failures.push(`the refusal doesn't name the box spike: ${show(answer)}`);
    const span = Array.isArray(answer['span']) ? answer['span'].map(Number) : [];
    if (!(span.length === 2 && span[0]! <= fl(1.01) && fl(1.01) <= span[1]! && span[1]! - span[0]! < fl(2))) failures.push(`the refusal's span ${show(answer['span'])} doesn't lie around 1.01 s inside the shot`);
    return failures;
  }

  it(`${AC[11]} a kept box whose x is 1/(t − 1.01) m in a 2 s shot is refused at check, naming the box and the span around 1.01 s its bound can't settle, though every 60 fps sample is finite`, () => {
    for (const t of TIMES) expect(Number.isFinite(1 / (t / FLICKS - 1.01)), `the 60 fps sample at ${t} flicks is finite`).toBe(true);
    none(spikeFailures(evalOne(motion.bin(), { doc: SPIKE, times: TIMES })), 'the spiking box at check');
  }, TIMEOUT);

  it(`${AC[11]} a planted framer that fits its samples frames the same box from its finite samples, and fails the refusal check`, () => {
    const a = evalPlanted(motion.bin(), { doc: SPIKE, times: TIMES, planted: 'framer_fits_samples' }, 'the planted framer');
    none(a.frames.flatMap((f) => (Number.isFinite(itemPos(f, 'spike', 'the plant')[0]) ? [] : [`at ${f.t} flicks the box's x isn't finite`])), 'the plant\'s samples');
    expect(isObject(a.shots['s']), `the plant frames the shot: ${show(a.shots)}`).toBe(true);
    failsNaming(spikeFailures(a.raw), ['spike'], 'the refusal check on the plant');
  }, TIMEOUT);
});
