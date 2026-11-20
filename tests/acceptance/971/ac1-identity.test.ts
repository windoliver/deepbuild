// AC1 #971.09d7d9af: With `local: {strength: 0, detail: 1}` every fixture scene renders equal by pixel hash to the same
// scene without `local`, under each tone map.
//
// The fixture scenes are this suite's four (README: The fixtures): the two walls, the coloured patches, the temple and
// the film with a status mark. Each is drawn under each tone map (none, filmic, agx, neutral) three ways in one process:
// with a look that has no `local` field, with `local: {strength: 0, detail: 1}`, and with `local: {strength: 0.5}`.
// The second must have the first's pixel hash. The third is the guard: a `local` off its identity changes the frame, so
// the equality is the identity's and not a field nothing reads. At the base the look's `local` is read by nothing, so
// all three frames are one and the guard fails.
import { describe, expect, it } from 'vitest';
import { FAILED, film, writeJson, type JsonObject, type Rgb } from '../418/helpers.ts';
import {
  AC, FULL, HALF, TIMEOUT, TONE_MAPS, drawn, frame, lookWith, patchesDoc, requireGpu, runGpu, templeDoc, useGpu, useOut, view3d, wallsDoc,
  type Local, type Size,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const IDENTITY: Local = { strength: 0, detail: 1 };
/** #382's film's data roles, as #418's suite colours them. */
const ROLES: Record<string, Rgb> = { lamp: [217, 164, 65], block: [184, 188, 196], crate: [127, 167, 201], floor: [42, 45, 51] };

interface Fixture { name: string; doc: () => JsonObject; size: Size; roles?: Record<string, Rgb>; states?: JsonObject }
const FIXTURES: Fixture[] = [
  { name: 'the two walls', doc: () => wallsDoc('walls-identity'), size: FULL },
  { name: 'the coloured patches', doc: () => patchesDoc('patches-identity'), size: FULL },
  { name: 'the temple', doc: () => templeDoc('temple-identity'), size: FULL },
  { name: 'the film with a status mark', doc: () => film('film-identity-971', { binding: true }), size: [480, 360], roles: ROLES, states: FAILED },
];

describe(`${AC[1]} local at strength 0 and detail 1 changes no pixel`, () => {
  for (const fixture of FIXTURES) {
    it(`${AC[1]} ${fixture.name}: under none, filmic, agx and neutral, local {strength: 0, detail: 1} draws the pixel hash of the same scene without local, and local {strength: 0.5} draws another`, () => {
      requireGpu();
      const doc = writeJson(out(), 'doc.json', fixture.doc());
      const call = (map: (typeof TONE_MAPS)[number][1], local?: Local): JsonObject =>
        view3d({ doc, look: lookWith(map, local, fixture.roles), size: fixture.size, ...(fixture.states ? { states: fixture.states } : {}) });
      const replies = runGpu(bin(), out(), TONE_MAPS.flatMap(([, map]) => [call(map), call(map, IDENTITY), call(map, HALF)]));
      const identity: string[] = []; const guard: string[] = [];
      for (const [k, [name]] of TONE_MAPS.entries()) {
        const [plain, same, half] = [0, 1, 2].map((i) => frame(drawn(replies[3 * k + i]!, `${fixture.name} under ${name}`), 0, `${fixture.name} under ${name}`).pixel_hash);
        if (same !== plain) identity.push(`under ${name}, local {strength: 0, detail: 1} draws ${same}, not ${plain}, the same scene's hash without local`);
        if (half === plain) guard.push(`under ${name}, local {strength: 0.5} draws the frame drawn without local (${plain})`);
      }
      expect(guard, `the guard: a local off its identity changes ${fixture.name}'s frame, so the look's local is read:\n  ${guard.join('\n  ')}`).toEqual([]);
      expect(identity, `${fixture.name} renders equal by pixel hash at strength 0 and detail 1:\n  ${identity.join('\n  ')}`).toEqual([]);
    }, TIMEOUT);
  }
});
