// AC7 #518.c5c5c15e: "For a 4:2:0 codec, the conversion pass's NV12 planes for the export kinds' fixture film and for
// a 1080p ramp through every 8-bit red, green and blue value equal a CPU reference of the same fixed-point BT.709
// formula byte for byte, on the reference Mac and on the software adapter; a planted pass that rounds chroma down
// instead of to nearest fails on the ramp, naming the first frame and plane that differ"
//
// The pass is asked through `deep-show run`'s `frame_planes` (README: Other calls), the export's GPU conversion pass
// on given BGRA8 frames, as #501's `frame_hash` is its hash pass on given frames: each frame's Y plane and its
// interleaved CbCr plane come back in the evidence store by SHA-256, and are held here, byte for byte, to this
// suite's own CPU reference (nv12.ts), which is first held to known colours. The frames:
//   the fixture film: the 60 s fixture film exported as H.264 with AAC, a 4:2:0 codec, with `readback: true`, so the
//                     frames converted are the 1,440 the export drew, each checked to be its frame's 57,600 bytes;
//   the ramp:         ten 1920 × 1080 frames tiled 256 × 256, red x mod 256 and green y mod 256 in a tile and one blue
//                     value a tile, every blue value given a whole tile: every 8-bit colour, made here as raw bytes.
// Two legs, the hardware adapter and `adapter: "software"`. As #501's hash test does, every plane that came back is
// compared first; then the test is BLOCKED where no software adapter opens, and INCONCLUSIVE off a reference Mac.
// Planted: `nv12_rounds_chroma_down` (README: Planted programs), which the ramp fails at frame 0's CbCr plane.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FILM60, FULL, H264_AAC, TIMEOUT, arr, blocked, exportCall, failsNaming, film, filmRun, getEvidence, hex64, hexes, inconclusive, none, obj, putEvidence,
  receiptOf, referenceMacProblem, show, useShow, useTemp, type JsonObject, type Planted,
} from './helpers.ts';
import { RAMP, checkReference, firstDifference, nv12, nv12ChromaFloored, rampFrame } from './nv12.ts';

const shows = useShow([FULL]);
const temp = useTemp();
type Adapter = 'hardware' | 'software';

interface Frame { size: [number, number]; bytes: string }
const planesCall = (frames: Frame[], adapter: Adapter): JsonObject => ({ call: 'frame_planes', frames: frames.map((f) => ({ size: f.size, bytes: f.bytes })), ...(adapter === 'software' ? { adapter: 'software' } : {}) });
/** Whether a reply says the adapter asked for can't be opened here. */
const unavailable = (reply: JsonObject): boolean => reply['outcome'] === 'refused' && /adapter/.test(String(reply['code']));

/**
 * The judge: each frame's two planes from `reply` against the reference's, byte for byte. Each failure starts
 * `nv12: <what>: frame <k>, plane <y | cbcr>`, the first plane of the first frame that differs.
 */
function planeFailures(reply: JsonObject, evidence: string, frames: Frame[], what: string, adapter: Adapter): string[] {
  const at = `nv12: ${what}`;
  if (reply['outcome'] !== 'converted') return [`${at}: frame 0, plane y: frame_planes didn't convert the frames on the ${adapter} adapter: ${show(reply, 600)}`];
  const used = obj(reply['adapter'], `${what}: frame_planes: adapter`);
  if ((used['software'] === true) !== (adapter === 'software')) return [`${at}: frame 0, plane y: the pass ran on ${used['software'] === true ? 'a software' : 'a hardware'} adapter (${String(used['name'])}), not the ${adapter} one`];
  const planes = arr(reply['planes'], `${what}: frame_planes: planes`);
  expect(planes.length, `${what}: frame_planes answers one pair of planes a frame`).toBe(frames.length);
  for (let k = 0; k < frames.length; k++) {
    const [w, h] = frames[k]!.size;
    const p = obj(planes[k], `${what}: planes[${k}]`);
    const want = nv12(getEvidence(evidence, frames[k]!.bytes, `${what}: frame ${k}`), w, h);
    for (const plane of ['y', 'cbcr'] as const) {
      const got = getEvidence(evidence, hex64(p[plane], `${what}: planes[${k}].${plane}`), `${what}: frame ${k}'s ${plane} plane`);
      const d = firstDifference(got, want[plane]);
      if (d) return [`${at}: frame ${k}, plane ${plane}: byte ${d.at} is ${String(d.got)}, the reference's ${String(d.want)} (${got.length} bytes, the reference's ${want[plane].length})`];
    }
  }
  return [];
}

