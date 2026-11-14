// Lays out render.mjs's snapshots and verdicts as one sheet: each fixture's planted fault, its clean twin and the
// planted document after its fix, each picture with its verdict beside it, outside the frame; then renders the page
// with headless Chrome. `node sheet.mjs <render.mjs out dir> <out.png>`
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [dir, png] = process.argv.slice(2);
const results = JSON.parse(readFileSync(join(dir, 'verdicts.json'), 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const TITLES = {
  framing: 'A subject cut by the frame: camera.framing',
  exposure: 'Clipped highlights: render.exposure',
  contrast: 'Text under 4.5:1: render.contrast (the redraft\'s board)',
  overlap: 'Two items passing into each other: the scene audit',
  floating: 'An item floating 0.2 m above the floor: the scene audit',
  door: 'A 20 m door: scene.scale',
  texture: 'A missing texture: document.validate\'s assets',
  noise: 'A fill that reseeds each frame: render.noise (frames 0, 1 and 2)',
  overclass: 'A scene over its class: document.budget',
};
const short = (v, n = 160) => esc(JSON.stringify(v).slice(0, n));
/** What a row says: its result, each issue's code, what and fix, and its first reading. */
function said(row, kind) {
  if (!row) return '';
  const issues = (row.issues ?? []).filter((i) => i.severity === 'error').map((i) => {
    const ops = Array.isArray(i.fix_ops) ? i.fix_ops : Array.isArray(i.fix) ? i.fix : null;
    const fix = ops ? `fix: ${ops.length} op${ops.length > 1 ? 's' : ''}, ${short(ops[0], 140)}` : `fix: ${esc(i.fix ?? '')}`;
    const chosen = i.chosen ? `<br><small>chosen by measurement: ${short(i.chosen, 240)}</small>` : '';
    return `<li><b>${esc(i.code)}</b> by ${esc(i.check)}${i.check !== kind ? ' (the document\'s own)' : ''}: ${esc(String(i.what ?? '').slice(0, 170))}<br><small>${fix}</small>${chosen}</li>`;
  }).join('');
  const r = (row.results ?? []).slice(0, 3).map((x) => `<small>reading: ${short(Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'doc')), 220)}</small>`).join('<br>');
  const extra = row.inconclusive ? `<small>inconclusive: ${short(row.inconclusive)}</small>` : '';
  return `<div class="v ${esc(row.result)}">${esc(row.result)}</div><ul>${issues}</ul>${r}${extra}`;
}
const img = (p, frames) => {
  const list = (p ?? []).filter((x, k) => !frames || frames.includes(k));
  return list.map((x) => (x.png ? `<img src="${x.png}">` : `<div class="refused">render-back refused: ${short(x.refused)}</div>`)).join('');
};
const cell = (title, pngs, row, kind, frames) => `<figure><figcaption>${title}</figcaption><div class="pics">${img(pngs, frames)}</div><div class="strip">${said(row, kind)}</div></figure>`;
/** What a pair's pictures can't show, said beside them. */
const GAPS = {
  texture: "render-back draws no texture maps: deep-gpu's view decodes them, deep-show's render-back doesn't, so even the twin's crate, whose PNG is in the store, draws white. The check reads the evidence store, not these pixels.",
};
const sections = results.map((r) => {
  const frames = r.name === 'noise' ? [0, 1, 2] : undefined;
  const fixed = r.fixed ? cell('The planted document after its fix, sent back as a patch', r.fixed.pngs, r.fixed.row, r.kind, frames) : '<figure><figcaption>No fix as patch ops</figcaption></figure>';
  const note = r.painted ? `<p class="note">Drawn from a copy with ${esc(r.added.join(', '))}, so you can see it; the verdicts are on the documents as the suite stores them.</p>` : '';
  const gap = GAPS[r.name] ? `<p class="gap">Gap found: ${esc(GAPS[r.name])}</p>` : '';
  return `<section><h2>${esc(TITLES[r.name] ?? r.name)}</h2>${note}${gap}<div class="row">${cell('Planted fault', r.planted.pngs, r.planted.row, r.kind, frames)}${cell('Clean twin', r.twin.pngs, r.twin.row, r.kind, frames)}${fixed}</div></section>`;
}).join('');
const page = `<!doctype html><meta charset="utf-8"><style>
body{font:13px system-ui;margin:16px;background:#fff;width:1500px;color:#111}h1{font-size:20px}h2{font-size:15px;margin:18px 0 6px}
.row{display:flex;gap:12px}figure{margin:0;width:490px;border:1px solid #ddd;padding:6px;background:#fafafa}
figcaption{font-weight:600;margin-bottom:4px}.pics{display:flex;flex-wrap:wrap;gap:4px}.pics img{max-width:476px;max-height:270px;border:1px solid #999}
.row figure:nth-child(n) .pics img{width:auto}section:has(h2:first-child) .pics img{}
.strip{margin-top:6px;font-size:12px}.strip ul{margin:4px 0;padding-left:16px}.v{display:inline-block;font-weight:700;padding:1px 8px;border-radius:3px;color:#fff;background:#666}
.v.PASS{background:#1a7f37}.v.FAIL{background:#cf222e}.v.INCONCLUSIVE{background:#9a6700}.v.BLOCKED{background:#57606a}.note{color:#555;margin:2px 0 6px}
.refused{color:#cf222e}.gap{color:#9a6700;font-weight:600;margin:2px 0 6px}small{color:#444}</style>
<h1>#1938: each loop fixture as render-back draws it, with the verdict the check gives (evidence outside each frame)</h1>
<p>Planted fault, clean twin and the planted document after the fix its check names is applied as the working agent's patch. Every picture is deep-show's own render-back snapshot; every verdict is deep-show's own <code>verdict</code> on the document the blind suite judges.</p>
${sections}`;
writeFileSync(join(dir, 'sheet.html'), page);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const r = spawnSync(chrome, ['--headless=new', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'sheet-'))}`, '--hide-scrollbars', '--allow-file-access-from-files', '--window-size=1540,6400', `--screenshot=${png}`, `file://${join(dir, 'sheet.html')}`], { encoding: 'utf8', timeout: 90_000, killSignal: 'SIGKILL' });
// Headless Chrome can outlive its screenshot; the file is what counts.
console.log(existsSync(png) ? `wrote ${png}` : (r.stderr ?? '').slice(-400));
