// AC14 (blind redraft of moves.test.ts; REDRAFT.md says why): "deep_kinds for a pop-in cue kind lists, at its
// defaults, a scale from 0 to 1 over its span with its spring's decay, frequency and peak, each number equal to its
// expansion's within 1e-9; changing the entry's default span changes the listing with no other edit; a planted entry
// whose listing is stored text that differs from its expansion fails, naming the entry and the field"
//
// asserts: `core,test-cue` (test canvas module test.cue: registry test.cue.kind@1, its entry pop_in at a default span
// of 0.5 s on a spring of 4 Hz and damping ratio 0.3) lists pop_in's one scale move from 0 to 1, starting at 0 over
// 0.5 s, with the spring's frequency, damping ratio, decay and peak. A board whose cue list (test.cue.list@1) pops a
// box in at defaults is shown, and deep_query reads the box's scale at times the time grammar accepts (seconds with
// at most five fraction digits, a 10 µs grid): the move's start, its end, seven times between, and the three grid
// times around the listed peak. From at the start and to at the end; at every other sample, the closed-form spring
// of the listed frequency and damping ratio at that sample's own time; the expansion's peak, read as the vertex of
// the parabola through the three samples around it, equal to the listed peak's time and value; nothing past the
// listed peak; and decay = 2π · frequency · damping ratio; each within 1e-9. `core,test-cue-span`, the same module
// with the default span 0.8 s and no other change, lists span 0.8 and its expansion passes the same check, its
// listing equal to test-cue's but for the span. `--planted moves_stored_text` on test-cue-span lists the stored text
// written for 0.5 s; the check fails, naming pop_in and span.

import { describe, expect, it } from 'vitest';
import {
  CUE_LIST, CUE_REGISTRY, DOC, EPS, POP_IN, POP_SPAN, POP_SPRING, board, failsNaming, isObject, listAll, none, query, rect, run,
  scaleMove, scenario, show, showDoc, springFromRest, theEntry, theListed, useBuilds, useEvidence, type Build, type JsonObject,
  type JsonValue, type Move,
} from '../helpers.ts';

const CUE: Build = { set: 'core', with: ['test-cue'] };
const CUE_SPAN: Build = { set: 'core', with: ['test-cue-span'] };
const builds = useBuilds([CUE, CUE_SPAN]);
const evidence = useEvidence();

/** A box the cue list pops in at the pop-in's defaults (the original's board, unchanged). */
const POPPED: JsonObject = board('A box popping in', [
  rect('box', [280, 140, 80, 80], 'a0'),
  { id: 'cues', kind: CUE_LIST, name: 'Cues', order: 'a1', params: { cues: [{ id: 'pop', kind: POP_IN, targets: ['box'] }] } },
], { requires: { modules: { 'test.cue': '^1' } }, transport: { span: '2s' } });

// ---------------------------------------------------------------------------------------------------
// Times the grammar accepts: crates/deep-canvas/src/grammar/time.rs refuses a seconds literal with more than five
// fraction digits, so samples sit on a 10 µs grid (7,056 flicks), each written as the exact decimal it stands for.

/** The grammar's finest seconds grid: 1/100,000 s. */
const GRID = 100_000;
/** One grid step, in seconds. */
const H = 1 / GRID;
interface Sample { text: string; seconds: number }
/** `t` seconds rounded to the grid, written as `<int>[.<up to 5 digits>]s`; its seconds are the grid time itself. */
function onGrid(t: number): Sample {
  const k = Math.round((Number.isFinite(t) ? t : 0) * GRID);
  const whole = Math.trunc(k / GRID);
  const frac = String(Math.abs(k % GRID)).padStart(5, '0').replace(/0+$/, '');
  return { text: `${k < 0 ? '-' : ''}${Math.abs(whole)}${frac ? `.${frac}` : ''}s`, seconds: k / GRID };
}
/** Index of each sample in the list deep_query is asked for. */
const AT = { start: 0, end: 1, beforePeak: 2, peak: 3, afterPeak: 4 } as const;
/** start, end, the grid times either side of and nearest the listed peak, then seven between start and end. */
function sampleTimes(m: Move): Sample[] {
  const peak = onGrid(m.start + m.peakAt);
  return [
    onGrid(m.start), onGrid(m.start + m.span), onGrid(peak.seconds - H), peak, onGrid(peak.seconds + H),
    ...[1, 2, 3, 4, 5, 6, 7].map((i) => onGrid(m.start + (m.span * i) / 8.5)),
  ];
}

