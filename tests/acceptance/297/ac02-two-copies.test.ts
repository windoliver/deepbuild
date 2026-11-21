// AC2 #297.3618602e: In a two-copy match through the test relay, a nameplate mark set whose player column a logic array
// writes shows the same pixels on both copies at 20 sampled times; a planted copy that shows only its own viewer's
// entries differs and fails, naming the row
//
// Through `deep-show run`'s `match` (#549: every copy in this process over the test relay, on its clock): the plates
// piece, whose mark set `plates` reads its player column from `seats.who` (1 and 2) through the column view and shows
// `name`'s entries in its text column. Player 1's script commits "Kai" and then "Kai Ng", player 2's "Ana" and then "Ana
// Lee"; `render_back` asks each copy's frame at 20 times, each half a step past a sampled step and at least 5 steps from
// any commit. Each render's `sha256` is that copy's own frame's pixels, and its `shown` what each row shows (README). The
// planted `entry_own_viewer_only` (README: Planted twins) makes each copy show only its own viewer's entries.
import { describe, it } from 'vitest';
import { DEFAULT_NAME, DELAY, NAME, platesDoc, seatsProgram } from './fixtures.ts';
import {
  AC, DOC, RATE, Script, TIMEOUT, failsNaming, named, none, once, presented, putEvidence, rendersOf, runShow, scenario, useShow, useTemp,
  type Planted, type Plays, type Render,
} from './helpers.ts';

const show = useShow();
const temp = useTemp();
const D = DOC(2);
const STEPS = 300;
/** Each player's commits, by the step each lands at. */
const COMMITS: Record<1 | 2, [number, string][]> = { 1: [[33, 'Kai'], [145, 'Kai Ng']], 2: [[75, 'Ana'], [215, 'Ana Lee']] };
const PLAYS: Plays = Object.fromEntries(([1, 2] as const).map((p) => [String(p), COMMITS[p].map(([land, value]) => ({ step: land - DELAY, control: NAME, value }))]));
/** The 20 sampled steps, 14 apart: none within 5 steps of a commit. */
const SAMPLES = Array.from({ length: 20 }, (_, k) => 12 + 14 * k);
const timeOf = (step: number): number => (step + 0.5) / RATE;
/** What row r (seat r + 1) shows once its copy has run `step`. */
const expected = (row: 0 | 1, step: number): string => {
  const last = COMMITS[(row + 1) as 1 | 2].filter(([land]) => land <= step).pop();
  return last ? last[1] : DEFAULT_NAME;
};
const ROWS = ['plates#0', 'plates#1'] as const;

function judge(planted?: Planted): string[] {
  const ev = temp();
  const seats = seatsProgram();
  putEvidence(ev, seats.bytes);
  const s = new Script();
  s.present(D, platesDoc(seats));
  const asks = SAMPLES.flatMap((k) => [{ player: 1, t: timeOf(k) }, { player: 2, t: timeOf(k) }]);
  const m = s.match(D, STEPS, PLAYS, asks);
  const r = runShow(show(), scenario(ev, [D], s.calls, planted), 'AC2 the two-copy match with 40 render-backs');
  presented(r[0]!, 'the plates piece');
  const renders = rendersOf(r[m]!, asks.length, 'the match');
  const failures: string[] = [];
  const byNames = new Map<string, { sha: string; step: number }>();
  SAMPLES.forEach((k, n) => {
    const [one, two] = [renders[2 * n]!, renders[2 * n + 1]!] as [Render, Render];
    const when = `at ${timeOf(k).toFixed(4)} s (step ${k})`;
    if (one.player !== 1 || two.player !== 2) failures.push(`${when}: the renders answer players ${one.player} and ${two.player}, not 1 and 2 as asked`);
    if (one.sha256 !== two.sha256) {
      const rows = ROWS.filter((row) => one.shown[row] !== two.shown[row]).map((row) => `row ${row} shows ${named(one.shown[row] ?? '(nothing reported)')} on copy 1 and ${named(two.shown[row] ?? '(nothing reported)')} on copy 2`);
      failures.push(`${when}: copy 1 and copy 2 draw other pixels (${one.sha256.slice(0, 12)} vs ${two.sha256.slice(0, 12)}); ${rows.length ? rows.join('; ') : 'no row shows another string'}`);
    }
    for (const c of [one, two]) {
      for (const [r0, row] of ROWS.entries()) {
        const want = expected(r0 as 0 | 1, c.step);
        if (c.shown[row] !== want) failures.push(`${when}: on copy ${c.player} (its step ${c.step}) row ${row} (seat ${r0 + 1}) shows ${c.shown[row] === undefined ? 'nothing it reports' : named(c.shown[row]!)}, not ${named(want)}`);
      }
    }
    // The pixels follow the names: two samples whose rows show the same names draw the same frame, and other names another.
    const key = `${expected(0, k)} | ${expected(1, k)}`;
    const seen = byNames.get(key);
    if (seen && seen.sha !== one.sha256) failures.push(`${when}: copy 1 draws other pixels than at step ${seen.step}, where the rows show the same names (${key})`);
    if (!seen) {
      for (const [other, o] of byNames) if (o.sha === one.sha256) failures.push(`${when}: copy 1 draws the pixels of step ${o.step}, where the rows show ${other}, not ${key}`);
      byNames.set(key, { sha: one.sha256, step: k });
    }
  });
  return failures;
}
const honest = once(() => judge());

describe(`${AC[2]} in a two-copy match every copy shows every player's name from its own track, alike`, () => {
  it(`${AC[2]} the nameplate mark set whose player column seats.who writes shows the same pixels on both copies at 20 sampled times`, () => {
    none(honest(), 'the two copies\' nameplates');
  }, TIMEOUT);
  it(`${AC[2]} the planted copy that shows only its own viewer's entries differs and fails, naming the row`, () => {
    failsNaming(judge('entry_own_viewer_only'), [/draw other pixels.*row plates#[01] shows/], 'entry_own_viewer_only');
  }, TIMEOUT);
});
