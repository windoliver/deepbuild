// AC2: `refs_to` an asset hash used by three items and by one material returns four rows; for a hash nothing names
// it returns no rows with a coverage block that says the whole document was read. A planted read that returns no
// rows after reading one layer fails, since "a conclusion of absence drawn from a partial result is refused" (#411).
//
// The posters are a document alpha shares with you (#96's `docs[…].document`): alpha's layer holds one box, yours
// holds the three image marks and the material that name the picture, so every naming row is in a layer other than
// the caller's. The picture is a PNG the test puts into the evidence store by its hash; the unnamed hash is one no
// store holds and no field names (README: Fixtures).
import { describe, expect, it } from 'vitest';
import {
  DOC, FULL, POSTER_PATHS, POSTER_PNG, UNNAMED, coverage, failsNaming, none, postersSeed, refsTo, rows, run, scenario, stored, useBuilds, useEvidence,
  type JsonObject,
} from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();

/**
 * refs_to `target` gives a row at each of `paths`, once, and no other; and a reply with no rows says it read the whole
 * document only when the document's own count is 0. Every failure names the target.
 */
function pathFailures(target: string, reply: JsonObject, paths: readonly string[]): string[] {
  const got = rows(reply, `refs_to ${target}`).map((r) => String(r['path']));
  const out: string[] = [];
  for (const p of paths) if (!got.includes(p)) out.push(`refs_to ${target} is missing the row at ${p}`);
  for (const p of got) if (!paths.includes(p)) out.push(`refs_to ${target} gives a row the document doesn't hold, at ${p}`);
  if (new Set(got).size !== got.length) out.push(`refs_to ${target} gives a row twice: ${got.join(', ')}`);
  const c = coverage(reply, `refs_to ${target}`);
  if (got.length === 0 && paths.length > 0 && c['complete'] !== false) {
    out.push(`refs_to ${target} concludes that nothing names it (coverage ${JSON.stringify(c)}) from a read that missed the ${paths.length} rows the document holds: a conclusion of absence drawn from a partial result`);
  }
  return out;
}

describe('AC2 refs_to an asset hash finds every item and material that uses it, and an empty answer says the whole document was read', () => {
  it('AC2 refs_to the picture three posters and a material use gives four rows; a hash nothing names gives none, with a coverage block that read the whole document', () => {
    const picture = stored(evidence(), POSTER_PNG());
    const [named, unnamed] = run(builds.bin(FULL), scenario(evidence(), { [DOC.posters]: { document: postersSeed(picture) } }, [
      refsTo(DOC.posters, picture),
      refsTo(DOC.posters, UNNAMED),
    ]));

    console.log(`AC2 refs_to the picture: ${JSON.stringify(named)}\nAC2 refs_to a hash nothing names: ${JSON.stringify(unnamed)}`);
    none(pathFailures(picture, named!, POSTER_PATHS), 'refs_to the picture gives the four rows that name it');
    expect(coverage(named, 'refs_to the picture'), 'the coverage block: all four rows, nothing cut').toMatchObject({ complete: true, rows_total: 4, rows_shown: 4, cut: [] });

    expect(rows(unnamed, 'refs_to a hash nothing names'), 'refs_to a hash nothing names gives no rows').toEqual([]);
    expect(coverage(unnamed, 'refs_to a hash nothing names'), 'and its coverage block says the whole document was read: complete, 0 rows of 0, nothing cut')
      .toMatchObject({ complete: true, rows_total: 0, rows_shown: 0, cut: [] });
  });

  it('AC2 a planted read that returns no rows after reading only the caller\'s layer fails, naming the picture and the rows it missed', () => {
    const picture = stored(evidence(), POSTER_PNG());
    const [reply] = run(builds.bin(FULL), scenario(evidence(), { [DOC.posters]: { document: postersSeed(picture) } }, [
      refsTo(DOC.posters, picture),
    ], { planted: 'refs_read_one_layer' }));
    expect(rows(reply, 'refs_to the picture under refs_read_one_layer'), 'the planted read, of alpha\'s layer alone, returns no rows').toEqual([]);
    failsNaming(pathFailures(picture, reply!, POSTER_PATHS), [picture, ...POSTER_PATHS], 'a read of one layer that returns no rows');
  });
});
