import { describe, expect, it } from 'vitest';
import { MOTION_BIN, batch, evalFrames, itemX, ms, num, obj, sec, useBinaries, type JsonObject } from './helpers.ts';

useBinaries('deep-motion');

function film(extra: JsonObject): JsonObject {
  return {
    format: 1, id: 'loops-391', profile: 'film', title: 'Loops', description: 'One dot moved by a loop.', size: [320, 180],
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: {
      dot: { id: 'dot', kind: 'circle@1', layer: 'main', name: 'Dot', order: 'a0', params: { center: [0, 90], r: 8, paint: { fill: { role: 'accent' } } } },
    },
    ...extra,
  };
}

/** A clip that moves its target's x linearly from `from` at 0 to `to` at `span`. */
function slide(span: string, from: number, to: number): JsonObject {
  return {
    slots: { target: { type: 'circle@1', required: true } },
    span: 'auto',
    channels: {
      x: { target: 'slot:target/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: from, interp: 'linear' }, k1: { t: span, value: to, interp: 'linear' } } },
    },
  };
}

function placementOf(frame: JsonObject, id: string): { iteration: number; local: number } {
  const p = obj(obj(frame['placements'], `t=${String(frame['t'])}: placements`)[id], `t=${String(frame['t'])}: placements.${id}`);
  return { iteration: num(p['iteration'], `placements.${id}.iteration`), local: num(p['local'], `placements.${id}.local`) };
}

describe('AC3 at an exact wrap time a loop shows its start pose, right-continuous like keys, and frames spanning 0, 1 and 3 loops count every pass', () => {
  it('AC3 WPT\'s iteration cases on a placement of three repeats: the boundary restarts at 0 of the next iteration, and 1 only at the end of the active interval', () => {
    // Ported from web-platform-tests 2f57f45d21, web-animations/timing-model/animation-effects/
    // simple-iteration-progress.html and current-iteration.html, the case {iterations: 3,
    // iterationStart: 0, duration: 100, delay: 1, fill: 'both'}: before → iteration 0, progress 0; at the
    // active boundary → 0, 0; after → iteration 2, progress 1. Here duration is the clip's 100 ms span,
    // delay the placement's start at 1 ms, fill both its extend {before, after: hold}, progress its local
    // time over the span, and the pose the clip's x from 20 (progress 0) to 80 (progress 1).
    const doc = film({
      clips: { bounce: slide('0.1s', 20, 80) },
      placements: { p: { clip: 'bounce', slots: { target: 'dot' }, start: '0.001s', repeat: { count: 3, mode: 'wrap' }, extend: { before: 'hold', after: 'hold' } } },
    });
    const span = ms(100);
    const cases: { name: string; t: number; iteration: number; local: number; x: number | null }[] = [
      { name: 'before the start (WPT before)', t: 0, iteration: 0, local: 0, x: 20 },
      { name: 'at the start (WPT active boundary)', t: ms(1), iteration: 0, local: 0, x: 20 },
      { name: 'halfway through the first pass', t: ms(51), iteration: 0, local: ms(50), x: 50 },
      { name: 'one flick before the first wrap', t: ms(101) - 1, iteration: 0, local: span - 1, x: null },
      { name: 'exactly at the first wrap', t: ms(101), iteration: 1, local: 0, x: 20 },
      { name: 'exactly at the second wrap', t: ms(201), iteration: 2, local: 0, x: 20 },
      { name: 'at the end of the active interval (WPT after)', t: ms(301), iteration: 2, local: span, x: 80 },
      { name: 'after the end (WPT after)', t: ms(400), iteration: 2, local: span, x: 80 },
    ];
    const frames = evalFrames(doc, cases.map((c) => c.t));
    cases.forEach((c, i) => {
      const frame = frames[i]!;
      const p = placementOf(frame, 'p');
      expect(p.iteration, `${c.name} (t = ${c.t}): the iteration the time falls in`).toBe(c.iteration);
      expect(p.local, `${c.name} (t = ${c.t}): local time within the iteration, in flicks`).toBe(c.local);
      if (c.x !== null) expect(itemX(frame, 'dot'), `${c.name} (t = ${c.t}): the dot's pose`).toBe(c.x);
    });
    // Right-continuous: the frame one flick before the wrap shows the end of the pass, the wrap itself the start.
    expect(itemX(frames[3]!, 'dot') > 79.99, `one flick before the wrap the dot is at the end of its pass, got ${itemX(frames[3]!, 'dot')}`).toBe(true);
  });

  it('AC3 a placement repeating 1 s passes: frames spanning 0, 1 and 3 loops count 0, 1 and 3 passes, and an exact wrap counts one', () => {
    const doc = film({
      clips: { sweep: slide('1s', 0, 100) },
      placements: { p: { clip: 'sweep', slots: { target: 'dot' }, start: '0s', repeat: { count: 8, mode: 'wrap' } } },
    });
    const times = [sec(0.25), sec(0.5), sec(1.5), sec(4.5), sec(5), sec(5.5)];
    const want = [
      { passes: 0, iteration: 0 }, // the first frame
      { passes: 0, iteration: 0 }, // 0.25 s → 0.5 s spans no loop
      { passes: 1, iteration: 1 }, // 0.5 s → 1.5 s spans one
      { passes: 3, iteration: 4 }, // 1.5 s → 4.5 s spans three: a program that counts only "wrapped or not" says 1
      { passes: 1, iteration: 5 }, // 4.5 s → 5 s ends exactly on a wrap: counted once
      { passes: 0, iteration: 5 }, // 5 s → 5.5 s: the wrap at 5 s is not counted again
    ];
    const frames = evalFrames(doc, times);
    frames.forEach((frame, i) => {
      const p = obj(obj(frame['placements'], 'placements')['p'], 'placements.p');
      expect(num(p['passes'], `t=${times[i]}: placements.p.passes`), `t = ${(times[i]! / sec(1))} s: wraps since the previous frame`).toBe(want[i]!.passes);
      expect(num(p['iteration'], `t=${times[i]}: placements.p.iteration`), `t = ${(times[i]! / sec(1))} s: iteration`).toBe(want[i]!.iteration);
    });
    expect(placementOf(frames[4]!, 'p').local, 'at the exact wrap at 5 s local time is 0').toBe(0);
    expect(itemX(frames[4]!, 'dot'), 'at the exact wrap at 5 s the dot shows its start pose').toBe(0);
    expect(itemX(frames[5]!, 'dot'), 'halfway through the sixth pass').toBe(50);
  });

  it('AC3 the transport\'s loop: at an exact wrap the timeline is back at its start pose, and frames spanning 0, 1 and 3 loops count every pass', () => {
    const doc = film({
      transport: { span: '2s', loop: 'wrap' },
      channels: { 'dot-x': { target: 'items/dot/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '2s', value: 100, interp: 'linear' } } } },
    });
    const times = [sec(0.5), sec(1), sec(2.5), sec(8.5), sec(10) - 1, sec(10), sec(10.5)];
    const want = [
      { passes: 0, pass: 0, docT: sec(0.5) },
      { passes: 0, pass: 0, docT: sec(1) },
      { passes: 1, pass: 1, docT: sec(0.5) },
      { passes: 3, pass: 4, docT: sec(0.5) },
      { passes: 0, pass: 4, docT: sec(2) - 1 },
      { passes: 1, pass: 5, docT: 0 },
      { passes: 0, pass: 5, docT: sec(0.5) },
    ];
    const frames = evalFrames(doc, times);
    frames.forEach((frame, i) => {
      const at = `t = ${times[i]} flicks`;
      expect(num(frame['passes'], `${at}: passes`), `${at}: loop passes since the previous frame`).toBe(want[i]!.passes);
      expect(num(frame['pass'], `${at}: pass`), `${at}: the loop's pass`).toBe(want[i]!.pass);
      expect(num(frame['doc_t'], `${at}: doc_t`), `${at}: the timeline's position`).toBe(want[i]!.docT);
    });
    const value = (i: number): number => num(obj(obj(frames[i]!['channels'], 'channels')['dot-x'], 'channels.dot-x')['value'], 'dot-x value');
    expect(value(4) > 99.99, `one flick before the wrap the channel is at its end, got ${value(4)}`).toBe(true);
    expect(value(5), 'exactly at the wrap the channel shows its start pose (right-continuous)').toBe(0);
    expect(itemX(frames[5]!, 'dot'), 'exactly at the wrap the dot shows its start pose').toBe(0);
  });

  it('a deep-motion line that is not JSON, or has no doc, is bad_input with no panic', () => {
    const outs = batch(MOTION_BIN, ['eval'], ['{"doc": ', { times: [0] }]);
    expect(outs, 'both lines answered bad_input').toEqual([{ ok: false, code: 'bad_input' }, { ok: false, code: 'bad_input' }]);
  });
});
