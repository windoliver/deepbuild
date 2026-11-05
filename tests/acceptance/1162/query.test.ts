// AC3: "deep_query's summary equals the document's counts by kind, writer layer and canvas module, and deep_kinds lists
// each of those modules with its version and a passing kit. At 120 sampled times the formula's west side reads
// 24 u ± 0.5 px from the chart's east side and the badge's scale 1 − e^(−6.5t)·cos(15t) within 1e-12, seeked and played;
// the label in depth shapes to the 2D title's glyph runs"
//
// asserts: deep_query's `summary` (#411) counts the piece's 18 items: by kind as the fixture holds them, all in the
// agent's one writer layer, and by canvas module as the build's `registry` names each kind's module; deep_kinds' list
// (#412) holds each of those modules (core aside) with a version and `kit.verdict` PASS. At t = k/30 s for k = 0…119
// (frames 0, 2, …, 238 at the piece's 60 fps) deep_query reads `items/chart/bounds`, `items/formula/bounds` and
// `items/badge/at/scale/0`: seeked (one fresh run of the hub per time) and played (one run, every time in ascending
// order, #489's convention), formula.minX − chart.maxX is 24 ± 0.5 and the scale is within 1e-12 of
// 1 − e^(−6.5t)·cos(15t) (the key at 0 s carries velocity 6.5, #489's form). The row slides 40 u over the first 2 s, so
// the relation has a moving target. The planted `relation_from_previous_box` (README) fails, naming the formula. The
// label in depth (`view3d` with `labels: true` on the noop backend, #381) has the glyph run `raster` gives the 2D title
// (#381), f32 for f32.
// Wrong programs: a summary that miscounts or leaves a layer or module out; a module listed without its version or
// with a failing kit; a relation solved from the previous frame's box, or from a stale target; a spring stepped
// from frame to frame; a label shaped apart from the 2D text.
import { describe, expect, it } from 'vitest';
import {
  FLICKS, LOOK, READ, SIZE, arr, assetsIn, boxOf, failsNaming, glyphsOf, importTable, isObject, itemsOf, keepProof, none, num, obj, piece, query,
  render, roleMap, runGpu, runProblems, runShow, scenario, seedStore, show, shown, storedDoc, str, useBuilds, useDir, valuesAt,
  type JsonObject, type JsonValue, type ShowPlanted,
} from './helpers.ts';

const builds = useBuilds(['deep-show', 'deep-gpu', 'deep-canvas-render']);
const dir = useDir();

