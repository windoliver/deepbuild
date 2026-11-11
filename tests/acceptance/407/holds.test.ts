// #407.1d0942b2 (AC1): ""THE KETTLE SINGS" needs 2.43 s, "Steam lifts the lid." 2.63 s, "水开了，壶在唱歌。" 3.19 s and a
// title card 4 s, each counted from its full reveal inside the safe area; a typewriter's typing time doesn't count, and
// a title cut by the frame never starts its hold"
// #407.ce50be00 (AC2): "Text in a script with no stated rate (Thai, say) makes its item BLOCKED naming the script, and a
// caption within its profile passes even when it's shorter than the hold rule"
//
// Fixtures (helpers.ts), 1920 × 1080 films at 60 frames a second, each judged by one requirement {kind: film.audit}:
//   - holdFilm: one text@1 at 72 u, wholly inside the safe area, beside the kettle (a rect, so the text isn't its shot's
//     only subject), shown from 1 s for a boundary pair of holds 5 to 7 frames either side of its need: "THE KETTLE
//     SINGS" 2.35 / 2.55 s (need 1.5 + 14 ÷ 15 = 2.433), "Steam lifts the lid." 2.55 / 2.75 s (1.5 + 17 ÷ 15 = 2.633),
//     "水开了，壶在唱歌。" 3.10 / 3.30 s (1.5 + 7 ÷ 4.5 + 2 ÷ 15 = 3.189).
//   - titleCardFilm: "KETTLE", 120 u, the only subject of its one shot, held 3.90 / 4.10 s (need 4); and the same title
//     set from x = −60 u, so the frame cuts its first letter, shown 5 s.
//   - typedFilm: "THE KETTLE SINGS" revealed from 1 s to 2 s (text@1 `reveal`, progress 0 → 1), then held until 4.35 s or
//     4.55 s: 2.35 / 2.55 s from its full reveal, 3.35 / 3.55 s counting the typing.
//   - Thai: "กาต้มน้ำร้องเพลง" shown 1 s to 6 s. Captions: a `caption` line `cap` at 1 s, "The kettle sings." under
//     netflix-en-adult (0.85 s on screen; the hold rule would ask 2.5 s) and "水开了。" under netflix-zh-hans (its
//     profile's minimum duration; the rule would ask 2.23 s); and, as the control that the audit reads captions at all,
//     an en caption with a 46-letter word, past netflix-en-adult's 42 characters a line.
//
// asserts:
//   - AC1: each short hold FAILs with a film.hold_short naming its item, `need` within 0.005 s of the issue's 2.43, 2.63,
//     3.19 or 4, and `t` the hold's first frame (1 s; the typed text's full reveal, 2 s); each long hold PASSes with
//     nothing raised; the cut title FAILs with a film.hold_short naming it whose `held` is 0. Wrong programs caught: a
//     rate that counts spaces (2.57 s), CJK at the Latin rate (2.10 s), a title card held to the text rule (1.9 s),
//     time counted while typing (3.35 s), or a cut title's on-screen time.
//   - AC2: the Thai film is BLOCKED, a `blocked` entry naming the item and the script Thai; each caption within its
//     profile PASSes with nothing raised; the control FAILs with an error naming its caption.
import { describe, expect, it } from 'vitest';
import {
  AC, CJK, FULL, KETTLE, NEED, STEAM, TIMEOUT, brief, captionFilm, docId, errorNaming, field, holdFilm, holdShort, judge, mentions, namesCaption,
  needOf, none, passFailures, titleCardFilm, typedFilm, useBuilds, useFolders, type Film, type Row,
} from './helpers.ts';

const bin = useBuilds([FULL]);
const folder = useFolders();

interface Pair { id: string; label: string; words: string; need: number; short: number; long: number; first: number }
const PAIRS: Pair[] = [
  { id: 'kettle', label: '"THE KETTLE SINGS"', words: KETTLE, need: NEED.kettle, short: 2.35, long: 2.55, first: 1 },
  { id: 'steam', label: '"Steam lifts the lid."', words: STEAM, need: NEED.steam, short: 2.55, long: 2.75, first: 1 },
  { id: 'cjk', label: `"${CJK}"`, words: CJK, need: NEED.cjk, short: 3.1, long: 3.3, first: 1 },
];

