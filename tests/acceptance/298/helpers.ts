// Test-side tools for the #298 acceptance tests (README: The surface under test). The binary builds, the `deep-gpu run`
// reply parsing, the pinhole, the PNG reading and the envelope's pieces are #506's suite's; the `deep-show run` driver,
// its evidence store and #544's assembler are #539's; both are imported, never copied. Here: the criteria's fixtures
// (the clamp fixture, still and flown through, the leader fixture and the card with its tilt driver), the calls with
// this suite's fields, and the references the readings are held to, written from the issue and the design: where a
// clamped overlay draws and which way it points, and which points of the page a tilted card covers. Nothing here
// stands in for an overlay, a clamp, a driver, the pointer, a check, the renderer or an export.

import { spawnSync } from 'node:child_process';
import { expect } from 'vitest';
import { PLAIN_LOOK } from '../424/helpers.ts';
import {
  DAY_SKY, REPO, TIMEOUT, arr, box, clone, frameSeconds, isObject, keyed, linear, linear3, lit, obj, show, sunItem, toScreen,
  type Cam, type Frame, type JsonObject, type JsonValue, type V3,
} from '../506/helpers.ts';
import { MS, assemble, issuesOf, namedIn, names, namesItem, scenario as scenario539, showCall, type Program, type Pt } from '../539/helpers.ts';

export {
  FLICKS, REPO, SHA, TIMEOUT, apng, codeOff, decodePng, finalOf, fmt, frameSeconds, framesOf, inconclusive, none, readNamed, requireGpu, sha256, show,
  toScreen, useBins, useDir, writeJson, type Cam, type Frame, type Image, type JsonObject, type JsonValue, type Rgb, type V3,
} from '../506/helpers.ts';
export { getEvidence, pagePixel, presented, putEvidence, runShow, scopeView, stateOf, toPanel, type Program, type Pt, type View } from '../539/helpers.ts';

/**
 * The criteria's IDs: `#298.` and the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space
 * collapsed (scripts/proof-change.mjs: criterionId). Each test file holds its own as a string constant, so the proof
 * lanes read every test's name from its source.
 */
export const CRITERIA = {
  1: '#298.febe6b8e', 2: '#298.ef87b0b5', 3: '#298.85119906', 4: '#298.fd687640', 5: '#298.1903184f', 6: '#298.4ae89dd7',
} as const;

/** The `deep-gpu run --planted` names this suite adds (README: Planted programs; twins.json). */
export type GpuPlanted =
  | 'clamp_each_axis' | 'clamp_unmirrored_behind' | 'clamp_to_frame' | 'edge_from_previous_frame' | 'leader_draws_while_clamped';
/** The `deep-show run` scenario's `planted` name this suite adds. */
export type ShowPlanted = 'export_keeps_live_hover_at';

const MIB = 1024 * 1024;

