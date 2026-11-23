// #667 AC1 and AC2, redrafted blind at 37dd3c0c8 from issue #667, the design and the base (README.md). The world is
// the earlier #667 suite's (../helpers.ts: a real hub in a temp home under /tmp/dh667-*, the OS confirmation stubbed
// to confirm, the agent stand-in with its hooks and its own `deep mcp`, the stream consumer, the proof). Two changes:
// the choice ask is read from the record whether deep_ask returns at once (a choice with a recommendation goes on
// provisionally, as the design says) or waits; and the stand-in's later hooks are sent here, each reply written into
// its transcript as Claude Code writes a hook's reply, so every route the answer could take back is watched. Each
// scenario runs against the real hub, or against the planted wrong program `plant` names (DEEP_HUB_PLANT), and every
// failure it throws starts with its criterion's ID.

import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { expect } from 'vitest';
import {
  Agent, closings, decisionsOf, deep, events, expectFramed, HOUR, inboxRead, load, makeHome, pending, Proof, question, SECOND,
  sleep, startHub, Stream, ulid, writeSettings, type Ev, type Hub, type Line, type Outcome, type Ran,
} from '../helpers.ts';

// The criteria, by the IDs scripts/proof-change.mjs computes from the issue's text (README: Criterion IDs).
export const AC1 = '#667.254d6157';
export const AC2 = '#667.8700acae';

const MINUTE = 60 * SECOND;
const DAY = 24 * HOUR;
/** Options of the issue's choice ask; `sqlite` is recommended, so it is the default (#319's drafted `recommended`). */
const OPTIONS: [string, string][] = [['sqlite', 'SQLite'], ['files', 'Plain files']];

/** A reading only load could have spoiled: the test is skipped with it, never passed (AGENTS.md, Proof). */
export class Inconclusive extends Error {}

/** Runs `body`, so that every failure it throws starts with `tag`, a BLOCKED world included. */
async function tagged(tag: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (error) {
    if (error instanceof Inconclusive) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith(tag)) throw error;
    throw new Error(`${tag}: ${message}`);
  }
}

// ---- `deep inbox`, read for what a person sees, not its exact words.
const letters = (s: string): string => s.replace(/[^0-9A-Za-z]/g, '');
/** The line of `deep inbox`'s text that names the ask by its ULID (its handle or its link), other than a "decided for you" line. */
export const lineOf = (stdout: string, ulidOf: string): string | undefined =>
  stdout.split('\n').find((l) => new RegExp(`(^|[^0-9A-Za-z])${ulidOf}([^0-9A-Za-z]|$)`).test(l) && !/^\s*decided for you\b/i.test(l));
/** The session named by its ID: a field holding the ID's first 8 letters and digits (the whole ID included). */
const namesSession = (text: string, session: string): boolean =>
  text.split(/[\s·,;()[\]<>|]+/).some((t) => letters(t).includes(letters(session).slice(0, 8)));
/** Every age the text shows, as [count, unit in ms]: `0s`, `12s`, `3m`, `2h`, `1d`, `5 seconds ago`, `just now`. */
function ages(text: string): [number, number][] {
  const out: [number, number][] = [];
  if (/\bjust now\b/i.test(text)) out.push([0, MINUTE]);
  const size = { s: SECOND, m: MINUTE, h: HOUR, d: DAY } as const;
  for (const m of text.matchAll(/(?:^|[\s·(,])(\d+)\s?(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)(?:\s+ago)?(?=$|[\s·),;])/g)) {
    out.push([Number(m[1]), size[m[2]![0] as keyof typeof size]]);
  }
  return out;
}

// ---- The agent stand-in's later hooks, its transcript written as Claude Code writes a hook's reply.
/** What one hook's reply said: the hook's stdout, as deep-hook would print it to the agent. */
export interface Reply { step: string; stdout: string }
let seq = BigInt(Date.now() + 600_000) * 1_000_000n;   // above every seq the stand-in's own hooks used
/**
 * One hook from the agent's own process, as `Agent.establish` sends its first three; then, as Claude Code does, a
 * reply's context or block reason goes into the session's transcript, where the hub reads whether a turn carried it.
 */