/** The 60 s fixture film's frames as the export of a 4:2:0 codec drew them, in the evidence store. */
function filmFrames(evidence: string, dir: string): Frame[] {
  const [reply] = filmRun(shows.bin(FULL), evidence, film(evidence, FILM60.seconds), [exportCall({ out: join(dir, 'film.mp4'), ...H264_AAC, readback: true })], 'the 60 s fixture film as H.264 with AAC, read back');
  receiptOf(reply!, 'the 60 s fixture film');
  const frames = hexes(obj(reply!['readback'], 'readback')['frames'], 'readback.frames');
  expect(frames.length, 'the export read back the film\'s 1,440 frames').toBe(FILM60.frames);
  const bytes = FILM60.size[0] * FILM60.size[1] * 4;
  frames.forEach((h, k) => expect(getEvidence(evidence, h, `raw frame ${k}`).length, `raw frame ${k} is a 160 × 90 BGRA8 frame`).toBe(bytes));
  return frames.map((h) => ({ size: FILM60.size, bytes: h }));
}
/** The ramp's ten frames, in the evidence store. */
function rampFrames(evidence: string): Frame[] {
  return Array.from({ length: RAMP.frames }, (_, f) => ({ size: RAMP.size, bytes: putEvidence(evidence, rampFrame(f)) }));
}
/** The ramp through the pass on one adapter: the reply. */
function rampRun(evidence: string, frames: Frame[], adapter: Adapter, planted?: Planted): JsonObject {
  const [reply] = filmRun(shows.bin(FULL), evidence, null, [planesCall(frames, adapter)], `the conversion pass on the ramp, ${adapter} adapter`, planted ? { planted } : {});
  return reply!;
}

describe(`${AC[7]} the conversion pass's NV12 planes are the fixed-point BT.709 formula's, byte for byte, on the hardware and the software adapter`, () => {
  it(`${AC[7]} the 60 s fixture film's 1,440 frames and the 1080p ramp's ten convert to exactly the CPU reference's Y and CbCr planes, on the reference Mac and on the software adapter`, async () => {
    checkReference();
    const evidence = temp();
    const drawn = filmFrames(evidence, temp());
    const ramp = rampFrames(evidence);
    const failures: string[] = [];
    let softwareOpen = true; let refusal: JsonObject | null = null;
    for (const adapter of ['hardware', 'software'] as const) {
      const [ofFilm] = filmRun(shows.bin(FULL), evidence, null, [planesCall(drawn, adapter)], `the conversion pass on the fixture film, ${adapter} adapter`);
      const ofRamp = rampRun(evidence, ramp, adapter);
      if (adapter === 'software' && (unavailable(ofFilm!) || unavailable(ofRamp))) { softwareOpen = false; refusal = unavailable(ofFilm!) ? ofFilm! : ofRamp; continue; }
      failures.push(...planeFailures(ofFilm!, evidence, drawn, `the fixture film (${adapter})`, adapter), ...planeFailures(ofRamp, evidence, ramp, `the ramp (${adapter})`, adapter));
    }
    none(failures, 'the conversion pass against the CPU reference');
    if (!softwareOpen) blocked(`no software adapter can be opened here, so the criterion's software leg isn't judged: ${show(refusal, 400)}`);
    const problem = await referenceMacProblem(false);
    if (problem) inconclusive(`the hardware leg counts on a reference Mac; ${problem}`);
  }, TIMEOUT);

  it(`${AC[7]} a planted pass that rounds chroma down instead of to nearest fails on the ramp, naming frame 0 and its CbCr plane`, () => {
    checkReference();
    // The ramp tells the two roundings apart: half of frame 0's chroma bytes differ, the first of them byte 0.
    const first = rampFrame(0);
    expect(firstDifference(nv12ChromaFloored(first, ...RAMP.size).cbcr, nv12(first, ...RAMP.size).cbcr)?.at, 'the ramp\'s frame 0 has chroma that rounding down changes').toBe(0);
    const evidence = temp();
    const ramp = rampFrames(evidence);
    failsNaming(planeFailures(rampRun(evidence, ramp, 'hardware', 'nv12_rounds_chroma_down'), evidence, ramp, 'the ramp', 'hardware'), /^nv12: the ramp: frame 0, plane cbcr: byte \d+ is \d+, the reference's \d+/, 'the planted pass (nv12_rounds_chroma_down)');
  }, TIMEOUT);
});
