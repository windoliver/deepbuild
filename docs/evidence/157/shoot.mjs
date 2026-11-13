// Draws the #157 taste pictures from the exports' own files, through `deep-show run` (the #157 acceptance README: The
// taste call). The films are the suite's fixtures (tests/acceptance/157/helpers.ts `filmDoc`, `lookOf`): 160 × 90 at
// 24 fps, a light grey ground, a side panel, and a bar and a tick that move a pixel a frame. Writes beside itself:
//   black-frames.png  frames 22 to 29 of the 4-black-frame film (black on 24 to 27, declared an exception), decoded
//                     from its MP4 by ffmpeg and tiled in a row
//   grain-starved.png the worst frame of the grain film encoded at the starved bitrate: export.fidelity FAILs it, so
//                     nothing is delivered, and the picture is the one the check decoded from that delivery's bytes
//   grain-raised.png  frame 24 of the grain film delivered at its raised quality floor
//   prores-alpha.png  frame 12 of the ProRes 4444 ramp at 50% alpha, decoded by ffmpeg over a checkerboard
// Each picture is scaled up 4× by nearest neighbour. Prints each SHA-256. Run from the repository root after
// `cargo build --locked --bin deep-show --no-default-features --features full`; needs ffmpeg on PATH.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const BIN = join(REPO, 'target', 'debug', 'deep-show');
const FLICKS = 705_600_000;
const D = FLICKS / 24;
const work = mkdtempSync(join(tmpdir(), 'deep-157-shoot-'));
const evidence = join(work, 'evidence');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const put = (bytes) => { const h = sha(bytes); mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true }); writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes); return h; };
const get = (h) => readFileSync(join(evidence, h.slice(0, 2), h.slice(2)));

