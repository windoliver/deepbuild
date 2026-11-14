// #239: deep-show sets a text's font role in the document's look, as the live view does (Look `look@1`: a role may name
// a font; Text `text@1`: `font: role = body`). notebook_pencil sets `body` in its hand face, clean in the bundled sans,
// so one line of body text shaped under each lands its glyphs apart, the hand face narrower. A deep-show that shapes
// every look's `body` in the bundled sans lays both out the same. Runs the real `deep-show`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOC, REPO, TIMEOUT, arr, obj, present, putEvidence, runShow, scenario, sha256, useShow, useTemp, type JsonObject } from './acceptance/501/helpers.ts';

const shows = useShow(['full']);
const temp = useTemp();
const LICENSE = { id: 'Apache-2.0', terms: 'Apache License 2.0.', shareable: true, credit: 'A look bundled with DeepBuild.' };

/** The x of each glyph of one body-text line, shaped under the shipped look `look`. */
function glyphXs(look: string): number[] {
  const evidence = temp();
  const bytes = readFileSync(join(REPO, 'crates', 'deep-canvas-marks', 'looks', `${look}.json`));
  putEvidence(evidence, bytes);
  const doc: JsonObject = {
    format: 1, id: `look-type-${look}`, profile: 'film', title: 'Look type', description: 'One line of body text.', size: [640, 360], camera: 'cam',
    look: { asset: `${look}@1`, theme: 'light' }, assets: { [look]: { sha256: sha256(bytes), license: LICENSE } }, transport: { span: '1s', frame_rate: [30, 1] },
    items: {
      cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [320, 180, 0], view_width: 640 } },
      line: { id: 'line', kind: 'text@1', name: 'Line', order: 'a1', params: { text: 'Strokes and paper', font: 'body', size: 48, box: { w: 600, h: 80 } }, at: { pos: [20, 140, 0] } },
    },
  };
  const [shown, evaluated] = runShow(shows.bin('full'), scenario(evidence, [present(DOC.a, doc), { call: 'eval', doc: DOC.a, t: 0, film: true }]), look);
  expect(shown!['outcome'], `${look}: deep show presents the document`).toBe('presented');
  const glyphs = arr(obj(obj(evaluated!['film'], `${look}: film`)['glyphs'], `${look}: glyphs`)['line'], `${look}: the line's glyphs`);
  return glyphs.map((g) => Number(obj(g, `${look}: a glyph`)['x']));
}

describe('#239 deep-show sets a text in its look\'s font role', () => {
  it('notebook_pencil sets body in its hand face, clean in the bundled sans: the same line lands its glyphs apart, the hand face narrower', () => {
    const hand = glyphXs('notebook_pencil');
    const sans = glyphXs('clean');
    expect(hand.length, 'one glyph per letter under each look').toBe(sans.length);
    expect(hand, 'the hand face sets the line differently from the bundled sans').not.toEqual(sans);
    expect(hand.at(-1)! - hand[0]!, 'the hand face is narrower than the bundled sans').toBeLessThan(sans.at(-1)! - sans[0]!);
  }, TIMEOUT);
});