/** A planted program's run: this suite's own judgement must fail it, and one failure must match every one of `named`. */
export function failsNaming(failures: readonly string[], named: readonly RegExp[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  expect(failures.some((f) => named.every((n) => n.test(f))), `${what}: a failure names ${named.join(' and ')}; the failures were:\n  ${failures.slice(0, 20).join('\n  ')}`).toBe(true);
}
/** How far two directions are apart, degrees, the short way round. */
export const angleOff = (a: number, b: number): number => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
export const xy = (p: readonly [number, number], digits = 2): string => `(${p[0].toFixed(digits)}, ${p[1].toFixed(digits)})`;

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario line `{out, calls}` in, one answer line out (#377), as #506's suite
// runs it, with this suite's planted names.

export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: GpuPlanted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const what = `deep-gpu ${args.join(' ')}`;
  const run = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const timedOut = (run.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  expect(timedOut, `${what} finished within its timeout`).toBe(false);
  if (run.error) throw Error(`${what}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  expect(run.status, `${what} exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one answer line for the one scenario line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${what}: the answer`);
  expect(answer['ok'], `${what} refused the scenario: ${show(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${what}: replies`).map((r, i) => obj(r, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(calls.length);
  return replies;
}

/** The look every 3D view here draws with: #424's plain physical look with the role `accent`, the shipped clean look's lagoon. */
export function look(): JsonObject {
  const palette: JsonObject = { ...(PLAIN_LOOK['palette'] as JsonObject), lagoon: '#1aa3c8' };
  const roles: JsonObject = { ...(PLAIN_LOOK['roles'] as JsonObject), accent: 'lagoon' };
  return { ...PLAIN_LOOK, id: 'look-298-plain', description: 'The plain physical look for the clamp fixtures.', palette, roles };
}

/** A `view3d` call (#378) in this suite's look, each frame reporting its anchored overlays (README: the `overlays` rows). */
export interface View3 {
  doc: string; size: [number, number]; fps: number; frames: number; from?: number; seeks?: { after: number; to: number }[];
  capture?: 'every' | number[]; evaluate?: string[];
}
export const view3d = (c: View3): JsonObject => ({ call: 'view3d', look: look(), targets: ['final'], overlays: true, ...(c as unknown as JsonObject) });

/**
 * One row of a frame's `overlays` (README: the `overlays` rows): `at`, the place the overlay's frame's top left corner
 * draws, null while it's hidden (the base's member); `edge` and `edge_angle`, null where the row has none; `leader`,
 * where its leader ends, null while the leader hides, undefined where the row has no `leader` member.
 */
export interface Row { id: string; at: [number, number] | null; edge: number | null; angle: number | null; leader: { to: [number, number] } | null | undefined }
const pair = (v: JsonValue | undefined): [number, number] | null =>
  (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' ? [v[0], v[1]] : null);
/** A frame's rows by overlay ID, or null where the frame reports no overlays. */
export function rowsOf(f: Frame): Map<string, Row> | null {
  const rows = f.raw['overlays'];
  if (!Array.isArray(rows)) return null;
  const out = new Map<string, Row>();
  for (const r of rows) {
    if (!isObject(r) || typeof r['id'] !== 'string') continue;
    const l = r['leader'];
    const to = isObject(l) ? pair(l['to']) : null;
    out.set(r['id'], {
      id: r['id'], at: pair(r['at']), edge: typeof r['edge'] === 'number' ? r['edge'] : null, angle: typeof r['edge_angle'] === 'number' ? r['edge_angle'] : null,
      leader: l === undefined ? undefined : to ? { to } : null,
    });
  }
  return out;
}
/** A path's evaluated value in a frame (`view3d`'s `evaluate`, #429), or null where the frame has none or it is no number. */
export function valueOf(f: Frame, path: string): number | null {
  const values = f.raw['values'];
  const v = isObject(values) ? values[path] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// ---------------------------------------------------------------------------------------------------
// The rule (Overlay: clamped to the edge), worked out here from the design's words, never from a program.

/**
 * Where an overlay with `hide: clamp` draws, and which way it points. `p` is its anchor's projection as a pinhole
 * gives it (#506's `toScreen`: for a point behind the eye, depth ≤ 0, the division by the negative depth lands it
 * through the frame's center from where it lies). The design: an anchor behind the camera projects mirrored through
 * the center first; `edge_angle` is the direction from the safe frame's center toward the anchor, 0 to the right and
 * clockwise as screen y points down, so atan2(dy, dx) in degrees, in [0, 360); an anchor inside the safe frame (the
 * frame less `safe` px a side) draws there; one outside it draws where the ray from the center toward it meets the
 * safe frame inset by `inset` and by the overlay's half size `half`: the center plus the ray scaled until its x or
 * its y first reaches that inset frame's side. `margin` is how far inside the safe frame the anchor projects
 * (negative outside); `toward` the projection, mirrored where behind.
 */
export interface Placed { centre: [number, number]; edge: 0 | 1; angle: number; margin: number; behind: boolean; toward: [number, number] }
export function clampRule(size: readonly [number, number], safe: number, half: number, inset: number, p: { x: number; y: number; depth: number }): Placed {
  const [w, h] = size;
  const cx = w / 2; const cy = h / 2;
  const behind = p.depth <= 0;
  const toward: [number, number] = behind ? [2 * cx - p.x, 2 * cy - p.y] : [p.x, p.y];
  const dx = toward[0] - cx; const dy = toward[1] - cy;
  const margin = Math.min(toward[0] - safe, w - safe - toward[0], toward[1] - safe, h - safe - toward[1]);
  const turn = (Math.atan2(dy, dx) * 180) / Math.PI;
  const angle = turn < 0 ? turn + 360 : turn;
  if (!behind && margin >= 0) return { centre: toward, edge: 0, angle, margin, behind, toward };
  const reachX = cx - safe - inset - half; const reachY = cy - safe - inset - half;
  const k = Math.min(dx === 0 ? Infinity : reachX / Math.abs(dx), dy === 0 ? Infinity : reachY / Math.abs(dy));
  return { centre: [cx + k * dx, cy + k * dy], edge: 1, angle, margin, behind, toward };
}
/**
 * How clear a pair of an anchor and a time is of the two readings the design leaves open (README: What couldn't be
 * tested): px outside the safe frame for a clamped one (mirrored first where behind), or px between the unclamped
 * overlay's box and the safe frame's edge. The fixtures keep every sampled pair at least 2 px clear.
 */
export const clearOf = (r: Placed, half: number): number => (r.edge === 1 ? -r.margin : r.margin - half);
/** The sides of the frame inset by `safe + inset + half` that `centre` lies on, within 0.05 px. */
export function sidesOf(centre: readonly [number, number], size: readonly [number, number], reach: number): string[] {
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= 0.05;
  return [
    ...(near(centre[0], reach) ? ['left'] : []), ...(near(centre[0], size[0] - reach) ? ['right'] : []),
    ...(near(centre[1], reach) ? ['top'] : []), ...(near(centre[1], size[1] - reach) ? ['bottom'] : []),
  ];
}

// ---------------------------------------------------------------------------------------------------
// Documents

/** A whole scene document as a session holds it (#378; #506's envelope): one writer layer `main`, every item in it, in the order given. */
export function sceneDoc(id: string, title: string, size: [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(4, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title, description: `${title}: an acceptance fixture for overlays clamped to the edge.`, size, camera: 'cam', seed: 298,
    transport: { span: '4s' }, requires: { modules: { scene3d: '^1', marks2d: '^1', effects: '^1' } }, budget: { class: 'showpiece' },
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } }, ...extra, items: withIds,
  };
}
/** A document as a writer sends it to `deep_show`: no `layers` and no item `layer`, which the hub stamps from the connection. */
export function stripped(doc: JsonObject): JsonObject {
  const out = clone(doc);
  delete out['layers'];
  for (const item of Object.values(obj(out['items'], 'items'))) if (isObject(item)) delete item['layer'];
  return out;
}
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #298 acceptance tests.' };

// ---------------------------------------------------------------------------------------------------
// The clamp fixture (criteria 1, 2, 3 and 6): five posts on a floor, a 48 px square tag on each post's top.

/** The envelope's `safe`, px, at every size the fixture draws at, and a tag's side, px. */
export const SAFE = 48;
export const TAG = 48;
/** The floor's top, m. */
const FLOOR = -2.5;
export type Marker = 'east' | 'north' | 'corner' | 'rear' | 'near';
/**
 * Each post's top, world m: the point its tag is anchored to. Through the still camera at 1920 × 1080 (100 px a metre
 * at the posts' depth) `east` projects to (2400, 540), `north` to (960, −300) and `corner` to (2400, −300), the
 * criterion's three; `rear` stands 3 m behind the camera, 6 m to its left and 1 m up; `near` projects inside the safe
 * frame, to (1110, 740).
 */
export const MARKERS: Record<Marker, V3> = { east: [14.4, 0, 0], north: [0, 8.4, 0], corner: [14.4, 8.4, 0], rear: [-6, 1, 12.6], near: [1.5, -2, 0] };
export const MARKER_NAMES = Object.keys(MARKERS) as Marker[];
export const tagId = (m: Marker): string => `tag-${m}`;
export const arrowId = (m: Marker): string => `arrow-${m}`;
/** The path a tag's arrow turns on: its driver's target, read by `view3d`'s `evaluate`. */
export const turnPath = (m: Marker): string => `items/${arrowId(m)}/at/rot/2`;
/** The flown fixture's tag that asks more space: its `clamp_inset`, px. */
export const INSET: Partial<Record<Marker, number>> = { north: 16 };

/** The still camera: at (0, 0, 9.6) m aimed at the origin, 90° across the frame's wider side, so its focal length is half that side. */
export const STILL = { position: [0, 0, 9.6] as V3, target: [0, 0, 0] as V3, fov: 90 } as const;
export const stillCam = (size: [number, number]): Cam => ({ kind: 'perspective', position: STILL.position, target: STILL.target, fov: STILL.fov, size });
/**
 * The flythrough: over 4 s the camera flies from (5, 1, 10) to (−6, 2, −4) m, past the posts, while the point it aims
 * at moves from (3, −1, −3) to (−2, 0, 5), so it ends looking back the way it came. Its 20 sampled times are frames 0
 * to 19 at 5 frames a second.
 */
export const FLY = { from: [5, 1, 10] as V3, to: [-6, 2, -4] as V3, aimFrom: [3, -1, -3] as V3, aimTo: [-2, 0, 5] as V3, span: 4, fps: 5, frames: 20 } as const;
const mix = (a: V3, b: V3, s: number): V3 => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
export const flyCam = (n: number, size: [number, number]): Cam => {
  const s = frameSeconds(n, FLY.fps) / FLY.span;
  return { kind: 'perspective', position: mix(FLY.from, FLY.to, s), target: mix(FLY.aimFrom, FLY.aimTo, s), fov: STILL.fov, size };
};
/** Where `m`'s tag draws through `cam` by the rule, the fixture's `safe` and tag size; `inset` its `clamp_inset`. */
export const tagRule = (m: Marker, cam: Cam, inset = 0): Placed => clampRule(cam.size, SAFE, TAG / 2, inset, toScreen(cam, MARKERS[m]));

/** A tag's arrow, pointing along +x of its own space about its position: a triangle 32 px long. */
const ARROW = 'M -16 -14 L 16 0 L -16 14 Z';

export interface ClampOptions {
  /** `still`: the still camera. `fly`: the flythrough's two channels on the camera, and `north`'s `clamp_inset`. */
  motion: 'still' | 'fly';
  /** The document's own `id`, where a run holds several. */
  id?: string;
  /** Each tag holds an arrow whose turn a driver sets from the tag's `edge_angle`. */
  arrows?: boolean;
  /** A logic item `brain` with these reads, its program by SHA-256 (in the evidence store). */
  logic?: { program: string; reads: string[] };
}
/**
 * The clamp fixture: a floor, five posts and, on each post's top, `tag-<post>`: an `overlay.frame@1` holding a 48 px
 * square frame (its background in `accent`), anchored to the top's point of its post, its offset (−24, −24) so its box
 * centers on that point's projection, with `hide: "clamp"`. With `arrows`, each frame holds `arrow-<post>`, a `path@1`
 * in `ink` turned about the frame's middle by the driver `turn-<post>`: `{target: "items/arrow-<post>/at/rot/2",
 * expr: "a", vars: {a: "tag-<post>.edge_angle"}}` (a 2D turn is x toward y, which is clockwise on screen, as
 * `edge_angle` is).
 */
export function clampDoc(o: ClampOptions): JsonObject {
  const fly = o.motion === 'fly';
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [...(fly ? FLY.from : STILL.position)], target: [...(fly ? FLY.aimFrom : STILL.target)], fov: STILL.fov, near: 0.05, far: 500 } },
    sky: DAY_SKY, sun: sunItem(3, 40, 150),
    'floor-mat': lit([0.22, 0.24, 0.3]), 'post-mat': lit([0.75, 0.45, 0.15]),
    floor: box([80, 0.1, 80], [0, FLOOR - 0.05, 0], 'floor-mat'),
  };
  const height = (m: Marker): number => MARKERS[m][1] - FLOOR;
  for (const m of MARKER_NAMES) items[m] = box([0.6, height(m), 0.6], [MARKERS[m][0], FLOOR + height(m) / 2, MARKERS[m][2]], 'post-mat');
  const drivers: JsonObject = {};
  for (const m of MARKER_NAMES) {
    const frame = `${tagId(m)}-frame`;
    items[frame] = { kind: 'frame@1', params: { box: [0, 0, TAG, TAG] } };
    items[`${tagId(m)}-bg`] = { kind: 'rect@1', parent: frame, params: { box: [0, 0, TAG, TAG], paint: { fill: { role: 'accent' } } } };
    if (o.arrows) {
      items[arrowId(m)] = { kind: 'path@1', parent: frame, params: { d: ARROW, paint: { fill: { role: 'ink' } } }, at: { pos: [TAG / 2, TAG / 2, 0], rot: [0, 0, 0] } };
      drivers[`turn-${m}`] = { target: turnPath(m), expr: 'a', vars: { a: `${tagId(m)}.edge_angle` } };
    }
    const inset = fly ? INSET[m] : undefined;
    items[tagId(m)] = {
      kind: 'overlay.frame@1',
      params: { frame, anchor: { item: m, point: [0, height(m) / 2, 0] }, offset: [-TAG / 2, -TAG / 2], hide: 'clamp', ...(inset === undefined ? {} : { clamp_inset: inset }) },
    };
  }
  const extra: JsonObject = { safe: SAFE };
  if (o.arrows) extra['drivers'] = drivers;
  if (fly) {
    extra['channels'] = {
      fly: linear3('items/cam/params/position', [[0, FLY.from], [FLY.span, FLY.to]]),
      aim: linear3('items/cam/params/target', [[0, FLY.aimFrom], [FLY.span, FLY.aimTo]]),
    };
  }
  if (o.logic) {
    items['brain'] = { kind: 'logic@1', params: { program: o.logic.program, step_rate: 60, ...(o.logic.reads.length ? { reads: o.logic.reads } : {}), writes: { ticks: { type: 'i32', count: 1 } } } };
    extra['assets'] = { ticker_program: { sha256: o.logic.program, license: LICENSE } };
    extra['requires'] = { modules: { scene3d: '^1', marks2d: '^1', effects: '^1', logic: '^1' } };
    extra['transport'] = { span: '4s', frame_rate: [60, 1] };
  }
  return sceneDoc(o.id ?? `clamp-${o.motion}${o.arrows ? '-arrows' : ''}`, fly ? 'Tags on posts, flown through' : 'Tags on posts', [1920, 1080], items, extra);
}

// ---------------------------------------------------------------------------------------------------
// The leader fixture (criterion 5): a post that slides out of the frame and back, its tag's leader to its middle.

/**
 * 960 × 540 px, `safe: 24`, through the still camera (50 px a metre at the post's depth). The post `mate` (2 m tall,
 * its middle on y = 0) slides along x from 3 m to 16 m by 2 s and back to 3 m by 4 s. Its tag `tag` (the clamp
 * fixture's, 48 px square, `hide: "clamp"`) is anchored to the post's top, 1 m above its middle, and its leader runs
 * to the post's middle (`to: "mate"`), 50 px below the anchor's projection: the two cross the safe frame's right side
 * together. 21 frames at 5 a second: the anchor projects inside the safe frame at frames 0 to 4 and 16 to 20, and
 * outside it at frames 5 to 15, off the frame itself from frame 6 to 14.
 */
export const LEADER = { size: [960, 540] as [number, number], safe: 24, slide: [[0, 3], [2, 16], [4, 3]] as [number, number][], fps: 5, frames: 21 } as const;
/** The post's x at frame n, m. */
export const mateX = (n: number): number => keyed(LEADER.slide, frameSeconds(n, LEADER.fps));
export function leaderDoc(leader: boolean): JsonObject {
  return sceneDoc('clamp-leader', 'A tag with a leader on a sliding post', LEADER.size, {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [...STILL.position], target: [...STILL.target], fov: STILL.fov, near: 0.05, far: 500 } },
    sky: DAY_SKY, sun: sunItem(3, 40, 150),
    'floor-mat': lit([0.22, 0.24, 0.3]), 'post-mat': lit([0.75, 0.45, 0.15]),
    floor: box([80, 0.1, 80], [0, -1.05, 0], 'floor-mat'),
    mate: box([0.6, 2, 0.6], [LEADER.slide[0]![1], 0, 0], 'post-mat'),
    'tag-frame': { kind: 'frame@1', params: { box: [0, 0, TAG, TAG] } },
    'tag-bg': { kind: 'rect@1', parent: 'tag-frame', params: { box: [0, 0, TAG, TAG], paint: { fill: { role: 'accent' } } } },
    tag: {
      kind: 'overlay.frame@1',
      params: {
        frame: 'tag-frame', anchor: { item: 'mate', point: [0, 1, 0] }, offset: [-TAG / 2, -TAG / 2], hide: 'clamp',
        ...(leader ? { leader: { to: 'mate', line: 'ink', width: 2, end: 'dot', elbow: 'none' } } : {}),
      },
    },
  }, { safe: LEADER.safe, channels: { slide: linear('items/mate/at/pos/0', LEADER.slide) } });
}

// ---------------------------------------------------------------------------------------------------
// The card (criteria 4 and 6): a 2D figure whose card tilts toward the pointer.

/** `deep-show run`'s document IDs (26 Crockford characters). */
export const DOC = (n: number): string => `01JB298D${String(n).padStart(18, '0')}`;
/**
 * The page, u (a panel of the same size shows it 1:1); the card's box [x, y, w, h] on it; the driver's gain, degrees
 * for the whole width; the hover the criterion gives, as shares of the card's bounds.
 */
export const CARD = { page: [640, 400] as [number, number], box: [120, 80, 400, 240] as [number, number, number, number], gain: 30, hover: [0.9, 0.5] as [number, number] } as const;
export const CARD_CENTRE: Pt = [CARD.box[0] + CARD.box[2] / 2, CARD.box[1] + CARD.box[3] / 2];
/** The page point at (0.9, 0.5) of the card's bounds: (480, 200). */
export const CARD_HOVER: Pt = [CARD.box[0] + CARD.hover[0] * CARD.box[2], CARD.box[1] + CARD.hover[1] * CARD.box[3]];
/** The tilt its driver writes with `hover_at` reading (0.9, 0.5): 30 × (0.9 − 0.5) = 12°, x toward y: clockwise on the page. */
export const CARD_TILT = CARD.gain * (CARD.hover[0] - 0.5);
/** The paths `eval` reads: the card's tilt, and the probe's place, which is −64 plus what `hover_at` reads on each axis. */
export const TILT_PATH = 'items/card/at/rot/2';
export const PROBE_PATHS = ['items/probe/at/pos/0', 'items/probe/at/pos/1'] as const;
/**
 * Page points that tell the card's pose apart. `toward`: 7 px right of the flat card's right side, 48 px above its
 * middle: outside the flat card, inside the card turned clockwise by 10.5° to 12.5° (its top right corner swings out
 * over it). `away`: its mirror on the left, inside only a card turned the other way. `flat`: 8 px inside the flat
 * card's top right corner, which a clockwise turn of 3° or more uncovers. `middle`: the card's middle, covered always.
 */
export const CARD_PROBES = {
  toward: [CARD_CENTRE[0] + 207, CARD_CENTRE[1] - 48] as Pt, away: [CARD_CENTRE[0] - 207, CARD_CENTRE[1] - 48] as Pt,
  flat: [CARD_CENTRE[0] + 192, CARD_CENTRE[1] - 112] as Pt, middle: CARD_CENTRE,
} as const;
/** How far page point `p` lies inside the card turned `deg` about its middle (x toward y), u; negative outside. */
export function insideCard(p: Pt, deg: number): number {
  const a = (deg * Math.PI) / 180;
  const dx = p[0] - CARD_CENTRE[0]; const dy = p[1] - CARD_CENTRE[1];
  const lx = dx * Math.cos(a) + dy * Math.sin(a); const ly = -dx * Math.sin(a) + dy * Math.cos(a);
  return Math.min(CARD.box[2] / 2 - Math.abs(lx), CARD.box[3] / 2 - Math.abs(ly));
}
/** A logic program that counts its steps into `ticks` and reads nothing but its seed (WebAssembly text, #544's assembler). */
export function tickerProgram(): Program {
  return assemble('ticker-298', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func (export "init") (param $seed i64))
  (func (export "step") (param $k i64)
    (i32.store (i32.const 4096) (i32.wrap_i64 (local.get $k)))))`);
}
/**
 * The card: a figure with a transport (#539's form: a 2D camera over the page, 2 s at 60 frames a second). `card` is a
 * `rect@1` in `accent`, 400 × 240 u, turning about its middle (`at.pivot: "c"`); the driver `tilt` writes its turn:
 * `hover_at(card).x < 0 ? 0 : 30 * (hover_at(card).x - 0.5)`, so it lies flat while `hover_at` reads (−1, −1) and
 * leans clockwise with the pointer on its right half. `probe`, a 4 u square kept off the page, carries what `hover_at`
 * reads as data: its drivers write −64 + `hover_at(card).x` and −64 + `hover_at(card).y` to its position. With
 * `logic`, a logic item `peek` with those reads.
 */
export function cardDoc(id = 'card-tilt', logic?: { program: Program; reads: string[] }): JsonObject {
  const [x, y, w, h] = CARD.box;
  const items: JsonObject[] = [
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [CARD.page[0] / 2, CARD.page[1] / 2, 0], view_width: CARD.page[0] } },
    { id: 'card', kind: 'rect@1', name: 'Card', role: 'part', order: 'a1', params: { box: [0, 0, w, h], paint: { fill: { role: 'accent' } } }, at: { pos: [x, y, 0], rot: [0, 0, 0], pivot: 'c' } },
    { id: 'probe', kind: 'rect@1', name: 'Probe', role: 'part', order: 'a2', params: { box: [0, 0, 4, 4], paint: { fill: { role: 'accent' } } }, at: { pos: [-64, -64, 0] } },
  ];
  if (logic) {
    items.push({
      id: 'peek', kind: 'logic@1', name: 'Logic peek', order: 'a9',
      params: { program: logic.program.sha, step_rate: 60, ...(logic.reads.length ? { reads: logic.reads } : {}), writes: { ticks: { type: 'i32', count: 1 } } },
    });
  }
  return {
    format: 1, id, profile: 'figure', title: `#298 ${id}`, description: `The #298 acceptance tests' document ${id}.`, size: [...CARD.page], seed: 298, camera: 'cam',
    transport: { span: '2s', frame_rate: [60, 1] }, requires: { modules: { input: '^1', ...(logic ? { logic: '^1' } : {}) } },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
    ...(logic ? { assets: { ticker_program: { sha256: logic.program.sha, license: LICENSE } } } : {}),
    drivers: {
      tilt: { target: TILT_PATH, expr: `hover_at(card).x < 0 ? 0 : ${CARD.gain} * (hover_at(card).x - 0.5)` },
      probe_x: { target: PROBE_PATHS[0], expr: '-64 + hover_at(card).x' },
      probe_y: { target: PROBE_PATHS[1], expr: '-64 + hover_at(card).y' },
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run` (#393's scenario, as #539's suite drives it): the calls of one run on the scope's virtual clock.

/** Each method adds one call at its own `at` and gives its index, so a test reads that call's reply. */
export class Show {
  readonly calls: JsonObject[] = [];
  private t = 0;
  constructor(readonly panel = 'p1') {}
  private add(c: JsonObject, gapMs: number): number {
    this.t += Math.round(gapMs * MS);
    this.calls.push({ ...c, at: this.t });
    return this.calls.length - 1;
  }
  /** The agent's `deep_show` of a whole document, with its issues. */
  present(doc: string, document: JsonObject): number { return this.add(showCall(doc, document, 0), 0.001); }
  scope(): number { return this.add({ call: 'scope', panel: this.panel }, 160); }
  /** The pointer moved to panel px `p` with no button down: a replica's hover. */
  move(p: Pt): number { return this.add({ call: 'input', panel: this.panel, event: { type: 'move', pos: p } }, 100); }
  /** The panel's live view, its viewer state included. */
  view(): number { return this.add({ call: 'view', panel: this.panel }, 50); }
  /** `eval` at `t` flicks: the document's own frame as a picture, and `paths`' evaluated values (#1918). */
  eval(doc: string, t: number, paths: readonly string[]): number { return this.add({ call: 'eval', doc, t, pixels: true, paths: [...paths] }, 50); }
  /** The export (#501, #504): every frame of the span as a PNG sequence in `out`, at `fps`. */
  export(doc: string, out: string, fps: number): number { return this.add({ call: 'export', doc, out, video: { codec: 'png_seq' }, frame_rate: [fps, 1] }, 50); }
}
/** A scenario (#539's): each document in a visible panel of its own at `rect`, with `planted` when given. */
export function showScenario(evidence: string, docs: string[], calls: JsonObject[], rect: [number, number, number, number], planted?: ShowPlanted): JsonObject {
  return { ...scenario539(evidence, docs, calls, { rect }), ...(planted ? { planted } : {}) };
}
/** A `deep_show` reply that refused its document at check, with an error that names item `item`: in its `ids`, its `path` or its own fields. */
export function refusedNamingItem(reply: JsonObject, item: string, what: string): void {
  expect(reply['outcome'], `${what} is refused at check: ${show(reply, 2500)}`).toBe('refused');
  const errors = issuesOf(reply).filter((i) => i['severity'] === 'error');
  const naming = errors.filter((i) => namesItem(i, item) || names(namedIn(i), item));
  expect(naming.length, `${what}: an error names the logic item ${item}; the errors: ${show(errors, 2500)}`).toBeGreaterThan(0);
}
