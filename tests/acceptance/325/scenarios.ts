// The worlds and the flows the tests drive (README, The worlds). Each flow runs on a hub of its own, `plant` naming
// the wrong program for a wrong-program test, and throws an Error naming its criterion at the first reading that
// doesn't hold, so a test runs it once and a wrong-program test reads its message (failureOf).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  CHECKS, FIX, FLAG, ITEM, SPEC, Session, answered, asksRaised, claimsOf, draftFor, git, inbox,
  lastPos, listed, makeWorld, must, openAsks, optionMatching, receipt, replyText, runOf, runsOf, said, sentBack, settle, shown,
  stallDecisions, startHub, startOnItem, stopsOf, workItem, type Ev, type Hub, type Line, type PaidKind, type Ran, type World,
} from './helpers.ts';

// ---- Budgets (AC1, AC2): three paid checks, one of each kind of spend, priced $4, $3 and $5: $12.00 in all.
export const PAID: { text: string; check: { file: string; assertion: string }; paid: PaidKind; price: number; cost: number }[] = [
  { text: 'A live price quote is given for a valid token', check: CHECKS.live, paid: 'live call', price: 4, cost: 3.5 },
  { text: 'The hosted checkout accepts a valid token', check: CHECKS.hosted, paid: 'hosted browser run', price: 3, cost: 2.25 },
  { text: 'The model review accepts a valid token', check: CHECKS.model, paid: 'model job', price: 5, cost: 4.75 },
];
export const TOTAL = '$12.00';
const dollars = (usd: number) => `$${usd.toFixed(2)}`;

export interface Budgeted { w: World; hub: Hub; s: Session; ref: string; ask: Ev | undefined; asks: Ev[]; approved: Ev[]; since: number }
/**
 * Item n with three paid requirements, each guarding behavior that must not change, so no base run spends anything.
 * The session starts on it; the asks raised by the time its definition locks and settles are read; the budget ask, if
 * one names the total, is answered yes; and the ledger's entries after that answer are read.
 */
export async function budgetAsked(n: number, who: string): Promise<Budgeted> {
  const w = makeWorld({
    drafts: [draftFor(n, PAID.map((p) => ({ text: p.text, check: p.check, on_base: 'passes' as const, paid: p.paid })))],
    readings: [workItem(n, 'Paid checks guard valid tokens', PAID.map((p) => p.text))],
    prices: { prices: Object.fromEntries(PAID.map((p) => [p.check.file, p.price])), costs: Object.fromEntries(PAID.map((p) => [p.check.file, p.cost])) },
  });
  const hub = await startHub(w);
  const s = new Session(w);
  const ref = await startOnItem(hub, s, n, who);
  let events = await settle(hub, (all) => asksRaised(all, 0).length > 0, 20_000);
  const asks = asksRaised(events, 0);
  const ask = asks.find((a) => JSON.stringify(a.data).includes(TOTAL) || /\$?12(\.00)?\b/.test(String(a.data.question ?? '')));
  const since = await lastPos(hub);
  let approved: Ev[] = [];
  if (ask) {
    const yes = optionMatching(ask, /allow|approve|yes|fund|accept/i) ?? (typeof ask.data.recommended === 'string' ? ask.data.recommended : undefined);
    must(yes !== undefined, `${who} the budget ask must offer a yes (allow, approve or fund): ${said(ask)}`);
    await answered(w, ask, yes, who);
    events = await settle(hub, (all) => all.some((e) => e.kind === 'spend.approved' && e.log_pos > since), 20_000);
    approved = events.filter((e) => e.kind === 'spend.approved' && e.log_pos > since);
  }
  return { w, hub, s, ref, ask, asks, approved, since };
}
/** The agent's fix, and its stop: the claim runs the three paid checks. Returns the events once each has finished, or 90 s on. */
export async function paidRuns(b: Budgeted): Promise<{ events: Ev[]; since: number; stop: Ran }> {
  await b.s.edit(FIX.file, FIX.from, FIX.to);
  const since = await lastPos(b.hub);
  const stop = await b.s.stop('checkToken rejects expired tokens now; the paid checks should pass.');
  const done = (all: Ev[]) => PAID.every((p) => runsOf(all, b.ref, since).some((r) => runOf(p.check.file)(r) && r.finished !== undefined));
  const events = await settle(b.hub, (all) => done(all) && all.filter((e) => e.kind === 'spend.charged' && e.log_pos > since).length >= PAID.length, 90_000);
  return { events, since, stop };
}
/** Whether the receipt lists `usd` as the spend of `check`: on that check's entry, or in its piece of the receipt's lines. */
export function spendShown(change: Line, check: string, usd: number): boolean {
  const name = basename(check);
  const entries = (Array.isArray(change.checks) ? change.checks : []) as Line[];
  if (entries.some((c) => String(c.check ?? '').includes(name) && Object.entries(c).some(([k, v]) => /spen|usd|cost|charg/i.test(k) && (Number(v) === usd || String(v).includes(dollars(usd)))))) return true;
  const text = [change.second, change.line].filter((x) => typeof x === 'string').join(' · ');
  return text.split(/ · |, |\n/).some((piece) => piece.includes(name) && piece.includes(dollars(usd)));
}
/** The receipt of the task's newest claim after `since` that `changes.read` knows. */
export async function newestReceipt(hub: Hub, events: Ev[], ref: string, since: number): Promise<{ claim: string; change: Line } | undefined> {
  for (const c of claimsOf(events, ref, since).reverse()) {
    try { return { claim: `claim:${c.id}`, change: await receipt(hub, `claim:${c.id}`) }; } catch { /* not this one */ }
  }
  return undefined;
}

