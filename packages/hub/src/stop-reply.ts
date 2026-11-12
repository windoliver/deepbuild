import type { HubEvents, HubRuntime, HookSchedule } from './hub-capabilities.js';
import type { AnswerDeliveryPort, SessionStatePort } from './hub-ports.js';
import { noWake, backgrounded } from './hub-shared.js';
import { ulidTime } from './wire.js';
import type { Sorted, Questions } from './questions.js';
import { STOP_HOLD_MS, HOLD_MARGIN_MS } from './claude-settings.js';

import { Holds } from './holds.js';

import { GateRunner } from './gate-runner.js';

import { type CoreOptions, type HookMeta } from './wire.js';
import type { Routes } from './session-types.js';
import type { StopJudgingPort } from './hub-ports.js';
export interface StopReplyOptions {
 settings: CoreOptions;
 services: {
readonly holds: Holds;
readonly questions: Questions;
readonly now: () => number;
readonly gate: GateRunner;
 };
 events: Pick<HubEvents, "appendReading">;
kernel: Pick<HubRuntime, "blocked">;
schedule: Pick<HookSchedule, "queue" | "askingSoon" | "abandoned">;

delivery: () => Pick<AnswerDeliveryPort, "deliver" | "handed" | "offer" | "unwoken" | "waitingFor">;
 judging: () => Pick<StopJudgingPort, "judging" | "laneOf" | "claimRequirements" | "requirementsOf" | "verdictWrites" | "completion" | "prDelivery" | "noWorkOnce" | "stallGate" | "sizedAt" | "idleOrResumed" | "questionHolds" | "slowStop" | "provisionalCarried" | "smallestOf" | "stopHold" | "stillNeeded" | "judgedLine" | "heldLine" | "lanes">;
state: () => Pick<SessionStatePort, "live">;
}

