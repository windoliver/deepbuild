// AC6 #427.88bc74a6: Probes: each irradiance and reflection probe draws at its position as a sphere shaded from its own
// stored data, and `drawn` lists each probe's ID and position. Sound sources: each positional voice draws its inner and
// outer cone and range, and `drawn` lists them equal to the voice's fields.
//
// `deep-show run`, a work-product scene (figures refuse probes). Probes: `light.probe@1` items of type irradiance at
// (−2, 1, 0) and reflection at (2, 1.5, −1), the reflection probe parented to a box at (2, 0.5, −1), so its world
// position isn't its authored one. Each `drawn` row names the probe, its world position, and `data`: the SHA-256 of the
// stored capture or bake the sphere shades from, which the evidence store holds and which differs between the two
// probes (README: Assumed surfaces 5). Sound sources: two emitters (the media module's Emitter fields) on items at known
// places, each with its own cone and distance; each row repeats them.
import { describe, it } from 'vitest';
import {
  AC, type JsonObject, box, camera, drew, evidenceBytes, far, fmt, mode, none, requireMetal, rowsOf, runShow, scenario, scene, show, sun,
  useBuilds, useDir, vec3, type V3,
} from './helpers.ts';

const ID = AC[6];
const bin = useBuilds(['deep-show']);
const dir = useDir();

describe(`${ID} probes and sound sources drawn from their own data`, () => {
  it(`${ID} each irradiance and reflection probe draws at its world position, shaded from its own stored data`, () => {
    requireMetal();
    const evidence = dir();
    const doc = scene('Probes', {
      cam: camera([0, 1, 0], 9),
      stand: box([2, 0.5, -1]),
      'probe.irr': { kind: 'light.probe@1', params: { type: 'irradiance', size: [4, 3, 4] }, at: { pos: [-2, 1, 0] } },
      'probe.refl': { kind: 'light.probe@1', params: { type: 'reflection', size: [4, 3, 4] }, parent: 'stand', at: { pos: [0, 1, 0] } },
      ground: box([0, -0.25, 0], [10, 0.5, 8]),
      key: sun(),
    });
    const [, reply] = runShow(bin('deep-show'), scenario(evidence, [show(doc), mode('probes')]));
    const rows = drew(reply!, 'the probes mode').rows;
    const p: string[] = [];
    const data = new Map<string, string>();
    for (const [id, type, at] of [['probe.irr', 'irradiance', [-2, 1, 0]], ['probe.refl', 'reflection', [2, 1.5, -1]]] as [string, string, V3][]) {
      const r = rowsOf(rows, id, 'probe');
      if (r.length !== 1) { p.push(`${id}: ${r.length} probe rows drawn, not 1`); continue; }
      if (far(vec3(r[0]!['pos']), at)) p.push(`${id}: drawn at ${fmt(vec3(r[0]!['pos']))}, not its world position ${fmt(at)}`);
      if (r[0]!['type'] !== type) p.push(`${id}: drawn as ${JSON.stringify(r[0]!['type'])}, not ${type}`);
      const h = r[0]!['data'];
      if (typeof h !== 'string') { p.push(`${id}: its row names no stored data it shades from`); continue; }
      evidenceBytes(evidence, h, `${id}'s stored data`);
      data.set(id, h);
    }
    if (data.size === 2 && new Set(data.values()).size !== 2) p.push(`both probes shade from the same stored data ${[...data.values()][0]}`);
    none(p, 'the probes');
  }, 900_000);

  it(`${ID} each positional voice draws its inner and outer cone and range, listed equal to its fields`, () => {
    requireMetal();
    const voices: Record<string, { item: string; at: V3; cone: JsonObject; distance: JsonObject }> = {
      'voice.bell': { item: 'bell', at: [-1, 1, 0], cone: { inner: 40, outer: 100, outer_gain: 0.25 }, distance: { model: 'inverse', ref: 1, max: 12, rolloff: 1 } },
      'voice.horn': { item: 'horn', at: [1.5, 0.5, 1], cone: { inner: 20, outer: 60, outer_gain: 0 }, distance: { model: 'linear', ref: 2, max: 30, rolloff: 0.5 } },
    };
    const items: Record<string, JsonObject> = { cam: camera([0, 1, 0], 9), key: sun() };
    for (const v of Object.values(voices)) items[v.item] = box(v.at, [0.3, 0.3, 0.3]);
    const doc = scene('Voices', items, {
      requires: { modules: { scene3d: '^1', media: '^1' } },
      strips: { chime: { synth: 'sine', freq: 440, span: '2s' } },
      emitters: Object.fromEntries(Object.entries(voices).map(([id, v]) => [id, { item: v.item, src: 'chime', distance: v.distance, cone: v.cone }])),
    });
    const [, reply] = runShow(bin('deep-show'), scenario(dir(), [show(doc), mode('sound_sources')]));
    const rows = drew(reply!, 'the sound sources mode').rows;
    const p: string[] = [];
    for (const [id, v] of Object.entries(voices)) {
      const r = rowsOf(rows, id, 'voice');
      if (r.length !== 1) { p.push(`${id}: ${r.length} voice rows drawn, not 1`); continue; }
      const row = r[0]!;
      if (far(vec3(row['pos']), v.at)) p.push(`${id}: drawn at ${fmt(vec3(row['pos']))}, not its item's position ${fmt(v.at)}`);
      const want = { inner: v.cone['inner'], outer: v.cone['outer'], outer_gain: v.cone['outer_gain'], range: v.distance['max'] };
      const got = { inner: row['inner'], outer: row['outer'], outer_gain: row['outer_gain'], range: row['range'] };
      if (JSON.stringify(got) !== JSON.stringify(want)) p.push(`${id}: drawn with ${JSON.stringify(got)}, not its fields ${JSON.stringify(want)}`);
    }
    none(p, 'the voices');
  }, 900_000);
});
