// Test-side tools for the #450 acceptance tests (README: The surface under test). They reuse #449's suite helpers for
// what is the same here (building `deep-gpu`, one `deep-gpu run` scenario, the `particles` call and its reader, the
// GPU guard, #449's acceptance look, the animated PNG of the canvas's own frames) and add: this suite's criterion IDs;
// its planted name; `view3d` with the `trails` field and its reader; the `trail` call and its reader; the trail hash
// and the ribbon hash as the README defines them; and the fixture documents more than one file reads (the rolling
// wheel and the thrown ball). Nothing here stands in for the trail, the bake, the evaluation or the renderer.

import { Buffer } from 'node:buffer';
import { expect } from 'vitest';
import {
  FLICKS, SHA, arr, isObject, look, num, obj, runGpu, sha256, show, str, inconclusive,
  type JsonObject, type JsonValue, type Startup, type V3,
} from '../449/helpers.ts';

export {
  FLICKS, REPO, SHA, SIZE, SPARK_LOOK, TIMEOUT, apng, arr, camera, failsNaming, flicks, fmt, fmtV, frameFlicks, framesOf, gap,
  inconclusive, linearChannel, markBox, none, num, obj, particlesCall, particlesItem, passed, planeJson, reading,
  requireGpu, secondsOf, sha256, show, str, useBins, useDir, writeJson,
  type JsonObject, type JsonValue, type Plane, type Reading, type V3,
} from '../449/helpers.ts';

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (scripts/proof-change.mjs). */
export const CRITERIA = { 1: '#450.bb75390f', 2: '#450.28ba84de', 3: '#450.b4182e2c', 4: '#450.0ef4f21f', 5: '#450.1ac5b5e5' } as const;
/** A test title's prefix: `AC<n> #450.<id>`. */
export const ac = (n: keyof typeof CRITERIA): string => `AC${n} ${CRITERIA[n]}`;

/** The `deep-gpu --planted` name this suite adds (README: Planted programs). */
export type Planted = 'trail_appends_per_frame';
/** One `deep-gpu run` scenario (#449's runGpu), under this suite's planted name when given. */
export function run(bin: string, out: string, calls: JsonObject[], s: { backend?: 'noop'; planted?: Planted } = {}): JsonObject[] {
  return runGpu(bin, out, calls, s as unknown as Startup);
}

/** Largest difference on any axis (m). */
export const axisGap = (a: readonly number[], b: readonly number[]): number => Math.max(...[0, 1, 2].map((k) => Math.abs(a[k]! - b[k]!)));
const v3 = (v: JsonValue | undefined, what: string): V3 => {
  if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))) return v as V3;
  throw Error(`${what} is [x, y, z], got ${show(v)}`);
};

// ---------------------------------------------------------------------------------------------------
// Documents (README: Document fields)

/** A whole document as a session holds it (#378): an `id`, one writer layer, every item in it. */
export function sessionDoc(title: string, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const withIds: JsonObject = {};
  let order = 0;
  for (const [id, item] of Object.entries(items)) withIds[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id: `doc-450-${slug}`, profile: 'scene', title, description: `${title}: a #450 acceptance fixture.`, size: [320, 240], seed: 450,
    ...('cam' in items ? { camera: 'cam' } : {}),
    requires: { modules: { scene3d: '^1', effects: '^1' } },
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    ...extra,
    items: withIds,
  };
}
const sphere = (size: number, pos: V3, role: string, extra: JsonObject = {}): JsonObject =>
  ({ kind: 'mark.sphere@1', params: { size: [size, size, size], paint: { fill: { role } } }, at: { pos }, ...extra });
/** A `mark.line@1` that draws a trail (README: Document fields): no `points`, its `trail` names the source. */
export const trailLine = (trail: JsonObject, role = 'accent'): JsonObject => ({ kind: 'mark.line@1', params: { trail, paint: { fill: { role } } } });

