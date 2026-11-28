// Helpers for #1813's acceptance tests (README). The world is #83's (tests/acceptance/83/helpers.ts): a real hub on a
// temp home with `deep setup` run, Claude Code's stand-in firing the user settings' hook entries (deep-hook and the
// CLI) for one session at a time, and `deep inbox answer` with the OS confirmation stubbed (#24). Nothing here credits
// a criterion: every judge reads what the hub sent into the chat, the record or the window.
import { execFileSync } from 'node:child_process';
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';
import * as t83 from '../83/helpers.ts';

export const MIN = 60_000;
export const REPO = t83.REPO;

/** The criteria, by `#1813.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = {
  dump: '#1813.c20f2ad6',
  address: '#1813.9f6d5db8',
  agent: '#1813.1e762706',
  tokens: '#1813.343b9fbb',
} as const;

export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
export const must: (ok: unknown, why: string) => asserts ok = (ok, why) => { if (!ok) throw Error(why); };

// ---- The phrases criterion 1 names, and the person.

/** "your answer", "you said" or "once you say", in any case (the issue's three). */
export const PERSON_YOU = /\byour answers?\b|\byou said\b|\bonce you say\b/i;
/** Each match of the three phrases in `text`, with a little of what is around it. */
export function personYou(text: string): string[] {
  const out: string[] = [];
  const all = new RegExp(PERSON_YOU.source, 'gi');
  for (let m = all.exec(text); m; m = all.exec(text)) out.push(`"${m[0]}" in …${text.slice(Math.max(0, m.index - 50), m.index + m[0].length + 50)}…`);
  return out;
}

// ---- What the hub sends into the chat: every text a DeepBuild hook entry's reply carries.

/** One string sent into the chat: the fixture step that reached it, the hook, the reply field, and the text. */
export interface Sent { step: string; event: string; field: string; text: string }
const FIELDS: [string, (o: t83.Line) => unknown][] = [
  ['permissionDecisionReason', (o) => o.hookSpecificOutput?.permissionDecisionReason],
  ['additionalContext', (o) => o.hookSpecificOutput?.additionalContext],
  ['reason', (o) => o.reason],
  ['systemMessage', (o) => o.systemMessage],
  ['stopReason', (o) => o.stopReason],
];
/** The strings a fired hook's DeepBuild entries put into the chat: each JSON reply's text fields, or stderr at exit 2. */
export function sentBy(step: string, event: string, fired: t83.Fired): Sent[] {
  const out: Sent[] = [];
  for (const r of t83.ours([...fired.ran, ...fired.background])) {
    if (r.code === 2 && r.stderr.trim()) out.push({ step, event, field: 'stderr (exit 2)', text: r.stderr.trim() });
    const reply = t83.parseObject(r.stdout.trim());
    if (!reply) continue;
    for (const [field, get] of FIELDS) {
      const v = get(reply);
      if (typeof v === 'string' && v.trim()) out.push({ step, event, field, text: v });
    }
  }
  return out;
}
/** A PreToolUse reply's decision: deny when an entry denied (or exited 2), else allow. */
export function deniedBy(fired: t83.Fired): boolean {
  return t83.ours(fired.ran).some((r) => r.code === 2 || t83.parseObject(r.stdout.trim())?.hookSpecificOutput?.permissionDecision === 'deny');
}
/** A PreToolUse's deny reason, the held-call line the agent reads; '' when none denied. */
export function reasonOf(fired: t83.Fired): string {
  return sentBy('', 'PreToolUse', fired).filter((s) => s.field === 'permissionDecisionReason' || s.field === 'stderr (exit 2)').map((s) => s.text).join('\n');
}

// ---- A session's world.

