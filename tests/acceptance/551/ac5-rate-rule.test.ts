// AC5 #551.25b0bcea: A two-player 20 Hz match with a 1 Hz economy item and a 120 Hz world passes net.rollback with late
// entries held up to the window, both copies agreeing at every confirmed step; a 7 Hz item in that match is refused at
// check, naming both step lengths; and a planted rule that accepts only faster items refuses the 1 Hz economy, failing
// this criterion
//
// fixtures.ts's economy piece: the paddle piece's court (120 Hz, 6 world steps a match step), the logic item `economy`
// (the rules' program at 1 Hz, one step every 20 match steps) and the net item at 20 Hz, window 8, delay 2, a
// full-state hash at every match step. net.rollback is `match`'s check over the test relay with each frame held back a
// seeded whole number of match steps up to the window. The 7 Hz item is `market` beside them; its step, 100,800,000
// flicks (1/7 s), neither divides the match step's 35,280,000 (1/20 s) nor is a whole multiple of it. The planted rule
// is `net_rate_faster_only`, judged by this criterion's own judge. Wrong programs it fails: the merge base (no rate
// rule; no rollback); a rule that takes only faster items, or every valid rate; a slower item restored to a state its
// last step didn't leave.
import { describe, expect, it } from 'vitest';
import { ECONOMY, MARKET, WINDOW, economyDoc, rally, rulesProgram, stepFlicks, type JsonObject, type JsonValue } from './fixtures.ts';
import { AC, FULL, TIMEOUT, failsNaming, isObject, none, play, sameHashes, show, useBuilds, useChildren, useTemp, world } from './helpers.ts';
import { Script, putEvidence, runShow } from '../549/helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 600;
const plays = rally(2, STEPS, { rate: 20 });

/** The error issues a `deep show` reply holds, and whether it presented the document. */
async function shown(document: JsonObject, what: string, planted?: 'net_rate_faster_only'): Promise<{ presented: boolean; errors: JsonObject[]; reply: JsonObject }> {
  const evidence = temp();
  putEvidence(evidence, rulesProgram().bytes);
  const s = new Script();
  const k = s.present(String(document['id']), document);
  const r = await runShow(builds.show(), world(evidence, [String(document['id'])], s.calls, planted), what);
  const reply = r[k]!;
  const errors = (Array.isArray(reply['issues']) ? reply['issues'] : []).filter(isObject).filter((i) => i['severity'] === 'error');
  return { presented: reply['outcome'] === 'presented' && errors.length === 0, errors, reply };
}
/** An issue names `item` when its path or its IDs hold it. */
const namesItem = (issue: JsonObject, item: string): boolean => JSON.stringify([issue['path'] ?? null, issue['ids'] ?? null] as JsonValue).includes(item);
/** An issue names a step length in flicks, or in seconds to six significant digits. */
const namesLength = (issue: JsonObject, hz: number): boolean => {
  const text = JSON.stringify(issue);
  return text.includes(String(stepFlicks(hz))) || text.includes((1 / hz).toPrecision(6).replace(/0+$/, ''));
};

/** This criterion's judge on the economy piece: shown with no error, and net.rollback passes with both copies agreeing
 * at every confirmed step. */
async function judge(what: string, planted?: 'net_rate_faster_only'): Promise<string[]> {
  const document = economyDoc();
  const s = await shown(document, `${what}: the economy piece`, planted);
  if (!s.presented) return [`${what}: the economy piece is refused at check: ${show(s.errors.length ? s.errors : s.reply, 1200)}`];
  const r = await play(builds.show(), temp(), `${what}: net.rollback`, { document, steps: STEPS, plays, relay: { seed: 551, back: { up_to: WINDOW } }, check: 'net.rollback', ...(planted ? { planted } : {}) });
  const f: string[] = [];
  if (r.check!.verdict !== 'PASS' || r.check!.failures.length) f.push(`${what}: net.rollback gives ${r.check!.verdict}: ${show(r.check!.raw, 800)}`);
  for (const c of r.copies) if (c.rollbacks === 0) f.push(`${what}: copy ${c.player} never rolled back, so nothing came late`);
  f.push(...sameHashes(r.copies[0]!, r.copies[1]!, `${what}: copy 1 and copy 2`, STEPS - 3 * WINDOW));
  return f;
}

describe(`${AC[5]} the rate rule: a 1 Hz economy and a 120 Hz world in a 20 Hz match`, () => {
  it(`${AC[5]} the 20 Hz match with a 1 Hz economy item and a 120 Hz world passes net.rollback with late entries held up to the window, both copies agreeing at every confirmed step`, async () => {
    none(await judge('AC5'),'the economy piece in a 20 Hz match under held-back entries');
  }, TIMEOUT);

  it(`${AC[5]} a 7 Hz item in that match is refused at check, naming both step lengths`, async () => {
    const s = await shown(economyDoc({ seven: true }), 'AC5 the 7 Hz item');
    expect(s.presented, `the match with a 7 Hz item isn't presented: ${show(s.reply, 1200)}`).toBe(false);
    const named = s.errors.filter((i) => namesItem(i, MARKET) && namesLength(i, 7) && namesLength(i, 20));
    expect(named.length, `an error issue names the item ${MARKET} and both step lengths, ${stepFlicks(7)} and ${stepFlicks(20)} flicks (1/7 s and 1/20 s): ${show(s.errors, 1500)}`).toBeGreaterThan(0);
    expect(s.errors.filter((i) => namesItem(i, ECONOMY)), `no issue names the 1 Hz economy, whose step is a whole multiple of the match step: ${show(s.errors, 1200)}`).toEqual([]);
  }, TIMEOUT);

  it(`${AC[5]} a planted rule that accepts only faster items refuses the 1 Hz economy, failing this criterion`, async () => {
    failsNaming(await judge('AC5 planted', 'net_rate_faster_only'), [/refused at check/, new RegExp(ECONOMY)], 'the rule that accepts only faster items');
  }, TIMEOUT);
});
