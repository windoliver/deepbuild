// #382.1baf9f5b: An art film that binds no status, played on its own, keeps a data color 0.02 OKLab from the fail
// color unchanged, runs no status guard and shows no legend; the same film shown on a return card, or given one
// status binding, is refused naming the data role and the status color it clashes with.
// The film's lamp takes a role 0.02 OKLab from the look's fail red (lighter along L, found by this suite's OKLab
// math). Played on its own (`view3d`, no host, no binding) the call is accepted, its status report says status
// can't show, no guard ran and the legend is empty, and the lamp's +Z face draws its role's color exactly: the
// most common pixel of the lamp (by the ID target) is the role within one 8-bit code, and at least 100 of the
// frame's pixels lie within the status distance of fail, which a guard would have moved. On a return card (`host`,
// kind return_card) and with one status binding (`view3d`), the same film is refused `status_distance` naming
// `lamp` and `fail`, while the film with the lamp 0.12 from fail and a binding is accepted, so the refusal is the
// clash's, not every bound document's. At the base `view3d` reads no status fields and has no status report, and
// there is no host call; `--planted guard_everywhere` runs the guard and draws a legend in the film played alone.
import { describe, expect, it } from 'vitest';
import {
  DISTANCE, STATUS, VERDICT, alongL, answered, deltaEOk, distanceRefusal, film, frameAt, framesOf, fromHex, hex, look3, mode, readIds, readPng, requireGpu,
  run1, statusColors, statusOf, useBin, useOut, writeJson, type JsonObject, type Rgb, type Startup,
} from './helpers.ts';

const bins = useBin();
const out = useOut();

const FAIL = fromHex(STATUS.fail);
/** The data color 0.02 OKLab from fail (the criterion's number), and one 0.12 away (past the distance). */
const NEAR = alongL(FAIL, 0.02);
const FAR = alongL(FAIL, 0.12);
const SAFE: Record<string, Rgb> = { block: [32, 192, 176], crate: [64, 128, 255], floor: [172, 172, 172] };
const artLook = (lamp: Rgb): JsonObject => look3('art-382', { lamp, ...SAFE });
const CARD_LOOK = look3('card-382', {});

function playedAlone(startup: Startup): string[] {
  const bin = bins.bin();
  const doc = film('art-film-382');
  const path = writeJson(out(), 'art-film.json', doc);
  const reply = answered(run1(bin, out(), { call: 'view3d', doc: path, look: artLook(NEAR), size: [480, 360], targets: ['final', 'ids'], capture: [0] }, startup), 'the art film played alone');
  const status = statusOf(reply, 'the art film played alone');
  const failures: string[] = [];
  // No status binding, no host: status can't show, so no guard and no legend (the status-color rule).
  if (status.shows) failures.push(`status.shows is true for a film that binds no status`);
  if (status.guard !== null && status.guard.ran) failures.push(`a status guard ran (${status.guard.pixels_moved} pixels moved) in a film played on its own`);
  if (status.legend.length > 0) failures.push(`a legend of ${status.legend.length} entries is shown in a film that binds no status`);
  if (status.marks.length > 0) failures.push(`${status.marks.length} status marks in a film that binds no status`);
  const frame = frameAt(framesOf(reply, 'view3d'), 0, 'the art film');
  const image = readPng(out(), frame.final, 'frame 0\'s final frame');
  const ids = readIds(out(), frame, 'frame 0\'s ID target');
  expect(ids.count.get('lamp') ?? 0, 'the lamp has pixels in the ID target').toBeGreaterThan(400);
  const lamp = mode(image, (x, y) => ids.at(x, y) === 'lamp');
  // The +Z face faces the sun and the camera: it draws the role's color exactly (within one 8-bit code).
  const off = Math.max(...lamp.color.map((v, i) => Math.abs(v - NEAR[i]!)));
  if (off > 1) failures.push(`the lamp's most common pixel is ${hex(lamp.color)}, not its role ${hex(NEAR)} (${deltaEOk(lamp.color, NEAR).toFixed(4)} OKLab away): the data color changed`);
  if (lamp.count < 200) failures.push(`only ${lamp.count} of the lamp's ${lamp.total} pixels share its most common color`);
  let within = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) { const o = (y * image.width + x) * 4; if (deltaEOk([image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!], FAIL) < DISTANCE) within++; }
  if (within < 100) failures.push(`${within} pixels lie within ${DISTANCE} OKLab of fail; the film's lamp at 0.02 from it should keep hundreds there`);
  return failures;
}

