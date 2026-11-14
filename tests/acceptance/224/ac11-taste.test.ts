// AC11 #224.c7725e3e: "Shown to you: screenshots of the unit sphere, the helicoid-to-catenoid family, a value-colored
// surface and a checker surface, taken by the check run from the renderer's own output, with a recording of the
// helicoid-to-catenoid slider, are attached to the PR and shown to you in the session. Whether they look right is one
// taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to
// judge it"
//
// Four documents (README: The taste call), each first presented by `deep_show` with no error (so a build without
// `surface@1` fails here, at that assertion), then drawn by `view3d` in the suite's filmic look (`LOOK_3D`) from the
// renderer's own `final` target: `sphere.png` (the unit sphere), `family.png` (the family over u ∈ [−π, π] at θ = π/4,
// gridded), `value-colored.png` (a saddle colored by its height through a, b and c) and `checker.png` (a torus in a
// 16 × 8 checker of a and b), 960 × 540, frame 0; and `family-slider.apng`, the family as your input track moves θ from
// 0 to π/2, one entry a frame, 60 frames at 30 fps, 480 × 270, the final PNGs put into one animated PNG unchanged. Each
// is written to docs/evidence/224/ byte for byte and its path and SHA-256 printed, for the PR and the session. The call
// is a file you record, named by DEEPBUILD_TASTE_224: {"criterion": "#224.c7725e3e", "by": "you", "screenshots":
// [sha256 × 4], "recordings": [sha256], "call": "looks_right" | "looks_wrong"}. With no record, or one made on other
// files, the test fails as INCONCLUSIVE; looks_wrong fails it. No other test in this suite reads a picture.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DAY_SKY, DOC, LOOK_3D, LOOK_FIELDS, PI, REPO, STROKE, THETA, TIMEOUT, UNIT_SPHERE, admitted, apng, arr, ask, family, gpu, idOf, inconclusive,
  material, num, obj, present, readPng, sceneDoc, sessionForm, sha256, sun, surface, thetaEntry, useBins, useTemp, type JsonObject,
} from './helpers.ts';

useBins();
const temp = useTemp();
const ID = AC[11];
const SHOT: [number, number] = [960, 540];
const REC: [number, number] = [480, 270];
const REC_FPS = 30;
const REC_FRAMES = 60;
const KEEP = join(REPO, 'docs', 'evidence', '224');
/** Formula z up: each surface turned −90° about x, so its z is the world's +Y. */
const UP: JsonObject = { rot: [-90, 0, 0] };
const LIT = (cam: number[]): Record<string, JsonObject> => ({
  cam: { kind: 'camera@1', params: { projection: 'perspective', position: cam, target: [0, 0, 0], fov: 40 } },
  sky: DAY_SKY, sun: sun(4, [-40, 30, 0]), clay: material([0.85, 0.55, 0.35], 0.5),
});

const familyDoc = (track: JsonObject[]): JsonObject => sceneDoc('The helicoid-to-catenoid family', {
  ...LIT([7, 4.5, 7]), family: family([-PI, PI], { u: PI / 4, v: 0.5 }, { material: 'clay', at: UP }),
}, { controls: { theta: THETA }, track });
const DOCS: [string, JsonObject][] = [
  ['sphere', sceneDoc('The unit sphere', { ...LIT([2.6, 1.8, 2.6]), ball: surface(UNIT_SPHERE, { material: 'clay', at: UP }) })],
  ['family', familyDoc([thetaEntry(0, 1, PI / 4)])],
  ['value-colored', sceneDoc('A saddle colored by its height', {
    ...LIT([3, 2.4, 3]),
    saddle: surface({ fn: { x: 'u', y: 'v', z: '(v^2 - u^2) / 2' }, u: [-1, 1], v: [-1, 1], color: { by: 'z', ramp: ['a', 'b', 'c'], domain: [-0.5, 0.5] }, grid_lines: { u: 0.25, v: 0.25, stroke: STROKE } }, { at: UP }),
  }, LOOK_FIELDS)],
  ['checker', sceneDoc('A checkered torus', {
    ...LIT([3.2, 2.6, 3.2]),
    torus: surface({ fn: { x: '(1 + 0.35 * cos(v)) * cos(u)', y: '(1 + 0.35 * cos(v)) * sin(u)', z: '0.35 * sin(v)' }, u: [0, 2 * PI], v: [0, 2 * PI], checker: { roles: ['a', 'b'], cells: [16, 8] } }, { at: UP }),
  }, LOOK_FIELDS)],
];
const SLIDE = Array.from({ length: REC_FRAMES }, (_, f) => thetaEntry(f / REC_FPS, f + 1, ((PI / 2) * f) / (REC_FRAMES - 1)));

