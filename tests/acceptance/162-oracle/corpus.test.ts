// AC5 #162.f8f7c065: "A Lottie position keyed with spatial tangents imports as follow_path and stays within 0.1 u of its
// arc-length position at 100 random times; a trim with no m imports with each true; a merge path, a text layer and an
// expression each come back as an issue naming its layer, and a luma matte imports with luma: encoded"
//
// The upstream renderer's test corpus (its test/animations at bede03d25d, vendor/NOTICE.md: the map's files for this
// criterion), imported with the import job on a real hub:
// - banner.json: its root layer "bg_avion Outlines 2 Comp 1" moves on two keys (frames 70 and 341 at 25 fps) whose
//   spatial tangents bend the path; its 11 text layers and its one merge path (in precomps);
// - adrock.json: merge paths in many root layers; lights.json: expressions in seven layers.
// The spec's examples give what the corpus lacks (the map: none of its files has a luma matte, and none has a trim
// without m): trim_path.json with `m` taken off its trim, and matte.json with its track matte made a luma one (tt 3).
//
// Follow path: the imported item (the outermost named as the layer) carries a follow_path constraint (an object of
// that kind in the document naming the item), and its evaluated position (`eval` `paths` at/pos) stays within 0.1 u of
// the point Lottie's players move it to: the key's time easing gives the fraction, and the fraction is taken by arc
// length along the cubic its spatial tangents make. The layer's anchor is read either way (as the item's pivot, or
// folded into its position), whichever the first time fits. Issues "naming the layer": one of the issue's fields is
// the layer's name, and its JSON says merge, text or expression.
//
// Planted mismatches beside each comparison: the same positions held to the curve taken by parameter instead of by arc
// length must fail (the paths differ by up to 147 u); trim_path.json with m 2 (sequential) must fail "each true";
// matte.json's own alpha matte must fail "luma: encoded"; lights.json with its layer "orange" renamed must fail the
// issue judge's expectations for the plain file, naming orange.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, CORPUS, EXAMPLES, FLICKS, FULL, TIMEOUT, clone, evalCall, hasExpression, hasMergePath, importLottie, importWorld, isObject, isTextLayer, itemNamed,
  layerNamed, layersWith, namesLayer, none, readJson, reportIssues, seeded, showRun, useShow, valueAt, valuesOf, type Imported, type JsonObject,
  type JsonValue, type Pt,
} from './helpers.ts';

const shows = useShow([FULL]);
const LAYER = 'bg_avion Outlines 2 Comp 1';

/** Every object in a value, depth first. */
function objects(v: JsonValue | undefined, out: JsonObject[] = []): JsonObject[] {
  if (Array.isArray(v)) v.forEach((x) => objects(x, out));
  else if (isObject(v)) { out.push(v); Object.values(v).forEach((x) => objects(x, out)); }
  return out;
}
/** The issue judge: each expected (what, layer) has an issue naming the layer whose JSON says what. */
function judgeIssues(got: Imported, expected: { what: 'merge' | 'text' | 'expression'; layer: string }[], file: string): string[] {
  const issues = reportIssues(got.report);
  return expected.filter((e) => !issues.some((i) => namesLayer(i, e.layer) && new RegExp(e.what, 'i').test(JSON.stringify(i))))
    .map((e) => `${file}: the ${e.what === 'merge' ? 'merge path' : e.what === 'text' ? 'text layer' : 'expression'} in layer ${JSON.stringify(e.layer)} comes back as no issue naming it`);
}
const expectations = (anim: JsonObject): { what: 'merge' | 'text' | 'expression'; layer: string }[] => [
  ...layersWith(anim, hasMergePath).map((layer) => ({ what: 'merge' as const, layer })),
  ...layersWith(anim, isTextLayer).map((layer) => ({ what: 'text' as const, layer })),
  ...layersWith(anim, hasExpression).map((layer) => ({ what: 'expression' as const, layer })),
];
/** Every trim op in a document's items: each must have `each: true`. */
function judgeEach(doc: JsonObject, file: string): string[] {
  const trims = objects(doc['items']).filter((o) => isObject(o['trim'])).map((o) => o['trim'] as JsonObject);
  if (trims.length === 0) return [`${file}: the imported document has no trim op`];
  return trims.filter((t) => t['each'] !== true).map((t) => `${file}: a trim imported with each ${JSON.stringify(t['each'])}, not true`);
}
/** The document's mattes: one luma matte, taken on encoded values. */
function judgeLuma(doc: JsonObject, file: string): string[] {
  const luma = objects(doc).filter((o) => o['mode'] === 'luma' || o['mode'] === 'luma_inverted');
  if (luma.length === 0) return [`${file}: the imported document holds no luma matte`];
  return luma.filter((m) => m['luma'] !== 'encoded').map((m) => `${file}: a luma matte imported with luma ${JSON.stringify(m['luma'])}, not encoded`);
}