// ---- Stalled claims (AC3, AC4, AC8, AC9).
export const CRITERIA = { expired: 'An expired token is rejected with 401', retry: 'A dropped connection is retried', audit: 'Each rejected token is logged' } as const;
/** Item n: R1 judged by expired-token.sh (passes after FLAG), then a requirement per extra check, each failing whatever the agent does. */
export function stallWorld(n: number, extra: ('retry' | 'audit')[]): World {
  const reqs = [{ text: CRITERIA.expired, check: CHECKS.expired }, ...extra.map((k) => ({ text: CRITERIA[k], check: CHECKS[k] }))];
  return makeWorld({ drafts: [draftFor(n, reqs)], readings: [workItem(n, 'Expired tokens are accepted and connections drop', reqs.map((r) => r.text))] });
}
/** One round's work: the `note` line of src/auth.js goes up by one, so the snapshot changes and the checks run again with the same results. */
export async function bump(s: Session): Promise<void> {
  const n = Number(/note: (\d+),/.exec(readFileSync(join(s.cwd, 'src/auth.js'), 'utf8'))?.[1] ?? NaN);
  must(Number.isInteger(n), 'BLOCKED: src/auth.js keeps its note line');
  await s.edit('src/auth.js', `note: ${n},`, `note: ${n + 1},`);
}
/** A stall decision's handle in the inbox, if it shows there. */
export const inInbox = async (hub: Hub, ask: Ev): Promise<boolean> => (await inbox(hub)).some((a) => a.ask === `ask:${ask.id}`);

/** AC3's stops: the same words, the same open items, each time. */
export const SAME_OPEN = `Expired tokens are rejected now.\n\nStill open:\n- ${CRITERIA.retry}\n- ${CRITERIA.audit}`;
export interface Stalled { w: World; hub: Hub; s: Session; ref: string; since: number; decision: Ev }
/**
 * Item n (R1 passes after FLAG; R2 and R3 fail on every commit). The agent fixes R1 and stops, reporting R2 and R3 as
 * still open; it is sent back. It does another round's work and stops with the same open items; if that stop is sent
 * back, it works a third round and stops the same way, which must not be sent back. One decision with split, fund and
 * accept then reaches the inbox.
 */
