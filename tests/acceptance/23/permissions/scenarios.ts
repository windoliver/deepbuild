// Each criterion's scenario on the real hub, deep-hook and CLI (README, Criteria). A scenario throws an Error naming
// its criterion when the program fails it, `Inconclusive` when the machine spoiled the reading, and an Error starting
// `BLOCKED:` when its setup couldn't start (a plant the program doesn't list). The tests run each on the program as
// it is; plants.test.ts runs them on the planted wrong programs.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HookRequestLine, PermissionAnswer } from '../../../../packages/adapters/src/index.ts';
import {
  ACCOUNT_A, ACCOUNT_B, agentReads, allEvents, alwaysAllow, answer, applyLikeClaude, bash, CANCEL, changedSince, CLOUD, closingOf, DAY,
  decisionsSince, DEPENDENCY, handleOf, HUB_DOWN, Inconclusive, kms, lastPos, LOCKOUT_FLAG, LOCKOUT_GUARD, makeWorld, MODE_GUARD, must,
  newSession, PERMISSION_TIMEOUT_MS, permissionOf, permissionRequest, preTool, preToolUse, lateHook, sessionStart, shown, sleep,
  snapshot, startHub, stopHub, T0, typed, TYPED, waitAsk, WEEK,
  type Call, type Ev, type Hub, type Mode, type Pending, type PermissionReply, type Session, type World,
} from './helpers.ts';

export interface Run { plant?: string | undefined }
const label = (c: Call): string => String(c.tool_input.command);

/** A reply that writes a lasting rule into the agent's own settings: an `updatedPermissions` entry for any destination but the session. */
function lasting(reply: PermissionReply): string[] {
  return reply.updated.filter((u) => u.destination !== 'session').map((u) => `${String(u.type)} for ${String(u.destination)}`);
}
function answeredForCallOrSession(who: string, c: Call, reply: PermissionReply): void {
  const wrote = lasting(reply);
  must(!wrote.length, `${who} the reply to the permission prompt for \`${label(c)}\` must answer for that call or that session only; it picks the agent's option that writes a lasting rule into its own settings: updatedPermissions ${wrote.join(', ')} (${shown(reply.raw)})`);
}

/** Waits up to `ms` for your answer to `ask` saved as a decision: the decision.created that names it. */
async function savedFrom(hub: Hub, ask: Ev, ms: number): Promise<Ev | undefined> {
  const deadline = Date.now() + ms;
  for (;;) {
    const saved = (await decisionsSince(hub, 0)).find((e) => e.data?.ask === handleOf(ask));
    if (saved || Date.now() > deadline) return saved;
    await sleep(250);
  }
}
/** Your answer through `deep inbox answer`; when it doesn't count because the ask closed first on a slow machine, INCONCLUSIVE. */
async function yourAnswer(w: World, hub: Hub, ask: Ev, decision: 'allow' | 'deny', who: string, pending?: Pending): Promise<void> {
  const r = await answer(w, ask, decision);
  if (r.code === 0) return;
  const closing = closingOf(await allEvents(hub), handleOf(ask));
  if (pending?.result && closing?.kind === 'ask.cancelled') {
    throw new Inconclusive(`${who} the prompt stopped waiting (its hook ended after ${(pending.result.ms / 1000).toFixed(0)} s) before your answer to ${handleOf(ask)} landed (${shown(r)})`);
  }
  throw Error(`${who} your answer to ${handleOf(ask)} through deep inbox answer must count: ${shown(r)}`);
}

/**
 * The first prompt for `call` in session `s`: its PreToolUse passes it on (nothing covers it yet), and its
 * PermissionRequest raises an authority ask whose question names the command.
 */
