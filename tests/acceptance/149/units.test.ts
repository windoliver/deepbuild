// AC7 #149.f455f94d: "1/300fw" converts to exactly 6.4 u at a 1920 px design width.
//
// Exactly means the rational 32/5, not a float near it. At the base the grammar can convert it, but no surface gives it
// a frame: `deep-canvas parse unit` and the document check both convert against an empty context, so every `fw` literal
// in a document is refused. Three places must convert it at check: the grammar given a frame, a document's own literal,
// and a look's literal against the document it draws. A 1280 px frame shows the literal reads the document's size.
//
// Wrong programs: a frame fixed at 1920; a literal left unconverted; a look's literal refused or read as px.
import { describe, expect, it } from 'vitest';
import { AC, errorsOf, figure, look, mark, num, obj, oneLine, shown, useBin, type JsonObject } from './helpers.ts';

const ID = AC[7];
const canvas = useBin('deep-canvas');
const render = useBin('deep-canvas-render');

const lk = look({ id: 'units-149', fills: { fill: { kind: 'flat' }, slid: { kind: 'flat', offset: { dx: '1/300fw', dy: '1/300fh', seed: 1 } } } });
const doc = (size: [number, number]): JsonObject => figure('units-149', size, {
  box: mark('box', 'rect@1', 'a0', { box: [10, 10, 100, 60], paint: { stroke: { role: 'ink', width: '1/300fw' } } }),
});
function checked(size: [number, number]): { doc: number; dx: number; dy: number } {
  const answer = oneLine(render(), ['check'], { doc: doc(size), look: lk });
  expect(errorsOf(answer), `the literals check at ${size.join(' × ')}: ${shown(answer)}`).toEqual([]);
  const items = obj(obj(answer['lowered'], 'the lowered document')['items'], 'lowered items');
  const stroke = obj(obj(obj(obj(items['box'], 'box')['params'], 'params')['paint'], 'paint')['stroke'], 'stroke');
  const offset = obj(obj(obj(obj(answer['lowered_look'], 'the lowered look')['fills'], 'lowered fills')['slid'], 'slid')['offset'], 'offset');
  return { doc: num(stroke['width'], 'the stroke width'), dx: num(offset['dx'], 'dx'), dy: num(offset['dy'], 'dy') };
}

describe(`${ID} frame-relative literals`, () => {
  it(`${ID} "1/300fw" is exactly 6.4 u at 1920 px wide, in the grammar, a document and a look, and follows the document's width`, () => {
    const parsed = oneLine(canvas(), ['parse', 'unit'], { text: '1/300fw', unit: 'u', frame: [1920, 1080] });
    expect(parsed['ok'], `the grammar converts it: ${shown(parsed)}`).toBe(true);
    const value = obj(parsed['value'], 'value');
    expect([value['num'], value['den']], 'the exact rational in u').toEqual(['32', '5']);

    const at1920 = checked([1920, 1080]);
    expect(at1920.doc, 'a document\'s literal').toBe(6.4);
    expect(at1920.dx, 'a look\'s literal against the document it draws').toBe(6.4);
    expect(at1920.dy, '"1/300fh" at 1080 px high').toBe(3.6);

    const at1280 = checked([1280, 720]);
    expect(at1280.doc, 'the literal reads the document\'s design width').toBe(1280 / 300);
    expect(at1280.dx, 'so does the look\'s').toBe(1280 / 300);
    expect(at1280.dy, 'and its height').toBe(2.4);
  });
});
