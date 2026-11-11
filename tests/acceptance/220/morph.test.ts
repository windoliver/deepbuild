// AC2 #220.ec8a4363: "`a^2 + b^2 = c^2` and `a^2 = c^2 - b^2`, typeset with no ids given, share the ids of `a^2`,
// `b^2`, `c^2` and `=`; a 1 s match_morph between their imports moves each of the four shared parts' centres from old to
// new place within 0.5 u at 0, 0.5 and 1 s and fades only `+` and `-`"
//
// Both formulas through deep_job, their parts given as the term strings with no id (A: a^2, +, b^2, =, c^2; B: a^2, =,
// c^2, -, b^2). Ids: in each SVG the part group whose data-source is a^2, b^2, c^2 or = has the same id in A and in B,
// the design's id from its source (`t-a_5e2`, `t-b_5e2`, `t-c_5e2`, `t-_3d`). The morph, through `deep-show run`
// (README: The surface under test, 7): a film with the two SVGs imported as vector@1 items `fa` (A, at (50, 40)) and `fb`
// (B, below it), each sized to its viewBox at one shared scale, and a match_morph `mm` from fa to fb over [0 s, 1 s],
// linear, read from `eval`'s `film.morphs.mm` at 0, 0.5 and 1 s. A shared part's old place is the centre of its group's
// drawn bounds in A, placed as fa places its SVG; its new place the same in B; at p it must be the piece from
// `fa#<id>` to `fb#<id>`, at old + p (new - old) within 0.5 u and not faded. The only pieces with one side missing are
// `fa#<+'s id>` going out (opacity 1, then between, then 0) and `fb#<-'s id>` coming in (the reverse); nothing else.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, TIMEOUT, boundsOf, centreOf, dist, evalCall, film, fl, fmt, lerp2, matchMorph, mustHavePlugin, mustTypeset, none, openWorld, paramsOf,
  partId, partsOf, piecesOf, placeIn, present, proof, putStore, runShow, scenario, show, sourceOf, tempDir, useBuilds, vector, viewBoxOf,
  type Part, type Piece, type Typeset, type V2,
} from './helpers.ts';

const built = useBuilds({ show: true });
const A = ['a^2', '+', 'b^2', '=', 'c^2'];
const B = ['a^2', '=', 'c^2', '-', 'b^2'];
const SHARED = ['a^2', 'b^2', 'c^2', '='];
const TIMES = [0, 0.5, 1];

let typed: Promise<{ a: Typeset; b: Typeset }> | undefined;
const both = () => (typed ??= (async () => {
  built.hub();
  const w = await openWorld();
  const a = await mustTypeset(w, paramsOf(A), sourceOf(A));
  const b = await mustTypeset(w, paramsOf(B), sourceOf(B));
  proof('ac2-a.svg', a.svg);
  proof('ac2-b.svg', b.svg);
  return { a, b };
})());
/** The one part group whose data-source is `source`. */
function partOf(parts: readonly Part[], source: string, what: string): Part {
  const found = parts.filter((p) => p.source === source);
  expect(found.length, `${what} has exactly one part group whose data-source is ${source}: ${JSON.stringify(parts.map((p) => [p.id, p.source]))}`).toBe(1);
  return found[0]!;
}