async function firstPrompt(hub: Hub, s: Session, call: Call, who: string): Promise<{ ask: Ev; p: Pending; since: number }> {
  const since = await lastPos(hub);
  const pre = await preToolUse(s, call);
  must(preTool(pre.r) === 'pass', `BLOCKED: ${who} \`${label(call)}\` must reach its permission prompt, its PreToolUse passing it on: ${shown(pre.r)}`);
  const p = permissionRequest(s, call);
  const ask = await waitAsk(hub, since, [label(call)], 60_000, p);
  if (!ask) {
    if (p.result && await lateHook(hub, s.id, 'PermissionRequest', p.result)) throw new Inconclusive(`${who} deep-hook spooled the PermissionRequest for \`${label(call)}\` late, so the hub never had it`);
    const how = p.result ? `the hook ended: ${shown(p.result)}` : 'the hook still waits';
    throw Error(`${who} the permission prompt for \`${label(call)}\` must raise an authority ask whose question names it: none by 10 s after the hook ended (60 s at most); ${how}`);
  }
  must(ask.data.kind === 'authority', `${who} the permission prompt for \`${label(call)}\` must raise an authority ask: ${handleOf(ask)} is ${String(ask.data.kind)}`);
  return { ask, p, since };
}

/**
 * "Answered from a saved decision", with nothing reaching you: within 20 s a decision.applied after `since` cites
 * `saved`, and every ask raised after `since` whose question names `names` is closed by it, never shown in a batch.
 */
async function decidedForYou(hub: Hub, since: number, names: readonly string[], saved: string, who: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const events = (await allEvents(hub)).filter((e) => e.log_pos > since);
    const applied = events.filter((e) => e.kind === 'decision.applied' && e.data?.decision === saved);
    const asks = events.filter((e) => e.kind === 'ask.created' && names.every((n) => String(e.data?.question ?? '').includes(n)));
    const open = asks.filter((a) => !closingOf(events, handleOf(a)));
    const shownAsks = asks.filter((a) => events.some((e) => e.kind === 'ask.batched' && JSON.stringify(e.data ?? {}).includes(handleOf(a))));
    if (applied.length && !open.length) {
      must(!shownAsks.length, `${who} \`${names.join(' ')}\` must be answered from ${saved} without reaching you; ${shownAsks.map(handleOf).join(', ')} was shown in a batch`);
      const other = asks.map((a) => closingOf(events, handleOf(a))).filter((c) => c && !(c.kind === 'decision.applied' && c.data?.decision === saved));
      must(!other.length, `${who} \`${names.join(' ')}\` must be decided for you from ${saved}; its ask closed as ${other.map((c) => c!.kind).join(', ')}`);
      return;
    }
    if (Date.now() > deadline) {
      throw Error(`${who} \`${names.join(' ')}\` must be decided for you from your saved decision ${saved}, logged as decision.applied citing it: ${applied.length} decision.applied cite it, ${open.length} ask(s) naming it still open (${open.map(handleOf).join(', ')})`);
    }
    await sleep(500);
  }
}

/**
 * A prompt answered from `saved`: the call's PreToolUse passes it on, or allows it itself; a prompt then fired is
 * answered allow, for the call or the session only; the agent's own option that writes a lasting rule is never
 * picked; Claude Code applies the reply. Logged as decided for you, citing `saved`.
 */
async function promptAnswered(w: World, hub: Hub, s: Session, call: Call, saved: string, who: string): Promise<void> {
  const since = await lastPos(hub);
  const pre = await preToolUse(s, call);
  const d = preTool(pre.r);
  must(d !== 'deny', `${who} \`${label(call)}\` must be answered from your saved decision ${saved}; its PreToolUse denied it: ${shown(pre.r)}`);
  if (d === 'pass') {
    const r = await permissionRequest(s, call).done;
    const reply = permissionOf(r);
    if (reply.behavior === 'none' && await lateHook(hub, s.id, 'PermissionRequest', r)) throw new Inconclusive(`${who} deep-hook spooled the PermissionRequest for \`${label(call)}\` late, so the hub never had it`);
    must(reply.behavior === 'allow', `${who} the permission prompt for \`${label(call)}\` must be answered allow from your saved decision ${saved}: ${reply.behavior === 'none' ? 'no decision, so it reaches you in the agent\'s own dialog' : 'deny'} (${shown(r)})`);
    answeredForCallOrSession(who, call, reply);
    applyLikeClaude(w, reply);
  }
  await decidedForYou(hub, since, [label(call)], saved, who);
}

