import type { HubEvents } from './hub-capabilities.js';
import type { AnswerDeliveryPort, StopJudgingPort, SessionMemoryPort, SessionStatePort, McpOperationsPort } from './hub-ports.js';
import { execFile } from 'node:child_process';


import { AskRefused, duration, type Asks } from '@deepbuild/asks';
import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';

import { type RecordStore } from '@deepbuild/record';
import { type Checkouts } from '@deepbuild/gate';

import { listRows } from './rows.js';
import type { HubCanvas } from './hub-canvas.js';

import { dropKept, syncRejected } from './memory.js';
import { AskTasks } from './ask-tasks.js';
import { opensOf } from './questions.js';
import { type Reach } from './could-do.js';

import { type Root } from './paths.js';

import { Teardowns } from './teardowns.js';

import { type ChannelAsk } from './channels.js';

import { OpenItems } from './open-items.js';
import { Runs } from './runs.js';

import { refuse, Refused, refusal, ulid, type CoreOptions, type HookMeta } from './wire.js';
import type { CallContext } from './session-types.js';

import { letters, LATER_BEFORE_MS, signInCommands, type Obj, asRefused } from "./hub-shared.js";
import type { HumanControlPort } from './human-control-port.js';
export interface HumanAnswersOptions {
 settings: CoreOptions;
 services: {
readonly asks: Asks;
readonly record: RecordStore;
readonly now: () => number;
readonly teardowns: Teardowns;
readonly openItems: OpenItems;
readonly raw: RecordStore['raw'];
readonly root: Root;
readonly checkouts: Checkouts;
readonly runs: Runs;
readonly tasks: AskTasks;
readonly canvasSide: Pick<HubCanvas, "explainsOf">;
 };
 events: Pick<HubEvents, "connection" | "appendCore" | "appendReading" | "append">;

delivery: () => Pick<AnswerDeliveryPort, "openOffers" | "switches">;
 control: () => Pick<HumanControlPort, "trusted">;
judging: () => Pick<StopJudgingPort, "reachOfSession" | "runEnded" | "turnTaskOf">;
mcp: () => Pick<McpOperationsPort, "checksOf">;
state: () => Pick<SessionStatePort, "liveOf" | "sessions">;
memory: () => Pick<SessionMemoryPort, "syncStanding">;
}

export class HumanAnswers {
 constructor(private readonly options: HumanAnswersOptions) {}

  /**
   * The revision an answer to an ask is given on, which deep-confirm's signature covers (#880): the commit its session's
   * worktree moved on to, or else what it was pinned to.
   */
  async revisionOf(handle: string, ask: { pinned_to?: { ref?: string } | undefined }): Promise<string> {
    const changed = await this.options.services.asks.card(handle).then((card) => card.changed?.to, () => undefined);
    return changed ?? ask.pinned_to?.ref ?? 'unpinned';
  }

  /** Every ask, as the inbox projection holds it, with each one's question and options; `deep inbox` lists the open ones. */
  async inbox(): Promise<Obj> {
    const rows = (await this.options.services.record.raw('SELECT id, question, options FROM asks')) as { id: string; question: string | null; options: string | null }[];
    const texts = new Map(rows.map((r) => [r.id, r]));
    // What each decision answered, for the asks it decided for you (#27).
    const saved = new Map(((await this.options.services.record.raw('SELECT id, answer FROM decisions')) as { id: string; answer: string | null }[]).map((d) => [`decision:${d.id}`, d.answer === null ? null : JSON.parse(d.answer) as string]));
    // An authority ask's plan, by the digest an approval binds: what `deep inbox` shows before you answer (#69).
    // The first the core proposed for each ask, as the asks core holds it; an agent's plan.proposed binds nothing.
    const plans = (await this.options.services.record.raw("SELECT data FROM events WHERE kind = 'plan.proposed' AND writer = 'core' ORDER BY log_pos")) as { data: string }[];
    const planOf = new Map<string, { hash: string; steps: unknown }>();
    for (const { data } of plans) {
      const d = JSON.parse(data) as { ask: string; hash: string; steps: unknown };
      if (!planOf.has(d.ask)) planOf.set(d.ask, { hash: d.hash, steps: d.steps });
    }
    return {
      asks: (await this.options.services.asks.inbox()).map((row) => {
        const text = texts.get(row.ask.slice(4));
        const url = this.options.settings.plant === 'link-from-agent-url' ? /https?:\/\/\S+/.exec(text?.question ?? '')?.[0] : undefined;
        const opens = row.kind === 'unblock' && text?.question ? opensOf(text.question, signInCommands()) : undefined;
        return {
          ...row, ...(opens ? { opens } : {}), ...(url ? { link: url } : {}), question: text?.question ?? '', options: text?.options ? (JSON.parse(text.options) as { id: string }[]).map((o) => o.id) : [], plan: planOf.get(row.ask) ?? null,
          ...(row.outcome === 'decided_for_you' && row.decision ? { answer: saved.get(row.decision) ?? null } : {}),
        };
      }),
      // Permissions you said yes to in the terminal, offered back as decisions to save: never asks (#23).
      offers: await this.options.delivery().openOffers(),
      // The open asks' rows, as every reader of the list holds them (#1463).
      rows: (await listRows((q) => this.options.services.record.raw(q))).filter((p) => p.row.id.startsWith('ask:')).map((p) => p.row) as unknown as Obj[],
    };
  }

