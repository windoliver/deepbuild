// #457 on film: the blind suite's fixtures (tests/acceptance/457/helpers.ts) drawn frame by frame by render-back, the
// product's own snapshots, each pair judged by camera.framing through `verdict` and labelled with that verdict's own
// readings: a walk past a door post and through the doorway's middle, a camera bobbing under a ceiling seen at 30 Hz
// samples and at 60 fps, a corner and its auto-tangent twin, the tower hidden behind a stall before and after the fix
// the check names, the piston with its half-section on and off, and the explode toggle at rest and apart (the lid
// written where the toggle binds, as the sweep writes it). Writes PNGs, verdicts.json and one MP4 with a label strip
// drawn by headless Chrome. `node docs/evidence/457/film.mjs <deep-show> <out dir> <out.mp4> [--stitch]` (--stitch reuses the
// frames and verdicts a run already wrote in <out dir>).
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as h from '../../../tests/acceptance/457/helpers.ts';

const [bin, out, mp4, mode] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const F = 705_600_000;
const SESSION = 'sess-alpha';

function run(evidence, docs, claims, calls) {
  const r = spawnSync(bin, ['run'], { input: `${JSON.stringify(h.scenarioOf(evidence, docs, claims, calls))}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
  const answer = JSON.parse(r.stdout.trim().split('\n')[0]);
  if (!answer.ok) throw Error(JSON.stringify(answer).slice(0, 2000));
  return answer.replies;
}
const back = (doc, rev, t) => ({ call: 'render_back', session: SESSION, doc, rev, t: Math.round(t) });
/** The snapshot of a render-back reply, copied out as `<name>.png`. */
function keep(evidence, reply, name) {
  const sha = reply?.snapshots?.[0]?.sha256;
  if (!sha) throw Error(`${name}: render-back drew nothing: ${JSON.stringify(reply).slice(0, 600)}`);
  copyFileSync(join(evidence, sha.slice(0, 2), sha.slice(2)), join(out, `${name}.png`));
}
/** camera.framing's row of the claim's one requirement, and its errors in short. */
function judged(reply) {
  const row = reply.requirements[0];
  const field = (i, k) => (k in i ? i[k] : i.actual?.[k]);
  const issues = (row.issues ?? []).filter((i) => i.severity === 'error').map((i) => ({
    ids: i.ids, what: i.what, measure: field(i, 'measure'), shot: field(i, 'shot'), t: field(i, 't'), value: field(i, 'value'),
    share: field(i, 'share'), occluders: field(i, 'occluders'), sweep: field(i, 'sweep'), key: field(i, 'key'), fix: i.fix_ops ?? null,
  }));
  return { result: row.result, issues, occluded: (row.results ?? []).flatMap((r) => r.occluded ?? []).map(({ item, share, occluders }) => ({ item, share, occluders })), paths: row.results?.[0]?.paths ?? [] };
}
const verdicts = {};

/** A pair of documents, each its own claim on `check`, judged, then drawn at each of `times` (s). */
function pair(name, docs, check, times, briefs = []) {
  const evidence = mkdtempSync(join(tmpdir(), `ev-457-${name}-`));
  const ids = [h.docId(1), h.docId(2)];
  const claims = Object.fromEntries(ids.map((d, k) => [h.claimId(k + 1), h.claimOn(d, [[h.reqId(k + 1), check]], briefs[k])]));
  const calls = [h.verdict(h.claimId(1)), h.verdict(h.claimId(2)), ...ids.flatMap((d) => times.map((t) => back(d, 0, t * F)))];
  const replies = run(evidence, { [ids[0]]: docs[0], [ids[1]]: docs[1] }, claims, calls);
  verdicts[name] = [judged(replies[0]), judged(replies[1])];
  ids.forEach((_, k) => times.forEach((_, j) => keep(evidence, replies[2 + k * times.length + j], `${name}-${k}-${String(j).padStart(3, '0')}`)));
  return verdicts[name];
}

const fmt = (v, d = 2) => (typeof v === 'number' ? v.toFixed(d) : String(v));
const at = (issues, measure) => issues.find((i) => i.measure === measure);
let clips = [];
if (mode === '--stitch') {
  clips = JSON.parse(readFileSync(join(out, 'clips.json'), 'utf8'));
  Object.assign(verdicts, JSON.parse(readFileSync(join(out, 'verdicts.json'), 'utf8')));
} else {
  
  // A walk past the door post, and the walk through the doorway's middle: 2 s at 30 fps.
  {
    const times = Array.from({ length: 61 }, (_, k) => k / 30);
    const [near, mid] = pair('walk', [h.walkthrough(-0.4), h.walkthrough(0)], h.WALK_CHECK, times);
    const f = at(near.issues, 'clearance');
    const least = mid.paths.find((p) => p.measure === 'clearance');
    clips.push({
      name: 'walk', frames: times.length, fps: 30, mark: f ? { side: 0, from: f.t / F - 1 / 30, to: f.t / F + 1 / 30, fps: 30 } : null,
      title: 'clearance, bounded between samples: a walk past a door post',
      labels: [`${near.result}: ${f ? `${fmt(f.value, 3)} m from ${f.ids[0]} at t = ${fmt(f.t / F)} s, shot ${f.shot}` : 'no clearance error'}`, `${mid.result}: least ${fmt(least?.value, 3)} m, from ${least?.item}`],
    });
  }
  // A camera bobbing under a ceiling: frames at the 30 Hz samples (left) and at 60 fps (right), 1 s.
  {
    const evidence = mkdtempSync(join(tmpdir(), 'ev-457-bob-'));
    const d = h.docId(1);
    const claims = { [h.claimId(1)]: h.claimOn(d, [[h.reqId(1), h.BOB_CHECK]]) };
    const times = Array.from({ length: 61 }, (_, k) => k / 60);
    const replies = run(evidence, { [d]: h.bobbing() }, claims, [h.verdict(h.claimId(1)), ...times.map((t) => back(d, 0, t * F))]);
    verdicts.bob = [judged(replies[0])];
    times.forEach((_, j) => {
      keep(evidence, replies[1 + j], `bob-1-${String(j).padStart(3, '0')}`);
      // The 30 Hz samples: each held for two 60 fps frames.
      copyFileSync(join(out, `bob-1-${String(j - (j % 2)).padStart(3, '0')}.png`), join(out, `bob-0-${String(j).padStart(3, '0')}.png`));
    });
    const f = verdicts.bob[0].issues.filter((i) => i.measure === 'clearance').sort((a, b) => a.t - b.t)[0];
    clips.push({
      name: 'bob', frames: times.length, fps: 60, mark: null,
      title: 'between samples: a camera bobbing 15 times a second under a ceiling (clearance 0.15 m)',
      labels: ['at the 30 Hz samples it reads 0.2 m every time', `${verdicts.bob[0].result}: ${f ? `${fmt(f.value, 3)} m from ${f.ids[0]} at t = ${fmt(f.t / F, 4)} s` : 'no clearance error'}`],
    });
  }
  // Two linear segments meeting at a 40° turn, and the auto-tangent twin: 2 s at 30 fps.
  {
    const times = Array.from({ length: 61 }, (_, k) => k / 30);
    const [lin, auto] = pair('glide', [h.glide('linear'), h.glide('auto')], h.GLIDE_CHECK, times);
    const f = at(lin.issues, 'corners');
    clips.push({
      name: 'glide', frames: times.length, fps: 30, mark: f ? { side: 0, from: f.t / F - 1 / 30, to: f.t / F + 1 / 30, fps: 30 } : null,
      title: 'corners: a camera turning 40° at a key, and its auto-tangent twin',
      labels: [`${lin.result}: velocity jumps ${fmt(f?.value)} m/s at key ${f?.key}`, `${auto.result}: no corner`],
    });
  }
  // The tower behind the stall, then its fix applied as the working agent's patch.
  {
    const evidence = mkdtempSync(join(tmpdir(), 'ev-457-castle-'));
    const d = h.docId(1);
    const claims = { [h.claimId(1)]: h.claimOn(d, [[h.reqId(1), h.CASTLE_CHECK]]) };
    const [first] = run(evidence, { [d]: h.castle() }, claims, [h.verdict(h.claimId(1))]);
    const before = judged(first);
    const fix = before.issues.find((i) => i.share !== undefined && i.fix)?.fix;
    const replies = run(evidence, { [d]: h.castle() }, claims, [back(d, 0, 0), { call: 'deep_show', session: SESSION, doc: d, patch: { patch: h.patchId(1), doc: d, base: 0, reason: "camera.framing's fix for the hidden tower", ops: fix } }, back(d, 1, 0), h.verdict(h.claimId(1))]);
    const after = judged(replies[3]);
    verdicts.castle = [before, after];
    keep(evidence, replies[0], 'castle-0-000');
    keep(evidence, replies[2], 'castle-1-000');
    const share = (v) => v.occluded.find((o) => o.item === 'tower');
    clips.push({
      name: 'castle', frames: 60, fps: 30, still: true, mark: null,
      title: "the occluded share: the kept tower behind a market stall, before and after the check's fix",
      labels: [`${before.result}: ${fmt(share(before)?.share)} of the tower hidden by ${share(before)?.occluders?.join(', ')}`, `after the fix (${fix?.[0]?.path?.split('/').pop()} set): ${fmt(share(after)?.share)} hidden`],
    });
  }
  // The piston with the half-section in effect and without it.
  {
    const [cut, whole] = pair('engine', [h.engine(true), h.engine(false)], h.ENGINE_CHECK, [0]);
    const of = (v, id) => v.occluded.find((o) => o.item === id);
    clips.push({
      name: 'engine', frames: 60, fps: 30, still: true, mark: null,
      title: 'cutaways cut occluders as drawn: the piston and crank in their casing',
      labels: [`${cut.result}: piston ${fmt(of(cut, 'piston')?.share)}, crank ${fmt(of(cut, 'crank')?.share)} behind ${of(cut, 'crank')?.occluders?.join(', ')}`, `cutaway off: piston ${fmt(of(whole, 'piston')?.share)} hidden`],
    });
  }
  // The explode toggle, swept by the brief: at rest, and apart with the lid written where the toggle binds.
  {
    const apart = structuredClone(h.explodeFigure());
    apart.items.lid.at.pos[0] = apart.controls.explode.range[1];
    apart.controls.explode.default = true;
    const [swept] = pair('explode', [h.explodeFigure(), apart], h.EXPLODE_CHECK, [0], [{ sweeps: { explode: 2 } }]);
    const f = swept.issues.find((i) => i.sweep);
    clips.push({
      name: 'explode', frames: 60, fps: 30, still: true, mark: null,
      title: "sweeps from the brief: the explode toggle at rest and apart",
      labels: ['explode at rest', `${swept.result} at sweep ${f?.sweep?.control} = ${f?.sweep?.value}: ${f?.ids?.[0]} cut by the frame`],
    });
  }
    writeFileSync(join(out, 'verdicts.json'), JSON.stringify(verdicts, null, 2));
  writeFileSync(join(out, 'clips.json'), JSON.stringify(clips));
}


// Each clip: its pair side by side under a title and two labels, then all clips one after another at 30 fps.
const [W, H] = [320, 240];
const parts = [];
for (const c of clips) {
  const html = join(out, `${c.name}-labels.html`);
  writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>body{margin:0;width:${2 * W}px;font:12px system-ui;background:#fff;color:#111}h1{margin:0;padding:6px 8px 2px;font-size:13px}div{display:flex}p{margin:0;width:${W}px;box-sizing:border-box;padding:2px 8px 6px;font-weight:600}</style><h1>${c.title}</h1><div>${c.labels.map((l) => `<p>${l}</p>`).join('')}</div>`);
  const strip = join(out, `${c.name}-labels.png`);
  // Headless Chrome is slow to start on a loaded machine: three tries, three minutes each.
  for (let k = 0; k < 3 && !existsSync(strip); k++) {
    spawnSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'labels-'))}`, '--hide-scrollbars', `--window-size=${2 * W},56`, `--screenshot=${strip}`, `file://${html}`], { timeout: 180_000, killSignal: 'SIGKILL' });
  }
  const part = join(out, `${c.name}.mp4`);
  const side = (k) => (c.still ? ['-loop', '1', '-framerate', '30', '-i', join(out, `${c.name}-${k}-000.png`)] : ['-framerate', String(c.fps), '-i', join(out, `${c.name}-${k}-%03d.png`)]);
  const mark = c.mark ? `,drawbox=x=0:y=0:w=iw:h=ih:color=red@0.9:t=6:enable='between(t,${Math.max(0, c.mark.from).toFixed(3)},${c.mark.to.toFixed(3)})'` : '';
  const graph = `[0:v]fps=30${mark}[a];[1:v]fps=30[b];[a][b]hstack=inputs=2[row];[2:v]scale=${2 * W}:56[top];[top][row]vstack=inputs=2,format=yuv420p[v]`;
  const seconds = c.still ? 2 : c.frames / c.fps;
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...side(0), ...side(1), '-loop', '1', '-i', strip, '-filter_complex', graph, '-map', '[v]', '-t', String(seconds), '-r', '30', '-c:v', 'libx264', '-crf', '18', part], { encoding: 'utf8' });
  if (r.status !== 0) throw Error(`${c.name}: ${r.stderr.slice(-600)}`);
  parts.push(part);
}
const list = join(out, 'parts.txt');
writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n'));
const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', mp4], { encoding: 'utf8' });
console.log(r.status === 0 ? `wrote ${mp4}` : r.stderr.slice(-600));
console.log(JSON.stringify(verdicts, null, 1).slice(0, 4000));