// ---- #23.7232c832: answered for that call or that session only; settings files byte-identical after a week.
export async function weekOfAnswers(o: Run = {}): Promise<void> {
  const w = makeWorld();
  const before = snapshot(w);
  const call = bash('npm run build');
  let hub = await startHub(w, { plant: o.plant, clock: T0 });
  try {
    const s = newSession(w);
    await sessionStart(s);
    const { ask, p } = await firstPrompt(hub, s, call, WEEK);
    await yourAnswer(w, hub, ask, 'allow', WEEK, p);
    const first = permissionOf(await p.done);
    answeredForCallOrSession(WEEK, call, first);
    applyLikeClaude(w, first);
    const saved = await savedFrom(hub, ask, 30_000);
    must(saved !== undefined, `${WEEK} your answer to ${handleOf(ask)} must be saved as a decision (decision.created naming it)`);
    const handle = `decision:${saved.id}`;
    // A week: a new session each day, the hub restarted each morning on the test clock, the same prompt answered for you.
    for (let day = 0; day < 7; day++) {
      if (day > 0) {
        await stopHub(hub);
        hub = await startHub(w, { plant: o.plant, clock: T0 + day * DAY + 3_600_000 });
      }
      const today = newSession(w);
      await sessionStart(today);
      await promptAnswered(w, hub, today, call, handle, `${WEEK} day ${day + 1} of 7:`);
    }
  } finally {
    await stopHub(hub);
  }
  const changed = changedSince(w, before);
  must(!changed.length, `${WEEK} after a week of answers the agent's settings files must be byte-identical; changed: ${changed.join(', ')}`);
}

// ---- #23.02482c32: a prompt whose ask was cancelled gets cancel, never deny.
export async function cancelledPrompt(o: Run = {}): Promise<void> {
  const w = makeWorld();
  const call = bash('make release-notes');
  const hub = await startHub(w, { plant: o.plant, clock: T0 });
  try {
    const s = newSession(w);
    await sessionStart(s);
    const { ask, p } = await firstPrompt(hub, s, call, CANCEL);
    // Nobody answers: the prompt stops waiting when its hold ends, within Claude Code's hook timeout.
    const r = await p.done;
    must(!r.timedOut && r.ms <= PERMISSION_TIMEOUT_MS, `${CANCEL} the PermissionRequest hook for \`${label(call)}\` still waited ${(r.ms / 1000).toFixed(0)} s: Claude Code ends it at ${PERMISSION_TIMEOUT_MS / 1000} s (the facts' hookTimeouts), so its hold must end before`);
    const reply = permissionOf(r);
    must(reply.behavior !== 'deny', `${CANCEL} the prompt for \`${label(call)}\`, whose ask ${handleOf(ask)} nobody answered, gets deny; a cancelled ask gets cancel, never deny (${shown(r)})`);
    must(reply.behavior !== 'allow', `${CANCEL} the prompt for \`${label(call)}\`, whose ask ${handleOf(ask)} nobody answered, was allowed (${shown(r)})`);
    const deadline = Date.now() + 20_000;
    let closing: Ev | undefined;
    for (;;) {
      closing = closingOf(await allEvents(hub), handleOf(ask));
      if (closing || Date.now() > deadline) break;
      await sleep(500);
    }
    must(closing?.kind === 'ask.cancelled', `${CANCEL} ${handleOf(ask)}, the ask of a prompt that stopped waiting, must be cancelled (ask.cancelled); it is ${closing ? closing.kind : 'still open'} 20 s after the hook ended`);
  } finally {
    await stopHub(hub);
  }
}