async function hook(agent: Agent, hub: Hub, step: string, event: string, extra: Line): Promise<Reply> {
  if (event === 'UserPromptSubmit') appendFileSync(agent.transcript, `${JSON.stringify({ type: 'user', sessionId: agent.session, cwd: agent.cwd, uuid: randomUUID(), message: { role: 'user', content: String(extra.prompt) } })}\n`);
  const payload: Line = { session_id: agent.session, transcript_path: agent.transcript, cwd: agent.cwd, hook_event_name: event, permission_mode: 'default', ...extra };
  const request = { v: 1, agent: 'claude-code', event, seq: String(seq += 1000n), id: ulid(), matched: [], payload };
  // ../helpers.ts's Agent has no public way to send a hook other than establish's fixed three, and a hook client run
  // from this test process would have the test, not the agent, as its parent: the stand-in's own command channel
  // (its private `send`, the one establish uses) is the only route that keeps the agent above the hook (README).
  const sender = agent as unknown as { send(command: Line): Promise<Line> };
  const r = await sender.send({ op: 'hook', socket: hub.socket, request, cwd: agent.cwd });
  const lines = ((r.lines as string[] | undefined) ?? []).map((l) => { try { return JSON.parse(l) as Line; } catch { return {}; } });
  if (!lines.some((l) => typeof l.ack === 'string')) throw Error(`BLOCKED: the hub didn't acknowledge ${event} (${step}) from the agent: ${JSON.stringify(r).slice(0, 1500)}`);
  const stdout = String(lines.find((l) => 'exit' in l)?.stdout ?? '');
  let out: Line = {};
  try { out = stdout ? JSON.parse(stdout) as Line : {}; } catch { /* plain text */ }
  const context = out.hookSpecificOutput?.additionalContext;
  if (typeof context === 'string' && context) appendFileSync(agent.transcript, `${JSON.stringify({ type: 'attachment', sessionId: agent.session, uuid: randomUUID(), attachment: { type: 'hook_additional_context', hookEvent: event, content: [context] } })}\n`);
  if (out.decision === 'block' && typeof out.reason === 'string') appendFileSync(agent.transcript, `${JSON.stringify({ type: 'user', sessionId: agent.session, uuid: randomUUID(), isMeta: true, message: { role: 'user', content: `${event} hook feedback:\n${out.reason}` } })}\n`);
  return { step, stdout };
}
/** One tool call of the agent's turn: its PreToolUse and its PostToolUse. */
async function toolCall(agent: Agent, hub: Hub, step: string, command: string): Promise<Reply[]> {
  const call = { tool_name: 'Bash', tool_input: { command }, tool_use_id: `toolu_${randomUUID()}` };
  return [
    await hook(agent, hub, `${step}: PreToolUse ${command}`, 'PreToolUse', call),
    await hook(agent, hub, `${step}: PostToolUse ${command}`, 'PostToolUse', { ...call, tool_response: { stdout: '', stderr: '', interrupted: false } }),
  ];
}
/** The agent's turn ending: its Stop, and when the hub holds it, the Stop Claude Code sends after the held turn goes on. */
async function stops(agent: Agent, hub: Hub, step: string): Promise<Reply[]> {
  const first = await hook(agent, hub, `${step}: Stop`, 'Stop', { stop_hook_active: false, last_assistant_message: 'Done.' });
  await sleep(4000);   // the hub reads the transcript for the reply it carried (its own 2 s read, with room under load)
  return [first, await hook(agent, hub, `${step}: Stop after the hold`, 'Stop', { stop_hook_active: true, last_assistant_message: 'Done.' })];
}