/**
 * The rolling wheel (criteria 2, 4 and 5): a hub at height r rolls along +x without slipping, its `at/pos/0` keyed
 * linearly from 0 to r ω × 4 s and its `at/rot/2` from 0° to −720° over 4 s (ω = π rad/s, a right-handed turn about −z,
 * Units and axes), carrying a tire and the point `rim` at (0, −r, 0) in its frame. The rim point is then at
 * r(θ − sin θ, 1 − cos θ, 0) with θ = ω t. `trail` draws the rim's trail: a span window (criterion 2) or a whole one
 * baked at 60 Hz from 0 s (criterion 4), its span the transport's length so nothing is trimmed.
 */
export const WHEEL = { r: 0.5, omega: Math.PI, span: 4 } as const;
export const cycloid = (t: number): V3 => {
  const th = WHEEL.omega * t;
  return [WHEEL.r * (th - Math.sin(th)), WHEEL.r * (1 - Math.cos(th)), 0];
};
/** Criterion 2's span window: the last 0.5 s in 16 segments. */
export const SPAN = { span: 0.5, segments: 16 } as const;
export function wheelDoc(window: 'span' | 'whole'): JsonObject {
  const trail: JsonObject = window === 'span'
    ? { of: 'rim', span: SPAN.span, segments: SPAN.segments, width: 3 }
    : { of: 'rim', span: WHEEL.span, segments: 16, width: 3, window: { whole: { from: '0s' } }, rate: 60, max_points: 36000 };
  const end = WHEEL.span;
  return sessionDoc(`Rolling wheel ${window}`, {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [Math.PI, 0.9, 7], target: [Math.PI, 0.6, 0], fov: 45 } },
    floor: { kind: 'mark.box@1', params: { size: [8, 0.02, 2], paint: { fill: { role: 'floor' } } }, at: { pos: [Math.PI, -0.011, 0] } },
    hub: { kind: 'mark.box@1', params: { size: [0.12, 0.12, 0.12], paint: { fill: { role: 'block' } } }, at: { pos: [0, WHEEL.r, 0], rot: [0, 0, 0] } },
    tire: { kind: 'mark.cylinder@1', parent: 'hub', params: { size: [2 * WHEEL.r, 0.04, 2 * WHEEL.r], paint: { fill: { role: 'muted' } } }, at: { pos: [0, 0, -0.08], rot: [90, 0, 0] } },
    rim: sphere(0.08, [0, -WHEEL.r, 0], 'lamp', { parent: 'hub' }),
    trail: trailLine(trail),
  }, {
    transport: { span: `${end}s` },
    channels: {
      roll: { target: 'items/hub/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: `${end}s`, value: WHEEL.r * WHEEL.omega * end, interp: 'linear' } } },
      turn: { target: 'items/hub/at/rot/2', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: `${end}s`, value: -180 * end, interp: 'linear' } } },
    },
  });
}

/**
 * The thrown ball (criteria 3 and 5): a ball thrown at 10 m/s under 9.81 m/s² from each cue marker, at the cue's
 * launch angle (its payload's `angle`, degrees) from its payload's `x` (m), resting where it lands until the next cue;
 * each throw starts where the last one landed, so a trace's end and the next trace's start are one place. Drivers
 * write the ball's x and y from the occurrence reads `since(k)`, `last(k).angle` and `last(k).x` over
 * `{"list": "markers.cue"}`. The line `arcs` trails it with `window: since {on: markers.cue}` and the default keep.
 */
