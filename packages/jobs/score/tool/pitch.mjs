// score.pitch (#154; canvas primitives: Check input: mix kinds, Score: As built): each declared note measured in its
// rendered stem, never read from its event. Over the 4,096 samples from its onset plus its attack (at least 20 ms),
// mixed to mono under a Hann window, it finds the strongest frequency within ±100 cents of the declared pitch in
// 5-cent steps and refines it by a parabola through the peak and its neighbours. A note further than the tolerance
// fails, naming its event; a note whose bend or vibrato moves it inside the window, one that stops sounding before the
// window ends, or a silent window, isn't measured.
import { decode } from './flac.mjs';
import { TAU, cos, exp2, hz, sin } from './math.mjs';

export const TOLERANCE = 35;
const WINDOW = 4096;
const HANN = Float64Array.from({ length: WINDOW }, (_, n) => 0.5 - 0.5 * cos((TAU * n) / (WINDOW - 1)));

/** The magnitude of `x` (windowed) at `f` Hz, by a rotating phasor. */
function magnitude(x, f, rate) {
  const w = (TAU * f) / rate;
  const c = cos(w);
  const s = sin(w);
  let re = 1;
  let im = 0;
  let sr = 0;
  let si = 0;
  for (let n = 0; n < x.length; n++) {
    sr += x[n] * re;
    si -= x[n] * im;
    const r2 = re * c - im * s;
    im = re * s + im * c;
    re = r2;
  }
  return Math.sqrt(sr * sr + si * si);
}

/** Each note of `meta.note_on`: `{event, pitch, cents}`, cents null where it isn't measured. */
export function measure(stemBytes, meta) {
  const d = decode(stemBytes);
  const rate = d.rate;
  const n = d.channels[0].length;
  const mono = new Float64Array(n);
  const scale = 2 ** (d.bps - 1) * d.channels.length;
  for (const ch of d.channels) for (let i = 0; i < n; i++) mono[i] += ch[i] / scale;
  return meta.note_on.map((note) => {
    const attack = Math.max(0.02, note.attack ?? 0);
    const from = note.sample + Math.round(attack * rate);
    const span = WINDOW / rate;
    const startsMoving = (t) => t !== undefined && t < attack + span;
    const bendFrom = Array.isArray(note.bend) && note.bend.length ? (note.bend[0][0] > 0 ? 0 : note.bend[0][0]) : undefined;
    if (startsMoving(bendFrom) || (note.vib && startsMoving(note.vib.from ?? 0))) return { event: note.event, pitch: note.pitch, cents: null };
    // A note that stops sounding inside its window would be measured against the notes after it.
    if (Number.isInteger(note.length) && note.length < from - note.sample + WINDOW) return { event: note.event, pitch: note.pitch, cents: null };
    const x = new Float64Array(WINDOW);
    let energy = 0;
    for (let k = 0; k < WINDOW; k++) {
      x[k] = (mono[from + k] ?? 0) * HANN[k];
      energy += x[k] * x[k];
    }
    if (energy < 1e-10) return { event: note.event, pitch: note.pitch, cents: null };
    const f0 = hz(note.pitch);
    const mags = [];
    for (let c = -100; c <= 100; c += 5) mags.push(magnitude(x, f0 * exp2(c / 1200), rate));
    let k = 0;
    for (let i = 1; i < mags.length; i++) if (mags[i] > mags[k]) k = i;
    let cents = -100 + 5 * k;
    if (k > 0 && k < mags.length - 1) {
      const [a, b, c] = [mags[k - 1], mags[k], mags[k + 1]];
      const den = a - 2 * b + c;
      if (den !== 0) cents += 5 * (0.5 * (a - c)) / den;
    }
    return { event: note.event, pitch: note.pitch, cents: Math.round(cents * 10) / 10 || 0 };
  });
}

/** The notes further than the tolerance from their pitch, each as the message that names its event. */
export function outOfTune(stemBytes, meta) {
  return measure(stemBytes, meta)
    .filter((m) => m.cents !== null && Math.abs(m.cents) > TOLERANCE)
    .map((m) => `score.pitch: the event ${m.event} sounds ${m.cents > 0 ? '+' : ''}${m.cents} cents from its pitch ${m.pitch}, past ±${TOLERANCE}`);
}