  /** How many hand-backs went back with the tool to use, over the ones the check ran on: a reading, never a pass or a fail (#84). */
  async handbacks(): Promise<Obj> {
    const rows = (await this.options.services.record.raw(`SELECT session_id, json_extract(data, '$.reading') AS reading FROM events WHERE kind = 'session.reading' AND json_extract(data, '$.reading') LIKE 'Hand-back %' ORDER BY log_pos`)) as { session_id: string; reading: string }[];
    const detail = rows.map((r) => ({ session: r.session_id, sent_back: r.reading.startsWith('Hand-back sent back'), reading: r.reading }));
    return { id: 'handbacks_sent_back', label: 'Hand-backs sent back with the tool to use', value: detail.filter((d) => d.sent_back).length, unit: 'count', source: 'record', age_ms: 0, basis: 'observed', of: detail.length, detail };
  }

  /** The question card's document (#84): the asks core's card, with the ask's text and where a task sends you. A URL in the text stays plain text. */
  async askCard(params: Obj): Promise<Obj> {
    const handle = params.ask;
    if (typeof handle !== 'string' || !/^ask:[0-9A-Za-z]+$/.test(handle)) throw new Refused(refusal('handle_syntax', '/params/ask', 'Name the ask by its handle, ask:<id>.', handle));
    const [row] = (await this.options.services.record.raw(`SELECT question FROM asks WHERE id = ?`, [handle.slice(4)])) as { question: string | null }[];
    if (!row) throw new Refused(refusal('not_found', '/params/ask', `No ask ${handle}.`, handle));
    const card = await this.options.services.asks.card(handle);
    const question = row.question ?? '';
    const opens = card.kind === 'unblock' ? opensOf(question, signInCommands()) : undefined;
    const url = this.options.settings.plant === 'link-from-agent-url' ? /https?:\/\/\S+/.exec(question)?.[0] : undefined;
    // The card's revision, which an answer from this copy names (#1580).
    const revision = (await this.cards(handle)).get(handle)?.revision ?? 1;
    // #504: what the agent drew on the ask shows beside it when you open it, as an explanation; never an ask itself.
    // `explains` is the first blind draft's name for the same list (tests/acceptance/504/ac2-explains.test.ts).
    const beside = await this.options.services.canvasSide.explainsOf(handle);
    return { ...card, question, revision, ...(opens ? { opens } : {}), ...(url ? { link: url } : {}), beside, explains: beside };
  }

