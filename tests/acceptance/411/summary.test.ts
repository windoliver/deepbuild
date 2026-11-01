// AC3: deep_query's summary matches the document's own counts by kind, writer layer and canvas module
// (parity/agent/query-summary.scene).
//
// The scene is a board three writers share, stored as a release stores it (#96's `docs[…].document`). The
// expected counts are the document's own: by kind and by writer layer from its items, and by canvas module through
// the registry's map from each kind to the canvas module that registers it (README: `registry` gains `kinds`).
import { describe, expect, it } from 'vitest';
import { ALPHA, DOC, FULL, type JsonObject, brief, obj, query, run, scenario, scene, useBuilds, useEvidence } from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();

const SCENE = scene('agent/query-summary.scene');

function count(keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = (out[k] ?? 0) + 1;
  return out;
}

describe('AC3 deep_query\'s summary matches the document\'s own counts by kind, writer layer and canvas module (parity/agent/query-summary.scene)', () => {
  it('AC3 the summary\'s counts by kind, writer layer and canvas module are the document\'s own', () => {
    const [registry, reply] = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: { document: SCENE.document } }, [
      { call: 'registry' },
      query(DOC.a, { what: 'summary' }, ALPHA.id),
    ]));
    const items = Object.values(SCENE.document['items'] as Record<string, JsonObject>);
    const kindsOf = obj(registry!['kinds'], `the registry maps each kind to its canvas module (${brief(registry, 600)})`);
    const moduleOf = (kind: string): string => {
      const m = kindsOf[kind];
      expect(typeof m, `the registry names the canvas module of ${kind}`).toBe('string');
      return m as string;
    };
    const expected = {
      items: items.length,
      by_kind: count(items.map((i) => String(i['kind']))),
      by_layer: count(items.map((i) => String(i['layer']))),
      by_module: count(items.map((i) => moduleOf(String(i['kind'])))),
    };
    const summary = obj(reply!['summary'], `the reply's summary (${brief(reply, 1500)})`);
    expect({ items: summary['items'], by_kind: summary['by_kind'], by_layer: summary['by_layer'], by_module: summary['by_module'] }, 'the document\'s own counts').toEqual(expected);
    // The scene spreads its items over four kinds and three layers, with counts that differ between them.
    expect(Object.keys(expected.by_kind).length, 'the scene holds four kinds').toBe(4);
    expect(Object.keys(expected.by_layer).length, 'the scene holds three writer layers').toBe(3);
  });
});
