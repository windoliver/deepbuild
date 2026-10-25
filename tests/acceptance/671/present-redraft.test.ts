// AC1, first test, redrafted (A1-REDRAFT.md): the scene is presented with no issues, and so is its 2D label, each
// in its own writer layer. The scene (fixtures/scene.json: 200 one-metre boxes on a ground plane under a camera
// that orbits once in 5 s) and its 2D label (fixtures/label.json, an overlay anchored 1.5 m above box-02-01) are
// sent with `deep show` by two test processes, each inside its own test agent's process tree, to the document the
// hub minted (#96's shared document). Neither the issue nor the README fixes the order in which the screen lists
// the two layers, so they are compared as a set. At the base the hub refuses the scene: its orbit channel's target
// `items/cam/params/orbit/azimuth` "reaches nothing".
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BEACON, DOC, LABEL, LABEL_AGENT, LABELED_BOX, SCENE, SCENE_AGENT, SHOW_BIN, bands, boxIds, checkpointCalls,
  expectPresentedClean, is3dKind, isObject, keepProof, layerOf, obj, readDocument, scenario, showLines, strs, useBins, useOut, writerText,
  type JsonObject,
} from './helpers.ts';

const bins = useBins([SHOW_BIN]);
const out = useOut();

/** The fixtures hold what the issue's scope names, before anything runs (a wrong fixture would make every test vacuous). */
function scopeHolds(): void {
  const items = obj(SCENE['items'], 'the scene\'s items');
  const boxes = boxIds();
  expect(boxes.length, 'the scene holds 200 boxes').toBe(200);
  for (const id of boxes) {
    const box = obj(items[id], id);
    expect([box['kind'], obj(box['params'], id)['size'], (obj(box['at'], id)['pos'] as number[])[1]], `${id} is a 1 m mark.box@1 standing on the ground plane`).toEqual(['mark.box@1', [1, 1, 1], 0.5]);
  }
  const ground = obj(items['ground'], 'ground');
  const top = (obj(ground['at'], 'ground')['pos'] as number[])[1]! + (obj(ground['params'], 'ground')['size'] as number[])[1]! / 2;
  expect([ground['kind'], top], 'the ground plane is a mark.box@1 whose top is at y = 0').toEqual(['mark.box@1', 0]);
  const labelItems = obj(LABEL['items'], 'the label\'s items');
  const overlays = Object.values(labelItems).filter((v) => isObject(v) && v['kind'] === 'overlay.frame@1') as JsonObject[];
  expect(overlays.map((o) => obj(obj(o['params'], 'overlay')['anchor'], 'anchor')['item']), 'one 2D label, anchored to a box').toEqual([LABELED_BOX]);
  expect(Object.values(labelItems).filter((v) => isObject(v) && is3dKind(String(v['kind']))), 'the label\'s document holds no 3D item, so its layer is a 2D writer layer').toEqual([]);
  for (const [name, doc] of [['scene', SCENE], ['label', LABEL]] as const) {
    expect(['id', 'layers', 'writer'].filter((k) => k in doc), `the ${name} is sent as an agent sends it: no id, layers or writer`).toEqual([]);
    expect(Object.values(obj(doc['items'], name)).filter((v) => isObject(v) && 'layer' in v).length, `no ${name} item names its layer`).toBe(0);
  }
}

/**
 * Sorts [band, owner] rows by a key built from their values, so two lists holding the same rows in any order sort
 * alike. (The default sort compares `String(row)`, and every row here stringifies to `agent,[object Object]`.)
 */
function bySet(rows: [string, JsonObject][]): [string, JsonObject][] {
  const key = ([band, owner]: [string, JsonObject]): string => JSON.stringify([band, owner['kind'] ?? null, owner['id'] ?? null]);
  return rows.slice().sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

describe('AC1 the scene is presented with no issues and its snapshot equals by pixel hash on a second run on one machine; the blank guard runs before the comparison, so two blank frames never count as equal', () => {
  it('AC1 the scene and its 2D label, each sent by deep show from a test process in its agent\'s tree, are presented with no issues, each in its own writer layer (redraft)', () => {
    scopeHolds();
    const evidence = join(out(), 'evidence');
    mkdirSync(evidence, { recursive: true });
    const [replies] = showLines(bins.bin(SHOW_BIN), [scenario(evidence, checkpointCalls(false))]) as [JsonObject[]];
    const [scene, label, screen, read] = replies as [JsonObject, JsonObject, JsonObject, JsonObject];
    keepProof('ac1-replies', { scene, label, screen, read: { ...read, document: '(kept as ac1-hub-document)' } });
    // A check that refuses any part of the scene (the orbit channel on the camera's azimuth, at the base) or warns on it fails here.
    expectPresentedClean(scene, 'the scene\'s deep show');
    expectPresentedClean(label, 'the label\'s deep show');
    // Each document is its agent's own writer layer, in the agent band, in either order. A hub that puts the label
    // in the scene's layer (one layer on screen, or one layer listed twice), stamps either as you (owner kind
    // `you`), or shows one layer fails here.
    const rows = bands(screen).filter((b) => b.band !== 'card');
    const expected: [string, JsonObject][] = [
      ['agent', { kind: 'agent', id: SCENE_AGENT.thread }],
      ['agent', { kind: 'agent', id: LABEL_AGENT.thread }],
    ];
    expect(bySet(rows.map((b) => [b.band, b.owner] as [string, JsonObject])), `two layers on screen, one for each test agent, in the agent band, in any order: ${JSON.stringify(rows)}`)
      .toEqual(bySet(expected));
    expect(new Set(rows.map((b) => b.layer)).size, `the two rows on screen are two layers, not one listed twice: ${JSON.stringify(rows)}`).toBe(2);
    const doc = readDocument(read);
    keepProof('ac1-hub-document', doc);
    const misplaced = [
      ...Object.keys(obj(SCENE['items'], 'scene')).filter((id) => layerOf(doc, id).writer !== writerText(SCENE_AGENT)).map((id) => `${id} (scene) in ${JSON.stringify(layerOf(doc, id))}`),
      ...Object.keys(obj(LABEL['items'], 'label')).filter((id) => layerOf(doc, id).writer !== writerText(LABEL_AGENT)).map((id) => `${id} (label) in ${JSON.stringify(layerOf(doc, id))}`),
    ];
    expect(misplaced.slice(0, 8), 'every scene item is in the scene agent\'s layer and every label item in the label agent\'s').toEqual([]);
    expect(layerOf(doc, 'label').layer, 'the 2D label is in a writer layer of its own').not.toBe(layerOf(doc, LABELED_BOX).layer);
    // The label's anchor resolves to the other writer's box, so the label draws (an unresolved anchor hides it), and every mark draws.
    const draws = strs(read['draws'], 'read: draws');
    const wanted = [...boxIds(), 'ground', BEACON, ...Object.keys(obj(LABEL['items'], 'label'))];
    expect(wanted.filter((id) => !draws.includes(id)).slice(0, 8), 'every box, the ground plane, the beacon and the label draw').toEqual([]);
    expect(String(read['hash'] ?? ''), `the hub's revision of ${DOC} has a hash`).toMatch(/^[0-9a-f]{64}$/);
  }, 600_000);
});
