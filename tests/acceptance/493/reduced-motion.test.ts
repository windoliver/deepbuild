// AC9 #493.b76c663b: A film with a 2 s push from 1 s to 3 s, a shake, a parallax group and a title whose letters fly
// in, rendered under reduced motion: hold, shows the camera's start pose before 2 s and its framed pose from 2 s, with
// a 200 ms dissolve across the cut, zero shake offset, a constant parallax offset, and every glyph at its landed
// position at all times while only its opacity changes; the same push marked essential plays as it does without
// reduced motion.
//
// Through `deep-show run` (`full`): the 2D film presented, then #387's `eval` at every 60 fps frame of [1 s, 3 s) with
// `view.reduced_motion` on and off and `film: true`, whose film block (README: `film`) gives the camera's pose, the
// dissolve, each parallax group's offset and each text item's glyphs. The start pose is the push's own at 1 s without
// reduced motion; the framed pose is a hold shot's of the same keep. The dissolve is read as centred on the cut,
// [1.9 s, 2.1 s] (README: Choices). Each half has a control without reduced motion, so a shake, a drift or an animator
// that does nothing can't pass.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, TIMEOUT, arr, camera2d, channel, evalCall, film, filmOf, fl, frames60, isObject, maxDiff, none, num, obj, poseFrom, present, presented,
  rect, runShow, scenario, shot, show, useEvidence, useShow, type Film, type JsonObject, type Pose,
} from './helpers.ts';

const shows = useShow(['full']);
const evidence = useEvidence();
const SIZE: [number, number] = [640, 360];
const TIMES = frames60(1, 3);
const LANDED_AT = fl(3.5);

function doc(push: JsonObject): JsonObject {
  return film('reduced', [
    camera2d(SIZE),
    rect('back', [-400, -200, 1440, 760], 'ground'),
    rect('box', [260, 140, 120, 80], 'accent'),
    { id: 'bg', kind: 'group@1', name: 'Hills', order: 'c0bg', params: { parallax: { rate: [0.5, 0.5], drift: [20, 0] } }, at: { pos: [0, 0, 0] } },
    rect('hill', [40, 260, 200, 60], 'muted', { parent: 'bg' }),
    {
      id: 'title', kind: 'text@1', name: 'Title', order: 'd0', at: { pos: [16, 16, 0] },
      params: { text: 'Launch', size: 24, box: { w: 200, h: 32 }, animators: [{ units: 'grapheme', range: { from: 0, to: 1, falloff: 0.5, offset: 0 }, shape: 'smooth', mode: 'add', props: { y: 40, opacity: 0 } }] },
    },
  ], {
    channels: { rise: channel('items/title/params/animators/0/range/offset', [[0, 0], [2.5, 2]]) },
    shots: { push },
  }, { span: '4s', reduced_motion: 'hold' }, SIZE);
}
const KEEP = { frame: { keep: ['box'] } };
const SHAKEN = doc(shot(1, 3, { move: 'push', ...KEEP, shake: { by: 1.5, hz: 2, roll: 1.5 } }));
const STILL = doc(shot(1, 3, { move: 'push', ...KEEP }));
const ESSENTIAL = doc(shot(1, 3, { move: 'push', ...KEEP, essential: true }));
const HOLD = doc(shot(1, 3, { move: 'hold', ...KEEP }));

interface Rendition { reduced: Film[]; full: Film[]; landed: Film }
const cache = new Map<string, Rendition>();
/** One document's film blocks at every time, under reduced motion and without, and without at 3.5 s. */
function rendition(name: string, d: JsonObject): Rendition {
  const known = cache.get(name); if (known) return known;
  const calls = [present(DOC.a, d), ...TIMES.map((t) => evalCall(DOC.a, t, { film: true, reducedMotion: true })), ...TIMES.map((t) => evalCall(DOC.a, t, { film: true, reducedMotion: false })), evalCall(DOC.a, LANDED_AT, { film: true, reducedMotion: false })];
  const replies = runShow(shows.bin('full'), scenario(evidence(), calls));
  presented(replies[0]!, name);
  const n = TIMES.length;
  const r: Rendition = {
    reduced: TIMES.map((t, i) => filmOf(replies[1 + i]!, `${name} under reduced motion at ${t}`)),
    full: TIMES.map((t, i) => filmOf(replies[1 + n + i]!, `${name} at ${t}`)),
    landed: filmOf(replies[1 + 2 * n]!, `${name} at 3.5 s`),
  };
  cache.set(name, r); return r;
}
const cam = (f: Film, what: string): Pose => poseFrom(f.cameras['cam'], `${what}: film.cameras.cam`);
const same = (a: Pose, b: Pose): boolean => maxDiff(a.target, b.target) <= 1e-9 && Math.abs(a.view_width - b.view_width) <= 1e-9 * b.view_width && Math.abs(a.roll - b.roll) <= 1e-9;
interface Glyph { x: number; y: number; opacity: number }
const glyphs = (f: Film, what: string): Glyph[] => arr(f.glyphs['title'], `${what}: film.glyphs.title`).map((g, i) => {
  const o = obj(g, `${what}: glyph ${i}`); return { x: num(o['x'], 'x'), y: num(o['y'], 'y'), opacity: num(o['opacity'], 'opacity') };
});