describe(`${AC[1]} reading holds by grapheme from full reveal inside the safe area`, () => {
  it(`${AC[1]} "THE KETTLE SINGS" needs 2.43 s, "Steam lifts the lid." 2.63 s, "${CJK}" 3.19 s and a title card 4 s; typing doesn't count and a cut title never starts its hold`, () => {
    // The fixture's own numbers: the design's rule gives the issue's, and each pair sits either side of its need.
    for (const p of PAIRS) {
      expect(Math.abs(needOf(p.words) - p.need), `the rule gives ${p.label} ${p.need} s`).toBeLessThan(0.005);
      expect(p.short < needOf(p.words) && needOf(p.words) < p.long, `${p.label}'s pair straddles its need`).toBe(true);
    }
    expect(needOf('KETTLE', true)).toBe(NEED.card);
    const films: Film[] = [];
    let n = 0;
    for (const p of PAIRS) {
      films.push({ name: `${p.label} held ${p.short} s`, doc: docId(++n), document: holdFilm(docId(n), p.id, p.words, p.first, p.short) });
      films.push({ name: `${p.label} held ${p.long} s`, doc: docId(++n), document: holdFilm(docId(n), p.id, p.words, p.first, p.long) });
    }
    films.push({ name: 'the title card held 3.9 s', doc: docId(++n), document: titleCardFilm(docId(n), 'KETTLE', 1, 3.9) });
    films.push({ name: 'the title card held 4.1 s', doc: docId(++n), document: titleCardFilm(docId(n), 'KETTLE', 1, 4.1) });
    films.push({ name: 'the typed text held 2.35 s after its reveal', doc: docId(++n), document: typedFilm(docId(n), 4.35) });
    films.push({ name: 'the typed text held 2.55 s after its reveal', doc: docId(++n), document: typedFilm(docId(n), 4.55) });
    films.push({ name: 'the title cut by the frame', doc: docId(++n), document: titleCardFilm(docId(n), 'KETTLE', 1, 5, true) });
    const { judged } = judge(bin(FULL), folder(), films);
    const row = (name: string): Row | undefined => judged[name]?.row;

    const failures: string[] = [];
    for (const p of PAIRS) {
      failures.push(...holdShort(row(`${p.label} held ${p.short} s`), p.id, { need: p.need, t: p.first }, `${p.label} held ${p.short} s`));
      failures.push(...passFailures(row(`${p.label} held ${p.long} s`), `${p.label} held ${p.long} s`));
    }
    failures.push(...holdShort(row('the title card held 3.9 s'), 'title', { need: NEED.card, t: 1 }, 'the title card held 3.9 s'));
    failures.push(...passFailures(row('the title card held 4.1 s'), 'the title card held 4.1 s'));
    failures.push(...holdShort(row('the typed text held 2.35 s after its reveal'), 'typed', { need: NEED.kettle, tIn: [2 - 1 / 60 - 1e-6, 2 + 1 / 60 + 1e-6] }, 'the typed text held 2.35 s after its reveal (3.35 s with its typing)'));
    failures.push(...passFailures(row('the typed text held 2.55 s after its reveal'), 'the typed text held 2.55 s after its reveal'));
    failures.push(...holdShort(row('the title cut by the frame'), 'title', { heldZero: true }, 'the title cut by the frame'));
    none(failures, 'reading holds');
  }, TIMEOUT);
});

const THAI = 'กาต้มน้ำร้องเพลง';
const LONG_WORD = 'Pneumonoultramicroscopicsilicovolcanoconiosiss';

describe(`${AC[2]} a script with no stated rate is BLOCKED naming it; captions are held to their profile`, () => {
  it(`${AC[2]} Thai text makes its item BLOCKED naming the script Thai, and a caption within its profile passes though shorter than the hold rule`, () => {
    const films: Film[] = [
      { name: 'the Thai text', doc: docId(1), document: holdFilm(docId(1), 'thai-line', THAI, 1, 5) },
      { name: 'the en caption', doc: docId(2), document: captionFilm(docId(2), 'The kettle sings.', 'en', 'netflix-en-adult') },
      { name: 'the zh-Hans caption', doc: docId(3), document: captionFilm(docId(3), '水开了。', 'zh-Hans', 'netflix-zh-hans') },
      { name: 'control: an en caption past its profile', doc: docId(4), document: captionFilm(docId(4), `The ${LONG_WORD} kettle.`, 'en', 'netflix-en-adult') },
    ];
    const { judged } = judge(bin(FULL), folder(), films);
    const failures: string[] = [];
    const thai = judged['the Thai text']?.row;
    if (!thai) failures.push('the Thai text has no row in the verdict');
    else {
      if (thai.result !== 'BLOCKED') failures.push(`the Thai text is ${thai.result}, not BLOCKED: ${brief(thai.raw)}`);
      const named = thai.blocked.filter((b) => mentions(b, 'thai-line'));
      if (!named.length) failures.push(`no blocked entry names the item thai-line: ${brief(thai.blocked)}`);
      else if (!named.some((b) => /^thai$/i.test(String(field(b, 'script'))))) failures.push(`the blocked entry naming thai-line names the script ${brief(named.map((b) => field(b, 'script') ?? null))}, not Thai`);
    }
    failures.push(...passFailures(judged['the en caption']?.row, 'the en caption'));
    failures.push(...passFailures(judged['the zh-Hans caption']?.row, 'the zh-Hans caption'));
    failures.push(...errorNaming(judged['control: an en caption past its profile']?.row, (i) => namesCaption(i, 'cap'), 'its caption cap', 'control: an en caption past its profile'));
    none(failures, 'scripts with no rate, and captions held to their profile');
  }, TIMEOUT);
});
