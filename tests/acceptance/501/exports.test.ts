// AC1 #501.b64babc3: "A range export and a still at a marker each record their size, frame rate and duration, and the
// still equals the live frame"
// AC9 #501.d9bb8d6a: "A png_seq export's decoded frames hash equal to its raw frames; a planted writer that stores
// premultiplied color under straight alpha at 50% alpha fails, naming frame 0"
// AC11 #501.ce90a876: "Every frame hash of the export kinds' fixture film, taken on the GPU, equals the BLAKE3 of the
// same frame read back and hashed on the CPU by the reference implementation, on the reference Mac and on the software
// adapter, and BLAKE3's published test vectors of 1,024, 4,096 and 102,400 bytes, loaded as 16 × 16, 32 × 32 and
// 160 × 160 frames, give their published digests through the same pass; a planted pass that joins the chunk tree in the
// wrong order gives other digests and fails, naming the first frame"
// AC16 #501.8065fd70: "Exports with 1 and 3 shards give identical frame and PCM hashes on the same machine"
// AC17 #501.73117ad9: "With a strip's asset missing from the store, an export stops at its readiness gate before the
// first frame, naming the asset, and leaves no file at its output path or its temporary name; a planted export that
// starts and stops at the strip's first frame leaves a partial file and fails, naming the asset"
//
// Through `deep-show run`'s `export` (README: `export`), `eval` (#387: the live frame's canonical snapshot) and
// `frame_hash` (the GPU hash pass on given frames). Every hash this suite compares is a decoded or raw frame's, never
// an encoded file's bytes: a png_seq's PNGs are decoded here and hashed as BGRA8 with this suite's BLAKE3 port of the
// reference implementation (helpers.ts, checked against the published vectors first). The fixture film (README:
// Fixtures) stands for the export kinds' fixture film. Planted: `png_premultiplies_straight`, `chunk_tree_wrong_order`,
// `export_starts_then_stops`.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FILM, FULL, TIMEOUT, VECTORS, alphaFilm, bgra, blake3, blocked, decodePng, exportCall, failsNaming, film, filesUnder,
  fl, getEvidence, hexes, inconclusive, int, none, obj, pngFrames, present, presented, putEvidence, receiptOf, referenceMacProblem,
  runShow, scenario, sha256, show, snapshotPicture, toneWav, useShow, useTemp, vectorInput, type JsonObject,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

function filmRun(calls: (evidence: string, dir: string) => JsonObject[], what: string, planted?: string, doc?: (tone: string) => JsonObject): { replies: JsonObject[]; evidence: string; dir: string } {
  const evidence = temp(); const dir = temp();
  const tone = putEvidence(evidence, toneWav());
  const replies = runShow(shows.bin(FULL), scenario(evidence, [present(DOC.a, doc ? doc(tone) : film(tone)), ...calls(evidence, dir)]), what, planted);
  presented(replies[0]!, `${what}: the document`);
  return { replies: replies.slice(1), evidence, dir };
}

describe(`${AC[1]} a range export and a still at a marker record their size, frame rate and duration, and the still is the live frame`, () => {
  it(`${AC[1]} frames [48, 168) record 320 × 180, 24 fps and 120 frames' duration; the still at marker s2 records its size, rate and duration and equals the live frame at 4 s pixel for pixel`, () => {
    const { replies: [range, still, live], evidence, dir } = filmRun((_, d) => [
      exportCall({ doc: DOC.a, out: join(d, 'range.mp4'), range: ['48f', '168f'], video: { codec: 'h264' }, audio: { codec: 'aac' } }),
      exportCall({ doc: DOC.a, out: join(d, 'still'), range: { still: { marker: 's2' } }, video: { codec: 'png_seq' } }),
      { call: 'eval', doc: DOC.a, t: fl(4), pixels: true },
    ], 'the range, the still and the live frame');
    const r = receiptOf(range!, 'the range export');
    expect([r.size, r.frame_rate, r.duration], 'the range records 320 × 180, 24/1 and 120 frames of 29,400,000 flicks').toEqual([FILM.size, FILM.rate, 120 * FILM.frame]);
    expect(r.frame_hashes.length, 'the range holds 120 frames').toBe(120);
    const s = receiptOf(still!, 'the still at marker s2');
    expect([s.size, s.frame_rate], 'the still records 320 × 180 and 24/1').toEqual([FILM.size, FILM.rate]);
    expect([0, FILM.frame], `the still records its duration (none, or its one frame): ${s.duration}`).toContain(s.duration);
    expect(s.frame_hashes.length, 'the still is one frame').toBe(1);
    const files = pngFrames(join(dir, 'still'), 'the still');
    expect(files.length, 'the still wrote one PNG').toBe(1);
    const pic = decodePng(files[0]!);
    const shown = snapshotPicture(evidence, live!, 'the live frame at 4 s');
    expect([pic.width, pic.height], 'the still is the document\'s size').toEqual(FILM.size);
    expect([shown.width, shown.height], 'the live frame is the document\'s size').toEqual(FILM.size);
    let differ = 0;
    for (let i = 0; i < pic.rgba.length; i++) if (pic.rgba[i] !== shown.rgba[i]) differ++;
    expect(differ, 'the still at the marker equals the live frame at its time, byte for byte of RGBA').toBe(0);
    expect(blake3(bgra(pic)), 'the still\'s decoded frame hashes to its receipt\'s frame hash').toBe(s.frame_hashes[0]);
  }, TIMEOUT);
});

