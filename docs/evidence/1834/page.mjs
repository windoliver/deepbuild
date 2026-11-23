// Writes the #1834 evidence page (index.html) from out/validation.json, beside the frames, videos and contact sheet.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const v = JSON.parse(readFileSync(join(OUT, 'validation.json'), 'utf8'));
const FROM = 404, TO = 424;
const steps = Array.from({ length: TO - FROM + 1 }, (_, i) => FROM + i);
const series = [
  { key: 'fired', name: 'Logic fires on time', color: '#2a78d6', xs: steps.map((k) => v.fired.ball_x_by_step[k]) },
  { key: 'late', name: 'Planted: fire one step late', color: '#eb6834', xs: steps.map((k) => v.late.ball_x_by_step[k]) },
];
const W = 760, H = 300, L = 56, R = 150, T = 16, B = 40;
const maxX = Math.max(...series.flatMap((s) => s.xs));
const sx = (k) => L + ((k - FROM) / (TO - FROM)) * (W - L - R);
const sy = (x) => T + (1 - x / (maxX * 1.08)) * (H - T - B);
const path = (s) => s.xs.map((x, i) => `${i ? 'L' : 'M'}${sx(steps[i]).toFixed(1)},${sy(x).toFixed(1)}`).join('');
const ticksY = [0, 0.2, 0.4, 0.6].filter((t) => t <= maxX * 1.08);
const rule = (k, label, color, left) => `<line x1="${sx(k)}" x2="${sx(k)}" y1="${T}" y2="${H - B}" stroke="${color}" stroke-width="1" stroke-dasharray="3 3"/>
  <text x="${sx(k) + (left ? -4 : 4)}" y="${T + 10}" class="ann" text-anchor="${left ? 'end' : 'start'}">${label}</text>`;
const last = (s) => s.xs[s.xs.length - 1];
const svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Ball x position by world step, on-time fire against the planted late fire">
  ${ticksY.map((t) => `<line x1="${L}" x2="${W - R}" y1="${sy(t)}" y2="${sy(t)}" class="grid"/><text x="${L - 8}" y="${sy(t) + 4}" class="tick" text-anchor="end">${t.toFixed(1)}</text>`).join('')}
  ${steps.filter((k) => k % 4 === 0).map((k) => `<text x="${sx(k)}" y="${H - B + 16}" class="tick" text-anchor="middle">${k}</text>`).join('')}
  <text x="${(L + W - R) / 2}" y="${H - 4}" class="axis" text-anchor="middle">world step (120 Hz): the ball's state after that many steps</text>
  <text x="14" y="${(T + H - B) / 2}" class="axis" text-anchor="middle" transform="rotate(-90 14 ${(T + H - B) / 2})">ball x (m)</text>
  ${rule(412, 'launch kept at 412', '#52514e', true)}
  ${rule(414, 'late: 414', '#52514e')}
  ${series.map((s) => `<path d="${path(s)}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`).join('')}
  ${series.map((s) => s.xs.map((x, i) => `<circle cx="${sx(steps[i])}" cy="${sy(x)}" r="4" fill="${s.color}" stroke="#fcfcfb" stroke-width="2"/>`).join('')).join('')}
  ${series.map((s, i) => `<text x="${W - R + 8}" y="${sy(last(s)) + (i ? 14 : -4)}" class="lab">${s.name}</text>`).join('')}
  <line id="xh" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="#52514e" stroke-width="1" visibility="hidden"/>
  <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" id="hit"/>