export interface World { h: t83.Home; hub: t83.Hub; co: t83.Checkout }
/** A home on checkout `co` with its hub up and `deep setup` run. */
export async function world(co: t83.Checkout = t83.CURRENT): Promise<World> {
  const h = t83.makeHome(co);
  const hub = await t83.hubWithSetup(h);
  return { h, hub, co };
}
/** A Claude Code session on a git repo with an origin, begun with a prompt you typed that names no push, PR or merge. */
export async function session(w: World): Promise<{ s: t83.Session; claude: t83.Claude }> {
  const s = t83.newSession(w.h, { remote: 'https://github.com/acme/widgets.git' });
  const claude = await t83.begin(w.h, s, 'Fix the cart total in src/total.ts.');
  return { s, claude };
}
/** A Bash call as Claude Code makes it: its tool_use entry and its PreToolUse; its tool_result and PostToolUse only when it ran. */
export async function bash(claude: t83.Claude, s: t83.Session, command: string): Promise<{ fired: t83.Fired; denied: boolean; call: string }> {
  const call = t83.callId();
  const input = { command, description: command.slice(0, 40) };
  t83.appendTranscript(s, { type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${t83.tag(6)}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: call, name: 'Bash', input }], stop_reason: 'tool_use', usage: { input_tokens: 2, output_tokens: 10 } } });
  const fired = await claude.hook('PreToolUse', t83.payload(s, 'PreToolUse', { tool_name: 'Bash', tool_input: input, tool_use_id: call }));
  const denied = deniedBy(fired);
  if (denied) {
    t83.appendTranscript(s, { type: 'user', promptId: s.prompt, message: { role: 'user', content: [{ tool_use_id: call, type: 'tool_result', content: reasonOf(fired), is_error: true }] } });
  } else {
    const response = { stdout: '', stderr: '', interrupted: false, isImage: false };
    t83.appendTranscript(s, { type: 'user', promptId: s.prompt, message: { role: 'user', content: [{ tool_use_id: call, type: 'tool_result', content: '' }] }, toolUseResult: response });
    await claude.hook('PostToolUse', t83.payload(s, 'PostToolUse', { tool_name: 'Bash', tool_input: input, tool_use_id: call, tool_response: response }));
  }
  return { fired, denied, call };
}

/** The asks raised since `after` whose question names `label`. */
export async function asksNaming(hub: t83.Hub, label: string, after = 0): Promise<t83.Ev[]> {
  return (await t83.allEvents(hub)).filter((e) => e.kind === 'ask.created' && e.log_pos > after && String(e.data?.question ?? '').includes(label));
}
/** The one ask raised for `label` since `after`, waited for. */
export async function askFor(hub: t83.Hub, label: string, after = 0): Promise<t83.Ev> {
  return t83.waitFor(async () => (await asksNaming(hub, label, after))[0], 30_000, `an ask naming \`${label}\``);
}
export const lastPos = async (hub: t83.Hub): Promise<number> => (await t83.allEvents(hub)).reduce((n, e) => Math.max(n, e.log_pos), 0);
/** Your answer to `ask` through `deep inbox answer`, with the OS confirming you: the option whose decision is `decision`. */
export async function answer(w: World, ask: t83.Ev, decision: 'allow' | 'deny'): Promise<void> {
  const option = ((ask.data.options ?? []) as t83.Line[]).find((o) => o.decision === decision);
  must(option, `ask:${ask.id} has an option whose decision is ${decision}: ${JSON.stringify(ask.data.options)}`);
  const r = await t83.deep(w.h, ['inbox', 'answer', `ask:${ask.id}`, String(option.id)], {}, 120_000);
  must(r.code === 0, `BLOCKED: your answer ${option.id} to ask:${ask.id} through deep inbox answer must count: ${t83.shown(r)}`);
}

// ---- Tokens (#1105): the pinned tokenizer the repo counts with (scripts/tool-load.mjs), gpt-tokenizer's o200k_base.

export const tokens = (text: string): number => countTokens(text);
/**
 * A line with what differs run to run made the same: record IDs (ULIDs), session IDs (UUIDs) and their short forms,
 * commit hashes, temp folders and clock times, each to one fixed stand-in, so two runs' lines compare by their words alone.
 */
