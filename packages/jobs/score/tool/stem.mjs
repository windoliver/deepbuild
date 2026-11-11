// One stem of a score rendered (#154; canvas primitives: Score, As built). Every draw is SHA-256 of (score seed,
// event ID, purpose), never a stream, so a note added to the stem changes no other note's noise or detune. The round
// robin is a fold over each instrument's notes in onset order, ties by event ID: a note starts from its take draw mod
// n and moves to the next take when that would repeat the instrument's previous take, so a new note moves only the
// takes after it on its own instrument. Notes are summed in that order, so the bytes are one per build everywhere.
// With a loop region, everything past its end is folded onto its start (modulo its length) and the stem ends there.
import { createHash } from 'node:crypto';
import { encode } from './flac.mjs';
import { amp, cos, sin } from './math.mjs';
import { DEFAULTS, voice } from './voices.mjs';
import { take as readTake } from './wav.mjs';

export const TOOL = 'score-render';
export const VERSION = '1.0.0';
const FULL = 8388608; // 2^23, a 24-bit sample's full scale

/** The draw for (seed, event, purpose): the first 64 bits of their SHA-256, as a whole number. */
export function draw(seed, event, purpose) {
  const h = createHash('sha256').update(`${seed}\u0000${event}\u0000${purpose}`).digest();
  return h.readBigUInt64BE(0);
}

const order = (a, b) => (a.at !== b.at ? a.at - b.at : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The zone of a sampled preset that plays `pitch`: the one whose range holds it, else the one whose root is nearest. */
function zoneOf(zones, pitch) {
  const m = Math.round(pitch);
  const inside = zones.find((z) => z.lo <= m && m <= z.hi);
  if (inside) return inside;
  let best = zones[0];
  for (const z of zones) if (Math.abs(z.root - pitch) < Math.abs(best.root - pitch)) best = z;
  return best;
}

/**
 * The stem's FLAC and its meta, from its params and its takes' bytes; `progress(done, total)` is told as notes are
 * rendered.
 */
export function render(params, samples, progress = () => undefined) {
  const rate = params.sample_rate;
  const events = [...params.events].sort(order);
  const decoded = new Map();
  const takeOf = (index) => {
    if (!decoded.has(index)) {
      if (!samples[index]) throw Error(`the plan names take ${index}, and ${samples.length} takes were given`);
      decoded.set(index, readTake(samples[index]));
    }
    return decoded.get(index);
  };

  // The round robin: each instrument's previous take, folded in onset order.
  const previous = new Map();
  const notes = events.map((e) => {
    const inst = params.instruments[e.inst];
    if (!inst) throw Error(`the event ${e.id} names the instrument ${e.inst}, which the stem doesn't hold`);
    const src = inst.source;
    const kind = src.sampled ? 'sampled' : src.pluck ? 'pluck' : src.synth?.preset;
    const d = DEFAULTS[kind] ?? DEFAULTS.sine;
    const draws = { take: draw(params.seed, e.id, 'take'), noise: draw(params.seed, e.id, 'noise'), detune: draw(params.seed, e.id, 'detune') };
    let take = null;
    let played;
    if (src.sampled) {
      const zone = zoneOf(src.sampled.zones, e.pitch);
      const n = zone.takes.length;
      let k = Number(draws.take % BigInt(n));
      if (n > 1 && zone.takes[k] === previous.get(e.inst)) k = (k + 1) % n;
      previous.set(e.inst, zone.takes[k]);
      take = k;
      played = { ...takeOf(zone.takes[k]), root: zone.root };
    }
    const attackN = Math.round((e.attack ?? d.attack) * rate);
    const releaseN = Math.round((e.release ?? d.release) * rate);
    const level = (e.vel ?? 0.8) * amp(e.gain ?? 0);
    return { e: { ...e, attackN, durN: e.dur, releaseN, level }, src, draws, take, played };
  });

  let length = 0;
  for (const n of notes) length = Math.max(length, n.e.at + n.e.durN + n.e.releaseN);
  const loop = params.loop ?? null;
  if (loop) length = Math.max(length, loop.end);
  const L = new Float64Array(length);
  const R = new Float64Array(length);
  // A note that starts before the loop region and rings into it fades out over 5 ms at the region's start, so
  // the region repeats only its own notes and their folded tails.
  const FADE = Math.round(rate / 200);
  notes.forEach((n, i) => {
    const mono = new Float64Array(n.e.durN + n.e.releaseN);
    voice(mono, n.src, n.e, rate, n.draws, n.played);
    if (loop && n.e.at < loop.start) {
      const cut = loop.start - n.e.at;
      for (let k = Math.max(0, cut - FADE); k < mono.length; k++) mono[k] *= k >= cut ? 0 : (cut - k) / FADE;
    }
    // Equal power: the pan's angle from 0 (left) to π/2 (right).
    const angle = (((n.e.pan ?? 0) + 1) * Math.PI) / 4;
    const gl = cos(angle);
    const gr = sin(angle);
    for (let k = 0; k < mono.length; k++) {
      L[n.e.at + k] += mono[k] * gl;
      R[n.e.at + k] += mono[k] * gr;
    }
    if ((i + 1) % 64 === 0 || i + 1 === notes.length) progress(i + 1, notes.length);
  });

  let end = length;
  if (loop) {
    const span = loop.end - loop.start;
    for (let i = loop.end; i < length; i++) {
      const j = loop.start + ((i - loop.end) % span);
      L[j] += L[i];
      R[j] += R[i];
    }
    end = loop.end;
  }
  const q = (x) => Math.max(-FULL, Math.min(FULL - 1, Math.round(x * FULL)));
  const li = new Float64Array(end);
  const ri = new Float64Array(end);
  for (let i = 0; i < end; i++) { li[i] = q(L[i]) || 0; ri[i] = q(R[i]) || 0; }
  const stem = encode([li, ri], rate, 24, loop);

  const sha = (b) => createHash('sha256').update(b).digest('hex');
  const meta = {
    stem: params.stem,
    sample_rate: rate,
    length: end,
    loop,
    note_on: notes.map((n) => ({ event: n.e.id, sample: n.e.at, pitch: n.e.pitch, take: n.take, attack: n.e.attackN / rate, ...(Array.isArray(n.e.bend) && n.e.bend.length ? { bend: n.e.bend } : {}), ...(n.e.vib ? { vib: n.e.vib } : {}) })),
    credits: params.credits ?? [],
    made_by: { tool: TOOL, version: VERSION, synthetic: true, made_from: samples.map((b) => ({ name: 'samples', sha256: sha(b) })) },
  };
  return { stem, meta };
}
