// AC4 #1488.5b4cd96d: 40 truncations and 300 seeded four-bit flips of each format fixture give a refusal or an image,
// never a crash and never past the caps.
//
// "Each format fixture" *(chosen)*: every still and video format this suite's fixtures use, one fixture each: the
// orientation-6 JPEG (AC1's, 200 × 100), the lossless WebP (AC3's, 120 × 80) and the turned MP4 (AC5's, 160 × 96, 10
// frames). From each, with the seed 1488 (mulberry32, #499's `seeded`): 40 truncations, to ⌊L × k / 41⌋ bytes for k = 1
// … 40 of its L bytes, and 300 four-bit flips, each the four adjacent bits from a seeded bit offset in [0, 8L − 4)
// XORed *(chosen reading of "four-bit flip")*. All are printed. Each mutant goes through the decode worker
// (`deep-show run`: `media_import`, then `media_decode` to BGRA), under caps the run sets (`decode_caps`: 1 MiB,
// 2 s, 40,000 px). The JPEG's mutants also go through the in-process image service, the one decoder outside the worker
// (`deep-canvas-render raster`, image@1 in a board), since a still is decoded there (Asset).
//
// Each answer must be a refusal (`refused.code`; `raster`'s `ok: false` with a `code`) or an image (an asset with its
// probe; decoded streams; `raster`'s `ok: true`); an `error`, a worker that ended, a process that exits other than 0 or
// stops answering is a crash. "Never past the caps": no probe reports a size over 40,000 px or a duration over 2 s, no
// decoded stream is over 40,000 px, no frame file holds more than 40,000 px of BGRA, and no PNG the intake keeps is
// over 40,000 px. Each fixture itself must first give an image (imported; for the JPEG and the MP4, which the worker
// decodes, decoded too; the JPEG drawn by `raster`), so a reader that refuses everything can't pass; a decode of the
// WebP itself may be refused, since the intake's import is its decode. The criterion names no planted program; the
// merge base fails it (BASE-FAILURE.txt).

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isObject, putStore, seeded, useBinary, useTemp } from '../499/video/helpers.ts';
import {
  AC, BOARD, ITEM_BOX, LOOK, boardOf, decodeCall, drawLines, importCall, isPng, photoJpeg, pngSize, quadrantClip, refusal, scenario, sha256,
  show, showRun, stillItem, webpFixture, withCaps, type JsonObject, type JsonValue,
} from './helpers.ts';

const showBin = useBinary('deep-show');
const renderBin = useBinary('deep-canvas-render');
const temp = useTemp('1488-sweep');

const SEED = 1488;
const TRUNCATIONS = 40;
const FLIPS = 300;
const CAPS = { max_bytes: 1_048_576, max_duration: 2, max_pixels: 40_000 } as const;
const CHUNK = 85;

interface Mutant { name: string; bytes: Buffer }

/** The fixture's 40 truncations and 300 seeded four-bit flips, and what was printed of them. */
function mutants(label: string, bytes: Buffer): Mutant[] {
  const L = bytes.length;
  const cuts = Array.from({ length: TRUNCATIONS }, (_, i) => Math.floor((L * (i + 1)) / (TRUNCATIONS + 1)));
  const r = seeded(SEED);
  const flips = Array.from({ length: FLIPS }, () => Math.floor(r() * (8 * L - 3)));
  console.log(`${AC[4]} ${label}: ${L} B, seed ${SEED}; truncated to (B): ${cuts.join(' ')}; four bits flipped from bit offset: ${flips.join(' ')}; list sha256 ${sha256(JSON.stringify({ cuts, flips }))}`);
  const out: Mutant[] = cuts.map((n) => ({ name: `${label} truncated to ${n} B`, bytes: Buffer.from(bytes.subarray(0, n)) }));
  for (const p of flips) {
    const b = Buffer.from(bytes);
    for (let i = 0; i < 4; i++) b[(p + i) >> 3]! ^= 0x80 >> ((p + i) & 7);
    out.push({ name: `${label} with bits ${p}…${p + 3} flipped (byte ${p >> 3})`, bytes: b });
  }
  return out;
}

