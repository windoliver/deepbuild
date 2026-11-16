// Test-side tools for the #463 acceptance tests (README: The surface under test). They reuse #449's suite helpers for
// building `deep-gpu`, one `deep-gpu run` scenario, the GPU guard and failures as sentences, and add this suite's
// criterion IDs and planted names, the twelve art@1 look IDs, the shared test scene, the calls that draw it in a look,
// the golden store, the reference Mac and the perf lane's judge. Nothing here stands in for the looks, the renderer or
// the golden check.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { REPO, arr, obj, runGpu, show, str, type JsonObject, type JsonValue, type Startup } from '../449/helpers.ts';

export {
  REPO, SHA, TIMEOUT, arr, failsNaming, inconclusive, none, num, obj, requireGpu, sha256, show, str, useBins, useDir, writeJson,
  type JsonObject, type JsonValue,
} from '../449/helpers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (scripts/proof-change.mjs). */
const CRITERIA = { 1: '#463.d6ee1ca5', 2: '#463.7c8d3f4b', 3: '#463.fee183bf' } as const;
/** A test title's prefix: `AC<n> #463.<id>`. */
export const ac = (n: keyof typeof CRITERIA): string => `AC${n} ${CRITERIA[n]}`;

/** art@1's looks, in the issue's order (Fields: `looks`). */
export const LOOKS = [
  'art.flow_brush', 'art.dab', 'art.dot', 'art.wash', 'art.ink_wash', 'art.halftone_pop',
  'art.neon_tape', 'art.cel_light', 'art.chiaroscuro', 'art.cut_paper', 'art.mosaic', 'art.gold_leaf',
] as const;
export type Look = (typeof LOOKS)[number];
export const DIMS = ['2d', '3d'] as const;
export type Dim = (typeof DIMS)[number];

/** The pack's folder, as first-party packs ship (`packs/<name>-<version>/pack.json`), and how a call installs it. */
export const ART_DIR = join(REPO, 'packs', 'art-1.0.0');
export const PACKS: JsonObject[] = [{ id: 'deepbuild/art', dir: ART_DIR }];
/** The look IDs the pack's `pack.json` lists: the keys of its `looks` object (README: The pack). */
export function packLooks(): string[] {
  let manifest: JsonValue;
  try { manifest = JSON.parse(readFileSync(join(ART_DIR, 'pack.json'), 'utf8')) as JsonValue; } catch (e) { return expect.fail(`packs/art-1.0.0/pack.json can't be read: ${(e as Error).message}`); }
  const m = obj(manifest, 'packs/art-1.0.0/pack.json');
  expect(m['name'], 'packs/art-1.0.0/pack.json: name').toBe('art');
  return Object.keys(obj(m['looks'], 'packs/art-1.0.0/pack.json: looks, an object keyed by look ID')).sort();
}

/** `deep-gpu --planted` names (README: Planted programs). `draws_black` is #149's. */
export type Planted = 'draws_black' | 'halftone_pop_takes_dot_passes';
export const run = (bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] =>
  runGpu(bin, out, calls, (planted ? { planted } : {}) as unknown as Startup);

// ---------------------------------------------------------------------------------------------------
// The shared test scene (fixtures/scene.json): one subject, a 2D film and a 3D scene, 1920 × 1080, 12 s

export const SCENE_REL = 'tests/acceptance/463/fixtures/scene.json';
export const REGION_REL = 'tests/acceptance/463/fixtures/scene-region.json';
export const SIZE: [number, number] = [1920, 1080];
export const FPS = 30;
/** The frame every look is judged and shown at: 1 s in. */
export const FRAME = 30;
const fixture = (rel: string): JsonObject => obj(JSON.parse(readFileSync(join(REPO, rel), 'utf8')) as JsonValue, rel);
export const scene = (): JsonObject => fixture(SCENE_REL);

