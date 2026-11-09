// AC1 #505.968d0296: "A formula imported from the agent's SVG writes on term by term, and its source text is read by
// a screen reader"
//
// `fixtures/pythagoras.svg` is a² + b² = c² as an agent's own renderer writes it: five terms, one id each, glyphs as
// outlines filled with currentColor. Its `vector@1` item keys `write_on.progress` 0 → 1 over 1 s (#398's form), so
// with n = 5 the terms overlap by min(4 ÷ n, 0.2) = 0.2 of a span (Text `text@1`: write mode): each span 5/9 s, term
// k from k/9 s. `deep-canvas-render raster` draws the frames: a term draws nothing before its start, has begun (some
// ink, its fill not yet in) just after it, and is filled after its span; so the terms come in one by one, in reading
// order. The screen reader reads the accessibility tree (#376's `see` on the hub, `deep-show run`): the formula's
// node is named by its source text, `alt` (Vector and formula: "with the source text as the accessible name"), while
// it writes on and after. The item's own `name` is other text, so a tree that names it by `name` fails.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORMULA_ALT, FORMULA_SVG, SPAN, TERMS, formulaDoc, formulaHubDoc, termStart } from './docs.ts';
import {
  AC, DOC_ID, PANEL, ROLES, TIMEOUT, YOU_PEER, arr, countOff, fl, obj, pixel, putEvidence, putStore, rasterAt, readPng, runShow, same, show, str,
  useRender, useShow, useTemp, type JsonObject, type Rgb,
} from './helpers.ts';

const render = useRender();
const hub = useShow();
const temp = useTemp('formula');
const ID = AC[1];
const GROUND = ROLES['ground']!;
const INK = ROLES['ink']! as Rgb;
const grow = ([x0, y0, x1, y1]: [number, number, number, number], d: number): [number, number, number, number] => [x0 - d, y0 - d, x1 + d, y1 + d];

describe(`${ID} a formula from the agent's SVG writes on term by term, and a screen reader reads its source text`, () => {
  it(`${ID} the terms come in one by one in reading order, and the formula's accessible name is its source text`, () => {
    const dir = temp();
    const store = join(dir, 'store');
    const evidence = mkdtempSync(join(tmpdir(), 'deep-505-evidence-'));
    try {
      // Writes on term by term (deep-canvas-render raster, at the times each term's span gives).
      mkdirSync(store);
      const src = putStore(store, FORMULA_SVG());
      const doc = formulaDoc(src);
      const times: { k: number; at: 'before' | 'begun' | 'filled'; s: number }[] = [];
      TERMS.forEach((_, k) => {
        if (k > 0) times.push({ k, at: 'before', s: termStart(k) - 0.02 });
        times.push({ k, at: 'begun', s: termStart(k) + 0.06 });
        times.push({ k, at: 'filled', s: termStart(k) + SPAN + 0.02 });
      });
      const frames = rasterAt(render(), doc, times.map(({ s }) => ({ t: fl(s), store })), dir, 'write');
      const wrong: string[] = [];
      frames.forEach(({ out }, i) => {
        const { k, at, s } = times[i]!;
        const image = readPng(out);
        const term = TERMS[k]!;
        const off = countOff(image, grow(term.box, 3), GROUND as Rgb);
        const inside = pixel(image, term.inside[0], term.inside[1]);
        if (at === 'before' && off !== 0) wrong.push(`${s.toFixed(3)} s, before ${term.id} starts at ${termStart(k).toFixed(3)} s: ${off} of its pixels are drawn`);
        if (at === 'begun') {
          if (off === 0) wrong.push(`${s.toFixed(3)} s, after ${term.id} starts: it draws nothing`);
          if (!same(inside, GROUND as Rgb)) wrong.push(`${s.toFixed(3)} s, early in ${term.id}'s span: its fill is in already (${inside.join(',')}), not its outline first`);
        }
        if (at === 'filled' && !same(inside, INK)) wrong.push(`${s.toFixed(3)} s, after ${term.id}'s span: its fill reads ${inside.join(',')}, not ink`);
        // Every earlier term has begun by the time a later one does: reading order.
        if (at !== 'before') {
          for (let j = 0; j < k; j++) if (countOff(image, grow(TERMS[j]!.box, 3), GROUND as Rgb) === 0) wrong.push(`${s.toFixed(3)} s: ${term.id} is drawn but the earlier ${TERMS[j]!.id} isn't`);
        }
      });
      expect(wrong, `the formula writes on term by term:\n  ${wrong.join('\n  ')}`).toEqual([]);

      // Read by a screen reader: the hub shows the formula and the replica's tree names it by its source text.
      putEvidence(evidence, FORMULA_SVG());
      const replies = runShow(hub(), evidence, [
        { call: 'deep show', peer: YOU_PEER, doc: DOC_ID, document: formulaHubDoc(src), include: ['issues'], at: 0 },
        { call: 'see', panel: PANEL, at: fl(0.5) },
        { call: 'see', panel: PANEL, at: fl(2) },
      ]);
      expect(replies[0]!['outcome'], `the hub presents the formula: ${show(replies[0])}`).toBe('presented');
      for (const [i, when] of [[1, '0.5 s, while it writes on'], [2, '2 s, written']] as const) {
        const tree = arr(obj(replies[i], `see at ${when}`)['tree'], `see at ${when}: tree`).map((n, j) => obj(n, `tree[${j}]`));
        const nodes = tree.filter((n) => n['id'] === 'formula');
        expect(nodes.length, `see at ${when}: the tree has one node for the formula: ${show(tree as unknown as JsonObject[])}`).toBe(1);
        expect(str(nodes[0]!['name'], 'the formula node\'s name'), `see at ${when}: the screen reader reads the formula's source text`).toBe(FORMULA_ALT);
      }
    } finally {
      rmSync(evidence, { recursive: true, force: true });
    }
  }, TIMEOUT);
});