// ---- #23.3b29ddde: an approval typed in the chat becomes a saved decision only after one click.
export async function typedApproval(o: Run = {}): Promise<void> {
  const w = makeWorld();
  const call = bash('npm run build');
  const hub = await startHub(w, { plant: o.plant, clock: T0 });
  try {
    const s = newSession(w);
    await sessionStart(s);
    const start = await lastPos(hub);
    const { ask, p } = await firstPrompt(hub, s, call, TYPED);
    await typed(s, 'Yes, allow npm run build. Always allow it in this repo from now on.');
    await sleep(5000);
    const early = await decisionsSince(hub, start);
    must(!early.length, `${TYPED} an approval typed in the session must not become a saved decision before your click: ${early.map((e) => `decision:${e.id}`).join(', ')} saved from it`);
    if (p.result) must(permissionOf(p.result).behavior !== 'allow', `${TYPED} the prompt for \`${label(call)}\` was allowed on words typed in the session, before your click (${shown(p.result)})`);
    const closing = closingOf(await allEvents(hub), handleOf(ask));
    must(closing === undefined || closing.kind === 'ask.cancelled', `${TYPED} ${handleOf(ask)}, an authority ask, must not be answered by typed words: it closed as ${closing?.kind} before your click`);
    await yourAnswer(w, hub, ask, 'allow', TYPED, p);
    await p.done;
    const deadline = Date.now() + 30_000;
    let saved: Ev[] = [];
    for (;;) {
      saved = await decisionsSince(hub, start);
      if (saved.length || Date.now() > deadline) break;
      await sleep(250);
    }
    await sleep(2000);
    saved = await decisionsSince(hub, start);
    must(saved.length === 1 && saved[0]!.data?.ask === handleOf(ask), `${TYPED} one click must save exactly one decision, from ${handleOf(ask)}: ${saved.length} saved (${saved.map((e) => `decision:${e.id} from ${String(e.data?.ask)}`).join(', ')})`);
    // It is a saved decision in force: the same prompt in a new session is answered from it.
    const next = newSession(w);
    await sessionStart(next);
    await promptAnswered(w, hub, next, call, `decision:${saved[0]!.id}`, `${TYPED} the next prompt:`);
  } finally {
    await stopHub(hub);
  }
}

// ---- Standing rules at PreToolUse: dependencies and cloud resources the plan doesn't name.
/** An ask raised after `since` for the call: its question names the command, or the package or account it adds. */
async function askFor(hub: Hub, since: number, words: readonly string[]): Promise<Ev | undefined> {
  return (await allEvents(hub)).find((e) => e.kind === 'ask.created' && e.log_pos > since && words.some((n) => String(e.data?.question ?? '').includes(n)));
}
/**
 * "Asked": nothing covers the call, so its PreToolUse denies it while an authority ask about it waits for you, and
 * what the agent reads names that ask. Returns the ask.
 */
async function asked(hub: Hub, s: Session, call: Call, words: readonly string[], who: string): Promise<Ev> {
  const since = await lastPos(hub);
  const { id, r } = await preToolUse(s, call);
  if (await lateHook(hub, s.id, 'PreToolUse', r, id)) throw new Inconclusive(`${who} deep-hook's acknowledgement for \`${label(call)}\` came late, so the hub never decided it`);
  if (preTool(r) !== 'deny') {
    throw Error(`${who} \`${label(call)}\`, which nothing you decided covers, must be asked: its PreToolUse let it through (${preTool(r)}) with no answer of yours (${shown(r)})`);
  }
  let ask: Ev | undefined;
  const deadline = Date.now() + 30_000;
  while (!(ask = await askFor(hub, since, words)) && Date.now() < deadline) await sleep(250);
  must(ask !== undefined, `${who} \`${label(call)}\` must be asked: it was denied (${shown(r)}), but no ask names ${words.join(' or ')}`);
  must(ask.data.kind === 'authority', `${who} the ask for \`${label(call)}\` must be an authority ask: ${handleOf(ask)} is ${String(ask.data.kind)}`);
  const reads = agentReads(r);
  must(reads.includes(handleOf(ask)), `${who} the agent must see why \`${label(call)}\` waits: what it reads must name the ask ${handleOf(ask)}; it reads ${JSON.stringify(reads)}`);
  const closing = closingOf(await allEvents(hub), handleOf(ask));
  must(closing === undefined, `${who} ${handleOf(ask)} must wait for you; it closed as ${closing?.kind}`);
  return ask;
}
/** Your answer to `ask`, saved as a decision for the repo: its handle. */
async function standingRule(w: World, hub: Hub, ask: Ev, decision: 'allow' | 'deny', who: string): Promise<string> {
  await yourAnswer(w, hub, ask, decision, who);
  const saved = await savedFrom(hub, ask, 30_000);
  must(saved !== undefined, `${who} your answer to ${handleOf(ask)} must be saved as a decision (decision.created naming it)`);
  return `decision:${saved.id}`;
}
/**
 * "Answered by your standing rule, and the agent sees why": the call's PreToolUse gives the rule's answer itself
 * (for allow, Claude Code's explicit allow or a pass whose permission prompt is then answered allow; for deny, a
 * deny), what the agent reads cites the rule's decision, and it is decided for you, citing it.
 */
