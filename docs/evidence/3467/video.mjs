// The #3467 clip and its still (README.md beside this file): the suite's 4K reordered fixture in a 640 x 360 player,
// `deep-canvas-render idle` for 10 s of the real clock on the merge base's binary and on the change's, then one clip
// that replays, side by side, the frames each run reported showing.
// Run from the checkout's root: node docs/evidence/3467/video.mjs <change bin dir> <base bin dir> <out dir>
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.cwd();
const [changeDir, baseDir, outDir] = process.argv.slice(2).map((p) => resolve(p));
const suite = join(root, 'tests/acceptance/3467');
const { asset, documentOf, ffmpeg, ffmpegTools, putStore, videoItem } = await import(join(root, 'tests/acceptance/499/video/helpers.ts'));
const { REORDERED_4K, frameTime, recipeArgs } = await import(join(suite, 'fixtures.ts'));
const LOOK = { light: { ground: [250, 250, 248], ink: [28, 28, 30], muted: [120, 120, 128], accent: [40, 90, 200], live: [200, 120, 40] } };
const VIEW = { zoom: 1, theme: 'light' };
const bins = { base: baseDir, change: changeDir };
const dir = mkdtempSync(join(tmpdir(), 'deep-3467-video-'));
mkdirSync(outDir, { recursive: true });
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const tool = ffmpegTools().ffmpeg;

