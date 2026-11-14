// The reseeding fill as render-back draws it frame by frame (render.mjs's noise-*-<k>.png, one per 60 fps frame): the
// planted fill, its twin seeded once and the planted document after its fix, side by side under a label strip drawn
// by headless Chrome, looped five times at 60 fps. `node film.mjs <render.mjs out dir> <out.mp4>`
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [dir, mp4] = process.argv.slice(2);
const count = readdirSync(dir).filter((f) => /^noise-planted-\d+\.png$/.test(f)).length;
const [w, h] = [320, 32];
const labels = ['planted: its seed held at a new value each frame', 'twin: seeded once', 'planted after its fix: a still copy in its place'];
const html = join(dir, 'film-labels.html');
writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>body{margin:0;display:flex;font:12px system-ui;background:#fff}div{width:${w}px;height:${h}px;box-sizing:border-box;padding:8px 6px;font-weight:600}</style>${labels.map((l) => `<div>${l}</div>`).join('')}`);
const strip = join(dir, 'film-labels.png');
spawnSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'labels-'))}`, '--hide-scrollbars', `--window-size=${3 * w},${h}`, `--screenshot=${strip}`, `file://${html}`], { timeout: 60_000, killSignal: 'SIGKILL' });
const inputs = ['planted', 'twin', 'fixed'].flatMap((s) => ['-framerate', '60', '-stream_loop', '4', '-i', join(dir, `noise-${s}-%d.png`)]);
const graph = '[0:v][1:v][2:v]hstack=inputs=3[row];[3:v]scale=iw:ih[top];[top][row]vstack=inputs=2,format=yuv420p[v]';
const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-loop', '1', '-i', strip, '-filter_complex', graph, '-map', '[v]', '-frames:v', String(count * 5), '-r', '60', '-c:v', 'libx264', '-crf', '18', mp4], { encoding: 'utf8' });
console.log(r.status === 0 ? `wrote ${mp4} (${count} frames, looped five times)` : r.stderr.slice(-600));
