// AC3 #503.d2172917: "A 360° video background: a 30 fps equirectangular test video whose frame n shows the number n,
// played with start 0, shows at 2.5 s, from a camera looking along the video's centre direction, a centre region that
// matches a CPU equirectangular lookup of frame 75 within 1 code value, played or seeked; a white metal sphere beside
// it reflects the still environment byte for byte as with no video; `background_blur: 0.5` with a video is refused at
// check, naming the field; and a planted background that prefilters the video into the environment changes the
// sphere's pixels and fails, naming the sphere"
//
// Through `deep-gpu run`'s `view3d` (README: view3d). The camera sits at the origin looking along −Z, the direction the
// base's equirectangular convention maps to the image's centre. The lookup is this suite's, in f64, from FFmpeg's
// decode of the same H.264 file (exact by the standard), a gray full-range video, so each texel's R′G′B′ is its Y′.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  AC, EQ, LICENSE, REGION, SPHERE, TIMEOUT, VIEW, backgroundDocument, drawn, equirectFrame, failsNaming, frameAt, framesOf, grayVideo, lookupsDiffer,
  none, referenceFrames, refusalNaming, regionFailures, requireMac, runGpu, sha256, sphereFailures, stillSky, useFileTemp, useGpu, useTemp, view3d,
  writeHdr, writeJson, type Drawn, type GpuPlanted, type JsonObject,
} from './helpers.ts';

const gpu = useGpu();
const fileTemp = useFileTemp('panorama');
const temp = useTemp();

const assets = { video: { path: '', sha: '' }, hdr: { path: '', sha: '' } };
const refs = new Map<number, Buffer>();
beforeAll(() => {
  if (process.platform !== 'darwin') return;
  const dir = fileTemp();
  assets.video.path = join(dir, 'panorama.mp4');
  grayVideo(assets.video.path, [EQ.w, EQ.h], EQ.count, (n) => equirectFrame(n));
  assets.video.sha = sha256(readFileSync(assets.video.path));
  assets.hdr = writeHdr(dir, [128, 64], stillSky);
  const frames = referenceFrames(assets.video.path, EQ.w, EQ.h, EQ.count);
  for (const n of [74, 75, 76]) {
    const f = frames[n]!;
    const chroma = f.subarray(EQ.w * EQ.h).findIndex((c) => c !== 128);
    expect(chroma, `frame ${n}: the reference decode's chroma is 128 everywhere (the fixture's recipe)`).toBe(-1);
    refs.set(n, f);
  }
}, TIMEOUT);

const SIZE = VIEW.size as [number, number];
/** One `view3d` call of the scene, its frame 75's targets. */
function call(out: string, document: JsonObject, name: string, frames: JsonObject): JsonObject {
  return view3d({
    doc: writeJson(out, name, document), size: SIZE, targets: ['final', 'linear', 'ids'], capture: [EQ.frame],
    assets: { [assets.video.sha]: assets.video.path, [assets.hdr.sha]: assets.hdr.path }, licenses: { [assets.video.sha]: LICENSE, [assets.hdr.sha]: LICENSE }, ...frames,
  });
}
const PLAYED: JsonObject = { from: 0, frames: EQ.frame + 1 };
const OPENED: JsonObject = { from: EQ.frame, frames: 1 };
const SEEKED: JsonObject = { from: 0, frames: 12, seeks: [{ after: 10, to: EQ.frame }] };
/** The scene with the video and without it, played to frame 75 (2.5 s at 30 fps), in one process. */
function withAndWithout(out: string, planted?: GpuPlanted): { video: Drawn; still: Drawn } {
  const replies = runGpu(gpu(), out, [
    call(out, backgroundDocument(assets.hdr.sha, assets.video.sha), 'video', PLAYED),
    call(out, backgroundDocument(assets.hdr.sha, null), 'still', PLAYED),
  ], 'the 360° scene with and without the video', planted);
  const [video, still] = replies.map((r, i) => {
    const what = i === 0 ? 'with the video, played to 2.5 s' : 'with no video';
    return drawn(out, frameAt(framesOf(r, what), EQ.frame, what), SIZE, what);
  });
  return { video: video!, still: still! };
}

describe(`${AC[3]} a 360° video behind the scene`, () => {
  it(`${AC[3]} at 2.5 s the centre region matches the CPU equirectangular lookup of frame 75 within 1 code value, played or seeked, and the white metal sphere reflects the still environment byte for byte as with no video`, () => {
    requireMac('the 360° scene');
    // The fixture tells its frames apart where the region is judged.
    expect(lookupsDiffer(refs.get(74)!, refs.get(75)!), 'frames 74 and 75 differ by more than a code value at 50 or more region pixels').toBeGreaterThanOrEqual(50);
    expect(lookupsDiffer(refs.get(76)!, refs.get(75)!), 'frames 76 and 75 differ by more than a code value at 50 or more region pixels').toBeGreaterThanOrEqual(50);
    const out = temp();
    const { video, still } = withAndWithout(out);
    for (let y = REGION.y0; y < REGION.y1; y += 8) for (let x = REGION.x0; x < REGION.x1; x += 8) expect(video.ids.at(x, y), `the centre region shows only the background (pixel (${x}, ${y}))`).toBeNull();
    const failures = regionFailures(video.linear, refs.get(EQ.frame)!, 'played to 2.5 s');
    // Seeked: a session opened at frame 75, and one drawn to frame 10 that seeks to 75.
    const replies = runGpu(gpu(), out, [
      call(out, backgroundDocument(assets.hdr.sha, assets.video.sha), 'opened', OPENED),
      call(out, backgroundDocument(assets.hdr.sha, assets.video.sha), 'seeked', SEEKED),
    ], 'the 360° scene seeked to 2.5 s');
    replies.forEach((r, i) => {
      const what = i === 0 ? 'opened at 2.5 s' : 'seeked to 2.5 s from 0.33 s';
      failures.push(...regionFailures(drawn(out, frameAt(framesOf(r, what), EQ.frame, what), SIZE, what).linear, refs.get(EQ.frame)!, what));
    });
    none(failures, 'the centre region at 2.5 s, played and seeked');
    // The check misses no wrong frame: the frame shown against frame 74's lookup fails.
    expect(regionFailures(video.linear, refs.get(74)!, 'played, against frame 74').length, 'the region judged against frame 74 fails').toBeGreaterThan(0);
    none(sphereFailures(video, still, 'played to 2.5 s'), 'the sphere with the video against the sphere with none');
  }, TIMEOUT);

  it(`${AC[3]} background_blur 0.5 with a video is refused at check, naming the field`, () => {
    requireMac('the 360° scene');
    const out = temp();
    const [reply] = runGpu(gpu(), out, [call(out, backgroundDocument(assets.hdr.sha, assets.video.sha, { background_blur: 0.5 }), 'blurred', OPENED)], 'the video background with a blur');
    refusalNaming(reply!, /background_blur/, 'the video background with background_blur 0.5');
  }, TIMEOUT);

  it(`${AC[3]} planted: a background that prefilters the video into the environment changes the sphere's pixels and fails, naming the sphere`, () => {
    requireMac('the 360° scene');
    const { video, still } = withAndWithout(temp(), 'video_background_prefiltered');
    failsNaming(sphereFailures(video, still, 'played to 2.5 s'), new RegExp(`\\b${SPHERE.id}\\b`), 'the background prefiltered into the environment');
  }, TIMEOUT);
});
