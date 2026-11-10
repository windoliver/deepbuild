// AC7: "deep_query reads each bus's `loudness_target` as written, and reads it missing, never 0, on a bus without one;
// a planted reader that defaults it to 0 fails, naming the bus"
//
// Through deep_query (#411) on a path into the document's `buses` map, `buses/<id>/loudness_target` (README: The
// surface under test). The document, stored as a release stores it, is a board whose buses are `dialog` (target −16
// LUFS), `music` (−23.5), `effects` (none) and `master` (−14). Each written target must read as written; `effects`
// must read missing: null at the time asked, never a number. The planted `loudness_target_defaults_to_zero` reads 0
// for `effects`.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, queryValues, useEvidence, useShow, type JsonObject, type JsonValue, type Planted } from './helpers.ts';

const show = useShow();
const evidenceDir = useEvidence();

const TARGETS: Record<string, number | undefined> = { dialog: -16, music: -23.5, effects: undefined, master: -14 };

const BOARD: JsonObject = {
  format: 1, profile: 'board', title: 'Mix buses',
  description: 'Three buses and the master, three of them with a loudness target, for the #1818 suite.',
  size: [320, 200], items: {},
  buses: Object.fromEntries(Object.entries(TARGETS).map(([id, t]) => [id, { ...(id === 'master' ? {} : { out: 'master' }), ...(t === undefined ? {} : { loudness_target: t }) }])),
};

/** What deep_query reads wrong, each line naming the bus. */
function read(planted?: Planted): string[] {
  const paths = Object.keys(TARGETS).map((id) => `buses/${id}/loudness_target`);
  const values = queryValues(show(), evidenceDir(), BOARD, paths, 'deep_query of each bus\'s loudness_target', planted);
  const f: string[] = [];
  for (const [id, want] of Object.entries(TARGETS)) {
    const got: JsonValue[] = values[`buses/${id}/loudness_target`]!;
    if (want === undefined) {
      if (got.length === 0 || got.some((v) => v !== null)) f.push(`bus \`${id}\`: has no loudness_target, but deep_query reads ${JSON.stringify(got)}, not missing (null)`);
    } else if (got.length === 0 || got.some((v) => v !== want)) f.push(`bus \`${id}\`: its loudness_target is written ${want} LUFS, but deep_query reads ${JSON.stringify(got)}`);
  }
  return f;
}

describe('AC7 deep_query reads a bus\'s loudness target as written, and missing on a bus without one', () => {
  it(`${AC[7]} deep_query reads dialog's −16, music's −23.5 and master's −14 LUFS as written and effects' as missing, never 0; a planted reader that defaults a missing target to 0 fails, naming the bus \`effects\``, () => {
    expect(read(), 'each bus\'s loudness_target reads as written, and missing where none is').toEqual([]);

    // Wrong program: a reader that defaults a missing loudness_target to 0.
    const w = read('loudness_target_defaults_to_zero');
    expect(w.some((l) => l.startsWith('bus `effects`:')), `planted loudness_target_defaults_to_zero fails, naming the bus \`effects\`; got ${JSON.stringify(w)}`).toBe(true);
  }, TIMEOUT);
});
