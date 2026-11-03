// AC14: "deep_kinds for a pop-in cue kind lists, at its defaults, a scale from 0 to 1 over its span with its spring's
// decay, frequency and peak, each number equal to its expansion's within 1e-9; changing the entry's default span
// changes the listing with no other edit; a planted entry whose listing is stored text that differs from its
// expansion fails, naming the entry and the field"
//
// asserts: `core,test-cue` (test canvas module test.cue: registry test.cue.kind@1, its entry pop_in at a default span
// of 0.5 s on a spring of 4 Hz and damping ratio 0.3) lists pop_in's one scale move from 0 to 1, starting at 0 over
// 0.5 s, with the spring's frequency, damping ratio, decay and peak. A board whose cue list (test.cue.list@1) pops a
// box in at defaults is shown, and deep_query reads the box's scale at the move's start, its listed peak, its end
// and seven times between (each on the time grammar's grid): from at the start, to at the end, the listed peak's
// value at the peak, the closed-form spring of the listed frequency and damping ratio between, nothing past the
// peak, and decay = 2π · frequency · damping ratio, each within 1e-9. `core,test-cue-span`, the same module with the
// default span 0.8 s and no other change, lists span 0.8 and its expansion passes the same check, its listing equal
// to test-cue's but for the span. `--planted moves_stored_text` on test-cue-span lists the stored text written for
// 0.5 s; the check fails, naming pop_in and span.

import { describe, expect, it } from 'vitest';
import {
  CUE_LIST, CUE_REGISTRY, DOC, EPS, POP_IN, POP_SPAN, POP_SPRING, board, failsNaming, isObject, listAll, moveFailures, none, query,
  rect, run, sampleTimes, scaleMove, scenario, show, showDoc, theEntry, theListed, useBuilds, useEvidence, type Build, type JsonObject, type JsonValue,
  type Move,
} from './helpers.ts';

const CUE: Build = { set: 'core', with: ['test-cue'] };
const CUE_SPAN: Build = { set: 'core', with: ['test-cue-span'] };
const builds = useBuilds([CUE, CUE_SPAN]);
const evidence = useEvidence();

/** A box the cue list pops in at the pop-in's defaults. */
const POPPED: JsonObject = board('A box popping in', [
  rect('box', [280, 140, 80, 80], 'a0'),
  { id: 'cues', kind: CUE_LIST, name: 'Cues', order: 'a1', params: { cues: [{ id: 'pop', kind: POP_IN, targets: ['box'] }] } },
], { requires: { modules: { 'test.cue': '^1' } }, transport: { span: '2s' } });

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
  expect(Array.isArray(values) && values.length === at.length, `deep_query reads ${path} at ${at.length} times: ${show(read)}`).toBe(true);
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
