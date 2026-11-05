// #82 AC5 and AC6: the PR you asked for (design: Every stop is judged, "When you asked for a PR, the stop that opens it
// is delivery, not a claim to send back: failing requirements become open items in the PR body under 'Part of', and
// the chat line carries the link").
//
// One hub, two sessions on items whose R1 (expired-token.sh) passes once the agent makes FLAG and whose R2, "A dropped
// connection is retried" (retry.sh), fails on every commit the agent makes, so R2 is still unmet when the PR opens.
//   item 51: you type `Fix <link>, then open a pull request for it.` The agent makes FIX and FLAG and runs
//     `gh pr create … --body "Part of #51"`; the call runs with the input deep-hook's reply gives it (updatedInput), and
//     gh prints the PR's link. If the call is refused, the agent, as an agent does, sends it again with the refusal's
//     words added to the body. Then it stops: "Opened <link> (Part of #51)."
//     AC5: that stop is never sent back (no claim.sent_back for any claim since the PR call), its chat line carries
//     the link, and the PR body gh got lists R2 under its "Part of" line.
//     AC6: the session keeps working on R2 in the same PR with nothing typed: the stop's reply keeps it going, or
//     DeepBuild's waiter (started beside the Stop, as Claude Code's async Stop entry is) wakes it, naming R2.
//   item 52 (AC6's "unless"): your ask says the PR ends the work: `Fix <link>, open a pull request and stop there: the
//     pull request ends the work.` The same steps; that stop is let through and nothing wakes the session.
import { afterAll, describe, it } from 'vitest';
import {
  AC5, AC6, CHECKS, CRITERIA, FIX, FLAG, PR_URL, blocked, chatLine, cleanup, claimsIn, continuation, handles, item, lastPos, listed,
  makeWorld, must, names, prBody, replyText, sendBacksIn, Session, settle, shown, startHub, startOnItem, typedAfter, verdict, type Hub, type Ran, type World,
} from './helpers.ts';

const REQS = [{ text: CRITERIA.expired, check: CHECKS.expired }, { text: CRITERIA.retry, check: CHECKS.retry }];
const ASK = { 51: ', then open a pull request for it.', 52: ', open a pull request and stop there: the pull request ends the work.' } as const;

interface Opened { body: string; command: string; stop: Ran; woke: string | undefined; sentBack: string; typed: string }
const opened: Partial<Record<51 | 52, Opened>> = {};
let w: World;
let hub: Hub;

async function openThePr(n: 51 | 52): Promise<Opened> {
  const s = new Session(w);
  await startOnItem(hub, s, n, `[item ${n}]`, { extra: ASK[n] });
  await s.edit(FIX.file, FIX.from, FIX.to);
  await s.edit(FLAG.file, FLAG.from, FLAG.to);
  const since = await lastPos(hub);
  const gh = (body: string) => `gh pr create --base main --title "Reject expired tokens" --body "${body.replace(/(["\\$`])/g, '\\$1')}"`;
  const effect = () => ({ stdout: `${PR_URL}\n`, stderr: '', interrupted: false, isImage: false });
  let call = await s.bash(gh(`Part of #${n}`), effect);
  if (!call.allowed) call = await s.bash(gh(`Part of #${n}\n\n${replyText(call.before)}`), effect);
  must(call.allowed, `BLOCKED: [item ${n}] the agent's gh pr create saying Part of #${n} must go through: ${shown(call.before)}`);
  const command = String(call.input.command ?? '');
  const r = await s.stopWaiting(`Opened ${PR_URL} (Part of #${n}).`, 60_000);
  const woke = await continuation(r.stop, r.waiter);
  const events = await settle(hub, () => true);
  const backs = sendBacksIn(events, since).filter((e) => handles(claimsIn(events, since)).has(String(e.data.claim)));
  return { body: prBody(command, s.cwd), command, stop: r.stop, woke, sentBack: listed(backs), typed: listed(typedAfter(events, s, since)) };
}

/** Both PRs, opened once on one hub and read by both criteria's tests. */
let setup: Promise<void> | undefined;
const both = (): Promise<void> => (setup ??= (async () => {
  w = makeWorld({ items: [item(51, 'Expired tokens are accepted and connections drop', REQS), item(52, 'Expired tokens are accepted and connections drop', REQS)] });
  hub = await startHub(w);
  opened[51] = await openThePr(51);
  opened[52] = await openThePr(52);
})());
afterAll(cleanup, 60_000);

describe(`${AC5} the stop that opens the PR you asked for is never sent back`, () => {
  it(`${AC5} item 51: R2 failing, the stop after gh pr create isn't sent back, its chat line carries ${PR_URL}, and the PR body lists R2 under "Part of"`, async (ctx) => verdict(ctx, async () => {
    await both();
    const o = opened[51]!;
    must(o.sentBack === 'none', `${AC5} when you asked for a PR, the stop that opens it is never sent back: the record holds ${o.sentBack}`);
    must(chatLine(o.stop).includes(PR_URL), `${AC5} the stop's chat line carries the PR's link ${PR_URL}: ${JSON.stringify(chatLine(o.stop))} (${shown(o.stop)})`);
    const part = o.body.search(/Part of/);
    must(part >= 0, `${AC5} the PR body says Part of: ${JSON.stringify(o.body)} (the call ran \`${o.command.slice(0, 400)}\`)`);
    must(names(o.body.slice(part), 'R2', CRITERIA.retry), `${AC5} R2 ("${CRITERIA.retry}"), the failing requirement, lands in the PR body under "Part of": ${JSON.stringify(o.body.slice(0, 600))}`);
  }), 600_000);
});

describe(`${AC6} after the PR you asked for opens with requirements unmet, the session keeps working on them without you typing`, () => {
  it(`${AC6} item 51: the session is kept going on R2 in the same PR with nothing typed; item 52, whose ask says the PR ends the work, is let stop`, async (ctx) => verdict(ctx, async () => {
    await both();
    const o = opened[51]!;
    must(o.typed === 'none', `BLOCKED: ${AC6} nothing is typed after the PR call: ${o.typed}`);
    must(o.woke !== undefined, `${AC6} after the PR opens with R2 unmet, the session keeps working on it without you typing: the stop was let through (${shown(o.stop)}) and no waiter woke it within 60 s`);
    must(names(o.woke!, 'R2', CRITERIA.retry), `${AC6} what keeps it going names R2 ("${CRITERIA.retry}"), the requirement still unmet: ${o.woke!.slice(0, 500)}`);
    must(o.woke!.includes(PR_URL) || /\b(same|this) (PR|pull request)\b|#12\b|pull\/12\b/i.test(o.woke!), `${AC6} it works on R2 in the same PR, named by its link or as the same pull request: ${o.woke!.slice(0, 500)}`);
    const ends = opened[52]!;
    must(!blocked(ends.stop), `${AC6} item 52: your ask says the PR ends the work, so the stop that opens it is let through: ${shown(ends.stop)}`);
    must(ends.woke === undefined, `${AC6} item 52: nothing wakes the session once the PR that ends the work is open: ${ends.woke?.slice(0, 400)}`);
  }), 600_000);
});
