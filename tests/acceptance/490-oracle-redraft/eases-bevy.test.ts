// Criterion 1: "Every closed ease name holds its identities in f64 (ends at 0 and 1, the symmetry of in-out,
// monotonicity over 1,001 samples for monotonic families)"
//
// Oracle: bevy's crates/bevy_curve/src/easing.rs (12a94e0cd6, vendored in doneright/oracles), "formula" use. Its
// `easing_functions` are ported here to f64 as references for the names whose shape the issue and the design pin to
// the same curve (README: Where bevy is a source, and where it isn't), and its three tests
// (ease_functions_zero_to_one, ease_function_inout_deciles, ease_function_midpoints) are ported to f64. Bevy checks in
// f32 within 1e-6; the f64 tolerance here is 1e-12, which no f32 evaluation meets, and the exact ends, the in-out
// symmetry over 1,001 samples and monotonicity over 1,001 samples are the criterion's own.
//
// Through `deep-show run` built with `--no-default-features --features core`: one call
// `{"call": "fn", "expr": "ease(<name>, x)", "at": [x…]}` per name, answered `{"values": [number | null]}`.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const SHOW = process.platform === 'win32' ? 'deep-show.exe' : 'deep-show';
const TIMEOUT = 1_800_000;

// ---------------------------------------------------------------------------------------------------
// The build and the call

let dir = '';
let bin = '';
let buildError = '';
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'deep-490-bevy-'));
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const args = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'core'];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) buildError = `cargo could not run: ${run.error.message}`;
  else if (run.status !== 0) buildError = `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Download/.test(l)).join('\n')}`;
  else { bin = join(dir, SHOW); copyFileSync(join(TARGET, 'debug', SHOW), bin); }
}, 7_200_000);
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
const isObj = (v: Json | undefined): v is { [k: string]: Json } => typeof v === 'object' && v !== null && !Array.isArray(v);
const shown = (v: unknown): string => (JSON.stringify(v) ?? 'undefined').slice(0, 1200);

