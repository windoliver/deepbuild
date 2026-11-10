// The criteria's fixtures (README: Fixtures): the shot lab and the door, each as a `deep-logic` piece (the logic
// item alone) and as a `deep-show` document (the logic item with its readers), and the door's reference documents.
// Every document is a #391 film envelope as #501's suite writes one: a 2D camera, a ground, its items, presented
// from your shell (the hub stamps the writer layer).

import { DOOR_STEP, latch, shot } from './programs.ts';
import { FLICKS, RATE, SILENCE, fit, peak, press, piece, putEvidence, secs, sOf, useTemp, type Emits, type Entry, type JsonObject, type Pcm } from './helpers.ts';

const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #544 acceptance tests.' };
const SEED = 544;

function rect(id: string, box: [number, number, number, number], role: string, order: string, extra: JsonObject = {}): JsonObject {
  return { id, kind: 'rect@1', name: `Rect ${id}`, order, params: { box, paint: { fill: { role } } }, ...extra };
}
function camera2d(size: [number, number]): JsonObject {
  return { id: 'cam', kind: 'camera@1', name: 'Camera cam', order: 'a0cam', params: { projection: 'orthographic', target: [size[0] / 2, size[1] / 2, 0], view_width: size[0] } };
}
function film(id: string, size: [number, number], items: JsonObject[], extra: JsonObject): JsonObject {
  return {
    format: 1, id, profile: 'film', title: `#544 ${id}`, description: `The #544 acceptance tests' document ${id}.`, size, seed: SEED, camera: 'cam',
    items: Object.fromEntries([camera2d(size), rect('back', [0, 0, size[0], size[1]], 'ground', 'a1'), ...items].map((i) => [String(i['id']), i])),
    ...extra,
  };
}
/** A logic item in a document (Logic `logic@1`): its program by SHA-256 (in the evidence store and `assets`). */
function logicItem(id: string, program: string, params: JsonObject): JsonObject {
  return { id, kind: 'logic@1', name: `Logic ${id}`, order: 'a9', params: { program, step_rate: 60, ...params } };
}

// ---------------------------------------------------------------------------------------------------
// The shot lab (criteria 1 and 5)

export const LAB = 'lab';
const FIRE = 'fire';
export const SPAWN = 'shots';
const LAB_EMITS: Emits = { shot: { fields: { power: 'f64' } } };
/** The steps Fire is pressed at: 1.000, 2.000 … 10.000 s at 60 Hz. */
export const PRESS_STEPS = Array.from({ length: 10 }, (_, i) => 60 * (i + 1));
/** The presses, stamped at 1.000, 2.000 … 10.000 s. */
export const labTrack = (): Entry[] => PRESS_STEPS.map((k) => press(FIRE, k));
/** The lab's span, 11 s: 660 steps at 60 Hz, 660 frames at 60 fps, 528,000 samples at 48 kHz. */
export const LAB_SPAN = secs(11);
export const LAB_STEPS = 660;
/** The spawn's one template: a 0.25 s mono 1 kHz cosine at 0.5 (12,000 samples), from its first sample. */
export const VOICE_FRAMES = 12_000;
export const labPiece = (): JsonObject => piece({ seed: SEED, controls: [FIRE], items: { [LAB]: { program: shot(), reads: [FIRE], emits: LAB_EMITS } } });
/**
 * The lab as a document: the logic item `lab` reading the press control `fire` and declaring `shot {power: f64}`,
 * and the spawn `shots` on `lab.occurrences` filtered to shot, playing the tone; `gain` is the spawn's gain
 * expression over the occurrence's fields, when given (criterion 5).
 */
export function labDoc(programSha: string, toneSha: string, gain?: string): JsonObject {
  return film('lab', [64, 36], [logicItem(LAB, programSha, { reads: [FIRE], emits: LAB_EMITS as unknown as JsonObject })], {
    transport: { span: '11s', frame_rate: [60, 1], sample_rate: 48_000 },
    controls: { [FIRE]: { kind: 'press', class: 'document', label: 'Fire', role: 'button' } },
    spawns: {
      [SPAWN]: {
        on: { list: `${LAB}.occurrences`, kinds: ['shot'] },
        play: { src: { asset: toneSha }, in: 0, out: secs(0.25) },
        ...(gain === undefined ? {} : { gain }),
      },
    },
    assets: { lab_program: { sha256: programSha, license: LICENSE }, shot_tone: { sha256: toneSha, license: LICENSE } },
  });
}

