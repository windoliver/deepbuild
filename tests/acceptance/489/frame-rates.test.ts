// Criterion 2: "Poses at 24 and 60 fps are identical at the times they share"
//
// Through `deep-motion eval`. One document drawn twice, with `transport.frame_rate` 24/1 and 60/1 and nothing else
// changed, holding every motion this issue adds that a pose reads: a Bézier key, a spring key with velocity, clamped
// auto keys, a follow spring and a follow transition on a stepping source, a driver, a look_at and a stretching
// reach2. Each is played on its own frames over 4 s (24 fps: every 29,400,000 flicks; 60 fps: every 11,760,000), so
// a program that steps per frame sees different steps; at the times the two share (every 1/12 s, 49 times) every
// item's evaluated pose and every channel's value must be equal, bit for bit. No upstream test (oracle page).
import { describe, it } from 'vitest';
import { FLICKS, TIMEOUT, evalOk, film, fl, follow, keyed, none, rect, useMotion, type JsonObject } from './helpers.ts';

const motion = useMotion();

function rigDoc(rate: [number, number]): JsonObject {
  return film(`rig-${rate[0]}fps`, [
    rect('ball', [40, 200]), rect('pop', [300, 60]), rect('glide', [400, 300]), rect('trail', [60, 60]), rect('knob', [17, 320]),
    rect('needle', [500, 200]), rect('upper', [200, 180]), rect('lower', [60, 0], { parent: 'upper' }), rect('end', [40, 0], { parent: 'lower' }),
  ], {
    channels: {
      bx: keyed('items/ball/at/pos/0', { k0: { t: '0s', value: 40, interp: { bezier: { x1: 0.42, y1: 0, x2: 0.58, y2: 1 } } }, k1: { t: '3s', value: 560, interp: 'linear' } }),
      by: keyed('items/ball/at/pos/1', { k0: { t: '0s', value: 200, interp: { auto: { clamp: true } } }, k1: { t: '1s', value: 80, interp: { auto: { clamp: true } } }, k2: { t: '2s', value: 260, interp: { auto: { clamp: true } } }, k3: { t: '3.5s', value: 120, interp: { auto: { clamp: true } } } }),
      ps: keyed('items/pop/at/scale/0', { grow: { t: '0.28s', value: 0, interp: { spring: { decay: 6.5, omega: 15 } }, velocity: 6.5 }, rest: { t: '3.5s', value: 1, interp: 'linear' } }),
      gl: follow('items/trail/at/pos/0', [[0, 60], [0.9, 300], [2.3, 150]], { spring: { freq_hz: 1.2, damping_ratio: 0.45 } }),
      kx: follow('items/knob/at/pos/0', [[0, 17], [1.0, 47], [1.1, 17], [2.5, 47]], { transition: { span: 0.2, interp: { ease: { name: 'out_cubic' } } } }),
    },
    drivers: { lean: { target: 'items/glide/at/rot/2', expr: 'x * 0.1', vars: { x: 'items/ball/at/pos/0' } } },
    constraints: {
      watch: { owner: 'needle', kind: 'look_at', target: 'ball', axis: [1, 0, 0] },
      arm: { owner: 'upper', kind: 'reach2', chain: ['upper', 'lower', 'end'], target: 'ball', bend: 1, stretch: 'cartoon' },
    },
  }, { span: '4s', frame_rate: rate });
}
const frames = (fps: number): number[] => Array.from({ length: 4 * fps + 1 }, (_, k) => (k * FLICKS) / fps).filter((t) => t < fl(4));

describe('criterion 2: poses at 24 and 60 fps are identical at the times they share', () => {
  it('criterion 2: played on their own frames, the 24 fps and 60 fps documents give the same poses and channel values, bit for bit, every 1/12 s', () => {
    const at24 = evalOk(motion.bin(), { doc: rigDoc([24, 1]), times: frames(24) }, 'the 24 fps play');
    const at60 = evalOk(motion.bin(), { doc: rigDoc([60, 1]), times: frames(60) }, 'the 60 fps play');
    const by60 = new Map(at60.frames.map((f) => [f.t, f]));
    const failures: string[] = [];
    let shared = 0;
    for (const f of at24.frames) {
      const g = by60.get(f.t);
      if (!g) continue;
      shared++;
      for (const [id, item] of Object.entries(f.items)) {
        const a = JSON.stringify((item as JsonObject)['at']); const b = JSON.stringify((g.items[id] as JsonObject | undefined)?.['at']);
        if (a !== b) failures.push(`at ${f.t} flicks item ${id} is posed ${a} at 24 fps and ${b} at 60 fps`);
      }
      if (JSON.stringify(f.channels) !== JSON.stringify(g.channels)) failures.push(`at ${f.t} flicks the channels read ${JSON.stringify(f.channels).slice(0, 300)} at 24 fps and ${JSON.stringify(g.channels).slice(0, 300)} at 60 fps`);
    }
    none(failures, 'the shared times');
    none(shared === 48 ? [] : [`the two plays share ${shared} times, not the 48 every 1/12 s in [0, 4 s)`], 'the shared times are compared');
    const moving = new Set(at24.frames.map((f) => JSON.stringify(f.items)));
    none(moving.size > 40 ? [] : [`the rig holds only ${moving.size} distinct poses over 96 frames`], 'the rig moves');
  }, TIMEOUT);
});