// ---- The world: a hub, the agent stand-in, the stream consumer from before the ask, and the choice ask it raises.
interface World {
  home: string; hub: Hub; agent: Agent; stream: Stream; proof: Proof;
  created: Ev; handle: string; call: Promise<{ returned?: Outcome; failed?: string }>; polls: Ran[];
}
/**
 * The choice ask raised by the agent's deep_ask while you run `deep inbox` back to back, from before the raise until a
 * run lists it. The call may return at once (provisional) or wait for your answer; either way the hub must file the
 * ask within 30 s (else BLOCKED), and it is read from the record.
 */
async function world(tag: string, plant: string | undefined, proof: Proof, text: string): Promise<World> {
  const home = makeHome();
  writeSettings(home);
  const agent = Agent.start(home);
  const hub = await startHub(home, { confirm: 'confirmed', plant });
  await agent.establish(hub);
  await agent.initialize();
  // The App API's read gives the log position the stream subscribes after, so the consumer misses nothing after it.
  const before = await inboxRead(hub);
  if (typeof before.log_pos !== 'number') throw Error(`BLOCKED: inbox.read reflects no log_pos to subscribe after: ${JSON.stringify(before).slice(0, 500)}`);
  const stream = await Stream.open(hub, before.log_pos);
  const polls: Ran[] = [];
  let stop = false;
  const polling = (async () => {
    for (const until = Date.now() + 60_000; !stop && Date.now() < until;) {
      const r = await deep(home, ['inbox']);
      polls.push(r);
      if (r.stdout.includes(text)) return;
    }
  })();
  const call = pending(agent.tool('deep_ask', question('choice', text, OPTIONS, 'sqlite'), 150_000));
  let ended: { returned?: Outcome; failed?: string } | undefined;
  void call.then((r) => (ended = r));
  let created: Ev | undefined;
  for (const until = Date.now() + 30_000; !created && Date.now() < until; await sleep(100)) {
    created = (await events(hub)).find((e) => e.kind === 'ask.created' && e.data?.question === text);
    if (!created && ended && (ended.failed !== undefined || ended.returned?.isError)) break;
  }
  if (!created) {
    stop = true;
    await polling;
    throw Error(`BLOCKED: the hub filed no ask.created for deep_ask "${text}": ${JSON.stringify(ended?.returned?.reply ?? ended?.failed ?? 'still waiting after 30 s').slice(0, 1500)}`);
  }
  await Promise.race([polling, sleep(30_000)]);
  stop = true;
  await polling;
  for (const r of polls) proof.ran(`deep inbox, run from ${r.t0 - created.ts} to ${r.t1 - created.ts} ms after the ask's append`, r);
  const handle = `ask:${created.id}`;
  expect({ kind: created.data.kind, session: created.session, deadline: created.data.deadline - created.ts, default: created.data.default },
    `${tag}: ${handle} is the issue's choice ask, raised by session ${agent.session}, with a 4-hour deadline and its recommended option, sqlite, as its default`)
    .toEqual({ kind: 'choice', session: agent.session, deadline: 4 * HOUR, default: 'sqlite' });
  return { home, hub, agent, stream, proof, created, handle, call, polls };
}

