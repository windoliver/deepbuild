// #2035.4a4b7836: "A 60 Hz logic item moves 0.1 m a step along x on a 20 m field and at step 200 wraps from 19.9 m to
// 0 m with its `cut` true on that step. Drawn at 120 frames a second from step 190 to step 210, no frame draws x between
// 1 m and 19 m. A planted evaluator that ignores `cut` draws 9.95 m on one frame and fails, naming the frame. A `cut`
// that names an f64 write is refused at check, naming the write"
//
// The item `ship` (helpers.ts): its vec3 `pos` declared linear with `cut: wrapped`, its bool `wrapped` true at step 200.
// A view of it in `deep-logic`, played by `play: 1/120` a frame, reports what drawing reads (`draws`). A linear write
// draws one step late, so the frames that draw steps 190 to 210 are t(191) to t(211), frames 382 to 422 (README:
// readings). The wrong program is `deep-logic --planted cut_ignored`.
import { describe, expect, it } from 'vitest';
import { checkCall, logic, logicBin, prebuild, refusedWrites } from '../545/helpers.ts';
import { AC, SHIP, SHIP_WINDOW, TIMEOUT, bandFailures, namedBy, playShip, shipPiece, shipProgram, shipX } from './helpers.ts';

prebuild(() => { logicBin(); shipProgram(); });

const ID = AC[4];

describe(`${ID} a linear logic write draws a marked cut with no blend`, () => {
  it(`${ID} drawn at 120 frames a second from step 190 to step 210, the ship that wraps at step 200 with its cut true never draws x between 1 m and 19 m`, async () => {
    const { frames } = await playShip(null, null);
    const failures = bandFailures(frames);
    expect(failures, `the ship's drawn frames:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} (twin: cut_ignored) a planted evaluator that ignores cut draws 9.95 m on one frame and fails, naming the frame`, async () => {
    const { frames } = await playShip('cut_ignored', null);
    const blended = SHIP_WINDOW.filter((j) => Math.abs(shipX(frames.get(j)!, `cut_ignored's frame ${j}`) - 9.95) <= 1e-6);
    expect(blended.length, `cut_ignored draws x = 9.95 m on exactly one frame from step 190 to step 210 (frames ${blended.join(', ') || 'none'})`).toBe(1);
    namedBy(bandFailures(frames), new RegExp(`\\bframe ${blended[0]}\\b`), 'cut_ignored');
  }, TIMEOUT);

  it(`${ID} a cut that names an f64 write is refused at check, naming the write`, () => {
    const [good, bad] = logic([checkCall(shipPiece('wrapped')), checkCall(shipPiece('speed'))]);
    expect(good!['ok'], `the ship whose cut names its bool write wrapped is admitted: ${JSON.stringify(good).slice(0, 800)}`).toBe(true);
    const refused = refusedWrites(bad!, 'the ship whose cut names its f64 write speed');
    expect(refused.item, 'the refusal names the item').toBe(SHIP);
    expect(refused.writes.filter((w) => w === 'pos' || w === 'speed'), `the refusal names the write (pos, whose cut it is, or speed, the f64 write it names): ${JSON.stringify(bad).slice(0, 800)}`).not.toEqual([]);
  }, TIMEOUT);
});