const over = (size: JsonValue | undefined): boolean => Array.isArray(size) && size.length === 2 && typeof size[0] === 'number' && typeof size[1] === 'number' && size[0] * size[1] > CAPS.max_pixels;

/** An import's answer judged: null for a refusal or an image within the caps, else what is wrong. */
function judgeImport(reply: JsonObject, evidence: string): string | null {
  if (refusal(reply)) return null;
  const a = reply['asset'];
  if (!isObject(a) || !isObject(a['probe']) || !Array.isArray(a['probe']['streams'])) return `media_import answers neither a refusal nor an asset: ${show(reply)}`;
  for (const s of a['probe']['streams'].filter(isObject)) {
    if (over(s['size'])) return `media_import reports a ${s['type']} of ${show(s['size'])}, past max_pixels ${CAPS.max_pixels}`;
    const d = s['duration'];
    if (Array.isArray(d) && typeof d[0] === 'number' && typeof d[1] === 'number' && d[1] > 0 && d[0] > CAPS.max_duration * d[1]) return `media_import reports a duration of ${show(d)}, past max_duration ${CAPS.max_duration} s`;
  }
  const h = a['sha256'];
  if (typeof h === 'string' && /^[0-9a-f]{64}$/.test(h)) {
    const kept = join(evidence, h.slice(0, 2), h.slice(2));
    if (existsSync(kept)) {
      const bytes = readFileSync(kept);
      if (isPng(bytes)) { const [w, h2] = pngSize(bytes); if (w * h2 > CAPS.max_pixels) return `the intake keeps a PNG of ${w} × ${h2}, past max_pixels ${CAPS.max_pixels}`; }
    }
  }
  return null;
}

/** A decode's answer judged: null for a refusal or decoded streams within the caps, else what is wrong. */
function judgeDecode(reply: JsonObject, out: string): string | null {
  if (refusal(reply)) return null;
  const d = reply['decoded'];
  if (!isObject(d) || !Array.isArray(d['streams'])) return `media_decode answers neither a refusal nor decoded streams: ${show(reply)}`;
  for (const s of d['streams'].filter(isObject)) {
    if (s['type'] === 'audio') continue;
    if (over(s['size'])) return `media_decode answers a ${s['type']} of ${show(s['size'])}, past max_pixels ${CAPS.max_pixels}`;
    for (const f of Array.isArray(s['frames']) ? s['frames'].filter(isObject) : []) {
      const file = typeof f['file'] === 'string' ? join(out, f['file']) : '';
      if (file && existsSync(file) && statSync(file).size > CAPS.max_pixels * 4) return `media_decode wrote ${f['file']}, ${statSync(file).size} B: more than ${CAPS.max_pixels} px of BGRA`;
    }
  }
  return null;
}

/** Every mutant (and first the fixture itself) through the worker, in runs of CHUNK; the failures, each naming its mutant. */
function throughWorker(dir: string, label: string, ext: string, fixture: Buffer, list: Mutant[]): string[] {
  const failures: string[] = [];
  const files = join(dir, `${ext}-files`);
  mkdirSync(files, { recursive: true });
  const all = [{ name: `${label} itself`, bytes: fixture }, ...list];
  const paths = all.map((m, i) => { const p = join(files, `${i}.${ext}`); writeFileSync(p, m.bytes); return p; });
  for (let from = 0; from < all.length; from += CHUNK) {
    const evidence = join(dir, `${ext}-evidence-${from}`);
    const outs = join(dir, `${ext}-out-${from}`);
    const range = all.slice(from, from + CHUNK).map((m, k) => ({ m, path: paths[from + k]!, out: join(outs, String(from + k)) }));
    const calls = range.flatMap((v) => [importCall(v.path), decodeCall(v.path, v.out)]);
    const run = showRun(showBin(), withCaps(scenario(evidence, calls), CAPS), 1_800_000);
    if (!run.ok) {
      failures.push(`a crash on ${range.map((v) => v.m.name).slice(0, 3).join('; ')}${range.length > 3 ? ` and ${range.length - 3} more in its run` : ''}: ${run.why}`);
      continue;
    }
    range.forEach((v, k) => {
      const imported = run.replies[2 * k]!;
      const decoded = run.replies[2 * k + 1]!;
      const bad = judgeImport(imported, evidence) ?? judgeDecode(decoded, v.out);
      if (bad) failures.push(`${v.m.name}: ${bad}`);
      if (from === 0 && k === 0) {
        // The fixture itself is an image, or the sweep proves nothing: imported (for the WebP, its import is the
        // intake's decode and conversion) and, for the formats the worker decodes (JPEG, MP4), decoded.
        if (refusal(imported) || !isObject(imported['asset'])) failures.push(`${label} itself isn't imported as an image, so a reader that refuses everything would pass: ${show(imported)}`);
        const d = decoded['decoded'];
        const frames = isObject(d) && Array.isArray(d['streams']) ? d['streams'].filter(isObject).flatMap((s) => (Array.isArray(s['frames']) ? s['frames'] : [])) : [];
        if (ext !== 'webp' && frames.length === 0) failures.push(`${label} itself doesn't decode to a picture: ${show(decoded)}`);
      }
    });
    rmSync(outs, { recursive: true, force: true });
    rmSync(evidence, { recursive: true, force: true });
  }
  return failures;
}

