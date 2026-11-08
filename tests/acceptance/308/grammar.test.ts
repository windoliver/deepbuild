// AC11-AC15 #308: the drag grammar and the keys, which `input@1` holds for every pack (Scope: "One drag grammar"
// and "Keys"). Through `deep-canvas input` (README: `input`): pointer events with the modifiers each event carries,
// the control's value after each event read from the op's result, the stored entry from the answer's track.
//
// AC11 "A 200 px slider over 0..1 at 0.5, pressed 6 px right of the handle's centre, reads 0.5 until moved, and a 20
//   px drag right reads 0.585. A planted absolute slider reads 0.63 and fails"
// AC12 "Shift pressed mid-drag then 40 px right moves the value by 0.01, with no jump over 1 px's worth at the
//   change. A planted recompute jumps and fails"
// AC13 "100 px past the max, then 10 px back, reads 0.95. A planted slider with no anchor move stays at 1.0"
// AC14 "A session with Shift pressed and released mid-drag, replayed at 30, 60 and 120 fps, gives one input-track
//   hash. A planted kind that reads modifiers at replay gives another and fails the kit's replay part"
// AC15 "With `increment` 0.05 and range 0..1, Shift+Right moves 0.005, Page Up 0.1 and End to 1, in the app and the
//   web player alike"
import { describe, expect, it } from 'vitest';
import {
  FPS, GAIN, KNOB, canon, doc, down, failsNaming, inputPlanted, inputRun, inputRuns, key, move, near, none, px, refusalFailures, slider, startup, TRACK, up,
  useBuilds, useCanvas, valueOf, type Build, type InputLine, type Ran,
} from './helpers.ts';

const canvas = useCanvas();
const FULL: Build = { set: 'full', with: ['test-control-kind'] };
const builds = useBuilds([FULL]);

const D11 = doc('drag', [KNOB], { gain: GAIN });
const line = (d: typeof D11, ops: InputLine['ops'], extra: Partial<InputLine> = {}): InputLine => ({ doc: d, viewport: [640, 360], ops, ...extra });

// Pressed 6 px right of the handle's centre (200 + 6), then to 2 px, then to 20 px right of the press.
const AC11_OPS = [down(206, 180, 1.0), move(208, 180, 1.05), move(226, 180, 1.2), up(226, 180, 1.3)];
function offCentreFailures(r: Ran | null, what: string): string[] {
  if (!r) return [`${what}: no answer for the slider gain`];
  const v = r.results.map((x) => (typeof x.value === 'number' ? x.value : NaN));
  const failures: string[] = [];
  if (!near(v[0]!, 0.5)) failures.push(`${what}: the slider gain reads ${v[0]} on the press 6 px off the handle's centre, not 0.5 (the value jumped to the pointer)`);
  if (!near(v[1]!, 0.5)) failures.push(`${what}: the slider gain reads ${v[1]} after 2 px, inside the 3 px threshold, not 0.5`);
  if (!near(v[2]!, 0.585)) failures.push(`${what}: the slider gain reads ${v[2]} after a 20 px drag right, not 0.585`);
  const e = r.track.filter((t) => t.control === 'gain');
  if (e.length !== 1 || typeof e[0]!.value !== 'number' || !near(e[0]!.value, 0.585)) failures.push(`${what}: the track holds ${JSON.stringify(e.map((x) => x.value))} for gain, not one entry of 0.585`);
  return failures;
}

