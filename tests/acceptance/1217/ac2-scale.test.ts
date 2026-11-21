// AC2 #1217.a1a883c2: A part drawn at `shown_at: 1000` (#1183), 2 mm real across, reads 2.00 mm, not 2.00 m. A measure
// from that part to a part at `shown_at: 1` reads no number and names both scales.
//
// The fixture (README: Fixtures, the scaled parts): a figure of two assemblies, `micro` (`shown_at: 1000`) and `bench`
// (`shown_at: 1`). `chip`, a `slab@1` of size [2, 1, 1] at (−1.5, 0, 0), is in `micro`: drawn 2 m across, so 2 mm real.
// `block`, a `slab@1` of size [1, 1, 1] at (1.75, 0, 0), is in `bench`. The eye is at (0, 5, 7) looking at (0, 0.5, 0),
// fov 40°, 800 × 600.
//
// Four clicks, each 5 px inside the midpoint of an end edge of a top face, toward the face's centre, so the snap moves
// each onto that midpoint (the fixture is held to the built meshes read through `geometry`, as criterion 1's is):
// 1 and 2: `chip`'s two ends, (−2.5, 1, 0) and (−0.5, 1, 0), 2 m apart as drawn: the readout's distance is "2.00 mm".
// 3: `chip`'s first end again, which starts again at A. 4: `block`'s end (1.25, 1, 0): A on `chip`, B on `block`, parts
// drawn at two scales: none of distance, run and rise is text, and `why` holds both 1000 and 1 as numbers.
//
// The planted `measure_ignores_shown_at` (the readout computed from the drawn points alone) must fail this judgement,
// reading "2.00 m" for the part.
//
// Wrong programs this fails on: the base; a readout in the drawn length (2.00 m); a readout in metres at two decimals
// (0.00 m); a number read across two scales; a reason that names neither scale, or only one.
import { describe, expect, it } from 'vitest';
import {
  AC, SCALES, TIMEOUT, Script, at, builtOf, cameraDiffers, clickNear, clickProblem, dist, fmt, measureIn, notPresented, numbersIn, readoutText, requireMetal,
  runShow, scaledParts, scenario, show, useShow, useTemp, type Answer, type Measure, type Planted, type V2,
} from './helpers.ts';

const bin = useShow();
const temp = useTemp();
const BOUND = 1e-5;
const PLACED = { chip: [-1.5, 0, 0] as [number, number, number], block: [1.75, 0, 0] as [number, number, number] };

interface Run { answer: Answer; shown: number; before: number; geometry: number; on: number; across: number; again: number; mixed: number; clicks: V2[] }
/** One run of the scenario: the figure shown, the tool on, the two clicks across `chip`, then a click on `chip` and one on `block`. */
function run(planted?: Planted): Run {
  const f = scaledParts(2);
  const clicks: V2[] = [
    clickNear(f.cam, SCALES.chipEnds[0], SCALES.chipTop), clickNear(f.cam, SCALES.chipEnds[1], SCALES.chipTop),
    clickNear(f.cam, SCALES.chipEnds[0], SCALES.chipTop), clickNear(f.cam, SCALES.blockEnd, SCALES.blockTop),
  ];
  const s = new Script();
  const shown = s.present(f.id, f.document);
  const before = s.scope();
  const geometry = s.geometry(f.id, ['chip', 'block']);
  const on = s.measure(true);
  s.click(clicks[0]!);
  const [, across] = s.click(clicks[1]!);
  const [, again] = s.click(clicks[2]!);
  const [, mixed] = s.click(clicks[3]!);
  const answer = runShow(bin(), scenario(temp(), f.id, f.size, s.calls, planted ? { planted } : {}), `AC2 the scaled parts${planted ? ` (planted ${planted})` : ''}`);
  return { answer, shown, before, geometry, on, across, again, mixed, clicks };
}

/** The criterion's judgement of the two readouts: each failure in words. */
function failures(across: Measure, mixed: Measure): string[] {
  const out: string[] = [];
  if (across.readout?.distance !== '2.00 mm') out.push(`the part 2 mm real across reads ${across.readout ? JSON.stringify(across.readout.distance) : 'no readout'}, not "2.00 mm"`);
  const m = mixed.readout;
  if (!m) return [...out, 'a measure across two scales shows no readout, so it doesn\'t say why it reads no number'];
  for (const k of ['distance', 'run', 'rise'] as const) if (m[k] !== null) out.push(`a measure across two scales reads a ${k}, ${JSON.stringify(m[k])}`);
  const named = m.why === null ? [] : numbersIn(m.why);
  for (const scaleValue of [SCALES.micro, SCALES.bench]) if (!named.includes(scaleValue)) out.push(`the reason ${JSON.stringify(m.why)} doesn't name the scale ${scaleValue}`);
  return out;
}

