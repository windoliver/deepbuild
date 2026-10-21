// The adapter kit, adapter@1 (#313): its cases, the broken fakes that prove them (one per adapter rule and one
// per item a case declares), its planted entries (one per code of every code family) and its clean fill.
import { ContractError } from '@deepbuild/contracts';
import type { JsonValue } from '@deepbuild/contracts';
import type { AdapterEvent, HookRequestLine } from '@deepbuild/adapters';
import { AGENT, fakeFill, VERSION } from './fake-agent.js';
import type { Faults } from './fake-agent.js';
import { codeFamilies } from './families.js';
import { planted } from './planted.js';
import { isObject } from './types.js';
import type { Case, Delivery, Fake, Fill, Flag, Harness, Kit, Operation, PlantedEntry } from './types.js';

export const KIT_NAME = 'adapter@1';
const REVISION = 1;
const SESSION = 'sess_01';

/** The messages the harness itself fails with, which the flag fakes must carry. */
export const HARNESS = {
  flagUnsupported: (flag: Flag, operation: Operation, surface: string): string => `declared flag ${flag}, but ${operation} returned unsupported on ${surface}`,
  noOpSuccess: (operation: Operation, surface: string): string => `${operation} is listed unsupported on ${surface} but returned ok: a no-op success`,
  unlistedUnsupported: (operation: Operation, surface: string): string => `${operation} returned unsupported on ${surface}, which doesn't list it unsupported`,
  wrongUnsupported: (operation: Operation, surface: string, reply: { operation: string; surface: string }): string => `${operation} is listed unsupported on ${surface}, but the reply names ${reply.operation} on ${reply.surface}`,
  noKind: (kind: string): string => `no ${kind} event mapped`,
};
export const CODES = {
  rule: (id: string): string => `rule:${id}`,
  flag: (flag: Flag): string => `flag:${flag}`,
  operation: (operation: Operation): string => `operation:${operation}`,
  kind: (kind: string): string => `kind:${kind}`,
};

/** A hook request line of the fake agent's version carrying `payload`. */
const line = (payload: JsonValue, n: number): HookRequestLine => ({
  v: 1, agent: AGENT, event: String(isObject(payload) ? payload.hook_event_name : ''), seq: String(1760013451123456789n + BigInt(n) * 1000n), id: `01K74FKZVK8Q2X5R7M3N9P4T${String(n).padStart(2, '0')}`, pid: 81234, ppid: 81200, matched: [], payload,
});
const hook = (h: Harness, n: number, hook_event_name: string, fields: { [k: string]: JsonValue }): AdapterEvent[] => h.hook(line({ hook_event_name, session_id: SESSION, ...fields }, n)).events;

/** The one event of `kind` among `events`; the kind's fake drops it, and every case asking for it fails the same way. */
const only = (h: Harness, events: AdapterEvent[], kind: string): AdapterEvent => {
  const found = events.find((event) => event.kind === kind);
  return found ?? h.fail(HARNESS.noKind(kind), [CODES.kind(kind)]);
};

// Messages of the item fakes, shared by the probes below and the fakes list.
const ITEM_MESSAGES = {
  startTurn: 'turn started in another session',
  steer: 'steer applied to another turn',
  followUp: 'follow-up not queued after the turn',
  interrupt: 'steer outlived interrupt',
  respond: 'response bound to another ask',
  history: "history left out the turn's events",
  answerPermission: 'permission answer not applied',
} as const;

