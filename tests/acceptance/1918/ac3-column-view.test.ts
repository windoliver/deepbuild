// #1918.62636f58: the physics module fills the core's column.source@1 with each world's occurrence list, `<world
// ID>.occurrences`, and its readings, `<world ID>.<ID>.<read>`, and both entries pass the registry's kit at the seal; in
// the ball-and-goal lab a driver that counts the hits in `lab.occurrences` reads them through the column view, and seeks
// to 20 seeded times give the counts playing gives; a planted entry that hands the view no changed ranges while the ball
// moves fails clean-rebuild equality, naming the frame, and a planted motion operator that reads the physics module's
// array by name instead of by the form is refused at the seal, naming the read.
//
// All through `deep-show run` (README: deep-show): `registries` (#200's listing) for the entries and their kit results;
// a scene listing #2010's ball-and-goal lab as `lab`, with a driver writing count(hits) into the tally's x, played (an
// `eval` at every 60 fps frame in order) and seeked (`eval` on a second session at 20 frames drawn by mulberry32 seeded
// 1918); the twins as deep-show builds whose seal refuses them at startup (#200's refusal line). The physics window: the
// ball, kicked up at 3 m/s from the floor, first lands at 2 × 3 ÷ g = 0.6116 s.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, DOC, FLICKS, FRAME, G, SHOW_TIMEOUT, ballAndGoal, camera, columnSources, evalCall, markBox, none, presented, prebuildShow, runShow,
  scenario, sceneDoc, sealRefusalOf, seededFrames, show, showBin, showCall, startShow, useTemp, valuesOf, type JsonObject, type JsonValue, type Listed,
} from './helpers.ts';

prebuildShow(['full', 'no-changes', 'reads-by-name']);

const ID = CRITERIA[3];
const temp = useTemp();
/** 3 s at 60 fps: frames 0 to 180. */
const LAST = 180;
const TALLY = 'items/tally/at/pos/0';
const OCCURRENCES = /^<[^<>]+>\.occurrences$/;
const READINGS = /^<[^<>]+>\.<[^<>]+>\.<[^<>]+>$/;
const KIT_RULES = ['seek_equals_clean', 'clean_rebuild_equality'];

/** The lab as a scene: the world listed as `lab`, and a driver counting its hits into the tally's x. */
function labScene(): JsonObject {
  return sceneDoc('Ball and goal', '3s', { cam: camera([4, 3, 12], [4, 1, 0]), tally: markBox([0.1, 0.1, 0.1], [0, 4, 0]) }, {
    worlds: { lab: ballAndGoal() },
    drivers: { hits: { target: TALLY, expr: 'count(h)', vars: { h: { list: 'lab.occurrences', kinds: ['hit'] } } } },
  });
}

/** The full build's column.source@1 entries the physics module fills. */
function physicsEntries(): { occurrences: Listed; readings: Listed; all: Listed[] } {
  const [reply] = runShow(showBin('full'), scenario(temp(), [], [{ call: 'registries' }]), 'registries (full)');
  const { owner, entries } = columnSources(reply, 'deep://registries');
  expect(owner, 'the core declares column.source@1').toBe('core');
  const all = entries.filter((e) => e.module === 'physics');
  const occurrences = all.find((e) => OCCURRENCES.test(String(e.value['form'])));
  const readings = all.find((e) => READINGS.test(String(e.value['form'])));
  const listed = all.map((e) => `${e.name} (${String(e.value['form'])})`).join(', ') || 'none';
  expect(occurrences, `the physics module fills column.source@1 with <world ID>.occurrences; its entries: ${listed}`).toBeDefined();
  expect(readings, `the physics module fills column.source@1 with <world ID>.<ID>.<read>; its entries: ${listed}`).toBeDefined();
  return { occurrences: occurrences!, readings: readings!, all };
}
/** The fixture frames of an entry's kit (column.source@1's `fixture.frames`). */
const framesOf = (e: Listed): JsonValue[] => {
  const f = (e.value['fixture'] as JsonObject | undefined)?.['frames'];
  return Array.isArray(f) ? f : [];
};