  /**
   * asks/:id/answer, from the app or `deep inbox answer`: once the trusted path allows it, the asks core records it
   * and the core saves it as a decision for the ask's repo, or its session; an ask with neither, and a block's task
   * (#85), saves none.
   */
  async answer(params: Obj, context: CallContext, channel?: { channel: string; proof: 'device' | 'account_link'; plan_hash: string | null }): Promise<Obj> {
    const { ask: handle, device: _device, signature: _signature, revision, ...input } = params;
    if (typeof handle !== 'string' || !/^ask:[0-9A-Za-z]+$/.test(handle)) throw new Refused(refusal('handle_syntax', '/params/ask', 'Name the ask by its handle, ask:<id>, as deep inbox lists it.', handle));
    const [row] = (await this.options.services.record.raw(`SELECT e.session_id AS session, e.project_id AS project, e.data AS data, a.status AS status FROM events e JOIN asks a ON a.id = e.id WHERE e.id = ? AND e.kind = 'ask.created'`, [handle.slice(4)])) as { session: string | null; project: string | null; data: string; status: string }[];
    if (!row) throw new Refused(refusal('not_found', '/params/ask', `No ask ${handle}; answer an ask deep inbox lists.`, handle));
    // A channel's answer with an account link (#65) is the asks core's as `channel`: that ask alone, never a decision.
    const writer = channel?.proof === 'account_link' ? 'channel' : context.role === 'app' ? 'app' : 'cli';
    const answered = (): Promise<void> => this.options.services.asks.answer(this.options.events.connection(writer), handle, input).catch((error: unknown) => { throw asRefused(error); });
    // A closed ask takes no answer: the asks core records the refusal, and there's nothing to confirm you for. The
    // first answer appended stands, and the refusal names it and where it came from (#65).
    if (row.status !== 'open' && row.status !== 'later') {
      const first = row.status === 'answered' ? await this.firstAnswer(handle) : undefined;
      // A hub that takes every answer, the last one written over the first: the planted wrong program.
      if (first && this.options.settings.plant === 'last-writer-wins' && typeof input.option === 'string') {
        await this.options.events.appendCore('ask.answered', { answer: input.option, plan_hash: null, decision: 'none', via: 'card', verified: true, on: (JSON.parse(row.data) as { pinned_to: JsonValue }).pinned_to, token: null, words: null, image: null }, { subject: handle, v: 4 });
        return { ask: handle, answer: input.option, scope: null };
      }
      await answered().catch((error: unknown) => { if (!first) throw error; });
      throw new Refused(refusal('not_found', '/params/ask', first ? `${handle} was already answered ${first.answer} ${first.where}; the first answer stands, so ${String(input.option ?? 'this answer')} counts for nothing.` : `${handle} is closed.`, handle));
    }
    const ask = JSON.parse(row.data) as { key: string; question: string; options: { id: string; label: string; decision?: string }[]; pinned_to?: { ref?: string } };
    const chosen = ask.options.find((o) => o.id === input.option);
    if (input.option !== undefined && !chosen) {
      throw new Refused(refusal('enum', '/params/option', `${handle} has no option ${String(input.option)}; its options are ${ask.options.map((o) => o.id).join(', ')}.`, input.option));
    }
    // A channel's answer was checked by the channels (#65): a paired device's signature over the card it showed, or an account link.
    if (!channel) {
      await this.options.control().trusted('ask.answer', params, context, `answer “${ask.question.slice(0, 120)}” with ${chosen ? `“${chosen.label.slice(0, 80)}”` : 'your words'}`, handle, await this.revisionOf(handle, ask));
      await this.onRevision(handle, revision, params.signature);
    }
    // A paired phone's yes binds the plan its signature names, which the channels checked against the ask's (#1580),
    // never one the hub fills in, and its own token, as the app's click does.
    if (channel?.proof === 'device' && chosen?.decision === 'allow') {
      input.token = `${channel.channel}:${ulid(this.options.services.now())}`;
      input.plan_hash = channel.plan_hash;
    }
    // From the CLI, the OS prompt that just confirmed you is the click an approval binds (#321): its token is minted here,
    // for an approval only, so any other answer is handed on as its twin from the app is (#34).
    if (context.role === 'cli' && chosen?.decision === 'allow' && input.token === undefined) input.token = `os-confirm:${ulid(this.options.services.now())}`;
    // `deep inbox answer` names an option, and its prompt named the plan the card shows: an approval binds that one (#69).
    if (context.role === 'cli' && chosen?.decision === 'allow' && input.plan_hash === undefined) input.plan_hash = (await this.options.services.asks.card(handle)).plan?.hash ?? null;
    const data = JSON.parse(row.data) as Obj;
    // "The agent can do it" sends the task back with the tools the check found (#84).
    if (chosen?.id === 'agent' && data.kind === 'unblock' && row.session) input.words = this.toolsFound(await this.options.judging().reachOfSession(row.session));
    // Your answer differs from the option a provisional ask went on with (#84): the commits made under it go with your answer.
    if (data.provisional === true && chosen && chosen.id !== data.recommended && row.session && this.options.settings.plant !== 'records-switch-only') await this.provisionalSwitched(handle, row.session, data).catch(() => undefined);
    await answered();
    // "I did it" to a task proved by a spec check runs that check again at once (#323): a claim never passes on it alone.
    if (data.kind === 'unblock' && chosen?.id === 'done' && row.session && typeof data.proves === 'string' && this.options.mcp().checksOf((await this.options.services.teardowns.of(data))?.cwd ?? this.options.state().sessions.get(row.session)?.cwd ?? '').has(data.proves)) {
      void this.didIt(handle, row.session, data).catch((error: unknown) => process.stderr.write(`deep hub: ${handle}'s check did not run again: ${error instanceof Error ? error.message : String(error)}\n`));
    }
    // Your waiver of an open item closes it (#323).
    await this.options.services.openItems.answered(data, chosen?.id);
    // The asks core saved an option you chose for the ask's repo, or its session, never wider than its card showed.
    const [saved] = (await this.options.services.record.raw(`SELECT data FROM events WHERE kind = 'decision.created' AND subject = ? ORDER BY log_pos DESC LIMIT 1`, [handle])) as { data: string }[];
    const answer = chosen?.id ?? String(input.words ?? input.image);
    await this.options.memory().syncStanding().catch(() => undefined);
    await syncRejected(this.options.services.raw, this.options.services.root.dir).catch(() => undefined);
    return { ask: handle, answer, scope: saved ? String((JSON.parse(saved.data) as Obj).scope) : null };
  }