/** The call that draws the scene's `dim` side in `look` at frame `n`, its final PNG captured: `film2d` for 2D, `view3d` for 3D (a path to the document). */
export function drawCall(dim: Dim, doc: JsonObject | string, look: string, n = FRAME): JsonObject {
  const common = { look, packs: PACKS, fps: FPS, from: n, frames: 1, capture: [n] } as JsonObject;
  return dim === '2d'
    ? { call: 'film2d', doc, hash: true, ...common }
    : { call: 'view3d', doc, size: SIZE, targets: ['final'], ...common };
}

export interface Drawn { frame: number; final: string; pixelHash: string; reply: JsonObject }
/** A reply's frame `n`: drawn, not refused, with its final PNG named by SHA-256 and its pixel hash. */
export function drawnFrame(reply: JsonObject, n: number, what: string): Drawn {
  expect(reply['code'], `${what} was drawn, not refused: ${show(reply)}`).toBeUndefined();
  const row = arr(reply['frames'], `${what}: frames`).map((f, i) => obj(f, `${what}: frames[${i}]`)).find((f) => f['frame'] === n);
  expect(row, `${what}: frame ${n} is in the reply: ${show(reply)}`).toBeDefined();
  return { frame: n, final: str(row!['final'], `${what}: frame ${n}'s final PNG`), pixelHash: str(row!['pixel_hash'], `${what}: frame ${n}'s pixel_hash`), reply };
}

// ---------------------------------------------------------------------------------------------------
// Goldens (README: The goldens): `golden` with `oracle: "pixel_hash"`, the blank guard first

export const GOLDENS = join(HERE, 'goldens');
export const goldenName = (look: string, dim: Dim): string => `${look}.${dim}`;
export const goldenCall = (look: string, dim: Dim, png: string): JsonObject =>
  ({ call: 'golden', store: GOLDENS, fixture: goldenName(look, dim), png, oracle: 'pixel_hash' });
export interface Verdict { look: string; dim: Dim; verdict: string; reason: string; pixels: string | null; fingerprint: JsonValue; raw: JsonObject }
export function verdictOf(reply: JsonObject, look: string, dim: Dim): Verdict {
  const numbers = reply['numbers'];
  const pixels = typeof numbers === 'object' && numbers !== null && !Array.isArray(numbers) ? numbers['pixels'] : null;
  return {
    look, dim, verdict: str(reply['verdict'], `golden for ${look} ${dim}: verdict (${show(reply)})`),
    reason: typeof reply['reason'] === 'string' ? reply['reason'] : '', pixels: typeof pixels === 'string' ? pixels : null,
    fingerprint: reply['fingerprint'] ?? null, raw: reply,
  };
}
export const label = (v: { look: string; dim: Dim }): string => `look ${v.look} ${v.dim}`;

// ---------------------------------------------------------------------------------------------------
// The reference Mac and the perf lane (scripts/benchmark.mjs, imported, never copied)

/** The perf lane's reference Macs (scripts/benchmark.mjs). */
export const REFERENCE_MODELS = ['Mac15,7', 'Mac15,12', 'Mac17,10'] as const;
export function onReferenceMac(): boolean {
  if (process.platform !== 'darwin') return false;
  try { return (REFERENCE_MODELS as readonly string[]).includes(execFileSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8' }).trim()); } catch { return false; }
}
export const load = (): number => loadavg()[0]!;
export const cores = (): number => availableParallelism();
export interface Judged { status: string; reason?: string }
/** scripts/benchmark.mjs's judgeLimit on five runs: PASS, FAIL, or INCONCLUSIVE off a reference Mac, on battery or under load. */
export async function judgeLimit(limit: number, runs: number[], fingerprint: JsonValue, loads: { start: number; end: number }[]): Promise<Judged> {
  const bench = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { judgeLimit: (o: unknown) => Judged };
  return bench.judgeLimit({ limit, runs, fingerprint, loads });
}
export const p95 = (xs: readonly number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!; };