describe(`${AC[2]} a part drawn larger than real reads its real length, and two scales read no number`, () => {
  it(`${AC[2]} a part drawn 2 m across at shown_at 1000 reads 2.00 mm, and a measure from it to a part at shown_at 1 reads no number and names 1000 and 1`, () => {
    requireMetal();
    const f = scaledParts(2);
    const x = run();
    expect(x.answer.ok, `deep-show run takes the scenario: ${show(x.answer.raw, 2000)}`).toBe(true);
    const r = x.answer.replies;
    expect(notPresented(r[x.shown]), 'the figure, which offers the measure tool (viewer_tools: {measure: true}), is presented').toBe('');
    expect(cameraDiffers(r[x.before], f.cam), 'the panel shows the figure through the fixture\'s camera').toBe('');

    // The fixture, held to the meshes the app built.
    const { built, problem } = builtOf(r[x.geometry], PLACED);
    expect(problem, 'the fixture: geometry gives both parts\' built meshes').toBe('');
    const targets: [string, [number, number, number]][] = [['chip', SCALES.chipEnds[0]], ['chip', SCALES.chipEnds[1]], ['chip', SCALES.chipEnds[0]], ['block', SCALES.blockEnd]];
    targets.forEach(([item, target], k) => expect(clickProblem(f.cam, built, x.clicks[k]!, item, target), `the fixture: click ${k + 1} snaps to ${item}'s end-edge midpoint ${fmt(target)} and to nothing else`).toBe(''));
    expect(dist(SCALES.chipEnds[0], SCALES.chipEnds[1]), 'the fixture: the part\'s two ends are 2 m apart as drawn, 2 mm at shown_at 1000').toBe(SCALES.drawn);

    // Across the part.
    expect(measureIn(r[x.on]).on, `the viewer's setting turns the tool on: state.measure is ${show(at(r[x.on], 'state', 'measure'))}`).toBe(true);
    const across = measureIn(r[x.across]);
    expect([across.a?.item, across.b?.item], `the two clicks place A and B on the part: ${show(across.raw)}`).toEqual(['chip', 'chip']);
    expect(dist(across.a!.point, SCALES.chipEnds[0]), `A is the midpoint of the part's first end edge, as drawn: got ${fmt(across.a!.point)}`).toBeLessThanOrEqual(BOUND);
    expect(dist(across.b!.point, SCALES.chipEnds[1]), `B is the midpoint of the part's other end edge, as drawn: got ${fmt(across.b!.point)}`).toBeLessThanOrEqual(BOUND);
    expect(across.readout?.distance, `a part 2 mm real across, drawn at shown_at 1000, reads 2.00 mm, not 2.00 m: ${readoutText(across.readout)}`).toBe('2.00 mm');

    // From that part to a part at shown_at 1.
    const again = measureIn(r[x.again]);
    expect([again.a?.item ?? null, again.b], `a third click starts again, placing A on the part: ${show(again.raw)}`).toEqual(['chip', null]);
    const mixed = measureIn(r[x.mixed]);
    expect([mixed.a?.item, mixed.b?.item], `the measure runs from the part at shown_at 1000 to the part at shown_at 1: ${show(mixed.raw)}`).toEqual(['chip', 'block']);
    expect(dist(mixed.b!.point, SCALES.blockEnd), `B is the midpoint of the other part's end edge: got ${fmt(mixed.b!.point)}`).toBeLessThanOrEqual(BOUND);
    console.log(`${AC[2]}: across the part: ${readoutText(across.readout)}; across two scales: ${readoutText(mixed.readout)}`);
    expect([mixed.readout?.distance ?? null, mixed.readout?.run ?? null, mixed.readout?.rise ?? null], `two points on parts drawn at different scales read no number: ${readoutText(mixed.readout)}`).toEqual([null, null, null]);
    expect(typeof mixed.readout?.why, `the readout says why it reads no number: ${show(mixed.raw)}`).toBe('string');
    const named = numbersIn(mixed.readout!.why!);
    expect(named, `the reason names the scale 1000: ${JSON.stringify(mixed.readout!.why)}`).toContain(SCALES.micro);
    expect(named, `the reason names the scale 1: ${JSON.stringify(mixed.readout!.why)}`).toContain(SCALES.bench);
    expect(failures(across, mixed), 'the criterion\'s judgement, as the planted program is held to it').toEqual([]);
  }, TIMEOUT);

  it(`${AC[2]} the planted measure_ignores_shown_at, which reads the drawn length, fails: the part reads 2.00 m`, () => {
    requireMetal();
    const x = run('measure_ignores_shown_at');
    expect(x.answer.ok, `deep-show run takes the planted measure_ignores_shown_at: ${show(x.answer.raw, 2000)}`).toBe(true);
    const r = x.answer.replies;
    expect(notPresented(r[x.shown]), 'the figure is presented under the planted program').toBe('');
    const across = measureIn(r[x.across]);
    const mixed = measureIn(r[x.mixed]);
    // The planted program is the tool but for the scale: it places the same points.
    expect([across.a?.item, across.b?.item], `the planted program still places A and B on the part: ${show(across.raw)}`).toEqual(['chip', 'chip']);
    const found = failures(across, mixed);
    console.log(`${AC[2]}: planted measure_ignores_shown_at: ${found.join('; ')}`);
    expect(found.length, 'the criterion\'s judgement fails the planted program').toBeGreaterThan(0);
    expect(found.some((line) => line.includes('"2.00 m"')), `a failure names the drawn length the planted program reads, 2.00 m: ${found.join('; ')}`).toBe(true);
  }, TIMEOUT);
});
