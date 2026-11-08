// AC1 #496.c9814144: A glyph shift that scrambles a title keeps every glyph's position equal to the unshifted run's at
// every frame, and a glyph shift on a counter or a bound value is refused naming it.
//
// The title SCRAMBLE has one animator whose only prop is a glyph shift in the upper-case set; a channel sweeps its
// range across the title and hold keys step its `by`, so at most frames some letters are swapped and others aren't.
// Every 60 fps frame of the 2 s is drawn and each glyph's position (its pen x and y and its transform into the
// document) is compared bit for bit with the same title drawn with no animator. A guard asks that some frame really
// shows another glyph, so a shift that does nothing can't pass. Each refusal is `raster`'s answer, which runs the
// document's check first; each has a twin, the same animator lifting by y instead of shifting, that draws, so the
// refusal is the glyph shift's.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, channel, clone, drawn, film, frames60, mentions, none, raster, show, textItem, textOf, useRender,
  type Glyph, type JsonObject,
} from './helpers.ts';

const render = useRender();

const TITLE = 'SCRAMBLE';
const scrambler = (props: JsonObject): JsonObject => ({ units: 'grapheme', range: { from: 0, to: 0.5, offset: -0.5 }, shape: 'square', mode: 'add', props });
const SHIFT: JsonObject = { glyph_shift: { set: 'upper', by: 0 } };

const SCRAMBLED = film('scramble', [textItem('title', { text: TITLE, size: 64, animators: [scrambler(SHIFT)] })], {
  channels: {
    sweep: channel('items/title/params/animators/0/range/offset', [[0, -0.5], [2, 1]]),
    by: channel('items/title/params/animators/0/props/glyph_shift/by', [[0, 1, 'hold'], [0.5, 5, 'hold'], [1, 9, 'hold'], [1.5, 14, 'hold'], [2, 20, 'hold']]),
  },
}, '2s');
const UNSHIFTED = film('scramble-unshifted', [textItem('title', { text: TITLE, size: 64 })], {}, '2s');

const same = (a: number[], b: number[]): boolean => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

describe(`${AC[1]} a glyph shift moves no glyph, and is refused on a counter or a bound value`, () => {
  it(`${AC[1]} scrambling SCRAMBLE: at every 60 fps frame of 2 s each glyph sits where the unshifted run's does, bit for bit, while some glyphs change`, () => {
    const b = render;
    const times = frames60(2);
    const still = textOf(drawn(raster(b, UNSHIFTED, [{ t: 0 }]), 'the unshifted title')[0]!, 'title', 'the unshifted title');
    expect(still.glyphs.length, 'the unshifted title draws one glyph per letter').toBe(TITLE.length);
    const answers = drawn(raster(b, SCRAMBLED, times.map((t) => ({ t }))), 'the scrambled title');
    const failures: string[] = [];
    let swapped = 0;
    answers.forEach((a, k) => {
      const at = `frame ${k} (${times[k]} flicks)`;
      const run = textOf(a, 'title', at);
      if (run.glyphs.length !== still.glyphs.length) { failures.push(`${at}: ${run.glyphs.length} glyphs, not ${still.glyphs.length}`); return; }
      run.glyphs.forEach((g: Glyph, i) => {
        const s = still.glyphs[i]!;
        if (g.grapheme !== s.grapheme) failures.push(`${at}: glyph ${i} belongs to grapheme ${g.grapheme}, not ${s.grapheme}`);
        if (!Object.is(g.x, s.x) || !Object.is(g.y, s.y)) failures.push(`${at}: grapheme ${s.grapheme} sits at pen (${g.x}, ${g.y}), not (${s.x}, ${s.y})`);
        if (!same(g.transform, s.transform)) failures.push(`${at}: grapheme ${s.grapheme} is placed by ${show(g.transform)}, not ${show(s.transform)}`);
        if (g.id !== s.id) swapped++;
      });
    });
    none(failures, 'every glyph of the scrambled title sits where the unshifted run puts it');
    expect(swapped, 'the glyph shift swaps some glyphs in some frames (a shift that does nothing scrambles nothing)').toBeGreaterThan(0);
  }, TIMEOUT);

  it(`${AC[1]} a glyph shift on a counter, and on a bound value, is refused naming the item; the same animator lifting by y is accepted on each`, () => {
    const b = render;
    const bound = (id: string, params: JsonObject, animator: JsonObject): JsonObject => film(`shift-on-${id}`, [textItem(id, { ...params, animators: [animator] })], {
      bound_values: { bv: { target: `items/${id}/params/text`, source: 'reading:01JB4960000000000000000001', format: { precision: 1 } } },
    });
    const counter = { text: { counter: { source: 'bv' } }, size: 24, box: { w: 240, h: 32 }, widest: '8,888,888.8' };
    const reading = { text: '', size: 24, box: { w: 240, h: 32 }, widest: '8,888,888.8' };
    for (const [id, params] of [['count', counter], ['reading', reading]] as const) {
      const lifted = raster(b, bound(id, clone(params), scrambler({ y: 4 })), [{ t: 0 }])[0]!;
      expect(lifted['ok'], `${id}: the animator lifting by y is accepted: ${show(lifted)}`).toBe(true);
      const shifted = raster(b, bound(id, clone(params), scrambler(SHIFT)), [{ t: 0 }])[0]!;
      expect(shifted['ok'], `${id}: the glyph shift is refused: ${show(shifted)}`).toBe(false);
      expect(mentions(shifted, id), `${id}: the refusal names the item: ${show(shifted)}`).toBe(true);
    }
  }, TIMEOUT);
});