/** Drives startTurn and holds the reply to the operation's own rule; undefined when the surface lists it unsupported. */
function startTurn(h: Harness, input: JsonValue): AdapterEvent[] | undefined {
  const reply = h.drive('startTurn', input, SESSION);
  if (reply.outcome !== 'ok') return undefined;
  if (reply.events.some((event) => event.data.session !== SESSION)) h.fail(ITEM_MESSAGES.startTurn, [CODES.operation('startTurn')]);
  only(h, reply.events, 'user.ask');
  return reply.events;
}
const turnOf = (events: AdapterEvent[]): string => String(events[0]?.data.turn ?? '');
function steer(h: Harness, turn: string): AdapterEvent[] | undefined {
  const reply = h.drive('steer', { text: 'use the smaller fixture' }, SESSION);
  if (reply.outcome !== 'ok') return undefined;
  if (reply.events.some((event) => event.data.turn !== turn)) h.fail(ITEM_MESSAGES.steer, [CODES.operation('steer')]);
  // An ok steer that maps no steer event did nothing: a no-op success.
  only(h, reply.events, 'turn.steered');
  return reply.events;
}
/** Answers a permission request through the fill and holds the answer to its flag: a sign that isn't a delivery is an answer not applied. */
function answer(h: Harness, request: JsonValue): Delivery {
  const delivery = h.permission(request, SESSION);
  if (delivery.sign !== null && !/^delivered:[^:]+:./.test(delivery.sign)) h.fail(ITEM_MESSAGES.answerPermission, [CODES.flag('answerPermission')]);
  return delivery;
}
const request = (extra: { [k: string]: JsonValue } = {}): JsonValue => ({ kind: 'tool', tool: 'Bash', command: 'npm test', ...extra });

const rule = (id: string) => ({ id, code: CODES.rule(id) });
const R = {
  calling: rule('who-is-calling'), order: rule('order-by-seq'), clock: rule('clock-stepped-back'), late: rule('late-event-in-stopped-turn'), quiet: rule('unknown-not-finished'),
  threads: rule('threads-across-rotated-ids'), owner: rule('one-owner-per-session'), decision: rule('allow-only-from-decision'), unparsed: rule('unparsed-stop-reads-unknown'), transcript: rule('delivery-confirmed-from-transcript'),
};
const RULE_MESSAGES: Record<keyof typeof R, string> = {
  calling: "subagent event recorded as its parent's", order: 'duplicate event ID', clock: 'event stamped before its turn started', late: 'event after stop', quiet: 'quiet turn reported finished',
  threads: 'rotated session ID not threaded', owner: 'answer delivered to another session', decision: 'allow taken from outside decision', unparsed: 'unparsed stop given a cause', transcript: 'acknowledged with no transcript sign',
};

const kase = (id: string, declares: Partial<Case['declares']>, run: (h: Harness) => void): Case => ({ id, revision: REVISION, declares: { flags: [], operations: [], kinds: [], ...declares }, run });