export async function stallToDecision(n: number, who: string): Promise<Stalled> {
  const w = stallWorld(n, ['retry', 'audit']);
  const hub = await startHub(w);
  const s = new Session(w);
  const ref = await startOnItem(hub, s, n, who);
  await s.edit(FIX.file, FIX.from, FIX.to);
  await s.edit(FLAG.file, FLAG.from, FLAG.to);
  const since = await lastPos(hub);
  const first = await s.stop(SAME_OPEN);
  must(sentBack(first), `${who} the first stop, R2's and R3's checks failing, is sent back (the control): deep-hook let it through: ${shown(first)}`);
  await bump(s);
  const second = await s.stop(SAME_OPEN);
  if (sentBack(second)) {
    await bump(s);
    const third = await s.stop(SAME_OPEN);
    must(!sentBack(third), `${who} the agent reported the same open items (R2, R3) on two stops in a row with no new passing evidence, so it is not sent back a third time for them; the third stop was: ${replyText(third).slice(0, 500)}`);
  }
  const events = await settle(hub, (all) => stallDecisions(all, since).length > 0, 20_000);
  const decisions = stallDecisions(events, since);
  must(decisions.length === 1, `${who} one decision with split, fund and accept is raised for the stalled claim; asks raised since the first stop: ${listed(asksRaised(events, since))}`);
  must(await inInbox(hub, decisions[0]!), `${who} the decision ask:${decisions[0]!.id} reaches the inbox (inbox.read): ${JSON.stringify(await inbox(hub)).slice(0, 800)}`);
  return { w, hub, s, ref, since, decision: decisions[0]! };
}

/** The agent's PR call (README, Closes or Part of): `gh pr create` with a body saying `Closes #n` or `Part of #n`; when allowed, gh prints the PR's link. */
export const prCreate = (body: string) => `gh pr create --base main --title "Reject expired tokens" --body "${body}"`;
export const PR_URL = 'https://github.com/acme/shop/pull/12';
export const openPr = (s: Session, body: string) => s.bash(prCreate(body), () => ({ stdout: `${PR_URL}\n`, stderr: '', interrupted: false, isImage: false }));

/**
 * AC8's agent: every stop reports other open items, and between stops it reruns R2's failing check itself and works a
 * round, so the gate runs the check again with the same result. The first three stops are sent back and the fourth
 * isn't; one decision with split, fund and accept then reaches the inbox, raised after the third send-back.
 */
export const OTHER_OPEN = ['a 100 ms backoff', 'a 200 ms backoff with jitter', 'the connection pool', 'a fresh socket'];
export async function rerunToDecision(n: number, who: string, plant?: string): Promise<void> {
  const w = stallWorld(n, ['retry']);
  const hub = await startHub(w, { plant });
  const s = new Session(w);
  const ref = await startOnItem(hub, s, n, who);
  await s.edit(FIX.file, FIX.from, FIX.to);
  await s.edit(FLAG.file, FLAG.from, FLAG.to);
  const since = await lastPos(hub);
  let third = 0;
  for (let round = 1; round <= 4; round++) {
    if (round > 1) await bump(s);
    // The agent reruns the failing check itself: its exit is 1 every time.
    await s.bash(`sh ${CHECKS.retry.file}`, () => {
      try { execFileSync('sh', [CHECKS.retry.file], { cwd: w.repo, stdio: 'pipe' }); return { stdout: '', stderr: '', exitCode: 0, interrupted: false, isImage: false }; } catch (e) {
        return { stdout: '', stderr: String((e as { stderr?: Buffer }).stderr ?? ''), exitCode: (e as { status?: number }).status ?? 1, interrupted: false, isImage: false };
      }
    });
    const stop = await s.stop(`Tried ${OTHER_OPEN[round - 1]}; the retry check still fails.\n\nStill open:\n- ${CRITERIA.retry}, with ${OTHER_OPEN[round - 1]}`);
    if (round <= 3) must(sentBack(stop), `${who} stop ${round}, R2's check failing as before, is sent back (send-back ${round} of 3): deep-hook let it through: ${shown(stop)}`);
    else must(!sentBack(stop), `${who} the fourth stop must not be sent back: three send-backs without new evidence (the same failing check, run again with the same result, is no new evidence), so the claim goes to you as one decision; it was sent back a fourth time: ${replyText(stop).slice(0, 500)}`);
    if (round === 3) third = (await lastPos(hub));
  }
  const events = await settle(hub, (all) => stallDecisions(all, since).length > 0, 20_000);
  const decisions = stallDecisions(events, since);
  must(decisions.length === 1, `${who} one decision with split, fund and accept reaches the inbox after the three send-backs; asks raised since the first stop: ${listed(asksRaised(events, since))}`);
  must(decisions[0]!.log_pos > third, `${who} the decision comes after the third send-back, not before: ${said(decisions[0])}, the third stop's reply at log_pos ${third}`);
  must(await inInbox(hub, decisions[0]!), `${who} the decision ask:${decisions[0]!.id} reaches the inbox (inbox.read): ${JSON.stringify(await inbox(hub)).slice(0, 800)}`);
  must(claimsOf(events, ref, since).length >= 4, `${who} each of the four stops made a claim for ${ref}: ${listed(claimsOf(events, ref, since))}`);
}

