// #509.18ee17cc: "A say that changes a word the line doesn't mark as a name is refused with say_not_text"
//
// Through `deep-show run`: the film's one line `l1`, "Meet Siobhan at 10:30 where the bands live", spoken from its own
// recording of its `say`, "Meet Shivawn at ten thirty where the bands lyve". With `names: ["Siobhan"]` every difference
// is one the design lets `say` make: a marked name respelled, a normalizer expansion (10:30 and "ten thirty" both read
// 1030) and a homograph's listed reading (live: lyve), so the script compiles and `time` resolves `@l1`. The same line
// with no names, so Siobhan is a word the line doesn't mark, is refused with say_not_text naming l1, the text's word
// Siobhan and what say has there, Shivawn; and with the name marked but say saying "bonds" for "bands" it is refused
// naming bands and bonds. A refused script resolves no time.
import { describe, expect, it } from 'vitest';
import { AC, FULL, TIMEOUT, assetOf, coded, fieldOf, film, filmRun, proof, recorded, show, stage, take, timeCall, useShow, useTemp, words, type JsonObject } from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const TEXT = 'Meet Siobhan at 10:30 where the bands live';
const SAY = 'Meet Shivawn at ten thirty where the bands lyve';
const SPOKEN = ['Meet', 'Shivawn', 'at', 'ten thirty', 'where', 'the', 'bands', 'lyve'];

/** The film with l1's say and names; `time @l1` on it, and every reply. */
function run(say: string, names: string[], what: string): { replies: JsonObject[]; time: JsonObject } {
  const evidence = temp();
  const voice = stage(evidence, take(TEXT, { groups: SPOKEN }));
  const doc = film({ span: 6, lines: { l1: recorded('voice_l1', TEXT, 0.5, { say, names }) }, assets: { voice_l1: assetOf(voice) } });
  const replies = filmRun(shows.bin(FULL), evidence, doc, [timeCall('@l1')], what);
  return { replies, time: replies[1]! };
}
/** The run is refused with say_not_text naming l1, the text's word and what say has there; it resolves no time. */
function refusedNaming(r: { replies: JsonObject[]; time: JsonObject }, text: string, said: string, what: string): void {
  const found = coded(r.replies, 'say_not_text');
  expect(found.length, `${what} is refused with say_not_text: ${show(r.replies, 2500)}`).toBeGreaterThan(0);
  const names = (o: JsonObject): boolean => (fieldOf(o, 'line') === 'l1' || words(o).includes('"l1"')) && words(o).includes(text) && words(o).includes(said);
  expect(found.some(names), `${what}: say_not_text names the line l1, the text's word ${text} and what say has there, ${said}: ${show(found, 1500)}`).toBe(true);
  expect(r.time['outcome'], `${what}: the refused script resolves no time for @l1: ${show(r.time)}`).not.toBe('resolved');
}

describe(`${AC[3]} a say that changes a word the line doesn't mark as a name is refused with say_not_text`, () => {
  it(`${AC[3]} say may respell the marked name, expand 10:30 and read live as lyve; with Siobhan unmarked, or bands said as bonds, it is refused with say_not_text naming l1 and both words`, () => {
    const clean = run(SAY, ['Siobhan'], 'the line whose say differs only on the marked name, an expansion and a homograph');
    const unmarked = run(SAY, [], 'the line whose say respells Siobhan, which it does not mark as a name');
    const changed = run(SAY.replace('bands', 'bonds'), ['Siobhan'], 'the line whose say says bonds for bands');
    proof('ac3-say.json', { clean: clean.replies, unmarked: unmarked.replies, changed: changed.replies });

    expect(coded(clean.replies, 'say_not_text'), `the clean line raises no say_not_text: ${show(clean.replies, 1500)}`).toEqual([]);
    expect(clean.time['outcome'], `the clean line's script compiles and @l1 resolves: ${show(clean.time)}`).toBe('resolved');
    refusedNaming(unmarked, 'siobhan', 'shivawn', 'the say that respells the unmarked Siobhan');
    refusedNaming(changed, 'bands', 'bonds', 'the say that says bonds for bands');
  }, TIMEOUT);
});