/** A png_seq export's decoded frames against its raw frames' hashes, by frame. */
function pngFailures(reply: JsonObject, out: string): string[] {
  if (reply['outcome'] !== 'exported') return [`the png_seq export was not delivered: ${show(reply)}`];
  const r = receiptOf(reply, 'the png_seq export');
  const files = pngFrames(out, 'the png_seq export');
  const failures = files.length === r.frame_hashes.length ? [] : [`the png_seq export wrote ${files.length} PNGs for ${r.frame_hashes.length} raw frames`];
  files.forEach((f, k) => {
    const got = blake3(bgra(decodePng(f)));
    if (got !== r.frame_hashes[k]) failures.push(`frame ${k}: its decoded PNG's BGRA8 hashes ${got.slice(0, 16)}…, its raw frame ${String(r.frame_hashes[k]).slice(0, 16)}…`);
  });
  return failures;
}
const PNG_SEQ = (out: string): JsonObject => exportCall({ doc: DOC.a, out, video: { codec: 'png_seq', alpha: 'straight' } });

describe(`${AC[9]} a png_seq export's decoded frames are its raw frames`, () => {
  it(`${AC[9]} every decoded PNG of a straight-alpha film with a 50% alpha block hashes, as BGRA8, to its raw frame's hash`, () => {
    const { replies: [reply], dir } = filmRun((_, d) => [PNG_SEQ(join(d, 'frames'))], 'the alpha film as png_seq', undefined, () => alphaFilm());
    none(pngFailures(reply!, join(dir, 'frames')), 'the png_seq frames against the raw frames');
    const first = decodePng(pngFrames(join(dir, 'frames'), 'the png_seq export')[0]!);
    let half = 0;
    for (let i = 0; i < first.rgba.length; i += 4) if (Math.abs(first.rgba[i + 3]! - 128) <= 1 && (first.rgba[i]! | first.rgba[i + 1]! | first.rgba[i + 2]!) !== 0) half++;
    expect(half, 'frame 0 holds the 50% alpha block in color, so straight and premultiplied differ there').toBeGreaterThan(0);
    expect(receiptOf(reply!, 'the png_seq export').frame_hashes.length, '24 frames').toBe(24);
  }, TIMEOUT);

  it(`${AC[9]} a planted writer that stores premultiplied color under straight alpha fails, naming frame 0`, () => {
    const { replies: [reply], dir } = filmRun((_, d) => [PNG_SEQ(join(d, 'frames'))], 'the alpha film as png_seq', 'png_premultiplies_straight', () => alphaFilm());
    failsNaming(pngFailures(reply!, join(dir, 'frames')), /^frame 0:|"frame":0\b/, 'the planted writer (png_premultiplies_straight)');
  }, TIMEOUT);
});

