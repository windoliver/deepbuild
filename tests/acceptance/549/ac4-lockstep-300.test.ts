// AC4 #549.a6b30a32: A test piece of 300 units whose logic steps at 20 Hz in a 20 Hz match with window 0 and delay 4,
// played by a copy in the app and one in headless Chrome's web player for 3,600 match steps through a test relay that
// delays each message by a seeded 0 to 150 ms, reaches the same full-state hash at every hash interval and records the
// same merged track as a run with no delay, with no rollback and 0 B of rollback snapshots counted by net.budget; a
// planted copy that runs a step before it holds every player's message fails net.rollback, naming the first step it
// ran early
//
// The piece is fixtures.ts's lockstep piece (`army`: 300 units at 20 Hz; net: 20 Hz, window 0, delay 4, a hash every
// 60 steps). The live match: the shipped relay behind this suite's door, which delays each frame the relay forwards
// by a seeded 0 to 150 ms and drops the signaling a direct path needs, so every message crosses it; the app's copy
// (`deep-show run`: a person's click on the app's Join prompt, then `play_match` with player 1's script, one entry a
// match step) and the web player's copy in headless Chrome (the exported bundle opened through the first player's
// link, a person's click on the player's own prompt; it makes no entry of its own). The run with no delay is `match`
// on the same script, in one process over the test relay. Nothing below reads how long anything took: lockstep gives
// the same hashes and track whatever the delays, which is the criterion.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DELAY, DOC, LOGIC, armyAfter, armyProgram, lockstepDoc, script, scripts, type Plays } from './fixtures.ts';
import {
  AC, Chrome, FULL, LIVE_MS, Script, TIMEOUT, checkOf, copiesOf, copyOf, expectedTrack, exportBundle, firstDifference, fragmentOf, framesThrough, gaveUp, hashFailures,
  lastArray, linkFrom, liveCopy, merged, none, once, pinOf, playedOf, presented, putEvidence, relayOf, runShow, scenario, sentThrough, serve, startDoor, startRelay, useBuilds,
  useCertificate, useChildren, useCleanup, useClosers, useTemp, type CarriedFrame, type CheckReport, type Copy, type MatchAsk, type Planted, type RelayReport,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL], relay: true });
const certs = useCertificate();
useCleanup();
useChildren();
const closing = useClosers();
const temp = useTemp();
const LIVE_STEPS = 3600;
const HASH_EVERY = 60;
/** Player 1's script for the live match (the web copy's player makes no entry). */
const LIVE_PLAYS: Plays = { '1': script(1, LIVE_STEPS) };
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

interface Here { copies: Copy[]; check: CheckReport | null; relay: RelayReport | null }
/** `match`: the copies in one process over the test relay, with no network. */
async function here(what: string, steps: number, hashEvery: number, ask: MatchAsk, planted?: Planted): Promise<Here> {
  const evidence = temp();
  const program = armyProgram();
  putEvidence(evidence, program.bytes);
  const s = new Script();
  s.present(DOC.lockstep, lockstepDoc(program, { relay: 'https://relay.test/549', hash_every: hashEvery }));
  const m = s.match(DOC.lockstep, steps, ask);
  const r = await runShow(builds.show(), scenario({ evidence, docs: [{ id: DOC.lockstep }], calls: s.calls, ...(planted ? { planted } : {}) }), what);
  presented(r[0], `${what}: the lockstep piece`);
  return { copies: copiesOf(r[m], what), check: ask.check ? checkOf(r[m], what) : null, relay: ask.relay?.log ? relayOf(r[m], what) : null };
}
/** The run with no delay: player 1's script over 3,600 steps, every message on time. */
const noDelay = once(() => here('AC4 the run with no delay', LIVE_STEPS, HASH_EVERY, { plays: LIVE_PLAYS }));

/** The first step a copy ran before the test relay had delivered every other player's message for it, from the copy's
 * own step times and the relay's log of what it delivered when: null when it never did. */
