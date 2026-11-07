// AC3 #492.5d279164: Three switch changes inside one span give the closed-form stacked weights however the frames fall,
// and a zero or up-parallel look_at aim gives the fixed fallback basis with the notice look_at_degenerate, never NaN.
//
// Through `deep-motion eval`. `start_on` and `switch`: "`switch` cross-fades when a choice changes: mix = ease((t − tc) ÷
// span)". The issue's Scope: "switch changes stacked in one span weigh newest first in closed form": with mᵢ the mix of
// change i, the newest takes m₃, the one before takes (1 − m₃)·m₂, and so on down to the first choice, which keeps what
// is left. Four mix placements, one per case of the choice control `pick`, each key 1 on a path of its own over a base of
// 0, so each path reads that case's weight. The input track carries the three changes at 2.0, 2.3 and 2.6 s; the span is
// 1 s. The look_at's aim runs through a zero aim at 1 s and an up-parallel aim at 2 and 3 s; "fixed" is read as: the same
// bits at two up-parallel aims of different length, seeked or played. No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, arr, at, channel, evalOk, film, fl, inOutQuad, isObject, none, place, posOr, rect, rotOr, secs, seededTimes, seekPlayFailures, show, useMotion, mentions,
  type Frame, type JsonObject, type JsonValue,
} from './helpers.ts';

const motion = useMotion();

const CASES = [['a', 'at/pos/0'], ['b', 'at/pos/1'], ['c', 'at/pos/2'], ['d', 'at/rot/0']] as const;
const SPAN = 1;
const CHANGES: [number, string][] = [[2.0, 'b'], [2.3, 'c'], [2.6, 'd']];
const SWITCH_DOC = film('switch-stacked', [rect('dot', [0, 0])], {
  controls: { pick: { kind: 'choice', class: 'document', label: 'Pick', options: CASES.map(([c]) => c), default: 'a' } },
  clips: Object.fromEntries(CASES.map(([c, field]) => [`clip-${c}`, { channels: { w: channel(`slot:s/${field}`, [[0, 1], [10, 1]]) } }])),
  placements: Object.fromEntries(CASES.map(([c]) => [`case-${c}`, place(`clip-${c}`, 'dot', { start: '0s', blend: 'mix', switch: { control: 'pick', case: c, span: at(SPAN), ease: 'in_out_quad' } })])),
}, { span: '10s' });
const INPUT: JsonObject[] = CHANGES.map(([s, value], i) => ({ t: fl(s), seq: i, control: 'pick', value, writer: 'you' }));

/** The closed form, newest first: each change's mix of what the newer ones leave. */
function weights(s: number): Record<string, number> {
  const mix = CHANGES.map(([tc]) => inOutQuad(Math.min(1, Math.max(0, (s - tc) / SPAN))));
  const out: Record<string, number> = {};
  let left = 1;
  for (let i = CHANGES.length - 1; i >= 0; i--) { out[CHANGES[i]![1]] = left * mix[i]!; left *= 1 - mix[i]!; }
  out['a'] = left;
  return out;
}
const read = (f: Frame, c: string): number => (c === 'd' ? rotOr(f, 'dot', 0) : posOr(f, 'dot', ['a', 'b', 'c'].indexOf(c)));

function weightFailures(frames: Frame[], what: string): string[] {
  const failures: string[] = [];
  for (const f of frames) {
    const want = weights(secs(f.t));
    for (const [c] of CASES) {
      const got = read(f, c);
      if (!(Math.abs(got - want[c]!) <= 1e-9)) failures.push(`${what}: case ${c} at ${f.t} flicks weighs ${got}, not ${want[c]}`);
    }
  }
  return failures;
}

