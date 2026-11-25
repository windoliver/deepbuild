// AC2 #1719.57f3f19b: Render-back of the castle (`packs/examples/castle.json` in `castle.look.json`, its packs installed)
// at 0 s matches `deep-gpu view3d`'s final frame of the same document, look and size by the GPU goldens' comparison
// (`crates/deep-gpu-layer/src/golden.rs`: the blank guard, then FLIP with a pooled mean at most 0.01 and every 16 × 16
// window at most 0.05). A planted render-back that drops the document's look fails, naming the look.
//
// The castle is presented at 0 s and its own 1280 × 800, then rendered back at rev 1 in the same `deep-show run`, its
// pack in the scenario's `packs`. The reference is view3d's `final` target of frame 0 of the same JSON, look and size.
// view3d draws a frame in one of two classes: live, its default and the one the goldens' own view3d snapshot takes (one
// sub-sample), and `render_back` (the look's export samples). The criterion names neither, so a snapshot matches when it
// matches either frame (README: Readings, "view3d's final frame"). The comparison is deep-gpu's `golden` call with a PNG
// snapshot, view3d's frame blessed first as its golden in a throwaway store (`decide`), so both run under one
// fingerprint; the limits are also held here, on the numbers it answers.
//
// Wrong programs this fails on: the merge base (the castle clipped white, FLIP mean 0.53, with the recipes' towers, keep
// and islands left out); the plant; a render-back with the look's tone map and exposure but no bloom (view3d's frame with
// and without it are FLIP mean 0.019, worst window 0.17 apart); one with the look and the post stage but without the
// recipes' items.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CASTLE_PACKS, CASTLE_SIZE, DOC, DUSK, arr, castle, castleLookBytes, drawn, type JsonObject, none, obj, PLANTED, present, proof, renderBack, requireMetal, runGpu, runShow, scenario,
  seed, shown, sub, useBins, useDir, WAYS,
} from './helpers.ts';

const bins = useBins();
const dir = useDir();

const MEAN = 0.01;
const WINDOW = 0.05;
/** view3d's two classes of a frame: its default, live, and `render_back`. */
const CLASSES = ['live', 'render_back'] as const;

describe('AC2 the castle in castle-dusk@1', () => {
  it('AC2 #1719.57f3f19b render-back of the castle at 0 s matches view3d\'s final frame of the same document, look and size by the GPU goldens\' comparison, and a planted render-back that drops the document\'s look fails, naming the look', () => {
    requireMetal();
    const evidence = sub(dir(), 'evidence');
    const out = sub(dir(), 'gpu');
    const store = sub(dir(), 'goldens');
    const document = castle(seed(evidence, castleLookBytes()));
    const look = JSON.parse(castleLookBytes().toString('utf8')) as JsonObject;
    const file = join(dir(), 'castle.json');
    writeFileSync(file, JSON.stringify(document));

    // view3d's final frame of the document at 0 s, in each class, blessed as that class's golden.
    const view = (cls: string): JsonObject => ({ call: 'view3d', doc: file, look, size: CASTLE_SIZE, packs: CASTLE_PACKS(), frames: 1, targets: ['final'], capture: [0], ...(cls === 'live' ? {} : { class: cls }) });
    const frames = runGpu(bins.gpu(), out, CLASSES.map(view), 'the castle through view3d').map((reply, i) => {
      expect(reply['code'], `view3d draws the castle (${CLASSES[i]}): ${shown(reply, 400)}`).toBeUndefined();
      return join(out, `${String(obj(arr(reply['frames'], 'view3d: frames')[0], 'view3d: frames[0]')['final'])}.png`);
    });
    const bless = runGpu(bins.gpu(), out, CLASSES.map((cls, i) => ({ call: 'decide', store, via: 'you', decision: { bless: { fixture: cls, png: frames[i]! } } })), 'blessing view3d\'s frames');
    bless.forEach((b, i) => expect(b['outcome'], `view3d's ${CLASSES[i]} frame is blessed as its golden: ${shown(b)}`).toBe('decided'));

    /** Why a snapshot isn't view3d's frame, or '' when it is: its comparison with each class's golden. */
    const judge = (png: string, what: string): { failure: string; verdicts: string[] } => {
      const replies = runGpu(bins.gpu(), out, CLASSES.map((cls) => ({ call: 'golden', store, fixture: cls, png })), what);
      const passes: boolean[] = [];
      const texts = replies.map((r, i) => {
        const n = (r['numbers'] ?? {}) as JsonObject;
        const [mean, window] = [Number(n['flip_mean'] ?? NaN), Number(n['flip_worst_window'] ?? NaN)];
        passes.push(r['verdict'] === 'PASS' && mean <= MEAN && window <= WINDOW);
        return `${CLASSES[i]}: ${String(r['verdict'])}${typeof r['reason'] === 'string' ? ` (${r['reason']})` : ''}, FLIP mean ${mean.toFixed(4)} (at most ${MEAN}), worst 16 × 16 window ${window.toFixed(4)} (at most ${WINDOW})`;
      });
      proof(`AC2 ${what}`, texts);
      return { failure: passes.some(Boolean) ? '' : `${what} isn't view3d's final frame of the castle in its look, ${DUSK}@1: against view3d's ${texts.join('; against its ')}`, verdicts: replies.map((r) => String(r['verdict'])) };
    };
    const calls = [present(DOC(1), document, CASTLE_SIZE), renderBack(DOC(1), 1, CASTLE_SIZE)];
    const replies = runShow(bins.show(), scenario(evidence, [DOC(1)], calls, { packs: CASTLE_PACKS() }), 'the castle');
    none(WAYS.map((way, i) => judge(drawn(evidence, replies[i]!, CASTLE_SIZE, `the castle, ${way}`).file, way).failure).filter((f) => f !== ''), 'render-back of the castle matches view3d\'s final frame');

    // The plant: the same calls under a render-back that drops the document's look. The same judge fails on its
    // render_back, on FLIP (a frame was drawn and compared, not refused or blank), and names the look.
    const planted = runShow(bins.show(), scenario(evidence, [DOC(1)], calls, { packs: CASTLE_PACKS(), planted: PLANTED }), 'the castle');
    const dropped = judge(drawn(evidence, planted[1]!, CASTLE_SIZE, 'the castle, the planted render_back').file, 'the planted render_back');
    expect(dropped.failure, `the planted render-back (${PLANTED}) fails the comparison, naming the look ${DUSK}`).toContain(DUSK);
    expect(dropped.verdicts, 'the planted render-back fails by the comparison itself, against each of view3d\'s frames').toEqual(['FAIL', 'FAIL']);
  }, 1_800_000);
});
