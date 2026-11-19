// AC1 #1431.aea056b4: a planted 200 MB GPU texture with no gauge raises `unaccounted` by 200 MB within 10%. With its
// gauge, `unaccounted` doesn't move by more than 10 MB.
//
// One replica process (`deep-drive`, the env-plants build), launched on its fixture: a reading, then the planted
// texture with no gauge (`{"call": "texture", "texture": {"bytes": 200000000, "gauge": false}}`, a call only an
// env-plants build answers), a reading, then a second one with its gauge, and a reading. Each reading must keep the
// Scope's arithmetic (unaccounted = footprint − heap − gauges). The wrong program is the planted ungauged texture
// itself: memory no gauge names must show in `unaccounted` (README: Planted programs, `ungauged_texture_200mb`).
import { describe, expect, it } from 'vitest';
import { DRIVE_BUILD, ID, MB, Replica, arithmeticProblems, mb, none, num, obj, requireMacos, short, useBuild, type Reading } from './helpers.ts';

const drive = useBuild(DRIVE_BUILD);
const TEXTURE = 200 * MB;

/** The planted texture: made on the replica's GPU device, every byte written, held; counted by a gauge or by none. */
async function plantTexture(r: Replica, gauge: boolean): Promise<number> {
  const reply = await r.must({ call: 'texture', texture: { bytes: TEXTURE, gauge } }, `the planted ${mb(TEXTURE)} texture${gauge ? ' with its gauge' : ' with no gauge'}`);
  const made = obj(reply['texture'], 'texture: its reply');
  const device = num(made['device_bytes'], 'texture.device_bytes, the size the device reports for it');
  expect(device, `the device holds at least the ${mb(TEXTURE)} the call asked for`).toBeGreaterThanOrEqual(TEXTURE);
  return device;
}

const delta = (a: Reading, b: Reading): number => b.unaccounted! - a.unaccounted!;

describe(`${ID.ac1} unaccounted names GPU memory no gauge sees`, () => {
  it(`${ID.ac1} a planted 200 MB GPU texture with no gauge raises unaccounted by 200 MB within 10%; with its gauge, unaccounted moves 10 MB at most`, async () => {
    requireMacos('the replica');
    const r = await Replica.start(drive(), { from: 'fixture' });
    try {
      const before = await r.reading('before any planted texture');
      const ungaugedBytes = await plantTexture(r, false);
      const ungauged = await r.reading(`with the ${mb(TEXTURE)} texture and no gauge`);
      const gaugedBytes = await plantTexture(r, true);
      const gauged = await r.reading(`with a second ${mb(TEXTURE)} texture, this one with its gauge`);

      const readings: [string, Reading][] = [['before', before], ['ungauged', ungauged], ['gauged', gauged]];
      for (const [name, reading] of readings) console.log(`PROOF ${ID.ac1} ${name}: ${short(reading, 4000)}`);
      none(readings.flatMap(([name, reading]) => [
        ...(reading.unaccounted === null ? [`${name}: unaccounted is unknown (${short(reading.unknown)}), so nothing can be judged`] : []),
        ...arithmeticProblems(reading, name),
      ]), 'each reading is known and unaccounted is footprint less heap less the gauges');

      const raised = delta(before, ungauged);
      console.log(`PROOF ${ID.ac1} ungauged ${mb(ungaugedBytes)} on the device: unaccounted ${mb(before.unaccounted!)} -> ${mb(ungauged.unaccounted!)} (${mb(raised)})`);
      expect(Math.abs(raised - TEXTURE), `the planted texture with no gauge raises unaccounted by ${mb(TEXTURE)} within 10% (${mb(0.1 * TEXTURE)}): it rose ${mb(raised)}`).toBeLessThanOrEqual(0.1 * TEXTURE);

      const moved = delta(ungauged, gauged);
      console.log(`PROOF ${ID.ac1} gauged ${mb(gaugedBytes)} on the device: unaccounted ${mb(ungauged.unaccounted!)} -> ${mb(gauged.unaccounted!)} (${mb(moved)})`);
      expect(Math.abs(moved), `with its gauge the same texture moves unaccounted by 10 MB at most: it moved ${mb(moved)}`).toBeLessThanOrEqual(10 * MB);
    } finally {
      await r.stop();
    }
  }, 3_600_000);
});