// ---------------------------------------------------------------------------------------------------
// The criterion's check: the listed move against the expansion's own values.

const off = (a: number, b: number): boolean => !(Math.abs(a - b) <= EPS);
/** A deep_query `values` entry as one number: a number, or a vector whose components are all the same number. */
function scalarOf(v: JsonValue | undefined): number {
  if (typeof v === 'number') return v;
  if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'number' && x === v[0])) return v[0] as number;
  return Number.NaN;
}
/**
 * The expansion's peak from three samples a grid step apart: the vertex of the parabola through them. For this
 * spring the vertex lands within 3e-10 s and 3e-13 of the true peak wherever the peak falls between grid times,
 * where the nearest grid sample alone can be 2.3e-9 below it.
 */
function vertex(t0: number, ym: number, y0: number, yp: number): { at: number; value: number } {
  const curve = ym - 2 * y0 + yp;
  const slope = yp - ym;
  return { at: t0 - (H * slope) / (2 * curve), value: y0 - (slope * slope) / (8 * curve) };
}
/** Each failure names the entry and the field. `values` are deep_query's at `sampleTimes(m)`. */
function moveFailures(entry: string, m: Move, values: readonly JsonValue[]): string[] {
  const failures: string[] = [];
  for (const k of ['from', 'to', 'start', 'span', 'frequency', 'damping', 'decay', 'peakAt', 'peakValue'] as const) {
    if (!Number.isFinite(m[k])) failures.push(`${entry}: ${k === 'peakAt' || k === 'peakValue' ? 'peak' : k}: not listed as a number`);
  }
  if (failures.length) return failures;
  const times = sampleTimes(m);
  const v = times.map((_, i) => scalarOf(values[i]));
  if (v.some((x) => !Number.isFinite(x))) return [`${entry}: the expansion's values at the sample times aren't numbers: ${show(values as JsonValue[])}`];
  if (off(v[AT.start]!, m.from)) failures.push(`${entry}: from: the listing says ${m.from}, the expansion holds ${v[AT.start]} at its start ${times[AT.start]!.text}`);
  if (off(v[AT.end]!, m.to)) failures.push(`${entry}: span: the listing ends at ${times[AT.end]!.text} with ${m.to}, the expansion holds ${v[AT.end]} there`);
  if (off(m.decay, 2 * Math.PI * m.frequency * m.damping)) failures.push(`${entry}: decay: the listing says ${m.decay}, its frequency and damping ratio give ${2 * Math.PI * m.frequency * m.damping}`);
  for (let i = AT.beforePeak; i < times.length; i++) {
    const u = times[i]!.seconds - m.start;
    const want = m.to + (m.from - m.to) * springFromRest(m.frequency, m.damping, u);
    if (off(v[i]!, want)) failures.push(`${entry}: frequency: the expansion holds ${v[i]} at ${times[i]!.text}, the listed spring (${m.frequency} Hz, ζ ${m.damping}) gives ${want}`);
    if (v[i]! > m.peakValue + EPS) failures.push(`${entry}: peak: the expansion reaches ${v[i]} at ${times[i]!.text}, past the listed peak ${m.peakValue}`);
  }
  const top = vertex(times[AT.peak]!.seconds, v[AT.beforePeak]!, v[AT.peak]!, v[AT.afterPeak]!);
  if (off(top.at, m.start + m.peakAt)) failures.push(`${entry}: peak: the listing says it comes ${m.peakAt} s after the start, the expansion peaks ${top.at - m.start} s after it`);
  if (off(top.value, m.peakValue)) failures.push(`${entry}: peak: the listing says ${m.peakValue}, the expansion peaks at ${top.value}`);
  return failures;
}