describe('AC3 the piece read back by deep_query and deep_kinds', () => {
  it('AC3 deep_query\'s summary equals the document\'s counts by kind, writer layer and canvas module, and deep_kinds lists each module with its version and a passing kit', () => {
    const evidence = dir();
    seedStore(evidence);
    const calls: JsonObject[] = [importTable(), show(piece()), query({ what: 'summary' }), { call: 'registry' }, { call: 'deep_kinds', op: 'list' }];
    const [r] = runShow(builds.bin('deep-show'), [scenario(evidence, calls)], 'AC3 summary');
    const [, presented, q, registry, listing] = r!;
    keepProof('ac3-summary.json', q!);
    keepProof('ac3-kinds-listing.json', listing!);
    expect(presented!['outcome'], `AC3: the piece is presented: ${shown(presented)}`).toBe('presented');
    const items = Object.values(itemsOf(piece()));
    const kindOf = obj(registry!['kinds'], `AC3 registry: kinds (${shown(registry)})`);
    const byKind: Record<string, number> = {};
    const byModule: Record<string, number> = {};
    for (const it of items) {
      const kind = str(it['kind'], 'kind');
      byKind[kind] = (byKind[kind] ?? 0) + 1;
      const module = str(kindOf[kind], `AC3: the build's registry names the module of ${kind}`);
      byModule[module] = (byModule[module] ?? 0) + 1;
    }
    const s = obj(q!['summary'], `AC3 deep_query: summary (${shown(q)})`);
    expect(num(s['items'], 'summary.items'), 'AC3: the summary counts every item of the piece').toBe(items.length);
    expect(s['by_kind'], 'AC3: the summary\'s counts by kind are the document\'s').toEqual(byKind);
    expect(s['by_module'], 'AC3: the summary\'s counts by canvas module are the document\'s').toEqual(byModule);
    const byLayer = Object.values(obj(s['by_layer'], 'summary.by_layer'));
    expect(byLayer, 'AC3: every item is in the agent\'s one writer layer').toEqual([items.length]);
    expect(listing!['error'], `AC3 deep_kinds list answers: ${shown(listing)}`).toBeUndefined();
    const modules = arr(listing!['modules'], 'AC3 deep_kinds: modules').map((m, i) => obj(m, `modules[${i}]`));
    for (const name of Object.keys(byModule).filter((m) => m !== 'core')) {
      const m = modules.find((x) => x['name'] === name);
      expect(m, `AC3: deep_kinds lists the canvas module ${name}`).toBeDefined();
      expect(str(m!['version'], `${name}.version`), `AC3: deep_kinds lists ${name} with its version`).toMatch(/^\d+\.\d+\.\d+/);
      expect(isObject(m!['kit']) ? m!['kit']['verdict'] : m!['kit'], `AC3: deep_kinds lists ${name} with a passing kit: ${shown(m)}`).toBe('PASS');
    }
  }, 1_800_000);

  /** t = k/30 s, as frames 0, 2, …, 238 at 60 fps. */
  const TIMES = Array.from({ length: 120 }, (_, k) => `${2 * k}f`);
  const seconds = (k: number): number => (2 * k * (FLICKS / 60)) / FLICKS;
  const PATHS = { chart: 'items/chart/bounds', formula: 'items/formula/bounds', scale: 'items/badge/at/scale/0' } as const;
  const spring = (t: number): number => 1 - Math.exp(-6.5 * t) * Math.cos(15 * t);
  interface Sample { t: string; s: number; gap: number; chartEast: number; scale: number }

  function readings(planted?: ShowPlanted): { played: Sample[]; seeked: Sample[] } {
    const evidence = dir();
    seedStore(evidence);
    const bin = builds.bin('deep-show');
    const what = `AC3 sampled times${planted ? ` (planted ${planted})` : ''}`;
    const sample = (reply: JsonObject, at: number[], how: string): Sample[] => {
      const v = (p: string): JsonValue[] => valuesAt(reply, p, at.length, `${what}, ${how}`);
      const [chart, formula, scale] = [v(PATHS.chart), v(PATHS.formula), v(PATHS.scale)];
      return at.map((k, i) => {
        const c = boxOf(chart[i], `${how} ${PATHS.chart} at ${TIMES[k]}`);
        const f = boxOf(formula[i], `${how} ${PATHS.formula} at ${TIMES[k]}`);
        return { t: TIMES[k]!, s: seconds(k), gap: f.minX - c.maxX, chartEast: c.maxX, scale: num(scale[i], `${how} ${PATHS.scale} at ${TIMES[k]}`) };
      });
    };
    const paths = Object.values(PATHS);
    const [play] = runShow(bin, [scenario(evidence, [importTable(), show(piece()), query({ paths, at: TIMES })], planted)], `${what}: played`);
    const all = TIMES.map((_, k) => k);
    const played = sample(play![2]!, all, 'played');
    const seekRuns = runShow(bin, TIMES.map((t) => scenario(evidence, [importTable(), show(piece()), query({ paths, at: [t] })], planted)), `${what}: seeked`);
    const seeked = seekRuns.flatMap((r, k) => sample(r[2]!, [k], 'seeked'));
    return { played, seeked };
  }
  function sampleFailures(samples: Sample[], how: string): string[] {
    const f: string[] = [];
    for (const x of samples) {
      if (Math.abs(x.gap - 24) > 0.5) f.push(`AC3 formula at ${x.t} (${how}): its west side is ${x.gap} u from the chart's east side, not 24 ± 0.5`);
      const want = spring(x.s);
      if (!(Math.abs(x.scale - want) <= 1e-12)) f.push(`AC3 badge at ${x.t} (${how}): scale ${x.scale}, not 1 − e^(−6.5t)·cos(15t) = ${want} within 1e-12`);
    }
    return f;
  }

  it('AC3 at 120 sampled times the formula\'s west side reads 24 u ± 0.5 px from the chart\'s east side and the badge\'s scale follows the spring within 1e-12, seeked and played; a relation solved from the previous frame\'s box fails, naming the formula', () => {
    const r = readings();
    keepProof('ac3-sampled-rows.json', r as unknown as JsonObject);
    const moved = r.played[r.played.length - 1]!.chartEast - r.played[0]!.chartEast;
    expect(moved, 'AC3: the fixture\'s row slides the chart 40 u right, so the relation has a moving target').toBeGreaterThan(30);
    none([...sampleFailures(r.played, 'played'), ...sampleFailures(r.seeked, 'seeked')], 'AC3 the sampled rows');
    const p = readings('relation_from_previous_box');
    const failures = [...sampleFailures(p.played, 'played'), ...sampleFailures(p.seeked, 'seeked')];
    keepProof('ac3-planted-relation_from_previous_box.json', { failures } as unknown as JsonObject);
    failsNaming(failures, ['AC3 formula'], 'AC3 the planted relation_from_previous_box');
  }, 3_600_000);

  it('AC3 the label in depth shapes to the 2D title\'s glyph runs', () => {
    const evidence = dir();
    seedStore(evidence);
    const [r] = runShow(builds.bin('deep-show'), [scenario(evidence, [importTable(), show(piece()), READ])], 'AC3 glyph runs');
    const { doc, path } = storedDoc(r![2]!, evidence);
    const stored = obj(doc['items'], 'the stored items');
    // The 2D title as the 2D path shapes it: `raster` of a document holding only the stored title item.
    const flat: JsonObject = {
      format: 1, id: 'title-2d', profile: 'figure', title: str(doc['title'], 'title'), description: 'The piece\'s 2D title alone, for its glyph run.',
      size: SIZE, layers: obj(doc['layers'], 'the stored layers'), items: { title: obj(stored['title'], 'the stored title') },
    };
    const raster = render(builds.bin('deep-canvas-render'), 'raster', { out: `${evidence}/title.png`, doc: flat, look: roleMap() });
    const title = glyphsOf(obj(obj(raster['texts'], `AC3 raster: texts (${shown(raster)})`)['title'], 'raster: texts.title')['glyphs'], 'raster: texts.title.glyphs');
    const [view] = runGpu(builds.bin('deep-gpu'), evidence, [{ call: 'view3d', doc: path, look: LOOK, size: SIZE, labels: true, assets: assetsIn(evidence) }], { noop: true });
    expect(view!['code'], `AC3 view3d is answered: ${shown(view)}`).toBeUndefined();
    const frame = obj(arr(view!['frames'], 'AC3 view3d: frames')[0], 'AC3 view3d: frames[0]');
    const label = arr(frame['labels'], 'AC3 view3d: frames[0].labels').map((l) => obj(l, 'label')).find((l) => l['item'] === 'label');
    expect(label, 'AC3: the label in depth is among the frame\'s labels').toBeDefined();
    const depth = glyphsOf(label!['glyphs'], 'view3d: label.glyphs');
    keepProof('ac3-glyph-runs.json', { title, label: depth } as unknown as JsonObject);
    none(runProblems(title, depth, 'AC3 the label in depth against the 2D title'), 'AC3 the label in depth');
  }, 1_800_000);
});