describe(`${AC[2]} two formulas share their terms' ids, and a match_morph between their imports moves the shared terms and fades the rest`, () => {
  it(`${AC[2]} a^2 + b^2 = c^2 and a^2 = c^2 - b^2, typeset with no ids given, share the ids of a^2, b^2, c^2 and =`, async () => {
    mustHavePlugin();
    const { a, b } = await both();
    const pa = partsOf(a.svg).parts;
    const pb = partsOf(b.svg).parts;
    const failures: string[] = [];
    for (const s of SHARED) {
      const ia = partOf(pa, s, sourceOf(A)).id;
      const ib = partOf(pb, s, sourceOf(B)).id;
      if (ia !== ib) failures.push(`${s} is ${ia} in ${sourceOf(A)} and ${ib} in ${sourceOf(B)}`);
      if (ia !== partId(s)) failures.push(`${s}'s id is ${ia}, not ${partId(s)}, its id from its source`);
    }
    none(failures, 'the shared terms\' ids');
  }, TIMEOUT);

  it(`${AC[2]} a 1 s match_morph between their imports moves each shared part's centre from old to new place within 0.5 u at 0, 0.5 and 1 s and fades only + and -`, async () => {
    mustHavePlugin();
    const bin = built.show();
    const { a, b } = await both();
    const sa = partsOf(a.svg);
    const sb = partsOf(b.svg);
    const [vbA, vbB] = [viewBoxOf(sa.root), viewBoxOf(sb.root)];
    // One scale for both, each item sized to its viewBox, so the import places user units at k u from its position.
    const k = Math.min(700 / Math.max(vbA[2], vbB[2]), 160 / Math.max(vbA[3], vbB[3]));
    const sizeA: V2 = [vbA[2] * k, vbA[3] * k];
    const sizeB: V2 = [vbB[2] * k, vbB[3] * k];
    const posA: V2 = [50, 40];
    const posB: V2 = [50, 40 + sizeA[1] + 40];
    const placeA = placeIn(vbA, sizeA, posA);
    const placeB = placeIn(vbB, sizeB, posB);
    const placedCentre = (part: Part, place: (p: [number, number]) => [number, number], what: string): V2 => {
      const box = boundsOf(part.subs);
      expect(box, `${what}: the part ${part.source} draws something`).not.toBeNull();
      return place(centreOf(box!));
    };
    const shared = SHARED.map((s) => {
      const pa = partOf(sa.parts, s, sourceOf(A));
      const pb = partOf(sb.parts, s, sourceOf(B));
      return { source: s, id: pa.id, old: placedCentre(pa, placeA, sourceOf(A)), neu: placedCentre(pb, placeB, sourceOf(B)) };
    });
    for (const p of shared) expect(dist(p.old, p.neu), `the fixture discriminates: ${p.source} moves between the two imports`).toBeGreaterThan(10);
    const plus = `fa#${partOf(sa.parts, '+', sourceOf(A)).id}`;
    const minus = `fb#${partOf(sb.parts, '-', sourceOf(B)).id}`;

    const store = tempDir();
    const doc = film('formulas', [
      vector('fa', putStore(store, a.svg), sizeA, posA, sourceOf(A)),
      vector('fb', putStore(store, b.svg), sizeB, posB, sourceOf(B)),
    ], { transitions: { mm: matchMorph('fa', 'fb') } });
    const replies = runShow(bin, scenario(store, [present(DOC.a, doc), ...TIMES.map((t) => evalCall(DOC.a, fl(t)))]));
    expect(replies[0]?.['outcome'], `the film with both imports is presented: ${show(replies[0])}`).toBe('presented');
    const failures: string[] = [];
    TIMES.forEach((p, i) => {
      const what = `at ${p} s`;
      const pieces = piecesOf(replies[1 + i]!, 'mm', what);
      proof(`ac2-pieces-${p}.json`, pieces);
      for (const s of shared) {
        const found = pieces.filter((q) => q.from === `fa#${s.id}` && q.to === `fb#${s.id}`);
        if (found.length !== 1) { failures.push(`${what}: ${found.length} pieces go fa#${s.id} → fb#${s.id} (${s.source}), not one`); continue; }
        const want = lerp2(s.old, s.neu, p);
        if (dist(found[0]!.center, want) > 0.5) failures.push(`${what}: ${s.source}'s centre is ${fmt(found[0]!.center)}, not ${fmt(want)} (from ${fmt(s.old)} to ${fmt(s.neu)}) within 0.5 u`);
        if (found[0]!.opacity < 0.99) failures.push(`${what}: the shared ${s.source} fades (opacity ${found[0]!.opacity})`);
      }
      const unpaired = pieces.filter((q) => q.from === null || q.to === null);
      const names = unpaired.map((q) => `${q.from ?? '∅'} → ${q.to ?? '∅'}`).sort();
      const want = [`${plus} → ∅`, `∅ → ${minus}`].sort();
      if (JSON.stringify(names) !== JSON.stringify(want)) failures.push(`${what}: the pieces that fade are ${JSON.stringify(names)}, not only + going out and - coming in, ${JSON.stringify(want)}`);
      const others = pieces.filter((q) => q.from !== null && q.to !== null && !shared.some((s) => q.from === `fa#${s.id}` && q.to === `fb#${s.id}`));
      if (others.length) failures.push(`${what}: pieces beyond the four shared terms and + and -: ${JSON.stringify(others)}`);
      const fading = (name: string, q: Piece | undefined, at0: number): void => {
        if (!q) return;
        const target = p === 0 ? at0 : p === 1 ? 1 - at0 : null;
        if (target === null ? !(q.opacity > 0.01 && q.opacity < 0.99) : Math.abs(q.opacity - target) > 0.01) failures.push(`${what}: ${name}'s opacity is ${q.opacity}, not ${target ?? 'between 0 and 1'}`);
      };
      fading(`+ (${plus})`, unpaired.find((q) => q.from === plus && q.to === null), 1);
      fading(`- (${minus})`, unpaired.find((q) => q.from === null && q.to === minus), 0);
    });
    none(failures, 'the match morph between the two imports');
  }, TIMEOUT);
});
