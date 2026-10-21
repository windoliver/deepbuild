import { describe, expect, it } from 'vitest';
import { useBinary, check, describeIssues, fixture, issuesOf } from './helpers.ts';
import type { JsonObject } from './helpers.ts';

interface Corpus { doc: JsonObject; saved_at: string; expect?: Record<string, { kind: string; params: JsonObject }> }

useBinary();

describe('AC10 a corpus document saved with test.slab@1 opens in a build at major 3, migrating one major a step', () => {
  it('AC10 the document loads with one migrated notice per step, and the values the corpus recorded', () => {
    const corpus = fixture<Corpus>('corpus-slab1.json');
    expect(corpus.saved_at).toBe('test.slab@1');
    const out = check(corpus.doc);
    // A build that carries only the @2-to-@3 step refuses the document and fails here, naming the kind.
    expect(out.ok, `test.slab: the corpus document saved at test.slab@1 was refused: ${describeIssues(out)}`).toBe(true);
    const migrated = out.notices.filter((n) => n.code === 'migrated' && n.kind === 'test.slab');
    expect(migrated.map((n) => [n.from, n.to]), 'test.slab: one migrated notice per step, 1 to 2 and 2 to 3').toEqual([[1, 2], [2, 3]]);
    for (const n of migrated) {
      expect(n.ids, `test.slab: the migrated ${n.from}->${n.to} notice names the item`).toEqual(['slab']);
      expect(n.severity).toBe('notice');
    }
    const items = out.lowered['items'] as Record<string, JsonObject>;
    for (const [id, want] of Object.entries(corpus.expect!)) {
      expect(items[id]?.['kind'], `test.slab: ${id} lowered kind`).toBe(want.kind);
      expect(items[id]?.['params'], `test.slab: ${id} lowered params`).toEqual(want.params);
      expect(items[id]?.['id'], 'a migration never changes an ID').toBe(id);
    }
    expect(out.draws).toContain('slab');
  });
});

describe('AC11 the document check reads only the lowered form', () => {
  it('AC11 a width past its maximum, saved as w at @1, raises out_of_range at the @3 path items/<id>/params/width', () => {
    const corpus = fixture<Corpus>('corpus-slab1-wide.json');
    expect((corpus.doc['items'] as Record<string, JsonObject>)['slab']!['params']).toEqual({ w: 5000, h: 7 });
    const out = check(corpus.doc);
    // A planted check that reads the saved @1 bytes finds w, raises nothing, and fails here, naming
    // the check (document.validate) and the path it had to raise.
    expect(out.ok, 'document.validate: a width of 5000 (max 1000) passed, read from the saved @1 bytes as w').toBe(false);
    const issue = issuesOf(out, 'out_of_range').find((i) => i.path === 'items/slab/params/width');
    expect(issue, `document.validate: no out_of_range at items/slab/params/width: ${describeIssues(out)}`).toBeDefined();
    expect(issue!.check).toBe('document.validate');
    expect(issue!.ids).toEqual(['slab']);
    expect(issue!.actual).toBe(5000);
    expect(out.issues.some((i) => i.path.endsWith('/params/w')), 'document.validate: an issue names the @1 path params/w').toBe(false);
    expect(out.notices.filter((n) => n.code === 'migrated').map((n) => [n.from, n.to])).toEqual([[1, 2], [2, 3]]);
  });
});