describe(`${AC[9]} reduced motion in a film: the push cuts at its midpoint, motion holds, type fades in place`, () => {
  it(`${AC[9]} under reduced motion the camera shows the push's start pose before 2 s and its framed pose from 2 s, with a 200 ms dissolve across the cut`, () => {
    const start = cam(rendition('still', STILL).full[0]!, 'the push at 1 s');
    const framed = cam(rendition('hold', HOLD).full[60]!, 'the hold shot at 2 s');
    expect(start.view_width / framed.view_width, 'the push starts wider than its framing').toBeGreaterThan(1.1);
    const r = rendition('shaken', SHAKEN).reduced;
    const failures: string[] = [];
    let lastMix = 0;
    TIMES.forEach((t, i) => {
      const p = cam(r[i]!, `reduced at ${t}`); const want = t < fl(2) ? start : framed;
      if (!same(p, want)) failures.push(`at ${t} flicks the camera shows ${JSON.stringify([p.target, p.view_width, p.roll])}, not the ${t < fl(2) ? 'start' : 'framed'} pose ${JSON.stringify([want.target, want.view_width, want.roll])}`);
      const d = r[i]!.dissolve;
      if (t > fl(1.9) && t < fl(2.1)) {
        if (!isObject(d)) { failures.push(`at ${t} flicks there is no dissolve: ${show(d)}`); return; }
        const mix = num(d['mix'], 'dissolve.mix');
        if (!(mix > 0 && mix < 1 && mix >= lastMix)) failures.push(`at ${t} flicks the dissolve's mix is ${mix} after ${lastMix}`);
        lastMix = mix;
        if (!same(poseFrom(d['from'], 'dissolve.from'), start) || !same(poseFrom(d['to'], 'dissolve.to'), framed)) failures.push(`at ${t} flicks the dissolve runs from ${show(d['from'])} to ${show(d['to'])}, not from the start pose to the framed one`);
      } else if ((t <= fl(1.85) || t >= fl(2.15)) && d !== null) failures.push(`at ${t} flicks, outside the 200 ms around the cut, a dissolve shows: ${show(d)}`);
    });
    none(failures, 'the push under reduced motion');
  }, TIMEOUT);

  it(`${AC[9]} under reduced motion the shake's offset is zero: the shaken film's camera equals the unshaken one's at every frame, though the shake moves it without reduced motion`, () => {
    const shaken = rendition('shaken', SHAKEN); const still = rendition('still', STILL);
    const failures: string[] = [];
    TIMES.forEach((t, i) => { if (JSON.stringify(shaken.reduced[i]!.cameras['cam']) !== JSON.stringify(still.reduced[i]!.cameras['cam'])) failures.push(`at ${t} flicks under reduced motion the shake moves the camera: ${show(shaken.reduced[i]!.cameras['cam'])} vs ${show(still.reduced[i]!.cameras['cam'])}`); });
    expect(TIMES.some((_, i) => JSON.stringify(shaken.full[i]!.cameras['cam']) !== JSON.stringify(still.full[i]!.cameras['cam'])), 'without reduced motion the shake moves the camera').toBe(true);
    none(failures, 'the shake under reduced motion');
  }, TIMEOUT);

  it(`${AC[9]} under reduced motion the parallax group's offset is constant, though its drift moves it without reduced motion`, () => {
    const r = rendition('shaken', SHAKEN);
    const offsets = r.reduced.map((f, i) => JSON.stringify(arr(f.parallax['bg'], `reduced at ${TIMES[i]}: film.parallax.bg`)));
    none(offsets.flatMap((o, i) => (o === offsets[0] ? [] : [`at ${TIMES[i]} flicks the parallax offset is ${o}, not ${offsets[0]}`])), 'the parallax offset under reduced motion');
    const moving = r.full.map((f, i) => JSON.stringify(arr(f.parallax['bg'], `at ${TIMES[i]}: film.parallax.bg`)));
    expect(new Set(moving).size, 'without reduced motion the drift moves the parallax group').toBeGreaterThan(1);
  }, TIMEOUT);

  it(`${AC[9]} under reduced motion every glyph of the title sits at its landed position at all times while only its opacity changes`, () => {
    const r = rendition('shaken', SHAKEN);
    const landed = glyphs(r.landed, 'the landed title');
    expect(landed.length, 'the title has six glyphs').toBe(6);
    expect(landed.every((g) => g.opacity === 1), 'at 3.5 s every glyph has landed, fully opaque').toBe(true);
    const failures: string[] = [];
    r.reduced.forEach((f, i) => glyphs(f, `reduced at ${TIMES[i]}`).forEach((g, k) => {
      if (g.x !== landed[k]!.x || g.y !== landed[k]!.y) failures.push(`at ${TIMES[i]} flicks glyph ${k} sits at (${g.x}, ${g.y}), not its landed (${landed[k]!.x}, ${landed[k]!.y})`);
    }));
    expect(Math.min(...glyphs(r.reduced[0]!, 'reduced at 1 s').map((g) => g.opacity)), 'at 1 s some glyph is still fading in').toBeLessThan(0.99);
    expect(glyphs(r.full[0]!, 'at 1 s').some((g, k) => g.y !== landed[k]!.y), 'without reduced motion the letters fly in').toBe(true);
    none(failures, 'the title under reduced motion');
  }, TIMEOUT);

  it(`${AC[9]} the same push marked essential plays under reduced motion as it does without it`, () => {
    const e = rendition('essential', ESSENTIAL); const still = rendition('still', STILL);
    const failures: string[] = [];
    TIMES.forEach((t, i) => {
      if (JSON.stringify(e.reduced[i]!.cameras['cam']) !== JSON.stringify(e.full[i]!.cameras['cam'])) failures.push(`at ${t} flicks the essential push under reduced motion reads ${show(e.reduced[i]!.cameras['cam'])}, without ${show(e.full[i]!.cameras['cam'])}`);
      if (!same(cam(e.full[i]!, 'essential'), cam(still.full[i]!, 'push'))) failures.push(`at ${t} flicks marking the push essential changes how it plays`);
    });
    none(failures, 'the essential push');
  }, TIMEOUT);
});
