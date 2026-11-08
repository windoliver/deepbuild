// AC1 #495.2cde4005: An echo of 8 copies at a 2-frame lag, evaluated at 1,000 times in random order, equals the played frames
// by pixel hash on one machine and carries nothing between frames.
//
// Through `deep-gpu run` (`layers` for a frame's pixels, `film2d` with `hash` and `from` for pixel hashes). A 4 px wide bar
// crosses a 400 x 60 film at 480 px/s, 8 px per frame at 60 fps, inside a group whose echo is {copies: 8, lag: "2f",
// decay: 0.5}. Copy k draws the children at t - k x lag (Frame and group: echo), so at frame 30 (x = 240) copy k stands 16 k
// px to the left at opacity 0.5^k over nothing: alpha 255, 128, 64, ... 1, and none past k = 8. Then 1,000 frames of the
// same film, in a seeded random order out of 48, are each drawn alone with `from` (nothing drawn before it) and must hash
// as the one in-order play does.
// Wrong programs: no echo (no ghost pixels); 7 or 9 copies; linear decay; a lag in frames of the wrong rate (the ghosts'
// spacing); a history buffer or a trail that reuses the last frame's copies (a seek that starts cold differs from the play).
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, filmCall, film, hashAt, item, layerImage, layersCall, linear, none, pixel, rect, runGpu, seeded, useDir, useGpu, type JsonObject } from './helpers.ts';

const gpu = useGpu();
const dir = useDir();

const SPEED: [number, number][] = [[0, 0], [2, 960]];
function echoDoc(echo: JsonObject | null): JsonObject {
  return film(echo ? 'echo-8' : 'echo-none', [400, 60], [
    item('g', 'group@1', 'a0', echo ? { echo } : {}),
    rect('bar', 'a1', [0, 10, 4, 40], 'accent', { parent: 'g' }),
  ], { channels: { bx: linear('items/bar/at/pos/0', SPEED) } });
}
const ECHO8 = { copies: 8, lag: '2f', decay: 0.5, mode: 'over', newest: 'top' };

describe(`${AC[1]} an echo draws its copies at t - k x lag and keeps nothing`, () => {
  it(`${AC[1]} at frame 30 copy k stands 16 k px left of the bar at alpha 0.5^k, for k = 0 to 8, and nothing stands at k = 9`, () => {
    const out = dir();
    const [reply] = runGpu(gpu(), out, [layersCall(echoDoc(ECHO8), 352_800_000)]);
    const image = layerImage(out, reply!, 'the echo at frame 30');
    const failures: string[] = [];
    for (let k = 0; k <= 9; k++) {
      const want = k <= 8 ? Math.round(255 * 0.5 ** k) : 0;
      const got = pixel(image, 240 - 16 * k + 2, 30)[3];
      if (Math.abs(got - want) > 1) failures.push(`copy ${k} (x = ${240 - 16 * k + 2}): alpha ${got}, not ${want}`);
    }
    none(failures, 'the copies');
  }, TIMEOUT);

  it(`${AC[1]} 1,000 frames drawn alone in random order hash as the played frames do, and the echo changes the frames`, () => {
    const out = dir();
    const N = 48;
    const rand = seeded(495);
    const order = Array.from({ length: 1000 }, () => Math.floor(rand() * N));
    const doc = echoDoc(ECHO8);
    const replies = runGpu(gpu(), out, [filmCall(doc, 0, N), filmCall(echoDoc(null), 0, N), ...order.map((k) => filmCall(doc, k, 1))]);
    const played = Array.from({ length: N }, (_, k) => hashAt(replies[0]!, k, 'the play'));
    const plain = Array.from({ length: N }, (_, k) => hashAt(replies[1]!, k, 'the play without echo'));
    const failures: string[] = [];
    order.forEach((k, i) => { const h = hashAt(replies[i + 2]!, k, `the seek ${i} to frame ${k}`); if (h !== played[k]) failures.push(`frame ${k} drawn alone hashes ${h}, the play's ${played[k]}`); });
    none(failures, 'the seeks');
    // A program that draws no echo plays and seeks alike, so it must differ from the echo's frames: the echo trails from frame 2 on.
    const differing = played.filter((h, k) => k >= 2 && h !== plain[k]).length;
    expect(differing, `the 8-copy echo changes at least 40 of frames 2 to 47 against the same film with no echo; it changes ${differing}`).toBeGreaterThanOrEqual(40);
    expect(new Set(played).size, 'the played frames differ from one another').toBeGreaterThan(40);
  }, TIMEOUT);
});
