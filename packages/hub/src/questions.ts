// Only real questions reach you (#84; design: Questions at the stop, A question holds the send-back, Could the agent do
// it?, Work goes on while you decide). What an agent ends its turn with, what it leaves on its still-open list, and the
// question cards it raises at PreToolUse are sorted with no model. The sort and an ask's key come from structure: the
// effect class of the call an offer leads to, the open ask-task and the requirement a question names, and the options
// it states. A question an ask can't be filled from goes back once, for `deep_ask`; nothing is keyed from its words.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import type { Asks, PlanInput } from '@deepbuild/asks';
import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import { leftOpen } from '@deepbuild/gate';
import type { Connection, EventInput } from '@deepbuild/record';
import type { Holds } from './holds.js';
import type { HookMeta, Plant } from './wire.js';
import { couldDo, SECRET_NAME, struck, type Found, type Reach } from './could-do.js';

type Obj = Record<string, unknown>;
interface Requirement { id: string; text: string }
/** What an offered step does, by the guard engine's effect classes; commit counts only where your rules reserve it. */
export type Effect = 'commit' | 'push' | 'pr' | 'merge' | 'dispatch' | 'send' | 'delete' | 'spend';
type Opens = { kind: 'secret'; name: string } | { kind: 'sign_in'; command: string };
interface Choice { question: string; options: { id: string; label: string }[]; recommended: string | null; requirement: string | null; own: boolean }
type Read =
  | { sort: 'none' }
  | { sort: 'unblock'; step: string }
  | { sort: 'choice'; choice: Choice }
  | { sort: 'offer'; question: string; effect: Effect | null }
  | { sort: 'unkeyed'; question: string };