  private toolsFound(reach: Reach): string {
    const names = [...reach.tools.map((t) => t.name), ...reach.profiles.filter((p) => p.leased).map((p) => p.profile), ...reach.credentials.map((c) => c.secret)];
    return names.length ? `The check found: ${names.join(', ')}.` : 'The check found no tool for it; say what you tried if you still can\'t.';
  }

  /**
   * You chose another option after the agent went on with a provisional one: the commits made since the ask, for your
   * answer's one send-back, and a reading that keeps the claim from passing on them until a commit after this one.
   */
  private async provisionalSwitched(handle: string, session: string, data: Obj): Promise<void> {
    const cwd = this.options.state().sessions.get(session)?.cwd;
    const pinned = data.pinned_to as { kind?: string; ref?: string } | undefined;
    if (!cwd || pinned?.kind !== 'commit') return;
    const git = (...args: string[]) => new Promise<string>((done) => execFile('git', ['-C', cwd, ...args], { timeout: 2000 }, (_, out) => done(String(out ?? '').trim())));
    const commits = (await git('rev-list', '--reverse', `${pinned.ref}..HEAD`)).split('\n').filter(Boolean);
    this.options.delivery().switches.set(handle.slice(4), commits.map((c) => c.slice(0, 7)));
    const head = await git('rev-parse', 'HEAD^{tree}');
    await this.options.events.appendReading(session, this.options.state().sessions.get(session)!.agent, `Switched ${handle}: tree ${head}`);
  }

  /** Whether a claim stands on the tree your switch of a provisional ask left: no check of your option has run on it (#84). */
  async onSwitchedTree(claim: string): Promise<string | undefined> {
    const [row] = (await this.options.services.record.raw(`SELECT session_id, commit_sha FROM claims WHERE id = ?`, [claim.slice(6)])) as { session_id: string | null; commit_sha: string | null }[];
    if (!row?.session_id || !row.commit_sha) return undefined;
    const rows = (await this.options.services.record.raw(`SELECT json_extract(data, '$.reading') AS reading FROM events WHERE session_id = ? AND kind = 'session.reading' AND json_extract(data, '$.reading') LIKE 'Switched ask:%' ORDER BY log_pos DESC LIMIT 1`, [row.session_id])) as { reading: string }[];
    const switched = /^Switched (ask:\S+): tree (\S+)/.exec(rows[0]?.reading ?? '');
    const cwd = this.options.state().sessions.get(row.session_id)?.cwd;
    if (!switched || !cwd) return undefined;
    const tree = await new Promise<string>((done) => execFile('git', ['-C', cwd, 'rev-parse', `${row.commit_sha!}^{tree}`], { timeout: 2000 }, (_, out) => done(String(out ?? '').trim())));
    return tree === switched[2] ? `your answer to ${switched[1]} switched the option the agent went on with, and no check has run on a commit after it` : undefined;
  }