/** The GPU's frame hashes against this suite's BLAKE3 of each frame read back, naming the first frame that differs. */
function readbackFailures(reply: JsonObject, evidence: string, what: string): string[] {
  const r = receiptOf(reply, what);
  const back = hexes(obj(reply['readback'], `${what}: readback`)['frames'], `${what}: readback.frames`);
  if (back.length !== r.frame_hashes.length) return [`${what}: ${back.length} frames read back for ${r.frame_hashes.length} hashed`];
  for (let k = 0; k < back.length; k++) {
    const bytes = getEvidence(evidence, back[k]!, `${what}: frame ${k} read back`);
    if (bytes.length !== FILM.size[0] * FILM.size[1] * 4) return [`${what}: frame ${k} read back is ${bytes.length} bytes, not 320 × 180 BGRA8`];
    const cpu = blake3(bytes);
    if (cpu !== r.frame_hashes[k]) return [`${what}: the first frame whose GPU hash differs from the reference implementation's is frame ${k}: GPU ${r.frame_hashes[k]}, CPU ${cpu}`];
  }
  return [];
}
/** The GPU pass on BLAKE3's vectors loaded as frames, against the published digests. */
function vectorFailures(reply: JsonObject, what: string): string[] {
  expect(reply['outcome'], `${what} is hashed: ${show(reply)}`).toBe('hashed');
  const got = hexes(reply['hashes'], `${what}: hashes`);
  return VECTORS.flatMap((v, i) => (got[i] === v.digest ? [] : [`${what}: the ${v.bytes}-byte vector as a ${v.size.join(' × ')} frame gives ${got[i]}, not ${v.digest}`]));
}
const legCalls = (adapter?: 'software') => (evidence: string, d: string): JsonObject[] => {
  const frames = VECTORS.map((v) => ({ size: v.size, bytes: putEvidence(evidence, vectorInput(v.bytes)) }));
  return [
    exportCall({ doc: DOC.a, out: join(d, 'frames'), video: { codec: 'png_seq' }, readback: true, ...(adapter ? { adapter } : {}) }),
    { call: 'frame_hash', frames: frames as unknown as JsonObject[], ...(adapter ? { adapter } : {}) },
  ];
};
const unavailable = (reply: JsonObject): boolean => reply['outcome'] === 'refused' && /adapter/.test(String(reply['code']));

