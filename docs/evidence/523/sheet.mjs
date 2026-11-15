// Lays out the export's own PNG frames (export.mjs png_seq) at the frames named, with readings.html's charts, and the
// two-link arm before and after a fix side by side, then renders the page with headless Chrome:
// `node sheet.mjs <after dir> <before dir> <out.png> <frame>...` (60 fps; each dir holds frames/ and readings.html).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [after, before, png, ...picks] = process.argv.slice(2);
const frame = (dir, k) => `file://${join(dir, 'frames', readdirSync(join(dir, 'frames')).filter((f) => f.endsWith('.png')).sort()[k])}`;
const at = (k) => `frame ${k}, t = ${(k / 60).toFixed(2)} s`;
const cells = picks.map(Number).map((k) => `<figure><img src="${frame(after, k)}" width="620"><figcaption>${at(k)}</figcaption></figure>`).join('');
// The arm's corner of the 1280 × 720 frame, at 2× its size.
const arm = (dir, k) => `<div class="crop"><img src="${frame(dir, k)}"></div>`;
const pairs = [150, 179].map((k) => `<figure>${arm(before, k)}<figcaption>before the fix, ${at(k)}</figcaption></figure><figure>${arm(after, k)}<figcaption>after, ${at(k)}</figcaption></figure>`).join('');
const charts = (dir) => readFileSync(join(dir, 'readings.html'), 'utf8').split('<pre>')[0].replace(/<h3>.*?<\/h3>/s, '');
const page = `<!doctype html><meta charset="utf-8"><style>body{font:13px system-ui;margin:16px;background:#fff;width:1280px}figure{display:inline-block;margin:6px;vertical-align:top}
figcaption{font-weight:600}.crop{width:620px;height:240px;overflow:hidden;border:1px solid #ccc}.crop img{width:2560px;margin:-1060px 0 0 -1300px}</style>
<h2>#523 on film: the product's own export (png_seq, 1280 × 720, 60 fps), shown at half size</h2>${cells}
<h2>The two-link arm past its reach: before the fix it sagged and flipped; after, it holds straight toward its hand</h2>${pairs}
<h2>Joint readings, baked by deep-physics at one sample a step (the film can't draw them yet, #2248)</h2>
<h3>After the fix</h3>${charts(after)}<h3>Before the fix</h3>${charts(before).split('<figure>').slice(0, 3).join('<figure>')}`;
writeFileSync(join(after, 'sheet.html'), page);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const r = spawnSync(chrome, ['--headless=new', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'sheet-'))}`, '--hide-scrollbars', '--allow-file-access-from-files', '--window-size=1320,2700', `--screenshot=${png}`, `file://${join(after, 'sheet.html')}`], { encoding: 'utf8' });
console.log(r.status === 0 ? `wrote ${png}` : (r.stderr ?? '').slice(-400));