  /**
   * Your "I did it" to a task (#323; design: Tasks only you can do): its check runs again at once, as your claim on the
   * session's task, on a snapshot of the session's folder. One that still fails returns the task to you, raised again
   * with what's missing; one that passes leaves it closed.
   */
  async didIt(handle: string, session: string, data: Obj): Promise<void> {
    // A teardown task's session may be long over: its check runs on the folder that session worked in, for its own
    // resource, with no claim, so one resource's check passing says nothing of another's task on the same check (#342).
    const resource = await this.options.services.teardowns.of(data);
    const name = String(data.proves);
    const agent = resource?.agent ?? this.options.state().sessions.get(session)!.agent;
    if (resource && this.options.settings.plant === 'teardown-closes-on-word') return;
    let findings: string[] = [];
    try {
      const cwd = resource?.cwd ?? this.options.state().sessions.get(session)!.cwd;
      const check = this.options.mcp().checksOf(cwd).get(name);
      if (!check) throw Error(`${name} is no check of ${cwd}'s spec any more`);
      // Run on a snapshot of the session's folder, in a temporary checkout of it, as a claim's checks are (#29).
      const commit = (await this.options.services.checkouts.snapshot(cwd)).commit;
      const ts = this.options.services.now();
      const id = ulid(ts);
      const checkout = await this.options.services.checkouts.checkout({ worktree: cwd, commit, dependencies: ['node_modules', '.venv'], runs: [`claim:${id}`] });
      if (!resource) {
        const live = this.options.state().liveOf({ session, agent, cwd } as HookMeta);
        const task_ref = await this.options.judging().turnTaskOf(session, live);
        const [before] = (await this.options.services.record.raw(`SELECT COUNT(*) AS n FROM claims WHERE session_id = ? AND subject_ref = ?`, [session, task_ref])) as { n: number }[];
        await this.options.events.append(this.options.events.connection('core', { session, agent }), { v: 2, id, kind: 'claim.made', ts, data: { task_ref, attempt: (before?.n ?? 0) + 1, commit, scope: 'session', predictions: [] } });
      }
      const deadline = check.deadline === undefined ? undefined : duration(check.deadline as JsonValue);
      const { run } = await this.options.services.runs.start({ check: name, claim: `claim:${id}`, commit, argv: ['/bin/sh', '-c', check.run], command: check.run, cwd: checkout.dir, ...(resource?.key === undefined ? {} : { env: { DEEP_RESOURCE_KEY: resource.key } }) }, deadline);
      const outcome = await this.options.judging().runEnded(String(run)).finally(() => this.options.services.checkouts.ended(checkout, `claim:${id}`).catch(() => undefined));
      if (outcome === 'passed') return;
      const [done] = (await this.options.services.record.raw(`SELECT json_extract(data, '$.findings') AS findings FROM events WHERE kind = 'run.finished' AND subject = ? LIMIT 1`, [String(run)])) as { findings: string | null }[];
      findings = (JSON.parse(done?.findings ?? '[]') as string[]).slice(0, 5);
    } catch (error) {
      // A teardown task closes on its check alone: one that couldn't run leaves the task with you.
      if (!resource) throw error;
      findings = [error instanceof Error ? error.message : String(error)];
    }
    const reasons = [`${name} still fails after your "I did it"${findings.length ? `: ${findings.join('; ')}` : ''}`];
    const fields = ['kind', 'question', 'options', 'recommended', 'default', 'steps', 'where', 'why', 'unblocks', 'proves', 'cost_usd', 'fallback', 'provisional', 'owner', 'pinned_to'];
    const again = { ...Object.fromEntries(fields.filter((f) => f in data).map((f) => [f, data[f]])), key: sha256Hex(canonicalize({ again: handle, key: data.key ?? null } as JsonValue)) };
    await this.raiseTask(session, agent, again);
    if (!resource) await this.options.services.asks.stillFails(name, reasons);
  }

