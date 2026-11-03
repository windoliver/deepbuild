// AC10: under a look whose time.state is {0.25 s, ease in_out_cubic}, a transition follow with neither span nor
// interp moves a toggle knob from 17 to 47 through 18.875 at 0.0625 s and 32 at 0.125 s after its entry, and a
// stage glide with no ease of its own covers half its path at half its span; switching the shot's look to one
// whose state ease is out_cubic reads 43.25 at 0.125 s while the document's hash stays the same; and a planted
// reader that falls back to linear reads 32 at 0.125 s under the out_cubic look and fails, naming the look.
//
// `deep-motion eval` evaluates fixtures/knob.json, whose knob's x follows the toggle `power` by a transition
// follow naming no span or interp, and whose stage b's shot glides in over 0.8 s naming no ease, with (new) the
// look it is shown in (`look`, which every shot naming no look of its own takes) and the input track (`track`:
// the toggle on at 1 s, stage b at 2 s). Each frame answers the knob's channel and item, and (new) each camera's
// pose; the answer carries (new) `hash`, the document's revision hash. The two looks are the clean look with
// `time.state` set: "calm" in_out_cubic, "brisk" out_cubic, both 0.25 s. in_out_cubic(u) = 4u³ below ½,
// 1 − (−2u + 2)³ ÷ 2 above; out_cubic(u) = 1 − (1 − u)³ (the easings CSS and Penner name so): at u = ¼ and ½,
// 17 + 30 × ease(u) gives 18.875 and 32, and out_cubic at ½ gives 43.25. The wrong program: `planted:
// "state_ease_linear"`, a reader that takes time.state's ease as linear. At the base, a channel with `follow`,
// controls, shots and a look in eval are all unknown.
import { describe, expect, it } from 'vitest';
import {
  MOTION_BIN, arr, clone, fixture, num, obj, one, sec, shippedLook, shown, str, useBinaries, type JsonObject,
} from './helpers.ts';

useBinaries('deep-motion', 'deep-canvas-render');

const ENTRY = sec(1);
const STAGE = sec(2);
const GLIDE = sec(0.8);
const TRACK = [
  { t: ENTRY, seq: 0, control: 'power', value: true, writer: 'you' },
  { t: STAGE, seq: 1, control: 'steps', value: 'b', writer: 'you' },
];
const A: [number, number, number] = [0, 0, 0];
const B: [number, number, number] = [200, 100, 0];

/** The clean look with its time feel's state ease set. */
function lookWith(id: string, ease: string): JsonObject {
  const def = shippedLook('clean').def;
  def['id'] = id;
  const time = obj(def['time'] ?? {}, 'time');
  time['state'] = { span: '0.25s', interp: { ease: { name: ease } } };
  def['time'] = time;
  return def;
}

interface Reading { knob: number; channel: number; camera: number[] }
/** The document evaluated at each time, in a look; the readings and the document hash. */
function evaluate(doc: JsonObject, look: JsonObject, times: number[], planted?: string): { at: Reading[]; hash: string } {
  const out = one(MOTION_BIN, ['eval'], { doc, times, look, track: TRACK, ...(planted ? { planted } : {}) });
  expect(out['ok'], `eval in ${String(look['id'])} runs: ${shown(out)}`).toBe(true);
  const frames = arr(out['frames'], 'eval: frames');
  expect(frames.length, 'one frame per time').toBe(times.length);
  const at = frames.map((f, i) => {
    const frame = obj(f, `frame ${i}`);
    const knob = obj(obj(frame['items'], `frame ${i}.items`)['knob'], `frame ${i}.items.knob`);
    const pos = arr(obj(knob['at'], 'knob.at')['pos'], 'knob.at.pos');
    const channel = obj(obj(frame['channels'], `frame ${i}.channels`)['knob-x'], `frame ${i}.channels.knob-x`);
    const cam = obj(obj(frame['cameras'], `frame ${i}.cameras (each camera's pose)`)['cam'], `frame ${i}.cameras.cam`);
    return {
      knob: num(pos[0], `frame ${i}: knob x`), channel: num(channel['value'], `frame ${i}: knob-x value`),
      camera: arr(cam['target'], `frame ${i}: cam.target`).map((v, k) => num(v, `cam.target[${k}]`)),
    };
  });
  return { at, hash: str(out['hash'], 'eval: hash (the document\'s revision hash)') };
}

