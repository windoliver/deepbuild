#!/usr/bin/env node
// #239 AC5, the check run's pictures: each fixture film in tests/fixtures/films/ exported whole to H.264 with AAC, as
// tests/acceptance/239/exports.test.ts exports it, and read back from that file. Writes into docs/evidence/239/, where
// the acceptance suite's shown.test.ts reads them:
//   <film>.receipt.json                       the export's receipt, as the export call answers it
//   strokes-and-paper-drawing.png             frame 69 (2.3 s): the spiral half drawn on
//   strokes-and-paper-drawn.png               frame 285 (9.5 s): every stroke drawn, on the paper
//   camera-and-transitions-shot.png           frame 174 (5.8 s): the pan across the bar chart
//   camera-and-transitions-transition-1.png   frame 120 (4 s): the cross-fade from the push to the pan, both sides
//   camera-and-transitions-transition-2.png   frame 225 (7.5 s): the wipe from the pan to the pull, both sides
//   <film>.mp4                                the exported MP4 itself, its recording
// Usage: node scripts/checkpoint-239-films.mjs  (builds deep-show; needs macOS and ffmpeg)

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILMS = join(REPO, 'tests/fixtures/films');
const KEEP = join(REPO, 'docs/evidence/239');
const SHOTS = {
  'strokes-and-paper': [[69, 'drawing'], [285, 'drawn']],
  'camera-and-transitions': [[174, 'shot'], [120, 'transition-1'], [225, 'transition-2']],
};
const DOC = '01JB239E000000000000000001';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 30, ...opts });
  if (r.status !== 0) throw Error(`${cmd} ${args.join(' ')} failed: ${(r.stderr ?? '').slice(-2000)}`);
  return r.stdout;
};
/** A scenario as the acceptance suites write one: the evidence store, your shell's process tree, one panel. */
const scenario = (evidence, calls) => ({
  evidence, sessions: {}, calls,
  processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }],
  panels: { main: { rect: [0, 0, 1280, 720] } }, docs: { [DOC]: { panel: 'main' } },
});

run('cargo', ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'], { cwd: REPO, stdio: ['ignore', 'ignore', 'pipe'] });
const work = mkdtempSync(join(tmpdir(), 'deep-239-shots-'));
const show = join(work, 'deep-show');
copyFileSync(join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', 'deep-show'), show);
mkdirSync(KEEP, { recursive: true });

for (const [name, shots] of Object.entries(SHOTS)) {
  const document = JSON.parse(readFileSync(join(FILMS, name, 'film.json'), 'utf8'));
  const evidence = join(work, `${name}-evidence`);
  for (const file of readdirSync(join(FILMS, name, 'assets'))) {
    const bytes = readFileSync(join(FILMS, name, 'assets', file));
    const h = sha(bytes);
    mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
    writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  }
  const mp4 = join(work, `${name}.mp4`);
  const calls = [
    { call: 'deep show', peer: { pid: 3002, start: 3_000 }, doc: DOC, document, include: ['issues'] },
    { call: 'export', doc: DOC, out: mp4, video: { codec: 'h264' }, audio: { codec: 'aac' } },
  ];
  const out = JSON.parse(run(show, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario(evidence, calls))}\n` }));
  const [shown, exported] = out.replies ?? [];
  if (!out.ok || shown?.outcome !== 'presented' || exported?.outcome !== 'exported') throw Error(`${name}: ${JSON.stringify(out).slice(0, 1500)}`);
  writeFileSync(join(KEEP, `${name}.receipt.json`), `${JSON.stringify(exported.receipt, null, 2)}\n`);
  for (const [k, shot] of shots) {
    run('ffmpeg', ['-v', 'error', '-y', '-i', mp4, '-vf', `select=eq(n\\,${k})`, '-frames:v', '1', '-pix_fmt', 'rgb24', join(KEEP, `${name}-${shot}.png`)]);
  }
  copyFileSync(mp4, join(KEEP, `${name}.mp4`));
}

rmSync(work, { recursive: true, force: true });
console.log(JSON.stringify(Object.fromEntries(readdirSync(KEEP).sort().map((n) => [n, sha(readFileSync(join(KEEP, n)))])), null, 2));
