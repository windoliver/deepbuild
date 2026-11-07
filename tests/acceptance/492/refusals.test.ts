// AC7 #492.5ffc89bd: A reverse remap is refused at check, naming the remap and the read, when its target's driver reads a
// control or its target reads a world that takes inputs, and a remap at half rate over the same target is accepted.
// AC8 #492.7d21a76a: A channel and a placement on one item's path, or two drivers on it, are refused at check naming both, a
// channel on a paint slot a status binding owns is refused the same way, and mix placements from two writers on one path
// still mix.
//
// Through `deep-motion eval`'s `ok: false` answers: the tests read the whole refusal for the IDs it must name and pin no
// code, since the issue names none. Each refusal has an accepted twin, so it is the condition that refuses, not the shape of
// the document. AC7's "world that takes inputs" has no surface: no crate at the base builds a `physics.world@1`, and #492
// depends on none (README: Criteria out of reach). The half-rate twin is the design's `map` channel, parent to child flicks.
// No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, LAYER, TIMEOUT, channel, clipOf, evalOk, evalOne, film, fl, mentions, none, place, posOr, rect, refused, secs, seededTimes, show, useMotion,
  type JsonObject,
} from './helpers.ts';

const motion = useMotion();

const SLIDE = clipOf('x', 'at/pos/0', [[0, 0], [4, 8]]);
const KNOB = { knob: { kind: 'slider', class: 'document', label: 'Knob', range: [0, 1], default: 0.5 } };
const READS = { lift: { target: 'items/dot/at/pos/1', expr: 'k * 10', vars: { k: 'controls/knob/value' } } };
const REVERSE = { rv: { target: 'p', map: 'reverse' } };
const HALF = { rv: { target: 'p', map: { keys: { a: { t: '0s', value: 0, interp: 'linear' }, b: { t: '4s', value: 2 * FLICKS, interp: 'linear' } } } } };
const remapDoc = (id: string, remap: JsonObject, drivers: JsonObject): JsonObject => film(id, [rect('dot', [0, 0])], {
  controls: KNOB, drivers, clips: { slide: SLIDE }, placements: { p: place('slide', 'dot', { start: '0s' }) }, time_remaps: remap,
}, { span: '4s' });

describe(`${AC[7]} a remap whose child time can pass its parent's is refused where its target reads an input`, () => {
  it(`${AC[7]} a reverse remap is refused, naming the remap and the read, when its target's driver reads a control; a remap at half rate over the same target is accepted`, () => {
    const r = refused(evalOne(motion.bin(), { doc: remapDoc('reverse-reads-control', REVERSE, READS), times: [0] }), 'the reverse remap over a driver that reads a control');
    expect(mentions(r, 'rv'), `the refusal names the remap rv: ${show(r)}`).toBe(true);
    expect(mentions(r, 'knob'), `the refusal names the read, the control knob: ${show(r)}`).toBe(true);
    const half = evalOk(motion.bin(), { doc: remapDoc('half-reads-control', HALF, READS), times: [fl(2)] }, 'the half-rate remap over the same target');
    expect(Math.abs(posOr(half.frames[0]!, 'dot', 0) - 2), `at half rate the clip reads 1 s at 2 s, so x is 2, got ${posOr(half.frames[0]!, 'dot', 0)}`).toBeLessThanOrEqual(1e-9);
    evalOk(motion.bin(), { doc: remapDoc('reverse-no-read', REVERSE, {}), times: [0] }, 'the same reverse remap with no driver reading a control');
  }, TIMEOUT);
});

const PLAIN = { clips: { slide: SLIDE }, placements: { 'place-x': place('slide', 'dot', { start: '0s' }) } };
const CHANNEL_X = { 'chan-x': channel('items/dot/at/pos/0', [[0, 0], [4, 1]]) };
const driver = (expr: string): JsonObject => ({ target: 'items/dot/at/pos/1', expr, vars: {} });
const VERDICT = 'verdict:01JB4920000000000000000001';
const paint = { 'tint-fill': channel('items/dot/params/paint/fill', [[0, [0.5, 0, 0]], [4, [0.7, 0, 0]]], 'color', { space: 'oklab' }) };