/** Each effect by the words of the step an offer names: the call it would lead to, classed as the guard engine does. */
const EFFECTS: [Effect, RegExp][] = [
  ['merge', /\bmerge\b(?! requests?\b)/i], ['pr', /\b(?:prs?|mrs?|pull requests?|merge requests?)\b/i], ['push', /\bpush\b/i],
  ['dispatch', /\b(?:dispatch|workflow|deploy|release|publish|ship)\b/i], ['send', /\b(?:post|send|email|reply|file\b[^?]*\bissue)\b/i],
  ['delete', /\b(?:delete|drop the|remove the (?:branch|repo))\b/i], ['spend', /\b(?:spend|buy|pay|purchase)\b/i], ['commit', /\bcommit\b/i],
];
const OFFER = /\b(?:want me to|like me to|should i|shall i|can i|may i|could i|ok to|okay to)\s+(.+?)[?.]*$/i;
const RECOMMEND = /\bI(?:'d| would)? (?:recommend|suggest)\s+(.+?)[.!]*$/i;
const OWN = /\bI (?:chose|picked|went with|used)\s+(.+?)(?:\s+for\s+(\w+))?\s*[;,.]\s*(?:say|tell me|let me know)\s+if you(?:'d| would)\s+(?:rather|prefer)(?:\s+use)?\s+(.+?)[.!?]*\s*$/i;
const BETWEEN = /^(?:for|on)\s+(\S+?),?\s+(.+?)\s+or\s+(.+?)\?$/i;
const UNBLOCK = /^unblock:\s*(.+)$/im;
/** A step a person's own hands take: a sign-in, a license, a key at a console. */
const OWN_HANDS = /\bsign(?:ed|ing)?[ -]?in\b|\blog(?:ged|ging)?[ -]?in\b/i;

const slug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'option';
const lastSentence = (text: string) => text.trim().split(/\n+/).at(-1)!.split(/(?<=[.?!])\s+/);
const sameOption = (a: string, b: string) => { const bare = (s: string) => s.toLowerCase().replace(/^(?:the|a|an)\s+/, ''); return bare(a) === bare(b); };

/** The effect an offered step would have. */
function effectOf(step: string): Effect | null {
  return EFFECTS.find(([, re]) => re.test(step))?.[0] ?? null;
}

/** What a final message hands over, read from its form: a task, a choice, an offer, or a question nothing keys. */
function readStop(message: string, requirements: readonly Requirement[]): Read {
  const task = UNBLOCK.exec(message);
  if (task) return { sort: 'unblock', step: task[1]!.trim() };
  const own = OWN.exec(message);
  if (own) {
    const options = [own[1]!, own[3]!].map((label) => ({ id: slug(label), label: label.trim() }));
    return { sort: 'choice', choice: { question: `${own[2] ? `For ${own[2]}, ` : ''}${own[1]!.trim()} or ${own[3]!.trim()}?`, options, recommended: options[0]!.id, requirement: own[2] ?? null, own: true } };
  }
  const sentences = lastSentence(message);
  const recommended = RECOMMEND.exec(sentences.at(-1) ?? '')?.[1];
  const final = recommended ? sentences.at(-2) : sentences.at(-1);
  if (!final || !(final.endsWith('?') || /^please\b/i.test(final))) return { sort: 'none' };
  const offer = OFFER.exec(final);
  if (offer) return { sort: 'offer', question: final, effect: effectOf(offer[1]!) };
  const between = BETWEEN.exec(final);
  if (between && requirements.some((r) => r.id === between[1])) {
    const options = [between[2]!, between[3]!].map((label) => ({ id: slug(label), label: label.trim() }));
    const picked = recommended ? options.find((o) => sameOption(o.label, recommended)) : undefined;
    return { sort: 'choice', choice: { question: final, options, recommended: picked?.id ?? null, requirement: between[1]!, own: false } };
  }
  return { sort: 'unkeyed', question: final };
}

/** The trusted path out of a task: the secret's entry field, or the sign-in command an agent's facts name. */
export function opensOf(question: string, signIns: Readonly<Record<string, string>>): Opens | undefined {
  const name = SECRET_NAME.exec(question)?.[0];
  if (name) return { kind: 'secret', name };
  if (!OWN_HANDS.test(question)) return undefined;
  const agent = Object.keys(signIns).find((a) => new RegExp(`\\b${a}\\b`, 'i').test(question));
  return agent ? { kind: 'sign_in', command: signIns[agent]! } : undefined;
}

/** What your rule files say of commits: whether a line reserves them. */
function rulesReserveCommits(cwd: string): boolean {
  for (const file of [join(homedir(), '.claude/CLAUDE.md'), join(cwd, 'CLAUDE.md'), join(cwd, 'AGENTS.md')]) {
    try {
      if (/\b(?:commit\b[^.\n]*\bonly when\b|never commit\b|don'?t commit\b|do not commit\b)/i.test(readFileSync(file, 'utf8'))) return true;
    } catch { /* no such file */ }
  }
  return false;
}

interface QuestionOptions {
  raw(query: string, params?: readonly (string | number | bigint | null)[]): Promise<unknown[]>;
  asks: () => Asks;
  holds: Holds;
  now: () => number;
  plant: Plant | undefined;
  append(connection: Connection, input: EventInput): Promise<void>;
  connection(session: string, agent: string): Connection;
  pin(cwd: string, question: string): Promise<Obj>;
  reading(session: string, agent: string, reading: string): Promise<void>;
  reach(session: string): Promise<Reach>;
  /** The spec's checks for a folder, by name. */
  checks(cwd: string): string[];
  /** The block entries' verdict on a call: whether one denies it. */
  denied(command: string): Promise<boolean>;
  signIns(): Record<string, string>;
}
/** What a stop's sort decided. */
export interface Sorted {
  proceeds: { question: string; rule: string }[];
  /** Words that keep the agent working, in the stop's one reply. */
  back: string[];
  followUps: string[];
  /** A reply nothing is held for: an authority offer waits for you on its card, not on this stop. */
  noHold: boolean;
}
/** What a card's sort decided: the reason its call is answered with, or the answers `AskUserQuestion` gets. */
interface CardReply { reason?: string; answers?: Record<string, string> }

export class Questions {
  /** Each session's questions already sent on or sent back once, by their text. */
  private readonly once = new Map<string, Set<string>>();
  constructor(private readonly o: QuestionOptions) {}

  private first(session: string, text: string): boolean {
    let seen = this.once.get(session);
    if (!seen) this.once.set(session, seen = new Set());
    if (seen.has(text)) return false;
    seen.add(text);
    return true;
  }
  /** Whether the agent already raised what it's ending on: an open task, taste call, choice or exception of the session's. */
  private async asked(session: string): Promise<boolean> {
    return (await this.o.raw(`SELECT 1 FROM asks WHERE session_id = ? AND status IN ('open', 'later') AND kind != 'authority' LIMIT 1`, [session])).length > 0;
  }
  private key(about: unknown): string {
    return sha256Hex(canonicalize(about as JsonValue));
  }

  /** Could the agent take `step`? It goes back naming what to use; otherwise it's a task for you. Recorded as a hand-back either way. */
  private async handBack(meta: Pick<HookMeta, 'session' | 'agent' | 'cwd'>, step: string, proves: string | undefined): Promise<string> {
    const found: Found[] = couldDo(step, await this.o.reach(meta.session));
    if (found.length) {
      await this.o.reading(meta.session, meta.agent, `Hand-back sent back with ${found.map((f) => f.use).join(', ')}: ${step}`.slice(0, 2000));
      const named = this.o.plant === 'sends-back-no-tool' ? 'what you already have' : found.map((f) => f.how).join('; ');
      return `DeepBuild sent this step back: you can take it yourself, with ${named}. The step: ${step}`;
    }
    await this.o.reading(meta.session, meta.agent, `Hand-back reached you: ${step}`.slice(0, 2000));
    await this.task(meta, step, proves);
    return '';
  }
  /** A step only you can take, raised as a task: it names a provider or a secret, and the trusted path says where to go. */
  private async task(meta: Pick<HookMeta, 'session' | 'agent' | 'cwd'>, step: string, proves: string | undefined): Promise<void> {
    const opens = opensOf(step, this.o.signIns());
    const check = proves ?? this.o.checks(meta.cwd)[0] ?? 'next-stop';
    const steps = opens?.kind === 'secret' ? [`Enter ${opens.name} in its entry field`]
      : opens?.kind === 'sign_in' ? [`Run ${opens.command} in your own terminal`]
      : [step.replace(/[a-z][a-z0-9+.-]*:\/\/([^/\s]+)\S*/gi, '$1')];
    const ask = {
      kind: 'unblock', question: step, options: [{ id: 'done', label: 'I did it', decision: 'none' }], recommended: 'done', default: 'done', steps,
      where: opens?.kind === 'secret' ? "the secret's entry field" : opens?.kind === 'sign_in' ? 'your own terminal' : 'where the step says',
      why: 'The agent stopped on it', unblocks: [`session:${meta.session.replace(/[^0-9A-Za-z]/g, '')}`], proves: check,
      fallback: 'you', provisional: false, owner: 'you', key: this.key({ kind: 'unblock', session: meta.session, proves: check, opens: opens ?? null, steps: steps.length }), pinned_to: await this.o.pin(meta.cwd, step),
    };
    await this.o.asks().raise(this.o.connection(meta.session, meta.agent), 'question.unblock', ask);
  }
  /** A choice from its structure: provisional with a recommendation, keyed from its requirement and options alone. */
  private async choice(meta: Pick<HookMeta, 'session' | 'agent' | 'cwd'>, c: Choice): Promise<string> {
    const about = `${c.requirement ?? 'card'}:${this.key(c.options.map((o) => o.label).sort())}`;
    // An option that needs a tool the agent lacks never reaches you.
    const reach = await this.o.reach(meta.session);
    const options = c.options.filter((o) => !struck(o.label, reach));
    const recommended = options.some((o) => o.id === c.recommended) ? c.recommended : null;
    const ask = {
      kind: 'choice', question: c.question, options: options.map((o) => ({ ...o, decision: 'none' })), recommended, default: recommended ?? options[0]!.id,
      fallback: 'you', provisional: recommended !== null, owner: 'you', key: this.key({ kind: 'choice', about }), subject: { point: about }, pinned_to: await this.o.pin(meta.cwd, c.question),
    };
    return this.o.asks().raise(this.o.connection(meta.session, meta.agent), 'question.choice', ask);
  }
  /** An offer sorted by what its step would do: authority, or in scope. Whether it needs you, and the rule. */
  private async offered(meta: HookMeta, question: string, effect: Effect | null): Promise<{ question: string; rule: string } | undefined> {
    if (effect === null) return { question, rule: 'offer-in-scope' };
    if (effect === 'commit' && !rulesReserveCommits(meta.cwd) && !await this.o.denied('git commit -m wip')) return { question, rule: 'commit-not-reserved' };
    await this.o.holds.offered(meta, effect, question);
    return undefined;
  }

  /** One stop: its still-open list and what it ends on, sorted. */
  async atStop(meta: HookMeta, stop: { message: string; requirements: Requirement[]; failing?: string }): Promise<Sorted> {
    const sorted: Sorted = { proceeds: [], back: [], followUps: [], noHold: false };
    const { message, requirements } = stop;
    if (await this.asked(meta.session)) return sorted;
    const inAsk = (text: string) => requirements.some((r) => text.includes(r.text) || new RegExp(`\\b${r.id}\\b`).test(text));
    for (const item of leftOpen(message).filter((i) => i.from === 'section')) {
      if (OWN_HANDS.test(item.text)) {
        const back = await this.handBack(meta, item.text, stop.failing);
        if (back) sorted.back.push(back);
      } else if (!inAsk(item.text)) sorted.followUps.push(item.text);
      else if (this.first(meta.session, item.text)) sorted.proceeds.push({ question: item.text, rule: 'open-item-in-ask' });
    }
    const read = readStop(message, requirements);
    if (read.sort === 'unblock') {
      const back = await this.handBack(meta, read.step, stop.failing);
      if (back) sorted.back.push(back);
    } else if (read.sort === 'choice') {
      const handle = await this.choice(meta, read.choice);
      const label = read.choice.options.find((o) => o.id === read.choice.recommended)?.label;
      if (label && !read.choice.own) sorted.back.push(`DeepBuild: go on with ${label}, marked as undoable; ${handle} waits for your answer, and only steps that leave the machine wait with it.`);
    } else if (read.sort === 'offer') {
      const asked = await this.offered(meta, read.question, read.effect);
      if (!asked) sorted.noHold = true;
      else if (this.first(meta.session, read.question)) sorted.proceeds.push(asked);
    } else if (read.sort === 'unkeyed' && this.first(meta.session, read.question)) {
      if (this.o.plant === 'keys-ask-from-words') {
        await this.choice(meta, { question: read.question, options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }], recommended: null, requirement: read.question, own: false });
      }
      sorted.back.push(`DeepBuild: nothing in this turn fills a question to you from what you ended on: "${read.question}". If it needs an answer, raise it through deep_ask with its options and what it is pinned to; otherwise decide it and go on.`);
    }
    return sorted;
  }

  /** A paid run a card asks about: the issue's approved budget covers it, or it's yours to approve. */
  private async paidCheck(text: string): Promise<string | undefined> {
    const rows = (await this.o.raw(`SELECT d.task_ref AS task, d.requirements AS requirements FROM definitions d JOIN tasks t ON t.task_ref = d.task_ref WHERE d.task_ref IN (SELECT json_extract(data, '$.scope.ref') FROM events WHERE kind = 'spend.approved')`)) as { task: string; requirements: string | null }[];
    for (const row of rows) {
      const paid = (JSON.parse(row.requirements ?? '[]') as { check?: string | null; paid?: string }[]).filter((q) => q.paid && q.check);
      const named = paid.map((q) => basename(q.check!, extname(q.check!))).find((c) => text.includes(c));
      if (named) return named;
    }
    return undefined;
  }

  /** A question card at PreToolUse (Codex's `request_user_input`, Claude Code's `AskUserQuestion`): sorted as a stop's question. */
  async card(meta: HookMeta, questions: Obj[], requirements: Requirement[]): Promise<CardReply> {
    const answers: Record<string, string> = {};
    const said: string[] = [];
    const claude = meta.agent !== 'codex';
    for (const q of questions) {
      const text = String(q.question ?? '');
      const labels = (Array.isArray(q.options) ? q.options as Obj[] : []).map((o) => String(o.label ?? ''));
      const named = requirements.find((r) => new RegExp(`\\b${r.id}\\b`).test(`${text} ${String(q.header ?? '')}`))?.id ?? null;
      if (OWN_HANDS.test(text) || SECRET_NAME.test(text)) {
        const back = await this.handBack(meta, text, undefined);
        said.push(back || `DeepBuild: this step is a task for the person now; go on with what doesn't need it.`);
        continue;
      }
      if (/\bpaid\b|\bcosts? \$/i.test(text)) {
        const check = await this.paidCheck(text);
        if (check) { said.push(`DeepBuild: the issue's approved budget covers ${check}: run it, no answer needed.`); continue; }
        await this.o.holds.offered(meta, 'spend', text);
        said.push(`DeepBuild: no budget covers this run, so it waits for an authority ask.`);
        continue;
      }
      const offer = OFFER.exec(text);
      if (offer) {
        const asked = await this.offered(meta, text, effectOf(offer[1]!));
        if (asked) {
          await this.o.holds.record(meta, [asked], Date.now() + 2000);
          said.push(`DeepBuild: proceed ("${text}", by rule ${asked.rule}). Go on with the work.`);
        } else said.push(`DeepBuild: that step needs the person's authority; it waits for the authority ask.`);
        continue;
      }
      if (labels.length >= 2) {
        const marked = labels.find((l) => /\((?:recommended|default)\)/i.test(l)) ?? (/\bdefault\b/i.test(text) ? labels[0] : undefined);
        const options = labels.map((label) => ({ id: slug(label.replace(/\s*\((?:recommended|default)\)/i, '')), label }));
        const recommended = marked ? options[labels.indexOf(marked)]!.id : null;
        const handle = await this.choice(meta, { question: text, options, recommended, requirement: named, own: false });
        const { option } = await this.o.holds.applied(handle);
        const decided = option && labels[options.findIndex((o) => o.id === option)];
        if (decided) { answers[text] = decided; said.push(`DeepBuild: your saved decision answers this: ${decided}.`); continue; }
        const label = recommended && labels[options.findIndex((o) => o.id === recommended)];
        said.push(label ? `DeepBuild answered this card: go on with ${label}, marked as undoable; ${handle} waits for the person, and a different answer undoes it.` : `DeepBuild: ${handle} waits for the person's answer.`);
        continue;
      }
      said.push(this.first(meta.session, text) ? `DeepBuild: raise this through deep_ask with its options and what it is pinned to, or decide it and go on: "${text}".` : 'DeepBuild: decide it and go on.');
    }
    return claude && Object.keys(answers).length === questions.length ? { answers } : { reason: said.join('\n') };
  }
}

/** The plan an offer's authority ask shows. */
export function offerPlan(source: string, does: string): PlanInput {
  return { steps: [{ does: does.slice(0, 8192), changes: ['what the offered step touches'], undo: null, public: true, cost: 0 }], diff: sha256Hex(canonicalize({ source, does })) };
}