/** `ease(name, x)` at each of `xs`, for every ask in order, in one `deep-show run` scenario. */
function easeRuns(asks: readonly { name: string; xs: readonly number[] }[]): number[][] {
  expect(buildError, 'the binary builds: cargo build --locked --bin deep-show --no-default-features --features core').toBe('');
  const evidence = mkdtempSync(join(tmpdir(), 'deep-490-bevy-ev-'));
  try {
    const calls = asks.map(({ name, xs }) => ({ call: 'fn', expr: `ease(${name}, x)`, at: [...xs] }));
    const sc = { evidence, sessions: {}, processes: [], panels: {}, docs: {}, calls };
    const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
    expect(run.error, `deep-show run could start and finish: ${run.error?.message}`).toBeUndefined();
    expect(run.status, `deep-show run exits 0; stdout: ${run.stdout.slice(0, 1200)}; stderr: ${run.stderr.slice(-1200)}`).toBe(0);
    const line = run.stdout.split('\n').find((l) => l.trim() !== '') ?? '';
    let answer: Json = null;
    try { answer = JSON.parse(line) as Json; } catch { /* checked below */ }
    expect(isObj(answer) && answer['ok'] === true, `deep-show run accepts the scenario: ${line.slice(0, 1200)}`).toBe(true);
    const replies = (answer as { [k: string]: Json })['replies'];
    expect(Array.isArray(replies) && replies.length === asks.length, `one reply per call: ${shown(replies)}`).toBe(true);
    return asks.map(({ name, xs }, i) => {
      const reply = (replies as Json[])[i];
      const values = isObj(reply) ? reply['values'] : undefined;
      expect(Array.isArray(values) && values.length === xs.length, `ease(${name}, x) answers one value per x: ${shown(reply)}`).toBe(true);
      const bad = (values as Json[]).findIndex((v) => typeof v !== 'number' || !Number.isFinite(v));
      expect(bad, `ease(${name}, x) is a finite number at every x; at x = ${xs[bad]} it read ${shown((values as Json[])[bad])}`).toBe(-1);
      return values as number[];
    });
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
}
/** As easeRuns, for distinct names, by name. */
function ease(asks: readonly { name: string; xs: readonly number[] }[]): Map<string, number[]> {
  const runs = easeRuns(asks);
  return new Map(asks.map((a, i) => [a.name, runs[i]!]));
}
const get = (m: Map<string, number[]>, name: string): number[] => m.get(name) ?? [];
function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------
// Our closed names (the issue and Channel and key's ease list)

const FAMILIES = ['sine', 'quad', 'cubic', 'quart', 'quint', 'expo', 'circ', 'back', 'elastic', 'bounce'] as const;
const PENNER = FAMILIES.flatMap((f) => [`in_${f}`, `out_${f}`, `in_out_${f}`]);
const OTHERS = ['smoothstep', 'smootherstep', 'sigmoid', 'rush_in', 'rush_out', 'double_sigmoid', 'running_start', 'exp_decay'];
const ALL = [...PENNER, ...OTHERS];

/** 1,001 samples i ÷ 1000 over [0, 1]. */
const GRID = Array.from({ length: 1001 }, (_, i) => i / 1000);
/** The 999 interior samples. */
const INTERIOR = GRID.slice(1, -1);
const TOL = 1e-12;

// ---------------------------------------------------------------------------------------------------
// bevy's easing_functions, ported to f64 (crates/bevy_curve/src/easing.rs, lines 1085–1338). Only the functions
// that are a valid source for one of our names are ported (README).

const LOG2_1023 = Math.log2(1023);
const FRAC_1_1023 = 1 / 1023;
const sq = (t: number): number => t * t;
const cu = (t: number): number => t * t * t;
const BEVY: Record<string, (t: number) => number> = {
  in_quad: (t) => sq(t),
  out_quad: (t) => 1 - sq(1 - t),
  in_out_quad: (t) => (t < 0.5 ? 2 * sq(t) : 1 - sq(-2 * t + 2) / 2),
  in_cubic: (t) => cu(t),
  out_cubic: (t) => 1 - cu(1 - t),
  in_out_cubic: (t) => (t < 0.5 ? 4 * cu(t) : 1 - cu(-2 * t + 2) / 2),
  in_quart: (t) => t * t * t * t,
  out_quart: (t) => 1 - (1 - t) * (1 - t) * (1 - t) * (1 - t),
  in_out_quart: (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - (-2 * t + 2) ** 4 / 2),
  in_quint: (t) => t * t * t * t * t,
  out_quint: (t) => 1 - (1 - t) ** 5,
  in_out_quint: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2),
  smoothstep: (t) => ((3 - 2 * t) * t) * t,
  smootherstep: (t) => (((10 + (-15 + 6 * t) * t) * t) * t) * t,
  in_sine: (t) => 1 - Math.cos(t * (Math.PI / 2)),
  out_sine: (t) => Math.sin(t * (Math.PI / 2)),
  in_out_sine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  in_circ: (t) => 1 - Math.sqrt(1 - sq(t)),
  out_circ: (t) => Math.sqrt(1 - sq(t - 1)),
  in_out_circ: (t) => (t < 0.5 ? (1 - Math.sqrt(1 - sq(2 * t))) / 2 : (Math.sqrt(1 - sq(-2 * t + 2)) + 1) / 2),
  // The renormalized expo: (2^(10t) − 1) ÷ (2^10 − 1), bevy's comment says, the one affine map of Penner's 2^(10t − 10) onto 0 at 0 and 1 at 1.
  in_expo: (t) => 2 ** (10 * t - LOG2_1023) - FRAC_1_1023,
  out_expo: (t) => (FRAC_1_1023 + 1) - 2 ** (-10 * t - (LOG2_1023 - 10)),
  in_out_expo: (t) => (t < 0.5 ? 2 ** (20 * t - (LOG2_1023 + 1)) - FRAC_1_1023 / 2 : (FRAC_1_1023 / 2 + 1) - 2 ** (-20 * t - (LOG2_1023 - 19))),
  // back with c = 1.70158, the issue's default overshoot.
  in_back: (t) => (1.70158 + 1) * cu(t) - 1.70158 * sq(t),
  out_back: (t) => 1 + (1.70158 + 1) * cu(t - 1) + 1.70158 * sq(t - 1),
  // elastic with period 0.3 (sin((10t − 10.75)·2π/3)) and amplitude 1, the issue's defaults.
  in_elastic: (t) => -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * 2 * (Math.PI / 3)),
  out_elastic: (t) => 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * 2 * (Math.PI / 3)) + 1,
};
/** bevy's MONOTONIC_IN_OUT_INOUT triples that are all three our names (bevy's SmoothStepIn/Out and SmootherStepIn/Out aren't). */
const TRIPLES = ['quad', 'cubic', 'quart', 'quint', 'sine', 'circ', 'expo'].map((f) => [`in_${f}`, `out_${f}`, `in_out_${f}`] as const);
/** bevy's monotonic families as our names. */
const BEVY_MONOTONIC = [...TRIPLES.flat(), 'smoothstep', 'smootherstep'];