</svg>`;
const row = (k) => `<tr><td>${k}</td>${series.map((s) => `<td>${v[s.key].ball_x_by_step[k].toFixed(4)}</td>`).join('')}</tr>`;
const ok = (b) => (b ? '<span class="pass">PASS</span>' : '<span class="fail">FAIL</span>');
const f = v.fired, l = v.late, e = v.expected;
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>#1834 evidence: logic fires a world's launch</title>
<style>
body{font:15px/1.5 -apple-system,system-ui,sans-serif;color:#0b0b0b;background:#fcfcfb;margin:32px auto;max-width:1080px;padding:0 24px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:32px 0 8px}
.lead{color:#52514e;margin:0 0 16px}
table{border-collapse:collapse;margin:8px 0}td,th{border-bottom:1px solid #e1e0d9;padding:4px 12px;text-align:left;font-variant-numeric:tabular-nums}
th{color:#52514e;font-weight:600}.pass{color:#0b0b0b;font-weight:600}.pass::before{content:"✓ ";color:#008300}.fail{font-weight:600}.fail::before{content:"✗ ";color:#e34948}
.strip{display:grid;grid-template-columns:150px 1fr;gap:6px 12px;align-items:center}
.strip .rl{color:#52514e;font-size:13px}.strip img,.strip video{max-width:100%;display:block}
.cols{display:grid;grid-template-columns:repeat(5,1fr);text-align:center;color:#52514e;font-size:13px}
.vlabels{display:grid;grid-template-columns:1fr 1fr;color:#52514e;font-size:13px}
svg .grid{stroke:#e1e0d9;stroke-width:1}svg .tick{fill:#52514e;font-size:11px}svg .axis{fill:#52514e;font-size:12px}
svg .lab{fill:#0b0b0b;font-size:12px}svg .ann{fill:#52514e;font-size:11px}
#tip{position:fixed;pointer-events:none;background:#0b0b0b;color:#f0efec;font-size:12px;padding:6px 8px;border-radius:4px;display:none}
code{font-size:13px}
</style></head><body>
<h1>#1834: a logic item fires the lab's launch</h1>
<p class="lead">The blind suite's lab fixture rendered by deep-show. The logic item <code>coach</code> steps at 70 Hz and marks a fire of <code>kick</code> at its step 240 (t = 3.4286 s). The world steps at 120 Hz, so the first world step at or after that time is <b>412</b>. The right column is the same scene under the planted twin <code>fire_one_step_late</code>. Labels sit outside the rendered frames. The floor, goal and colors are drawn for this page only; the world and the camera are the suite's.</p>

<h2>Validation</h2>
<table>
<tr><th>Check</th><th>Expected</th><th>Logic fires on time</th><th>Planted late fire</th></tr>
<tr><td>Launch the bake keeps (world step, source)</td><td>${e.launch_step}, logic:coach</td><td>${f.launches.map((x) => `${x.step}, ${x.from}`).join('; ')} ${ok(f.launches.length === 1 && f.launches[0].step === e.launch_step && f.launches[0].from === 'logic:coach')}</td><td>${l.launches.map((x) => `${x.step}, ${x.from}`).join('; ')} (late, as planted: ${e.late_launch_step})</td></tr>
<tr><td>First state with the ball moving (after N steps)</td><td>${e.launch_step + 1}</td><td>${f.first_moving_state} ${ok(f.first_moving_state === e.launch_step + 1)}</td><td>${l.first_moving_state}</td></tr>
<tr><td>First exported frame that differs from frame 0 (60 fps; frame f = state after 2f steps)</td><td>207</td><td>${f.first_changed_frame} ${ok(f.first_changed_frame === 207)}</td><td>${l.first_changed_frame}</td></tr>
<tr><td>Scene ball (eval, 240 frames) vs the world's ball after step 2f, worst error</td><td>0 m</td><td>${f.frame_vs_world_max_error_m} m ${ok(f.frame_vs_world_max_error_m <= 1e-6)}</td><td>${l.frame_vs_world_max_error_m} m</td></tr>
<tr><td>Frames exported</td><td>240</td><td>${f.frames} ${ok(f.frames === 240)}</td><td>${l.frames}</td></tr>
<tr><td>Step hashes, on time vs late</td><td>equal through state 412, differ from 413</td><td colspan="2">equal through state ${v.hashes_first_differ_at_state - 1}, first differ at state ${v.hashes_first_differ_at_state} ${ok(v.hashes_equal_before && v.hashes_first_differ_at_state === 413)}</td></tr>
</table>
<p class="lead">The blind acceptance suite asserts the same facts (3/3 pass): the launch at 412 from <code>logic:coach</code>, a <code>deep-physics</code> replay of the kept entries giving the same 481 step hashes, and the planted twin failing its judge, naming step 412.</p>

<h2>Frames 205 to 209, cropped around the ball (2× zoom)</h2>
<div class="strip">
<div></div><div class="cols"><div>205 (step 410)</div><div>206 (step 412)</div><div>207 (step 414)</div><div>208 (step 416)</div><div>209 (step 418)</div></div>
<div class="rl">Logic fires on time: moves at frame 207</div><img src="contact-205-209-fired.png" alt="On-time fire, frames 205 to 209">
<div class="rl">Planted late fire: moves at frame 208</div><img src="contact-205-209-late.png" alt="Late fire, frames 205 to 209">
</div>

<h2>The whole 4 s, side by side</h2>
<div class="vlabels"><div>Logic fires on time</div><div>Planted: fire one step late</div></div>
<video src="side-by-side.mp4" controls loop muted playsinline width="1032"></video>
<h2>Frames 190 to 230 at quarter speed</h2>
<div class="vlabels"><div>Logic fires on time</div><div>Planted: fire one step late</div></div>
<video src="launch-quarter-speed.mp4" controls loop muted playsinline width="1032"></video>

<h2>Ball x by world step, 404 to 424</h2>
${svg}
<div id="tip"></div>
<table><tr><th>World step</th>${series.map((s) => `<th>${s.name}: x (m)</th>`).join('')}</tr>${steps.map(row).join('')}</table>

<h2>How this was made</h2>
<p class="lead"><code>render.test.ts.txt</code> (a vitest file, kept as text so no lane runs it) drives deep-show (full set, this branch at the merge with main) with the blind suite's own helpers: <code>deep_show</code>, <code>physics_bake</code>, <code>world</code>, 240 <code>eval</code> calls and an <code>export</code> to PNG frames, once plain and once with the scenario's <code>planted: "fire_one_step_late"</code>. <code>validate.mjs</code> computes every number on this page from those replies and frame bytes. ffmpeg makes the videos and the crops.</p>
<script>
const data=${JSON.stringify({ steps, series: series.map((s) => ({ name: s.name, xs: s.xs })) })};
const svg=document.querySelector('svg'),hit=document.getElementById('hit'),xh=document.getElementById('xh'),tip=document.getElementById('tip');
const L=${L},R=${R},W=${W},FROM=${FROM},TO=${TO};
hit.addEventListener('mousemove',ev=>{const p=svg.createSVGPoint();p.x=ev.clientX;p.y=ev.clientY;const q=p.matrixTransform(svg.getScreenCTM().inverse());
const k=Math.round(FROM+(q.x-L)/(W-L-R)*(TO-FROM));const i=k-FROM;if(i<0||i>=data.steps.length)return;const x=L+i/(TO-FROM)*(W-L-R);
xh.setAttribute('x1',x);xh.setAttribute('x2',x);xh.setAttribute('visibility','visible');
tip.innerHTML='step '+k+'<br>'+data.series.map(s=>s.name+': '+s.xs[i].toFixed(4)+' m').join('<br>');tip.style.display='block';tip.style.left=(ev.clientX+12)+'px';tip.style.top=(ev.clientY+12)+'px';});
hit.addEventListener('mouseleave',()=>{xh.setAttribute('visibility','hidden');tip.style.display='none';});
</script>
</body></html>`;
writeFileSync(join(OUT, 'index.html'), html);
console.log('wrote', join(OUT, 'index.html'));
