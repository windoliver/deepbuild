// Criterion 7's fixture, which the taste test shows too: the slice_shift title and the `film2d` call that plays it.
//
// The title is a 539 × 208 px card in the shipped clean look: a group `title` whose children are a ramp across the
// whole card, forty thin ticks at uneven places and five block letters, so every row changes when it moves sideways by
// 18 px or more and no two shifts look alike. `sliced` gives the group its one pass, `fx.slice_shift@1` with the
// criterion's params; `step` is in flicks (0.14 s is 98,784,000). At 50 frames a second a step is exactly 7 frames.
import { PACK_DIR, SLICE_SHIFT, document, group, isObject, item, pngOf, rect, refusal, shown, type Image, type JsonObject } from './helpers.ts';

export const TITLE = { size: [539, 208] as const, fps: 50, step_frames: 7, steps: 6 };
const [W, H] = TITLE.size;
const FLICKS_PER_SECOND = 705_600_000;
/** The criterion's params. */
export const SLICE: JsonObject = { count: [2, 4], height: [10, 35], shift: [18, 64], step: Math.round(0.14 * FLICKS_PER_SECOND), seed: 9 };

export function titleDoc(id: string, sliced: boolean): JsonObject {
  const items: JsonObject[] = [
    group('title', 'a1', sliced ? [{ op: SLICE_SHIFT, params: SLICE }] : []),
    item('ramp', 'rect@1', 'a2', { box: [0, 0, W, H], paint: { fill: { gradient: { kind: 'linear', stops: [{ at: 0, role: 'raised' }, { at: 0.5, role: 'accent' }, { at: 1, role: 'ink' }] } } } }, { parent: 'title' }),
  ];
  for (let k = 0; k < 40; k++) items.push(rect(`tick${k}`, `b${String(k).padStart(2, '0')}`, [6 + 13 * k + ((k * k * 7) % 11), 0, 2, H], k % 2 ? 'session_line' : 'ground', 1, { parent: 'title' }));
  for (let j = 0; j < 5; j++) {
    items.push(rect(`letter${j}`, `c${j}0`, [40 + 100 * j, 58, 60, 92], 'ground', 1, { parent: 'title' }));
    items.push(rect(`counter${j}`, `c${j}1`, [55 + 100 * j, 80 + 6 * j, 30, 36], 'session_readout', 1, { parent: 'title' }));
  }
  return document(id, TITLE.size, items, { transport: { span: '4s', frame_rate: `${TITLE.fps}/1` } });
}
/** `film2d` (#417's call, #430's `from` and `hash`, #464's `capture` and `flicker`), in the shipped clean look. */
export const film2d = (doc: JsonObject, extra: JsonObject): JsonObject => ({ call: 'film2d', doc, look: 'clean', fps: TITLE.fps, hash: true, packs: [PACK_DIR], ...extra });

export interface Row { frame: number; hash: string; final: string | null; picture: Image | null }
/** The frame rows of a `film2d` reply, or why there are none. */
export function rowsOf(out: string, reply: JsonObject | undefined, what: string): Row[] | string {
  const refused = refusal(reply, what);
  if (refused) return refused;
  const rows: Row[] = [];
  for (const f of (Array.isArray(reply!['frames']) ? reply!['frames'] : []).filter(isObject)) {
    if (typeof f['frame'] !== 'number' || typeof f['pixel_hash'] !== 'string') return `${what}: a frame row without frame and pixel_hash: ${shown(f, 300)}`;
    const png = f['final'] === undefined ? null : pngOf(out, f['final']);
    if (typeof png === 'string') return `${what}: frame ${f['frame']}'s final: ${png}`;
    rows.push({ frame: f['frame'], hash: f['pixel_hash'], final: typeof f['final'] === 'string' ? f['final'] : null, picture: png });
  }
  return rows;
}