/** The held stop: question sorting, reply delivery and the final line, in that order. */
export class StopReply {
 constructor(private readonly options: StopReplyOptions) {}
 async stopReply(meta: HookMeta, until: number, r: Routes, stepped: () => number): Promise<{ context?: string; block?: string; message?: string }> {
    // What earlier replies handed this session is read from its transcript first: shown, or stalled and sent again here (#906).
    await this.options.schedule.queue(async () => { for (const [ask, handed] of [...this.options.delivery().handed]) if (handed.session === meta.session) await this.options.delivery().unwoken(meta.session, ask); });
    r.holding++;
    let block: string | undefined;
    // A judged stop's claim is made, and its pull request recorded, before the hold, behind this stop's own hook (#83).
    const judged = await this.options.schedule.queue(() => this.options.judging().judging(meta)).catch(async (e: unknown) => {
      await this.options.events.appendReading(meta.session, meta.agent, `This stop's claim could not be recorded: ${e instanceof Error ? e.message : String(e)}`).catch(() => undefined);
      return undefined;
    });
    // A record that takes no writes (a full disk, the lock lost) turns every gate watch-only: the stop goes on
    // unjudged, and its line says so and why (#33).
    if (this.options.kernel.blocked && !judged?.claim) {
      r.holding--;
      const said = this.options.settings.plant === 'failures-as-fail' ? this.options.kernel.blocked.replace(/^BLOCKED/, 'FAIL') : this.options.kernel.blocked;
      return { message: `${said}: DeepBuild is watch-only until the record takes writes again, so this stop wasn't judged.` };
    }
    // The claim's fast lane (#29): the hold waits for the checks the budget admitted, and no longer than the hold.
    // deep-hook stamps the stop on the wall clock; a stepped test clock's steps put it on the hub's (#965).
    const stopAt = ulidTime(meta.id) + stepped();
    // Codex's hold may run as long as its Stop timeout lets a slow check, but an answer waits no longer than anyone's.
    const held = until;
    until = noWake(meta.agent) ? Math.min(until, Date.now() + STOP_HOLD_MS) : until;
    const lane = judged?.claim ? await this.options.judging().laneOf(judged.claim, until) : undefined;
    // What the stop ends on, sorted before the stall rule reads whether a question holds its send-back (#84).
    const message = meta.fields?.last_assistant_message?.trim() ?? '';
    // A test's planted sorter answers its question first: what it answered "proceed" is sorted no further (#321).
    const asked = this.options.services.holds.planted(meta);
    const sorted: Sorted | undefined = judged && !r.places && !asked ? await this.options.services.questions.atStop(meta, {
      message, requirements: [...(this.options.judging().claimRequirements.get(judged.claim ?? '')?.values() ?? await this.options.judging().requirementsOf(meta.session))],
    }).catch(async (e: unknown) => { await this.options.events.appendReading(meta.session, meta.agent, `This stop's question could not be sorted: ${e instanceof Error ? e.message : String(e)}`).catch(() => undefined); return undefined; }) : undefined;
    const proceeds = asked ? [asked] : sorted?.proceeds ?? [];
    // A send-back names the verdict the record holds, so it waits for the lane's verdict to be written.
    if (lane?.sendBack && judged?.claim) await this.options.judging().verdictWrites.get(judged.claim)?.catch(() => undefined);
    // A stop that did work and ends on an empty message, with requirements open, gets a completion prompt (#82), at
    // most three in a row; the fourth becomes a stalled claim. It takes the send-back's place and counts apart from it.
    const prompted = judged?.claim ? await this.options.judging().completion(meta, judged.claim, lane?.sendBack) : undefined;
    // The stop that opens the pull request you asked for is delivery, not a claim to send back (#82): what's still
    // unmet goes on in the same pull request, unless your ask says the pull request ends the work.
    const delivered = judged?.claim && lane ? await this.options.judging().prDelivery(judged) : undefined;
    if (lane && delivered !== undefined) {
      if (delivered) lane.sendBack = delivered;
      else delete lane.sendBack;
    } else if (lane && prompted !== undefined) {
      if (prompted) lane.sendBack = prompted;
      else delete lane.sendBack;
    }
    // A send-back counts toward a stalled claim, and a question that holds the send-back holds it (#325).
    // A stop with no work that leaves its ask open gets its one send-back before the stall rule counts it (#82).
    else if (lane && judged?.claim && !(lane.sendBack && await this.options.judging().noWorkOnce(meta.session, judged.claim))) {
      const back = await this.options.judging().stallGate(meta, judged.claim, lane.sendBack).catch(() => lane.sendBack);
      if (back) lane.sendBack = back;
      else delete lane.sendBack;
    }
    // Size and scope (#324): a reading, never a verdict; what it sends back once rides with a failing check's send-back,
    // and only in time for this reply: past the hold's margin it is recorded and sent nothing.
    // A stop whose snapshot changed nothing is no new size: its last reading stands (#82).
    const sized = judged?.claim && lane?.changed !== false ? await this.options.judging().sizedAt(judged.claim, meta, held + HOLD_MARGIN_MS / 2) : undefined;
    // A no-work stop that leaves an ask open, and the stop after the app's resume prompt (#82): sent on once.
    const nudge = await this.options.schedule.queue(() => this.options.judging().idleOrResumed(meta, judged, Boolean(lane?.sendBack || sized))).catch(() => undefined);
    if (nudge) block = nudge;
    let proceeded = false;
    let questionMs = 0;
    try {
      const questionHeld = judged?.claim ? await this.options.judging().questionHolds(meta.session) : false;
      if (lane && !lane.sendBack && !sized && judged?.claim && noWake(meta.agent) && lane.slow.length && !questionHeld) {
        const failed = await this.options.judging().slowStop(meta, r, judged.claim, held);
        if (failed) lane.sendBack = failed;
        // An answer that ended the hold is delivered below, with the wait an answer gets.
        until = Math.min(held, Date.now() + STOP_HOLD_MS);
      }
      // A stop answered "proceed" goes on at once: the proceed rides in its one reply with what else waits, the failing
      // requirements with their smallest failing case. What else the sort sends back rides the same way.
      // pi's package places its own answers: a reply here would hand them over a second time.
      // A question that holds the send-back holds what the sort would send back too (#84): a proceed is only recorded.
      const back = questionHeld ? [] : sorted?.back ?? [];
      if (questionHeld && proceeds.length) await this.options.services.holds.record(meta, proceeds, until);
      // A provisional choice raised in the turn goes on: its recommended option goes back in the same reply as a send-back.
      const carried = lane?.sendBack ? await this.options.judging().provisionalCarried(meta.session) : undefined;
      const going = questionHeld ? [] : proceeds;
      if (going.length || back.length) {
        proceeded = true;
        if (going.length) await this.options.services.holds.record(meta, going, until);
        const delivered = await this.options.schedule.queue(async () => this.options.delivery().deliver(await this.options.delivery().waitingFor(meta.session), 'stop_hold', { session: meta.session, id: meta.id }));
        const failing = going.length && lane?.sendBack && judged?.claim ? await this.options.judging().smallestOf(judged.claim) : undefined;
        const said = going.length ? `DeepBuild: proceed (${going.map((p) => `"${p.question}", by rule ${p.rule}`).join('; ')}). Go on with the work. A call that pushes, merges, dispatches, sends or deletes still waits for an authority ask.` : undefined;
        block = (this.options.settings.plant === 'proceed-alone' ? [said] : [r.sendBacks.shift(), delivered, lane?.sendBack, failing, sized, nudge, ...back, said]).filter(Boolean).join('\n\n');
      } else if (lane?.sendBack || sized) {
        // Your answer rides with the send-back: only a question that holds it waits for the first stop after it.
        const delivered = await this.options.schedule.queue(async () => this.options.delivery().deliver(await this.options.delivery().waitingFor(meta.session), 'stop_hold', { session: meta.session, id: meta.id }));
        block = [delivered, lane?.sendBack, carried, sized].filter(Boolean).join('\n\n');
      }
      else if (block) this.options.schedule.askingSoon();
      else if ((questionHeld && lane?.fast.length) || sorted?.noHold) {
        // A judged stop whose checks ran waits no longer for them: no send-back follows, so it isn't held for your answer (#84); one already given goes with it.
        block = await this.options.schedule.queue(async () => this.options.delivery().deliver(await this.options.delivery().waitingFor(meta.session), 'stop_hold', { session: meta.session, id: meta.id }));
      } else if (!r.places) {
        const waited = this.options.services.now();
        block = await this.options.judging().stopHold(meta, r, until);
        questionMs = this.options.services.now() - waited;
      }
    } finally {
      this.options.schedule.abandoned.delete(meta.id);
      r.holding--;
      if (block) {
        r.continued++;
        const kept = this.options.state().live.get(meta.session);
        if (kept) kept.sentOn = true;
        r.busy = Date.now();
        // The turn goes on with it, and its next stop starts a waiter of its own: this one exits without waking.
        if (this.options.settings.plant === 'both-routes') r.waiter?.give({ session: meta.session, text: block });
        else r.waiter?.give({ exit: 'answered through the stop hold' });
        r.waiter = undefined;
      } else this.options.delivery().offer(meta.session);
    }
    // Slow runs start when the turn ends (#29): only once the fast lane is green and this reply lets the turn end. A
    // looping session's wait in their places for the loop to pause, or for a claim or your words (#965), and work in
    // the background holds them until it ends, at most 30 minutes (#907). Decided before the line, which names them.
    const live = this.options.state().live.get(meta.session);
    const background = [...(live?.background.values() ?? [])].map((b) => b.what);
    // A stop let through with its claim pending or INCONCLUSIVE: the claim stays open, and an open item names each run
    // or answer still needed (#82).
    if (!block && judged?.claim) await this.options.judging().stillNeeded(meta, judged.claim).catch(() => undefined);
    if (!block && !proceeded) {
      const due = live?.due && live.due.at > this.options.services.now() ? live.due : null;
      const starter = live?.claimedInTurn ? 'claim' as const : live?.words ?? null;
      await this.options.services.gate.turnEnded(lane && judged?.claim ? judged.claim : null, background, stopAt, { session: meta.session, origin: live?.turnFrom, due, starter }).catch(() => undefined);
      if (live) live.words = undefined;
      if (lane && judged?.claim && background.length && lane.slow.length) await this.options.events.appendReading(meta.session, meta.agent, `${lane.slow.join(', ')} ${lane.slow.length === 1 ? 'waits' : 'wait'} for ${backgrounded(background)} in the background, and ${lane.slow.length === 1 ? 'starts' : 'start'} once it ends or 30 minutes from this stop.`).catch(() => undefined);
    }
    // The verdict in the chat: one line at every judged stop, as the verdict stands once the hold is over, first in a send-back's reason too (#83).
    if (judged?.claim) await this.options.judging().verdictWrites.get(judged.claim)?.catch(() => undefined);
    let line = judged ? await this.options.judging().judgedLine(judged).catch(async (e: unknown) => {
      await this.options.events.appendReading(meta.session, meta.agent, `This stop's verdict line could not be read from the record: ${e instanceof Error ? e.message : String(e)}`).catch(() => undefined);
      return undefined;
    }) : undefined;
    // The stop that opens the pull request you asked for is delivery (#82): its line carries the link, never a send-back.
    if (line && delivered !== undefined && judged?.prOpened) line = `${judged.prOpened} · Part of · ${line.replace(/^sent back \d+\/\d+: /, '')}`;
    // A stop a question holds gets no send-back: its line says what fails and that the next step is yours (#84).
    if (line && judged?.claim) line = await this.options.judging().heldLine(meta.session, line);
    // What the stop's list leaves outside the ask shows on the line (#84).
    if (line && sorted?.followUps.length) line = `${line} · follow-up: ${sorted.followUps.join('; ')}`;
    // The chat has seen it once it is replied in time; a reply past the hold is not, and the next prompt shows the line.
    if (line && judged && Date.now() < held) judged.delivered = line;
    if (block && line) block = `${line}\n${block}`;
    if (judged?.claim) {
      // A later stop on the same claim ran no lane: only its own hold counts, never the lane's times or its budget cost again.
      const again = judged.heldClaim === judged.claim;
      judged.heldClaim = judged.claim;
      const replyAt = this.options.services.now();
      const own = replyAt - questionMs;
      const record = (ran: { readyAt: number; changed?: boolean; budgetCost?: string[] }) => this.options.services.gate.held({ session: meta.session, stop: meta.id, claim: judged.claim!, stopAt, readyAt: again ? own : ran.readyAt, replyAt, questionMs, codeChanging: !again && ran.changed === true, budgetCost: again ? [] : ran.budgetCost ?? [] });
      // Recorded beside the reply, not before it: the stop's time is stamped already (#82).
      if (lane) void record(lane).catch(() => undefined);
      // A fast lane still going when the hold ran out: its hold counts all the same, once the lane says what it was.
      else void this.options.judging().lanes.get(judged.claim)?.then(record).catch(() => undefined);
    }
    return { ...(block ? { block } : {}), ...(line ? { message: line } : {}) };
  }
}