// ---- AC1: the choice ask listed by `deep inbox` within a second of its append, and framed at its log position.
export const ac1 = (plant?: string): Promise<void> => tagged(AC1, async () => {
  const proof = new Proof(`${AC1}${plant ? ` on ${plant}` : ''} (redraft-3178)`);
  let w: World | undefined;
  try {
    w = await world(AC1, plant, proof, 'Keep the invoices on SQLite or plain files?');
    const { created, handle, polls, agent, stream } = w;
    const id = created.id;
    const appended = created.ts;
    for (const r of polls) expect(r.code, `${AC1}: deep inbox exits 0: ${r.stdout}${r.stderr}`).toBe(0);
    // Every run started a second or more after the append lists the ask.
    for (const r of polls.filter((p) => p.t0 >= appended + SECOND)) {
      expect(lineOf(r.stdout, id), `${AC1}: deep inbox run ${r.t0 - appended} ms after ${handle}'s append doesn't list it: ${r.stdout}`).toBeDefined();
    }
    const first = polls.find((r) => lineOf(r.stdout, id) !== undefined);
    expect(first, `${AC1}: deep inbox listed ${handle} within 30 s of its append: ${polls.at(-1)?.stdout}`).toBeDefined();
    // The ask's line: its kind, its session and its age, besides its question and its handle.
    const line = lineOf(first!.stdout, id)!;
    const rest = line.split(String(created.data.question)).join(' ').split(handle).join(' ').split(`deepbuild://ask/${id}`).join(' ').split(id).join(' ');
    expect(/\bchoice\b/i.test(rest), `${AC1}: deep inbox lists ${handle} with its kind, a choice: ${line}`).toBe(true);
    expect(namesSession(rest, agent.session), `${AC1}: deep inbox lists ${handle} with its session, ${agent.session}: ${line}`).toBe(true);
    const [lo, hi] = [Math.max(0, first!.t0 - appended), Math.max(0, first!.t1 - appended)];
    expect(ages(rest).some(([n, unit]) => n * unit <= hi && (n + 1) * unit > lo), `${AC1}: deep inbox lists ${handle} with its age, the time since its append when it ran (${lo} to ${hi} ms): ${line}`).toBe(true);
    // The stream's consumer gets the ask's frame at the log position the record holds its append at.
    await expectFramed(AC1, stream, created, `the choice ask ${handle}`);
    // Within a second: the run that first listed it ended within 1,000 ms of the append. One that started in time but
    // ended later, under load, is only a reading; no run started a second after the append missed it (above).
    const latency = first!.t1 - appended;
    proof.note('the first listing', `deep inbox first listed ${handle} in a run from ${first!.t0 - appended} to ${latency} ms after its append (load ${load()})`);
    if (latency > SECOND) throw new Inconclusive(`INCONCLUSIVE ${AC1}: the first deep inbox run that listed ${handle} started ${first!.t0 - appended} ms after its append and ended at ${latency} ms, past the second, at load ${load()}; no run started a second after the append missed it`);
  } finally {
    await proof.close(w?.hub, w?.stream);
    w?.stream.close();
  }
});

// ---- AC2: your answer, saved as a decision with its scope; the ask gone; the stream; the agent hearing it once.
/** The replies (and the deep_ask outcome) that carry the ask's answer to the agent: they name the ask's ULID. */
const carrying = (replies: readonly Reply[], id: string): Reply[] => replies.filter((r) => r.stdout.includes(id));

