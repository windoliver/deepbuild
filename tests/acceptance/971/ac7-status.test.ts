// AC7 #971.f19031be: Status colors in the fixture are exact after the finish with `local: {strength: 1, detail: 2}`.
//
// #382's film with the lamp's badge bound to a verdict in state fail (as #418's suite draws it for "status colors
// still exact" under each tone map) is drawn under none, filmic, agx and neutral, with no `local` and with
// `local: {strength: 1, detail: 2}`. Exact is #418's reading: the fail mark reports the look's fail color and the most
// common pixel inside its bounds is that color, and so is the legend's fail swatch.
//
// A program that leaves the frame alone keeps its status colors as #382 left them, so `local` must draw: under each
// tone map the frame with `local: {strength: 1, detail: 2}` is not the frame drawn without it. At the base the look's
// `local` is read by nothing and that guard fails.
import { describe, it } from 'vitest';
import { FAIL, FAILED, film, readPng, statusExact, statusOf, writeJson, type JsonObject, type Rgb } from '../418/helpers.ts';
import { AC, TIMEOUT, TONE_MAPS, drawn, frame, lookWith, none, requireGpu, runGpu, useGpu, useOut, view3d, type Local } from './helpers.ts';

const bin = useGpu();
const out = useOut();
const ROLES: Record<string, Rgb> = { lamp: [217, 164, 65], block: [184, 188, 196], crate: [127, 167, 201], floor: [42, 45, 51] };
const FULL_ON: Local = { strength: 1, detail: 2 };

describe(`${AC[7]} status colors stay exact under local`, () => {
  it(`${AC[7]} under none, filmic, agx and neutral, with local {strength: 1, detail: 2} changing the scene, the film's fail mark and legend draw the fail color exactly`, () => {
    requireGpu();
    const doc = writeJson(out(), 'film.json', film('film-status-971', { binding: true }));
    const call = (map: (typeof TONE_MAPS)[number][1], local?: Local): JsonObject =>
      view3d({ doc, look: lookWith(map, local, ROLES), size: [480, 360], states: FAILED, targets: ['final'], capture: [0] });
    const replies = runGpu(bin(), out(), TONE_MAPS.flatMap(([, map]) => [call(map), call(map, FULL_ON)]));
    const asLeft: string[] = []; const unchanged: string[] = []; const inexact: string[] = [];
    for (const [k, [name]] of TONE_MAPS.entries()) {
      const plainReply = replies[2 * k]!; const localReply = replies[2 * k + 1]!;
      const plain = frame(drawn(plainReply, `the film under ${name}`), 0, `the film under ${name}`);
      const local = frame(drawn(localReply, `the film under ${name} with local`), 0, `the film under ${name} with local`);
      asLeft.push(...statusExact(statusOf(plainReply, `the film under ${name}`), readPng(out(), plain, 'final', `the film under ${name}`), FAIL, `under ${name}, without local`));
      if (local.pixel_hash === plain.pixel_hash) unchanged.push(`under ${name}, local {strength: 1, detail: 2} draws the frame drawn without local (${plain.pixel_hash})`);
      inexact.push(...statusExact(statusOf(localReply, `the film under ${name} with local`), readPng(out(), local, 'final', `the film under ${name} with local`), FAIL, `under ${name}, with local {strength: 1, detail: 2}`));
    }
    none(asLeft, 'the fixture shows its status colors exact without local, as #382 draws them');
    none(unchanged, 'the guard: local {strength: 1, detail: 2} changes the scene, so status colors kept are not a frame left alone');
    none(inexact, 'status colors are exact after the finish with local {strength: 1, detail: 2}');
  }, TIMEOUT);
});
