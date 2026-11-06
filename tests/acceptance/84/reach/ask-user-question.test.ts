// #84 ASK_USER: Claude Code's AskUserQuestion, caught at PreToolUse and sorted like a question at a stop (design:
// Questions at the stop: "one a decision covers is answered there with the chosen option, so the agent gets an answer
// rather than a blocked call").
//
// One session on item 901:
//   - its first AskUserQuestion, naming R1 and two options, no decision covering it: a choice that reaches you, and your
//     answer, the option that isn't recommended, is saved as a decision for the repo;
//   - the same choice in other words: a saved decision matches by kind and scope, never by wording, so the call goes
//     through with `allow`, its input the original questions and an `answers` map naming your option;
//   - a near miss, one option changed: no decision covers it, so its call isn't answered from yours;
//   - an in-scope offer, "want me to run the tests?": sorted as at a stop, a proceed that never reaches you.
import { isDeepStrictEqual } from 'node:util';
import { afterAll, afterEach, describe, it } from 'vitest';
import {
  ASK_USER, EXPIRED, STORE, answered, asked, asksOf, cleanup, decision, item, lastPos, listed, makeWorld, must, needsYou, optionMatching, parseObject, said, Session, settle, shown,
  startHub, startOnItem, verdict,
} from './helpers.ts';

afterEach(cleanup, 60_000);
afterAll(cleanup, 60_000);

const OPTIONS = ['Cookie store (Recommended)', 'Header store'];

describe(`${ASK_USER} an AskUserQuestion call is caught at PreToolUse and sorted like a question at a stop; one a saved decision covers never reaches you, and the tool result carries the decided option, through allow with the original questions and an answers map, never a blocked call`, () => {
  it(`${ASK_USER} item 901: your answer to the first call answers its paraphrase through allow with an answers map; a near miss isn't answered from it; an in-scope offer is a proceed`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld({ items: [item(901, [STORE, EXPIRED])] });
    const hub = await startHub(w);
    const s = new Session(w);
    await startOnItem(hub, s, 901, ASK_USER);
    await s.bump();

    // Sorted like a question at a stop: it reaches you as a choice, and your answer is saved.
    const since = await lastPos(hub);
    const first = await s.call('AskUserQuestion', { questions: [asked('Which session store should R1 use?', 'R1 store', OPTIONS)] });
    let events = await settle(hub, (all) => asksOf(all, s, since).some((a) => a.data.kind === 'choice'));
    const ask = asksOf(events, s, since).find((a) => a.data.kind === 'choice');
    must(ask !== undefined, `${ASK_USER} the call is caught at PreToolUse and sorted: a choice between two options that names R1 is a choice ask: ${listed(asksOf(events, s, since))}; the call: ${shown(first.before)}`);
    const header = optionMatching(ask, /header/i);
    must(header !== undefined, `${ASK_USER} the choice offers the header store: ${said(ask)}`);
    await answered(w, ask, header.id, ASK_USER);
    events = await settle(hub, (all) => all.some((e) => e.kind === 'decision.created' && e.subject === `ask:${ask.id}`));
    must(events.some((e) => e.kind === 'decision.created' && e.subject === `ask:${ask.id}`), `BLOCKED: ${ASK_USER} your answer is saved as a decision for the repo: ${listed(events.filter((e) => e.kind.startsWith('decision.')))}`);

    // A saved decision covers it, whatever the wording.
    const covered = asked('For R1, where should sessions be kept?', 'R1 store', OPTIONS);
    const openBefore = (await needsYou(hub)).length;
    const sinceCovered = await lastPos(hub);
    const again = await s.call('AskUserQuestion', { questions: [covered] });
    const out = parseObject(again.before.stdout.trim())?.hookSpecificOutput;
    must(decision(again.before) === 'allow' && again.before.code === 0 && out?.permissionDecision === 'allow', `${ASK_USER} a covered call is never blocked: PreToolUse answers allow: ${shown(again.before)}`);
    must(isDeepStrictEqual(out?.updatedInput?.questions, [covered]), `${ASK_USER} the call keeps its original questions: ${JSON.stringify(out?.updatedInput).slice(0, 500)}`);
    must(out?.updatedInput?.answers?.[covered.question] === 'Header store', `${ASK_USER} the agent's tool result carries the decided option: updatedInput.answers maps the question to "Header store": ${JSON.stringify(out?.updatedInput?.answers)}`);
    must((await needsYou(hub)).length === openBefore, `${ASK_USER} a covered question never reaches you: ${JSON.stringify((await needsYou(hub))).slice(0, 400)}; ${listed(asksOf(await settle(hub, () => true), s, sinceCovered))}`);

    // The near miss: one option changed, so its key differs, and a hub that answers from the requirement alone fails here.
    const miss = await s.call('AskUserQuestion', { questions: [asked('For R1, where should sessions be kept?', 'R1 store', ['Cookie store (Recommended)', 'Redis store'])] });
    const missed = parseObject(miss.before.stdout.trim())?.hookSpecificOutput?.updatedInput?.answers as Record<string, string> | undefined;
    must(!JSON.stringify(missed ?? {}).includes('Header store'), `${ASK_USER} a near miss, one option changed, isn't answered from your decision: ${shown(miss.before)}`);

    // Sorted like a question at a stop: an in-scope offer is a proceed, recorded, and no ask.
    const sinceOffer = await lastPos(hub);
    await s.call('AskUserQuestion', { questions: [asked('Want me to run the tests?', 'Tests', ['Yes', 'No'])] });
    const proceeded = await settle(hub, (all) => all.some((e) => e.kind === 'question.proceeded' && e.log_pos > sinceOffer));
    must(proceeded.some((e) => e.kind === 'question.proceeded' && e.log_pos > sinceOffer && String(e.data.question).includes('run the tests')), `${ASK_USER} an in-scope offer is sorted as at a stop, a recorded proceed: ${listed(proceeded.filter((e) => e.log_pos > sinceOffer))}`);
    must(asksOf(proceeded, s, sinceOffer).length === 0, `${ASK_USER} a proceed never reaches you: ${listed(asksOf(proceeded, s, sinceOffer))}`);
  }), 600_000);
});
