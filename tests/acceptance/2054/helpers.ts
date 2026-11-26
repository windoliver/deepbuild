// Test-side tools for the #2054 acceptance tests. The engine's light words go through `deep-show run` (#433's suite's
// binary, scenario and readers, imported from ../433/helpers.ts), and AC2's squares are drawn by `deep-gpu`'s view3d
// and read on its linear target (#1634's suite's builder, runner and readers, imported from ../1634/helpers.ts). This
// file holds the criteria's IDs, the surface the issue leaves open (one block, README: The surface), the fixture, and
// the three judges: a light's expanded `range` (AC1), the squares' linear radiance (AC2) and the refusals (AC3).
// Nothing here stands in for the pack, the check or the renderer: every value judged comes from a binary.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import {
  REPO, arr, derivedOf, isObject, obj, oneOfKind, paramOf, runShow, scenario, sceneDoc, show, shown,
  type Derived, type JsonObject, type JsonValue, type Pack,
} from '../433/helpers.ts';
import {
  DARK_SKY, cameraOf, frameAt, framesOf, inconclusive, look, matte, offReferenceMac, requireMetal, runGpu, sessionDoc,
  view3dCall, within, writeJson, type Planted as Planted1634, type Size,
} from '../1634/helpers.ts';
import { EV_TODAY, autoRange, project, type Pinhole, type V3 } from '../1634/reference.ts';

export type { JsonObject, JsonValue };

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed
 * (scripts/proof-change.mjs: criterionId), recomputed from the live issue. */
export const AC = {
  1: 'AC1 #2054.46de3b6b',
  2: 'AC2 #2054.e44715ba',
  3: 'AC3 #2054.b0129c45',
} as const;

/** Each test builds or spawns a binary; none has a time budget. */
export const SLOW = 3_600_000;

// ===================================================================================================
// The surface #2054 leaves open (README: The surface). Every name below is this job's choice; each is used from here.

/** The pack's next minor: a new folder beside packs/godot-1.0.0, which #433's suite keeps reading. */
export const PACK_NEXT: Pack = { id: 'deepbuild/godot', version: '1.1.0', dir: join(REPO, 'packs', 'godot-1.1.0') };

/** `deep-show run`'s scenario `planted` values: twins of the pack's manifest, applied at install as #433's are. */
export type ShowPlanted = 'range_word_dropped' | 'falloff_one_drawn';
/** `deep-gpu run --planted` values: wrong programs in the renderer. */
export type GpuPlanted = 'light_window_squared';

/** AC2's view: a pinhole at the lamp itself, looking down −Z, 90° across the wider side, so each square's face is seen
 * square on at the point nearest the lamp. Drawn at 640 × 360 in a look with no tone map at the exposure whose cut is
 * 0.05 lx (EV100 5.7635), where our automatic range for 800 lm is 35.68 m. */
export const VIEW_SIZE: Size = [640, 360];
export const viewFrom = (eye: V3): Pinhole => ({ position: eye, target: [eye[0], eye[1], eye[2] - 1], fov: 90, size: VIEW_SIZE, near: 0.05 });
export const VIEW_LOOK: JsonObject = look('none', EV_TODAY);
/** A square's slab: this thick (m), its face toward the lamp at the square's distance. */
export const SLAB = 0.02;
/** A square's reading: the mean linear radiance (R, G and B) over the 3 × 3 pixels about the pixel its nearest point
 * to the lamp lands in, each of which the object-ID target must show as the square. */
export const READ_RADIUS = 1;

// ===================================================================================================
// The fixture

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE = obj(JSON.parse(readFileSync(join(HERE, 'fixtures', 'light-range.json'), 'utf8')) as JsonValue, 'fixtures/light-range.json');