describe('criterion 1, Oracle lane: bevy easing.rs (12a94e0cd6) as the formula source', () => {
  it('every name bevy pins equals bevy\'s formula in f64 within 1e-12 at the 999 interior samples', { timeout: TIMEOUT }, () => {
    const names = Object.keys(BEVY);
    const got = ease(names.map((name) => ({ name, xs: INTERIOR })));
    const failures: string[] = [];
    for (const name of names) {
      const v = get(got, name);
      const ref = BEVY[name]!;
      let worst = { d: 0, x: 0, got: 0, want: 0 };
      INTERIOR.forEach((x, i) => {
        const want = ref(x);
        const d = Math.abs(v[i]! - want);
        if (d > worst.d) worst = { d, x, got: v[i]!, want };
      });
      if (worst.d > TOL) failures.push(`${name}: at x = ${worst.x} read ${worst.got}, bevy's formula gives ${worst.want} (off by ${worst.d.toExponential(3)})`);
    }
    none(failures, 'names off bevy\'s formula by more than 1e-12');
  });

  it('ease_functions_zero_to_one in f64: every closed name reads exactly 0 at 0 and exactly 1 at 1', { timeout: TIMEOUT }, () => {
    const got = ease(ALL.map((name) => ({ name, xs: [0, 1] })));
    const failures: string[] = [];
    for (const name of ALL) {
      const [a, b] = get(got, name);
      if (a !== 0) failures.push(`${name}(0) read ${a}, not 0`);
      if (b !== 1) failures.push(`${name}(1) read ${b}, not 1`);
    }
    none(failures, 'names that miss their ends');
  });

  it('ease_function_inout_deciles in f64: in_out(x) < x and = in(2x) ÷ 2 at 0.1…0.4, > x and = out(2x − 1) ÷ 2 + ½ at 0.6…0.9, within 1e-12', { timeout: TIMEOUT }, () => {
    const low = [0.1, 0.2, 0.3, 0.4];
    const high = [0.6, 0.7, 0.8, 0.9];
    const asks: { name: string; xs: number[] }[] = TRIPLES.flatMap(([i, o, io]) => [
      { name: io, xs: [...low, ...high] },
      { name: i, xs: low.map((x) => 2 * x) },
      { name: o, xs: high.map((x) => 2 * x - 1) },
    ]);
    asks.push(...['smoothstep', 'smootherstep'].map((name) => ({ name, xs: [...low, ...high] })));
    const got = ease(asks);
    const failures: string[] = [];
    for (const [i, o, io] of TRIPLES) {
      const y = get(got, io); const vi = get(got, i); const vo = get(got, o);
      low.forEach((x, k) => {
        if (!(y[k]! < x)) failures.push(`${io}(${x}) read ${y[k]}, not below ${x}`);
        if (Math.abs(y[k]! - vi[k]! / 2) > TOL) failures.push(`${io}(${x}) read ${y[k]}, but ${i}(${2 * x}) ÷ 2 is ${vi[k]! / 2}`);
      });
      high.forEach((x, k) => {
        if (!(y[4 + k]! > x)) failures.push(`${io}(${x}) read ${y[4 + k]}, not above ${x}`);
        if (Math.abs(y[4 + k]! - (vo[k]! / 2 + 0.5)) > TOL) failures.push(`${io}(${x}) read ${y[4 + k]}, but ${o}(${2 * x - 1}) ÷ 2 + ½ is ${vo[k]! / 2 + 0.5}`);
      });
    }
    for (const name of ['smoothstep', 'smootherstep']) {
      const y = get(got, name);
      low.forEach((x, k) => { if (!(y[k]! < x)) failures.push(`${name}(${x}) read ${y[k]}, not below ${x}`); });
      high.forEach((x, k) => { if (!(y[4 + k]! > x)) failures.push(`${name}(${x}) read ${y[4 + k]}, not above ${x}`); });
    }
    none(failures, 'in-out forms off bevy\'s decile relations');
  });

  it('ease_function_midpoints in f64: in(½) < ½ − 1e-6, out(½) > ½ + 1e-6, in_out(½) = ½ within 1e-12', { timeout: TIMEOUT }, () => {
    const names = [...TRIPLES.flat(), 'smoothstep', 'smootherstep'];
    const got = ease(names.map((name) => ({ name, xs: [0.5] })));
    const failures: string[] = [];
    for (const [i, o, io] of TRIPLES) {
      const mi = get(got, i)[0]!; const mo = get(got, o)[0]!; const mio = get(got, io)[0]!;
      if (!(mi < 0.5 - 1e-6)) failures.push(`${i}(½) read ${mi}`);
      if (!(mo > 0.5 + 1e-6)) failures.push(`${o}(½) read ${mo}`);
      if (Math.abs(mio - 0.5) > TOL) failures.push(`${io}(½) read ${mio}`);
    }
    for (const name of ['smoothstep', 'smootherstep']) {
      const m = get(got, name)[0]!;
      if (Math.abs(m - 0.5) > TOL) failures.push(`${name}(½) read ${m}`);
    }
    none(failures, 'midpoints off bevy\'s');
  });

  it('bounce\'s structure as bevy builds it: in_bounce(x) = 1 − out_bounce(1 − x) and in_out_bounce from out_bounce, within 1e-12 at 1,001 samples', { timeout: TIMEOUT }, () => {
    const low = GRID.filter((x) => x < 0.5);
    const high = GRID.filter((x) => x >= 0.5);
    const [vin, reflected, vio, halves] = easeRuns([
      { name: 'in_bounce', xs: GRID },
      { name: 'out_bounce', xs: GRID.map((x) => 1 - x) },
      { name: 'in_out_bounce', xs: GRID },
      { name: 'out_bounce', xs: [...low.map((x) => 1 - 2 * x), ...high.map((x) => 2 * x - 1)] },
    ]) as [number[], number[], number[], number[]];
    const failures: string[] = [];
    GRID.forEach((x, i) => {
      const want = 1 - reflected[i]!;
      if (Math.abs(vin[i]! - want) > TOL) failures.push(`in_bounce(${x}) read ${vin[i]}, 1 − out_bounce(1 − x) is ${want}`);
      const h = halves[i]!;
      const wantIo = x < 0.5 ? (1 - h) / 2 : (1 + h) / 2;
      if (Math.abs(vio[i]! - wantIo) > TOL) failures.push(`in_out_bounce(${x}) read ${vio[i]}, bevy's composition of out_bounce gives ${wantIo}`);
    });
    none(failures, 'bounce forms off bevy\'s construction');
  });
});