async function byRule(w: World, hub: Hub, s: Session, call: Call, saved: string, decision: 'allow' | 'deny', words: readonly string[], who: string): Promise<void> {
  const since = await lastPos(hub);
  const { id, r } = await preToolUse(s, call);
  if (await lateHook(hub, s.id, 'PreToolUse', r, id)) throw new Inconclusive(`${who} deep-hook's acknowledgement for \`${label(call)}\` came late, so the hub never decided it`);
  const d = preTool(r);
  const reads = [agentReads(r)];
  if (decision === 'deny') {
    must(d === 'deny', `${who} \`${label(call)}\` must be answered by your standing rule ${saved} (no): its PreToolUse let it through (${d}) (${shown(r)})`);
  } else {
    must(d !== 'deny', `${who} \`${label(call)}\` must be answered by your standing rule ${saved} (yes): its PreToolUse denied it (${shown(r)})`);
    if (d === 'pass') {
      const pr = permissionOf(await permissionRequest(s, call).done);
      if (pr.behavior === 'none' && await lateHook(hub, s.id, 'PermissionRequest', pr.raw)) throw new Inconclusive(`${who} deep-hook spooled the PermissionRequest for \`${label(call)}\` late`);
      must(pr.behavior === 'allow', `${who} \`${label(call)}\` must be answered by your standing rule ${saved} (yes): its PreToolUse passed it on and its permission prompt was answered ${pr.behavior} (${shown(pr.raw)})`);
      answeredForCallOrSession(who, call, pr);
      applyLikeClaude(w, pr);
      reads.push(agentReads(pr.raw));
    }
  }
  const text = reads.filter(Boolean).join('\n');
  must(text.includes(saved), `${who} the agent must see the reason \`${label(call)}\` was answered: what it reads must cite your standing rule ${saved}; it reads ${JSON.stringify(text)}`);
  await decidedForYou(hub, since, words, saved, who);
}

// ---- #23.56633035: `npm install` of a package the plan doesn't name is answered by the standing rule, with its reason.
export async function newDependency(o: Run = {}): Promise<void> {
  const w = makeWorld();
  const hub = await startHub(w, { plant: o.plant, clock: T0 });
  try {
    const s = newSession(w);
    await sessionStart(s);
    // No plan names a package. The first new one is asked; you say no, saved for this repo: your standing rule.
    const ask = await asked(hub, s, bash('npm install left-pad'), ['left-pad'], DEPENDENCY);
    const rule = await standingRule(w, hub, ask, 'deny', DEPENDENCY);
    const later = newSession(w);
    await sessionStart(later);
    await byRule(w, hub, later, bash('npm install is-odd'), rule, 'deny', ['is-odd'], DEPENDENCY);
  } finally {
    await stopHub(hub);
  }
}

/** The world with your standing rule for KMS keys in account A: asked once, you said yes, saved for this repo. */
async function kmsRule(w: World, hub: Hub, who: string): Promise<string> {
  const s = newSession(w);
  await sessionStart(s);
  const ask = await asked(hub, s, bash(kms(ACCOUNT_A)), [ACCOUNT_A.id, ACCOUNT_A.profile], who);
  return standingRule(w, hub, ask, 'allow', who);
}