/** AC9's stops: the same failing check and the same open items each time. */
export const WAIT_OPEN = `Waiting for you to sign in to the staging account.\n\nStill open:\n- ${CRITERIA.retry}`;
export const UNBLOCK = {
  kind: 'unblock', question: 'Sign in to the staging account in your own terminal',
  steps: ['Run `staging login` in your own terminal'], where: 'your own terminal', why: "R2's retry check needs the staging sign-in", check: 'unit',
};
/**
 * AC9: item n (R1 passes after FLAG; R2 fails on every commit). The agent raises a step only you can take through
 * deep_ask (an unblock task, proved by the spec's unit check) and stops twice with R2 failing and the same open items:
 * neither stop is sent back and no decision is raised while the ask is open. You answer; once your answer is
 * delivered, the next stop is sent back as round 1 of 3, and the decision comes only from stops after it.
 */
export async function waitingThenAnswer(n: number, who: string, plant?: string): Promise<void> {
  const w = stallWorld(n, ['retry']);
  const hub = await startHub(w, { plant });
  const s = new Session(w);
  await startOnItem(hub, s, n, who);
  await s.edit(FIX.file, FIX.from, FIX.to);
  await s.edit(FLAG.file, FLAG.from, FLAG.to);
  const since = await lastPos(hub);
  const asked = await s.deepAsk(UNBLOCK);
  must(asked.allowed, `BLOCKED: ${who} the agent's deep_ask must be allowed: ${shown(asked.before)}`);
  let events = await settle(hub, (all) => asksRaised(all, since).some((e) => e.data.kind === 'unblock'), 20_000);
  const unblock = asksRaised(events, since).find((e) => e.data.kind === 'unblock');
  must(unblock !== undefined, `BLOCKED: ${who} the agent's deep_ask raises a task only you can take: ${listed(asksRaised(events, since))}; deep_ask said ${JSON.stringify(asked.value).slice(0, 400)}`);

  // Two stops that did work while the task is open, R2 failing and the same open items on each.
  const w1 = await s.stop(WAIT_OPEN);
  must(!sentBack(w1), `${who} a stop while a step only you can take is open (ask:${unblock!.id}) is not sent back, R2's check failing: ${replyText(w1).slice(0, 500)}`);
  await s.typed('Is the retry check still failing?');
  await bump(s);
  const w2 = await s.stop(WAIT_OPEN);
  must(!sentBack(w2), `${who} the second stop while ask:${unblock!.id} is open is not sent back either: ${replyText(w2).slice(0, 500)}`);
  events = await settle(hub, (all) => stallDecisions(all, since).length > 0, 5_000);
  must(openAsks(events).has(`ask:${unblock!.id}`), `BLOCKED: ${who} ask:${unblock!.id} must still be open before your answer`);
  must(stallDecisions(events, since).length === 0, `${who} stops made while the step only you can take is open count toward neither limit, so no decision is raised while ask:${unblock!.id} is still open: ${listed(stallDecisions(events, since))}`);

  // Your answer, then the first stop after it is delivered.
  await answered(w, unblock!, optionMatching(unblock!, /done|did/i) ?? 'done', who);
  await s.typed('Did the sign-in go through?');
  let next: Ran | undefined;
  let nextPos = 0;
  for (let round = 2; round <= 4 && next === undefined; round++) {
    await bump(s);
    const stop = await s.stop(WAIT_OPEN);
    events = await settle(hub, () => true);
    const at = stopsOf(events, s).at(-1)?.log_pos ?? 0;
    // The hub records an answer delivered when it reads the session's transcript showing it, at a hook after the one
    // that handed it, so the first stop whose reply finds it recorded is the first stop after your answer was delivered.
    const delivered = events.some((e) => e.kind === 'delivery.outcome' && e.data.outcome === 'delivered' && e.data.delivery === `ask:${unblock!.id}`);
    if (delivered) { next = stop; nextPos = at; break; }
    if (!sentBack(stop)) await s.typed('Did the sign-in go through?');
  }
  must(next !== undefined, `${who} your answer to ask:${unblock!.id} is delivered to the session: no delivery.outcome delivered before its next three stops: ${listed(events.filter((e) => e.kind === 'delivery.outcome'))}`);
  must(sentBack(next!), `${who} the first stop after your answer is delivered is sent back, R2's check failing: ${shown(next!)}`);
  must(/\b1\s*(?:\/|of)\s*3\b/.test(replyText(next!)), `${who} the first stop after your answer is delivered is sent back as round 1 of 3 (the stops while the ask was open counted toward neither limit): ${replyText(next!).slice(0, 600)}`);

  // The decision comes only from stops after it.
  let last = next!;
  for (let round = 5; round <= 8 && sentBack(last); round++) {
    await bump(s);
    last = await s.stop(WAIT_OPEN);
  }
  events = await settle(hub, (all) => stallDecisions(all, since).length > 0, 20_000);
  const decisions = stallDecisions(events, since);
  must(decisions.length === 1, `${who} the stalled claim reaches the inbox as one decision once the stops after your answer stall: ${listed(asksRaised(events, since))}`);
  must(decisions[0]!.log_pos > nextPos, `${who} the decision comes only from stops after the first one after your answer (log_pos ${nextPos}): ${said(decisions[0])}`);
}

