// #1175 AC2: "A planted importer that drops `<marker>` with only a warning presents INCONCLUSIVE, naming the element,
// never PASS." Scope: "Anything still outside the list stays an issue naming it, and a document whose import dropped a
// visible element can't present as clean: its check reads INCONCLUSIVE until you accept the issue."
//
// The check's answer carries `verdict: {outcome, open}` and takes the person's accepted issues as `accepted`
// (README: The surface under test). The planted importer is `planted: "import_drops_marker"` on `check` and `raster`:
// it drops every `<marker>` and reports it only as a warning naming `marker`, and changes nothing else.

import { describe, expect, it } from 'vitest';
import {
  MEASURES, PLANTED_DROPS_MARKER, arr, check, drawn, elementsDoc, holdsName, obj, scratch, useRenderBinary,
  type Checked, type JsonValue,
} from './helpers.ts';

useRenderBinary();
const dir = scratch('verdict');

interface Verdict { outcome: JsonValue; open: { item: JsonValue; element: JsonValue }[] }
function verdictOf(c: Checked): Verdict {
  const v = obj(c.raw['verdict'], `check's verdict (answer: ${JSON.stringify(c.raw).slice(0, 1500)})`);
  const open = arr(v['open'], 'verdict.open').map((o, i) => {
    const e = obj(o, `verdict.open[${i}]`);
    return { item: e['item']!, element: e['element']! };
  });
  return { outcome: v['outcome']!, open };
}

describe('#1175 AC2 a document whose import dropped a visible element presents INCONCLUSIVE, never PASS', () => {
  it('AC2 the honest import of elements.svg drops nothing and presents PASS', () => {
    const c = check(elementsDoc(dir));
    expect(c.issues.filter((i) => i['severity'] === 'error'), 'the import raises no error').toEqual([]);
    const v = verdictOf(c);
    expect(v.open, 'nothing the import dropped is open').toEqual([]);
    expect(v.outcome, 'the check presents PASS').toBe('PASS');
  }, 1_800_000);

  it('AC2 a planted importer that drops <marker> with only a warning presents INCONCLUSIVE, naming marker, never PASS', () => {
    const v0 = elementsDoc(dir);
    // The twin is what it says: it draws the SVG with no marker (the marker's square is the ground)…
    const image = drawn(dir, v0, 'elements.svg through the planted importer', PLANTED_DROPS_MARKER);
    expect(MEASURES.marker(image).length, 'the planted importer draws no marker').toBeGreaterThan(0);
    for (const tag of ['clipPath', 'mask', 'pattern', 'style'] as const) expect(MEASURES[tag](image), `the planted importer still draws <${tag}>`).toEqual([]);
    // …and reports it only as a warning naming the element.
    const c = check(v0, { planted: PLANTED_DROPS_MARKER });
    const naming = c.issues.filter((i) => holdsName(i, 'marker'));
    expect(naming.length, `an issue names marker (issues: ${JSON.stringify(c.issues).slice(0, 1500)})`).toBeGreaterThan(0);
    expect(c.issues.filter((i) => i['severity'] === 'error'), 'the planted importer raises no error, only a warning').toEqual([]);
    expect(naming.map((i) => i['severity']), 'the issue naming marker is a warning').toSatisfy((s: JsonValue[]) => s.every((x) => x === 'warning'));
    // The check presents INCONCLUSIVE, naming the element, never PASS.
    const v = verdictOf(c);
    expect(v.outcome, 'the check presents INCONCLUSIVE').toBe('INCONCLUSIVE');
    expect(v.open, 'the open item names the item and the element it dropped, and nothing else').toEqual([{ item: 'art', element: 'marker' }]);
  }, 1_800_000);

  it('AC2 it stays INCONCLUSIVE until the person accepts that issue', () => {
    const v0 = elementsDoc(dir);
    const other = verdictOf(check(v0, { planted: PLANTED_DROPS_MARKER, accepted: [{ item: 'art', element: 'mask' }] }));
    expect(other.outcome, 'accepting another element leaves it INCONCLUSIVE').toBe('INCONCLUSIVE');
    expect(other.open, 'the marker is still open').toEqual([{ item: 'art', element: 'marker' }]);
    const accepted = verdictOf(check(v0, { planted: PLANTED_DROPS_MARKER, accepted: [{ item: 'art', element: 'marker' }] }));
    expect(accepted.open, 'once accepted, nothing is open').toEqual([]);
    expect(accepted.outcome, 'once the person accepts the issue, the check presents PASS').toBe('PASS');
  }, 1_800_000);
});