describe(`${ID} one taste call on the renderer's own screenshots and recording`, () => {
  it(`${ID} the unit sphere, the family, a value-colored and a checker surface, and the family's slider recorded, from the renderer's own frames, and the recorded taste call says they look right`, () => {
    // Each document is a surface the build presents, before anything is drawn.
    const all: [string, JsonObject][] = [...DOCS, ['family-slider', familyDoc(SLIDE)]];
    const replies = ask(all.map(([, d], k) => present(DOC(k + 1), (({ track: _t, ...rest }) => rest)(d))));
    replies.forEach((r, k) => admitted(r, `the ${all[k]![0]} document`));
    if (process.platform !== 'darwin') inconclusive(`the renderer draws on macOS's Metal device; this is ${process.platform}`);

    const out = temp();
    const path = (name: string, d: JsonObject): string => { const p = join(out, `${name}.json`); writeFileSync(p, JSON.stringify(sessionForm(d, `${name}-224`))); return p; };
    const calls = [
      ...DOCS.map(([name, d]) => ({ call: 'view3d', look: LOOK_3D, doc: path(name, d), size: SHOT, fps: 30, from: 0, frames: 1, capture: [0], targets: ['final'] })),
      { call: 'view3d', look: LOOK_3D, doc: path('family-slider', familyDoc(SLIDE)), size: REC, fps: REC_FPS, from: 0, frames: REC_FRAMES, capture: 'every', targets: ['final'] },
    ];
    const drawn = gpu(out, calls);
    const framesOf = (reply: JsonObject, what: string): JsonObject[] => {
      if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
      expect(reply['code'], `${what} is drawn, not refused: ${JSON.stringify(reply).slice(0, 800)}`).toBeUndefined();
      return arr(reply['frames'], `${what}: frames`).map((f, i) => obj(f, `${what}: frames[${i}]`));
    };
    mkdirSync(KEEP, { recursive: true });
    const screenshots: string[] = [];
    DOCS.forEach(([name], k) => {
      const shot = framesOf(drawn[k]!, `${name}: the screenshot`).find((f) => f['frame'] === 0);
      expect(shot, `${name}: frame 0 is in the reply`).toBeDefined();
      const png = readPng(out, shot!['final'], `${name}: the screenshot`);
      writeFileSync(join(KEEP, `${name}.png`), png);
      screenshots.push(sha256(png));
      console.log(`for the taste call: ${join('docs', 'evidence', '224', `${name}.png`)}  ${sha256(png)}`);
    });
    const frames = framesOf(drawn[DOCS.length]!, 'the slider recording');
    expect(frames.map((f) => num(f['frame'], 'a recording frame')), `the recording holds frames 0 to ${REC_FRAMES - 1}`).toEqual(Array.from({ length: REC_FRAMES }, (_, i) => i));
    const anim = apng(frames.map((f) => readPng(out, f['final'], `the slider recording, frame ${String(f['frame'])}`)), REC_FPS, 'the slider recording');
    writeFileSync(join(KEEP, 'family-slider.apng'), anim);
    const recordings = [sha256(anim)];
    console.log(`for the taste call: ${join('docs', 'evidence', '224', 'family-slider.apng')}  ${recordings[0]!}`);

    const file = process.env['DEEPBUILD_TASTE_224'];
    const files = `screenshots ${screenshots.join(', ')}; recording ${recordings[0]!}`;
    if (!file || !existsSync(file)) inconclusive(`no taste call is recorded on these files (${files}); record yours in a file named by DEEPBUILD_TASTE_224`);
    const record = JSON.parse(readFileSync(file, 'utf8')) as { criterion?: string; by?: string; screenshots?: string[]; recordings?: string[]; call?: string };
    const same = (a: string[] | undefined, b: string[]): boolean => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...b].sort());
    if (record.criterion !== idOf(ID) || record.by !== 'you' || !same(record.screenshots, screenshots) || !same(record.recordings, recordings)) {
      inconclusive(`the recorded taste call at ${file} isn't yours on these files (${files})`);
    }
    expect(record.call, 'your taste call').toBe('looks_right');
  }, 2 * TIMEOUT);
});
