// Draws the #501 taste pictures from the export's own files and the film viewer, through `deep-show run`: the #501
// acceptance suite's film (320 × 180 at 24 fps for 10 s, a block sliding across, section markers at 0 s, 4 s and 7 s,
// a stereo tone), exported as frames [48, 168) to H.264 with timecode from 01:00:00:00, as a still at marker s2, and
// shown in the film viewer paused at frame 100 then stepped with `.`. Writes beside itself:
//   range-export.png     the range export's first frame, decoded from the exported MP4 by ffmpeg
//   still-at-marker.png  the still the export wrote at marker s2
//   viewer-frame-101.png the frame the viewer shows at 101: the export's frame 101, whose BLAKE3 the viewer's hash equals
//   range.apng           the exported MP4 decoded by ffmpeg into an animated PNG
// and prints each SHA-256. Run from the repository root after
// `cargo build --locked --bin deep-show --no-default-features --features full`; needs ffmpeg on PATH.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const BIN = join(REPO, 'target', 'debug', 'deep-show');
const FLICKS = 705_600_000;
const work = mkdtempSync(join(tmpdir(), 'deep-501-shoot-'));
const evidence = join(work, 'evidence');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const put = (bytes) => { const h = sha(bytes); mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true }); writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes); return h; };

// The film's sound: 10 s of 440 Hz and 660 Hz, 16-bit stereo.
function toneWav() {
  const rate = 48_000; const frames = 10 * rate; const data = frames * 4;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8, 'ascii'); b.write('fmt ', 12, 'ascii');
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 4, 28);
  b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36, 'ascii'); b.writeUInt32LE(data, 40);
  for (let i = 0; i < frames; i++) {
    b.writeInt16LE(Math.round(0.25 * Math.sin((2 * Math.PI * 440 * i) / rate) * 32767), 44 + 4 * i);
    b.writeInt16LE(Math.round(0.2 * Math.sin((2 * Math.PI * 660 * i) / rate) * 32767), 46 + 4 * i);
  }
  return b;
}
const tone = put(toneWav());
const LICENSE = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Fixture made by the #501 evidence script.' };
const rect = (id, box, role, order) => ({ id, kind: 'rect@1', name: `Rect ${id}`, order, params: { box, paint: { fill: { role } } } });
const linear = (target, a, b) => ({ target, type: 'f32', keys: { k0: { t: '0s', value: a, interp: 'linear' }, k1: { t: '10s', value: b, interp: 'linear' } } });
const FILM = {
  format: 1, id: 'film', profile: 'film', title: '#501 film', description: 'The #501 export evidence film.', size: [320, 180],
  camera: 'cam', transport: { span: '10s', frame_rate: [24, 1], sample_rate: 48_000 },
  items: Object.fromEntries([
    { id: 'cam', kind: 'camera@1', name: 'Camera cam', order: 'a0cam', params: { projection: 'orthographic', target: [160, 90, 0], view_width: 320 } },
    rect('back', [0, 0, 320, 180], 'ground', 'a1'), rect('mover', [0, 60, 40, 60], 'accent', 'a2'), rect('bar', [0, 150, 8, 12], 'ink', 'a3'),
  ].map((i) => [i.id, i])),
  channels: { slide: linear('items/mover/params/box/0', 0, 280), grow: linear('items/bar/params/box/2', 8, 312) },
  markers: { s1: { kind: 'section', t: '0s', name: 'Open' }, s2: { kind: 'section', t: '4s', name: 'Middle' }, s3: { kind: 'section', t: '7s', name: 'End' } },
  strips: { tone: { track: 1, src: tone, start: '0s', in: 0, out: 10 * FLICKS, rate: 1 } },
  assets: { tone: { sha256: tone, license: LICENSE } },
};

