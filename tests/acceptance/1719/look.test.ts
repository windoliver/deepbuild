// AC1 #1719.7d3b0d01: The red box document (one `mark.box@1` with a red `material@1` on a `slab@1`, a 3,000 lx
// `light.sun@1`, `look: castle-dusk@1`) renders back with the box's region, from the reply's `visible` box, holding a
// mean red channel at least 0.2 above its green, and no color over 60% of the frame. On the merge base the frame is
// 99.99% white and the test fails, naming the share.
// AC3 #1719.a8f28cf0: Changing only `look.asset` between two looks with different tone maps changes the snapshot's
// pixel hash; on the merge base the two hashes are equal.
// AC4 #1719.da234c2b: A document naming a look whose asset isn't in the store is answered with an issue at
// `look/asset`, and no snapshot drawn in another look.
// AC5 #1719.60109185: A 3D snapshot whose most common color covers at least 98% of it carries a `snapshot_blank` notice
// with that share; the clean castle carries none.
//
// "Renders back" and "a 3D snapshot" are both replies a revision's snapshot comes back on, its presenting reply and a
// `render_back` of it in the same `deep-show run` (README: Readings); each is judged, and a failure names which.
// Each fixture is a document the base presents with no issue, and each threshold is one view3d's own frame of the same
// document in the same look meets (README: What view3d draws).
import { describe, expect, it } from 'vitest';
import {
  ABSENT, CASTLE_PACKS, CASTLE_SIZE, DOC, DUSK, bothWays, castle, castleLookBytes, type JsonObject, meanRgb, mostCommon, naming, none, numbers, objects, ownLook,
  pct, present, proof, renderBack, requireMetal, runShow, scenario, scene, seed, shown, snapshotOf, sub, useBins, useDir, visibleBox, WAYS,
} from './helpers.ts';

const bins = useBins();
const dir = useDir();

/** The red box document's items (README: The fixtures): the box stands on a floor that fills the frame. */
const RED_BOX: Record<string, JsonObject> = {
  cam: { kind: 'camera@1', params: { projection: 'perspective', position: [1.6, 3.6, 5.6], target: [0, 0.6, 0], fov: 34 } },
  sun: { kind: 'light.sun@1', params: { illuminance: 3000, color: [1, 1, 1], shadow: true }, at: { rot: [-55, 25, 0] } },
  red: { kind: 'material@1', params: { base_color: [0.8, 0.05, 0.05, 1], roughness: 0.6 } },
  grey: { kind: 'material@1', params: { base_color: [0.35, 0.35, 0.35, 1], roughness: 0.5 } },
  floor: { kind: 'slab@1', params: { size: [40, 0.2, 40] }, at: { pos: [0, -0.2, 0] }, material: 'grey' },
  box: { kind: 'mark.box@1', params: { size: [1.6, 1.6, 1.6] }, at: { pos: [0, 0.8, 0] }, material: 'red' },
};
/** The issue's own count: 64,000 pixels. */
const RED_SIZE: [number, number] = [320, 200];

describe('AC1 a lit scene in castle-dusk@1', () => {
  it('AC1 #1719.7d3b0d01 the red box document renders back with the box region\'s mean red at least 0.2 above its green, and no color over 60% of the frame', () => {
    requireMetal();
    const evidence = sub(dir(), 'evidence');
    const sha = seed(evidence, castleLookBytes());
    const back = bothWays(bins.show(), evidence, scene('A red box on a slab', RED_SIZE, RED_BOX, naming(DUSK, { [DUSK]: sha })), RED_SIZE, 'the red box in castle-dusk@1');
    const failures: string[] = [];
    for (const way of WAYS) {
      const { reply, snap } = back[way];
      const { color, share } = mostCommon(snap.image);
      const [red, green] = meanRgb(snap.image, visibleBox(reply, 'box', way));
      proof(`AC1 ${way}`, { png: snap.sha256, most_common: color, share, box_red: red, box_green: green });
      if (share > 0.6) failures.push(`${way}: ${pct(share)} of the frame is one color, ${color}, past 60%`);
      if (red - green < 0.2) failures.push(`${way}: the box's region holds a mean red of ${red.toFixed(3)}, ${(red - green).toFixed(3)} above its green, under 0.2`);
    }
    none(failures, 'the red box document renders back as a lit red box');
  }, 1_800_000);
});

describe('AC3 two looks with different tone maps', () => {
  it('AC3 #1719.a8f28cf0 changing only look.asset between two looks with different tone maps changes the snapshot\'s pixel hash', () => {
    requireMetal();
    const evidence = sub(dir(), 'evidence');
    // One look twice but for its ID and its tone map, so nothing else of it (its roles, its ground) can move a pixel.
    const looks: Record<string, string> = {};
    for (const [id, tone_map] of [['tone-filmic', 'filmic'], ['tone-neutral', 'neutral']] as const) looks[id] = seed(evidence, Buffer.from(JSON.stringify(ownLook(id, { basis: 'physical', exposure: 9, tone_map }))));
    const documentIn = (named: string): JsonObject => scene('A red box on a slab', RED_SIZE, RED_BOX, naming(named, looks));
    const [a, b] = (['tone-filmic', 'tone-neutral'] as const).map((named) => bothWays(bins.show(), evidence, documentIn(named), RED_SIZE, `the red box in ${named}@1`)) as [ReturnType<typeof bothWays>, ReturnType<typeof bothWays>];
    const failures: string[] = [];
    for (const way of WAYS) {
      const [filmic, neutral] = [a[way].snap.pixelHash, b[way].snap.pixelHash];
      proof(`AC3 ${way}`, { 'tone-filmic@1': filmic, 'tone-neutral@1': neutral });
      if (filmic === neutral) failures.push(`${way}: in look.asset tone-filmic@1 and in tone-neutral@1 the snapshot has one pixel hash, ${filmic}`);
    }
    none(failures, 'changing only look.asset between a filmic and a neutral look changes the snapshot\'s pixel hash');
  }, 1_800_000);
});