describe(`${AC[3]} switch changes stacked in one span, and the look_at fallback`, () => {
  it(`${AC[3]} three changes inside one span give the closed-form stacked weights at 24 fps frames, 60 fps frames, shuffled frames and seeks`, () => {
    const frameTimes = (fps: number): number[] => Array.from({ length: 2 * fps }, (_, k) => fl(1.8) + Math.round((k * 705_600_000) / fps));
    const seeded = seededTimes(492_31, 120, fl(1.8), fl(4));
    const shuffled = [...seeded].reverse();
    const failures: string[] = [];
    for (const [what, times] of [['24 fps frames', frameTimes(24)], ['60 fps frames', frameTimes(60)], ['frames played backward', shuffled]] as [string, number[]][]) {
      failures.push(...weightFailures(evalOk(motion.bin(), { doc: SWITCH_DOC, times, input: INPUT }, what).frames, what));
    }
    for (const t of seeded.slice(0, 20)) failures.push(...weightFailures(evalOk(motion.bin(), { doc: SWITCH_DOC, times: [t], input: INPUT }, `the seek to ${t}`).frames, `the seek to ${t}`));
    none(failures, 'the stacked weights');
    const inside = weights(2.7);
    expect(Object.values(inside).filter((w) => w > 0.01).length, 'fixture: all four cases weigh at 2.7 s').toBe(4);
  }, TIMEOUT);

  const held = (list: [number, number][]): [number, number, string][] => list.map(([t, v]) => [t, v, 'hold']);
  /** The mark's position: an ordinary aim, the eye's own place, straight up twice at different lengths, an ordinary aim again. */
  const AIM_DOC = film('look-at-degenerate', [rect('eye', [0, 0]), rect('mark', [50, 0])], {
    channels: {
      mx: channel('items/mark/at/pos/0', held([[0, 50], [1, 0], [4, 30]])),
      mz: channel('items/mark/at/pos/2', held([[0, 0], [2, 50], [3, 80], [4, 0]])),
    },
    constraints: { aim: { owner: 'eye', kind: 'look_at', target: 'mark', axis: [1, 0, 0], up: [0, 0, 1] } },
  }, { span: '5s' });
  const STILL_DOC = film('look-at-plain', [rect('eye', [0, 0]), rect('mark', [50, 10])], {
    constraints: { aim: { owner: 'eye', kind: 'look_at', target: 'mark', axis: [1, 0, 0], up: [0, 0, 1] } },
  }, { span: '5s' });

  const noticeOf = (notices: JsonValue | undefined): JsonValue[] => (Array.isArray(notices) ? notices : []).filter((n) => isObject(n) && n['code'] === 'look_at_degenerate');

  it(`${AC[3]} a zero aim and an up-parallel aim give a finite fixed basis with the notice look_at_degenerate, naming the constraint, and an ordinary aim raises none`, () => {
    const times = [0.5, 1.5, 2.5, 3.5, 4.5].map(fl);
    const a = evalOk(motion.bin(), { doc: AIM_DOC, times }, 'the aim through both degenerate cases');
    const failures: string[] = [];
    a.frames.forEach((f) => { for (const k of [0, 1, 2]) if (!Number.isFinite(rotOr(f, 'eye', k))) failures.push(`at ${f.t} flicks eye's rot[${k}] is ${rotOr(f, 'eye', k)}`); });
    none(failures, 'never NaN');
    const notices = noticeOf(a.notices);
    expect(notices.length, `the notice look_at_degenerate is raised: ${show(a.notices)}`).toBeGreaterThan(0);
    expect(mentions(arr(notices, 'notices'), 'aim'), `it names the constraint aim: ${show(notices)}`).toBe(true);
    const rot = (f: Frame): number[] => [0, 1, 2].map((k) => rotOr(f, 'eye', k));
    expect(rot(a.frames[2]!), 'two up-parallel aims of different lengths give one fixed basis').toEqual(rot(a.frames[3]!));
    none(seekPlayFailures(motion.bin(), { doc: AIM_DOC, times }, 'the aim'), 'seeking equals playing, so the basis reads no earlier frame');
    const plain = evalOk(motion.bin(), { doc: STILL_DOC, times }, 'an ordinary aim');
    expect(noticeOf(plain.notices), `an ordinary aim raises no such notice: ${show(plain.notices)}`).toEqual([]);
  }, TIMEOUT);
});