export const ac2 = (plant?: string): Promise<void> => tagged(AC2, async () => {
  const proof = new Proof(`${AC2}${plant ? ` on ${plant}` : ''} (redraft-3178)`);
  let w: World | undefined;
  const replies: Reply[] = [];
  try {
    w = await world(AC2, plant, proof, 'Keep the receipts on SQLite or plain files?');
    const { home, hub, agent, stream, created, handle, call } = w;
    const id = created.id;
    const answered = await deep(home, ['inbox', 'answer', handle, 'files']);
    proof.ran(`deep inbox answer ${handle} files, the OS confirming you`, answered);
    expect(answered.code, `${AC2}: deep inbox answer ${handle} files, the OS confirming you, exits 0: ${answered.stdout}${answered.stderr}`).toBe(0);
    await sleep(500);
    let all = await events(hub);

    // One answer, saved as one decision at the ask's scope: its session's repo, or its session where it has none.
    const project = created.project ?? all.find((e) => e.kind === 'session.start' && e.session === agent.session && e.project)?.project;
    const scope = project ? `repo:${letters(project)}` : `session:${letters(agent.session)}`;
    const answer = closings(all, handle);
    expect(answer.map((e) => [e.kind, e.data.answer]), `${AC2}: ${handle} is answered once, files`).toEqual([['ask.answered', 'files']]);
    expect(decisionsOf(all, handle).map((e) => [e.kind, e.data.answer, e.data.scope]), `${AC2}: your answer to ${handle} is saved as one decision with its scope, ${scope}`)
      .toEqual([['decision.created', 'files', scope]]);

    // The ask leaves deep inbox.
    const after = await deep(home, ['inbox']);
    proof.ran('deep inbox, after your answer', after);
    expect(after.code, `${AC2}: deep inbox exits 0 after the answer: ${after.stdout}${after.stderr}`).toBe(0);
    expect(lineOf(after.stdout, id), `${AC2}: ${handle} leaves deep inbox once answered: ${after.stdout}`).toBeUndefined();

    // The stream shows it answered, at the log position the record holds the answer at.
    await expectFramed(AC2, stream, answer[0]!, `${handle} answered`);

    // The agent's turn goes on, ends, and a next turn runs: every route back into the session is watched.
    replies.push(...await toolCall(agent, hub, 'after your answer', 'ls'));
    await sleep(3000);
    replies.push(...await toolCall(agent, hub, 'after your answer', 'git status'));
    replies.push(...await stops(agent, hub, 'after your answer'));
    await sleep(3000);
    replies.push(await hook(agent, hub, 'the next turn: UserPromptSubmit', 'UserPromptSubmit', { prompt: 'now the receipts page', prompt_id: randomUUID() }));
    replies.push(...await toolCall(agent, hub, 'the next turn', 'ls'));
    replies.push(...await stops(agent, hub, 'the next turn'));
    // deep_ask itself, if it waited for the answer rather than going on at once.
    const got = await Promise.race([call, sleep(5000).then(() => undefined)]);
    proof.note('deep_ask, as the agent got it', JSON.stringify(got?.returned?.value ?? got ?? 'still waiting'));
    const viaCall = got?.returned?.value?.status === 'answered' ? [{ step: 'the deep_ask call\'s own reply', stdout: JSON.stringify(got.returned.value) }] : [];
    const heard = [...viaCall, ...carrying(replies, id)];
    expect(heard.map((r) => r.step), `${AC2}: the agent that raised ${handle} got your answer ${heard.length} times, once expected: ${JSON.stringify(heard)}`).toHaveLength(1);
    expect(/\bfiles\b|Plain files/.test(heard[0]!.stdout), `${AC2}: what the agent got for ${handle} is your answer, files: ${heard[0]!.stdout}`).toBe(true);

    // Once: a second answer is refused and recorded as refused, and nothing of it reaches the agent.
    const again = await deep(home, ['inbox', 'answer', handle, 'sqlite']);
    proof.ran(`deep inbox answer ${handle} sqlite, a second answer`, again);
    expect(again.code, `${AC2}: a second answer to ${handle} is refused (a non-zero exit): ${again.stdout}${again.stderr}`).not.toBe(0);
    const later: Reply[] = [];
    later.push(...await toolCall(agent, hub, 'after the second answer', 'ls'));
    later.push(...await stops(agent, hub, 'after the second answer'));
    replies.push(...later);
    expect(carrying(later, id).map((r) => r.step), `${AC2}: after the refused second answer, nothing of ${handle} reaches the agent: ${JSON.stringify(carrying(later, id))}`).toEqual([]);
    all = await events(hub);
    expect(closings(all, handle).map((e) => [e.kind, e.data.answer]), `${AC2}: ${handle} keeps one answer, files, after the second`).toEqual([['ask.answered', 'files']]);
    expect(decisionsOf(all, handle).length, `${AC2}: ${handle} keeps one decision after the second answer`).toBe(1);
    expect(all.filter((e) => e.kind === 'answer.refused' && (e.subject === handle || e.data?.ask === handle)).length, `${AC2}: the second answer to ${handle} is recorded as one answer.refused`).toBe(1);
  } finally {
    proof.note('the agent\'s hooks after your answer: each reply\'s stdout', replies.map((r) => `${r.step}\t${r.stdout || '(empty)'}`).join('\n'));
    if (w) await events(w.hub).then((all) => proof.note('the record: delivery rows', all.filter((e) => e.kind.startsWith('delivery.')).map((e) => `${e.log_pos}\t${e.kind}\t${JSON.stringify(e.data)}`).join('\n')), () => undefined);
    await proof.close(w?.hub, w?.stream);
    w?.stream.close();
  }
});

