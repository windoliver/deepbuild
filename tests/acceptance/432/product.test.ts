// AC4 #432.b131b5d1: A product figure is played live from 0 to 6 s: a channel keys the cloth's sheen weight from 0 at
// 2.9 s to 0.6 at 3 s, and at 4 s a toggle control switches the glass from opaque to transmission 0.9 and a second toggle
// switches the lampshade's shadow mode from none to cast. No pipeline is created and no frame reports settling after the
// first frame, counted on the noop lane and on the reference Mac, and a channel that moves a sheen weight from 0.3 to 0.6
// creates none either; a planted warm-up that compiles only the feature sets in use at t = 0 creates pipelines in the
// first frame after 2.9 s and at 4 s and fails, naming each item, feature set and time; and a figure whose reachable
// feature sets pass the look's 32 is refused at check, naming the items that add them.
//
// The figure (helpers: `productDoc`, `PRODUCT`): 640 × 360 under a sun with 3 shadow cascades; the cloth `cloth`
// (material `cloth_m`, its sheen keyed by the channel `sheen`), the glass ball `glass` (`glass_m`, transmission 0, bound to
// `glass_toggle`: off 0, on 0.9) and the lampshade `shade` (`shade_m`, alpha mode mask, shadow none, bound to
// `shade_toggle`: off none, on cast). `live` at 30 fps for 181 frames: frame n draws t = (n − 1) ÷ 30, so frame 88 is
// 2.9 s, frame 89 (2.933 s) the first frame after it, and frame 121 is 4 s, where both toggles get an entry of `true`
// (the `input` event: README). The second figure keys the sheen from 0.3 to 0.6 over the same span.
// - Unplanted, on the noop lane and then on Metal: after each session's first drawn frame, no view row lists a created
//   pipeline and none reports `settled: false`; frames 89 and 121 draw. Off a reference Mac the Metal count is
//   INCONCLUSIVE after it held.
// - The cap (helpers: `capDoc`): eleven parts with eleven patterns in use, and a variant set whose options set every
//   material's alpha mode or unlit flag: two options (22 reachable feature sets) are admitted; four (44) are refused at
//   check, the session `refused` with an error `over_budget` whose `ids` name only parts or their materials, at least one.
// - `--planted warms_in_use_at_t0` (noop lane): pipelines are created at frames 89 and 121 and no other after the first;
//   at 89 one names the cloth (or its material) with a feature set that says sheen; at 121 one names the glass with a
//   feature set that says transmission and one names the shade into a shadow map (a target other than the view).
// Wrong programs: a warm-up that misses a feature a channel or a control moves off 0, or a mode a control selects; a
// sheen value change that recompiles; a cap that counts only the feature sets in use at t = 0.
import { describe, expect, it } from 'vitest';
import {
  AC, PATTERNS, PRODUCT, WRITER, capDoc, capMaterial, capPart, createdAt, createdFrames, frameAfter, frameAt, inputAt, isObject, liveCall, liveReply,
  payload, productDoc, requireGpu, requireReferenceMac, run, sessionRow, shown, useBin, useOut, viewsOf, warmProblems, writeJson,
  type JsonObject, type Lane, type Live,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
const FPS = PRODUCT.fps;
const SHEEN = frameAfter(PRODUCT.sheenFrom, FPS);
const TOGGLES = frameAt(PRODUCT.toggleAt, FPS);
const toggles = (session: string): JsonObject[] => [inputAt(TOGGLES, session, 'glass_toggle', true), inputAt(TOGGLES, session, 'shade_toggle', true)];

function play(dir: string, lane: Lane, planted?: 'warms_in_use_at_t0'): { product: Live; moving: Live } {
  const doc = (name: string, start: number) => writeJson(dir, `${name}-${lane}-${planted ?? 'shipped'}.json`, payload(productDoc(`${name}-432`, start)));
  const [a, b] = run(bin(), dir, [
    liveCall({ frames: PRODUCT.frames, fps: FPS, sessions: [{ session: 'product', writer: WRITER, doc: doc('product', 0), size: PRODUCT.size }], events: toggles('product') }),
    liveCall({ frames: PRODUCT.frames, fps: FPS, sessions: [{ session: 'moving', writer: WRITER, doc: doc('moving', 0.3), size: PRODUCT.size }] }),
  ], planted ? { lane, planted } : { lane });
  return { product: liveReply(a!, `the product figure on ${lane}`), moving: liveReply(b!, `the 0.3 → 0.6 figure on ${lane}`) };
}
function drew(live: Live, session: string, frame: number): boolean {
  return viewsOf(live, session).find((v) => v.frame === frame)?.drawn === true;
}
const has = (items: string[], ...ids: string[]): boolean => ids.some((id) => items.includes(id));

describe(`${AC[4]} the product figure played live creates no pipeline after its first frame`, () => {
  it(`${AC[4]} 0 to 6 s with the sheen keyed at 2.9 s and both toggles at 4 s, and a sheen moved 0.3 → 0.6: no pipeline created and no settling after the first frame, on the noop lane and on Metal; a figure past the look's 32 reachable feature sets is refused at check, naming its items`, () => {
    const dir = out();
    const lanes: Lane[] = process.platform === 'darwin' ? ['noop', 'gpu'] : ['noop'];
    for (const lane of lanes) {
      const { product, moving } = play(dir, lane);
      const problems = [...warmProblems(product, 'product', FPS), ...warmProblems(moving, 'moving', FPS)];
      console.log(`${AC[4]}: ${lane}: ${problems.length} problems${problems.length ? `, first: ${problems[0]}` : ''}`);
      expect(problems, `${lane}: nothing compiles or settles after the first frame`).toEqual([]);
      expect(drew(product, 'product', SHEEN), `${lane}: the product figure draws frame ${SHEEN}, where the sheen leaves 0`).toBe(true);
      expect(drew(product, 'product', TOGGLES), `${lane}: the product figure draws frame ${TOGGLES}, where both toggles switch`).toBe(true);
      expect(drew(moving, 'moving', SHEEN), `${lane}: the 0.3 → 0.6 figure draws frame ${SHEEN}, where its sheen moves`).toBe(true);
    }

    const [under, over] = run(bin(), dir, [false, true].map((o) => liveCall({
      frames: 1, fps: FPS, sessions: [{ session: o ? 'over' : 'under', writer: WRITER, doc: writeJson(dir, `cap-${o}.json`, payload(capDoc(`cap-${o}-432`, o))), size: [640, 360] }],
    })), { lane: 'noop' });
    const underRow = sessionRow(liveReply(under!, 'the cap figure with 22 reachable feature sets'), 'under');
    expect(underRow['state'], `22 reachable feature sets are admitted: ${shown(underRow)}`).toBe('live');
    const overRow = sessionRow(liveReply(over!, 'the cap figure with 44 reachable feature sets'), 'over');
    expect(overRow['state'], `44 reachable feature sets are refused at check: ${shown(overRow)}`).toBe('refused');
    const allowed = new Set(PATTERNS.flatMap((_, k) => [capPart(k), capMaterial(k)]));
    const issues = (Array.isArray(overRow['issues']) ? overRow['issues'] : []).filter(isObject);
    const cap = issues.filter((i) => i['severity'] === 'error' && i['code'] === 'over_budget');
    expect(cap.length, `the refusal is over_budget: ${shown(overRow['issues'])}`).toBeGreaterThan(0);
    for (const i of cap) {
      const ids = Array.isArray(i['ids']) ? i['ids'].filter((x): x is string => typeof x === 'string') : [];
      expect(ids.length, `the refusal names the items that add the feature sets: ${shown(i)}`).toBeGreaterThan(0);
      expect(ids.filter((id) => !allowed.has(id)), `it names only parts and their materials: ${shown(i)}`).toEqual([]);
    }
    if (process.platform === 'darwin') requireReferenceMac('The product figure\'s count');
    else requireGpu();
  }, 3_600_000);

  it(`${AC[4]} a planted warm-up of the feature sets in use at t = 0 (--planted warms_in_use_at_t0) creates pipelines at ${frameAfter(PRODUCT.sheenFrom, PRODUCT.fps)} (2.933 s) and ${frameAt(PRODUCT.toggleAt, PRODUCT.fps)} (4 s) and fails, naming each item, feature set and time`, () => {
    const { product } = play(out(), 'noop', 'warms_in_use_at_t0');
    const problems = warmProblems(product, 'product', FPS);
    console.log(`${AC[4]}: warms_in_use_at_t0: ${problems.join('; ').slice(0, 3000)}`);
    expect(problems.length, 'the check fails').toBeGreaterThan(0);
    expect(createdFrames(product, 'product'), 'pipelines are created in the first frame after 2.9 s and at 4 s, and in no other').toEqual([SHEEN, TOGGLES]);
    const atSheen = createdAt(product, 'product', SHEEN);
    expect(atSheen.some((c) => has(c.items, 'cloth', 'cloth_m') && /sheen/i.test(c.feature_set)), `at 2.933 s a pipeline names the cloth and its sheen: ${JSON.stringify(atSheen).slice(0, 1500)}`).toBe(true);
    const atToggle = createdAt(product, 'product', TOGGLES);
    expect(atToggle.some((c) => has(c.items, 'glass', 'glass_m') && /transmission/i.test(c.feature_set)), `at 4 s a pipeline names the glass and its transmission: ${JSON.stringify(atToggle).slice(0, 1500)}`).toBe(true);
    expect(atToggle.some((c) => has(c.items, 'shade', 'shade_m') && c.target !== 'view' && c.feature_set !== ''), `at 4 s a pipeline names the shade in a shadow map: ${JSON.stringify(atToggle).slice(0, 1500)}`).toBe(true);
    for (const t of ['2.933 s', '4.000 s']) expect(problems.some((p) => p.includes(t)), `the failure names the time ${t}`).toBe(true);
  }, 1_800_000);
});