/** The first sample of the voice of the press at step k: its step's time, k ÷ 60 s, at 48 kHz (800 samples a step). */
export const voiceSample = (k: number): number => k * (RATE / 60);
/**
 * Criterion 1's judgement of the lab's sound over [0, 11 s): each press's voice starts at its step's time to the
 * sample. Before each voice, from the end of the one before (from 0 for the first), every sample is silent; from its
 * first sample its 12,000 samples are the template's, one gain a channel (least squares, relative residual ≤ 1e-4),
 * and audible (a gain over 0.1); after the last voice, silence to the end. Each failure names the voice's step.
 */
export function voiceFailures(p: Pcm, template: Float32Array, what: string): string[] {
  const failures: string[] = [];
  let quietFrom = p.first;
  for (const k of PRESS_STEPS) {
    const s = voiceSample(k);
    const at = `the voice of the press at step ${k} (${sOf(k * (FLICKS / 60))}, sample ${s})`;
    const early = peak(p, quietFrom, s);
    if (early > SILENCE) failures.push(`${what}: before ${at}, from sample ${quietFrom}, the mix isn't silent (peak ${early})`);
    const gains: number[] = [];
    for (let ch = 0; ch < p.channels.length; ch++) {
      const f = fit(p, ch, s, s + VOICE_FRAMES, (n) => template[n - s] ?? 0);
      gains.push(Math.abs(f.k));
      if (!(f.residual <= 1e-4)) failures.push(`${what}: ${at} doesn't start there: channel ${ch} over its 12,000 samples is not the template's (relative residual ${f.residual}, gain ${f.k})`);
    }
    if (!(Math.max(...gains) > 0.1)) failures.push(`${what}: ${at} is silent (gains ${gains.join(', ')})`);
    quietFrom = s + VOICE_FRAMES;
  }
  const late = peak(p, quietFrom, p.first + p.frames);
  if (late > SILENCE) failures.push(`${what}: after the last voice, from sample ${quietFrom}, the mix isn't silent (peak ${late})`);
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// The door (criteria 3 and 4)

export const LATCH = 'latch';
export const DOOR_KIND = 'door_open';
export const PLACEMENT = 'swing';
const DOOR_EMITS: Emits = { [DOOR_KIND]: { fields: {} } };
/** The door's span, 8 s: 480 steps at 60 Hz. */
export const DOOR_STEPS = 480;
/** door_open's step, 300, and its time, 5.000 s. */
export { DOOR_STEP };
export const DOOR_T = DOOR_STEP * (FLICKS / 60);
/** The time the criterion reads the door at: 6.000 s. */
export const T6 = secs(6);
export const latchPiece = (): JsonObject => piece({ seed: SEED, items: { [LATCH]: { program: latch(), emits: DOOR_EMITS } } });
/** A fresh evidence store per call, holding the latch's program; deleted after the test. */
export function useDoorEvidence(): () => { ev: string; program: string } {
  const temp = useTemp();
  return () => { const ev = temp(); return { ev, program: putEvidence(ev, latch().bytes) }; };
}

/**
 * The 2 s door clip: the panel's x is its own time × 50 (0 at its start, 50 at 1.000 s in, 100 at its end), so a frame
 * shows how far into the clip it is. The panel stands at x = 140 when no run plays.
 */
const DOOR_CLIP: JsonObject = {
  span: '2s',
  channels: { x: { target: 'slot:s/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '2s', value: 100, interp: 'linear' } } } },
};
const panel = (): JsonObject => rect('panel', [0, 30, 20, 30], 'accent', 'a2', { at: { pos: [140, 0, 0] } });
const DOOR_TRANSPORT: JsonObject = { span: '8s', frame_rate: [60, 1] };

/** The door: the logic item `latch` declaring door_open, and the placement `swing` of the door clip on the panel,
 * started on `latch.occurrences` filtered to `kinds` (door_open unless a test misspells it), policy restart. */
export function doorDoc(programSha: string, kinds: string[] = [DOOR_KIND]): JsonObject {
  return film('door', [160, 90], [panel(), logicItem(LATCH, programSha, { emits: DOOR_EMITS as unknown as JsonObject })], {
    transport: DOOR_TRANSPORT,
    clips: { door: DOOR_CLIP },
    placements: { [PLACEMENT]: { clip: 'door', slots: { s: 'panel' }, start_on: { on: { list: `${LATCH}.occurrences`, kinds }, policy: 'restart' } } },
    assets: { latch_program: { sha256: programSha, license: LICENSE } },
  });
}
/** The door's picture with no logic: the same clip placed to start at `start` (5 s: 1.000 s in at 6 s; 6 s: 0 s in). */
export function doorRefDoc(start: '5s' | '6s'): JsonObject {
  return film(`door-at-${start}`, [160, 90], [panel()], {
    transport: DOOR_TRANSPORT,
    clips: { door: DOOR_CLIP },
    placements: { [PLACEMENT]: { clip: 'door', slots: { s: 'panel' }, start } },
  });
}