function look(id, colours = {}, finish = []) {
  const c = { ground: '#e8e8e8', muted: '#8c8c8c', accent: '#f2c230', raised: '#d4d4d4', paper: '#f0f0f0', black: '#000000', white: '#ffffff', ramp_lo: '#0838a8', ramp_hi: '#f08020', ...colours };
  const def = {
    id, format: 1, basis: 'drawing', license: 'Apache-2.0', description: `The #157 taste pictures' look ${id}.`,
    palette: { ...c, graphite: '#1b1d22', fog: '#e3e4e6', graphite_secondary: '#1b1d22d6', graphite_tertiary: '#1b1d22d6', graphite_disabled: '#1b1d2233', graphite_hover: '#1b1d220f', graphite_selected: '#1b1d221a', orchid: '#b0207f', indigo: '#2c3e7b' },
    roles: {
      ground: 'ground', ink: 'graphite', muted: 'muted', accent: 'accent', raised: 'raised', divider: 'fog', paper: 'paper', black: 'black', white: 'white', ramp_lo: 'ramp_lo', ramp_hi: 'ramp_hi',
      ink_primary: 'graphite', ink_secondary: 'graphite_secondary', ink_tertiary: 'graphite_tertiary', ink_disabled: 'graphite_disabled', focus: 'graphite', hover: 'graphite_hover', selected: 'graphite_selected', session_readout: 'orchid', session_line: 'indigo',
    },
    themes: { light: {} },
    status: { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' },
    status_treatment: { core_min_px: 4, glyph: { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' } },
    min_distance: 0.1, attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
    lines: { line: { kind: 'exact', width: 2 } }, fills: { fill: { kind: 'flat' } }, ground: { kind: 'flat' },
    fonts: { body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false } },
    fallback: [], time: { state: { span: '0.25s', interp: { ease: { name: 'in_out_cubic' } } } }, finish,
  };
  const bytes = Buffer.from(`${JSON.stringify(def, null, 1)}\n`);
  return { id, sha: put(bytes) };
}
const CC0 = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Made by the #157 taste pictures.' };
const rect = (id, box, role, order, extra = {}) => ({ id, kind: 'rect@1', name: `Rect ${id}`, order, params: { box, paint: { fill: { role } } }, ...extra });
const hold = (target, keys) => ({ target, type: 'f32', keys: Object.fromEntries(keys.map(([k, value], i) => [`k${i}`, { t: k * D, value, interp: 'hold' }])) });
function cycle(target, base, period, frames) {
  const keys = {}; let n = 0;
  for (let a = 0; a < frames; a += period) {
    const b = Math.min(a + period - 1, frames - 1);
    keys[`k${n++}`] = { t: a * D, value: base, interp: 'linear' };
    if (b > a) keys[`k${n++}`] = { t: b * D, value: base + (b - a), interp: 'hold' };
  }
  return { target, type: 'f32', keys };
}
// The suite's fixture film: a ground, a side panel, a bar and a tick moving a pixel a frame; `extra` over them.
function film(frames, l, { items = [], channels = {}, checks, plain = false } = {}) {
  const base = plain ? [] : [rect('back', [0, 0, 160, 90], 'ground', 'a001'), rect('side', [0, 0, 64, 90], 'muted', 'a002'), rect('bar', [64, 0, 4, 90], 'accent', 'a003'), rect('tick', [8, 0, 48, 3], 'raised', 'a004')];
  const ch = plain ? {} : { bar_x: cycle('items/bar/params/box/0', 64, 92, frames), tick_y: cycle('items/tick/params/box/1', 0, 87, frames) };
  const all = [{ id: 'cam', kind: 'camera@1', name: 'Camera cam', order: 'a00cam', params: { projection: 'orthographic', target: [80, 45, 0], view_width: 160 } }, ...base, ...items];
  return {
    format: 1, id: 'film-157', profile: 'film', title: 'An export guards picture', description: 'A #157 taste picture.', size: [160, 90], camera: 'cam',
    look: { asset: `${l.id}@1`, theme: 'light' }, transport: { span: frames * D, frame_rate: [24, 1], sample_rate: 48_000 },
    items: Object.fromEntries(all.map((i) => [i.id, i])), channels: { ...ch, ...channels }, assets: { [l.id]: { sha256: l.sha, license: CC0 } }, strips: {},
    ...(checks ? { checks } : {}),
  };
}

const DOC = '01JB157S000000000000000001';
const processes = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3000 }];
function exported(document, ask, planted) {
  const scenario = {
    evidence, sessions: {}, processes, panels: { main: { rect: [0, 0, 1280, 720] } }, docs: { [DOC]: { panel: 'main' } }, ...(planted ? { planted } : {}),
    calls: [{ call: 'deep show', peer: { pid: 3002, start: 3000 }, doc: DOC, document, include: ['issues'] }, { call: 'export', doc: DOC, ...ask }],
  };
  const r = spawnSync(BIN, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0) throw Error(`deep-show run exited ${r.status}: ${r.stderr.slice(-2000)}`);
  const [shown, reply] = JSON.parse(r.stdout.trim().split('\n')[0]).replies;
  if (shown.outcome !== 'presented') throw Error(`the film isn't presented: ${JSON.stringify(shown).slice(0, 1500)}`);
  return reply;
}
const ffmpeg = (args) => { const f = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]); if (f.status !== 0) throw Error(`ffmpeg ${args.join(' ')}: ${f.stderr}`); };
const big = 'scale=iw*4:ih*4:flags=neighbor';
const H264 = { video: { codec: 'h264' }, audio: { codec: 'aac' } };

// The 4-black-frame film, its black span declared, delivered; frames 22 to 29 in a row.
const plainLook = look('film-157');
const black = film(48, plainLook, {
  items: [rect('blackout', [0, 0, 160, 90], 'black', 'a010', { adjust: { opacity: 0 } })],
  channels: { blackout: hold('items/blackout/adjust/opacity', [[0, 0], [24, 1], [28, 0]]) },
  checks: [{ kind: 'film.blank', except: [[24 * D, 28 * D]] }],
});
const blackOut = join(work, 'black', 'film.mp4');
const b = exported(black, { out: blackOut, ...H264 });
if (b.outcome !== 'exported') throw Error(`the black film: ${JSON.stringify(b).slice(0, 1500)}`);
ffmpeg(['-i', blackOut, '-vf', `select=between(n\\,22\\,29),${big},tile=8x1`, '-frames:v', '1', join(HERE, 'black-frames.png')]);

