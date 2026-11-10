// AC1: a 10,000 × 10,000 PNG of 1 KB in image@1 is refused `over_budget`, naming `items/<id>/params/asset`, with peak
// resident memory up under 10 MB. A planted path that decodes first passes 400 MB and fails.
//
// Through `deep-canvas-render raster` (Vello CPU, every platform: "Any machine for caps"), and on macOS also `render`
// (GPUI, the marks path). Two files declare 10,000 × 10,000 in their header (400,000,000 B of RGBA, past the 64 MiB a
// document may hold): `kilobyte`, 1,049 B, whose image data stops after 800 rows, and `whole`, about 12 KB, every row
// there at one bit a pixel, the smallest PNG that decodes whole at that size (README: Readings). "Peak resident memory
// up" is the OS's maximum resident set size of a fresh `raster` process answering the request, less that of a fresh
// process answering the same request with a 100 × 100 PNG in its place, which draws (README: Readings).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LOOK, RENDER_BUILD, blackBits, board, flatPng, mb, measured, one, put, scratch, short, skipUnsupported, useBuild,
  type JsonObject, type Measured,
} from './helpers.ts';

const bin = useBuild(RENDER_BUILD, 'deep-canvas-render', 'debug');
const dir = scratch('header');

const ITEM = 'photo';
const PATH = `items/${ITEM}/params/asset`;
const SIDE = 10_000;
/** "Up under 10 MB", as bytes. */
const ALLOWED = 10_000_000;
/** "Passes 400 MB": the decoded RGBA alone is 400,000,000 B; 5% is left for the two processes' own differences. */
const PLANTED_PEAK = 380_000_000;

const whole = blackBits(SIDE, SIDE);
const kilobyte = blackBits(SIDE, SIDE, 800);
const small = flatPng(100, 100, [200, 120, 40]);
const WHOLE = put(dir, whole);
const KILOBYTE = put(dir, kilobyte);
const SMALL = put(dir, small);

const request = (asset: string, planted?: string): JsonObject => ({
  out: join(dir, `${asset.slice(0, 12)}-${planted ?? 'honest'}.png`),
  doc: board([64, 64], [{ id: ITEM, asset, box: [8, 8, 48, 48] }]),
  look: LOOK, store: dir, ...(planted ? { planted } : {}),
});

/** Null when `answer` is AC1's refusal: `over_budget`, naming the item's asset field; else what it answered. */
function refusalFailure(answer: JsonObject): string | null {
  const wrong: string[] = [];
  if (answer['ok'] !== false || answer['code'] !== 'over_budget') wrong.push(`it answered ${short(answer, 400)}, not a refusal with code over_budget`);
  else if (!String(answer['path'] ?? '').startsWith(PATH)) wrong.push(`its refusal's path is ${short(answer['path'])}, which doesn't name ${PATH}`);
  return wrong.length ? wrong.join('; ') : null;
}

interface Reading { big: Measured; base: Measured; up: number | null }

/** The whole file's request and the 100 × 100 baseline, each answered by a fresh process under the OS's reading. */
function reading(planted?: string): Reading {
  const base = measured(bin(), 'raster', request(SMALL));
  expect(base.answer['ok'], `the baseline, the same document with a 100 × 100 PNG, draws: ${short(base.answer, 1000)}`).toBe(true);
  const big = measured(bin(), 'raster', request(WHOLE, planted));
  const up = big.peak !== null && base.peak !== null ? big.peak - base.peak : null;
  console.log(`AC1 raster${planted ? ` planted ${planted}` : ''}: peak resident ${big.peak ?? '?'} B with the 10,000 × 10,000 PNG, ${base.peak ?? '?'} B with the 100 × 100 one: up ${up === null ? '?' : `${mb(up)} MB`}; answered ${short(big.answer, 300)}`);
  return { big, base, up };
}

/** Null when the reading is AC1's: the refusal, and peak resident memory up under 10 MB; else every way it isn't. */
function failure(r: Reading): string | null {
  const wrong = [refusalFailure(r.big.answer)].filter((w): w is string => w !== null);
  if (r.up !== null && r.up >= ALLOWED) wrong.push(`peak resident memory rose ${mb(r.up)} MB over the baseline's (${r.big.peak} B against ${r.base.peak} B), not under 10 MB`);
  return wrong.length ? wrong.join('; ') : null;
}

describe('AC1 a 10,000 × 10,000 PNG of 1 KB in image@1 is refused over_budget, naming items/<id>/params/asset, peak resident memory up under 10 MB', () => {
  it('AC1 refused over_budget from its header, naming the field, by Vello CPU and GPUI, with peak resident memory up under 10 MB', (ctx) => {
    expect(kilobyte.length, 'the 1 KB file is about 1 KB').toBeLessThan(1_100);
    const found: Record<string, string | null> = {};
    found['raster, the 1 KB PNG whose header says 10,000 × 10,000'] = refusalFailure(one(bin(), 'raster', request(KILOBYTE)));
    const r = reading();
    found['raster, the 10,000 × 10,000 PNG that decodes whole'] = failure(r);
    if (process.platform === 'darwin') {
      const gpui = one(bin(), 'render', request(WHOLE));
      skipUnsupported(ctx, gpui, 'render');
      found['render (GPUI), the 10,000 × 10,000 PNG that decodes whole'] = refusalFailure(gpui);
    }
    expect(Object.entries(found).filter(([, f]) => f !== null), 'every path refuses by header, within 10 MB').toEqual([]);
    if (r.up === null) ctx.skip(`INCONCLUSIVE: the refusal holds, but peak resident memory is unread: ${r.big.why || r.base.why}`);
  }, 900_000);

  it('AC1 planted decodes_before_header: a path that decodes first passes 400 MB and fails the check', (ctx) => {
    const r = reading('decodes_before_header');
    if (r.up === null) ctx.skip(`INCONCLUSIVE: peak resident memory is unread: ${r.big.why || r.base.why}`);
    const found = failure(r);
    expect(found, 'the check fails on the planted path').not.toBeNull();
    expect(found, 'it fails on the memory, not on the refusal: the planted path still refuses over_budget naming the field').toMatch(/^peak resident memory rose/);
    expect(r.up!, `the planted path's peak resident memory rose past 400 MB over the baseline's (README: Readings), got ${mb(r.up!)} MB`).toBeGreaterThanOrEqual(PLANTED_PEAK);
  }, 900_000);
});