describe(`${ID} the physics module's column sources, read through the column view, checked by the registry's kit at the seal`, () => {
  it(`${ID} (entries) the physics module fills column.source@1 with <world ID>.occurrences and <world ID>.<ID>.<read>, and both pass the registry's kit at the seal`, () => {
    const { occurrences, readings, all } = physicsEntries();
    const fails: string[] = [];
    for (const e of all) {
      if (e.verdict !== 'PASS') fails.push(`${e.name} (${String(e.value['form'])}) fails the kit: ${show(e.raw['kit'])}`);
      for (const rule of KIT_RULES) if (!e.rules.some((r) => r.rule === rule && r.verdict === 'PASS')) fails.push(`${e.name}: the kit's ${rule} doesn't pass it: ${show(e.raw['kit'])}`);
      for (const r of e.rules) if (r.verdict !== 'PASS') fails.push(`${e.name}: the kit's ${r.rule} fails: ${show(r.raw)}`);
    }
    none(fails, 'the physics module\'s entries pass the kit at the seal');
    expect(occurrences.name !== readings.name, 'the occurrence list and the readings are two entries').toBe(true);
    const frames = framesOf(readings);
    expect(frames.length > 1 && frames.some((f) => JSON.stringify(f) !== JSON.stringify(frames[0])), `the readings entry's kit fixture holds the ball moving (frames that change): ${show(readings.value['fixture'])}`).toBe(true);
  }, SHOW_TIMEOUT);

  it(`${ID} (driver) in the ball-and-goal lab a driver counting the hits in lab.occurrences reads them through the column view, and seeks to 20 seeded times give the counts playing gives`, () => {
    const scene = labScene();
    const [play, seek] = [DOC(1), DOC(2)];
    const frames = Array.from({ length: LAST + 1 }, (_, f) => f);
    const seeks = seededFrames(1918, 20, LAST);
    const calls = [showCall(play, scene), showCall(seek, scene), ...frames.map((f) => evalCall(play, f, [TALLY])), ...seeks.map((f) => evalCall(seek, f, [TALLY]))];
    const replies = runShow(showBin('full'), scenario(temp(), [play, seek], calls), 'the lab, played and seeked');
    presented(replies[0], 'the lab (played)');
    presented(replies[1], 'the lab (seeked)');
    const count = (r: JsonObject | undefined, what: string): number => {
      const v = valuesOf(r, what)[TALLY];
      expect(typeof v === 'number' && Number.isInteger(v) && v >= 0, `${what}: ${TALLY} is a count, got ${show(v)}`).toBe(true);
      return v as number;
    };
    const played = frames.map((f) => count(replies[2 + f], `the played lab at frame ${f}`));
    const fails: string[] = [];
    played.forEach((n, f) => { if (f > 0 && n < played[f - 1]!) fails.push(`playing: the count falls from ${played[f - 1]} to ${n} at frame ${f}`); });
    // The first landing, 2 · 3 ÷ g s after the kick, within a step either side.
    const land = (2 * 3) / G;
    played.forEach((n, f) => {
      const t = (f * FRAME) / FLICKS;
      if (t < land - 1 / 120 && n !== 0) fails.push(`playing: ${n} hits at frame ${f} (${t.toFixed(4)} s), before the ball first lands at ${land.toFixed(4)} s`);
      if (t > land + 1 / 120 && n < 1) fails.push(`playing: no hit at frame ${f} (${t.toFixed(4)} s), after the ball lands at ${land.toFixed(4)} s`);
    });
    seeks.forEach((f, i) => {
      const n = count(replies[2 + frames.length + i], `the seeked lab at frame ${f}`);
      if (n !== played[f]) fails.push(`seek ${i + 1} to frame ${f} counts ${n} hits, playing counts ${played[f]}`);
    });
    none(fails, 'the hit count, played and seeked');
  }, SHOW_TIMEOUT);

  it(`${ID} (twin: no changed ranges) a planted readings entry that hands the view no changed ranges while the ball moves fails clean-rebuild equality at the seal, naming the frame`, () => {
    // The twin is the readings entry with its changed ranges removed, so its kit fixture's frames are the real entry's:
    // the first frame whose rows differ from frame 0's is the first a rebuild from no changes gets wrong.
    const { readings } = physicsEntries();
    const frames = framesOf(readings);
    const first = frames.findIndex((f) => JSON.stringify(f) !== JSON.stringify(frames[0]));
    expect(first, `the readings entry's fixture holds a frame that differs from frame 0: ${show(readings.value['fixture'])}`).toBeGreaterThan(0);
    const r = sealRefusalOf(startShow(showBin('no-changes'), scenario(temp(), [], [{ call: 'registries' }])), 'deep-show --features test-physics-hands-no-changes');
    expect([r.reason, r.registry], `the seal refuses the entry that fails the kit (#200's entry_refused) in column.source@1: ${show(r.raw)}`).toEqual(['entry_refused', 'column.source@1']);
    expect(r.modules, `the refusal names the physics module: ${show(r.raw)}`).toContain('physics');
    expect(r.entries.map(String), `the refusal names the readings entry ${readings.name}: ${show(r.raw)}`).toContain(readings.name);
    expect(r.rules, `on clean-rebuild equality alone: ${show(r.raw)}`).toEqual(['clean_rebuild_equality']);
    expect(new RegExp(`\\bframe ${first}\\b`).test(r.what), `the refusal names frame ${first}, the first frame the ball has moved in: ${show(r.raw)}`).toBe(true);
  }, SHOW_TIMEOUT);

  it(`${ID} (twin: read by name) a planted motion operator that reads the physics module's array by name instead of by the form is refused at the seal, naming the read`, () => {
    const r = sealRefusalOf(startShow(showBin('reads-by-name'), scenario(temp(), [], [{ call: 'registries' }])), 'deep-show --features test-motion-reads-physics-array');
    expect(r.modules, `the refusal names the motion module and the physics module: ${show(r.raw)}`).toEqual(expect.arrayContaining(['motion', 'physics']));
    expect(/\bphysics\.[a-z0-9_.]+/.test(JSON.stringify({ arrays: r.raw['arrays'], what: r.what })), `the refusal names the read, a physics array: ${show(r.raw)}`).toBe(true);
  }, SHOW_TIMEOUT);
});
