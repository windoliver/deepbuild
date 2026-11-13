// The #1819 fixtures, written by the tests at run time, each with its truth by construction and never from an
// analyzer: a 10 s line of seventeen words, each spoken alone by macOS `say` and laid end to end at known samples;
// three spoken phrases between 1 s silences over a synthesized music bed; and two click tracks. Every
// fixture is one channel of 32-bit float samples, so its decoded PCM is its samples exactly (deep-codecs' WAVE reader
// keeps IEEE floats as they are), and the test knows the PCM's bytes and hash before any bake does. Node built-ins and
// `say` only; no network.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Flicks a second (Time and the flick). */
export const FLICKS = 705_600_000;
/** The voice every spoken fixture uses: present on macOS since 10.7. */
export const VOICE = 'Samantha';
export const SPEECH_RATE = 16_000;
export const CLICK_RATE = 48_000;

export const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** The PCM's bytes as the design hashes them: interleaved f32, little-endian. */
export function pcmBytes(x: Float32Array): Uint8Array {
  const b = Buffer.alloc(x.length * 4);
  for (let i = 0; i < x.length; i++) b.writeFloatLE(x[i]!, 4 * i);
  return new Uint8Array(b);
}

/** One channel as a 32-bit IEEE-float WAVE file. */
export function wavF32(x: Float32Array, rate: number): Uint8Array {
  const data = pcmBytes(x);
  const b = Buffer.alloc(44);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + data.length, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(32, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(data.length, 40);
  return new Uint8Array(Buffer.concat([b, data]));
}

/** A float WAVE file's samples (the `data` chunk; `say` adds chunks of its own). */
function readF32(bytes: Buffer): Float32Array {
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = bytes.toString('ascii', at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    if (id === 'data') {
      const x = new Float32Array(size / 4);
      for (let i = 0; i < x.length; i++) x[i] = bytes.readFloatLE(at + 8 + 4 * i);
      return x;
    }
    at += 8 + size + (size % 2);
  }
  throw Error('the say output has no data chunk');
}

/** `text` spoken by `say -v Samantha`, one channel of f32 at `rate`; throws BLOCKED when the voice can't speak. */
export function say(text: string, rate = SPEECH_RATE): Float32Array {
  const dir = mkdtempSync(join(tmpdir(), 'deep-1819-say-'));
  try {
    const out = join(dir, 'line.wav');
    try {
      execFileSync('say', ['-v', VOICE, '-o', out, '--file-format=WAVE', `--data-format=LEF32@${rate}`, text], { stdio: 'pipe' });
    } catch (e) {
      throw Error(`BLOCKED: macOS say -v ${VOICE} could not write ${JSON.stringify(text)} (${(e as Error).message}); install the ${VOICE} voice in System Settings, Spoken Content`);
    }
    return readF32(readFileSync(out));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The first and one past the last sample whose magnitude exceeds `floor`. */
function extent(x: Float32Array, floor: number): [number, number] {
  let a = 0;
  while (a < x.length && Math.abs(x[a]!) <= floor) a++;
  let b = x.length;
  while (b > a && Math.abs(x[b - 1]!) <= floor) b--;
  if (b <= a) throw Error('a spoken clip is silent');
  return [a, b];
}

// ---------------------------------------------------------------------------------------------------------------
// AC1 and AC4: the line.

/**
 * The line's text, seventeen words, each starting with s, sh, m or n after a word that ends on another sound (a vowel,
 * r, l, z, m or n), so every junction between two words is a change of sound in the waveform.
 */
export const LINE_TEXT = 'seven shiny silver salmon swim slowly so many sunny mornings mellow summer seas mostly shimmer near sunset';
/** −50 dBFS: where a word's audio starts and ends. */
const WORD_FLOOR = 10 ** (-50 / 20);

export interface Line {
  rate: number;
  samples: Float32Array;
  text: string;
  /** Each word in order, and the sample its audio starts and ends at. */
  words: { text: string; start: number; end: number }[];
}

/**
 * The 10 s line: each word spoken alone by `say`, cut to the samples between its first and last above −50 dBFS, and
 * the cuts laid end to end, centred in 10 s of silence, so the words run on like a spoken line with about a second of
 * silence before and after. A word's known start is the sample its cut begins at, where the word before it ends.
 */
export function wordsLine(): Line {
  const rate = SPEECH_RATE;
  const total = 10 * rate;
  const clips = LINE_TEXT.split(' ').map((w) => {
    const x = say(w, rate);
    const [a, b] = extent(x, WORD_FLOOR);
    return { text: w, x: x.subarray(a, b) };
  });
  const spoken = clips.reduce((n, c) => n + c.x.length, 0);
  if (spoken > total - rate) throw Error(`the line's words take ${spoken / rate} s, leaving under 1 s of the 10 s around them`);
  const samples = new Float32Array(total);
  const words: Line['words'] = [];
  let at = Math.floor((total - spoken) / 2);
  for (const c of clips) {
    samples.set(c.x, at);
    words.push({ text: c.text, start: at, end: at + c.x.length });
    at += c.x.length;
  }
  return { rate, samples, text: LINE_TEXT, words };
}

// ---------------------------------------------------------------------------------------------------------------
// AC3: three phrases between 1 s silences, over music.

export const PHRASES = ['many lions sang near our mill', 'summer evenings rolled on slowly', 'morning rain fell on the lawn'];
/** −40 dBFS: where a phrase is cut. */
const PHRASE_FLOOR = 10 ** (-40 / 20);
/** The music bed's level, −35 dBFS RMS. */
export const MUSIC_RMS = 10 ** (-35 / 20);

export interface Speech {
  rate: number;
  samples: Float32Array;
  /** Each phrase's first sample and one past its last. */
  spans: { start: number; end: number }[];
}

/**
 * A chord pad, Am F C G for 2.5 s each and round again, its notes sines with two quieter harmonics and a bass an octave
 * below the root, faded 50 ms at each chord's change, scaled to MUSIC_RMS over its length. No noise and no syllable-rate
 * movement: music, not speech.
 */
export function music(seconds: number, rate: number): Float32Array {
  const chords = [[220, 261.63, 329.63], [174.61, 220, 261.63], [261.63, 329.63, 392], [196, 246.94, 293.66]];
  const n = Math.round(seconds * rate);
  const x = new Float32Array(n);
  const hold = 2.5 * rate;
  const fade = 0.05 * rate;
  for (let i = 0; i < n; i++) {
    const k = Math.floor(i / hold);
    const into = i - k * hold;
    const g = Math.min(1, into / fade, (hold - into) / fade);
    const notes = chords[k % chords.length]!;
    const t = i / rate;
    let v = 0;
    for (const f of [...notes, notes[0]! / 2]) v += Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t) + 0.1 * Math.sin(6 * Math.PI * f * t);
    x[i] = g * v;
  }
  let energy = 0;
  for (const v of x) energy += v * v;
  const scale = MUSIC_RMS / Math.sqrt(energy / n);
  for (let i = 0; i < n; i++) x[i]! *= scale;
  return x;
}

/**
 * The phrases, each spoken by `say` and cut to the samples between its first and last above −40 dBFS with 5 ms fades
 * inside the cut, laid from 1 s with 1 s between them and at least 1 s after the last, over music() for the whole
 * length, which is a whole number of 512-sample frames (so a model's frames read forward and backward fall on the same
 * samples). A span's known edges are its cut's first sample and one past its last.
 */
export function speechUnderMusic(): Speech {
  const rate = SPEECH_RATE;
  const second = rate;
  const cuts = PHRASES.map((p) => {
    const x = say(p, rate);
    const [a, b] = extent(x, PHRASE_FLOOR);
    const c = Float32Array.from(x.subarray(a, b));
    const f = Math.round(0.005 * rate);
    for (let i = 0; i < f; i++) {
      const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / f);
      c[i]! *= g;
      c[c.length - 1 - i]! *= g;
    }
    return c;
  });
  const total = Math.ceil((second + cuts.reduce((n, c) => n + c.length + second, 0)) / 512) * 512;
  const samples = music(total / rate, rate);
  const spans: Speech['spans'] = [];
  let at = second;
  for (const c of cuts) {
    for (let i = 0; i < c.length; i++) samples[at + i]! += c[i]!;
    spans.push({ start: at, end: at + c.length });
    at += c.length + second;
  }
  return { rate, samples, spans };
}

// ---------------------------------------------------------------------------------------------------------------
// AC2: click tracks.

export interface Clicks { rate: number; samples: Float32Array; bpm: number; clicks: number[] }

/**
 * A 30 s click track at `bpm`: a click every 60 ÷ bpm s from 0.5 s, each 20 ms of a decaying sine (1.2 kHz, 2 kHz and
 * louder on every fourth) over 1 ms of noise, at 48 kHz, so each click lies on a whole sample (0.6 s and 0.625 s are
 * 28,800 and 30,000 samples).
 */
export function clickTrack(bpm: number, seconds = 30, rate = CLICK_RATE): Clicks {
  const n = Math.round(seconds * rate);
  const x = new Float32Array(n);
  const period = (60 / bpm) * rate;
  const clicks: number[] = [];
  let seed = 1819;
  const noise = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 1_073_741_824) - 1;
  for (let k = 0; ; k++) {
    const at = Math.round(0.5 * rate + k * period);
    if (at + 0.02 * rate > n) break;
    clicks.push(at);
    const down = k % 4 === 0;
    const f = down ? 2000 : 1200;
    const a = down ? 0.8 : 0.6;
    for (let i = 0; i < 0.02 * rate; i++) {
      const t = i / rate;
      x[at + i]! += a * Math.exp(-t / 0.004) * Math.sin(2 * Math.PI * f * t) + (i < 0.001 * rate ? 0.3 * noise() : 0);
    }
  }
  return { rate, samples: x, bpm, clicks };
}