  async raiseTask(session: string, agent: string, ask: Obj): Promise<void> {
    await this.options.services.asks.raise(this.options.events.connection('core', { session, agent }), 'deep_ask.unblock', ask);
  }

  /** asks/:id/undo, from the app or `deep inbox undo`: a defaulted ask opens again, once the trusted path allows it. */
  async undo(params: Obj, context: CallContext): Promise<Obj> {
    const handle = params.ask;
    if (typeof handle !== 'string' || !/^ask:[0-9A-Za-z]+$/.test(handle)) throw new Refused(refusal('handle_syntax', '/params/ask', 'Name the ask by its handle, ask:<id>.', handle));
    const [row] = (await this.options.services.record.raw(`SELECT question, status, pinned_to FROM asks WHERE id = ?`, [handle.slice(4)])) as { question: string; status: string; pinned_to: string | null }[];
    if (!row) throw new Refused(refusal('not_found', '/params/ask', `No ask ${handle}; undo the default of an ask the inbox holds.`, handle));
    if (row.status !== 'defaulted') throw new Refused(refusal('not_found', '/params/ask', `${handle} didn't take its default (it's ${row.status}), so there's nothing to undo.`, handle));
    // A definition that locked on the default stands: a different answer now would change nothing but the record of it.
    const locked = await this.options.services.tasks.lockedOn(handle);
    if (locked) throw new Refused(refusal('locked', '/params/ask', `${handle} took its default and the definition of ${locked} locked on it; a change to that definition goes through a dispute, not an undo.`, handle));
    await this.options.control().trusted('ask.undo', params, context, `undo the default “${row.question.slice(0, 120)}” took`, handle, await this.revisionOf(handle, { pinned_to: row.pinned_to ? JSON.parse(row.pinned_to) as { ref?: string } : undefined }));
    await this.options.services.asks.undo(this.options.events.connection(context.role === 'app' ? 'app' : 'cli'), handle).catch((error: unknown) => { throw asRefused(error); });
    const [open] = (await this.options.services.record.raw(`SELECT deadline FROM asks WHERE id = ?`, [handle.slice(4)])) as { deadline: number }[];
    return { ask: handle, deadline: open?.deadline ?? null };
  }

  /** decisions/:id/overrule: a saved decision taken out of force, on the trusted path alone. */
  async overrule(params: Obj, context: CallContext): Promise<Obj> {
    const id = typeof params.decision === 'string' && /^decision:[0-9A-Za-z]+$/.test(params.decision) ? params.decision : undefined;
    if (!id) throw new Refused(refusal('pattern', '/params/decision', 'Name the decision as decision:<id>.', params.decision));
    const [row] = (await this.options.services.record.raw(`SELECT key, answer, state FROM decisions WHERE id = ?`, [id.slice(9)])) as { key: string; answer: string; state: string }[];
    if (!row) throw new Refused(refusal('not_found', '/params/decision', `No decision ${id} in the record.`, id));
    if (row.state === 'revoked') return { overruled: id };
    await this.options.control().trusted('decision.overrule', params, context, `overrule the saved decision ${row.answer}`, id, row.state);
    // First: a retry finds a revoked decision done, so a guard left behind would never go.
    dropKept(this.options.services.root.dir, row.key);
    await this.options.events.appendCore('decision.overruled', { decision: id }, { subject: id });
    await this.options.memory().syncStanding().catch(() => undefined);
    await syncRejected(this.options.services.raw, this.options.services.root.dir).catch(() => undefined);
    return { overruled: id };
  }

