// AC2: "A still scene draws no new frames, and under reduced motion nothing moves"
//
// asserts: on the virtual display clock, a still scene presents one frame per revision that becomes current
// and no other frame over 2 s (`presented`); a scene whose part slides presents frames while it moves (the
// control that shows the count isn't stuck at one); evaluated under reduced motion, the sliding scene's
// snapshots at every time are byte for byte one snapshot, while without it they differ.

import { describe, expect, it } from 'vitest';
import {
  ALPHA, DOC, FLICKS, FULL, arr, board, num, obj, outcome, rect, run, scenario, show, str, text, useBuilds, useEvidence,
  type JsonObject,
} from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();

/** 60 Hz, latched at the vsync, a check taking no clock time: #96's virtual display clock. */
const CLOCK: JsonObject = { refresh_hz: 60, lead: 0, check: 0 };
const PERIOD = FLICKS / 60;

const still = (caption: string): JsonObject => board('Still checks', [320, 200], [
  rect('back', 'Backdrop', [0, 0, 320, 200], 'a0'),
  rect('bar', 'Progress bar', [16, 120, 200, 16], 'a1'),
  text('caption', 'Caption', caption, [16, 24], 'a2'),
]);

/** A box that slides from x 16 to 280 over the first second, then rests; the document spans 2 s. */
const sliding: JsonObject = board('Sliding box', [320, 200], [
  rect('back', 'Backdrop', [0, 0, 320, 200], 'a0'),
  { id: 'box', kind: 'rect@1', name: 'Sliding box', order: 'a1', params: { box: [0, 0, 24, 24], paint: { fill: { role: 'ink' } } }, at: { pos: [16, 140, 0] } },
], {
  transport: { span: '2s' },
  clips: { slide: { slots: { target: { type: 'rect@1', required: true } }, span: 'auto', channels: { x: { target: 'slot:target/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: 16, interp: 'linear' }, k1: { t: '1s', value: 280, interp: 'linear' } } } } } },
  placements: { p: { clip: 'slide', slots: { target: 'box' }, start: '0s' } },
});

interface Frame { vsync: number; rev: number }
function frames(reply: JsonObject): Frame[] {
  return arr(reply['frames'], 'presented: frames').map((f, i) => {
    const o = obj(f, `frames[${i}]`);
    return { vsync: num(o['vsync'], `frames[${i}].vsync`), rev: num(o['rev'], `frames[${i}].rev`) };
  });
}

describe('AC2 a still scene draws no new frames, and under reduced motion nothing moves', () => {
  it('AC2 a still scene presents one frame when a revision becomes current and none after it, over 2 s', () => {
    const replies = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: 'main' }, [
      { ...show(ALPHA.id, DOC.a, still('Ready for review')), at: 0 },
      { call: 'presented', panel: 'main', at: FLICKS },
      { ...show(ALPHA.id, DOC.a, still('Reviewed')), at: FLICKS },
      { call: 'presented', panel: 'main', at: 2 * FLICKS },
    ], { clock: CLOCK }));
    expect(outcome(replies[0]!), `the still scene is presented: ${JSON.stringify(replies[0]).slice(0, 1200)}`).toBe('presented');
    expect(outcome(replies[2]!), `its next revision is presented: ${JSON.stringify(replies[2]).slice(0, 1200)}`).toBe('presented');
    const first = frames(replies[1]!);
    expect(first.length, `one frame in the first second, for the first revision; no new frame after it: ${JSON.stringify(first)}`).toBe(1);
    const all = frames(replies[3]!);
    expect(all.length, `over 2 s, one frame per revision and no other: ${JSON.stringify(all)}`).toBe(2);
    expect(all[1]!.rev, 'the second frame draws the second revision').not.toBe(all[0]!.rev);
    expect(all[1]!.vsync, 'the second frame comes only once the second revision arrived').toBeGreaterThanOrEqual(FLICKS);
  });

  it('AC2 control: a scene whose part slides presents frames while it moves, so the frame count sees motion', () => {
    const replies = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: 'main' }, [
      { ...show(ALPHA.id, DOC.a, sliding), at: 0 },
      { call: 'presented', panel: 'main', at: 2 * FLICKS },
    ], { clock: CLOCK }));
    expect(outcome(replies[0]!), `the sliding scene is presented: ${JSON.stringify(replies[0]).slice(0, 1200)}`).toBe('presented');
    const moving = frames(replies[1]!).filter((f) => f.vsync <= FLICKS);
    // 60 vsyncs fall in the slide's first second; the app moves the part every frame while it moves.
    expect(moving.length, `frames presented while the box slides (of ${FLICKS / PERIOD} vsyncs): ${moving.length}`).toBeGreaterThanOrEqual(30);
  });

  it('AC2 under reduced motion the sliding scene holds still: its snapshots at every time are one snapshot, and differ without it', () => {
    const times = ['0s', '0.25s', '0.5s', '0.75s', '1s', '1.5s'];
    const replies = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: 'main' }, [
      show(ALPHA.id, DOC.a, sliding),
      ...times.map((t) => ({ call: 'eval', doc: DOC.a, t, view: { reduced_motion: true }, pixels: true })),
      { call: 'eval', doc: DOC.a, t: '0.25s', pixels: true },
      { call: 'eval', doc: DOC.a, t: '0.75s', pixels: true },
    ]));
    expect(outcome(replies[0]!), `the sliding scene is presented: ${JSON.stringify(replies[0]).slice(0, 1200)}`).toBe('presented');
    const sha = (reply: JsonObject, what: string): string => {
      expect(outcome(reply), `${what} is evaluated: ${JSON.stringify(reply).slice(0, 800)}`).toBe('evaluated');
      const shots = arr(reply['snapshots'], `${what}: snapshots`);
      expect(shots.length, `${what}: one snapshot`).toBe(1);
      return str(obj(shots[0], `${what}: snapshot`)['sha256'], `${what}: sha256`);
    };
    const held = times.map((t, i) => sha(replies[1 + i]!, `the frame at ${t} under reduced motion`));
    for (const [i, t] of times.entries()) {
      expect(held[i], `under reduced motion the frame at ${t} is the frame at ${times[0]}: nothing moves`).toBe(held[0]);
    }
    const early = sha(replies[1 + times.length]!, 'the frame at 0.25s');
    const late = sha(replies[2 + times.length]!, 'the frame at 0.75s');
    expect(late, 'without reduced motion the box has moved between 0.25 s and 0.75 s').not.toBe(early);
  });
});