/** One light word as the fixture writes it. */
export interface Word { id: string; recipe: string; params: JsonObject; word: string }
export const wordOf = (v: JsonValue | undefined, what: string): Word => {
  const o = obj(v, what);
  return { id: String(o['id']), recipe: String(o['recipe']), params: obj(o['params'], `${what}.params`), word: String(o['word'] ?? '') };
};
/** How a case writes its word: "written as 8", or "unwritten". */
export const writes = (w: Word): string => (w.params[w.word] === undefined ? `${w.word} unwritten` : `${w.word} written as ${JSON.stringify(w.params[w.word])}`);

/** Our automatic range for `power` lm at the view's exposure (#1634's reference: √(power ÷ (4π × cut))). */
export const automatic = (power: number): number => autoRange(power, EV_TODAY);

// ===================================================================================================
// `deep-show run`: the pack's next minor installed, one document per call, an optional twin

/** The pack folder this suite names; the base has none (BASE-FAILURE.txt). */
export function packProblems(): string[] {
  return existsSync(join(PACK_NEXT.dir, 'pack.json')) ? [] : [`the pack's next minor, ${PACK_NEXT.id}@${PACK_NEXT.version}, has no packs/godot-${PACK_NEXT.version}/pack.json`];
}

/** Each document in `docs` (title → instances) shown in a revision of its own, through one `deep-show run` with the
 * pack's next minor installed and `planted` when given; the replies in order. */
export function showDocs(bin: string, evidence: string, docs: [string, Word[]][], planted?: ShowPlanted): JsonObject[] {
  const ids = docs.map((_, i) => `01JB2054D${String(i + 1).padStart(17, '0')}`);
  const calls = docs.map(([title, words], i) => {
    const items: Record<string, JsonObject> = {};
    for (const w of words) items[w.id] = { kind: w.recipe, params: w.params };
    return show(ids[i]!, sceneDoc(title, items, [PACK_NEXT]));
  });
  const sc = scenario(evidence, ids, calls, [PACK_NEXT]);
  if (planted) sc['planted'] = planted;
  return runShow(bin, sc);
}

export interface Entry { code: string; path: string; fix: string; raw: JsonObject }
function entries(reply: JsonObject, key: 'issues' | 'notices'): Entry[] {
  return arr(reply[key] ?? [], key).map((v, i) => {
    const o = obj(v, `${key}[${i}]`);
    return { code: String(o['code']), path: typeof o['path'] === 'string' ? o['path'] : '', fix: typeof o['fix'] === 'string' ? o['fix'] : '', raw: o };
  });
}
/** Why a revision isn't presented with its instances expanded, or nothing. */
export function presentedProblems(reply: JsonObject, what: string): string[] {
  if (reply['outcome'] === 'presented') return [];
  return [`${what}: the revision is ${String(reply['outcome'])}, not presented; its issues were ${shown(entries(reply, 'issues').map((e) => e.raw))}`];
}

// ===================================================================================================
// AC1: a light's expanded `range`, read from the expanded item as #433's suite reads `power`

/** The derived light `w` expanded to, and its `range` in m (undefined when it names none: our automatic range). */
export function rangeOf(reply: JsonObject, w: Word, kind: string): { found?: Derived; range?: number | undefined; problem?: string } {
  const { found, problem } = oneOfKind(reply, w.id, kind);
  if (!found) return { problem: `${problem!} (${writes(w)})` };
  const r = paramOf(found, 'range');
  return { found, range: typeof r === 'number' && Number.isFinite(r) ? r : undefined };
}

/** One AC1 case against what it expanded to: its light's `range` within the tolerance. Each failure names the case's
 * word. */
export function rangeProblems(reply: JsonObject, c: JsonObject, tolerance: number): string[] {
  const w = wordOf(c, `ac1 case ${String(c['id'])}`);
  const want = c['range'] as number;
  const { range, problem } = rangeOf(reply, w, String(c['kind']));
  if (problem) return [problem];
  if (range === undefined) {
    return [`${w.id}: ${writes(w)}: its ${String(c['kind'])} names no range, so it takes our automatic range (${automatic(800).toFixed(2)} m at 800 lm), not ${want} m`];
  }
  return Math.abs(range - want) <= tolerance ? [] : [`${w.id}: ${writes(w)}: its ${String(c['kind'])} has range ${range} m, not ${want} m`];
}

