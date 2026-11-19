// #1518.57df01e0: "A kept fragment of 30 ms between two cuts is listed in `fragments`, and a planted recipe that drops it
// silently fails"
//
// Criterion 4's take (README: Fixtures): five square-wave words, ash (kept), birch (removed), cedar (kept, 30 ms), dogwood
// (removed) and elm (kept); birch, cedar and dogwood run on as one square wave, so inside the bounds of cedar's two cuts
// no spot is quieter than their raw points and both stay on cedar's edges, which are sign changes: a run 30 ms long between
// two cuts, under half its two 40 ms crossfades. The judgment (fragmentFailures): `fragments` lists word 2, cedar, with a
// `why`; `removed` is [1, 3]; no strip plays any sample of cedar; ash and elm are played whole; and the cuts either side
// of cedar join as one splice, two strips, the second starting its crossfade's length before the first ends. The clean
// recipe passes; the planted cut_drops_fragments, which drops cedar and lists nothing, fails it, naming `fragments`.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, PLANTED, TIMEOUT, cutRow, fragmentTake, playedAs, present, presented, proof, runShow, scenario, soundFilm, stageWav, useShow, useTemp,
  type CutRow, type FragmentTake,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

function cut(planted?: string): { take: FragmentTake; row: CutRow } {
  const take = fragmentTake();
  const evidence = temp();
  const s = stageWav(evidence, take);
  const what = planted ? `the take with a 30 ms fragment under the planted ${planted}` : 'the take with a 30 ms fragment';
  const [shown] = runShow(shows.bin(FULL), scenario(evidence, [present(DOC.a, soundFilm(s.sha, [s.record], take.keep, 3))], planted ? { planted } : {}), what);
  return { take, row: cutRow(presented(shown, what), what) };
}

function fragmentFailures(take: FragmentTake, row: CutRow): string[] {
  const f: string[] = [];
  const frag = take.words[take.fragment]!;
  const listed = row.fragments.find((x) => x.word === take.fragment);
  if (!listed) f.push(`\`fragments\` lists nothing for word ${take.fragment} "${frag.text}", the 30 ms kept fragment between two cuts: ${JSON.stringify(row.row['fragments'] ?? null)}`);
  else {
    if (listed.text !== frag.text) f.push(`\`fragments\` lists word ${take.fragment} with the text ${JSON.stringify(listed.text)}, not its record's "${frag.text}"`);
    if (listed.why.trim() === '') f.push(`\`fragments\` lists word ${take.fragment} with no \`why\` naming its length and its crossfades`);
  }
  if (JSON.stringify(row.removed) !== '[1,3]') f.push(`\`removed\` is ${JSON.stringify(row.removed)}, not [1,3]: the fragment is kept, listed in fragments, never removed`);
  const played = playedAs(row.strips, frag.start, frag.end);
  if (played !== 'none') f.push(`the fragment is played (${played}): a fragment too short for its crossfades is dropped, never played`);
  for (const k of [0, 4]) {
    const w = take.words[k]!;
    if (playedAs(row.strips, w.start, w.end) !== 'whole') f.push(`the kept word ${k} "${w.text}" isn't played whole`);
  }
  if (row.strips.length !== 2) f.push(`${row.strips.length} strips, not 2: the cuts either side of the fragment join as one splice`);
  else {
    const [a, b] = row.strips as [CutRow['strips'][0], CutRow['strips'][0]];
    if (!(b.fadeIn > 0 && b.fadeIn === a.fadeOut && b.start === a.start + (a.out - a.in) - a.fadeOut)) f.push(`the two strips don't join as one splice, the second starting its crossfade's length before the first ends: ${JSON.stringify([a.raw, b.raw])}`);
  }
  return f;
}

describe(`${AC[4]} a kept fragment of 30 ms between two cuts is listed in fragments; dropping it silently fails`, () => {
  it(`${AC[4]} the 30 ms kept word between two cuts is listed in fragments with its text and why, never played, the cuts either side joined as one splice`, () => {
    const { take, row } = cut();
    const failures = fragmentFailures(take, row);
    proof('ac4-fragment.json', { words: take.words, row: row.row, failures });
    expect(failures, failures.join(' | ')).toEqual([]);
  }, TIMEOUT);

  it(`${AC[4]} the planted cut_drops_fragments, which drops the fragment and lists nothing, fails the same judgment naming fragments`, () => {
    const { take, row } = cut(PLANTED.drops);
    const failures = fragmentFailures(take, row);
    proof('ac4-planted.json', { row: row.row, failures });
    expect(failures.some((x) => x.startsWith('`fragments` lists nothing for word 2')), `the judgment fails the recipe that drops the fragment silently, naming fragments: ${failures.join(' | ')}`).toBe(true);
  }, TIMEOUT);
});