/** The JPEG's mutants as image@1 through the in-process image service (`raster`), one process restarted after a crash. */
function throughImageService(dir: string, fixture: Buffer, list: Mutant[]): string[] {
  const store = join(dir, 'raster-store');
  const all = [{ name: 'the JPEG itself', bytes: fixture }, ...list];
  const lines = all.map((m, i) => {
    const sha = putStore(store, m.bytes);
    return { out: join(dir, `raster-${i % 2}.png`), doc: boardOf(`sweep-${i}`, BOARD, [stillItem('photo', sha, ITEM_BOX)], { photo: sha }), look: LOOK, store } as JsonObject;
  });
  const failures: string[] = [];
  let from = 0;
  while (from < lines.length) {
    const r = drawLines(renderBin(), 'raster', lines.slice(from));
    r.answers.forEach((a, k) => {
      const name = all[from + k]!.name;
      if (from + k === 0 && a['ok'] !== true) failures.push(`the JPEG itself isn't drawn by raster, so a reader that refuses everything would pass: ${show(a)}`);
      else if (a['ok'] !== true && !(a['ok'] === false && typeof a['code'] === 'string')) failures.push(`${name}: raster answers neither a picture nor a refusal: ${show(a)}`);
    });
    if (!r.crash) break;
    const at = from + r.answers.length;
    failures.push(`${all[at]?.name ?? 'after the last mutant'}: a crash in the image service: ${r.crash}`);
    from = at + 1;
  }
  return failures;
}

describe('AC4 #1488.5b4cd96d a fixed corruption sweep over every format fixture', () => {
  it('AC4 #1488.5b4cd96d 40 truncations and 300 seeded four-bit flips of the JPEG, the WebP and the MP4 each give a refusal or an image, never a crash, never past the caps', () => {
    if (process.platform !== 'darwin') expect.fail(`BLOCKED: the decode worker's video and still decoders are the platform's (macOS); this is ${process.platform}`);
    const dir = temp();
    const clip = join(dir, 'clip.mp4');
    quadrantClip(clip);
    const fixtures = [
      { label: 'the JPEG', ext: 'jpg', bytes: photoJpeg() },
      { label: 'the WebP', ext: 'webp', bytes: readFileSync(webpFixture(dir)) },
      { label: 'the MP4', ext: 'mp4', bytes: readFileSync(clip) },
    ];
    const failures: string[] = [];
    let count = 0;
    for (const f of fixtures) {
      const list = mutants(f.label, f.bytes);
      count += list.length;
      failures.push(...throughWorker(dir, f.label, f.ext, f.bytes, list));
      if (f.ext === 'jpg') failures.push(...throughImageService(dir, f.bytes, list));
    }
    console.log(`${AC[4]}: ${count} mutants (${fixtures.length} fixtures × ${TRUNCATIONS + FLIPS}), ${failures.length} failures`);
    expect(count, 'every fixture gives 340 mutants').toBe(fixtures.length * (TRUNCATIONS + FLIPS));
    expect(failures, `${failures.length} answers that are a crash, neither a refusal nor an image, or past the caps:\n${failures.slice(0, 20).join('\n')}`).toEqual([]);
  }, 3_600_000);
});
