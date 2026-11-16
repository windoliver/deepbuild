// Lays out the screenshots tests/acceptance/1941/taste.test.ts writes here, each planted-fault scene before and after
// its named fix, with each picture's name and SHA-256 under it, outside the frame; then renders the page with headless
// Chrome. `node docs/evidence/1941/sheet.mjs <out.png>`
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const [png] = process.argv.slice(2);
const SCENES = [
  ['framing-cut', 'A subject cut by the frame (#1938): camera.framing pulls the camera back'],
  ['exposure-clipped', 'Clipped highlights (#1938): render.exposure sets the camera exposure'],
  ['contrast-muted', 'Text under 4.5:1 (#1938): render.contrast sets the caption to ink'],
  ['overlap-crates', 'Two items passing into each other (#1938): the scene audit moves one crate out'],
  ['floating-vase', 'An item floating 0.2 m above the floor (#1938): the scene audit lowers the vase'],
  ['scale-door', 'A 20 m door (#1938): scene.scale sets a door height'],
  ['texture-missing', 'A missing texture (#1938): document.validate unsets the missing map'],
  ['noise-reseeds', 'A fill that reseeds each frame (#1938): render.noise puts a still copy in its place (each side: a frame, then the next)'],
  ['budget-over-class', 'A scene over its class (#1938): document.budget removes the smallest specks'],
  ['coincident-walls', 'A wall added twice (#1936): the scene audit removes one'],
  ['grid-off', 'A kit piece 0.05 m off the grid (#1936): the scene audit snaps it'],
  ['seam-moved', 'A kit wall moved 2 mm (#1936): the scene audit closes the seam'],
  ['budget-showpiece', 'A showpiece over its 10 ms class (#1937): document.budget removes the smallest specks'],
];
/** What a pair can't show, said beside it. */
const GAPS = {
  'texture-missing': 'Before and after are the same bytes: render-back draws a missing map as the material\'s base colour, which is what unsetting the map leaves.',
  'coincident-walls': 'Before and after are the same bytes: two copies of one wall in one place draw as one wall.',
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const sha = (name) => createHash('sha256').update(readFileSync(join(dir, name))).digest('hex');
const pic = (name) => `<figure><img src="${name}"><figcaption>${esc(name)}<br><code>${sha(name).slice(0, 16)}…</code></figcaption></figure>`;
const sections = SCENES.map(([slug, title]) => {
  const names = slug === 'noise-reseeds'
    ? [`${slug}-before.png`, `${slug}-before-next-frame.png`, `${slug}-after.png`, `${slug}-after-next-frame.png`]
    : [`${slug}-before.png`, `${slug}-after.png`];
  const gap = GAPS[slug] ? `<p class="gap">${esc(GAPS[slug])}</p>` : '';
  return `<section><h2>${esc(title)}</h2>${gap}<div class="row">${names.map(pic).join('')}</div></section>`;
}).join('');
const page = `<!doctype html><meta charset="utf-8"><style>
body{font:13px system-ui;margin:16px;background:#fff;width:1400px;color:#111}h1{font-size:20px}h2{font-size:15px;margin:16px 0 6px}
.row{display:flex;gap:12px;flex-wrap:wrap}figure{margin:0}img{border:1px solid #999;display:block}figcaption{font-size:11px;color:#444;margin-top:3px}
.gap{color:#9a6700;margin:2px 0 6px}</style>
<h1>#1941: each planted-fault scene before and after its named fix, as render-back drew it in the check run</h1>
<p>Every picture is deep-show's own render-back snapshot, read from the evidence store by the hash its reply names, written by
<code>tests/acceptance/1941/taste.test.ts</code>. No verdict reads these pictures. Names and hashes sit outside each frame.</p>
${sections}`;
const html = join(mkdtempSync(join(tmpdir(), 'sheet-1941-')), 'sheet.html');
writeFileSync(html, page.replaceAll('src="', `src="file://${dir}/`));
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const r = spawnSync(chrome, ['--headless=new', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'sheet-'))}`, '--hide-scrollbars', '--allow-file-access-from-files', '--window-size=1440,4300', `--screenshot=${png}`, `file://${html}`], { encoding: 'utf8', timeout: 90_000, killSignal: 'SIGKILL' });
// Headless Chrome can outlive its screenshot; the file is what counts.
console.log(existsSync(png) ? `wrote ${png}` : (r.stderr ?? '').slice(-400));
