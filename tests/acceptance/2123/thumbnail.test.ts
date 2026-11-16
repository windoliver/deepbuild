// #2123.f6e57c22 A thumbnail that can't be fetched is null on its row, and the search still answers. Given a library
// whose search answers two rows and whose thumbnail read throws, when deep_kinds searches, then both rows come back
// with thumbnail null.
//
// The world is #1731's (tests/acceptance/1731/helpers.ts, imported): a real hub, its extension host and source block,
// the test fill installed with `deep install` and turned on, and `deep_kinds` called through `deep mcp` as an agent's
// client calls it. Only the library's remote host stands in: #1731's fixture library on 127.0.0.1, whose two armchairs
// here name their thumbnails as protocol-relative URLs on another host (`//thumbs.shelf.example/…`). The hub reads a
// thumbnail through the library's source, on the library's own host only, and that read throws for such a path.
import { describe, expect, it } from 'vitest';
import { RANGE, kinds, libraryRows, onWorld } from '../1731/helpers.ts';
import { asset } from '../1731/library.ts';
import { AC } from './helpers.ts';

/** The two rows the library answers "armchair" with, both inside the size range. */
const ROWS = ['shelf-armchair', 'wing-chair'];
const SEARCH = { op: 'assets', query: 'armchair', size_m: RANGE, limit: 50 };

describe(`${AC.thumbnail} A thumbnail that can't be fetched is null on its row, and the search still answers`, () => {
  it(`${AC.thumbnail} a library whose search answers two rows and whose thumbnail read throws: deep_kinds answers both rows, each with thumbnail null`, async () => {
    const w = await onWorld();
    const was = ROWS.map((id) => asset(id).record.thumbnail);
    for (const id of ROWS) asset(id).record.thumbnail = `//thumbs.shelf.example/${id}.png`;
    const from = w.library.log.length;
    let outcome;
    try {
      outcome = await kinds(w, SEARCH);
    } finally {
      ROWS.forEach((id, i) => { asset(id).record.thumbnail = was[i]!; });
    }
    const said = `deep_kinds ${JSON.stringify(SEARCH)} said ${outcome.text.slice(0, 1200)}; the library saw ${w.library.quote(from)}`;
    expect(outcome.isError, `the search still answers: ${said}`).toBe(false);
    const rows = libraryRows(Array.isArray(outcome.value.rows) ? outcome.value.rows : []);
    expect(rows.map((r) => String(r.id)).sort(), `the library's two rows come back: ${said}`).toEqual(ROWS);
    expect(rows.map((r) => r.thumbnail), `each row's thumbnail: ${said}`).toEqual([null, null]);
  }, 600_000);
});
