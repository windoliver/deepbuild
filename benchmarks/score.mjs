// A 60 s, six-stem score rendered by score-render@1.0.0, for the perf lane's budgets (issue #154): node
// benchmarks/score.mjs. Each stem is the tool's own process, given its stem's params on stdin as the hub gives them, and
// the six run at once, as six deep_job calls do; it prints the wall time from the first start to the last exit as one
// JSON line. Two stems play takes of a library made here (48 kHz sines with a harmonic each), two are plucked and two
// are synth presets. The issue's 60 s limit and the cache hits stay in tests/acceptance/154/budgets.test.ts.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOL = fileURLToPath(new URL('../packages/jobs/score/tool/render.mjs', import.meta.url));
const RATE = 48_000;
const BEAT = RATE / 2; // 120 BPM

/** A 0.25 s 16-bit mono WAV take at `f` Hz with the harmonic (k + 2) × f, base64. */
function take(f, k) {
  const n = RATE / 4;
  const b = Buffer.alloc(44 + 2 * n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + 2 * n, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(RATE, 24); b.writeUInt32LE(2 * RATE, 28); b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(2 * n, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(9000 * (Math.sin((2 * Math.PI * f * i) / RATE) + 0.5 * Math.sin((2 * Math.PI * (k + 2) * f * i) / RATE))), 44 + 2 * i);
  return b.toString('base64');
}
const takes = [0, 1, 2, 3].map((k) => take(261.63, k));
const sampled = { sampled: { library: 'bench/keys@1.0.0', preset: 'keys', sustained: false, zones: [{ lo: 0, hi: 127, root: 60, takes: [0, 1, 2, 3] }] } };
/** One stem's params: `count` notes `every` beats apart for 60 s on one instrument. */
function stem(name, source, every, pitch, dur) {
  const events = [];
  for (let k = 0; k * every * BEAT < 60 * RATE; k++) events.push({ id: `${name}${k}`, inst: name, at: Math.round(k * every * BEAT), dur, pitch: pitch + (k % 12), vel: 0.5 });
  return { stem: name, seed: 'bench', sample_rate: RATE, format: 'flac', loop: null, credits: [], instruments: { [name]: { source, bass: false } }, events };
}
const stems = [
  [stem('piano', sampled, 1, 60, 12_000), takes],
  [stem('bell', sampled, 2, 72, 12_000), takes],
  [stem('harp', { pluck: { preset: 'harp', overrides: {} } }, 0.5, 60, 9_600), []],
  [stem('guitar', { pluck: { preset: 'nylon', overrides: {} } }, 1, 48, 19_200), []],
  [stem('pad', { synth: { preset: 'pad' } }, 8, 55, 187_200), []],
  [stem('lead', { synth: { preset: 'saw' } }, 1, 67, 19_200), []],
];

const run = ([params, samples]) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [TOOL], { stdio: ['pipe', 'pipe', 'ignore'] });
  let out = 0;
  child.stdout.on('data', (d) => { out += d.length; });
  child.on('error', reject);
  child.on('close', (code) => (code === 0 && out > 0 ? resolve() : reject(Error(`${params.stem} exited ${code}`))));
  child.stdin.end(JSON.stringify({ params, inputs: { samples } }));
});
const t0 = performance.now();
await Promise.all(stems.map(run));
console.log(JSON.stringify({ ms: Math.round(performance.now() - t0) }));