const fx = join(dir, 'reordered-4k.mp4');
ffmpeg(recipeArgs(REORDERED_4K, fx));
const store = join(dir, 'store');
const sha = putStore(store, readFileSync(fx));
const doc = documentOf('3467-live-4k', 'board', [640, 360], [videoItem('rec', sha, [0, 0, 640, 360])], { rec: asset(sha) }, {}, { span: '12s' });
const render = (side, sub, lines) => {
  const run = spawnSync(join(bins[side], 'deep-canvas-render'), [sub], { cwd: root, input: `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 30, timeout: 600_000 });
  if (run.status !== 0) throw Error(`${side} ${sub} exit ${run.status}: ${(run.stderr ?? '').slice(-600)}`);
  return run.stdout.split('\n').filter((l) => l !== '').map((l) => JSON.parse(l));
};

// 1. The live view on the real clock, the base first, then the change.
const SECONDS = 10;
const runs = {};
for (const side of ['base', 'change']) {
  const before = loadavg()[0];
  const [a] = render(side, 'idle', [{ doc, look: LOOK, view: VIEW, seconds: SECONDS, store }]);
  if (a.ok !== true) throw Error(`${side} idle refused: ${JSON.stringify(a).slice(0, 400)}`);
  const p = a.players.rec;
  runs[side] = { binary: sha256(join(bins[side], 'deep-canvas-render')), load: [before, loadavg()[0]], drawn: a.drawn.length, shown: p.shown.map((s) => ({ at_ms: s.at_ms, frame: s.frame })), decodes: p.decodes.map((d) => ({ at_ms: d.at_ms, frame: d.frame, ...(d.samples === undefined ? {} : { samples: d.samples }) })) };
}

// 2. The same frame drawn by both binaries: `render` at six times, the PNGs compared byte for byte.
const stills = [0, 1, 2, 3, 125, 249].map((k) => {
  const row = { frame: k, t: frameTime(k) };
  for (const side of ['base', 'change']) {
    const out = join(dir, `still-${side}-${k}.png`);
    const [a] = render(side, 'render', [{ out, doc, look: LOOK, view: VIEW, t: frameTime(k), store }]);
    row[side] = a.ok === true ? sha256(out) : `refused ${JSON.stringify(a).slice(0, 200)}`;
  }
  return { ...row, equal: row.base === row.change };
});

// 3. The clip: per 1/30 s, the source frame each run had on screen (the last `shown` row whose draw had begun).
const FPS = 30; const TICKS = SECONDS * FPS;
mkdirSync(join(dir, 'f')); mkdirSync(join(dir, 'strip'));
execFileSync(tool, ['-v', 'error', '-y', '-i', fx, '-vf', 'scale=640:360', '-q:v', '2', '-start_number', '0', join(dir, 'f', '%04d.jpg')]);
const at = (rows, ms) => rows.filter((r) => r.at_ms <= ms);
const labels = [];
for (const side of ['base', 'change']) mkdirSync(join(dir, side));
for (let i = 0; i < TICKS; i += 1) {
  const ms = (i * 1000) / FPS;
  const text = {};
  for (const side of ['base', 'change']) {
    const seen = at(runs[side].shown, ms);
    const frame = seen.at(-1)?.frame ?? 0;
    symlinkSync(join(dir, 'f', `${String(frame).padStart(4, '0')}.jpg`), join(dir, side, `${String(i).padStart(4, '0')}.jpg`));
    const asked = at(runs[side].decodes, ms);
    const samples = asked.every((d) => d.samples !== undefined) ? `, ${asked.reduce((t, d) => t + d.samples, 0)} samples decoded` : ', samples: the base reports none';
    text[side] = `frame ${frame} on screen, ${seen.length} of ${REORDERED_4K.frames} shown${samples}`;
  }
  const item = (id, s, pos, size) => ({ id, kind: 'text@1', layer: 'main', name: id, order: `a${id}`, params: { text: s, font: 'body', size, paint: { fill: { role: 'ink' } } }, at: { pos: [pos[0], pos[1], 0] } });
  const items = [item('a', 'Merge base a1ef97760: the live view on the real clock', [12, 6], 15), item('b', 'This change: the same request', [652, 6], 15), item('c', text.base, [12, 30], 14), item('d', text.change, [652, 30], 14)];
  labels.push({ out: join(dir, 'strip', `${String(i).padStart(4, '0')}.png`), look: LOOK, view: VIEW, doc: { format: 1, id: `3467-strip-${i}`, profile: 'figure', title: 'Labels', description: 'The clip\'s labels, outside the two panels.', size: [1280, 56], layers: { main: { writer: 'agent-a', title: 'Main', order: 'a1' } }, items: Object.fromEntries(items.map((x) => [x.id, x])) } });
}
const foot = (id, s, y) => ({ id, kind: 'text@1', layer: 'main', name: id, order: `a${id}`, params: { text: s, font: 'body', size: 12, paint: { fill: { role: 'ink' } } }, at: { pos: [12, y, 0] } });
const footer = [foot('a', 'A 3840 x 2160 recording, 250 frames at 30 fps, two B-frames between reference frames, one key frame, in a 640 x 360 player: deep-canvas-render idle, 10 s.', 5), foot('b', 'Each panel replays the frames that run reported showing (players.shown), each placed when its draw began. The pictures are the fixture\'s own frames. No test reads this clip.', 23)];
labels.push({ out: join(dir, 'footer.png'), look: LOOK, view: VIEW, doc: { format: 1, id: '3467-footer', profile: 'figure', title: 'Footer', description: 'What the clip is.', size: [1280, 44], layers: { main: { writer: 'agent-a', title: 'Main', order: 'a1' } }, items: Object.fromEntries(footer.map((x) => [x.id, x])) } });
const drawn = render('change', 'render', labels);
const refused = drawn.findIndex((a) => a.ok !== true);
if (refused >= 0) throw Error(`label ${refused} refused: ${JSON.stringify(drawn[refused]).slice(0, 400)}`);
const clip = join(outDir, 'live-4k-base-and-change.mp4');
execFileSync(tool, ['-v', 'error', '-y', '-framerate', String(FPS), '-i', join(dir, 'base', '%04d.jpg'), '-framerate', String(FPS), '-i', join(dir, 'change', '%04d.jpg'), '-framerate', String(FPS), '-i', join(dir, 'strip', '%04d.png'), '-loop', '1', '-framerate', String(FPS), '-i', join(dir, 'footer.png'),
  '-filter_complex', '[0:v]format=yuv444p,setsar=1[l];[1:v]format=yuv444p,setsar=1[r];[l][r]hstack=inputs=2[p];[2:v]format=yuv444p,setsar=1[s];[3:v]format=yuv444p,setsar=1[f];[s][p][f]vstack=inputs=3,format=yuv420p[v]',
  '-map', '[v]', '-frames:v', String(TICKS), '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-movflags', '+faststart', clip]);
for (const s of [5]) execFileSync(tool, ['-v', 'error', '-y', '-ss', String(s), '-i', clip, '-frames:v', '1', join(outDir, `live-4k-at-${s}s.png`)]);

const summary = { at: new Date().toISOString(), fixture: { recipe: 'tests/acceptance/3467/fixtures.ts REORDERED_4K', sha256: sha }, seconds: SECONDS, runs: Object.fromEntries(Object.entries(runs).map(([side, r]) => [side, { binary: r.binary, 'load before and after': r.load.map((l) => Number(l.toFixed(1))), 'frames drawn': r.drawn, 'frames shown': r.shown.length, 'last frame shown': r.shown.at(-1)?.frame, requests: r.decodes.length, 'samples decoded': r.decodes.every((d) => d.samples !== undefined) ? r.decodes.reduce((t, d) => t + d.samples, 0) : null, 'longest gap between new frames, ms': Math.round(Math.max(...r.shown.slice(1).map((s, i) => s.at_ms - r.shown[i].at_ms))) }])), stills, clip: { file: 'live-4k-base-and-change.mp4', sha256: sha256(clip), bytes: readFileSync(clip).length } };
writeFileSync(join(outDir, 'live-4k.json'), `${JSON.stringify({ ...summary, rows: runs }, null, 1).replaceAll(process.env.HOME, '~')}\n`);
rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify(summary, null, 1));