describe('AC11 #308 grabbing the handle keeps the offset', () => {
  it('AC11 a 200 px slider at 0.5 pressed 6 px right of the handle reads 0.5 until moved, and a 20 px drag right reads 0.585; the track outside the handle moves to that point; a planted absolute slider reads 0.63', () => {
    const bin = canvas.bin();
    const [real, trackClick] = inputRuns(bin, [line(D11, AC11_OPS), line(D11, [down(px(0.75), 180, 1.0), up(px(0.75), 180, 1.1)])]);
    none(offCentreFailures(real!, 'the grammar'), 'the offset-keeping drag');
    // Scope: "Pressing the track outside the handle moves to that point, then drags from there".
    expect(valueOf(trackClick!.results[0]!, 'the press on the track'), 'pressing the track 50 px right of the handle moves to that point, 0.75').toBeCloseTo(0.75, 9);
    // The criterion's wrong program: a slider that reads the pointer's absolute place reads (206 + 20 - 100) / 200 = 0.63.
    const planted = inputPlanted(bin, line(D11, AC11_OPS, { planted: 'slider_absolute' }));
    failsNaming(offCentreFailures(planted, 'the planted absolute slider'), ['gain', '0.63'], 'the planted absolute slider');
  }, 1_800_000);
});

describe('AC12 #308 a Shift change moves the anchor', () => {
  const shiftOps = (): InputLine['ops'] => [
    down(200, 180, 1.0), move(230, 180, 1.1),
    move(230, 180, 1.2, ['shift']), // Shift pressed mid-drag, the pointer still
    move(270, 180, 1.3, ['shift']), // then 40 px right
    up(270, 180, 1.4, ['shift']),
  ];
  function shiftFailures(r: Ran | null, what: string): string[] {
    if (!r) return [`${what}: no answer for the slider gain`];
    const v = r.results.map((x) => (typeof x.value === 'number' ? x.value : NaN));
    const failures: string[] = [];
    if (!(Math.abs(v[2]! - v[1]!) <= 1 / 200 + 1e-12)) failures.push(`${what}: the slider gain jumps from ${v[1]} to ${v[2]} when Shift is pressed, more than 1 px's worth (0.005)`);
    if (!near(v[3]! - v[2]!, 0.01)) failures.push(`${what}: 40 px under Shift moves the slider gain by ${v[3]! - v[2]!}, not 0.01`);
    return failures;
  }
  it('AC12 Shift pressed mid-drag then 40 px right moves the value by 0.01 with no jump; a planted recompute jumps', () => {
    const bin = canvas.bin();
    const real = inputRun(bin, line(D11, shiftOps()));
    none(shiftFailures(real, 'the grammar'), 'Shift at 1/20 speed from a moved anchor');
    failsNaming(shiftFailures(inputPlanted(bin, line(D11, shiftOps(), { planted: 'shift_recompute' })), 'the planted recompute'), ['gain', 'jumps'], 'the planted recompute');
  }, 1_800_000);
});

describe('AC13 #308 past a limit the anchor moves by the overshoot', () => {
  const D = doc('overshoot', [KNOB], { gain: slider('Gain', 'knob', TRACK, { default: 1 }) });
  const ops = (): InputLine['ops'] => [down(px(1), 180, 1.0), move(px(1) + 100, 180, 1.1), move(px(1) + 90, 180, 1.2), up(px(1) + 90, 180, 1.3)];
  function overshootFailures(r: Ran | null, what: string): string[] {
    if (!r) return [`${what}: no answer for the slider gain`];
    const v = r.results.map((x) => (typeof x.value === 'number' ? x.value : NaN));
    const failures: string[] = [];
    if (!near(v[1]!, 1)) failures.push(`${what}: 100 px past the max the slider gain reads ${v[1]}, not 1.0`);
    if (!near(v[2]!, 0.95)) failures.push(`${what}: then 10 px back the slider gain reads ${v[2]}, not 0.95`);
    return failures;
  }
  it('AC13 100 px past the max, then 10 px back, reads 0.95; a planted slider with no anchor move stays at 1.0', () => {
    const bin = canvas.bin();
    none(overshootFailures(inputRun(bin, line(D, ops())), 'the grammar'), 'the overshoot moves the anchor');
    failsNaming(overshootFailures(inputPlanted(bin, line(D, ops(), { planted: 'no_anchor_move' })), 'the planted slider'), ['gain', '0.95'], 'the planted slider with no anchor move');
  }, 1_800_000);
});