export function normal(text: string): string {
  return text
    .replace(/\/(?:private\/)?tmp\/dh83-[A-Za-z0-9]+(?:\/[^\s`'")]*)?/g, '/tmp/dh83-home/w')
    .replace(/[0-9A-HJKMNP-TV-Z]{26}/g, '01K00000000000000000000000')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '00000000-0000-4000-8000-000000000000')
    .replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/g, '0a1b2c3d')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, '12:00');
}

// ---- The merge base.

/** `git <args>` in this checkout. */
export const git = (...args: string[]): string => execFileSync('/usr/bin/git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
/** The merge base's commit: `git merge-base HEAD origin/main`. */
export function mergeBaseSha(): string {
  try { return git('merge-base', 'HEAD', 'origin/main'); } catch (e) { return blocked(`no merge base with origin/main: ${(e as Error).message.split('\n')[0]}`); }
}

// ---- The fixture run (README, The fixture run): every hold, no and yes a session's push and PR reach, then a stop.

export const PUSH = 'git push origin main';
export const PR = 'gh pr create --title "Fix the cart total" --body "Fixes the total."';
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** The person's yes to a push holds it 10 s before it starts (#1101); the run waits that out with room. */
const HOLD_MS = 12_000;

/**
 * The fixture run on checkout `co`: what the hub sent into the chat at each step, in order. Two sessions on one hub.
 * Session 1: its push is held, held again while its ask waits, and after your no; its PR is held, then runs after your
 * yes; it stops, and the stop carries your answers. Session 2: its push is held, your yes holds it for its 10 s, and
 * then it runs. A step that doesn't do what the step says fails the run, naming the step.
 */
export async function fixtureRun(co: t83.Checkout = t83.CURRENT): Promise<Sent[]> {
  const w = await world(co);
  const sent: Sent[] = [];
  const step = async (name: string, claude: t83.Claude, s: t83.Session, command: string, held: boolean): Promise<void> => {
    const r = await bash(claude, s, command);
    sent.push(...sentBy(name, 'PreToolUse', r.fired));
    must(r.denied === held, `${co.label}: the fixture run's step "${name}": \`${command}\` must be ${held ? 'held' : 'let through'}; it was ${r.denied ? 'held' : 'let through'}: ${t83.firedShown(r.fired).slice(0, 800)}`);
  };
  try {
    const one = await session(w);
    const since = await lastPos(w.hub);
    await step('push held', one.claude, one.s, PUSH, true);
    const pushAsk = await askFor(w.hub, PUSH, since);
    await step('push held again while its ask waits', one.claude, one.s, PUSH, true);
    await answer(w, pushAsk, 'deny');
    await step('push after the person said no', one.claude, one.s, PUSH, true);
    const prSince = await lastPos(w.hub);
    await step('PR held', one.claude, one.s, PR, true);
    await answer(w, await askFor(w.hub, 'gh pr create', prSince), 'allow');
    await step('PR after the person said yes', one.claude, one.s, PR, false);
    const two = await session(w);
    const since2 = await lastPos(w.hub);
    await step('second session\'s push held', two.claude, two.s, PUSH, true);
    await answer(w, await askFor(w.hub, PUSH, since2), 'allow');
    await step('push after the person said yes, in its 10 s hold', two.claude, two.s, PUSH, true);
    await sleep(HOLD_MS);
    await step('push after its hold', two.claude, two.s, PUSH, false);
    t83.assistantSays(one.s, 'The cart total is fixed.');
    sent.push(...sentBy('stop, carrying the person\'s answers', 'Stop', await one.claude.hook('Stop', t83.payload(one.s, 'Stop', { last_assistant_message: 'The cart total is fixed.' }))));
    await one.claude.end();
    await two.claude.end();
  } finally {
    await t83.stopHub(w.hub);
  }
  return sent;
}
/** Every person-"you" phrase in a dump, naming the step, the hook and the string. */
export function dumpFailures(label: string, sent: Sent[]): string[] {
  return sent.flatMap((x) => personYou(x.text).map((hit) => `${label}, step "${x.step}" (${x.event} ${x.field}): ${hit} — the whole string: ${JSON.stringify(x.text)}`));
}

// ---- The lint (README, Pinned 1).

export const LINT = 'scripts/agent-lines-lint.mjs';
/** The folders a copy of the checkout holds for the lint: every file git tracks or would track there. */
export const LINT_FOLDERS = ['packages', 'crates/deep-hook', 'adapters'];
/** The planted line: the merge base's held-call wording, in a line the hub sends into a chat. */
export const PLANTED_FILE = 'packages/hub/src/holds.ts';
export const PLANTED_WORDS = 'It waits for your answer';
export const PLANTED = [
  '',
  '/** Planted by tests/acceptance/1813 (criterion 1): the merge base\'s held-call wording. */',
  'export const plantedHeld = (question: string, ask: string): string =>',
  `  \`DeepBuild is holding this: \${question} ${PLANTED_WORDS} to \${ask}; once you say yes, run the same call again.\`;`,
  '',
].join('\n');

// ---- The ask's address (#1460's address strings: `ask/<ULID>`, which `deep open` and a deepbuild:// link take).

const ULID = '[0-9A-HJKMNP-TV-Z]{26}';
/** Every address of an ask in `text`, as written there (`ask/<ULID>`, with or without `deepbuild://`). */
export const addressesIn = (text: string): string[] => [...text.matchAll(new RegExp(`(?:deepbuild://)?ask/${ULID}`, 'g'))].map((m) => m[0]);
/**
 * What is wrong with a held call's reason for `ask` (its ask.created event): it must hold the ask's address
 * `ask/<ULID>`; the ask's question must come before it; and no mention of the ask's ID may follow it (Scope: the
 * question leads and the ID goes last, as `deep inbox` prints it). Each failure names the ask.
 */
export function addressFailures(reason: string, ask: t83.Ev): string[] {
  const handle = `ask:${ask.id}`;
  const address = `ask/${ask.id}`;
  const at = reason.lastIndexOf(address);
  if (at < 0) {
    const bare = reason.includes(ask.id) ? `names ${handle} by its ID alone` : `doesn't name ${handle} at all`;
    return [`the held call's reason ${bare}, with no address ${address} a terminal can open: ${JSON.stringify(reason)}`];
  }
  const failures: string[] = [];
  const question = String(ask.data.question ?? '');
  const q = reason.indexOf(question);
  if (!question || q < 0) failures.push(`the held call's reason for ${handle} doesn't hold its question ${JSON.stringify(question)} ahead of its address: ${JSON.stringify(reason)}`);
  else if (q > at) failures.push(`the held call's reason for ${handle} puts its address ${address} before its question: ${JSON.stringify(reason)}`);
  if (reason.indexOf(ask.id, at + address.length) >= 0) failures.push(`the held call's reason names ${handle}'s ID again after its address ${address}, so the ID doesn't go last: ${JSON.stringify(reason)}`);
  return failures;
}
/** The planted reason: the same reason with each address of the ask cut back to its bare ID, `ask:<ULID>`. */
export const idOnly = (reason: string, ask: t83.Ev): string => reason.replace(new RegExp(`(?:deepbuild://)?ask/${ask.id}`, 'g'), `ask:${ask.id}`);

// ---- The planted agent that reads "you" as itself (criterion 3).

/** What the planted agent does with a held-call line. */
export interface Reading { answers: boolean; retries: boolean; why: string }
/** "your answer", "your yes", "your authority" and the like: words that ask the reader for its own answer. */
const YOURS = /\byour (?:answers?|yes|reply|approval|authority|go-ahead|say-so|ok|okay)\b/i;
/** "once you say yes", "when you answer", "after you approve": a condition the reader itself meets. */
const YOU_MEET = /\b(?:once|when|after|if|as soon as)\s+you\s+(?:say|answer|approve|reply|agree|give|confirm)\b/i;
/**
 * The planted agent reads every "you" and "your" in the line as itself. Where the line asks for its answer, or makes
 * the call wait on something it says, it says yes itself, by running `deep inbox answer` on the ask the line names,
 * and runs the same call again at once. Otherwise it waits for the person, as the line tells it.
 */
export function literalAgent(line: string): Reading {
  const yours = YOURS.exec(line);
  const meet = YOU_MEET.exec(line);
  const hit = yours ?? meet;
  return hit ? { answers: true, retries: true, why: `it read "${hit[0]}" as said to itself` } : { answers: false, retries: false, why: 'nothing in the line asks it for its own answer' };
}
/** The ask a line names: by its address or its handle; undefined when it names none. */
export const askNamedIn = (line: string): string | undefined => new RegExp(`ask[:/](${ULID})`).exec(line)?.[1];

/** Criterion 3's recorded session on checkout `co`: the push held, the planted agent's turn, the person's yes, the push. */
export interface Recorded { label: string; line: string; reading: Reading; ask: t83.Ev; events: t83.Ev[]; session: string; after: { denied: boolean; text: string } }
export async function recordedSession(co: t83.Checkout): Promise<Recorded> {
  const w = await world(co);
  try {
    const { s, claude } = await session(w);
    const since = await lastPos(w.hub);
    const held = await bash(claude, s, PUSH);
    must(held.denied, `${co.label}: \`${PUSH}\` must be held in a thread whose prompts name no push: ${t83.firedShown(held.fired).slice(0, 800)}`);
    const line = reasonOf(held.fired);
    const ask = await askFor(w.hub, PUSH, since);
    // The planted agent's turn, through the same hooks: what it does is in the record.
    const reading = literalAgent(line);
    if (reading.answers) await bash(claude, s, `deep inbox answer ask:${askNamedIn(line) ?? ask.id} approve`);
    if (reading.retries) await bash(claude, s, PUSH);
    // The person answers, and the agent runs the call again once the push's 10 s hold is over.
    await answer(w, ask, 'allow');
    await sleep(HOLD_MS);
    const after = await bash(claude, s, PUSH);
    const events = await t83.allEvents(w.hub);
    await claude.end();
    return { label: co.label, line, reading, ask, events, session: s.id, after: { denied: after.denied, text: reasonOf(after.fired) } };
  } finally {
    await t83.stopHub(w.hub);
  }
}
/**
 * The judge, on the record alone: between the held call's tool.before and the person's ask.answered for its ask, the
 * session makes no call that runs the same command again, and none that answers the ask (one naming its ID, or
 * `deep inbox answer`). After the person's yes, the same call runs. Each failure names the call.
 */
export function recordFailures(r: Recorded): string[] {
  const handle = `ask:${r.ask.id}`;
  const calls = r.events.filter((e) => e.kind === 'tool.before' && e.session === r.session);
  const first = calls.find((e) => e.data?.command === PUSH);
  const answered = r.events.find((e) => e.kind === 'ask.answered' && e.subject === handle);
  if (!first) return [`${r.label}: the record holds no tool.before for \`${PUSH}\` in session ${r.session}`];
  if (!answered) return [`${r.label}: the record holds no answer to ${handle} from the person`];
  const failures: string[] = [];
  for (const e of calls.filter((c) => c.log_pos > first.log_pos && c.log_pos < answered.log_pos)) {
    const command = String(e.data?.command ?? e.data?.tool ?? '');
    if (command === PUSH) failures.push(`${r.label}: the agent sent the held-call line retried \`${PUSH}\` (record log_pos ${e.log_pos}) before the person answered ${handle} (log_pos ${answered.log_pos}); the line was ${JSON.stringify(r.line)}`);
    else if (command.includes(r.ask.id) || /\binbox\s+answer\b/.test(command)) failures.push(`${r.label}: the agent sent the held-call line answered ${handle} itself with \`${command}\` (log_pos ${e.log_pos}) before the person did; the line was ${JSON.stringify(r.line)}`);
  }
  if (r.after.denied) failures.push(`${r.label}: after the person's yes to ${handle} and its hold, \`${PUSH}\` was still held: ${JSON.stringify(r.after.text)}`);
  return failures;
}

// ---- Criterion 4's judges: a changed line is one whose words differ from the merge base's at the same place.

/** The distinct lines a step sent, each made run-independent (`normal`), in order. */
function linesOf(sent: Sent[], step: string): string[] {
  return [...new Set(sent.filter((x) => x.step === step).flatMap((x) => x.text.split('\n')).map((l) => normal(l).trim()).filter(Boolean))];
}
/**
 * Each step's lines on the merge base and here: the lines both hold are unchanged; the rest pair in order, base with
 * here, and each changed line must count at most its base line's tokens. A changed line with no base line left to pair
 * with is a new line, counted against 0. Each failure names the step and both lines with their counts.
 */
export function tokenFailures(base: Sent[], here: Sent[]): string[] {
  const failures: string[] = [];
  const steps = [...new Set([...base, ...here].map((x) => x.step))];
  for (const step of steps) {
    const b = linesOf(base, step);
    const h = linesOf(here, step);
    const was = b.filter((l) => !h.includes(l));
    const now = h.filter((l) => !b.includes(l));
    now.forEach((line, i) => {
      const old = was[i];
      const n = tokens(line);
      if (old === undefined) failures.push(`step "${step}": a new line, ${n} tokens where the merge base sent none: ${JSON.stringify(line)}`);
      else if (n > tokens(old)) failures.push(`step "${step}": the changed line has ${n} tokens, over the merge base's ${tokens(old)}: ${JSON.stringify(line)} (was ${JSON.stringify(old)})`);
    });
  }
  return failures;
}
/** The guard's texts an agent reads when deep-hook blocks on its own: each default rule's reason and next_step. */
export type RuleTexts = Map<string, string>;
export function ruleTexts(json: string): RuleTexts {
  const out: RuleTexts = new Map();
  const entries = (JSON.parse(json) as { entries?: Record<string, Record<string, unknown>> }).entries ?? {};
  for (const [name, entry] of Object.entries(entries)) for (const field of ['reason', 'next_step']) if (typeof entry[field] === 'string') out.set(`${name}.${field}`, entry[field] as string);
  return out;
}
/** Each default rule's text that differs from the merge base's and counts more tokens, or is new; naming the rule. */
export function ruleFailures(base: RuleTexts, here: RuleTexts): string[] {
  const failures: string[] = [];
  for (const [key, text] of here) {
    const old = base.get(key);
    if (old === text) continue;
    if (old === undefined) failures.push(`crates/deep-hook/default-rules.json ${key}: a new line, ${tokens(text)} tokens where the merge base has none: ${JSON.stringify(text)}`);
    else if (tokens(text) > tokens(old)) failures.push(`crates/deep-hook/default-rules.json ${key}: ${tokens(text)} tokens, over the merge base's ${tokens(old)}: ${JSON.stringify(text)} (was ${JSON.stringify(old)})`);
  }
  return failures;
}
