// #464.bf7ef469: "With every finish at its identity default the finish pass changes no pixel, and status colors stay
// exact under every finish"
//
// Identity: a white 800 × 600 print of four colored shapes, drawn by `film2d` with `finish: []` and again with each of
// this issue's finishes named with no field set, so every field takes its default (`grain`, `vignette`, `print_wear`,
// `tone_curve`, `screen`), all five in one finish: the two frames have one pixel hash. Each finish off its identity
// (grain at 4%, a vignette to ink at 0.7, a rounded gate, a contrast of 1.3, 240 scanlines) changes the frame, so the
// equality is the identity's and not a finish the renderer ignores.
// Status: #382's film with the lamp's badge bound to a failed verdict, drawn by `view3d` under each finish off its
// identity, under halftoned separations, and under all of them at once: the fail mark and the legend's fail swatch draw
// #bf232b exactly, while each finish changes the frame. Wrong programs: a default that isn't the identity; a finish
// drawn over status, or status drawn before the finish.
import { describe, expect, it } from 'vitest';
import {
  AC, FAILED, FILM_ROLES, type JsonObject, circle, doc2d, film2d, film3d, frameAt, look2d, look3d, none, readFinal, rect, requireGpu, runGpu, statusExact, useBins,
  useOut, writeJson,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const out = useOut();

const OFF: Record<string, JsonObject> = {
  grain: { grain: { amount: '4%', size: '1px', tone: 'flat', rate: 24 } },
  vignette: { vignette: { color: 'ink', shape: 'round', inner: 0.45, outer: 1, amount: 0.7, aspect: 'frame' } },
  print_wear: { print_wear: { gate: { corner_radius: 40, softness: 8 }, rate: 24 } },
  tone_curve: { tone_curve: { contrast: 1.3 } },
  screen: { screen: { kind: 'crt', scanlines: 240 } },
};
const IDENTITY: JsonObject[] = Object.keys(OFF).map((k) => ({ [k]: {} }));

describe(`${AC[2]} the finish at its identity defaults changes no pixel, and status stays exact under every finish`, () => {
  it(`${AC[2]} with grain, vignette, print wear, the tone curve and the screen each at its identity default, a 2D print's frame has the pixel hash of no finish; off identity each changes it`, () => {
    requireGpu();
    const doc = doc2d('identity-464', [800, 600], [
      rect('sheet', 'a0', [80, 80, 300, 220], 'cyan'), rect('band', 'a1', [260, 200, 420, 120], 'rose'),
      circle('sun', 'a2', [600, 160], 70, 'ochre'), rect('rule', 'a3', [80, 460, 640, 24], 'ink'),
    ]);
    const colors = { cyan: '#28aae6', rose: '#e65a96', ochre: '#c98f2b' };
    const call = (finish: JsonObject[]): JsonObject => film2d(doc, look2d('identity-464', colors, { finish }), { frames: 1 });
    const names = ['no finish', 'every finish at its identity default', ...Object.keys(OFF).map((k) => `${k} off its identity`)];
    const replies = runGpu(bins.bin('deep-gpu'), out(), [call([]), call(IDENTITY), ...Object.values(OFF).map((f) => call([f]))]);
    const hashes = replies.map((r, i) => frameAt(r, 0, names[i]!).pixel_hash);
    expect(hashes[1], `${names[1]} changes no pixel: its pixel hash is ${names[0]}'s`).toBe(hashes[0]);
    const unread = names.slice(2).filter((_, i) => hashes[i + 2] === hashes[0]);
    expect(unread, 'each finish off its identity changes the frame, so the finish reads its fields').toEqual([]);
  });

  it(`${AC[2]} status colors stay exact under each finish off its identity, under halftoned separations and under all of them together`, () => {
    requireGpu();
    const dir = out();
    const doc = writeJson(dir, 'film.json', film3d('film-status-464'));
    const separations: JsonObject = {
      separations: [
        { role: 'lamp', halftone: { angle: 15, pitch: 6, spot: 'round' }, offset: [2, 1], order: 0, overprint: 'multiply', anchor: 'frame' },
        { role: 'block', halftone: 'solid', offset: [-2, 0], order: 1, overprint: 'multiply', anchor: 'frame' },
      ],
    };
    const cases: [string, JsonObject][] = [
      ['no finish', {}],
      ...Object.entries(OFF).map(([k, f]): [string, JsonObject] => [k, { finish: [f] }]),
      ['separations', separations],
      ['every finish and the separations', { finish: Object.values(OFF), ...separations }],
    ];
    const replies = runGpu(bins.bin('deep-gpu'), dir, cases.map(([, change]) => ({
      call: 'view3d', doc, look: look3d('status-464', FILM_ROLES, change), size: [480, 360], targets: ['final'], capture: [0], states: FAILED,
    })));
    const frames = replies.map((r, i) => frameAt(r, 0, cases[i]![0]));
    const problems = replies.flatMap((r, i) => statusExact(r, readFinal(dir, frames[i]!, cases[i]![0]), `under ${cases[i]![0]}`));
    for (let i = 1; i < cases.length; i++) if (frames[i]!.pixel_hash === frames[0]!.pixel_hash) problems.push(`${cases[i]![0]} doesn't change the frame, so it shows nothing about status under it`);
    none(problems, `${AC[2]} status under the finish`);
  });
});
