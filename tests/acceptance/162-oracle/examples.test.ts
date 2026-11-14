// AC3 #162.6dd976de: "Each of the Lottie spec's 20 examples imports as a document that passes the document check, with
// every literal color mapped to a role and every expression returned as an issue naming its layer"
//
// The 20 examples are the spec's own (vendor/lottie-spec-4b55957472/docs/static/examples, which its schema test holds
// valid), imported one by one with the import job (`import {from: lottie, look: generated}`) on a real hub, and each
// document shown with `deep show` in deep-show, reading the hub's evidence store: it must be presented with no issue of
// severity error. "Every literal color mapped to a role": each colour the file writes as a literal (fills' and
// strokes' colours, static or keyed, gradient stops, solid layers' colour) is, within one code value, the colour of a
// role in the document's generated look, and the document's items and channels write no hex colour of their own.
// "Every expression returned as an issue": each layer holding a property with an expression has an issue in the job's
// report that names it and says expression. No example carries an expression, so that part is held by a twin.
//
// Planted mismatches beside each comparison: an example whose fill colour is changed to #123456 must fail the colour
// judge against its own import, naming #123456; fill.json with an expression put on its layer's opacity is imported, its
// report must name the layer, and the judge must fail the plain fill.json's report against it, naming the layer; and an
// imported document with an item parented to an item it doesn't hold must not pass the document check.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOCS, EXAMPLES, FULL, TIMEOUT, clone, errorsOf, exampleNames, hasExpression, hexLiterals, importLottie, importWorld, isObject, layersWith,
  literalColours, lookRoles, namesLayer, nearColour, none, present, readJson, reportIssues, runShow, scenarioOf, show, useShow, type ImportWorld,
  type Imported, type JsonObject, type JsonValue,
} from './helpers.ts';

const shows = useShow([FULL]);

/** The judge for one example: its literal colours against the generated look's roles, the document's own literals,
 * and its expressions against the report. Each failure names the example and what it is about. */
function judge(iw: ImportWorld, name: string, anim: JsonObject, got: Imported): string[] {
  const roles = Object.values(lookRoles(iw, got.document, name));
  const failures = literalColours(anim).filter((c) => !roles.some((r) => nearColour(c, r))).map((c) => `${name}: the literal colour ${c} is no role of the generated look (roles: ${roles.join(', ')})`);
  failures.push(...hexLiterals(got.document).map((h) => `${name}: the document writes the literal colour ${h}`));
  const issues = reportIssues(got.report);
  for (const nm of layersWith(anim, hasExpression)) {
    if (!issues.some((i) => namesLayer(i, nm) && /expression/i.test(JSON.stringify(i)))) failures.push(`${name}: the expression on layer ${JSON.stringify(nm)} comes back as no issue naming it`);
  }
  return failures;
}

describe(`${AC[3]} the spec's 20 examples import as documents that pass the document check, colours as roles, expressions as issues`, () => {
  it(`${AC[3]} each example imports, is shown with no error, maps every literal colour to a role and returns every expression as an issue naming its layer; the planted mismatches fail`, async () => {
    const names = exampleNames();
    expect(names.length, 'the spec has 20 examples (harness)').toBe(20);
    const iw = await importWorld();
    const files = names.map((n) => readJson(join(EXAMPLES, n)));
    const imported: Imported[] = [];
    for (const n of names) imported.push(await importLottie(iw, readFileSync(join(EXAMPLES, n)), n));

    const fillAt = names.indexOf('fill.json');
    const withExpression = clone(files[fillAt]!);
    const layer = (withExpression['layers'] as JsonObject[])[0]!;
    const ks = layer['ks'] as JsonObject;
    ks['o'] = { ...(isObject(ks['o']) ? ks['o'] : { a: 0, k: 100 }), x: 'value' };
    const twin = await importLottie(iw, JSON.stringify(withExpression), 'fill-with-expression.json');

    const broken = clone(imported[0]!.document);
    (broken['items'] as JsonObject)['orphan'] = { id: 'orphan', kind: 'rect@1', layer: 'main', name: 'Orphan', order: 'z99', parent: 'no-such-item', params: { box: [0, 0, 10, 10] } };
    const shown = [...imported.map((i) => i.document), twin.document, broken];
    const replies = runShow(shows.bin(FULL), scenarioOf(iw.evidence, shown.length, shown.map((d, k) => present(DOCS[k]!, d))), 'the imported examples');

    none(names.flatMap((n, k) => {
      const r = replies[k]!;
      if (r['outcome'] !== 'presented') return [`${n}: the imported document isn't presented: ${show(r, 800)}`];
      return errorsOf(r).map((i) => `${n}: the document check raises ${show(i, 400)}`);
    }), 'every imported example passes the document check');
    none(names.flatMap((n, k) => judge(iw, n, files[k]!, imported[k]!)), 'every literal colour is a role, every expression an issue naming its layer');

    const recoloured = clone(files[fillAt]!);
    const fill = JSON.stringify(recoloured).includes('"ty":"fl"');
    expect(fill, 'fill.json has a fill (harness)').toBe(true);
    const paint = (v: JsonValue | undefined): void => {
      if (Array.isArray(v)) v.forEach(paint);
      else if (isObject(v)) { if (v['ty'] === 'fl') v['c'] = { a: 0, k: [0x12 / 255, 0x34 / 255, 0x56 / 255, 1] }; Object.values(v).forEach(paint); }
    };
    paint(recoloured);
    expect(judge(iw, 'fill.json recoloured', recoloured, imported[fillAt]!).some((f) => f.includes('#123456')), 'planted: a colour the look doesn\'t hold fails the colour judge, naming #123456').toBe(true);
    const nm = String(layer['nm']);
    none(judge(iw, 'fill.json with an expression', withExpression, twin), 'the expression put on fill.json comes back as an issue naming its layer');
    expect(judge(iw, 'fill.json with an expression', withExpression, imported[fillAt]!).some((f) => f.includes(JSON.stringify(nm))), `planted: the plain fill.json's report fails against the file with the expression, naming ${nm}`).toBe(true);
    const b = replies[names.length + 1]!;
    expect(b['outcome'] !== 'presented' || errorsOf(b).length > 0, `planted: an imported document with an item parented to one it doesn't hold fails the document check: ${show(b, 600)}`).toBe(true);
  }, TIMEOUT);
});