const cases: Case[] = [
  kase('hooks/who-is-calling', { kinds: ['permission.request', 'agent.stop'] }, (h) => {
    const permission = only(h, hook(h, 1, 'PermissionRequest', { prompt_id: 't1', tool_name: 'Bash', tool_input: { command: 'ls' }, agent_id: 'sub_01' }), 'permission.request');
    if (permission.data.subagent !== 'sub_01') h.fail(RULE_MESSAGES.calling, [R.calling.code]);
    const stop = only(h, hook(h, 2, 'Stop', { prompt_id: 't1', agent_id: 'sub_01' }), 'agent.stop');
    if (stop.data.subagent !== 'sub_01') h.fail(RULE_MESSAGES.calling, [R.calling.code]);
  }),
  kase('hooks/threads-across-rotated-ids', { kinds: ['session.start'] }, (h) => {
    const start = only(h, hook(h, 3, 'SessionStart', { source: 'compact', thread_id: 'thr_01' }), 'session.start');
    if (start.data.thread !== 'thr_01') h.fail(RULE_MESSAGES.threads, [R.threads.code]);
  }),
  kase('hooks/late-event-in-stopped-turn', { kinds: ['agent.stop', 'tool.after'] }, (h) => {
    only(h, hook(h, 4, 'Stop', { prompt_id: 't2' }), 'agent.stop');
    const late = hook(h, 5, 'PostToolUse', { prompt_id: 't2', tool_name: 'Read', tool_input: { file_path: 'a.txt' }, tool_response: 'ok', tool_use_id: 'call_late' });
    only(h, late, 'tool.after');
    if (late.some((event) => event.kind === 'user.ask' || event.kind === 'session.start' || event.kind === 'agent.stop' || event.data.turn !== 't2')) h.fail(RULE_MESSAGES.late, [R.late.code]);
  }),
  kase('hooks/unparsed-stop-reads-unknown', { kinds: ['agent.stop'] }, (h) => {
    const stop = only(h, hook(h, 6, 'Stop', { prompt_id: 't3', error: 'garbled: not a cause the facts list' }), 'agent.stop');
    if (stop.data.cause !== 'unknown') h.fail(RULE_MESSAGES.unparsed, [R.unparsed.code]);
  }),
  kase('facts/hook-timeouts', {}, (h) => {
    const timeouts = isObject(h.facts) && isObject(h.facts.hookTimeouts) ? h.facts.hookTimeouts : {};
    const stop = isObject(timeouts.perHook) ? timeouts.perHook.Stop : undefined;
    if (typeof stop !== 'number') h.fail(`hookTimeouts.perHook.Stop is missing: the rule "${String(timeouts.readBy ?? '')}" reads the Stop hook's timeout`, ['required']);
  }),
  kase('drive/order-by-seq', { flags: ['startTurn'], operations: ['startTurn'], kinds: ['user.ask'] }, (h) => {
    const events = startTurn(h, { prompt: 'order the events' });
    if (!events) return;
    const ids = events.map((event) => String(event.data.id));
    if (new Set(ids).size !== ids.length) h.fail(RULE_MESSAGES.order, [R.order.code]);
    // In the order they come: by seq, two with one seq by their IDs.
    const seqs = events.map((event) => BigInt(String(event.data.seq)));
    if (seqs.some((seq, i) => i > 0 && (seq < seqs[i - 1]! || (seq === seqs[i - 1]! && ids[i]! < ids[i - 1]!)))) h.fail('events out of seq order, or a tie not ordered by ID', [R.order.code]);
  }),
  kase('drive/clock-stepped-back', { flags: ['startTurn'], operations: ['startTurn'] }, (h) => {
    const events = startTurn(h, { prompt: 'the clock steps back', script: 'clock-back' });
    if (!events) return;
    // The turn started at its user.ask, wherever the reply puts it.
    const first = BigInt(String(only(h, events, 'user.ask').data.seq));
    if (events.some((event) => BigInt(String(event.data.seq)) < first)) h.fail(RULE_MESSAGES.clock, [R.clock.code]);
  }),
  kase('drive/unknown-not-finished', { flags: ['startTurn'], operations: ['startTurn'] }, (h) => {
    const events = startTurn(h, { prompt: 'then the hooks go quiet', script: 'quiet' });
    if (events?.some((event) => event.kind === 'agent.stop')) h.fail(RULE_MESSAGES.quiet, [R.quiet.code]);
  }),
  kase('drive/steer', { flags: ['steer'], operations: ['startTurn', 'steer'] }, (h) => {
    const events = startTurn(h, { prompt: 'a long turn', script: 'long' });
    if (events) steer(h, turnOf(events));
  }),
  kase('drive/follow-up', { flags: ['followUp'], operations: ['startTurn', 'followUp'] }, (h) => {
    const events = startTurn(h, { prompt: 'a long turn', script: 'long' });
    if (!events) return;
    const reply = h.drive('followUp', { text: 'then run the tests' }, SESSION);
    if (reply.outcome !== 'ok') return;
    if (reply.events.some((event) => event.data.after !== turnOf(events))) h.fail(ITEM_MESSAGES.followUp, [CODES.operation('followUp')]);
    only(h, reply.events, 'turn.followed_up');
  }),
  kase('drive/interrupt', { flags: ['steer'], operations: ['startTurn', 'steer', 'interrupt'] }, (h) => {
    const events = startTurn(h, { prompt: 'a long turn', script: 'long' });
    if (!events) return;
    steer(h, turnOf(events));
    const reply = h.drive('interrupt', {}, SESSION);
    if (reply.outcome !== 'ok') return;
    const at = reply.events.findIndex((event) => event.kind === 'turn.interrupted');
    if (at >= 0 && reply.events.slice(at + 1).some((event) => event.kind === 'turn.steered')) h.fail(ITEM_MESSAGES.interrupt, [CODES.operation('interrupt')]);
    // An interrupt that maps neither the interruption nor the turn's stop left the turn running.
    only(h, reply.events, 'turn.interrupted');
    only(h, reply.events, 'agent.stop');
  }),
  kase('drive/respond', { operations: ['startTurn', 'respond'] }, (h) => {
    const events = startTurn(h, { prompt: 'ask me something', script: 'question' });
    const ask = events?.find((event) => event.kind === 'permission.request');
    if (!ask) return;
    const reply = h.drive('respond', { ask: String(ask.data.id), text: 'yes' }, SESSION);
    if (reply.outcome !== 'ok') return;
    if (reply.events.some((event) => event.data.ask !== ask.data.id)) h.fail(ITEM_MESSAGES.respond, [CODES.operation('respond')]);
    only(h, reply.events, 'ask.answered');
  }),
  kase('drive/history', { operations: ['startTurn', 'history'] }, (h) => {
    const events = startTurn(h, { prompt: 'remember this' });
    if (!events) return;
    const reply = h.drive('history', {}, SESSION);
    if (reply.outcome !== 'ok') return;
    const seen = new Set(reply.events.map((event) => event.data.id));
    if (events.some((event) => !seen.has(event.data.id))) h.fail(ITEM_MESSAGES.history, [CODES.operation('history')]);
  }),
  kase('deliver/answer-permission', { flags: ['answerPermission'] }, (h) => {
    // The harness delivered allow, so the transcript must show allow applied, in the session it landed in.
    const delivery = answer(h, request());
    if (delivery.sign !== null && delivery.sign !== `delivered:allow:${delivery.session}`) h.fail(ITEM_MESSAGES.answerPermission, [CODES.flag('answerPermission')]);
  }),
  kase('deliver/one-owner-per-session', { flags: ['answerPermission'] }, (h) => {
    // The transcript sign names where the answer landed; the adapter's own session field is only its word.
    const delivery = answer(h, request());
    const signed = delivery.sign === null ? undefined : /^delivered:[^:]+:(.+)$/.exec(delivery.sign)?.[1];
    if (delivery.session !== SESSION || (signed !== undefined && signed !== SESSION)) h.fail(RULE_MESSAGES.owner, [R.owner.code]);
  }),
  kase('deliver/allow-only-from-decision', { flags: ['answerPermission'] }, (h) => {
    const delivery = answer(h, request({ command: 'rm -rf build', decision: 'deny', suggestion: 'allow' }));
    if (delivery.sign !== null && delivery.sign !== `delivered:deny:${delivery.session}`) h.fail(RULE_MESSAGES.decision, [R.decision.code]);
  }),
  kase('deliver/confirmed-from-transcript', { flags: ['answerPermission'] }, (h) => {
    if (answer(h, request()).sign === null) h.fail(RULE_MESSAGES.transcript, [R.transcript.code]);
  }),
];