  /** The answer a closed ask took first, and where it came from: the channel that carried it, or the app or deep inbox. */
  private async firstAnswer(handle: string): Promise<{ answer: string; where: string } | undefined> {
    const [first] = (await this.options.services.record.raw(`SELECT json_extract(data, '$.answer') AS answer, json_extract(data, '$.via') AS via FROM events WHERE kind = 'ask.answered' AND subject = ? ORDER BY log_pos LIMIT 1`, [handle])) as { answer: string; via: string }[];
    if (!first) return undefined;
    const [by] = (await this.options.services.record.raw(`SELECT json_extract(data, '$.channel') AS channel FROM events WHERE kind = 'channel.answered' AND subject = ? AND json_extract(data, '$.answer') = ? ORDER BY log_pos LIMIT 1`, [handle, first.answer])) as { channel: string }[];
    return { answer: first.answer, where: by ? `on the ${by.channel} channel` : first.via === 'inbox' ? 'from deep inbox' : first.via === 'session' ? 'in the session' : 'in the app' };
  }

  /** The asks as the channels render them (#65): the inbox's state of each, with its words, options and answer. */
  async channelAsks(): Promise<ChannelAsk[]> {
    const rows = (await this.options.services.record.raw('SELECT id, question, options, answer FROM asks')) as { id: string; question: string | null; options: string | null; answer: string | null }[];
    const texts = new Map(rows.map((r) => [`ask:${r.id}`, r]));
    const cards = await this.cards();
    return (await this.options.services.asks.inbox()).map((row) => {
      const t = texts.get(row.ask);
      const options = t?.options ? (JSON.parse(t.options) as { id: string; label: string }[]).map((o) => ({ id: String(o.id), label: String(o.label) })) : [];
      let answer: string | null = null;
      try { answer = t?.answer ? String(JSON.parse(t.answer)) : null; } catch { answer = t?.answer ?? null; }
      const card = cards.get(row.ask);
      return { handle: row.ask, kind: row.kind, question: t?.question ?? '', options, status: row.status, outcome: row.outcome, answer, plan: card?.plan ?? null, revision: card?.revision ?? 1 };
    });
  }

  /**
   * Each ask's card as the record holds it (#1580): the newest plan the core proposed, as a card draws it; its revision,
   * 1 and one more for each change of plan and each Take over; and the device it was taken over to last. `handle`
   * narrows it to one ask.
   */
  private async cards(handle?: string): Promise<Map<string, { plan: ChannelAsk['plan']; revision: number; holder: string | null }>> {
    const one = handle ? ` AND (subject = ? OR json_extract(data, '$.ask') = ?)` : '';
    const rows = (await this.options.services.record.raw(`SELECT kind, subject, json_extract(data, '$.ask') AS ask, json_extract(data, '$.hash') AS hash, json_extract(data, '$.steps') AS steps, json_extract(data, '$.device') AS device FROM events WHERE ((kind = 'plan.proposed' AND writer = 'core') OR kind = 'ask.taken_over')${one} ORDER BY log_pos`, handle ? [handle, handle] : [])) as { kind: string; subject: string | null; ask: string | null; hash: string | null; steps: string | null; device: string | null }[];
    const held = new Map<string, { hash?: string; steps?: string; revision: number; holder: string | null }>();
    for (const r of rows) {
      const key = String(r.kind === 'ask.taken_over' ? r.subject : r.ask);
      const card = held.get(key) ?? { revision: 1, holder: null };
      held.set(key, card);
      if (r.kind === 'ask.taken_over') Object.assign(card, { revision: card.revision + 1, holder: r.device });
      else if (r.hash !== card.hash) Object.assign(card, { revision: card.revision + (card.hash === undefined ? 0 : 1), hash: String(r.hash), steps: r.steps ?? '[]' });
    }
    return new Map([...held].map(([key, c]) => [key, {
      revision: c.revision, holder: c.holder,
      plan: c.hash === undefined ? null : {
        hash: c.hash,
        steps: (JSON.parse(c.steps!) as Obj[]).map((s) => ({ does: String(s.does), changes: (Array.isArray(s.changes) ? s.changes : []).map(String), undo: String(s.undo), public: s.public === true, cost: Number(s.cost) })),
      },
    }]));
  }

