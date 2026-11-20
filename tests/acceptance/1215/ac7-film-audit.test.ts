// AC7 #1215.f8b80d0d: A title card in `vertical_rl` with a halo, in a 1920 × 1080 film, passes the film audit's
// readable-text and reading-hold checks; a planted 9 px title fails readable text, naming the item.
//
// Two films through `deep-show run`, each the one deliverable of a claim whose requirement is `{kind: "film.audit"}` at its
// defaults (#407's harness, imported). In each, "敦煌莫高窟" (five Han graphemes, so it needs max(1.5, 4 for a title card,
// 1.5 + 5 ÷ 4.5) = 4 s) is the only subject of its one shot, in the body font in `vertical_rl` with a 6 px halo in the
// ground role, drawn from (1700, 300), shown from 1 s to 6 s. At 96 px its one column runs 480 u down and about one line
// height (125 u) across, inside the safe area (24 u in from each edge); the same five graphemes set across on one line from
// x = 1700 would run past the safe area's right edge (1896 u), so the film reads only when the title is set in a column.
// The planted title is the same film at 9 px, under the look's smallest text size: it never reads, so the audit fails it
// naming `title`, by a film.hold_short whose hold never started (`held` 0, #407's reading of text that never reads) or by
// an error whose code names readability.
import { describe, it } from 'vitest';
import {
  FULL, HOLD, TIMEOUT, brief, docId, durationOf, field, film, judge, mentions, none, order, passFailures, shot, shownOver, useBuilds, useFolders,
  type Film, type JsonObject, type Row,
} from '../407/helpers.ts';
import { AC } from './helpers.ts';

const bin = useBuilds([FULL]);
const folder = useFolders();
const TITLE = '敦煌莫高窟';

/** The title card: `TITLE` at `size` u in vertical_rl with a halo, the only subject of its shot, shown [1 s, 6 s). */
function card(doc: string, size: number): JsonObject {
  const title: JsonObject = {
    id: 'title', kind: 'text@1', name: 'Title', order: order(1),
    params: { text: TITLE, font: 'body', size, flow: 'vertical_rl', halo: [{ width: 6, role: 'ground' }], paint: { fill: { role: 'ink' } } },
    at: { pos: [1700, 300, 0] },
  };
  return film(doc, `A vertical title card at ${size} u`, [title], {
    span: 7, camera: true, shots: { card: shot(0, 7, { frame: { keep: ['title'] } }) }, channels: { show: shownOver('title', 1, 6) },
  });
}

/** The row FAILs with an error naming `item` as text that never reads. */
function neverReads(row: Row | undefined, item: string, what: string): string[] {
  if (!row) return [`${what} has no row in the verdict`];
  const out: string[] = [];
  if (row.result !== 'FAIL') out.push(`${what} is ${row.result}, not FAIL`);
  const named = row.issues.filter((i) => i.severity === 'error' && mentions(i.raw, item));
  const read = named.filter((i) => /readab/.test(i.code) || (i.code === HOLD && Math.abs(durationOf(field(i.raw, 'held')) ?? NaN) <= 1e-6));
  if (!read.length) out.push(`no error names ${item} as text that never reads (a ${HOLD} with held 0, or a readability code): ${brief(row.issues.map((i) => i.raw))}`);
  return out;
}

describe(`${AC[7]} a vertical title card with a halo reads and holds; a 9 px one never reads`, () => {
  it(`${AC[7]} the 96 px vertical_rl title card with a halo passes the film audit; the planted 9 px title fails readable text, naming the item`, () => {
    const films: Film[] = [
      { name: 'the vertical title card', doc: docId(1), document: card(docId(1), 96) },
      { name: 'the planted 9 px title', doc: docId(2), document: card(docId(2), 9) },
    ];
    const { judged } = judge(bin(FULL), folder(), films);
    none(passFailures(judged['the vertical title card']!.row, 'the vertical title card'), 'the vertical title card');
    none(neverReads(judged['the planted 9 px title']!.row, 'title', 'the planted 9 px title'), 'the planted 9 px title fails readable text, naming title');
  }, TIMEOUT);
});
