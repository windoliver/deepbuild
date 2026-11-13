// Test-side tools for the #2293 acceptance tests (README: The surface under test). They reuse #1918's surface, imported
// read only from ../1918/helpers.ts (as #1921's suite does): its deep-show build (`cargo build --locked -p deep-show
// --bin deep-show`), its scenario and run of `deep-show run`, its `eval` call with `paths` and its scene builders. They
// add the rally the issue names, its `mark.box@1` items painted as the issue gives, and the two calls the criteria name:
// `deep_show` with `include: ['pixels']` at `t`, and the `bounds` mode of the current revision at `t`. Nothing here
// stands in for deep-show: every box, bound and value read here is the program's own.

import { expect } from 'vitest';
import {
  SESSION, arr, box, camera, dynamic, floor, num, obj, sceneDoc, show, sphere, world, type JsonObject, type JsonValue, type V3,
} from '../1918/helpers.ts';

export * from '../1918/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const CRITERIA = {
  1: '#2293.8649cfa0',
  2: '#2293.9d1c0f9e',
} as const;

/** The time both criteria name, as deep_show takes it, and as the 60 fps frame `eval` takes (0.5 s × 60). */
export const T = '0.5s';
export const FRAME_AT_T = 30;
export const BALL_AT = 'items/ball/at';
export const BALL_POS = 'items/ball/at/pos';

/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB2293D0${String(n).padStart(16, '0')}`;

/** A test that can't be judged on this machine fails with this, never passes (invariant 2). */
export function inconclusive(why: string): never {
  throw Error(`INCONCLUSIVE: ${why}; this is not a pass`);
}

// ---------------------------------------------------------------------------------------------------
// The rally: #1918's criterion 4 scene (tests/acceptance/1918/ac4-scene-lab.test.ts, its paddle channel from x0 = 5), with
// its `mark.box@1` items given `paint: { fill: { role: 'accent' } }` as the issue says (without paint, scene3d refuses
// with `ref_unresolved`).

const PAINT: JsonObject = { fill: { role: 'accent' } };
const painted = (size: V3, at?: JsonObject): JsonObject => ({ kind: 'mark.box@1', params: { size, paint: PAINT }, ...(at ? { at } : {}) });
const X0 = 5;

/**
 * The rally. `output: true` is the issue's scene: the world's output binds the ball's pose to `items/ball/at`, and the
 * ball's item has no `at` (its authored place is the origin). `output: false` drops that output, so only the ball's
 * authored `ballAt` (or none: the origin) places it; everything else is the same scene.
 */
export function rally(o: { output: boolean; ballAt?: JsonObject }): JsonObject {
  const lab = world({
    contact_materials: {
      turf: { friction: 0.6, restitution: 0.1, density: 1000, tag: 'grass' },
      leather: { friction: 0.5, restitution: 0.4, density: 80, tag: 'leather' },
      oak: { friction: 0.4, restitution: 0.5, density: 700, tag: 'wood' },
    },
    shapes: { floor: box([30, 0.1, 30]), ball: sphere(0.11), board: box([0.05, 0.6, 1]) },
    bodies: {
      floor: floor('turf'),
      ball: dynamic('ball', 'leather', [0, 0.11, 0], { mass: 0.43, velocity: { linear: [6, 3, 0] } }),
      paddle: { kind: 'kinematic', shapes: [{ shape: 'board', contact_material: 'oak' }], pose: { pos: [X0, 0.65, 0] }, follow: 'items/paddle/at/pos' },
    },
    ...(o.output ? { outputs: { ball: { from: 'ball', read: 'pose', to: BALL_AT } } } : {}),
  });
  return sceneDoc('Rally', '2s', {
    cam: camera([3, 3, 12], [3, 0.5, 0]),
    ball: painted([0.22, 0.22, 0.22], o.ballAt),
    paddle: painted([0.1, 1.2, 2], { pos: [X0, 0.65, 0] }),
    tally: painted([0.1, 0.1, 0.1], { pos: [0, 4, 0] }),
  }, {
    channels: { paddle: { target: 'items/paddle/at/pos', type: 'vec3', keys: { k0: { t: '0s', value: [X0, 0.65, 0], interp: 'linear' }, k1: { t: '2s', value: [X0 - 0.4, 0.65, 0], interp: 'hold' } } } },
    drivers: { wood: { target: 'items/tally/at/pos/0', expr: 'count(h)', vars: { h: { list: 'lab.occurrences', kinds: ['hit'], tags: ['wood'] } } } },
    worlds: { lab },
  });
}

// ---------------------------------------------------------------------------------------------------
// The calls (README: The surface under test).

/** The agent's `deep_show` of a whole document, drawn at `t` with its pixels (Render-back). */
export const pixelsCall = (doc: string, document: JsonObject, t: string): JsonObject =>
  ({ call: 'deep_show', session: SESSION, doc, document, include: ['pixels'], t });
/** A diagnostic mode of `doc`'s current revision at `t` (Render-back: diagnostic modes; no document, so no revision). */
export const modeCall = (doc: string, mode: string, t: string): JsonObject => ({ call: 'deep_show', session: SESSION, doc, mode, t });

/**
 * A 3D render's reply is presented. One this machine's GPU couldn't draw (`unsupported_platform`, `gpu_unavailable`) is
 * INCONCLUSIVE; any other reply that isn't presented fails here, naming it.
 */
export function drawnHere(reply: JsonObject | undefined, what: string): JsonObject {
  const text = JSON.stringify(reply) ?? 'undefined';
  if (reply?.['outcome'] !== 'presented' && /unsupported_platform|gpu_unavailable/.test(text)) {
    inconclusive(`${what}: this machine could not draw the 3D frame (${text.slice(0, 400)})`);
  }
  expect(reply?.['outcome'], `${what} is presented: ${show(reply)}`).toBe('presented');
  return reply!;
}

/** The screen box `[x, y, w, h]` (px) of `id`'s one row in a presented render's `visible` table. */
export function visibleBox(reply: JsonObject, id: string, what: string): number[] {
  const rows = arr(reply['visible'], `${what}: visible`).map((r, i) => obj(r, `${what}: visible[${i}]`));
  const mine = rows.filter((r) => r['id'] === id);
  expect(mine.length, `${what}: one visible row for ${id}; the rows are ${show(rows as JsonValue)}`).toBe(1);
  const b = arr(mine[0]!['box'], `${what}: ${id}'s box`);
  expect(b.length, `${what}: ${id}'s box is [x, y, w, h]: ${show(b)}`).toBe(4);
  return b.map((x, i) => num(x, `${what}: ${id}'s box[${i}]`));
}

export const centre2 = (b: readonly number[]): [number, number] => [b[0]! + b[2]! / 2, b[1]! + b[3]! / 2];
export const fmt = (v: readonly number[]): string => `[${v.map((x) => x.toFixed(3)).join(', ')}]`;