const DOC = '01JB501S000000000000000001';
const out = (name) => join(work, name);
const key = (k, mods = []) => ({ call: 'input', panel: 'main', event: { type: 'key', key: k, mods } });
const calls = [
  { call: 'deep show', peer: { pid: 3002, start: 3000 }, doc: DOC, document: FILM, include: ['issues'] },
  { call: 'export', doc: DOC, out: out('range.mp4'), range: ['48f', '168f'], video: { codec: 'h264' }, audio: { codec: 'aac' }, timecode: { start: '01:00:00:00' } },
  { call: 'export', doc: DOC, out: out('still'), range: { still: { marker: 's2' } }, video: { codec: 'png_seq' } },
  { call: 'export', doc: DOC, out: out('frame-101'), range: ['101f', '102f'], video: { codec: 'png_seq' } },
  { call: 'viewer', panel: 'main' },
];
const scenario = {
  evidence, sessions: {}, panels: { main: { rect: [0, 0, 1280, 720] } }, docs: { [DOC]: { panel: 'main' } },
  processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3000 }],
  calls,
};
// The viewer: paused at frame 100 (4 is frame 96, then four steps), then `.` to 101.
const opened = run({ ...scenario, calls: [calls[0], calls.at(-1)] }).at(-1);
if (opened.viewer?.paused !== true) calls.splice(calls.length - 1, 0, key('k'));
calls.splice(calls.length - 1, 0, key('4'), key('.'), key('.'), key('.'), key('.'), key('.'));
const replies = run(scenario);

function run(sc) {
  const r = spawnSync(BIN, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0) throw Error(`deep-show run exited ${r.status}: ${r.stderr.slice(-2000)}`);
  const answer = JSON.parse(r.stdout.trim().split('\n')[0]);
  if (!answer.ok) throw Error(`deep-show run refused the scenario: ${r.stdout.slice(0, 2000)}`);
  return answer.replies;
}
const [shown, range, still, frame101] = [replies[0], replies[1], replies[2], replies[3]];
const viewer = replies.at(-1).viewer;
if (shown.outcome !== 'presented') throw Error(`the film isn't presented: ${JSON.stringify(shown).slice(0, 1500)}`);
for (const [name, r] of [['range', range], ['still', still], ['frame 101', frame101]]) if (r.outcome !== 'exported') throw Error(`the ${name} export: ${JSON.stringify(r).slice(0, 1500)}`);
if (viewer.frame !== 101 || viewer.hash !== frame101.receipt.frame_hashes[0]) throw Error(`the viewer shows frame ${viewer.frame} (${viewer.hash}), not export frame 101 (${frame101.receipt.frame_hashes[0]})`);

const ffmpeg = (args) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]); if (r.status !== 0) throw Error(`ffmpeg ${args.join(' ')}: ${r.stderr}`); };
const only = (dir) => join(dir, readdirSync(dir).filter((f) => f.endsWith('.png')).sort()[0]);
ffmpeg(['-i', out('range.mp4'), '-frames:v', '1', join(HERE, 'range-export.png')]);
copyFileSync(only(out('still')), join(HERE, 'still-at-marker.png'));
copyFileSync(only(out('frame-101')), join(HERE, 'viewer-frame-101.png'));
ffmpeg(['-i', out('range.mp4'), '-plays', '0', '-f', 'apng', join(HERE, 'range.apng')]);

console.log(`range receipt: ${range.receipt.frames} frames, ${range.receipt.size.join(' × ')}, timecode ${range.receipt.timecode.start} to ${range.receipt.timecode.last}`);
console.log(`viewer at frame ${viewer.frame}, t ${viewer.t}: hash ${viewer.hash} = export frame 101`);
for (const f of ['range-export.png', 'still-at-marker.png', 'viewer-frame-101.png', 'range.apng']) {
  const r = spawnSync('shasum', ['-a', '256', join(HERE, f)], { encoding: 'utf8' });
  console.log(r.stdout.trim().replace(`${HERE}/`, ''));
}