// ===================================================================================================
// AC2: three squares lit by the expanded lamp, read on the linear target

export interface Square { id: string; distance: number; azimuth: number; side: number }
export const squaresOf = (v: JsonValue | undefined): Square[] => arr(v, 'ac2.squares').map((s, i) => {
  const o = obj(s, `ac2.squares[${i}]`);
  return { id: String(o['id']), distance: o['distance'] as number, azimuth: o['azimuth'] as number, side: o['side'] as number };
});
const along = (azimuth: number): V3 => [Math.sin((azimuth * Math.PI) / 180), 0, -Math.cos((azimuth * Math.PI) / 180)];
const at = (from: V3, dir: V3, d: number): V3 => [from[0] + dir[0] * d, from[1] + dir[1] * d, from[2] + dir[2] * d];
/** The point of square `s` nearest the lamp at `lamp`: where its face meets the line from the lamp. */
export const nearest = (lamp: V3, s: Square): V3 => at(lamp, along(s.azimuth), s.distance);
/** Square `s` as a white slab `SLAB` thick, its face toward the lamp `distance` from it and square to the line from
 * it (turned −azimuth about +Y, R = Rz·Ry·Rx), in material `mat`. */
export const slab = (lamp: V3, s: Square, mat: string): JsonObject =>
  ({ kind: 'mark.box@1', params: { size: [s.side, s.side, SLAB] }, at: { pos: at(lamp, along(s.azimuth), s.distance + SLAB / 2), rot: [0, -s.azimuth, 0] }, material: mat });

/** What the squares read: each square's linear radiance, the 4 m square's share of the 2 m square's, and the failures,
 * each naming its square (or the lamp, when it never got drawn). */
export interface Squares { failures: string[]; reads: Map<string, number>; share: number }

/** The issue's "Runs on": frame readings count on a reference Mac; anywhere else this is INCONCLUSIVE, never a pass. */
export function onReferenceMac(): void {
  requireMetal();
  const why = offReferenceMac();
  if (why) inconclusive(`the squares' readings count on a reference Mac (issue #2054: Runs on); ${why}`);
}

/**
 * AC2's reading: `deep-show run` expands the fixture's lamp word through the pack's next minor (under `planted`, a
 * twin of it), and `deep-gpu`'s view3d (under `gpuPlanted`, a wrong renderer) draws the light it expanded to, as
 * expanded, before three white matte squares, under a black sky with no ambient light and no other light; each
 * square is read on the linear target, before exposure and the tone map.
 */
export function readSquares(show: string, gpu: string, dir: string, o: { planted?: ShowPlanted; gpuPlanted?: GpuPlanted } = {}): Squares {
  const lampWord = wordOf(obj(FIXTURE['ac2'], 'ac2')['lamp'], 'ac2.lamp');
  const showDir = join(dir, 'show');
  mkdirSync(showDir);
  const [reply] = showDocs(show, showDir, [['Three squares: the lamp', [lampWord]]], o.planted);
  const failures = [...packProblems(), ...presentedProblems(reply!, 'the lamp\'s revision')];
  const { found, problem } = oneOfKind(reply!, lampWord.id, 'light.point@1');
  if (!found) return { failures: [...failures, `${problem!}; no square can be read`], reads: new Map(), share: NaN };
  const light: JsonObject = { kind: found.kind, params: found.item['params'] ?? {} };
  if (found.item['at'] !== undefined) light['at'] = found.item['at'];
  const drawn = drawSquares(gpu, dir, light, o.gpuPlanted);
  return { ...drawn, failures: [...failures, ...drawn.failures] };
}

/** `light` (a light item: kind, params, at) drawn before the fixture's squares by `deep-gpu`'s view3d (README: The
 * surface 4), and each square read and judged. */