// ---------------------------------------------------------------------------------------------------

/** pop_in as deep_kinds lists it in `bin`, under `planted`. */
function popIn(bin: string, planted?: string): { move: Move; raw: JsonObject } {
  const entry = theEntry(theListed(listAll(bin, evidence(), {}, planted, { registry: CUE_REGISTRY }), CUE_REGISTRY), POP_IN);
  const move = scaleMove(entry);
  expect(typeof move, `pop_in lists one scale move: ${typeof move === 'string' ? move : ''}`).toBe('object');
  return { move: move as Move, raw: entry.raw };
}
/** The box's scale as the expansion evaluates it at the move's sample times, read through deep_query. */
function expansion(bin: string, m: Move): JsonValue[] {
  const path = `items/box/${m.path}`;
  const at = sampleTimes(m).map((t) => t.text);
  const [shown, read] = run(bin, scenario(evidence(), [showDoc(DOC.a, POPPED), query(DOC.a, { paths: [path], at })]));
  expect(shown!['outcome'], `the board is presented: ${show(shown)}`).toBe('presented');
  const values = isObject(read!['values']) ? read!['values'][path] : undefined;
  expect(Array.isArray(values) && values.length === at.length, `deep_query reads ${path} at ${at.length} times (${at.join(', ')}): ${show(read)}`).toBe(true);
  return values as JsonValue[];
}
const near = (a: number, b: number): boolean => Math.abs(a - b) <= EPS;

describe('AC14 a pop-in cue kind lists its moves at defaults, printed from its expansion', () => {
  it('AC14 pop_in lists a scale from 0 to 1 over its 0.5 s span with its spring\'s decay, frequency and peak, each equal to its expansion\'s within 1e-9', () => {
    const bin = builds.bin(CUE);
    const { move } = popIn(bin);
    expect([near(move.from, 0), near(move.to, 1), near(move.start, 0), near(move.span, POP_SPAN['test-cue'])], `a scale from 0 to 1 from the cue's start over 0.5 s: ${show(move.raw)}`).toEqual([true, true, true, true]);
    expect([near(move.frequency, POP_SPRING.frequency), near(move.damping, POP_SPRING.damping_ratio)], `the spring of 4 Hz and damping ratio 0.3: ${show(move.raw)}`).toEqual([true, true]);
    none(moveFailures(POP_IN, move, expansion(bin, move)), 'pop_in\'s listing against its expansion');
  }, 1_800_000);

  it('AC14 changing the default span to 0.8 s changes the listing with no other edit, and the listing still equals the expansion', () => {
    const before = popIn(builds.bin(CUE));
    const bin = builds.bin(CUE_SPAN);
    const after = popIn(bin);
    expect(near(after.move.span, POP_SPAN['test-cue-span']), `the listing's span follows the default: ${show(after.move.raw)}`).toBe(true);
    none(moveFailures(POP_IN, after.move, expansion(bin, after.move)), 'pop_in\'s listing at the new span against its expansion');
    const others = (m: Move): number[] => [m.from, m.to, m.start, m.frequency, m.damping, m.decay];
    expect(others(after.move).every((v, i) => near(v, others(before.move)[i]!)), `nothing else in the move changed: ${show(before.move.raw)} → ${show(after.move.raw)}`).toBe(true);
  }, 1_800_000);

  it('AC14 a planted entry whose listing is stored text that differs from its expansion fails, naming pop_in and span', () => {
    const bin = builds.bin(CUE_SPAN);
    const { move } = popIn(bin, 'moves_stored_text');
    expect(near(move.span, POP_SPAN['test-cue']), `the planted listing is the text stored at 0.5 s: ${show(move.raw)}`).toBe(true);
    failsNaming(moveFailures(POP_IN, move, expansion(bin, move)), [POP_IN, 'span'], 'the stored listing');
  }, 1_800_000);
});
