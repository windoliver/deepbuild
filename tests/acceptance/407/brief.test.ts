// #407.6f6541a9 (AC5): "A film's brief yields one check per moment, reading hold and cue, and a render that misses one is
// sent back like any claim"
//
// Fixtures (helpers.ts): the brief `BRIEF`, on each claim as its locked definition holds it (README: The brief): goal,
// moments [m-lid, m-steam], reading holds [t-kettle, t-steam, t-cjk] and cues [c-boil, c-pour], and no other
// requirement. `briefFilm`: a 1920 × 1080 film with the kettle and three texts, "THE KETTLE SINGS" over [1, 3.6) s,
// "Steam lifts the lid." over [3, 5.8) s and "水开了，壶在唱歌。" over [5, 8.4) s (each 0.17 to 0.21 s past its need),
// the cue markers c-boil (1 to 2 s) and c-pour (4 to 5 s), and the moment markers m-lid (2.5 s) and m-steam (5.5 s).
// Three renders each miss one entry: the cue c-pour, the moment m-steam, or the text t-steam.
//
// asserts: the whole render's claim PASSes, its verdict holding exactly one row from each of the brief's seven entries
// (moment:m-lid, moment:m-steam, hold:t-kettle, hold:t-steam, hold:t-cjk, cue:c-boil, cue:c-pour, read off each row's
// `from`), each PASS, and no row from an entry the brief doesn't list; each render that misses an entry is sent back
// like any claim: its claim FAILs, the row from that entry FAILs and the other six PASS. Wrong programs caught: a brief
// that compiles into one check (or none), a check per kind rather than per entry, and a missing entry that passes.
import { describe, it } from 'vitest';
import {
  AC, BRIEF, BRIEF_ENTRIES, FULL, TIMEOUT, brief, briefFilm, docId, entryOf, judge, none, useBuilds, useFolders, type Film, type Verdict,
} from './helpers.ts';

const bin = useBuilds([FULL]);
const folder = useFolders();

/** The claim's verdict holds one row per brief entry, and the rows from `failing` FAIL while the rest PASS. */
function briefFailures(v: Verdict | undefined, failing: string | null, what: string): string[] {
  if (!v) return [`${what} has no verdict`];
  const failures: string[] = [];
  const want = failing === null ? 'PASS' : 'FAIL';
  if (v.result !== want) failures.push(`${what}'s claim is ${v.result}, not ${want}`);
  const fromBrief = v.rows.filter((r) => entryOf(r) !== null);
  for (const entry of BRIEF_ENTRIES) {
    const rows = fromBrief.filter((r) => entryOf(r) === entry);
    if (rows.length !== 1) { failures.push(`${what}: ${rows.length} rows come from the brief's ${entry}, not one: ${brief(v.rows.map((r) => r.raw), 1200)}`); continue; }
    const expected = entry === failing ? 'FAIL' : 'PASS';
    if (rows[0]!.result !== expected) failures.push(`${what}: the row from ${entry} is ${rows[0]!.result}, not ${expected}: ${brief(rows[0]!.raw, 600)}`);
  }
  const extra = fromBrief.filter((r) => !(BRIEF_ENTRIES as readonly string[]).includes(entryOf(r)!));
  if (extra.length) failures.push(`${what}: rows come from entries the brief doesn't list: ${extra.map((r) => entryOf(r)).join(', ')}`);
  return failures;
}

describe(`${AC[5]} a film's brief is its definition of done`, () => {
  it(`${AC[5]} the brief yields one check per moment, reading hold and cue, and a render that misses one is sent back`, () => {
    const renders: { name: string; missing: 'none' | 'cue' | 'moment' | 'hold'; failing: string | null }[] = [
      { name: 'the whole render', missing: 'none', failing: null },
      { name: 'the render missing the cue c-pour', missing: 'cue', failing: 'cue:c-pour' },
      { name: 'the render missing the moment m-steam', missing: 'moment', failing: 'moment:m-steam' },
      { name: 'the render missing the hold of t-steam', missing: 'hold', failing: 'hold:t-steam' },
    ];
    const films: Film[] = renders.map((r, i) => ({ name: r.name, doc: docId(i + 1), document: briefFilm(docId(i + 1), r.missing), check: null, brief: BRIEF }));
    const { judged } = judge(bin(FULL), folder(), films);
    none(renders.flatMap((r) => briefFailures(judged[r.name]?.verdict, r.failing, r.name)), "the brief's checks");
  }, TIMEOUT);
});
