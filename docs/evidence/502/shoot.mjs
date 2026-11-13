// Draws the #502 taste pictures from the export's own files, through `deep-show run`: the #502 acceptance suite's
// fixture film (tests/acceptance/502/fixtures/film.json: 480 × 270 at 24 fps for 12 s, three spoken lines, one
// caption-only line, music ducked under the voice), its words spoken here by `say -v Samantha` and put at the samples
// the fixture fixes, exported at r128 with open captions and again closed. Writes beside itself:
//   open-frame-60.png    frame 60 of the open export (inside caption intro.1), decoded from the MP4 by ffmpeg
//   open-frame-270.png   frame 270 of the open export (inside the caption-only line's caption, note.1)
//   closed-frame-60.png  frame 60 of the closed export: the same picture with no caption drawn
//   captions.apng        the open export decoded by ffmpeg into an animated PNG: the captions appearing in time
// and prints each SHA-256, the receipt's loudness and the open export's .srt. Run from the repository root after
// `cargo build --locked --bin deep-show`; needs ffmpeg on PATH and the Samantha voice.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const BIN = join(REPO, 'target', 'debug', 'deep-show');
const FIXTURE = JSON.parse(readFileSync(join(REPO, 'tests', 'acceptance', '502', 'fixtures', 'film.json'), 'utf8'));
const RATE = 48_000;
const SAMPLE = 705_600_000 / RATE;
const work = mkdtempSync(join(tmpdir(), 'deep-502-shoot-'));
const evidence = join(work, 'evidence');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const put = (bytes) => { const h = sha(bytes); mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true }); writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes); return h; };
const pcm = (x) => Buffer.from(x.buffer, x.byteOffset, x.byteLength);
function wav(x) {
  const b = Buffer.alloc(44);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + 4 * x.length, 4); b.write('WAVEfmt ', 8, 'ascii'); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(3, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 4, 28); b.writeUInt16LE(4, 32);
  b.writeUInt16LE(32, 34); b.write('data', 36, 'ascii'); b.writeUInt32LE(4 * x.length, 40);
  return Buffer.concat([b, pcm(x)]);
}
// One word spoken alone, cut to its samples above −50 dBFS.
function word(text) {
  const out = join(work, 'word.wav');
  execFileSync('say', ['-v', 'Samantha', '-o', out, '--file-format=WAVE', `--data-format=LEF32@${RATE}`, text], { stdio: 'pipe' });
  const bytes = readFileSync(out);
  let at = 12;
  while (bytes.toString('ascii', at, at + 4) !== 'data') at += 8 + bytes.readUInt32LE(at + 4) + (bytes.readUInt32LE(at + 4) % 2);
  const n = Math.floor(bytes.readUInt32LE(at + 4) / 4);
  const x = Float32Array.from({ length: n }, (_, i) => bytes.readFloatLE(at + 8 + 4 * i));
  const floor = 10 ** (-50 / 20);
  let a = 0; while (a < n && Math.abs(x[a]) <= floor) a++;
  let b = n; while (b > a && Math.abs(x[b - 1]) <= floor) b--;
  return x.slice(a, b);
}
// Each recording: its words at the samples the fixture fixes; its words record from those same times.
const document = structuredClone(FIXTURE.document);
for (const [asset, spec] of Object.entries(FIXTURE.recordings)) {
  const x = new Float32Array(spec.samples);
  for (const w of spec.words) {
    const c = word(w.text);
    const n = Math.min(c.length, w.end - w.start);
    for (let i = 0; i < n; i++) x[w.start + i] = spec.gain * c[i];
    if (c.length > n) for (let i = 0; i < Math.min(240, n); i++) x[w.start + n - 1 - i] *= i / Math.min(240, n);
  }
  const record = { kind: 'bake.words', analyzer: 'charsiu-aligner@1.0.0', weights: [], pcm_sha256: sha(pcm(x)), frame: 7_056_000,
    words: spec.words.map((w) => ({ text: w.text.toLowerCase(), start: w.start * SAMPLE, end: w.end * SAMPLE, phonemes: [] })) };
  document.assets[asset].sha256 = put(wav(x));
  document.assets[asset].attached = [put(Buffer.from(JSON.stringify(record)))];
}
// The music: a chord pad at the fixture's level.
const bed = new Float32Array(FIXTURE.music.seconds * RATE);
const notes = [220, 261.63, 329.63, 110];
for (let i = 0; i < bed.length; i++) bed[i] = notes.reduce((v, f) => v + Math.sin((2 * Math.PI * f * i) / RATE), 0);
const rms = Math.sqrt(bed.reduce((s, v) => s + v * v, 0) / bed.length);
for (let i = 0; i < bed.length; i++) bed[i] *= 10 ** (FIXTURE.music.rms_dbfs / 20) / rms;
const music = put(wav(bed));
document.assets[FIXTURE.music.asset].sha256 = music;
document.strips.music.src = music;

const DOC = '01JB502S000000000000000001';
const out = (name) => join(work, name, 'film.mp4');
const ask = (mode) => ({ call: 'export', doc: DOC, out: out(mode), video: { codec: 'h264' }, audio: { codec: 'aac' }, loudness_profile: 'r128', captions: { mode, files: ['srt', 'vtt'] } });
const scenario = {
  evidence, sessions: {}, panels: { main: { rect: [0, 0, 1280, 720] } }, docs: { [DOC]: { panel: 'main' } },
  processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3000 }],
  calls: [{ call: 'deep show', peer: { pid: 3002, start: 3000 }, doc: DOC, document, include: ['issues'] }, ask('open'), ask('closed')],
};
const r = spawnSync(BIN, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
if (r.status !== 0) throw Error(`deep-show run exited ${r.status}: ${r.stderr.slice(-2000)}`);
const [shown, open, closed] = JSON.parse(r.stdout.trim().split('\n')[0]).replies;
if (shown.outcome !== 'presented') throw Error(`the film isn't presented: ${JSON.stringify(shown).slice(0, 1500)}`);
for (const [name, e] of [['open', open], ['closed', closed]]) if (e.outcome !== 'exported') throw Error(`the ${name} export: ${JSON.stringify(e).slice(0, 1500)}`);

const ffmpeg = (args) => { const f = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]); if (f.status !== 0) throw Error(`ffmpeg ${args.join(' ')}: ${f.stderr}`); };
const frame = (from, k, to) => ffmpeg(['-i', from, '-vf', `select=eq(n\\,${k})`, '-frames:v', '1', join(HERE, to)]);
frame(out('open'), 60, 'open-frame-60.png');
frame(out('open'), 270, 'open-frame-270.png');
frame(out('closed'), 60, 'closed-frame-60.png');
ffmpeg(['-i', out('open'), '-plays', '0', '-f', 'apng', join(HERE, 'captions.apng')]);

const o = open.receipt;
console.log(`open receipt: ${o.frames} frames, ${o.size.join(' × ')}, ${o.loudness_profile}: ${o.integrated.toFixed(2)} LUFS, ${o.true_peak.toFixed(2)} dBTP, LRA ${o.lra.toFixed(2)} LU, gain ${o.gain.toFixed(2)} dB, limiter cut: ${o.limiter_cut}`);
console.log(`closed frames equal the open export's outside its captions: ${o.frame_hashes.filter((h, k) => h === closed.receipt.frame_hashes[k]).length} of ${o.frames} equal`);
console.log(readFileSync(join(work, 'open', 'film.srt'), 'utf8'));
for (const f of ['open-frame-60.png', 'open-frame-270.png', 'closed-frame-60.png', 'captions.apng']) console.log(`${sha(readFileSync(join(HERE, f)))}  ${f}`);