// ---- Release checks on a PR (AC5).
/** The repo's spec with its release checks: the local preflight, a node:test suite the hermetic runner counts. */
export const RELEASE_SPEC = `${SPEC.replace('checks:\n  unit', 'release:\n  checks: [preflight]\nchecks:\n  unit')}  preflight: { type: command, run: "node --test tests/release.test.js", min_tests: 1 }\n`;
/** The local preflight's test: a code base that is strict about tokens (src/limits.js, only on main) never allows legacy tokens. */
export const RELEASE_TEST = "const test = require('node:test');\nconst assert = require('node:assert');\ntest('a strict code base never allows legacy tokens', () => {\n  let strict = false;\n  try { strict = require('../src/limits.js').strict === true; } catch { strict = false; }\n  if (strict) assert.strictEqual(require('../src/auth.js').allowsLegacy, false);\n});\n";
export const LEGACY = { file: 'src/auth.js', from: 'allowsLegacy: false', to: 'allowsLegacy: true' } as const;
/**
 * Item n (R1 passes after FLAG), on branch `fix` cut from the base, while main has moved on with src/limits.js. The
 * agent fixes R1, allows legacy tokens and stops green; asked for the PR, it commits, its `gh pr create` saying Closes
 * is refused naming Part of while the release check is still to run, the one saying Part of is allowed, and it stops.
 * The release check `preflight` passes on the PR's head alone and on main alone, and fails only on the head merged
 * with main: its run there fails, and the claim's verdict is FAIL naming it.
 */
