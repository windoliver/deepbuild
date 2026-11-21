// AC1 #3023: A `deep-gpu` built with `cargo build --locked --bin deep-gpu --features test-meter` opens a live session on
// a document holding a `test.texture@1` item without the `list_unclosed` seal panic: the `run` call answers, and the
// five #425 tests named above get past the seal.
//
// The test-meter build seals its canvas modules once, as a live call opens its window (`sealed()` in
// crates/deep-gpu-layer/src/live.rs), whatever the document holds; at the base that seal panics with list_unclosed,
// naming `test.texture@1` and `mips`. The first test opens a session on a document holding a `test.texture@1` item
// on Metal: the process exits 0 with one answer, the call is answered, the session is live, its first revision is
// current, and every frame reports its view. The second sends the live calls #425's five tests send, with few frames:
// climb's and taste's (an orbiting showpiece charged by the stub meter, on Metal) and a fresh process's canonical
// render of it, and hold's (a still showpiece, on the noop backend, which runs on every platform); each answers past
// the seal. The five #425 tests themselves are suite 425's own run (README: Run them).
import { describe, expect, it } from 'vitest';
import {
  canonicalCall, liveCall, openedOf, answered, requireMetal, runGpu, scene, texture, useDir, useTestMeterBuild, writeJson,
  type Charge, type Opened,
} from './helpers.ts';

const ID = 'AC1 #3023';
const bin = useTestMeterBuild();
const dir = useDir();
const FRAMES = 3;
/** #425's climb charges: half the showpiece's 10 ms free, then none. */
const CHARGES: Charge[] = [{ from: 1, to: 150, gpu_ms: 5 }, { from: 151, gpu_ms: 12 }];

function opened(o: Opened, what: string): void {
  expect(o.state, `${what}: the session s is live (its first revision's issues: ${JSON.stringify(o.issues)?.slice(0, 1500)})`).toBe('live');
  expect(o.outcome, `${what}: the session's first revision is current, latched as it opened (issues: ${JSON.stringify(o.issues)?.slice(0, 1500)})`).toBe('current');
  expect(o.frames.length, `${what}: one frame reported per frame asked`).toBe(FRAMES);
  expect(o.withView, `${what}: every frame reports the view of s`).toEqual(o.frames);
}

describe(`${ID} a test-meter deep-gpu's live path seals test.gpu and opens sessions`, () => {
  it(`${ID} opens a live session on a document holding a test.texture@1 item without the list_unclosed seal panic; the run call answers`, () => {
    requireMetal();
    const out = dir();
    const doc = writeJson(out, 'texture', scene(false, 'work_product', { tex: texture('tex', [64, 64], 'acceptance-3023') }));
    const [r] = runGpu(bin(), out, [liveCall({ doc, frames: FRAMES, charges: [{ from: 1, gpu_ms: 1 }] })]);
    opened(openedOf(r!, 'the live call on the texture document'), 'the texture document');
  }, 1_800_000);

  it(`${ID} the live calls #425's climb, hold and taste tests send get past the seal and answer`, () => {
    const out = dir();
    const still = writeJson(out, 'still', scene(false, 'showpiece'));
    const [h] = runGpu(bin(), out, [liveCall({ doc: still, frames: FRAMES, charges: CHARGES })], { backend: 'noop' });
    opened(openedOf(h!, "hold's live call (noop backend)"), "hold's still showpiece");
    requireMetal();
    const orbiting = writeJson(out, 'showpiece', scene(true, 'showpiece'));
    const [c] = runGpu(bin(), out, [liveCall({ doc: orbiting, frames: FRAMES, charges: CHARGES })]);
    opened(openedOf(c!, "climb's and taste's live call"), "climb's and taste's orbiting showpiece");
    const fresh = runGpu(bin(), out, [canonicalCall(orbiting, 'render_back'), canonicalCall(orbiting, 'export')]);
    fresh.forEach((f, i) => answered(f, `climb's fresh process's canonical render ${i}`));
  }, 1_800_000);
});
