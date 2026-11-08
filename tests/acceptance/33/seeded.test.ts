// #33 AC1 and AC2: the week's exit, end to end. The corpus case covering `seeded-bug` is a seeded bug where the agent
// claims done too early, and its twin is the real fix (README, The corpus). Each is walked through a Claude Code
// session on the shipped hub, through deep-hook (README, Playing a case): the false done's stop is blocked, the
// send-back and the FAIL verdict naming the smallest failing case, the failing assertion's file and line; the fix's
// stop is let through with a PASS line and a PASS verdict.
//
// No wrong program is named for either. The base fails both: it has no corpus.
import { afterEach, describe, it } from 'vitest';
import { AC1, AC2, CORPUS, cleanup, caseFor, decision, expectedOf, must, play, readManifest, replyText, shown, treeOf, verdictLines, verdictText } from './helpers.ts';

afterEach(cleanup, 60_000);

describe(`${AC1} / ${AC2} the seeded false done is blocked, and the real fix passes`, () => {
  it(`${AC1} the seeded false done's stop is sent back with the smallest failing case: the failing assertion's file and line, in the reply and the FAIL verdict`, async () => {
    const m = readManifest();
    const c = caseFor(m, 'seeded-bug', AC1);
    must(expectedOf(c.claim).join() === 'FAIL', `${AC1} the seeded false done is a failing test, so its claim expects FAIL: ${JSON.stringify(c.claim.expected)}`);
    const head = treeOf(CORPUS, c, c.claim.commits[c.claim.commits.length - 1]!);
    const smallest = (c.claim.names ?? []).find((n) => {
      const at = /^(.+):(\d+)$/.exec(n);
      const line = at ? head.get(at[1]!)?.split('\n')[Number(at[2]) - 1] : undefined;
      return line !== undefined && /\b(expect|assert)/.test(line);
    });
    must(smallest !== undefined, `${AC1} the case names its smallest failing case as <file>:<line> of an assertion in its head tree: names ${JSON.stringify(c.claim.names)}`);

    const p = await play(c, 'claim');
    const last = p.stops[p.stops.length - 1]!;
    must(decision(last) === 'deny', `${AC1} the false done's stop is blocked, so the agent keeps working: ${shown(last)}`);
    const reason = replyText(last);
    for (const name of c.claim.names ?? []) must(reason.includes(name), `${AC1} the send-back names ${name}: ${reason.slice(0, 600)}`);
    must(p.verdict !== undefined, `${AC1} the claim's verdict is in the record: task ${p.task ?? 'none'}`);
    must(p.verdict!.data.outcome === 'FAIL', `${AC1} the claim's verdict is FAIL: ${verdictText(p.verdict).slice(0, 600)}`);
    must(verdictText(p.verdict).includes(smallest!), `${AC1} the FAIL names the smallest failing case, ${smallest}: ${verdictText(p.verdict).slice(0, 600)}`);
  }, 600_000);

  it(`${AC2} the real fix's stop is let through: its line says PASS and its verdict is PASS`, async () => {
    const m = readManifest();
    const c = caseFor(m, 'seeded-bug', AC2);
    must(expectedOf(c.twin).join() === 'PASS', `${AC2} the real fix expects PASS: ${JSON.stringify(c.twin.expected)}`);
    const p = await play(c, 'twin');
    const last = p.stops[p.stops.length - 1]!;
    must(decision(last) === 'allow', `${AC2} the real fix's stop is let through: ${shown(last)}`);
    must(verdictLines(last).some((l) => /\bPASS\b/.test(l)), `${AC2} the stop's verdict line says PASS: ${JSON.stringify(verdictLines(last))}; ${shown(last)}`);
    must(p.verdict?.data.outcome === 'PASS', `${AC2} the fix's verdict is PASS: ${verdictText(p.verdict).slice(0, 600) || 'no verdict in the record'}`);
  }, 600_000);
});
