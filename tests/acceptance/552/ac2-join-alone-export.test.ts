// AC2 #552.1430609d: The Join prompt of that piece shows "Fog in this piece is a courtesy. Every copy can see
// everything." and the paddle piece's doesn't; a piece played alone reads match.me as 1; and an export of the recorded
// match draws player 1's fog by default, player 2's when it names player 2, and every enemy when it names none
//
// "That piece" is criterion 1's fog piece; "the paddle piece" is #550's (`courtDoc`), which reads no match.me. The
// prompts are read as #549's suite reads the app's prompt (`scope`'s `state.join.text`), each piece on a panel of its
// own. "Played alone" is the piece's own still export at 5 s (step 100, where only player 2 sees enemy 1), with no
// record; "an export of the recorded match" is the same still export given copy 1's record from a 200-step `match`
// (README: `export`'s `record` and `me`), by default, with `me: 2` and with `me: "none"`. Each still is judged at the
// enemies' centres as criterion 1 judges a frame. Wrong programs it fails: the merge base (no seen column, no courtesy
// line); a line on every prompt, or on none; an export that ignores the record's player, `me` or `none`; a piece played
// alone that reads none or another player.
import { describe, expect, it } from 'vitest';
import { DOC as COURT_DOC, courtDoc, courtProgram } from '../550/fixtures.ts';
import { DOC, FOG_SIZE, fogDoc, seenAt, sightProgram } from './fixtures.ts';
import {
  AC, FULL, Script, TIMEOUT, exportCall, frameFailures, macOnly, matchCall, none, obj, pairOf, presented, promptOf, putEvidence, run, scenario, show,
  stillOf, useBuilds, useChildren, useTemp,
} from './helpers.ts';
import type { JsonObject } from './fixtures.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
/** The courtesy line, word for word (the issue's Fields; Net: this copy's player). */
const COURTESY = 'Fog in this piece is a courtesy. Every copy can see everything.';
/** The still's step: 5 s at 20 Hz. */
const STILL_STEP = 100;
const sees = (player: number | 'none') => (i: number): boolean => player === 'none' || ((seenAt(i, STILL_STEP) >> (player - 1)) & 1) === 1;

describe(`${AC[2]} the courtesy line, a piece played alone, and an export of the recorded match`, () => {
  it(`${AC[2]} the fog piece's Join prompt shows the courtesy line and the paddle piece's doesn't`, async () => {
    const evidence = temp();
    const sight = sightProgram();
    const court = courtProgram();
    putEvidence(evidence, sight.bytes);
    putEvidence(evidence, court.bytes);
    const s = new Script();
    const fog = s.present(DOC.fog, fogDoc(sight));
    const paddle = s.present(COURT_DOC.court, courtDoc(court));
    const fogScope = s.scope();
    const paddleScope = s.add({ call: 'scope', panel: 'side-1' }, 0.2);
    const r = await run(builds.show(), scenario(evidence, [{ id: DOC.fog, size: FOG_SIZE }, { id: COURT_DOC.court, size: FOG_SIZE }], s.calls), 'AC2 the two prompts');
    presented(r[fog], 'AC2 the fog piece');
    presented(r[paddle], 'AC2 the paddle piece');
    const fogPrompt = promptOf(r[fogScope], 'AC2 the fog piece\'s scope');
    const paddlePrompt = promptOf(r[paddleScope], 'AC2 the paddle piece\'s scope');
    expect(fogPrompt, 'AC2: the fog piece, which declares a relay, shows a Join prompt').not.toBeNull();
    expect(paddlePrompt, 'AC2: the paddle piece, which declares a relay, shows a Join prompt').not.toBeNull();
    expect(fogPrompt!.text, `AC2: the fog piece's prompt says the courtesy line: ${fogPrompt!.text}`).toContain(COURTESY);
    expect(paddlePrompt!.text, `AC2: the paddle piece's prompt, whose piece reads no match.me, doesn't say it: ${paddlePrompt!.text}`).not.toContain(COURTESY);
  }, TIMEOUT);

  it(`${AC[2]} the piece played alone draws player 1's side; the recorded match's export draws player 1's fog by default, player 2's when it names player 2, every enemy when it names none`, async () => {
    macOnly();
    const evidence = temp();
    const sight = sightProgram();
    putEvidence(evidence, sight.bytes);
    const outs = { alone: temp(), byDefault: temp(), two: temp(), all: temp() };
    const doc = fogDoc(sight);
    const shown = [{ id: DOC.fog, size: FOG_SIZE }];

    const first = new Script();
    const p1 = first.present(DOC.fog, doc);
    const alone = first.add(exportCall(DOC.fog, outs.alone, FOG_SIZE));
    const m = first.add(matchCall(DOC.fog, 2 * STILL_STEP, { relay: { seed: 552 } }));
    const r1 = await run(builds.show(), scenario(evidence, shown, first.calls), 'AC2 the piece alone, and its match');
    presented(r1[p1], 'AC2 the fog piece');
    const [one] = pairOf(r1[m], 'AC2 the match');
    const record = obj(one.raw['record'], 'AC2: copy 1\'s record');
    expect(record['player'], `AC2: copy 1's record names its own player (README: A copy's report): ${show(record, 400)}`).toBe(1);

    const second = new Script();
    const p2 = second.present(DOC.fog, doc);
    const byDefault = second.add(exportCall(DOC.fog, outs.byDefault, FOG_SIZE, { record }));
    const two = second.add(exportCall(DOC.fog, outs.two, FOG_SIZE, { record, me: 2 }));
    const all = second.add(exportCall(DOC.fog, outs.all, FOG_SIZE, { record, me: 'none' }));
    const r2 = await run(builds.show(), scenario(evidence, shown, second.calls), 'AC2 the recorded match\'s exports');
    presented(r2[p2], 'AC2 the fog piece');

    const judged: [string, JsonObject | undefined, string, number | 'none'][] = [
      ['the piece played alone (match.me 1)', r1[alone], outs.alone, 1],
      ['the recorded match\'s export by default (its record\'s player, 1)', r2[byDefault], outs.byDefault, 1],
      ['the recorded match\'s export naming player 2', r2[two], outs.two, 2],
      ['the recorded match\'s export naming none', r2[all], outs.all, 'none'],
    ];
    none(judged.flatMap(([what, reply, out, side]) => frameFailures(stillOf(reply, out, `AC2 ${what}`), FOG_SIZE, sees(side), `AC2 ${what}`)),
      'each still draws its own side\'s enemies: player 1\'s alone and by default, player 2\'s when named, every enemy for none');
  }, TIMEOUT);
});