describe(`${AC[11]} the GPU's frame hashes are BLAKE3's, on the hardware and the software adapter`, () => {
  it(`${AC[11]} every frame hash of the fixture film equals the CPU's BLAKE3 of the frame read back, and the 1,024-, 4,096- and 102,400-byte vectors give their published digests, on the reference Mac and on the software adapter`, async () => {
    const hw = filmRun(legCalls(), 'the hardware leg');
    const sw = filmRun(legCalls('software'), 'the software-adapter leg');
    const failures = [...readbackFailures(hw.replies[0]!, hw.evidence, 'hardware'), ...vectorFailures(hw.replies[1]!, 'hardware')];
    const hwAdapter = receiptOf(hw.replies[0]!, 'hardware').adapter;
    if (hwAdapter?.software !== false) failures.push(`hardware: the receipt's adapter is ${show(hwAdapter as unknown as JsonObject)}, not a hardware one`);
    const swOpen = !unavailable(sw.replies[0]!) && !unavailable(sw.replies[1]!);
    if (swOpen) {
      failures.push(...readbackFailures(sw.replies[0]!, sw.evidence, 'software'), ...vectorFailures(sw.replies[1]!, 'software'));
      const a = receiptOf(sw.replies[0]!, 'software').adapter;
      if (a?.software !== true) failures.push(`software: the receipt's adapter is ${show(a as unknown as JsonObject)}, not adapter.software: true`);
      if (obj(sw.replies[1]!['adapter'], 'software frame_hash: adapter')['software'] !== true) failures.push('software: frame_hash ran on a hardware adapter');
    }
    none(failures, 'GPU hashes against the reference implementation');
    if (!swOpen) blocked(`no software adapter can be opened here: ${show(sw.replies[0]!)}`);
    const problem = await referenceMacProblem(false);
    if (problem) inconclusive(`the hardware leg counts on a reference Mac; ${problem}`);
  }, TIMEOUT);

  it(`${AC[11]} a planted pass that joins the chunk tree in the wrong order gives other digests for the multi-chunk vectors and fails, naming the first frame`, () => {
    const { replies: [exported, vectors], evidence } = filmRun(legCalls(), 'the hardware leg', 'chunk_tree_wrong_order');
    failsNaming(readbackFailures(exported!, evidence, 'planted'), /first frame whose GPU hash differs from the reference implementation's is frame 0:/, 'the planted pass (chunk_tree_wrong_order)');
    const got = hexes(vectors!['hashes'], 'planted frame_hash: hashes');
    expect([got[1] !== VECTORS[1]!.digest, got[2] !== VECTORS[2]!.digest], 'the 4,096- and 102,400-byte vectors (4 and 100 chunks) give other digests').toEqual([true, true]);
  }, TIMEOUT);
});

describe(`${AC[16]} shards change no frame or sample`, () => {
  it(`${AC[16]} the whole film exported with 1 and with 3 shards gives identical frame hashes and PCM hashes`, () => {
    const { replies: [one, three] } = filmRun((_, d) => [1, 3].map((shards) => exportCall({ doc: DOC.a, out: join(d, `shards-${shards}.mp4`), video: { codec: 'h264' }, audio: { codec: 'aac' }, shards })), 'the film with 1 and 3 shards');
    const a = receiptOf(one!, '1 shard'); const b = receiptOf(three!, '3 shards');
    expect(a.frame_hashes.length, '240 frames').toBe(240);
    expect(a.pcm_hashes.length, 'the PCM is hashed').toBeGreaterThan(0);
    const firstFrame = a.frame_hashes.findIndex((h, k) => h !== b.frame_hashes[k]);
    expect([firstFrame, b.frame_hashes.length], `3 shards give 1 shard's frame hashes${firstFrame >= 0 ? `; frame ${firstFrame} differs` : ''}`).toEqual([-1, 240]);
    expect(b.pcm_hashes, '3 shards give 1 shard\'s PCM hashes').toEqual(a.pcm_hashes);
  }, TIMEOUT);
});

const MISSING = sha256('#501: an asset the store never held');
/** An export of a film whose strip's asset is missing: it stops at the readiness gate before frame 0, names the asset,
 * and leaves nothing in its output folder. Every failure names the asset. */
function readinessFailures(reply: JsonObject, dir: string): string[] {
  const failures: string[] = [];
  const at = `asset ${MISSING}`;
  if (reply['outcome'] !== 'stopped') failures.push(`${at}: the export didn't stop (outcome ${String(reply['outcome'])}): ${show(reply, 600)}`);
  else {
    if (reply['gate'] !== 'readiness') failures.push(`${at}: the export stopped at ${String(reply['gate'])}, not its readiness gate`);
    const drawn = int(reply['frames_drawn'], 'the stop: frames_drawn');
    if (drawn !== 0) failures.push(`${at}: the export drew ${drawn} frames before it stopped`);
    if (!JSON.stringify(reply['issues'] ?? null).includes(MISSING)) failures.push(`${at}: the stop's issues don't name the missing asset: ${show(reply, 600)}`);
  }
  const left = filesUnder(dir).map(([p]) => p);
  if (left.length) failures.push(`${at}: the export left ${left.join(', ')} in its output folder: a partial file`);
  return failures;
}

describe(`${AC[17]} a missing asset stops an export at its readiness gate, with no file left`, () => {
  it(`${AC[17]} with the strip's asset missing from the store, the export stops at its readiness gate before the first frame, naming the asset, and leaves no file at its output path or its temporary name`, () => {
    const out = temp();
    const { replies: [reply] } = filmRun(() => [exportCall({ doc: DOC.a, out: join(out, 'film.mp4'), video: { codec: 'h264' }, audio: { codec: 'aac' } })], 'the film missing an asset', undefined, (t) => film(t, { missing: MISSING }));
    none(readinessFailures(reply!, out), 'the readiness gate');
  }, TIMEOUT);

  it(`${AC[17]} a planted export that starts and stops at the strip's first frame leaves a partial file and fails, naming the asset`, () => {
    const out = temp();
    const { replies: [reply] } = filmRun(() => [exportCall({ doc: DOC.a, out: join(out, 'film.mp4'), video: { codec: 'h264' }, audio: { codec: 'aac' } })], 'the film missing an asset', 'export_starts_then_stops', (t) => film(t, { missing: MISSING }));
    failsNaming(readinessFailures(reply!, out), new RegExp(`^asset ${MISSING}: the export left .* a partial file$`), 'the planted export (export_starts_then_stops)');
  }, TIMEOUT);
});
