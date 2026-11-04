// #1263's fast tests: no Claude Code session and no spend. A made-up Claude Code session runs its hooks through the
// entries `deep setup` wrote into the temporary home's user settings, the real deep-hook and the real hub, with Claude
// Code 2.1.308's timing (README: Readings, 1): a prompt's transcript entry is appended only once its UserPromptSubmit
// hooks have returned, and never for a prompt a hook blocked. AC1's live proof is #669's live file (README: AC1 live);
// AC3 is #669's and #83's suites, run as they are (README: AC3). AC2's automatic clause has no test here (README:
// Readings, 5): shaped as Claude Code sends an automatic prompt, no wrong program could fail it.
import { afterAll, describe, it } from 'vitest';
import {
  AC1, AC2, RECORDED_WITHIN_MS, STATUS_QUESTION, allEvents, answerOf, asksAfter, cleanup, firedShown, judgedSession,
  modelCalled, must, readLines, said, sleep, typedLater, world, writeProof, type Ev, type Fired, type Judged, type Scene,
} from './helpers.ts';

afterAll(cleanup, 60_000);

interface Typed { sc: Scene; j: Judged; since: number; fired: Fired }
let typed: Promise<Typed> | undefined;
/** "all done?" typed after the session's judged stop, with 2.1.308's timing; shared by AC1 and AC2's first test. */
function typedQuestion(): Promise<Typed> {
  typed ??= (async () => {
    const sc = await world();
    const j = await judgedSession(sc);
    const since = (await allEvents(sc.hub)).at(-1)?.log_pos ?? 0;
    const fired = await typedLater(j.claude, j.s, STATUS_QUESTION);
    writeProof('typed-reply.json', JSON.stringify({ claimLine: j.line, stop: JSON.parse(firedShown(j.stopped)), question: JSON.parse(firedShown(fired)) }, null, 1));
    writeProof('typed-transcript.jsonl', readLines(j.s.transcript).map((e) => JSON.stringify(e)).join('\n'));
    return { sc, j, since, fired };
  })();
  return typed;
}

describe(`${AC1} In a real Claude Code session, "all done?" typed after a verdict is answered from the record by DeepBuild's prompt entry, blocking the prompt so no model call is made`, () => {
  it(`${AC1} "${STATUS_QUESTION}" typed after a judged stop, its transcript entry not written when DeepBuild's UserPromptSubmit entry runs (Claude Code 2.1.308 writes it only once the hooks returned), is answered from the record: DeepBuild's entry blocks it with the record's line for the session's claim, and it never reaches the model`, async () => {
    const { j, fired, sc } = await typedQuestion();
    const answer = answerOf(fired);
    must(answer !== undefined, `${AC1} "${STATUS_QUESTION}" typed after a verdict must be answered from the record by DeepBuild's prompt entry, blocking the prompt so no model call is made: its entry's reply didn't block it. ${firedShown(fired)}`);
    must(fired.blocked !== undefined && fired.model === false, `${AC1} the answer must block the prompt, so Claude Code never sends it to the model: ${firedShown(fired)}`);
    must(!modelCalled(sc.w, j.s, STATUS_QUESTION), `${AC1} "${STATUS_QUESTION}" must make no model call: the hook log shows it reaching the model`);
    must(answer.includes(j.line), `${AC1} the answer must come from the record: it carries the record's line for the session's newest claim, ${JSON.stringify(j.line)}: ${JSON.stringify(answer)}`);
    must(answer.includes(j.s.id.slice(0, 8)), `${AC1} the answer must name the session it answers for (${j.s.id.slice(0, 8)}): ${JSON.stringify(answer)}`);
  }, 240_000);
});

describe(`${AC2} The blocked prompt is recorded as yours (user.ask from person), and a status question that came in as an automatic prompt is not answered from the record`, () => {
  it(`${AC2} the blocked "${STATUS_QUESTION}", whose transcript entry Claude Code never writes, is recorded once as yours: one user.ask for it, from person`, async () => {
    const { sc, j, since, fired } = await typedQuestion();
    must(answerOf(fired) !== undefined, `${AC2} "${STATUS_QUESTION}" typed after a verdict must be the blocked prompt (answered from the record by DeepBuild's prompt entry): ${firedShown(fired)}`);
    let asks: Ev[] = [];
    for (const deadline = Date.now() + RECORDED_WITHIN_MS; Date.now() < deadline; await sleep(250)) {
      asks = asksAfter(await allEvents(sc.hub), j.s.id, since).filter((e) => e.data.text === STATUS_QUESTION);
      if (asks.length) break;
    }
    // A late second record of it would also be wrong: read once more after the first shows.
    await sleep(4000);
    const events = await allEvents(sc.hub);
    asks = asksAfter(events, j.s.id, since).filter((e) => e.data.text === STATUS_QUESTION);
    writeProof('typed-record.json', JSON.stringify(events.filter((e) => e.session === j.s.id), null, 1));
    must(asks.length > 0, `${AC2} the blocked prompt must be recorded as yours: no user.ask for "${STATUS_QUESTION}" in session ${j.s.id} within ${RECORDED_WITHIN_MS / 1000} s of its block. The session's record since: ${asksAfter(events, j.s.id, since).map(said).join('; ') || 'no user.ask'}`);
    must(asks.length === 1, `${AC2} the blocked prompt is one prompt, recorded once: ${asks.map(said).join('; ')}`);
    must(asks[0]!.data.from === 'person', `${AC2} the blocked prompt must be recorded as yours (user.ask from person): ${said(asks[0])}`);
    await j.claude.end();
  }, 240_000);
});