describe(`${AC[8]} a path takes one writer`, () => {
  it(`${AC[8]} a channel and a placement on one path are refused naming both; each alone, or with a driver, is accepted`, () => {
    const dot = rect('dot', [0, 0]);
    const r = refused(evalOne(motion.bin(), { doc: film('two-writers', [dot], { ...PLAIN, channels: CHANNEL_X }, { span: '4s' }), times: [0] }), 'a channel and a placement on one path');
    expect(mentions(r, 'chan-x') && mentions(r, 'place-x'), `the refusal names the channel chan-x and the placement place-x: ${show(r)}`).toBe(true);
    evalOk(motion.bin(), { doc: film('channel-alone', [dot], { channels: CHANNEL_X }, { span: '4s' }), times: [0] }, 'the channel alone');
    evalOk(motion.bin(), { doc: film('placement-and-driver', [dot], { ...PLAIN, drivers: { over: { target: 'items/dot/at/pos/0', expr: 'x + 1', vars: { x: 'items/dot/at/pos/1' } } } }, { span: '4s' }), times: [0] }, 'a placement and one driver on its path');
  }, TIMEOUT);

  it(`${AC[8]} two drivers on one path are refused naming both`, () => {
    const dot = rect('dot', [0, 0]);
    const r = refused(evalOne(motion.bin(), { doc: film('two-drivers', [dot], { drivers: { 'drive-a': driver('1'), 'drive-b': driver('2') } }, { span: '4s' }), times: [0] }), 'two drivers on one path');
    expect(mentions(r, 'drive-a') && mentions(r, 'drive-b'), `the refusal names both drivers: ${show(r)}`).toBe(true);
    evalOk(motion.bin(), { doc: film('one-driver', [dot], { drivers: { 'drive-a': driver('1') } }, { span: '4s' }), times: [0] }, 'one driver alone');
  }, TIMEOUT);

  it(`${AC[8]} a channel on a paint slot a status binding owns is refused naming both; on a slot the binding doesn't own it is accepted`, () => {
    const dot = rect('dot', [0, 0]);
    const binding = (slot: string): JsonObject => ({ 'dot-state': { target: `items/dot/params/paint/${slot}`, source: VERDICT } });
    const r = refused(evalOne(motion.bin(), { doc: film('paint-owned', [dot], { channels: paint, status_bindings: binding('fill') }, { span: '4s' }), times: [0] }), 'a channel on a slot a status binding owns');
    expect(mentions(r, 'tint-fill') && mentions(r, 'dot-state'), `the refusal names the channel and the binding: ${show(r)}`).toBe(true);
    evalOk(motion.bin(), { doc: film('paint-free', [dot], { channels: paint, status_bindings: binding('stroke') }, { span: '4s' }), times: [0] }, 'the channel beside a binding on the stroke');
  }, TIMEOUT);

  it(`${AC[8]} mix placements from two writers on one path still mix`, () => {
    const layers = { [LAYER]: { writer: 'agent-a', title: 'Main', order: 'a0' }, guest: { writer: 'agent-b', title: 'Guest', order: 'a1' } };
    const doc = film('two-writers-mix', [rect('dot', [10, 0])], {
      layers,
      clips: { one: clipOf('x', 'at/pos/0', [[0, 30], [4, 30]]), two: clipOf('x', 'at/pos/0', [[0, 2], [4, 18]]) },
      placements: { 'mix-one': place('one', 'dot', { start: '0s', blend: 'mix', influence: 0.5, layer: LAYER }), 'mix-two': place('two', 'dot', { start: '0s', blend: 'mix', influence: 0.25, layer: 'guest' }) },
    }, { span: '4s' });
    const a = evalOk(motion.bin(), { doc, times: seededTimes(492_80, 12, 0, fl(4)) }, 'two writers mixing on one path');
    none(a.frames.flatMap((f) => {
      const s = secs(f.t); const want = 10 + 0.5 * (30 - 10) + 0.25 * (2 + 4 * s - 10); const got = posOr(f, 'dot', 0);
      return Math.abs(got - want) <= 1e-9 ? [] : [`at ${f.t} flicks x reads ${got}, not ${want}`];
    }), 'the mix of two writers');
  }, TIMEOUT);
});