// The grain film: starved (the check's own decode of its worst frame) and at its raised floor.
const grainLook = look('grain-157', {}, [{ grain: { amount: '25%', size: 1, tone: 'flat', rate: 24 } }]);
const grain = film(48, grainLook);
const starved = exported(grain, { out: join(work, 'starved', 'grain.mp4'), ...H264 }, 'encoder_starves_bitrate');
const floor = (starved.issues ?? []).find((i) => i.check === 'export.fidelity' && i.picture);
if (starved.outcome !== 'failed' || !floor) throw Error(`the starved grain film: ${JSON.stringify(starved).slice(0, 1500)}`);
writeFileSync(join(work, 'starved.png'), get(floor.picture));
ffmpeg(['-i', join(work, 'starved.png'), '-vf', big, join(HERE, 'grain-starved.png')]);
const raisedOut = join(work, 'raised', 'grain.mp4');
const raised = exported(grain, { out: raisedOut, ...H264 });
if (raised.outcome !== 'exported') throw Error(`the grain film: ${JSON.stringify(raised).slice(0, 1500)}`);
ffmpeg(['-i', raisedOut, '-vf', `select=eq(n\\,24),${big}`, '-frames:v', '1', join(HERE, 'grain-raised.png')]);

// The ProRes 4444 ramp at 50% alpha with an opaque block sliding over it, over a checkerboard.
const ramp = film(24, plainLook, {
  plain: true,
  items: [
    { id: 'ramp', kind: 'rect@1', name: 'Rect ramp', order: 'a001', params: { box: [0, 0, 160, 90], paint: { fill: { gradient: { kind: 'linear', stops: [{ at: 0, role: 'ramp_lo' }, { at: 1, role: 'ramp_hi' }] } } } }, adjust: { opacity: 0.5 } },
    rect('slider', [0, 30, 16, 16], 'accent', 'a002'),
  ],
  channels: { slide: { target: 'items/slider/params/box/0', type: 'f32', keys: Object.fromEntries(Array.from({ length: 24 }, (_, k) => [`k${k}`, { t: k * D, value: 4 * k, interp: 'linear' }])) } },
});
const rampOut = join(work, 'ramp', 'ramp.mov');
const p = exported(ramp, { out: rampOut, video: { codec: 'prores_4444', alpha: 'straight' }, audio: { codec: 'pcm' } });
if (p.outcome !== 'exported') throw Error(`the ProRes ramp: ${JSON.stringify(p).slice(0, 1500)}`);
ffmpeg(['-f', 'lavfi', '-i', "nullsrc=s=160x90,geq=lum='if(mod(floor(X/8)+floor(Y/8)\\,2)\\,200\\,120)':cb=128:cr=128,format=rgba", '-i', rampOut,
  '-filter_complex', `[1:v]select=eq(n\\,12),setpts=PTS-STARTPTS[f];[0:v][f]overlay=format=auto,${big}`, '-frames:v', '1', join(HERE, 'prores-alpha.png')]);

console.log(`black film: ${b.receipt.frames} frames, film.blank's declared span 24 to 27; grain film: starved fails ${floor.what}; raised floor ${raised.receipt.encoder.quality_floor}, PSNR-Y ${raised.receipt.fidelity.psnr_y}; ProRes alpha ${JSON.stringify(p.receipt.fidelity.alpha)}`);
for (const f of ['black-frames.png', 'grain-starved.png', 'grain-raised.png', 'prores-alpha.png']) console.log(`${sha(readFileSync(join(HERE, f)))}  ${f}`);
rmSync(work, { recursive: true, force: true });