// ---- #23.e3e9bdfd: a cloud resource the plan doesn't name is answered by your standing rule or asked, with why.
export async function cloudResource(o: Run = {}): Promise<void> {
  const w = makeWorld();
  const hub = await startHub(w, { plant: o.plant, clock: T0 });
  try {
    const rule = await kmsRule(w, hub, CLOUD);
    const s = newSession(w);
    await sessionStart(s);
    await byRule(w, hub, s, bash(kms(ACCOUNT_A)), rule, 'allow', [ACCOUNT_A.id], CLOUD);
    // A new account no rule names is asked, the agent told why.
    await asked(hub, s, bash(kms(ACCOUNT_B)), [ACCOUNT_B.id, ACCOUNT_B.profile], CLOUD);
  } finally {
    await stopHub(hub);
  }
}

// ---- #23.15c1cac3: a saved decision never allows a call the session's permission mode or a guard would deny.
export async function modeAndGuard(o: Run = {}): Promise<void> {
  const w = makeWorld();
  const hub = await startHub(w, { plant: o.plant, clock: T0 });
  try {
    const rule = await kmsRule(w, hub, MODE_GUARD);
    // The rule is in force: in a session in the default mode it answers the call.
    const s = newSession(w);
    await sessionStart(s);
    await byRule(w, hub, s, bash(kms(ACCOUNT_A)), rule, 'allow', [ACCOUNT_A.id], MODE_GUARD);
    // A session whose permission mode denies the call: the hook never allows it past the mode.
    for (const mode of ['dontAsk', 'plan'] as Mode[]) {
      const m = newSession(w, mode);
      await sessionStart(m);
      const { r } = await preToolUse(m, bash(kms(ACCOUNT_A)));
      must(preTool(r) !== 'allow', `${MODE_GUARD} your saved decision ${rule} allowed \`${kms(ACCOUNT_A)}\` in a session whose permission mode, ${mode}, denies it: its PreToolUse allowed it past the mode (${shown(r)})`);
    }
    // A guard in block mode denies it before any decision is consulted.
    const g = newSession(w);
    await sessionStart(g);
    const { id, r } = await preToolUse(g, bash(kms(ACCOUNT_A, LOCKOUT_FLAG)));
    if (preTool(r) !== 'deny' && await lateHook(hub, g.id, 'PreToolUse', r, id)) throw new Inconclusive(`${MODE_GUARD} deep-hook let \`${kms(ACCOUNT_A, LOCKOUT_FLAG)}\` through late, so the hub never decided it`);
    must(preTool(r) === 'deny', `${MODE_GUARD} your saved decision ${rule} allowed \`${kms(ACCOUNT_A, LOCKOUT_FLAG)}\`, which your guard ${LOCKOUT_GUARD} denies (${preTool(r)}: ${shown(r)})`);
    must(agentReads(r).includes(LOCKOUT_GUARD), `${MODE_GUARD} \`${kms(ACCOUNT_A, LOCKOUT_FLAG)}\` must be denied by your guard ${LOCKOUT_GUARD}, named in what the agent reads: ${JSON.stringify(agentReads(r))}`);
  } finally {
    await stopHub(hub);
  }
}

