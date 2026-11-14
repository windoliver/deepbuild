// Draws the #503 taste pictures (tests/acceptance/503/README.md: The taste call) from the renderer's own output: the
// `final` target of `deep-gpu run`'s `view3d`, on the acceptance suite's own fixtures and documents (its helpers.ts).
// Writes beside itself:
//   depth-points.png      the depth showpiece at frame 45, a 640 × 480 depth video drawn as 307,200 points, from a
//                         camera at (2.5, 1.5, 1) looking at (0, 0, −3), so the point cloud shows its depth
//   background-360.png    the 360° scene at 2.5 s (frame 75): the equirectangular video behind the white metal sphere,
//                         which reflects the still environment
//   background-360.apng   the 360° scene's frames 0 to 89 at 30 fps: the background playing
// and prints each SHA-256. Run from the repository root after `cargo build --locked --bin deep-gpu`; needs ffmpeg with
// libx264 (the fixtures) and macOS (the GPU layer's Metal device).
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEPTH, EQ, LICENSE, backgroundDocument, camera, depthDocument, depthFrame, equirectFrame, ffmpeg, grayVideo, runGpu, stillSky, view3d,
  writeHdr, writeJson,
} from '../../../tests/acceptance/503/helpers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const BIN = join(REPO, 'target', 'debug', 'deep-gpu');
const SIZE = [640, 480];
const sha = (b) => createHash('sha256').update(b).digest('hex');
const work = mkdtempSync(join(tmpdir(), 'deep-503-shoot-'));
const finals = (reply, what) => {
  if (!Array.isArray(reply.frames)) throw Error(`${what}: no frames: ${JSON.stringify(reply).slice(0, 600)}`);
  return new Map(reply.frames.map((f) => [f.frame, readFileSync(join(work, `${f.final}.png`))]));
};
const written = [];
const save = (name, bytes) => {
  writeFileSync(join(HERE, name), bytes);
  written.push(`${name}  ${sha(bytes)}`);
};

try {
  // The depth showpiece: the suite's 640 × 480 gray depth video and document, seen from beside the frustum.
  const depthPath = join(work, 'depth.mp4');
  grayVideo(depthPath, [DEPTH.w, DEPTH.h], DEPTH.count, (k) => depthFrame(k));
  const depthSha = sha(readFileSync(depthPath));
  const depth = depthDocument(depthSha);
  depth.size = SIZE;
  depth.items.cam = { ...depth.items.cam, ...camera([2.5, 1.5, 1], [0, 0, -3], 50, { near: 0.1, far: 100 }) };
  const [points] = runGpu(BIN, work, [view3d({
    doc: writeJson(work, 'depth', depth), size: SIZE, from: 45, frames: 1, capture: [45], targets: ['final'],
    assets: { [depthSha]: depthPath }, licenses: { [depthSha]: LICENSE },
  })], 'the depth showpiece at frame 45');
  save('depth-points.png', finals(points, 'the depth showpiece').get(45));

  // The 360° scene: the suite's equirectangular video (frame n shows n) behind its white metal sphere, played 0 to 89.
  const videoPath = join(work, 'panorama.mp4');
  grayVideo(videoPath, [EQ.w, EQ.h], EQ.count, (n) => equirectFrame(n));
  const videoSha = sha(readFileSync(videoPath));
  const hdr = writeHdr(work, [128, 64], stillSky);
  const scene = backgroundDocument(hdr.sha, videoSha);
  scene.size = SIZE;
  const all = Array.from({ length: EQ.count }, (_, n) => n);
  const [played] = runGpu(BIN, work, [view3d({
    doc: writeJson(work, 'panorama', scene), size: SIZE, from: 0, frames: EQ.count, capture: all, targets: ['final'],
    assets: { [videoSha]: videoPath, [hdr.sha]: hdr.path }, licenses: { [videoSha]: LICENSE, [hdr.sha]: LICENSE },
  })], 'the 360° scene played from 0');
  const frames = finals(played, 'the 360° scene');
  save('background-360.png', frames.get(EQ.frame));
  for (const n of all) writeFileSync(join(work, `f${String(n).padStart(3, '0')}.png`), frames.get(n));
  const apng = join(work, 'background-360.apng');
  ffmpeg(['-v', 'error', '-y', '-framerate', '30', '-i', join(work, 'f%03d.png'), '-plays', '0', '-f', 'apng', apng]);
  save('background-360.apng', readFileSync(apng));
} finally {
  rmSync(work, { recursive: true, force: true });
}
for (const line of written) console.log(line);