export async function releaseOnMerge(n: number, who: string): Promise<void> {
  const w = makeWorld({
    spec: RELEASE_SPEC, files: { 'tests/release.test.js': RELEASE_TEST }, mainAhead: { 'src/limits.js': 'module.exports = { strict: true };\n' },
    drafts: [draftFor(n, [{ text: CRITERIA.expired, check: CHECKS.expired }])], readings: [workItem(n, 'Expired tokens are accepted', [CRITERIA.expired])],
  });
  const hub = await startHub(w);
  const s = new Session(w);
  const ref = await startOnItem(hub, s, n, who);
  await s.edit(FIX.file, FIX.from, FIX.to);
  await s.edit(FLAG.file, FLAG.from, FLAG.to);
  await s.edit(LEGACY.file, LEGACY.from, LEGACY.to);
  const green = await s.stop('Expired tokens are rejected, and legacy tokens are allowed again.');
  must(!sentBack(green), `BLOCKED: ${who} the fix's stop is green (R1 and unit pass on the branch): ${replyText(green).slice(0, 500)}`);

  await s.typed('Can you open the pull request now?');
  const commit = await s.bash('git commit -qam "Reject expired tokens"', () => { git(w.tmp, w.repo, ['commit', '-qam', 'Reject expired tokens']); });
  must(commit.allowed, `BLOCKED: ${who} the agent's git commit must be allowed: ${shown(commit.before)}`);
  const head = w.head();
  must(head !== w.base && head !== w.main, `BLOCKED: ${who} the branch has a commit of its own`);

  const closes = await openPr(s, `Closes #${n}`);
  must(!closes.allowed, `${who} while the release check preflight is still to run on the PR's merge with main, the PR says Part of, never Closes: \`${prCreate(`Closes #${n}`)}\` must be refused; deep-hook allowed it: ${shown(closes.before)}`);
  const reason = replyText(closes.before);
  must(/\bPart of\b/.test(reason) && /preflight|release/i.test(reason), `${who} the refusal names Part of and the release check (preflight) it waits for: ${reason.slice(0, 500)}`);
  const partOf = await openPr(s, `Part of #${n}`);
  must(partOf.allowed, `${who} the same call saying Part of #${n} is allowed: ${shown(partOf.before)}`);
  const since = await lastPos(hub);
  await s.stop(`Opened ${PR_URL} (Part of #${n}).`);

  const preflightRuns = (all: Ev[]) => all.filter((e) => e.kind === 'run.started' && e.log_pos > since && runOf('preflight')({ started: e }))
    .map((started) => ({ started, finished: all.find((e) => e.kind === 'run.finished' && e.data.run === started.data.run) }));
  let events = await settle(hub, (all) => preflightRuns(all).some((r) => r.finished !== undefined && r.finished.data.outcome === 'failed'), 150_000);
  const runs = preflightRuns(events);
  must(runs.length > 0, `${who} a claim on the PR runs the repo's release check preflight: no run of it after the PR's stop; runs: ${listed(events.filter((e) => e.kind === 'run.started' && e.log_pos > since))}`);
  const failed = runs.find((r) => r.finished?.data.outcome === 'failed');
  must(failed !== undefined, `${who} preflight runs on the PR's commit merged with main, where it fails (it passes on the head alone and on main alone): its runs ended ${runs.map((r) => `${String(r.started.data.commit)} ${String(r.finished?.data.outcome ?? 'running')}`).join(', ')}`);
  must(![head, w.main].includes(String(failed!.started.data.commit)), `${who} the failing run of preflight is on the merge of the PR's head ${head} with main ${w.main}, not on either alone: ${said(failed!.started)}`);
  events = await settle(hub, (all) => all.some((e) => e.kind === 'verdict.made' && e.log_pos > since && e.data.outcome === 'FAIL' && JSON.stringify(e.data).includes('preflight')), 60_000);
  const fail = events.find((e) => e.kind === 'verdict.made' && e.log_pos > since && e.data.outcome === 'FAIL' && JSON.stringify(e.data).includes('preflight'));
  must(fail !== undefined, `${who} a failure of a release check on the merge is FAIL: the PR's claim's verdict must be FAIL naming preflight: ${listed(events.filter((e) => e.kind === 'verdict.made' && e.log_pos > since))}`);
  must(claimsOf(events, ref).length > 0, `${who} the claims are the task's (${ref})`);
}

// ---- Changes behind a switch (AC6).
/** The spec with its switches: the file that lists them, and the deployed configuration with each one's value where it runs. */
export const SWITCH_SPEC = `${SPEC}switches:\n  file: config/flags.json\n  deployed: config/deployed.json\n`;
export const FLAGS_BASE = '{\n  "legacy_mode": false\n}\n';
/** Deployed: legacy_mode on (not this change's), reject_expired off, fast_path on, audit_log unset. */
export const DEPLOYED = '{\n  "legacy_mode": true,\n  "reject_expired": false,\n  "fast_path": true\n}\n';
export const OFF = ['reject_expired', 'audit_log'] as const;
export const ON = 'fast_path';
/**
 * Item n (R1 passes after FLAG). The change ships three switches in config/flags.json: reject_expired (off where it's
 * deployed), audit_log (unset there) and fast_path (on). The PR saying Closes is refused naming Part of and the two
 * switches that aren't on, never fast_path; you decide each stays off; the PR may then say Closes, and each decision
 * is saved with the follow-up it needs.
 */
export async function behindSwitches(n: number, who: string): Promise<void> {
  const w = makeWorld({
    spec: SWITCH_SPEC, files: { 'config/flags.json': FLAGS_BASE, 'config/deployed.json': DEPLOYED },
    drafts: [draftFor(n, [{ text: CRITERIA.expired, check: CHECKS.expired }])], readings: [workItem(n, 'Expired tokens are accepted', [CRITERIA.expired])],
  });
  const hub = await startHub(w);
  const s = new Session(w);
  await startOnItem(hub, s, n, who);
  await s.edit(FIX.file, FIX.from, FIX.to);
  await s.edit(FLAG.file, FLAG.from, FLAG.to);
  await s.edit('config/flags.json', '"legacy_mode": false', '"legacy_mode": false,\n  "reject_expired": false,\n  "audit_log": false,\n  "fast_path": false');
  const since = await lastPos(hub);
  const green = await s.stop('Expired tokens are rejected behind reject_expired; audit_log and fast_path ship with it.');
  must(!sentBack(green), `BLOCKED: ${who} the fix's stop is green (R1 and unit pass): ${replyText(green).slice(0, 500)}`);
  await s.typed('Can you open the pull request now?');

  const closes = await openPr(s, `Closes #${n}`);
  must(!closes.allowed, `${who} the change ships behind reject_expired (off where it's deployed) and audit_log (unset there), so the PR can't say Closes until you decide they stay off: \`${prCreate(`Closes #${n}`)}\` must be refused; deep-hook allowed it: ${shown(closes.before)}`);
  const reason = replyText(closes.before);
  must(/\bPart of\b/.test(reason), `${who} the refusal names Part of: ${reason.slice(0, 500)}`);
  for (const name of OFF) must(reason.includes(name), `${who} the refusal names the switch ${name} that isn't on where it's deployed: ${reason.slice(0, 500)}`);
  must(!reason.includes(ON), `${who} the refusal never names ${ON}, which is on where it's deployed: ${reason.slice(0, 500)}`);

  const naming = (all: Ev[], name: string) => asksRaised(all, since).filter((a) => JSON.stringify(a.data).includes(name));
  let events = await settle(hub, (all) => OFF.every((name) => naming(all, name).length > 0), 20_000);
  for (const name of OFF) must(naming(events, name).length > 0, `${who} you're asked to decide that ${name} stays off: no ask names it; asks: ${listed(asksRaised(events, since))}`);
  must(naming(events, ON).length === 0, `${who} nothing asks about ${ON}, which is on where it's deployed: ${listed(naming(events, ON))}`);
  const asks = [...new Map(OFF.flatMap((name) => naming(events, name)).map((a) => [a.id, a])).values()];
  const at = await lastPos(hub);
  for (const ask of asks) {
    const off = optionMatching(ask, /stay|off/i);
    must(off !== undefined, `${who} the ask offers that the switch stays off: ${said(ask)}`);
    await answered(w, ask, off!, who);
  }
  const closesAgain = await openPr(s, `Closes #${n}`);
  must(closesAgain.allowed, `${who} once you decided reject_expired and audit_log stay off, the PR may say Closes: ${shown(closesAgain.before)}`);

  const followUp = (all: Ev[], ask: Ev, name: string): boolean => {
    const decision = all.find((e) => e.kind === 'decision.created' && e.log_pos > at && e.data.ask === `ask:${ask.id}`);
    if (!decision) return false;
    const inDecision = Object.entries(decision.data).some(([k, v]) => /follow/i.test(k) && JSON.stringify(v).includes(name));
    const cites = all.some((e) => e.log_pos > at && (/follow/i.test(e.kind) || Object.keys(e.data ?? {}).some((k) => /follow/i.test(k)))
      && JSON.stringify(e.data).includes(`decision:${decision.id}`) && JSON.stringify(e.data).includes(name));
    return inDecision || cites;
  };
  events = await settle(hub, (all) => OFF.every((name) => asks.some((a) => JSON.stringify(a.data).includes(name) && followUp(all, a, name))), 20_000);
  for (const name of OFF) {
    must(asks.some((a) => JSON.stringify(a.data).includes(name) && followUp(events, a, name)), `${who} your decision that ${name} stays off is saved (decision.created for its ask) with the follow-up it needs, naming ${name}: ${listed(events.filter((e) => e.log_pos > at && (e.kind === 'decision.created' || /follow/i.test(e.kind))))}`);
  }
}

// ---- A split (AC4).
/** The new issue a split drafts (README, The drafted issue): an event whose kind names an issue or a draft, never a definition's. */
export const isDraftedIssue = (e: Ev): boolean => /issue/i.test(e.kind) || (/draft/i.test(e.kind) && !/^definition\./.test(e.kind));
export async function splitLeavesClosable(n: number, who: string): Promise<void> {
  const st = await stallToDecision(n, who);
  const { w, hub, s, ref, decision } = st;
  await s.typed('Can you open the pull request now?');
  const before = await openPr(s, `Closes #${n}`);
  must(!before.allowed, `BLOCKED: ${who} before the split, R2 and R3 unproven, the PR can't say Closes (the control): ${shown(before.before)}`);
  const split = optionMatching(decision, /split/i);
  must(split !== undefined, `${who} the decision offers the split: ${said(decision)}`);
  const at = await lastPos(hub);
  await answered(w, decision, split!, who);
  const remaining = [{ id: 'R2', text: CRITERIA.retry, check: CHECKS.retry.file }, { id: 'R3', text: CRITERIA.audit, check: CHECKS.audit.file }];
  const lists = (e: Ev) => { const j = JSON.stringify(e.data); return remaining.every((r) => (j.includes(r.text) || new RegExp(`\\b${r.id}\\b`).test(j)) && j.includes(basename(r.check))); };
  const events = await settle(hub, (all) => all.some((e) => e.log_pos > at && isDraftedIssue(e) && lists(e)), 20_000);
  const drafted = events.filter((e) => e.log_pos > at && isDraftedIssue(e));
  must(drafted.some(lists), `${who} the split drafts a new issue that lists each remaining item (R2 "${CRITERIA.retry}", R3 "${CRITERIA.audit}") with what it needs (its check, ${basename(CHECKS.retry.file)}, ${basename(CHECKS.audit.file)}): drafted ${listed(drafted)}`);
  const after = await openPr(s, `Closes #${n}`);
  must(after.allowed, `${who} the split leaves ${ITEM(n)} closable: \`${prCreate(`Closes #${n}`)}\` is allowed after it: ${shown(after.before)}`);
  const passed = runsOf(events, ref, st.since).filter((r) => runOf(CHECKS.expired.file)(r) && r.finished?.data.outcome === 'passed');
  must(passed.length > 0, `${who} the issue closes with evidence for what passed: a passing run of R1's check ${CHECKS.expired.file} on the task's claims`);
}
