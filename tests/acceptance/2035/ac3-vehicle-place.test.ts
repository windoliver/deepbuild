// #2035.e60b6f6d: "A vehicle placed 40 m away draws its chassis and each of its four wheel items at the old pose or the
// new one on every frame. A planted output that holds the chassis and blends the wheels draws a wheel 20 m from the
// chassis and fails, naming the wheel"
//
// #251's kart in a 60 Hz world, settled at the origin, placed at step 120 40 m along +x (level, unturned), baked 3 s and
// drawn at 120 frames a second. The chassis is drawn on kart_body and each wheel `kart#<name>` on kart_<name>, through
// `pose` outputs. Over criterion 1's frames, 1.9 s to 2.2 s, each part must be drawn within 0.25 m of where it is drawn
// at the step at or before the frame or at the step after (README: tolerances). The wrong program is
// `deep-physics --planted place_blends_wheels`.
import { describe, expect, it } from 'vitest';
import { WHEEL_NAMES, prebuild } from '../251/helpers.ts';
import { AC, TIMEOUT, WINDOW, fmt, frameName, kartBake, kartFailures, kartFrames, namedBy, offChassis, physics, type KartFrames } from './helpers.ts';

prebuild();

const ID = AC[3];
const drawnFrames = (twin?: 'place_blends_wheels'): KartFrames => {
  const [reply] = physics([kartBake()], twin, 'the kart placed 40 m away at step 120');
  return kartFrames(reply!, 'the kart placed 40 m away');
};

describe(`${ID} a place on a vehicle body draws its chassis and wheels as a cut`, () => {
  it(`${ID} a vehicle placed 40 m away draws its chassis and each of its four wheel items at the old pose or the new one on every frame`, () => {
    const failures = kartFailures(drawnFrames());
    expect(failures, `the kart's drawn frames:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} (twin: place_blends_wheels) a planted output that holds the chassis and blends the wheels draws a wheel 20 m from the chassis and fails, naming the wheel`, () => {
    const f = drawnFrames('place_blends_wheels');
    const failures = kartFailures(f);
    const chassis = failures.filter((x) => x.startsWith('the chassis'));
    expect(chassis, 'place_blends_wheels holds the chassis: no frame draws it off the old pose and the new').toEqual([]);
    const far = WINDOW.flatMap((j) => WHEEL_NAMES.map((n) => ({ j, n, off: offChassis(f, n, j) }))).filter((w) => Math.abs(w.off - 20) <= 0.5);
    expect(far.length, `place_blends_wheels draws a wheel 20 m (within 0.5 m) from its place on the chassis on some frame: ${far.map((w) => `${w.n} at ${frameName(w.j)} ${fmt(w.off)} m`).join('; ') || 'none'}`).toBeGreaterThan(0);
    namedBy(failures, new RegExp(`^wheel kart#(${far.map((w) => w.n).join('|')}) .* from its place on the chassis drawn there`), 'place_blends_wheels');
  }, TIMEOUT);
});