describe('criterion 1: the identities bevy\'s tests extend to, in f64 over 1,001 samples', () => {
  it('the symmetry of in-out: in_out(x) + in_out(1 − x) = 1 within 1e-12 for every in_out_<f>, smoothstep and smootherstep', { timeout: TIMEOUT }, () => {
    const names = [...FAMILIES.map((f) => `in_out_${f}`), 'smoothstep', 'smootherstep'];
    const asks = names.map((name) => ({ name, xs: [...GRID, ...GRID.map((x) => 1 - x)] }));
    const got = ease(asks);
    const failures: string[] = [];
    for (const name of names) {
      const v = get(got, name);
      let worst = { d: 0, x: 0 };
      GRID.forEach((x, i) => { const d = Math.abs(v[i]! + v[1001 + i]! - 1); if (d > worst.d) worst = { d, x }; });
      if (worst.d > TOL) failures.push(`${name}: at x = ${worst.x}, ${name}(x) + ${name}(1 − x) is off 1 by ${worst.d.toExponential(3)}`);
    }
    none(failures, 'in-out forms that aren\'t symmetric');
  });

  it('monotonicity over 1,001 samples: bevy\'s monotonic families and our monotone eases never decrease', { timeout: TIMEOUT }, () => {
    const names = [...BEVY_MONOTONIC, 'sigmoid', 'rush_in', 'rush_out', 'double_sigmoid', 'exp_decay'];
    const got = ease(names.map((name) => ({ name, xs: GRID })));
    const failures: string[] = [];
    for (const name of names) {
      const v = get(got, name);
      const i = v.findIndex((y, k) => k > 0 && y < v[k - 1]!);
      if (i > 0) failures.push(`${name} falls from ${v[i - 1]} at ${GRID[i - 1]} to ${v[i]} at ${GRID[i]}`);
    }
    none(failures, 'monotonic families that dip');
  });
});