  /**
   * An answer from a copy of an ask's card at an earlier revision is refused, naming the revision; so is a signed one
   * naming none from another device once the card was taken over (#1580). An answer from the CLI, which the OS
   * confirmed, keeps no copy of its own and is held only to a revision it names.
   */
  private async onRevision(handle: string, revision: unknown, signature: unknown): Promise<void> {
    const card = (await this.cards(handle)).get(handle) ?? { revision: 1, holder: null };
    if (revision !== undefined && revision !== card.revision) {
      throw new Refused(refusal('credential', '/params/revision', `${handle} stays open: this answer is from its card at revision ${JSON.stringify(revision)}, and the card is at revision ${card.revision} now${card.holder ? `, taken over to ${card.holder}` : ''}. Answer from the card as it is now.`, revision));
    }
    const device = (signature as { signed?: { device?: unknown } } | undefined)?.signed?.device;
    if (revision === undefined && device !== undefined && card.holder !== null && device !== card.holder) {
      throw new Refused(refusal('credential', '/params/revision', `${handle} stays open: its card moved to ${card.holder} by Take over, at revision ${card.revision}, and this answer from ${String(device)} names no revision. Answer it there, or take it over here.`, handle));
    }
  }

  /**
   * Take over (#1580; design: Channel): a device you paired moves an open ask's card to itself on the trusted path,
   * signing the call with its own key. The card's revision rises, so an answer from a copy at the earlier one is
   * refused, naming the revision, and every channel's card goes out again at the new one.
   */
  async takeOver(params: Obj, context: CallContext): Promise<Obj> {
    const handle = params.ask;
    if (typeof handle !== 'string' || !/^ask:[0-9A-Za-z]+$/.test(handle)) throw new Refused(refusal('handle_syntax', '/params/ask', 'Name the ask by its handle, ask:<id>, as deep inbox lists it.', handle));
    const [row] = (await this.options.services.record.raw(`SELECT status FROM asks WHERE id = ?`, [handle.slice(4)])) as { status: string }[];
    if (!row) throw new Refused(refusal('not_found', '/params/ask', `No ask ${handle}; take over an ask deep inbox lists.`, handle));
    if (row.status !== 'open' && row.status !== 'later') throw new Refused(refusal('not_found', '/params/ask', `${handle} is closed, so its card has nowhere to move.`, handle));
    if (params.signature === undefined) throw new Refused(refusal('unconfirmed', '/params/signature', `Take over moves ${handle}'s card to a device you paired, which signs the call with its own key.`, handle));
    await this.options.control().trusted('ask.take_over', params, context, `take over ${handle}`, handle, 'take over');
    const device = String((params.signature as { signed: { device: string } }).signed.device);
    const revision = ((await this.cards(handle)).get(handle)?.revision ?? 1) + 1;
    await this.options.events.appendCore('ask.taken_over', { device, revision }, { subject: handle });
    return { ask: handle, device, revision };
  }

  /** A view's ⌘K command, chosen in the app (#1454): the action its manifest declares, called as you. */
  /**
   * Later on an ask, from the app's action table (#1462): it goes below the open asks and comes back an hour before
   * its default applies. The hour is drafted. The asks core checks it against every deadline it could hide.
   */
  async putOff(params: Obj): Promise<Obj> {
    const { ask } = params;
    if (typeof ask !== 'string' || !ask.startsWith('ask:')) throw refuse('type', '/params/ask', 'Name the ask by its handle, ask:<id>.', ask);
    try {
      await this.options.services.asks.laterBefore(this.options.events.connection('app'), ask, LATER_BEFORE_MS);
    } catch (error) {
      if (error instanceof AskRefused) throw refuse('refused', '/params/ask', error.message, ask);
      throw error;
    }
    return { ask };
  }

  /** Pause on a session's row, from the app (#1462): recorded as the core, the session its subject as every session event names it. */
  async pauseSession(params: Obj): Promise<Obj> {
    const { session } = params;
    if (typeof session !== 'string' || !letters(session)) throw refuse('type', '/params/session', 'Name the session by its ID.', session);
    const ts = this.options.services.now();
    await this.options.events.append(this.options.events.connection('core', { session }), { v: 1, id: ulid(ts), kind: 'session.paused', ts, subject: `session:${letters(session)}`, data: {} });
    return { session, paused: true };
  }

}
