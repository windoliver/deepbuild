#!/usr/bin/env node
// #1163 AC8, the check run's pictures: the checkpoint film sent by `deep show` from a test agent's process, exported
// whole as an MP4, and read back from that file. Writes into docs/evidence/1163/, where the acceptance suite's
// shown.test.ts reads them:
//   push.png             frame 150 (5 s) of the exported MP4: the push shot, the bouncing dot and the title
//   pan-cross-fade.png   frame 180 (6 s): the cross-fade into the pan
//   pull-back.png        frame 510 (17 s): the pull back
//   viewer-step.png      the film viewer paused at frame 100 (left) and after `.` at frame 101 (right): each the
//                        export's raw frame, lossless, whose hash the script checks equals the viewer's, with a
//                        caption strip under the frames that the canvas draws (words only: the honest-numbers rule
//                        refuses a typed number)
//   film-recording.mp4   the exported MP4's pictures as they are, its sound as AAC so any player plays it
// Usage: node scripts/checkpoint-1163-shots.mjs  (builds deep-show; needs macOS and ffmpeg)

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DOC, VIEWER, bedWav, exportWhole, film, key, present, putEvidence, scenario } from '../tests/acceptance/1163/helpers.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEEP = join(REPO, 'docs/evidence/1163');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 30, ...opts });
  if (r.status !== 0) throw Error(`${cmd} ${args.join(' ')} failed: ${(r.stderr ?? '').slice(-2000)}`);
  return r.stdout;
};

run('cargo', ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'], { cwd: REPO, stdio: ['ignore', 'ignore', 'pipe'] });
const work = mkdtempSync(join(tmpdir(), 'deep-1163-shots-'));
const show = join(work, 'deep-show');
copyFileSync(join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', 'deep-show'), show);
const evidence = join(work, 'evidence');
const doc = film(putEvidence(evidence, bedWav()));
const replies = (calls, document = doc) => {
  const out = JSON.parse(run(show, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario(evidence, [present(document), ...calls]))}\n` }));
  if (!out.ok || out.replies[0].outcome !== 'presented') throw Error(`deep-show run: ${JSON.stringify(out).slice(0, 1200)}`);
  return out.replies.slice(1);
};

// The film exported whole, as the acceptance suite exports it.
const mp4 = join(work, 'film.mp4');
const [whole] = replies([exportWhole(mp4)]);
if (whole.outcome !== 'exported') throw Error(`the export: ${JSON.stringify(whole).slice(0, 1200)}`);

// The shots, decoded from the exported file.
const frames = join(work, 'frames');
mkdirSync(frames);
const frameOf = (k, out) => run('ffmpeg', ['-v', 'error', '-y', '-i', mp4, '-vf', `select=eq(n\\,${k})`, '-frames:v', '1', '-pix_fmt', 'rgb24', out]);
for (const [k, name] of [[150, 'push.png'], [180, 'pan-cross-fade.png'], [510, 'pull-back.png']]) frameOf(k, join(frames, name));

// The viewer: `2` (frame 120), twenty `,` to frame 100, then `.`. The frames it shows, exported as lossless PNGs,
// must hash equal to the viewer's frames and to the whole export's frames 100 and 101.
const steps = join(work, 'steps');
const read = replies([key('2'), ...Array.from({ length: 20 }, () => key(',')), VIEWER, key('.'), VIEWER,
  { call: 'export', doc: DOC, out: steps, range: ['100f', '102f'], video: { codec: 'png_seq' } }]);
const [at100, at101] = read.filter((r) => r.viewer?.hash).map((r) => r.viewer);
const pngs = read.at(-1);
if (at100?.frame !== 100 || at101?.frame !== 101) throw Error(`the viewer: ${JSON.stringify(read.slice(0, -1))}`);
[at100, at101].forEach((v, i) => {
  const raw = pngs.receipt?.frame_hashes?.[i];
  if (v.hash !== raw || v.hash !== whole.receipt.frame_hashes[v.frame]) throw Error(`the viewer's frame ${v.frame} hashes ${v.hash}, its PNG ${raw}, the export's ${whole.receipt.frame_hashes[v.frame]}`);
});
// The caption strip, under the frames and outside them, drawn by the canvas.
const STRIP = [1952, 84];
const words = (id, order, text, size, x, y, role) => ({ id, kind: 'text@1', name: id, order, at: { pos: [x, y, 0] },
  params: { text, font: 'body', size, box: { w: 940, h: size + 10 }, paint: { fill: { role } } } });
const caption = {
  format: 1, profile: 'film', title: 'Viewer step caption', description: 'The words under the viewer step picture.', size: STRIP, camera: 'cam',
  transport: { span: '1s', frame_rate: [30, 1] },
  items: Object.fromEntries([
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [STRIP[0] / 2, STRIP[1] / 2, 0], view_width: STRIP[0] } },
    { id: 'back', kind: 'rect@1', name: 'Back', order: 'a1', params: { box: [0, 0, ...STRIP], paint: { fill: { role: 'ground' } } } },
    words('before', 'a2', 'Before: the film viewer paused', 24, 16, 10, 'ink'),
    words('before-note', 'a3', 'the frame it shows, equal by hash to the export', 18, 16, 46, 'muted'),
    words('after', 'a4', 'After a press of the period key', 24, 992, 10, 'ink'),
    words('after-note', 'a5', 'the next frame, equal by hash to the export', 18, 992, 46, 'muted'),
  ].map((i) => [i.id, i])),
};
const strip = join(work, 'strip');
const [drawn] = replies([{ call: 'export', doc: DOC, out: strip, range: { still: { t: '0s' } }, video: { codec: 'png_seq' } }], caption);
if (drawn.outcome !== 'exported') throw Error(`the caption: ${JSON.stringify(drawn).slice(0, 1200)}`);
const [f100, f101] = readdirSync(steps).sort().map((f) => join(steps, f));
run('ffmpeg', ['-v', 'error', '-y', '-i', f100, '-i', f101, '-i', join(strip, readdirSync(strip)[0]), '-filter_complex',
  '[0]scale=960:540,pad=976:556:8:8:color=0xb4b4b4[a];[1]scale=960:540,pad=976:556:8:8:color=0xb4b4b4[b];[a][b]hstack[f];[f][2]vstack',
  '-pix_fmt', 'rgb24', join(frames, 'viewer-step.png')]);

// The recording: the exported MP4's video stream as it is, its PCM as AAC.
run('ffmpeg', ['-v', 'error', '-y', '-i', mp4, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', join(frames, 'film-recording.mp4')]);

mkdirSync(KEEP, { recursive: true });
for (const n of readdirSync(frames)) copyFileSync(join(frames, n), join(KEEP, n));
rmSync(work, { recursive: true, force: true });
console.log(JSON.stringify(Object.fromEntries(readdirSync(KEEP).sort().map((n) => [n, sha(readFileSync(join(KEEP, n)))])), null, 2));