// ---- #23.1e4ae1da: with the hub stopped, a standing rule the hub copied into rules.json allows and records the call.
export async function hubStopped(o: Run = {}): Promise<void> {
  const w = makeWorld();
  let hub = await startHub(w, { plant: o.plant, clock: T0 });
  let stopped = false;
  try {
    await kmsRule(w, hub, HUB_DOWN);
    // The hub copies the rule into rules.json; given up to 30 s, the test goes on either way and the calls judge it.
    const rules = join(w.root, 'rules.json');
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && ![ACCOUNT_A.id, ACCOUNT_A.profile].some((n) => readFileSync(rules, 'utf8').includes(n))) await sleep(500);
    await stopHub(hub);
    stopped = true;
    const s = newSession(w);
    await sessionStart(s);
    const a = await preToolUse(s, bash(kms(ACCOUNT_A)));
    const b = await preToolUse(s, bash(kms(ACCOUNT_B)));
    must(preTool(a.r) !== 'deny', `${HUB_DOWN} with the hub stopped, \`${kms(ACCOUNT_A)}\` in account ${ACCOUNT_A.id}, which your standing rule covers, must be allowed; it was denied (${shown(a.r)})`);
    must(preTool(b.r) === 'deny', `${HUB_DOWN} with the hub stopped, \`${kms(ACCOUNT_B)}\` in account ${ACCOUNT_B.id}, which no rule names, must still be denied (${shown(b.r)})`);
    must(/cloud resource/i.test(agentReads(b.r)), `${HUB_DOWN} with the hub stopped, \`${kms(ACCOUNT_B)}\` must be denied with the reason, which names the cloud resource: ${JSON.stringify(agentReads(b.r))}`);
    // Recorded: deep-hook spooled it, and the hub replays it once it is back.
    hub = await startHub(w, { plant: o.plant, clock: T0 + 3_600_000 });
    stopped = false;
    const until = Date.now() + 60_000;
    let recorded = false;
    while (!recorded && Date.now() < until) {
      recorded = (await allEvents(hub)).some((e) => e.kind === 'tool.before' && e.data?.call === a.id);
      if (!recorded) await sleep(500);
    }
    must(recorded, `${HUB_DOWN} \`${kms(ACCOUNT_A)}\`, allowed with the hub stopped, must be recorded: 60 s after the hub came back the record holds no tool.before for its call ${a.id}`);
  } finally {
    if (!stopped) await stopHub(hub);
  }
}

// ---- #23.02482c32 at the adapter: the Claude Code adapter's reply to an answer whose decision is cancel.
const REQUEST: HookRequestLine = {
  v: 1, agent: 'claude', event: 'PermissionRequest', seq: '1793000000000000000', id: '01JB0000000000000000000000', pid: 1, ppid: 1, matched: [],
  payload: { session_id: 's1', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'make release-notes' }, permission_suggestions: alwaysAllow(bash('make release-notes')) },
};
const permissionAnswer = (decision: string, scope: 'call' | 'session' = 'call'): PermissionAnswer =>
  ({ ask: 'ask:01JB0000000000000000000001', session: 's1', option: null, label: null, decision, for: scope, words: null, provisional: false, undoes: null }) as unknown as PermissionAnswer;
type Said = { behavior?: string; updatedPermissions?: { destination?: string }[] } | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const decisionOf = (out: any): Said => out?.hookSpecificOutput?.decision;
const lastingRules = (d: Said) => (d?.updatedPermissions ?? []).filter((u) => u.destination !== 'session');
/** A permission reply: the adapter's, `(answer, request) => hook output`. */
export type Reply = (answer: PermissionAnswer, request: HookRequestLine) => unknown;
/** The scenario, on a reply function: the real adapter's, or a plant's. */
export function cancelGetsCancel(reply: Reply): void {
  const allow = decisionOf(reply(permissionAnswer('allow'), REQUEST));
  must(allow?.behavior === 'allow' && !lastingRules(allow).length, `${CANCEL} an allow must still be an allow, writing no lasting rule: ${JSON.stringify(allow)}`);
  const session = decisionOf(reply(permissionAnswer('allow', 'session'), REQUEST));
  must(session?.behavior === 'allow' && !lastingRules(session).length, `${CANCEL} an allow for the session must allow and write no lasting rule: ${JSON.stringify(session)}`);
  const deny = decisionOf(reply(permissionAnswer('deny'), REQUEST));
  must(deny?.behavior === 'deny', `${CANCEL} a deny must still be a deny: ${JSON.stringify(deny)}`);
  const cancel = decisionOf(reply(permissionAnswer('cancel'), REQUEST));
  must(cancel?.behavior !== 'deny', `${CANCEL} a cancelled ask's prompt gets cancel, never deny: the reply is ${JSON.stringify(cancel)}`);
  must(cancel?.behavior !== 'allow', `${CANCEL} a cancelled ask's prompt is never allowed: the reply is ${JSON.stringify(cancel)}`);
}