export function drawSquares(gpu: string, dir: string, light: JsonObject, gpuPlanted?: GpuPlanted): Squares {
  const ac2 = obj(FIXTURE['ac2'], 'ac2');
  const lampWord = wordOf(ac2['lamp'], 'ac2.lamp');
  const squares = squaresOf(ac2['squares']);
  const share = obj(ac2['share'], 'ac2.share');
  const reads = new Map<string, number>();
  const out = { failures: [] as string[], reads, share: NaN };
  const gpuDir = join(dir, 'gpu');
  mkdirSync(gpuDir);
  const lamp = (lampWord.params['position'] as V3) ?? [0, 0, 0];
  const items: Record<string, JsonObject> = { cam: cameraOf(viewFrom(lamp)), sky: DARK_SKY, white: matte(ac2['albedo'] as number), lamp: light };
  for (const s of squares) items[s.id] = slab(lamp, s, 'white');
  const doc = writeJson(gpuDir, 'squares', sessionDoc('squares-2054', VIEW_SIZE, 'work_product', items));
  const [drawn] = runGpu(gpu, gpuDir, [view3dCall({ doc, look: VIEW_LOOK, size: VIEW_SIZE, targets: ['linear', 'ids'] })],
    gpuPlanted ? { planted: gpuPlanted as unknown as Planted1634 } : {});
  const f = frameAt(framesOf(gpuDir, drawn!, VIEW_SIZE, 'the squares'), 0, 'the squares');
  expect(f.linear && f.ids, 'the frame holds its linear and object-ID targets').toBeTruthy();
  const view = viewFrom(lamp);
  for (const s of squares) {
    const [px, py] = project(view, nearest(lamp, s));
    const [x, y] = [Math.floor(px), Math.floor(py)];
    if (!within(f.ids!, s.id, x, y, READ_RADIUS)) {
      out.failures.push(`${s.id}: the pixels about (${x}, ${y}), where its point nearest the lamp lands, show ${String(f.ids!.at(x, y))}, not ${s.id}`);
      continue;
    }
    let sum = 0; let n = 0;
    for (let dy = -READ_RADIUS; dy <= READ_RADIUS; dy++) for (let dx = -READ_RADIUS; dx <= READ_RADIUS; dx++) {
      const c = f.linear!.at(x + dx, y + dy); sum += (c[0] + c[1] + c[2]) / 3; n++;
    }
    reads.set(s.id, sum / n);
  }
  const [near, mid, far] = squares;
  const r2 = reads.get(near!.id); const r4 = reads.get(mid!.id); const r6 = reads.get(far!.id);
  if (r2 !== undefined && !(r2 > 0)) out.failures.push(`${near!.id}: reads ${r2} at ${near!.distance} m, unlit, so no share can be read`);
  if (r2 !== undefined && r2 > 0 && r4 !== undefined) {
    out.share = r4 / r2;
    const want = share['want'] as number; const within_ = share['within'] as number;
    if (!(Math.abs(out.share - want) <= within_)) {
      out.failures.push(`${mid!.id}: at ${mid!.distance} m it reads ${pct(out.share)}% of ${near!.id}'s linear radiance (${r4.toFixed(5)} of ${r2.toFixed(5)}), not ${pct(want, 2)}% within ${pct(within_, 1)} points`);
    }
  }
  const dark = ac2['dark'] as number;
  if (r6 !== undefined && !(Math.abs(r6) <= dark)) {
    out.failures.push(`${far!.id}: at ${far!.distance} m, past the lamp's 5 m range, it reads ${r6.toFixed(5)} from the light, not 0`);
  }
  return out;
}
/** A share as a percentage with `digits` decimals. */
export const pct = (share: number, digits = 1): string => (share * 100).toFixed(digits);

// ===================================================================================================
// AC3: the falloff exponent's refusals

