// #567's live test: the issue's proof, one scripted Claude Code session with a seeded false "done", run by the agent
// test harness (#48) in a pseudo-terminal with DeepBuild's entries as `deep setup` wrote them into the temporary home's
// user settings, against the real hub (README: The live session). It spends plan usage, so it runs only by hand with
// DEEP_HARNESS_LIVE=1; without it, it fails BLOCKED and nothing skips. The check is the fast test's, on what Claude
// Code kept (its transcript and the terminal's screen) and what the record holds. A build without the Stop hold fails
// it: the twin `no-stop-hold` (twins.json) answers the stop at once, so Claude Code ends the turn on the false "done".
import { afterAll, describe, it } from 'vitest';
import { AC1, cleanup, falseDoneProblems, liveExit, liveSeen, loadReading, readLines, redact, writeProof } from './helpers.ts';

afterAll(cleanup, 60_000);

describe(`${AC1} In a Claude Code session, a seeded false "done" is held, sent back, and its verdict line shows in the chat`, () => {
  it(`${AC1} (live) the harness's scripted Claude Code session: its false "done" is held until the spec's unit check ran, sent back naming unit, and its verdict line shows in the chat`, async () => {
    const { hub, line, ran } = await liveExit();
    writeProof('live', 'run.json', JSON.stringify(line, null, 1));
    writeProof('live', 'harness.txt', `${ran.stdout}\n${ran.stderr}`);
    writeProof('live', 'machine.txt', `${process.platform} ${process.arch}, ${loadReading()}\n`);
    if (line.transcript) writeProof('live', 'transcript.jsonl', readLines(line.transcript).map((e) => JSON.stringify(e)).join('\n'));
    if (line.verdict !== 'PASS') throw Error(`${line.verdict === 'INVALID' ? 'INVALID' : 'INCONCLUSIVE'}: ${AC1} the scripted session didn't end its turn with Stop (${line.verdict}): ${redact(String(line.reason ?? ''))}`);
    const { session, seen, chat, events } = await liveSeen(hub, line);
    writeProof('live', 'record.json', JSON.stringify(events.filter((e) => e.session === session || JSON.stringify(e).includes(session)), null, 1));
    writeProof('live', 'false-done.json', JSON.stringify(seen, null, 1));
    falseDoneProblems({ events, session, since: 0, seen, check: 'unit', chat });
  }, 900_000);
});