describe(`${AC[5]} spatial tangents as follow_path by arc length; a trim with no m as each true; merge paths, text layers and expressions as issues; a luma matte as luma: encoded`, () => {
  it(`${AC[5]} the corpus and the derived examples import as the criterion says; each planted mismatch fails`, async () => {
    const banner = readJson(join(CORPUS, 'banner.json'));
    const adrock = readJson(join(CORPUS, 'adrock.json'));
    const lights = readJson(join(CORPUS, 'lights.json'));
    const trim = readJson(join(EXAMPLES, 'trim_path.json'));
    const matte = readJson(join(EXAMPLES, 'matte.json'));
    const noM = clone(trim); objects(noM).filter((o) => o['ty'] === 'tm').forEach((o) => { delete o['m']; });
    const sequential = clone(trim); objects(sequential).filter((o) => o['ty'] === 'tm').forEach((o) => { o['m'] = 2; });
    const lumaMatte = clone(matte); objects(lumaMatte['layers']).filter((o) => o['tt'] === 1).forEach((o) => { o['tt'] = 3; });
    const renamed = clone(lights); (renamed['layers'] as JsonObject[]).filter((l) => l['nm'] === 'orange').forEach((l) => { l['nm'] = 'orange, renamed'; });
    expect(objects(lumaMatte['layers']).some((o) => o['tt'] === 3) && objects(noM).some((o) => o['ty'] === 'tm'), 'the derived files hold a luma matte and a trim (harness)').toBe(true);
    expect(layersWith(lights, hasExpression), 'lights.json has an expression on its layer orange (harness)').toContain('orange');

    const iw = await importWorld();
    const got = {
      banner: await importLottie(iw, JSON.stringify(banner), 'banner.json'), adrock: await importLottie(iw, JSON.stringify(adrock), 'adrock.json'),
      lights: await importLottie(iw, JSON.stringify(lights), 'lights.json'), renamed: await importLottie(iw, JSON.stringify(renamed), 'lights-renamed.json'),
      noM: await importLottie(iw, JSON.stringify(noM), 'trim-no-m.json'), sequential: await importLottie(iw, JSON.stringify(sequential), 'trim-sequential.json'),
      luma: await importLottie(iw, JSON.stringify(lumaMatte), 'matte-luma.json'), alpha: await importLottie(iw, JSON.stringify(matte), 'matte.json'),
    };

    // Follow path, by arc length.
    const at = layerNamed(banner, LAYER, 'banner.json');
    const p = (at.layer['ks'] as JsonObject)['p'];
    const anchor = valueAt((at.layer['ks'] as JsonObject)['a'], 0);
    const fr = Number(banner['fr']);
    const perFrame = FLICKS / fr;
    const rand = seeded(5);
    const times = Array.from({ length: 100 }, () => Math.round(70 * perFrame + rand() * 271 * perFrame));
    const [id, item] = itemNamed(got.banner.document, LAYER, 'banner.json imported');
    const constraint = objects(got.banner.document).some((o) => (o['kind'] === 'follow_path' || isObject(o['follow_path'])) && JSON.stringify(o).includes(id))
      || JSON.stringify(item).includes('follow_path');
    expect(constraint, `the layer moved on spatial tangents imports as follow_path: ${JSON.stringify(item).slice(0, 800)}`).toBe(true);
    const paths = [`items/${id}/at/pos/0`, `items/${id}/at/pos/1`];
    const replies = showRun(shows.bin(FULL), iw.evidence, [got.banner.document], times.map((t) => evalCall(0, t, paths)), 'banner.json imported');
    const pos = times.map((t, i) => valuesOf(replies[i]!, paths, `banner.json imported at ${t}`) as Pt);
    const judgePath = (spatial: 'arc' | 'parameter'): string[] => {
      const want = times.map((t) => valueAt(p, t / perFrame, spatial));
      const offsets: Pt[] = [[0, 0], [anchor[0] ?? 0, anchor[1] ?? 0]];
      const offset = offsets.reduce((best, o) => (Math.hypot(pos[0]![0] - (want[0]![0]! - o[0]), pos[0]![1] - (want[0]![1]! - o[1])) < Math.hypot(pos[0]![0] - (want[0]![0]! - best[0]), pos[0]![1] - (want[0]![1]! - best[1])) ? o : best));
      return times.flatMap((t, i) => {
        const d = Math.hypot(pos[i]![0] - (want[i]![0]! - offset[0]), pos[i]![1] - (want[i]![1]! - offset[1]));
        return d <= 0.1 ? [] : [`t = ${t} flicks: imported at (${pos[i]![0].toFixed(3)}, ${pos[i]![1].toFixed(3)}), ${d.toFixed(3)} u from the position by ${spatial === 'arc' ? 'arc length' : 'parameter'}`];
      });
    };
    none(judgePath('arc'), `${LAYER} stays within 0.1 u of its arc-length position at 100 random times`);
    expect(judgePath('parameter').length, 'planted: the same positions held to the curve by parameter fail').toBeGreaterThan(0);

    // A trim with no m, and its sequential twin.
    none(judgeEach(got.noM.document, 'trim_path.json without m'), 'a trim with no m imports with each true');
    expect(judgeEach(got.sequential.document, 'trim_path.json with m 2').length, 'planted: the sequential trim fails "each true"').toBeGreaterThan(0);

    // Merge paths, text layers and expressions, each an issue naming its layer.
    const want = { banner: expectations(banner), adrock: expectations(adrock), lights: expectations(lights) };
    expect(want.banner.filter((e) => e.what === 'text').length, 'banner.json has 11 text layers (harness)').toBe(11);
    expect(want.adrock.some((e) => e.what === 'merge') && want.lights.some((e) => e.what === 'expression'), 'adrock.json has merge paths and lights.json expressions (harness)').toBe(true);
    none([
      ...judgeIssues(got.banner, want.banner, 'banner.json'), ...judgeIssues(got.adrock, want.adrock, 'adrock.json'), ...judgeIssues(got.lights, want.lights, 'lights.json'),
    ], 'each merge path, text layer and expression comes back as an issue naming its layer');
    expect(judgeIssues(got.renamed, want.lights, 'lights.json renamed').some((f) => f.includes('"orange"')), 'planted: the renamed file\'s issues fail the plain file\'s expectations, naming orange').toBe(true);
    none(judgeIssues(got.renamed, expectations(renamed), 'lights.json renamed'), 'the renamed file\'s issues name its own layers');

    // A luma matte, and the alpha one it came from.
    none(judgeLuma(got.luma.document, 'matte.json with a luma matte'), 'a luma matte imports with luma: encoded');
    expect(judgeLuma(got.alpha.document, 'matte.json').length, 'planted: the alpha matte fails "luma: encoded"').toBeGreaterThan(0);
  }, TIMEOUT);
});
