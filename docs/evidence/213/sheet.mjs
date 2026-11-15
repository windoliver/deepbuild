// Lays out the export's frames (ffmpeg's PNGs of export.mjs's H.264 films) beside the checks the run's numbers passed, then renders
// the page with headless Chrome: `node sheet.mjs <dir> <out.png>` (60 fps; the dir holds hitscan-frames/,
// mirror-frames/ and checks.json).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [dir, png] = process.argv.slice(2);
const checks = JSON.parse(readFileSync(join(dir, 'checks.json'), 'utf8'));
const frame = (film, k) => {
  const list = readdirSync(join(dir, `${film}-frames`)).filter((f) => f.endsWith('.png')).sort();
  return `file://${join(dir, `${film}-frames`, list[Math.min(k, list.length - 1)])}`;
};
const cells = (film, picks) => picks.map((k) => `<figure><img src="${frame(film, k)}" width="410"><figcaption>frame ${k}, t = ${(k / 60).toFixed(2)} s</figcaption></figure>`).join('');
const h = checks.hitscan ?? {};
const m = checks.mirror ?? {};
const page = `<!doctype html><meta charset="utf-8"><style>body{font:13px system-ui;margin:16px;background:#fff;width:1290px}
figure{display:inline-block;margin:4px;vertical-align:top}figcaption{font-weight:600}td,th{padding:3px 10px;text-align:left}table{border-collapse:collapse}tr:nth-child(odd){background:#f3f3f3}</style>
<h2>#213 on film: the product's own export (H.264, 1280 × 720, 60 fps), shown at a third of its size</h2>
<h3>Hit-scan: the turret asks physics.cast@1 32 rays a step and draws the hits it reads one step later (red dots); the wall moves toward it at 1 m/s and a ball falls through the fan</h3>
${cells('hitscan', [6, 45, 90, 135, 175])}
<table><tr><th>Check, from the same run's logic call</th><th>Reading</th></tr>
<tr><td>Steps run, traps</td><td>${h.steps}, ${JSON.stringify(h.traps ?? [])}</td></tr>
<tr><td>First step that reads a hit (the rays asked at step 0 are answered after it)</td><td>${h.first_step_with_hits}</td></tr>
<tr><td>Hits on the moving wall, and the largest distance from its face at the state the asking step read</td><td>${h.wall_hits} hits, ${Number(h.wall_face_error_max_m).toExponential(1)} m</td></tr>
<tr><td>Hits on the pillars and the ball</td><td>${h.pillar_hits} and ${h.other_hits}</td></tr>
<tr><td>Fuel at step 0 and step 1 (step 1 pays 32 × 4,000 for step 0's answers)</td><td>${h.fuel_step_0} and ${h.fuel_step_1}</td></tr></table>
<h3>Mirror reads: crowd (teal, left) lifts one row a step; copier mirrors crowd.pos and draws its copy 12 m to the right (red), one step behind, since a mirror holds the writer's earlier steps</h3>
${cells('mirror', [3, 30, 75, 120, 170])}
<table><tr><th>Check, from the same run's logic call</th><th>Reading</th></tr>
<tr><td>Steps run, traps</td><td>${m.steps}, ${JSON.stringify(m.traps ?? [])}</td></tr>
<tr><td>Elements of copier's copy compared with crowd.pos as the step before left it, and how many differ</td><td>${m.elements_compared} compared, ${m.elements_differing} differ</td></tr>
<tr><td>The list's range count at each step, and how many steps had it</td><td>${JSON.stringify(m.list_counts)}</td></tr></table>`;
writeFileSync(join(dir, 'sheet.html'), page);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const r = spawnSync(chrome, ['--headless=new', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'sheet-'))}`, '--hide-scrollbars', '--allow-file-access-from-files', '--window-size=1320,1560', `--screenshot=${png}`, `file://${join(dir, 'sheet.html')}`], { encoding: 'utf8' });
console.log(r.status === 0 ? `wrote ${png}` : (r.stderr ?? '').slice(-400));