export const THROW = { v: 10, g: 9.81 } as const;
export interface Cue { t: number; angle: number }
export const THREE_CUES: readonly Cue[] = [{ t: 0, angle: 30 }, { t: 2, angle: 45 }, { t: 4, angle: 60 }];
export const FOURTH_CUE: Cue = { t: 6, angle: 75 };
const rad = (deg: number): number => (deg * Math.PI) / 180;
/** Where each throw starts along x: 0, then each start plus its throw's range v² sin 2θ ÷ g. */
export function throwStarts(cues: readonly Cue[]): number[] {
  const xs = [0];
  for (const c of cues.slice(0, -1)) xs.push(xs[xs.length - 1]! + THROW.v * Math.cos(rad(c.angle)) * ((2 * THROW.v * Math.sin(rad(c.angle))) / THROW.g));
  return xs;
}
export function throwDoc(cues: readonly Cue[], trail = true): JsonObject {
  const xs = throwStarts(cues);
  const markers: JsonObject = {};
  cues.forEach((c, i) => { markers[`throw${i + 1}`] = { kind: 'cue', t: `${c.t}s`, payload: { angle: c.angle, x: xs[i]! } }; });
  const flight = 'min(since(k), 20 * sin(rad(last(k).angle)) / 9.81)';
  const vars = { k: { list: 'markers.cue' } };
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [14, 3, 28], target: [14, 1.5, 0], fov: 50 } },
    floor: { kind: 'mark.box@1', params: { size: [36, 0.02, 4], paint: { fill: { role: 'floor' } } }, at: { pos: [14, -0.21, 0] } },
    ball: sphere(0.4, [0, 0, 0], 'lamp'),
  };
  if (trail) items['arcs'] = trailLine({ of: 'ball', span: 8, segments: 16, width: 3, window: { since: { on: { list: 'markers.cue' } } } });
  // The same title (and so ID) with or without the trail, so the two documents differ by the line alone.
  return sessionDoc(`Thrown ball ${cues.length} cues`, items, {
    transport: { span: '8s' },
    markers,
    drivers: {
      throw_x: { target: 'items/ball/at/pos/0', expr: `last(k).x + 10 * cos(rad(last(k).angle)) * ${flight}`, vars, fallback: 0 },
      throw_y: { target: 'items/ball/at/pos/1', expr: `10 * sin(rad(last(k).angle)) * ${flight} - 4.905 * ${flight} * ${flight}`, vars, fallback: 0 },
    },
  });
}

// ---------------------------------------------------------------------------------------------------
// view3d with this suite's `trails` field (and #449's `particles`, `particle_cull`)

export interface View3Spec {
  doc: string; size?: [number, number]; fps?: number; from?: number; frames?: number;
  trails?: string[]; particles?: string[]; particle_cull?: 'none'; capture?: 'every' | number[]; targets?: 'final'[];
}
export const view3d = (c: View3Spec): JsonObject => ({ call: 'view3d', look: look(), size: [320, 240], ...(c as unknown as JsonObject) });

/** One trace a frame draws: its start and end (whole flicks) and its polyline, oldest first (world m). */
export interface Trace { start: number; end: number; points: V3[] }
export interface TrailReport { hash: string; source: V3; traces: Trace[] }
export interface TrailFrame { frame: number; pixelHash: string | null; final: string | null; trails: Map<string, TrailReport> }
export function trailFrames(reply: JsonObject, what: string, ids: readonly string[]): TrailFrame[] {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was drawn, not refused: ${show(reply)}`).toBeUndefined();
  return arr(reply['frames'], `${what}: frames`).map((v, i) => {
    const f = obj(v, `${what}: frames[${i}]`);
    const at = `${what}: frame ${String(f['frame'])}`;
    const trails = new Map<string, TrailReport>();
    const t = obj(f['trails'], `${at}: trails (README: view3d's trails field)`);
    for (const id of ids) {
      const q = obj(t[id], `${at}: trails.${id}`);
      expect(q['hash'], `${at}: trails.${id}.hash is a SHA-256`).toMatch(SHA);
      trails.set(id, {
        hash: q['hash'] as string,
        source: v3(q['source'], `${at}: trails.${id}.source`),
        traces: arr(q['traces'], `${at}: trails.${id}.traces`).map((x, k) => {
          const tr = obj(x, `${at}: trails.${id}.traces[${k}]`);
          return {
            start: num(tr['start'], `${at}: trails.${id}.traces[${k}].start`), end: num(tr['end'], `${at}: trails.${id}.traces[${k}].end`),
            points: arr(tr['points'], `${at}: trails.${id}.traces[${k}].points`).map((p, j) => v3(p, `${at}: trails.${id}.traces[${k}].points[${j}]`)),
          };
        }),
      });
    }
    return { frame: num(f['frame'], `${what}: frames[${i}].frame`), pixelHash: typeof f['pixel_hash'] === 'string' ? f['pixel_hash'] : null, final: typeof f['final'] === 'string' ? f['final'] : null, trails };
  });
}
/** A trail's report at a frame (the one named `id`). */
export const trailAt = (f: TrailFrame, id: string): TrailReport => f.trails.get(id)!;