const TIMES = [sec(0.5), ENTRY, ENTRY + sec(0.0625), ENTRY + sec(0.125), ENTRY + sec(0.25), sec(1.9), STAGE + GLIDE / 2, STAGE + GLIDE, sec(3.5)];
const close = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-4;

/** The knob's readings against the eased values, each problem naming the look. */
function knobProblems(look: string, r: Reading[], want: { quarter: number; half: number }): string[] {
  const out: string[] = [];
  const expectAt = (i: number, value: number, when: string): void => {
    for (const [name, v] of [['knob x', r[i]!.knob], ['knob-x channel', r[i]!.channel]] as const) {
      if (!close(v, value)) out.push(`under look ${look}: the ${name} reads ${v} ${when}, expected ${value}`);
    }
  };
  expectAt(0, 17, 'before the entry');
  expectAt(1, 17, 'at the entry');
  expectAt(2, want.quarter, '0.0625 s after the entry');
  expectAt(3, want.half, '0.125 s after the entry');
  expectAt(4, 47, '0.25 s after the entry');
  expectAt(8, 47, 'long after');
  return out;
}

describe('#417 AC10 time.state drives a transition follow and a stage glide; switching the look switches the ease and keeps the document; a linear reader fails', () => {
  it('AC10 under time.state {0.25 s, in_out_cubic}, the follow moves the knob 17 → 47 through 18.875 at 0.0625 s and 32 at 0.125 s, and the stage glide covers half its path at half its span', () => {
    const { at } = evaluate(fixture('knob.json'), lookWith('calm', 'in_out_cubic'), TIMES);
    expect(knobProblems('calm', at, { quarter: 18.875, half: 32 })).toEqual([]);
    expect(at[5]!.camera, 'before stage b, the camera holds stage a\'s target').toEqual(A);
    const half = at[6]!.camera;
    expect(half.every((v, k) => close(v, (A[k]! + B[k]!) / 2)), `half the glide's span in, the camera is half way, got ${shown(half)}`).toBe(true);
    expect(at[7]!.camera.every((v, k) => close(v, B[k]!)), `at the glide's end the camera is at stage b's target, got ${shown(at[7]!.camera)}`).toBe(true);
  }, 300_000);

  it('AC10 under a look whose state ease is out_cubic the knob reads 43.25 at 0.125 s, and the document\'s hash is the same in both looks', () => {
    const doc = fixture('knob.json');
    const calm = evaluate(clone(doc), lookWith('calm', 'in_out_cubic'), TIMES);
    const brisk = evaluate(clone(doc), lookWith('brisk', 'out_cubic'), TIMES);
    // out_cubic(¼) = 1 − (¾)³ = 37/64: 17 + 30 × 37/64.
    expect(knobProblems('brisk', brisk.at, { quarter: 17 + (30 * 37) / 64, half: 43.25 })).toEqual([]);
    expect(brisk.hash, 'switching the look leaves the document\'s hash as it was').toBe(calm.hash);
    // The hash is the document's: an edit to it changes the hash.
    const edited = clone(doc);
    obj(obj(obj(obj(edited['channels'], 'channels')['knob-x'], 'knob-x')['follow'], 'follow')['source'], 'source')['values'] = { false: 17, true: 48 };
    expect(evaluate(edited, lookWith('calm', 'in_out_cubic'), TIMES).hash, 'an edited document hashes differently').not.toBe(calm.hash);
  }, 300_000);

  it('AC10 a planted reader that falls back to linear (planted state_ease_linear) reads 32 at 0.125 s under the out_cubic look and fails, naming the look', () => {
    const { at } = evaluate(fixture('knob.json'), lookWith('brisk', 'out_cubic'), TIMES, 'state_ease_linear');
    expect(close(at[3]!.knob, 32), `the planted reader reads 32 at 0.125 s, got ${at[3]!.knob}`).toBe(true);
    const problems = knobProblems('brisk', at, { quarter: 17 + (30 * 37) / 64, half: 43.25 });
    expect(problems.length, 'the planted reader fails the criterion').toBeGreaterThan(0);
    expect(problems.every((p) => p.includes('look brisk')), `each failure names the look: ${problems.join(' | ')}`).toBe(true);
  }, 300_000);
});
