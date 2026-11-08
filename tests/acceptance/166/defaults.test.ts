// #166.28aab23d: "`water: {}` on a plate, with no other field set, gives waves from a 3 m/s wind, a mirror at strength 1
// and the default tint, and passes the document checks"
//
// The fixture (helpers.ts `harbour`, 480 × 270): the lake plate's material `lake-water` holds `water: {}` and nothing
// else of water's (its roughness 0.05 and no `mirror`), reflecting a red post and two crates under a day sky.
//
// Defaults: frames 0, 20 and 45 (30 fps) of `water: {}` have the pixel hashes of the same frames of the lake with every
// default spelled out, the design's: `waves: {wind: {speed: 3, direction: 0}}`, `ripples: {scale: 0.5, strength: 0.3}`,
// `rain: 0`, `absorption: {color: [0.12, 0.42, 0.40], depth: 3}`, `distort: 16`, `foam: {threshold: 1}`, `wake:
// "none"`, and its own mirror named at strength 1: `mirror: {strength: 1, blur: 0, plane: "lake"}`. Not vacuous: each
// default, changed alone, changes frame 20 (a 6 m/s wind; the mirror at strength 0.5; the absorption color [0.5, 0.1,
// 0.1]), and the waves move (frames 0 and 20 differ). Wrong programs: a wind table read at another speed, no mirror
// unless one is named, another tint, `water: {}` drawn flat.
// The document checks: `deep-show run`'s `deep_show` of the `water: {}` document with its issues (#393, as #421's suite
// reads it) is presented with no error issue and no item skipped as an unknown kind.
import { describe, expect, it } from 'vitest';
import { AC, DEFAULTS, type JsonObject, type Water, admitted, harbour, hashAt, look3d, requireGpu, runGpu, showDocument, useBins, useOut, view3d, writeJson } from './helpers.ts';

const bins = useBins(['deep-gpu', 'deep-show']);
const out = useOut();
const SIZE: [number, number] = [480, 270];
const LOOK = look3d('defaults-166');
const MIRROR: JsonObject = { mirror: { strength: 1, blur: 0, plane: 'lake' } };

describe(`${AC[5]} water: {} alone gives a lake in a 3 m/s breeze that reflects and tints, and passes the document checks`, () => {
  it(`${AC[5]} water: {} draws, at frames 0, 20 and 45, what every default spelled out draws, and each default shows`, () => {
    requireGpu();
    const dir = out();
    const docs: [string, Water, JsonObject][] = [
      ['bare', {}, {}],
      ['spelled', DEFAULTS, MIRROR],
      ['wind6', { ...DEFAULTS, waves: { wind: { speed: 6, direction: 0 } } }, MIRROR],
      ['half-mirror', DEFAULTS, { mirror: { strength: 0.5, blur: 0, plane: 'lake' } }],
      ['red-tint', { ...DEFAULTS, absorption: { color: [0.5, 0.1, 0.1], depth: 3 } }, MIRROR],
    ];
    const paths = docs.map(([name, w, extra]) => writeJson(dir, name, harbour(`lake-${name}`, SIZE, w, { waterExtra: extra })));
    const film = (p: string) => view3d({ doc: p, look: LOOK, size: SIZE, frames: 46, fps: 30 });
    const [bare, spelled, wind6, half, red] = runGpu(bins('deep-gpu'), dir, paths.map(film));
    for (const n of [0, 20, 45]) {
      expect(hashAt(bare!, n, 'water: {}'), `frame ${n} of water: {} equals the spelled-out defaults'`).toBe(hashAt(spelled!, n, 'the spelled-out defaults'));
    }
    const b20 = hashAt(bare!, 20, 'water: {}');
    expect(hashAt(bare!, 0, 'water: {}'), 'the default waves move: frames 0 and 20 differ').not.toBe(b20);
    expect(hashAt(wind6!, 20, 'a 6 m/s wind'), 'the wind\'s speed shows: a 6 m/s wind draws another frame').not.toBe(b20);
    expect(hashAt(half!, 20, 'the mirror at 0.5'), 'the mirror shows: at strength 0.5 the frame differs').not.toBe(b20);
    expect(hashAt(red!, 20, 'a red tint'), 'the tint shows: another absorption color draws another frame').not.toBe(b20);
  });

  it(`${AC[5]} the water: {} document passes the document checks`, () => {
    const dir = out();
    admitted(showDocument(bins('deep-show'), dir, harbour('lake-bare', SIZE, {})), 'the deep_show of water: {}');
  });
});
