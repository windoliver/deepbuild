// #1700.84bd8888: "Five posts 0.1 m square and 1 m high, 0.5 m apart, read 5 loops in a section along y at 0.1 m, each
// of area 0.01 m² within 1e-12 relative. A planted section that leaves cut segments unjoined reports open chains
// instead of loops and fails, naming the section"
//
// Fixture (helpers.ts `postsDoc`), a stored scene, the one deliverable of a claim of alpha's: `post-1` to `post-5`,
// each a `slab@1` of size [0.1, 1, 0.1] standing on y = 0, centred at x = −1, −0.5, 0, 0.5 and 1 m (0.5 m apart,
// centre to centre). The check: `{kind: geometry.shape, of: [post-1, …, post-5], readings: [{section: {axis: y, at:
// 0.1}}], expect: {section: 5}}`.
//
// asserts:
//   - the requirement PASSes with one section result of 5, its `loops` five, each `area` within 1e-12 relative of
//     0.01 m², and no `open` chain (0, or an empty list);
//   - with the planted `section_leaves_segments_unjoined` (the section's cut segments are each left a chain of their
//     own, never joined into loops): the section reports open chains (`open` above 0) and fewer than 5 loops, the
//     requirement FAILs, and a geometry.reading issue on readings/0 names the section reading, expected 5 and actual
//     the loops it read.
import { describe, expect, it } from 'vitest';
import {
  PLANTED, POSTS, TIMEOUT, brief, claimId, claimOf, countOf, decided, docId, isObject, nearRel, oneAt, postsDoc, readingIssuesAt, reqId, rowOf,
  run, scenarioOf, section, shape, useBuild, useFolders, verdict,
} from './helpers.ts';

/** The criterion's ID: `#1700.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#1700.84bd8888';
const bin = useBuild();
const folder = useFolders();

const POSTS_DOC = docId(1);
const claims = { [claimId(1)]: claimOf(POSTS_DOC, [{ id: reqId(1), check: shape([...POSTS], [section('y', 0.1)], { section: 5 }) }]) };
const judged = (planted?: string) => {
  const [v] = run(bin(), scenarioOf(folder(), { [POSTS_DOC]: postsDoc() }, claims, [verdict(claimId(1))], planted));
  return rowOf(v!, reqId(1), planted ? `the posts under ${planted}` : 'the posts');
};

describe(`${ID} a section joins its cut segments into closed loops`, () => {
  it(`${ID} five posts read 5 loops in a section along y at 0.1 m, each of area 0.01 m² within 1e-12 relative; a planted section that leaves cut segments unjoined reports open chains instead of loops and fails, naming the section`, () => {
    const row = judged();
    decided(row, 'PASS', 'the posts read for 5 loops in a section along y at 0.1 m');
    const s = oneAt(row, 0, 'the posts: the section');
    expect(s.value, `the section reads 5 loops: ${brief(s.raw)}`).toBe(5);
    const loops = Array.isArray(s.raw['loops']) ? s.raw['loops'] : [];
    expect(loops.length, `the section lists its 5 loops: ${brief(s.raw)}`).toBe(5);
    const areas = loops.map((l) => (isObject(l) ? l['area'] ?? null : null));
    expect(areas.filter((a) => !nearRel(a, 0.01, 1e-12)), `each loop's area is 0.01 m² within 1e-12 relative: ${brief(areas)}`).toEqual([]);
    expect(countOf(s.raw['open']), `the section leaves no open chain: ${brief(s.raw)}`).toBe(0);

    // The planted section that leaves cut segments unjoined.
    const p = judged(PLANTED.section);
    const ps = oneAt(p, 0, `the posts under ${PLANTED.section}: the section`);
    const open = countOf(ps.raw['open']);
    expect(open !== null && open > 0, `the planted section reports open chains: ${brief(ps.raw)}`).toBe(true);
    expect(typeof ps.value === 'number' && ps.value < 5, `the planted section reads fewer than 5 loops: ${brief(ps.raw)}`).toBe(true);
    decided(p, 'FAIL', `the posts under ${PLANTED.section}`);
    const issue = readingIssuesAt(p, 0)[0];
    expect(issue, `a geometry.reading issue on readings/0, the section: ${brief(p.raw['issues'] ?? null, 3000)}`).toBeDefined();
    expect(JSON.stringify(issue!.reading ?? null), `the issue names the section reading: ${brief(issue!.raw)}`).toContain('section');
    expect([issue!.expected, issue!.actual], `the issue names expected 5 and the loops read: ${brief(issue!.raw)}`).toEqual([5, ps.value]);
  }, TIMEOUT);
});