/** The trail hash (README: view3d's trails): SHA-256 over each trace, its point count as u32 LE then x, y, z as f64 LE. */
export function trailHash(traces: readonly Trace[]): string {
  const out = Buffer.alloc(traces.reduce((n, t) => n + 4 + 24 * t.points.length, 0));
  let o = 0;
  for (const t of traces) {
    out.writeUInt32LE(t.points.length, o); o += 4;
    for (const p of t.points) for (const x of p) { out.writeDoubleLE(x, o); o += 8; }
  }
  return sha256(out);
}

/**
 * The ribbon hash (README: view3d's particles, for `draw: ribbon`): SHA-256 over the rows in order, a live row as the
 * byte 1 then its ribbon's points j = 0 to segments as x, y, z f64 LE, a row with no live particle as the byte 0.
 */
export function ribbonHash(rows: readonly (readonly V3[] | null)[]): string {
  const out = Buffer.alloc(rows.reduce((n, r) => n + (r === null ? 1 : 1 + 24 * r.length), 0));
  let o = 0;
  for (const r of rows) {
    if (r === null) { out[o++] = 0; continue; }
    out[o++] = 1;
    for (const p of r) for (const x of p) { out.writeDoubleLE(x, o); o += 8; }
  }
  return sha256(out);
}

// ---------------------------------------------------------------------------------------------------
// The `trail` call (README: The surface under test)

export interface Bake { window: string; samples: { t: number; at: V3 }[] | null }
/** A `trail` reply whose check passed: outcome checked, no error issue; each trail's window and its whole bake. */
export function bakesOf(reply: JsonObject, what: string): Map<string, Bake> {
  expect(reply['code'], `${what}: the trail call answers (README: The surface under test) rather than refusing the call: ${show(reply)}`).toBeUndefined();
  expect(reply['outcome'], `${what}: the check passes, got ${show(reply)}`).toBe('checked');
  const errors = arr(reply['issues'] ?? [], `${what}: issues`).filter((i) => isObject(i) && i['severity'] === 'error');
  expect(errors, `${what}: no error issue`).toEqual([]);
  const out = new Map<string, Bake>();
  for (const [id, v] of Object.entries(obj(reply['trails'], `${what}: trails`))) {
    const b = obj(v, `${what}: trails.${id}`);
    const samples = b['samples'];
    out.set(id, {
      window: str(b['window'], `${what}: trails.${id}.window`),
      samples: samples === null ? null : arr(samples, `${what}: trails.${id}.samples`).map((s, k) => {
        const q = obj(s, `${what}: trails.${id}.samples[${k}]`);
        return { t: num(q['t'], `${what}: trails.${id}.samples[${k}].t`), at: v3(q['at'], `${what}: trails.${id}.samples[${k}].at`) };
      }),
    });
  }
  return out;
}
/** One second's flicks over 60: a 60 Hz sample's step, 11,760,000 flicks. */
export const STEP_60 = FLICKS / 60;