describe('#382.1baf9f5b an art film alone keeps a data color 0.02 from fail; on a card or with a binding it is refused', () => {
  it('#382.1baf9f5b the data color sits 0.02 OKLab from the fail red by this suite\'s OKLab math', () => {
    expect(Math.abs(deltaEOk(NEAR, FAIL) - 0.02), `${hex(NEAR)} is 0.02 ± 0.0025 from ${hex(FAIL)}: ${deltaEOk(NEAR, FAIL)}`).toBeLessThanOrEqual(0.0025);
    expect(Math.abs(deltaEOk(FAR, FAIL) - 0.12), `${hex(FAR)} is 0.12 ± 0.0025 from ${hex(FAIL)}`).toBeLessThanOrEqual(0.0025);
    // The safe roles keep the distance from every status color, so only the lamp clashes.
    const colors = statusColors();
    for (const [role, c] of Object.entries(SAFE)) for (const s of Object.keys(colors) as (keyof typeof colors)[]) expect(deltaEOk(c, colors[s]), `${role} keeps the distance from ${s}`).toBeGreaterThanOrEqual(DISTANCE + 0.01);
  });

  it('#382.1baf9f5b played on its own, the film keeps the data color unchanged, runs no status guard and shows no legend', () => {
    requireGpu();
    const failures = playedAlone({});
    expect(failures, failures.join('\n')).toEqual([]);
  }, 1_800_000);

  it('#382.1baf9f5b a planted guard that runs everywhere fails the film played alone, naming what it moved or showed', () => {
    requireGpu();
    // The mutant moves the near-fail pixels, reports a guard that ran, or shows a legend: the same check fails on it.
    const failures = playedAlone({ planted: 'guard_everywhere' });
    expect(failures.some((f) => /guard ran|pixels lie within|data color changed|legend/.test(f)), `the mutant guards or shows a legend in the film alone: ${failures.join('\n')}`).toBe(true);
  }, 1_800_000);

  it('#382.1baf9f5b the same film shown on a return card is refused naming the data role and the status color', () => {
    requireGpu();
    const bin = bins.bin();
    const path = writeJson(out(), 'art-film.json', film('art-film-382'));
    const reply = run1(bin, out(), { call: 'host', kind: 'return_card', look: CARD_LOOK, size: [480, 360], doc: path, doc_look: artLook(NEAR), frames: 1 });
    expect(distanceRefusal(reply, 'lamp', 'fail', 'the art film on a return card'), '').toEqual([]);
  }, 1_800_000);

  it('#382.1baf9f5b the same film given one status binding is refused naming the data role and the status color', () => {
    requireGpu();
    const bin = bins.bin();
    const bound = writeJson(out(), 'art-film-bound.json', film('art-film-382', { binding: true }));
    const reply = run1(bin, out(), { call: 'view3d', doc: bound, look: artLook(NEAR), size: [480, 360], states: { [VERDICT]: 'fail' } });
    expect(distanceRefusal(reply, 'lamp', 'fail', 'the art film with one status binding'), '').toEqual([]);
    // A check that refuses every bound document fails here: the lamp 0.12 from fail, bound, is accepted.
    const far = answered(run1(bin, out(), { call: 'view3d', doc: bound, look: artLook(FAR), size: [480, 360], states: { [VERDICT]: 'fail' } }), 'the bound film with the lamp 0.12 from fail');
    expect(statusOf(far, 'the bound film').shows, 'status can show in the bound film').toBe(true);
  }, 1_800_000);
});
