// AC5 #265.8c765c23: "A trail whose span reaches before the bake's oldest kept step is refused at check, naming the trail
// and the span, and a source a live drag moves is still refused, naming it"
//
// One `deep-gpu run` of four `view3d` calls (a document the check refuses answers `{"code": "refused", "issues": [...]}`,
// the canvas core's issues, before any frame):
// - The runner (helpers.ts: runnerDoc) over a 2 s transport, so its logic bake keeps steps 0 to 120 and no earlier one:
//   with its trail `streak`'s span 3 s, every frame's oldest point reaches before step 0; refused, an error issue whose
//   `ids` hold `streak` and that names the span: its path `items/streak/params/trail/span`, or its `actual` holding 3 s
//   (3, or 2,116,800,000 flicks). With the span 0.5 s it is drawn (a trail the bake reaches isn't refused).
// - A world-space emitter `glow` anchored on `knob`, which the document control `slide` drags live (a `drag_along`
//   handle): refused, an error issue whose `ids` hold `knob`. With `knob` moved by a channel instead it is drawn.
// The two refusals and the two drawings are one test: the drag's refusal stands at the base already ("still refused").
// Wrong programs: the base (a trail behind a logic-moved item is refused whatever its span, naming the item, not the
// trail or the span); a check that reads no span; one that lets a live drag move a world-space source.

import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, ac, arr, camera, isObject, none, putPrograms, requireGpu, run, runnerDoc, sceneDoc, show, useBins, useDir, view3d, worldEmitter,
  writeJson, type JsonObject, type JsonValue,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const LONG = 3;
const SPAN_PATH = 'items/streak/params/trail/span';

/** The knob and its world-space emitter `glow`, the knob dragged live by `slide` or moved by a channel. */
function knobDoc(how: 'dragged' | 'keyed'): JsonObject {
  const extra: JsonObject = how === 'dragged'
    ? { controls: { slide: { kind: 'drag_along', class: 'document', label: 'Slide the knob', role: 'slider', range: [0, 1], default: 0, handle: { item: 'knob', along: { polyline: [[-2, 0.5], [2, 0.5]] }, drag: 'along' } } } }
    : { channels: { slide: { target: 'items/knob/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: -2, interp: 'linear' }, k1: { t: '2s', value: 2, interp: 'linear' } } } } };
  return sceneDoc('Knob', {
    cam: camera([0, 2, 6], [0, 0.5, 0], 50),
    knob: { kind: 'mark.sphere@1', params: { size: [0.2, 0.2, 0.2], paint: { fill: { role: 'lamp' } } }, at: { pos: [0, 0.5, 0] } },
    glow: worldEmitter('knob', 30, 1, 48),
  }, { transport: { span: '2s', frame_rate: [60, 1] }, ...extra });
}

const errorsOf = (reply: JsonObject): JsonObject[] => (Array.isArray(reply['issues']) ? arr(reply['issues'], 'issues') : []).filter((i): i is JsonObject => isObject(i) && i['severity'] === 'error');
const idsOf = (i: JsonObject): JsonValue[] => (Array.isArray(i['ids']) ? i['ids'] : []);
const namesSpan = (i: JsonObject): boolean => i['path'] === SPAN_PATH || [LONG, LONG * 705_600_000].some((v) => JSON.stringify(i['actual'] ?? null).includes(String(v)));

describe(`${ac(5)} a trail past the bake's oldest step and a source a live drag moves, refused at check`, () => {
  it(`${ac(5)} a trail whose 3 s span reaches before the 2 s bake's oldest kept step is refused naming the trail and the span (its 0.5 s twin is drawn), and a world-space source a live drag moves is still refused naming it (its keyed twin is drawn)`, () => {
    requireGpu();
    const long = runnerDoc({ span: LONG, transport: 2 });
    const short = runnerDoc({ span: 0.5, transport: 2 });
    const call = (doc: JsonObject, name: string, assets: Record<string, string> = {}): JsonObject => view3d({ doc: writeJson(dir(), `${name}.json`, doc), assets, fps: 60, from: 30, frames: 1 });
    const [refusedTrail, drawnTrail, refusedDrag, drawnKeyed] = run(bins.bin('deep-gpu'), dir(), [
      call(long.doc, 'long', putPrograms(dir(), long.programs)), call(short.doc, 'short', putPrograms(dir(), short.programs)),
      call(knobDoc('dragged'), 'dragged'), call(knobDoc('keyed'), 'keyed'),
    ]);
    const fails: string[] = [];
    const span = errorsOf(refusedTrail!).filter((i) => idsOf(i).includes('streak') && namesSpan(i));
    if (refusedTrail!['code'] === undefined || span.length === 0) fails.push(`the trail streak with a ${LONG} s span over a 2 s bake isn't refused at check with an error naming streak and its span (${SPAN_PATH}, or ${LONG} s in its actual): ${show(refusedTrail)}`);
    if (drawnTrail!['code'] !== undefined || !Array.isArray(drawnTrail!['frames'])) fails.push(`the trail streak with a 0.5 s span, which the bake reaches, isn't drawn: ${show(drawnTrail)}`);
    const drag = errorsOf(refusedDrag!).filter((i) => idsOf(i).includes('knob'));
    if (refusedDrag!['code'] === undefined || drag.length === 0) fails.push(`the world-space emitter glow, whose anchor knob the control slide drags live, isn't refused at check with an error naming knob: ${show(refusedDrag)}`);
    if (drawnKeyed!['code'] !== undefined || !Array.isArray(drawnKeyed!['frames'])) fails.push(`the world-space emitter glow on the channel-keyed knob isn't drawn: ${show(drawnKeyed)}`);
    for (const r of [refusedTrail, drawnTrail, refusedDrag, drawnKeyed]) expect(r!['code'], 'a refusal at check, not a platform gap').not.toBe('unsupported_platform');
    none(fails, 'the refusals at check and their drawn twins');
  }, TIMEOUT);
});