function firstEarly(copy: Copy, log: readonly CarriedFrame[], players: number): number | null {
  if (!copy.ranAt) return null;
  for (let k = 0; k < copy.ranAt.length; k++) {
    for (let p = 1; p <= players; p++) {
      if (p === copy.player) continue;
      const arrivals = log.filter((x) => x.player === p && x.delivered !== null && x.first <= k && k < x.first + x.count).map((x) => x.delivered!);
      if (!arrivals.length || Math.min(...arrivals) > copy.ranAt[k]!) return k;
    }
  }
  return null;
}

describe(`${AC[4]} 300 units in lockstep between the app and the web player, under delays`, () => {
  it(`${AC[4]} the app's copy and headless Chrome's reach the same full-state hash at every hash interval and record the same merged track as the run with no delay, with no rollback`, async () => {
    const reference = await noDelay();
    const relay = await startRelay(builds.relay(), certs());
    closing(() => relay.stop());
    const door = await startDoor(relay.host, certs(), { delayMs: [0, 150], seed: 549, signals: false });
    closing(() => door.close());
    const program = armyProgram();
    // The fixture's timeout is 120 s, so a slow machine can't end the match; nothing here measures a time.
    const document = lockstepDoc(program, { relay: door.url, hash_every: HASH_EVERY, timeout: 120 });
    const [appStore, webStore, out, links] = [temp(), temp(), join(temp(), 'bundle'), temp()];
    for (const store of [appStore, webStore]) putEvidence(store, program.bytes);
    await exportBundle(builds.show(), webStore, document, out, 'AC4 the web bundle');
    const served = await serve(out);
    closing(() => served.stop());

    // The app's copy joins first (player 1) and writes its link; the web player's joins through it (player 2).
    const linkFile = join(links, 'link');
    const app = liveCopy(builds.show(), { evidence: appStore, document, steps: LIVE_STEPS, plays: LIVE_PLAYS['1']!, relayCa: certs().ca, linkTo: linkFile }, 'AC4 the app\'s copy');
    app.catch(() => undefined);
    const link = await linkFrom(linkFile, 'AC4 the app\'s copy', app);
    const fragment = fragmentOf(link, null, 'AC4 the app\'s link');
    const chrome = await Chrome.open([pinOf(certs().cert)]);
    closing(() => chrome.close());
    const tab = await chrome.open(`${served.origin}/index.html${fragment}`);
    await tab.mustBeReady('AC4 the web player');
    const prompt = await tab.prompt();
    expect(prompt?.button, `the web player draws its own Join prompt with a button (an element marked data-deep-join): ${JSON.stringify(prompt)}`).toBeTruthy();
    expect(prompt!.text, 'the player\'s prompt names the relay host').toContain(door.host);
    await tab.click(prompt!.button!.x + prompt!.button!.w / 2, prompt!.button!.y + prompt!.button!.h / 2);

    const played = await app;
    const a = playedOf(played.reply, 'AC4 the app\'s copy');
    fragmentOf(link, a.match, 'AC4 the app\'s link');
    // The app's copy left after its 3,600 steps, which ends the match on the web player's copy too.
    const until = Date.now() + LIVE_MS;
    let seen = await tab.match();
    while ((seen?.['end'] === null || seen?.['end'] === undefined) && Date.now() < until) { await sleep(250); seen = await tab.match(); }
    if (seen?.['end'] === null || seen?.['end'] === undefined) gaveUp(`AC4: the web player's match didn't end after the app's copy left: ${JSON.stringify(seen)?.slice(0, 600)}`);
    const w = copyOf(seen, 'AC4 the web player\'s copy (probe().match)');

    const f: string[] = [];
    if (a.player !== 1 || w.player !== 2) f.push(`the app's copy is player ${a.player} and the web player's player ${w.player}, not 1 and 2 in the order the relay saw them join`);
    if (a.ran !== LIVE_STEPS) f.push(`the app's copy ran ${a.ran} match steps, not ${LIVE_STEPS}`);
    if (w.ran < LIVE_STEPS - 2 * DELAY) f.push(`the web player's copy ran ${w.ran} match steps, fewer than the app's copy needed its messages for`);
    if (w.end !== 'left') f.push(`the web player's match ended as ${String(w.end)}, not left, when the app's copy left`);
    for (const [c, label] of [[a, 'the app\'s copy'], [w, 'the web player\'s copy']] as const) if (c.rollbacks !== 0) f.push(`${label} rolled back ${c.rollbacks} times`);
    const intervals = Math.floor((LIVE_STEPS - 2 * DELAY) / HASH_EVERY) - 1;
    f.push(...hashFailures(a, w, 'the app\'s copy and the web player\'s', { hashEvery: HASH_EVERY, atLeast: intervals }));
    f.push(...hashFailures(a, reference.copies[0]!, 'the app\'s copy under delays and the run with no delay', { hashEvery: HASH_EVERY, atLeast: intervals }));
    f.push(...hashFailures(w, reference.copies[1]!, 'the web player\'s copy under delays and the run with no delay', { hashEvery: HASH_EVERY, atLeast: intervals }));
    // The merged track, on every step both confirmed: the same on both copies, as the run with no delay recorded it,
    // and what player 1's script gives with each entry 4 steps after it was made.
    if (!a.record || !w.record || !reference.copies[0]!.record) f.push('a copy has no record');
    else {
      const before = Math.min(a.record.confirmed, w.record.confirmed);
      if (before < LIVE_STEPS - 3 * DELAY) f.push(`the copies confirmed only ${before} of ${LIVE_STEPS} steps`);
      const want = JSON.stringify(expectedTrack(LIVE_PLAYS, DELAY, before));
      if (JSON.stringify(merged(a.record.track, before)) !== want) f.push('the app\'s recorded track isn\'t player 1\'s entries, each 4 steps after it was made');
      if (JSON.stringify(merged(w.record.track, before)) !== want) f.push('the web player\'s recorded track isn\'t player 1\'s entries, each 4 steps after it was made');
      if (JSON.stringify(merged(reference.copies[0]!.record.track, before)) !== want) f.push('the run with no delay recorded another track');
      const own = w.record.track.filter((e) => e.player === 1 && e.writer !== 'peer');
      if (own.length) f.push(`the web player's record holds ${own.length} of player 1's entries without the writer peer`);
      if (a.record.track.some((e) => e.player === 1 && e.writer === 'peer')) f.push('the app\'s record marks its own player\'s entries as a peer\'s');
    }
    // Every message crossed the door, which delayed it; no signaling passed, so there was no direct path.
    if (framesThrough(door).length < LIVE_STEPS) f.push(`only ${framesThrough(door).length} frames crossed the door in ${LIVE_STEPS} match steps`);
    if (sentThrough(door).some((m) => m.message.member === 'signal' && !m.message.dropped)) f.push('a signal message passed the door');
    none(f, 'the 300-unit piece between the app and headless Chrome under delays');
    // The run with no delay holds what the script gives: this suite's own mirror of the program.
    const want = armyAfter(LIVE_PLAYS, LIVE_STEPS);
    for (const c of reference.copies) expect(lastArray(c, `${LOGIC}.pos`, `the run with no delay, copy ${c.player}`), `copy ${c.player} of the run with no delay holds the positions player 1's entries give at their steps`).toEqual(want.pos);
  }, TIMEOUT);

  it(`${AC[4]} net.budget counts 0 B of rollback snapshots and no rollback`, async () => {
    const steps = 600;
    const run = await here('AC4 net.budget', steps, HASH_EVERY, { plays: scripts(2, steps), check: 'net.budget' });
    expect(run.check!.kind, 'the check is net.budget').toBe('net.budget');
    // Its verdict is the class's frame time against this machine, which #553's budgets hold; only its counts are read.
    expect(['PASS', 'FAIL', 'INCONCLUSIVE', 'BLOCKED'], `net.budget gives a verdict: ${JSON.stringify(run.check!.raw).slice(0, 600)}`).toContain(run.check!.verdict);
    expect(run.check!.raw['rollback_snapshot_bytes'], 'with window 0, net.budget counts 0 B of rollback snapshots (check.rollback_snapshot_bytes)').toBe(0);
    for (const c of run.copies) expect(c.rollbacks, `copy ${c.player} rolls nothing back`).toBe(0);
  }, TIMEOUT);

  it(`${AC[4]} planted net_runs_step_early fails net.rollback, naming the first step it ran early`, async () => {
    const steps = 1200;
    const plays = scripts(2, steps);
    const ask: MatchAsk = { plays, relay: { seed: 549, log: true }, check: 'net.rollback' };
    const onTime = await here('AC4 every message on time', steps, 1, { plays });
    // The honest copies: net.rollback holds messages back by up to the delay plus a seeded jitter and passes; no copy
    // ran a step before the relay delivered every player's message for it; the hashes are the on-time run's.
    const honest = await here('AC4 net.rollback', steps, 1, ask);
    const f: string[] = [];
    if (honest.check!.kind !== 'net.rollback' || honest.check!.verdict !== 'PASS' || honest.check!.failures.length) f.push(`net.rollback gives the honest copies ${honest.check!.verdict} with ${JSON.stringify(honest.check!.failures).slice(0, 400)}, not PASS`);
    if (!honest.relay!.log.some((x) => x.delivered !== null && x.delivered > x.at)) f.push('net.rollback\'s relay held no message back');
    for (const c of honest.copies) {
      if (!c.ranAt || c.ranAt.length !== steps) f.push(`copy ${c.player} reports ${c.ranAt?.length ?? 'no'} step times (ran_at), not ${steps}`);
      const early = firstEarly(c, honest.relay!.log, 2);
      if (early !== null) f.push(`the honest copy ${c.player} ran step ${early} before the relay had delivered every player's message for it`);
      if (c.waits.length === 0) f.push(`copy ${c.player} never waited though messages were held back`);
      f.push(...hashFailures(c, onTime.copies[c.player - 1]!, `copy ${c.player} with messages held back and on time`, { hashEvery: 1, atLeast: steps - 2 }));
    }
    none(f, 'net.rollback on the honest copies');

    const twin = await here('AC4 net.rollback', steps, 1, ask, 'net_runs_step_early');
    const early = twin.copies.map((c) => ({ player: c.player, step: firstEarly(c, twin.relay!.log, 2) })).filter((x): x is { player: number; step: number } => x.step !== null).sort((x, y) => x.step - y.step)[0];
    expect(early, 'under the planted copy, this file\'s own reading of the step times and the relay\'s log finds a step run before its messages arrived').toBeDefined();
    expect(twin.check!.verdict, `net.rollback fails the planted copy: ${JSON.stringify(twin.check!.raw).slice(0, 600)}`).toBe('FAIL');
    const named = twin.check!.failures.map((x) => x['step']).filter((x): x is number => typeof x === 'number').sort((x, y) => x - y);
    expect(named[0], `net.rollback's failure names step ${early!.step}, the first step copy ${early!.player} ran early: ${JSON.stringify(twin.check!.failures).slice(0, 600)}`).toBe(early!.step);
    // What running early cost: the planted copy's state parts from the on-time run's at or after that step.
    const parted = twin.copies.map((c) => firstDifference(c, onTime.copies[c.player - 1]!)).filter((x): x is number => x !== null).sort((x, y) => x - y)[0];
    expect(parted, 'the planted copy\'s full-state hashes part from the on-time run\'s').toBeDefined();
    expect(parted!, 'they part no earlier than the first step it ran early').toBeGreaterThanOrEqual(early!.step);
  }, TIMEOUT);
});