const fake = (name: string, message: string, codes: string[], breaks: Fake['breaks'], faults: Faults): Fake => ({ name, message, codes, breaks, fill: fakeFill(REVISION, faults) });
const SURFACE = fakeFill(REVISION).surface;

/** The broken fakes: one per adapter rule, one per flag, operation and kind a case declares. */
function fakes(): Fake[] {
  const rules: Fake[] = [
    fake('parent-owns-subagent', RULE_MESSAGES.calling, [R.calling.code], { rule: R.calling.id }, { parentOwnsSubagent: true }),
    fake('duplicate-event-id', RULE_MESSAGES.order, [R.order.code], { rule: R.order.id }, { duplicateId: true }),
    fake('clock-steps-back', RULE_MESSAGES.clock, [R.clock.code], { rule: R.clock.id }, { clockStepsBack: true }),
    fake('event-after-stop', RULE_MESSAGES.late, [R.late.code], { rule: R.late.id }, { reopenAfterStop: true }),
    fake('quiet-reported-finished', RULE_MESSAGES.quiet, [R.quiet.code], { rule: R.quiet.id }, { quietReportsFinished: true }),
    fake('thread-dropped', RULE_MESSAGES.threads, [R.threads.code], { rule: R.threads.id }, { dropThread: true }),
    fake('answer-to-other-session', RULE_MESSAGES.owner, [R.owner.code], { rule: R.owner.id }, { otherSessionDelivery: true }),
    fake('allow-from-suggestion', RULE_MESSAGES.decision, [R.decision.code], { rule: R.decision.id }, { allowFromSuggestion: true }),
    fake('unparsed-stop-given-cause', RULE_MESSAGES.unparsed, [R.unparsed.code], { rule: R.unparsed.id }, { unparsedStopCause: true }),
    fake('acknowledged-without-sign', RULE_MESSAGES.transcript, [R.transcript.code], { rule: R.transcript.id }, { noSign: true }),
  ];
  const flags: Fake[] = [
    ...(['startTurn', 'steer', 'followUp'] as const).map((flag) => fake(`flag-${flag}-unsupported`, HARNESS.flagUnsupported(flag, flag, SURFACE), [CODES.flag(flag)], { flag }, { unsupportedFlag: flag })),
    fake('answer-ignored', ITEM_MESSAGES.answerPermission, [CODES.flag('answerPermission')], { flag: 'answerPermission' }, { ignoreAnswer: true }),
  ];
  const operations: Fake[] = [
    fake('turn-in-other-session', ITEM_MESSAGES.startTurn, [CODES.operation('startTurn')], { operation: 'startTurn' }, { startTurnOtherSession: true }),
    fake('steer-to-other-turn', ITEM_MESSAGES.steer, [CODES.operation('steer')], { operation: 'steer' }, { steerOtherTurn: true }),
    fake('follow-up-immediate', ITEM_MESSAGES.followUp, [CODES.operation('followUp')], { operation: 'followUp' }, { followUpImmediate: true }),
    fake('steer-outlives-interrupt', ITEM_MESSAGES.interrupt, [CODES.operation('interrupt')], { operation: 'interrupt' }, { steerOutlivesInterrupt: true }),
    fake('response-to-other-ask', ITEM_MESSAGES.respond, [CODES.operation('respond')], { operation: 'respond' }, { respondOtherAsk: true }),
    fake('history-empty', ITEM_MESSAGES.history, [CODES.operation('history')], { operation: 'history' }, { historyEmpty: true }),
  ];
  const kinds = [...new Set(cases.flatMap((c) => c.declares.kinds))].map((kind) => fake(`drops-${kind}`, HARNESS.noKind(kind), [CODES.kind(kind)], { kind }, { dropKind: kind }));
  return [...rules, ...flags, ...operations, ...kinds];
}

/** The shipped kits: adapter@1. */
/** The planted entries, built once and frozen: data from the published schemas, the same objects in every kits(). */
let entries: readonly PlantedEntry[] | undefined;
const freeze = <T>(value: T): T => { if (typeof value === 'object' && value !== null) { for (const v of Object.values(value)) freeze(v); Object.freeze(value); } return value; };

export const plantedEntries = (): readonly PlantedEntry[] => (entries ??= freeze(planted(codeFamilies())));

export function kits(): Kit[] {
  return [{ name: KIT_NAME, revision: REVISION, cases: [...cases], fakes: fakes(), planted: [...plantedEntries()] }];
}

/** The kit's reference fake agent, which passes every case of the kit. */
export function cleanFill(kit: Kit): Fill {
  if (kit.name !== KIT_NAME) throw new ContractError({ code: 'enum', retryable: false, remediation: `The fake agent is the reference fill of ${KIT_NAME} only.`, path: '/name', actual: kit.name, evidence: [] });
  return fakeFill(kit.revision);
}

export { VERSION as FAKE_VERSION };