describe('AC4 a look the store doesn\'t hold', () => {
  it('AC4 #1719.da234c2b a document naming a look whose asset isn\'t in the store is answered with an issue at look/asset, and no snapshot drawn in another look', () => {
    requireMetal();
    const evidence = sub(dir(), 'evidence');
    const size: [number, number] = [320, 240];
    const document = scene('A box in a lost look', size, {
      cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 0, 8], target: [0, 0, 0], fov: 40 } },
      box: { kind: 'mark.box@1', params: { size: [2, 2, 2], paint: { fill: { role: 'accent' } } } },
    }, naming('lost-look', { 'lost-look': ABSENT }));
    // Presented by the agent; and stored (README: Readings, "answered"), so that it has a revision to render back whether
    // or not presenting it makes one.
    const [fresh, kept] = [DOC(1), DOC(2)];
    const layer = 'main';
    const items = Object.fromEntries(Object.entries(document['items'] as Record<string, JsonObject>).map(([id, item]) => [id, { ...item, layer }]));
    const stored: JsonObject = { ...document, id: kept.toLowerCase(), layers: { [layer]: { writer: 'agent:alpha', title: 'Main', order: 'a0' } }, items };
    const replies = runShow(bins.show(), scenario(evidence, [fresh, kept], [present(fresh, document, size), renderBack(kept, 0, size)], { stored: { [kept]: stored } }), 'a document in a lost look');
    const failures: string[] = [];
    WAYS.forEach((way, i) => {
      const reply = replies[i]!;
      const issue = objects(reply).find((o) => o['path'] === 'look/asset' && typeof o['code'] === 'string' && o['code'] !== '');
      const snap = snapshotOf(evidence, reply);
      proof(`AC4 ${way}`, { issue: issue ?? null, outcome: reply['outcome'] ?? null, snapshots: reply['snapshots'] ?? null });
      if (!issue) failures.push(`${way}: the reply to a document in lost-look@1, whose asset isn't in the store, carries no issue at look/asset: ${shown(reply, 500)}`);
      if (typeof snap !== 'string' || (Array.isArray(reply['snapshots']) && reply['snapshots'].length > 0)) failures.push(`${way}: the reply carries a snapshot, drawn in some other look than lost-look@1, which the store doesn't hold: ${shown(reply['snapshots'], 300)}`);
    });
    none(failures, 'a document naming a look the store doesn\'t hold is answered with an issue at look/asset and no snapshot');
  }, 1_800_000);
});

describe('AC5 a snapshot of one color', () => {
  it('AC5 #1719.60109185 a 3D snapshot whose most common color covers at least 98% of it carries a snapshot_blank notice with that share; the clean castle carries none', () => {
    requireMetal();
    const evidence = sub(dir(), 'evidence');
    const size: [number, number] = [320, 240];
    const own = seed(evidence, Buffer.from(JSON.stringify(ownLook('plain-look'))));
    const flat = bothWays(bins.show(), evidence, scene('A small box far off', size, {
      cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 0, 20], target: [0, 0, 0], fov: 40 } },
      box: { kind: 'mark.box@1', params: { size: [1, 1, 1], paint: { fill: { role: 'accent' } } } },
    }, naming('plain-look', { 'plain-look': own })), size, 'a small box in plain-look@1');
    const dusk = seed(evidence, castleLookBytes());
    const clean = bothWays(bins.show(), evidence, castle(dusk), CASTLE_SIZE, 'the castle in castle-dusk@1', { packs: CASTLE_PACKS() });
    /** The reply's `snapshot_blank` notices, wherever it carries them (README: Readings). */
    const notices = (reply: JsonObject): JsonObject[] => objects(reply).filter((o) => o['code'] === 'snapshot_blank');
    const failures: string[] = [];
    for (const way of WAYS) {
      const { color, share } = mostCommon(flat[way].snap.image);
      expect(share, `the fixture: ${way}'s snapshot of the small box is ${pct(share)} one color, ${color}`).toBeGreaterThanOrEqual(0.98);
      const found = notices(flat[way].reply);
      proof(`AC5 ${way}, the small box`, { most_common: color, share, notices: found });
      if (found.length === 0) failures.push(`${way}: ${pct(share)} of the small box's snapshot is one color, ${color}, and the reply carries no snapshot_blank notice`);
      // The share, as a fraction or as a percentage, under whatever field the notice gives it: within 0.005, so neither
      // the 0.98 the criterion sets nor 1 reads as this fixture's 0.9926.
      else if (!found.some((n) => numbers(n).some((v) => Math.abs(v - share) <= 0.005 || Math.abs(v / 100 - share) <= 0.005))) failures.push(`${way}: the snapshot_blank notice doesn't hold the share, ${share.toFixed(4)}: ${shown(found)}`);
      const none_ = notices(clean[way].reply);
      proof(`AC5 ${way}, the castle`, { most_common: mostCommon(clean[way].snap.image), notices: none_ });
      if (none_.length > 0) failures.push(`${way}: the clean castle's reply carries a snapshot_blank notice, though its most common color covers ${pct(mostCommon(clean[way].snap.image).share)}: ${shown(none_)}`);
    }
    none(failures, 'a snapshot of one color carries a snapshot_blank notice with its share, and the clean castle\'s carries none');
  }, 1_800_000);
});