/** `fix` names `n`: the number as a word of its own (2, or 2.0), not a digit of another number. */
export const fixNames = (fix: string, n: string): boolean => new RegExp(`(^|[^0-9.])${n.replace('.', '\\.')}(\\.0+)?(?!\\.?[0-9])`).test(fix);

/** A refused case against its revision: an issue at `items/<id>/params/<word>` (whose `fix` names `fixNames` when the
 * case gives it), and nothing drawn for the instance. Each failure names the case's word. */
export function refusedProblems(reply: JsonObject, c: JsonObject): string[] {
  const w = wordOf(c, `ac3 refused ${String(c['id'])}`);
  const path = `items/${w.id}/params/${w.word}`;
  const issues = entries(reply, 'issues');
  const at = issues.filter((e) => e.path === path || e.path.startsWith(`${path}/`));
  const out: string[] = [];
  const names = c['fixNames'];
  if (at.length === 0) {
    out.push(`${w.id}: ${writes(w)}: the revision holds no issue at ${path}; its issues were ${shown(issues.map((e) => e.raw))}`);
  } else if (typeof names === 'string' && !at.some((e) => fixNames(e.fix, names))) {
    out.push(`${w.id}: ${writes(w)}: the issue at ${path} has fix ${JSON.stringify(at.map((e) => e.fix))}, which doesn't name ${names}`);
  }
  const drawn = derivedOf(reply, w.id);
  if (reply['outcome'] === 'presented' && drawn.length > 0) {
    out.push(`${w.id}: ${writes(w)}: refused, yet drawn as ${drawn.map((d) => `${d.id} ${d.kind}`).join(', ')}`);
  }
  return out;
}

/** What `instance` expanded to, as text that two instances' expansions compare by: every derived item whole, with its
 * ID, the instance's own ID written `<instance>` wherever a string is it or starts with it and a dot, keys in sorted
 * order. A derived item also carries its instance's own `order` (and layer), so two instances compare only when each
 * stands alone in a revision of its own, where both hold the same position; everything else is compared as is. */
export function expansionText(reply: JsonObject, instance: string): string {
  const swap = (v: JsonValue): JsonValue => {
    if (typeof v === 'string') return v === instance || v.startsWith(`${instance}.`) ? `<instance>${v.slice(instance.length)}` : v;
    if (Array.isArray(v)) return v.map(swap);
    if (isObject(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, swap(v[k]!)]));
    return v;
  };
  return JSON.stringify(derivedOf(reply, instance).map((d) => swap({ ...d.item, id: d.id })));
}

/** A pair of AC3 as its two words: the falloff exponent written as 2 (`written`) and unwritten (`unwritten`). */
export const pairOf = (pair: JsonObject): [Word, Word] =>
  (['written', 'unwritten'] as const).map((k) => wordOf({ ...obj(pair[k], `ac3 pair ${k}`), word: pair['word']! }, `ac3 pair ${k}`)) as [Word, Word];

/** A pair of AC3 against its two revisions, each holding its word alone (so both instances stand at the same position):
 * each presented, expanding to one light of `kind`, and to the same items. Each failure names the pair's word. */
export function sameProblems(written: JsonObject, unwritten: JsonObject, pair: JsonObject): string[] {
  const kind = String(pair['kind']);
  const [a, b] = pairOf(pair);
  const out: string[] = [];
  for (const [w, reply] of [[a, written], [b, unwritten]] as const) {
    out.push(...presentedProblems(reply, `${w.id}'s revision (${writes(w)})`));
    const { problem } = oneOfKind(reply, w.id, kind);
    if (problem) out.push(`${problem} (${writes(w)})`);
  }
  if (out.length > 0) return out;
  const [ta, tb] = [expansionText(written, a.id), expansionText(unwritten, b.id)];
  return ta === tb ? [] : [`${a.id}: ${writes(a)} expands to ${ta.slice(0, 700)}, not the same item as ${b.id} with ${b.word} unwritten: ${tb.slice(0, 700)}`];
}