describe('AC14 #308 modifiers are resolved at the gesture, never at replay', () => {
  const ops = (): InputLine['ops'] => [
    down(206, 180, 1.0123), move(226, 180, 1.0501), move(226, 180, 1.1049, ['shift']), move(246, 180, 1.2002, ['shift']),
    move(246, 180, 1.3071), move(266, 180, 1.4003), up(266, 180, 1.5003),
  ];
  it('AC14 Shift pressed and released mid-drag replays at 30, 60 and 120 fps to one input-track hash; a planted kind that reads modifiers at replay gives another, and the seal\'s kit refuses it at its replay part', () => {
    const bin = canvas.bin();
    const real = inputRuns(bin, FPS.map((fps) => line(D11, ops(), { fps })));
    expect(new Set(real.map((r) => r.hash)).size, `one input-track hash at 30, 60 and 120 fps: ${real.map((r) => r.hash).join(' ')}`).toBe(1);
    expect(new Set(real.map((r) => canon(r.track.map((e) => e.raw)))).size, 'the same track at the three rates').toBe(1);
    const realHash = real[0]!.hash;
    const planted = FPS.map((fps) => inputPlanted(bin, line(D11, ops(), { fps, planted: 'kind_reads_modifiers' })));
    const hashes = new Set([realHash, ...planted.map((p) => p?.hash ?? 'no answer')]);
    // The criterion's check is "one hash"; the planted kind must break it, and the failure names the kind.
    failsNaming(hashes.size > 1 ? [`the kind slider reads modifiers at replay: ${[...hashes].join(' ')} are not one input-track hash`] : [], ['slider'], 'the planted kind that reads modifiers');
    // The kit's replay part, at the seal, on the test kind test.dial (README: Test canvas module).
    none(refusalFailures(startup(builds.bin(FULL), 'control_kind_reads_modifiers'), { reasons: ['entry_refused'], registry: 'control@1', entries: ['test.dial'], rules: ['replay'] }), 'a kind that reads modifiers at replay');
  }, 1_800_000);
});

describe('AC15 #308 keys: arrows, Shift+arrows, Page Up and Down, Home and End', () => {
  const D = doc('keys', [KNOB], { keys: slider('Keys', 'knob', TRACK, { increment: 0.05 }) });
  const SEQ: { k: string; shift?: boolean; want: number }[] = [
    { k: 'ArrowRight', shift: true, want: 0.505 }, // + increment ÷ 10 = 0.005
    { k: 'ArrowRight', want: 0.555 }, // + increment
    { k: 'PageUp', want: 0.655 }, // + max(increment, range ÷ 10) = 0.1
    { k: 'PageDown', want: 0.555 },
    { k: 'ArrowLeft', shift: true, want: 0.55 },
    { k: 'End', want: 1 },
    { k: 'Home', want: 0 },
    { k: 'ArrowLeft', want: 0 }, // at the end already: clamped
  ];
  const ops = (): InputLine['ops'] => SEQ.map((s, i) => key('keys', s.k, 1 + i * 0.25, s.shift ? ['shift'] : []));
  it('AC15 with increment 0.05 and range 0..1, Shift+Right moves 0.005, Page Up 0.1 and End to 1, and the web player gives the same entries and hash', () => {
    const bin = canvas.bin();
    const [app, player] = inputRuns(bin, [line(D, ops(), { host: 'app' }), line(D, ops(), { host: 'web_player' })]);
    const failures: string[] = [];
    SEQ.forEach((s, i) => {
      const got = valueOf(app!.results[i]!, `key ${i}`);
      if (!near(got, s.want)) failures.push(`${s.shift ? 'Shift+' : ''}${s.k} (key ${i}) leaves the slider keys at ${got}, not ${s.want}`);
    });
    none(failures, 'the default keys');
    expect(app!.track.length, 'one entry per key').toBe(SEQ.length);
    expect(canon(player!.results.map((r) => r.raw)), 'the web player reads the same values after every key').toBe(canon(app!.results.map((r) => r.raw)));
    expect(player!.hash, 'the web player records the same input-track hash').toBe(app!.hash);
  }, 1_800_000);
});
