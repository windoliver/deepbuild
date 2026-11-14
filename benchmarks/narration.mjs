// The narration transcriber's budget (issue #509, #509.39975b5a): node benchmarks/narration.mjs, for the perf lane. A
// 60 s narrated film: twelve lines in the speech plug-in's default voice laid end to end over a quiet bed in a 48 kHz
// mix, and each line's own audio and its mix window (t − 0.15 s to t + its length + 0.25 s, clamped to the mix)
// transcribed by whisper-cpp@1.9.5 on the speech plug-in's model host, the tool of narration.transcript, given the PCM
// and params as the hub gives them, a few calls at once. It prints the wall time of the 24 transcriptions as one JSON
// line. The lines are spoken once by kokoro@0.9.4 on the same host and kept in the temp folder by their hash, so a
// later run times the transcriptions alone. The host must already answer on 127.0.0.1:8720
// (`uv run --script packages/jobs/speech/host/host.py --port 8720`); this never starts or stops it. The issue's 60 s
// limit on the reference Mac stays with the issue's budget test.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';

const HOST = 'http://127.0.0.1:8720';
const ENGINE = 'kokoro@0.9.4';
const VOICE = 'af_heart';
const TRANSCRIBER = 'whisper-cpp@1.9.5';
const MIX_RATE = 48_000;
const FILM = 60;
const LINES = [
  'Every morning the harbour wakes before the town, and the gulls know first.',
  'The fishing boats slip out past the lighthouse while the streets still sleep.',
  'By seven the bakery has filled the square with the smell of bread.',
  'Children cross the bridge in pairs, counting the swans below them.',
  'At noon the market stalls fold away and the traders share lunch.',
  'In the afternoon the tide turns and climbs the old stone steps.',
  'An artist sets her easel by the wall and paints the boats.',
  'The ferry brings visitors who stay for one night and then a week.',
  'At sunset the windows along the quay glow orange, one by one.',
  'Music drifts from the tavern, where three songs have played for forty years.',
  'Late at night the lighthouse keeps watch over the dark and empty sea.',
  'And before the town has finished dreaming, the harbour wakes again.',
];

const post = async (tool, body) => {
  const answer = await fetch(`${HOST}/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await answer.json();
  if (answer.status !== 200) throw Error(`${tool} answered ${answer.status}: ${JSON.stringify(json).slice(0, 500)}`);
  return json.outputs;
};
try {
  await fetch(`${HOST}/report`);
} catch (error) {
  throw Error(`BLOCKED: the speech plug-in's model host doesn't answer on ${HOST} (${error.message}); start it with uv run --script packages/jobs/speech/host/host.py --port 8720`);
}

/** A line's 16-bit mono WAV in the engine's voice, spoken once and kept by its hash. */
async function spoken(say) {
  const dir = join(tmpdir(), 'deep-bench-narration');
  const path = join(dir, `${createHash('sha256').update(`${ENGINE}\n${VOICE}\n${say}`).digest('hex')}.wav`);
  if (!existsSync(path)) {
    const outputs = await post(ENGINE, { params: { say, voice: VOICE, rate: 1 }, inputs: {} });
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${path}.part`, Buffer.from(outputs.audio, 'base64'));
    renameSync(`${path}.part`, path);
  }
  const wav = readFileSync(path);
  const rate = wav.readUInt32LE(24);
  const samples = new Float32Array((wav.length - 44) / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = wav.readInt16LE(44 + 2 * i) / 32768;
  return { rate, samples };
}
const f32 = (x) => {
  const b = Buffer.alloc(4 * x.length);
  for (let i = 0; i < x.length; i++) b.writeFloatLE(x[i], 4 * i);
  return b;
};

const lines = [];
for (const say of LINES) lines.push(await spoken(say));
// The mix: the lines end to end from 0.5 s, each upsampled to 48 kHz, spread across the film, over a bed 30 dB down.
const mix = new Float32Array(FILM * MIX_RATE);
for (let i = 0; i < mix.length; i++) mix[i] = 0.02 * Math.sin((2 * Math.PI * 110 * i) / MIX_RATE) + 0.01 * Math.sin((2 * Math.PI * 165 * i) / MIX_RATE);
const total = lines.reduce((s, l) => s + l.samples.length / l.rate, 0);
const gap = (FILM - 0.5 - total) / LINES.length;
if (gap < 0.2) throw Error(`the lines last ${total.toFixed(1)} s, too long for a ${FILM} s film with a pause between them`);
const windows = [];
let t = 0.5;
for (const { rate, samples } of lines) {
  const at = Math.round(t * MIX_RATE);
  const n = Math.round((samples.length / rate) * MIX_RATE);
  for (let i = 0; i < n && at + i < mix.length; i++) {
    const s = (i * rate) / MIX_RATE;
    const k = Math.floor(s);
    mix[at + i] += samples[Math.min(k, samples.length - 1)] * (1 - (s - k)) + samples[Math.min(k + 1, samples.length - 1)] * (s - k);
  }
  const from = Math.max(0, Math.round((t - 0.15) * MIX_RATE));
  const to = Math.min(mix.length, Math.round((t + samples.length / rate + 0.25) * MIX_RATE));
  windows.push(mix.subarray(from, to));
  t += samples.length / rate + gap;
}
const calls = [
  ...lines.map(({ rate, samples }) => ({ rate, pcm: f32(samples) })),
  ...windows.map((w) => ({ rate: MIX_RATE, pcm: f32(w) })),
];

// whisper.cpp runs each call on 4 threads: as many calls at once as the machine has fours of cores.
const workers = Math.max(1, Math.floor(availableParallelism() / 4));
const heard = [];
const t0 = performance.now();
let next = 0;
await Promise.all(Array.from({ length: workers }, async () => {
  for (let i = next++; i < calls.length; i = next++) {
    const { rate, pcm } = calls[i];
    const outputs = await post(TRANSCRIBER, { params: { sample_rate: rate, channels: 1, locale: 'en', names: [] }, inputs: { pcm: pcm.toString('base64') } });
    heard[i] = JSON.parse(Buffer.from(outputs.transcript, 'base64').toString('utf8')).text;
  }
}));
const ms = Math.round(performance.now() - t0);
const silent = heard.findIndex((text) => !text);
if (silent >= 0) throw Error(`${TRANSCRIBER} heard nothing in call ${silent + 1} of ${calls.length}`);
console.log(JSON.stringify({ task: 'narration-transcript', ms, lines: lines.length, windows: windows.length, film_seconds: FILM, workers }));
