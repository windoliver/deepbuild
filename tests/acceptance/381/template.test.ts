// AC2: a text item `Subtract {data/k} from both sides`, with k a story constant 3, shows `Subtract 3 from
// both sides` and passes honest numbers in a document that binds no status, fails naming the item in one
// that binds a status, and the same sentence with a literal 3 in its words fails in both.
// fixtures/step.json is the document with no status: `data.k = {value: 3, source: "story"}` and one
// text@1 item `step` whose `template` is the sentence. The test derives three more: the same with a
// status mark bound to a verdict (`gate`, a 96 × 24 rect, as #373's adjust board binds one), and each of
// the two with `text: "Subtract 3 from both sides"` in place of the template. The shown string is read
// from `deep-canvas-render raster`'s `texts` (the document drawn by Vello CPU); verdicts from its `check`
// with the clean look. At the base, text@1 has no template: the check refuses the item as bad_doc.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RENDER_BIN, arr, batch, clone, fixture, glyphsOf, obj, one, str, useBinaries, type JsonObject, type JsonValue } from './helpers.ts';

useBinaries('deep-canvas-render');

let out = '';
beforeEach(() => { out = mkdtempSync(join(tmpdir(), 'deep-381-template-')); });
afterEach(() => { if (out) rmSync(out, { recursive: true, force: true }); out = ''; });

const SHOWN = 'Subtract 3 from both sides';
const NO_STATUS = fixture('step.json');

function withStatus(doc: JsonObject): JsonObject {
  const d = clone(doc);
  (d['items'] as JsonObject)['gate'] = {
    id: 'gate', kind: 'rect@1', layer: 'main', name: 'Status of the release', order: 'a0', params: { box: [16, 16, 96, 24] },
  };
  d['status_bindings'] = { 'gate-state': { target: 'items/gate/params/paint/fill', source: 'verdict:01JB3810000000000000000001' } };
  return d;
}
function withText(doc: JsonObject, text: string): JsonObject {
  const d = clone(doc);
  const params = ((d['items'] as JsonObject)['step'] as JsonObject)['params'] as JsonObject;
  delete params['template'];
  params['text'] = text;
  return d;
}
const STATUS = withStatus(NO_STATUS);
const LITERAL = withText(NO_STATUS, SHOWN);
const LITERAL_STATUS = withText(STATUS, SHOWN);
/** The status document with words only: its status binding passes the check on its own. */
const WORDS_STATUS = withText(STATUS, 'Subtract the constant from both sides');

interface Checked { ok: boolean; errors: { code: string; ids: string[]; path: string }[] }

function check(docs: JsonObject[]): Checked[] {
  return batch(RENDER_BIN, ['check'], docs.map((doc) => ({ doc, look: 'clean' }))).map((v, i) => {
    const o = obj(v, `check line ${i + 1}`);
    const issues = arr(o['issues'], `check line ${i + 1}: issues`).map((x) => obj(x, 'issue'));
    return {
      ok: o['ok'] === true,
      errors: issues.filter((x) => x['severity'] === 'error').map((x) => ({
        code: String(x['code']), ids: Array.isArray(x['ids']) ? (x['ids'] as JsonValue[]).map(String) : [], path: String(x['path']),
      })),
    };
  });
}

const names = (c: Checked, id: string): boolean => !c.ok && c.errors.some((e) => e.ids.includes(id));
const shown = (c: Checked): string => JSON.stringify(c.errors);

describe('AC2 a template shows the evaluated story constant, which passes honest numbers only where no status is bound; a literal number fails', () => {
  it('AC2 with no status bound, `Subtract {data/k} from both sides` with k a story constant 3 shows `Subtract 3 from both sides` and passes the check', () => {
    const [checked] = check([NO_STATUS]);
    expect(checked!.errors, `the document with no status passes the check, honest numbers included: ${shown(checked!)}`).toEqual([]);
    expect(checked!.ok, 'the document with no status passes the check').toBe(true);
    const answer = one(RENDER_BIN, ['raster'], { out: join(out, 'step.png'), doc: NO_STATUS, look: 'clean' });
    expect(answer['ok'], `raster draws the document: ${JSON.stringify(answer).slice(0, 1500)}`).toBe(true);
    const step = obj(obj(answer['texts'], 'raster: texts')['step'], 'raster: texts.step');
    expect(str(step['shown'], 'texts.step.shown'), 'the template shows the evaluated value at its path').toBe(SHOWN);
    expect(glyphsOf(step['glyphs'], 'texts.step.glyphs').length, 'the shown sentence is drawn, one glyph per character').toBe(SHOWN.length);
  }, 900_000);

  it('AC2 the same template in a document that binds a status fails, naming the item, while that document with words only passes and the template passes with no status', () => {
    const [noStatus, status, words] = check([NO_STATUS, STATUS, WORDS_STATUS]);
    // The story number, not the status binding, is what fails: the binding passes with words only.
    expect(noStatus!.ok, `the template passes with no status bound: ${shown(noStatus!)}`).toBe(true);
    expect(words!.ok, `the status document with words only passes: ${shown(words!)}`).toBe(true);
    expect(names(status!, 'step'), `with a status bound the story number fails, naming the item step: ${shown(status!)}`).toBe(true);
    const drawn = one(RENDER_BIN, ['raster'], { out: join(out, 'status.png'), doc: STATUS, look: 'clean', states: { 'verdict:01JB3810000000000000000001': 'pass' } });
    expect(drawn['ok'], 'raster refuses the document the check refuses').toBe(false);
  }, 900_000);

  it('AC2 the sentence with a literal 3 in its words fails in both documents, naming the item, where the template passes with no status', () => {
    const [template, literal, literalStatus] = check([NO_STATUS, LITERAL, LITERAL_STATUS]);
    expect(template!.ok, `the template passes with no status bound: ${shown(template!)}`).toBe(true);
    expect(names(literal!, 'step'), `the literal 3 with no status fails, naming the item step: ${shown(literal!)}`).toBe(true);
    expect(names(literalStatus!, 'step'), `the literal 3 with a status bound fails, naming the item step: ${shown(literalStatus!)}`).toBe(true);
  }, 900_000);
});
