// Test-side tools for the #1098 acceptance tests: a real record on SQLite in a temporary folder with an evidence
// store beside it, the real asks core on it with a virtual clock, and resolver-decisions registered as the hub
// registers it (#23's match world, with #69's evidence store). A recorded session is a Claude Code transcript, built
// line by line as Claude Code writes it, kept in the record the way the transcript archive (#20) keeps one: its copy
// in the evidence store and a transcript.archived event, so `session:` handles resolve through the record. Prompts are
// user.ask events from the hook, with their origin `from` (#303). Authority asks are raised as DeepBuild's own code
// raises them, with a plan whose steps name their targets. Nothing here stands in for the code under test.

import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openEvidenceStore, type EvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord, type Connection, type Event, type RecordStore } from '../../../packages/record/src/index.ts';
import { openAsks, type Asks, type AsksPlant, type Card, type CardTarget, type Delivery, type InboxRow, type PlanStep, type Target } from '../../../packages/asks/src/index.ts';
import { resolverDecisions } from '../../../packages/resolver-decisions/src/index.ts';

export type Obj = Record<string, unknown>;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
/** Monday 2026-11-02 09:00 UTC: every world's clock starts here. */
export const T0 = Date.UTC(2026, 10, 2, 9, 0, 0);
export const sha256 = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const dataOf = (e: Event): Obj => (isObj(e.data) ? e.data : {});

// ---- A failure of a criterion, naming what it is about: the address, the URL or the option.
/** Thrown when a criterion's check fails; `target` is what the failure names. Anything else thrown is not a criterion's verdict. */
export class CriterionFailed extends Error {
  constructor(readonly target: string, why: string) {
    super(`${target}: ${why}`);
    this.name = 'CriterionFailed';
  }
}
export function must(cond: unknown, target: string, why: string): asserts cond {
  if (!cond) throw new CriterionFailed(target, why);
}

// ---- Connections, as the hub's socket would prove them.
const who = { actor: 'you', scope: 'you' };
/** The hook of a session in a repo: session.start and user.ask are recorded under it. */
export const hook = (session: string, project: string): Connection => ({ writer: 'hook', ...who, session, project, agent: 'claude-code' });
/** DeepBuild's own code raising an ask for a session: the guard at PreToolUse that holds a send or a push. */
export const core = (session: string): Connection => ({ writer: 'core', ...who, session });
/** The question card in the app: the trusted path. */
export const card: Connection = { writer: 'app', ...who };

// ---- Targets, as the issue compares them.
/** A target normalized as the issue says: host and address lowercased, a remote URL without credentials or `.git`, owner/repo lowercased. */
export function normalized(kind: string, ref: string): string {
  const r = ref.trim();
  if (kind === 'remote' && /^[a-z][a-z0-9+.-]*:\/\//i.test(r)) {
    const u = new URL(r);
    return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '').replace(/\.git$/, '')}`;
  }
  return kind === 'remote' ? r : r.toLowerCase();
}
/**
 * The card's entry for one target of the plan, compared normalized; undefined when the card shows none. `aliases`
 * are what the card may show in its place: the URL of a remote the command names by its configured name.
 */
export function targetOn(shown: Card, kind: Target['kind'], ref: string, aliases: string[] = []): CardTarget | undefined {
  const all = (shown as { targets?: CardTarget[] }).targets;
  const refs = [ref, ...aliases].map((r) => normalized(kind, r));
  return Array.isArray(all) ? all.find((t) => t.kind === kind && refs.includes(normalized(kind, t.ref))) : undefined;
}

// ---- A recorded session: a Claude Code transcript, line by line.
export interface Transcript {
  session: string;
  cwd: string;
  lines: Obj[];
  /** The uuid of each entry, in order, by what the test calls it. */
  named: Map<string, string>;
}
const iso = (ms: number): string => new Date(ms).toISOString();
function line(t: Transcript, at: number, entry: Obj): string {
  const uuid = randomUUID();
  const parentUuid = t.lines.length ? String(t.lines[t.lines.length - 1]!.uuid) : null;
  t.lines.push({ parentUuid, isSidechain: false, ...entry, uuid, timestamp: iso(at), userType: 'external', entrypoint: 'cli', cwd: t.cwd, sessionId: t.session, version: '2.1.308', gitBranch: 'main' });
  return uuid;
}
/** A prompt you typed, as Claude Code writes it. */
export const typed = (t: Transcript, at: number, text: string): string =>
  line(t, at, { type: 'user', message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
/** A prompt a schedule sent, not typed by anyone. */
export const scheduled = (t: Transcript, at: number, text: string): string =>
  line(t, at, { type: 'user', message: { role: 'user', content: text }, origin: { kind: 'scheduled' }, turnOrigin: 'scheduled' });
/** The agent's own words. */
export const says = (t: Transcript, at: number, text: string): string =>
  line(t, at, { type: 'assistant', message: { role: 'assistant', type: 'message', content: [{ type: 'text', text }] } });
/** A tool call and its result; the uuid of the entry holding the result. */
export function tool(t: Transcript, at: number, name: string, input: Obj, result: string): string {
  const id = `toolu_${sha256(`${t.session}:${t.lines.length}`).slice(0, 24)}`;
  const call = line(t, at, { type: 'assistant', message: { role: 'assistant', type: 'message', content: [{ type: 'tool_use', id, name, input }] } });
  return line(t, at, { type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: result, is_error: false }] }, toolUseResult: { content: result }, sourceToolAssistantUUID: call });
}
/** A tool call the agent is about to make: held at its PreToolUse, so no result yet. */
export function calls(t: Transcript, at: number, name: string, input: Obj): string {
  const id = `toolu_${sha256(`${t.session}:${t.lines.length}`).slice(0, 24)}`;
  return line(t, at, { type: 'assistant', message: { role: 'assistant', type: 'message', content: [{ type: 'tool_use', id, name, input }] } });
}
export const jsonl = (t: Transcript): string => t.lines.map((l) => JSON.stringify(l)).join('\n') + '\n';

// ---- A world.
export interface World {
  dir: string;
  clock: { now(): number; set(ms: number): void };
  record: RecordStore;
  evidence: EvidenceStore;
  asks: Asks;
  deliveries: Delivery[];
  /** A session starting in a repo, as the hook records it; its transcript to write into. */
  start(session: string, project: string, worktree?: string): Promise<Transcript>;
  /** A prompt reaching the session: user.ask from the hook with its origin, and its transcript entry. */
  prompt(t: Transcript, text: string, from?: 'person' | 'scheduled'): Promise<string>;
  /** Keeps the session's transcript as it stands, as the archive does: its copy as evidence, linked by transcript.archived. */
  archive(t: Transcript): Promise<string>;
  events(kind?: string): Promise<Event[]>;
  row(ask: string): Promise<InboxRow | undefined>;
  close(): Promise<void>;
}

export async function openWorld(plant?: AsksPlant): Promise<World> {
  // Short, under /tmp: nothing here opens a socket, but the folders stay small and easy to find.
  const dir = mkdtempSync('/tmp/dh1098-');
  let now = T0;
  const clock = { now: () => now, set: (ms: number) => { now = ms; } };
  const evidence = await openEvidenceStore({ root: join(dir, 'evidence'), now: clock.now });
  const record = await openRecord({ path: join(dir, 'record.db'), now: clock.now, evidence });
  const deliveries: Delivery[] = [];
  const asks = await openAsks({ record, now: clock.now, deliver: (d) => { deliveries.push(structuredClone(d)); }, ...(plant ? { plant } : {}) });
  asks.registerResolver('resolver-decisions', resolverDecisions({ record }));
  const projects = new Map<string, string>();
  const msgs = new Map<string, number>();
  const capture = evidence.connect({ role: 'deepbuild', via: 'capture' });
  let minted = 0;
  const ulid = (): string => {
    const C = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let time = '';
    for (let t = clock.now(), i = 0; i < 10; i++, t = Math.floor(t / 32)) time = C[t % 32] + time;
    let tail = '';
    for (let n = ++minted, i = 0; i < 16; i++, n = Math.floor(n / 32)) tail = C[n % 32] + tail;
    return time + tail;
  };
  const events = async (kind?: string): Promise<Event[]> => {
    const all: Event[] = [];
    for (let after = 0; ;) {
      const page = await record.read({ after, limit: 1000, ...(kind ? { kinds: [kind] } : {}) });
      all.push(...page);
      if (page.length < 1000) break;
      after = page[page.length - 1]!.log_pos;
    }
    return all;
  };
  const w: World = {
    dir, clock, record, evidence, asks, deliveries, events,
    start: async (session, project, worktree) => {
      const cwd = worktree ?? join(dir, 'work', session);
      mkdirSync(cwd, { recursive: true });
      projects.set(session, project);
      await record.append(hook(session, project), { v: 1, id: ulid(), kind: 'session.start', ts: clock.now(), data: { agent: 'claude-code', worktree: cwd, branch: 'main', thread: `T${session}` } });
      return { session, cwd, lines: [], named: new Map() };
    },
    prompt: async (t, text, from = 'person') => {
      const msg = msgs.get(t.session) ?? 0;
      msgs.set(t.session, msg + 1);
      await record.append(hook(t.session, projects.get(t.session)!), { v: 2, id: ulid(), kind: 'user.ask', ts: clock.now(), data: { msg, text, tasks: [], from } });
      return from === 'person' ? typed(t, clock.now(), text) : scheduled(t, clock.now(), text);
    },
    archive: async (t) => {
      const bytes = Buffer.from(jsonl(t), 'utf8');
      const put = await capture.put({ bytes, kind: 'transcript-copy', source: 'archive:claude-code', redaction: 'complete', license: { name: 'session', allows: [] } });
      if (put.status !== 'stored') throw Error(`the evidence store refused the transcript of ${t.session}: ${put.reason}`);
      const sha = put.evidence.sha256;
      await record.append({ writer: 'core', ...who, agent: 'claude-code', project: projects.get(t.session)! }, {
        v: 2, id: ulid(), kind: 'transcript.archived', ts: clock.now(), evidence: [sha],
        data: { session: `session:${t.session}`, evidence: sha, source: { size: bytes.length, sha256: sha256(bytes) } },
      });
      return sha;
    },
    row: async (ask) => (await asks.inbox()).find((r) => r.ask === ask),
    close: async () => { await record.close(); rmSync(dir, { recursive: true, force: true }); },
  };
  return w;
}

/** Runs a scenario in a fresh world and closes it. */
export async function inWorld<T>(scenario: (w: World) => Promise<T>, plant?: AsksPlant): Promise<T> {
  const w = await openWorld(plant);
  try {
    return await scenario(w);
  } finally {
    await w.close();
  }
}

/** A git repo whose configured remote `origin` is `url`, as a session's worktree. */
export function repoWithOrigin(w: World, name: string, url: string): string {
  const path = join(w.dir, name);
  mkdirSync(path, { recursive: true });
  // A clean environment: no GIT_* setting of this process reaches git.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  execFileSync('git', ['init', '-q', '-b', 'main', path], { env, stdio: 'ignore' });
  execFileSync('git', ['-C', path, 'remote', 'add', 'origin', url], { env, stdio: 'ignore' });
  return path;
}
export const writeFile = (path: string, text: string): void => writeFileSync(path, text);

// ---- Authority asks, as DeepBuild's guards raise them: a structured subject, and a plan whose step names its targets.
const opt = (id: string, label: string, decision: 'allow' | 'deny') => ({ id, label, decision });
/** A step of a plan that names where it goes. */
export const stepTo = (does: string, targets: Target[], undo: string | null = null): PlanStep =>
  ({ does, changes: targets.map((t) => t.ref), undo, public: false, cost: 0, targets }) as PlanStep;
export const address = (ref: string): Target => ({ kind: 'address', ref });
export const remote = (ref: string): Target => ({ kind: 'remote', ref });

/** An email send held at PreToolUse: its subject is what it sends (the summary), never who it goes to. */
export async function raiseSend(w: World, session: string, what: string, to: string[], cc: string[] = []): Promise<string> {
  const question = `Send ${what} to ${[...to, ...cc].join(', ')}?`;
  return w.asks.raise(core(session), 'effect.send', {
    kind: 'authority', question, options: [opt('approve', 'Send it', 'allow'), opt('decline', 'Hold it', 'deny')], recommended: null,
    deadline: w.clock.now() + DAY, fallback: 'you', default: 'decline', provisional: false, owner: 'you',
    subject: { effect: 'send', target: { kind: 'email', ref: what, owner: 'you' }, change: null },
    pinned_to: { kind: 'evidence', ref: sha256(`send ${what} ${to.join(',')} ${cc.join(',')}`) },
  }, { steps: [stepTo(`Send ${what} by email`, [...to, ...cc].map(address))], diff: sha256(question) });
}
/** A push held at PreToolUse: its subject is the branch it pushes, in the session's repo; its target is the remote the command names. */
export async function raisePush(w: World, session: string, repo: string, to: string, branch: string, question = `Run \`git push ${to} ${branch}\`?`): Promise<string> {
  return w.asks.raise(core(session), 'effect.push', {
    kind: 'authority', question, options: [opt('approve', 'Push it', 'allow'), opt('decline', 'Hold the push', 'deny')], recommended: null,
    deadline: w.clock.now() + DAY, fallback: 'you', default: 'decline', provisional: false, owner: 'you',
    subject: { effect: 'push', target: { kind: 'branch', ref: branch, owner: `repo:${repo}` }, change: null },
    pinned_to: { kind: 'evidence', ref: sha256(`push ${to} ${branch}`) },
  }, { steps: [stepTo(`Push ${branch} to ${to}`, [remote(to)], 'Revert it with a new commit')], diff: sha256(question) });
}

/** Your yes on the card: the ask's allow option, bound to the plan its card shows and your click's token. */
export async function approve(w: World, ask: string): Promise<void> {
  const shown = await w.asks.card(ask);
  const allow = shown.options.find((o) => o.decision === 'allow')!;
  await w.asks.answer(card, ask, { option: allow.id, plan_hash: shown.plan?.hash ?? null, token: `click-${randomUUID()}` });
}

/** decision.created events saved from an ask. */
export const savedFrom = async (w: World, ask: string): Promise<Event[]> => (await w.events('decision.created')).filter((e) => dataOf(e).ask === ask);
/** decision.applied events for an ask. */
export const appliedTo = async (w: World, ask: string): Promise<Event[]> => (await w.events('decision.applied')).filter((e) => dataOf(e).ask === ask);
export const shown = async (w: World): Promise<string[]> => (await w.asks.needsYou()).map((c) => c.ask);

// ---- What the card says about a target.
/** The card's entry for `ref`, which must be there. */
export async function placed(w: World, ask: string, kind: Target['kind'], ref: string, aliases: string[] = []): Promise<CardTarget> {
  const c = await w.asks.card(ask);
  const t = targetOn(c, kind, ref, aliases);
  must(t, ref, `${ask}'s card shows no entry for this target of its plan (its targets: ${JSON.stringify((c as { targets?: unknown }).targets ?? null)})`);
  return t;
}
/** The target reads `origin` on the card. */
export async function reads(w: World, ask: string, kind: Target['kind'], ref: string, origin: CardTarget['origin'], aliases: string[] = []): Promise<CardTarget> {
  const t = await placed(w, ask, kind, ref, aliases);
  must(t.origin === origin, ref, `${ask}'s card shows it as \`${String(t.origin)}\`, not \`${origin}\``);
  return t;
}
const HANDLE = /^(session:[0-9A-Za-z]+#[A-Za-z0-9][A-Za-z0-9._-]*|ev:[0-9a-f]{64})$/;
/**
 * The target reads `read` on the card, citing the first place it appeared: a `session:` or `ev:` handle that resolves
 * through the record to that place (the tool's result holding `quote`), and, for an address, the card's words before
 * it arms, exactly as the issue gives them.
 */
export async function readIn(w: World, ask: string, session: string, kind: Target['kind'], ref: string, place: { tool: string; quote: string }): Promise<CardTarget> {
  const t = await reads(w, ask, kind, ref, 'read');
  must(typeof t.first === 'string' && HANDLE.test(t.first), ref, `${ask}'s card cites ${JSON.stringify(t.first)} for where it first appeared, not a session: or ev: handle`);
  if (t.first.startsWith('session:')) must(t.first.startsWith(`session:${session}#`), ref, `${ask}'s card cites ${t.first}, a message of another session than ${session}`);
  const at = await w.record.resolve(t.first);
  must(at !== undefined, ref, `${ask}'s card cites ${t.first}, which resolves to nothing in the record`);
  must(at.text.includes(place.quote), ref, `${ask}'s card cites ${t.first}, which isn't the ${place.tool} result that first held it (it reads ${JSON.stringify(at.text.slice(0, 200))})`);
  if (at.tool !== undefined) must(at.tool === place.tool, ref, `${ask}'s card cites ${t.first}, the result of ${at.tool}, not of ${place.tool}`);
  const words = typeof t.warning === 'string' ? t.warning.trim().replace(/\.$/, '') : null;
  if (kind === 'address') {
    must(words === `this address appears in nothing you typed or approved; the agent first read it in ${t.first}`, ref,
      `${ask}'s card doesn't say, before it arms, "this address appears in nothing you typed or approved; the agent first read it in ${t.first}" (it says ${JSON.stringify(t.warning)})`);
  } else {
    must(words !== null && words.includes('nothing you typed or approved') && words.includes(t.first), ref,
      `${ask}'s card doesn't say, before it arms, that this appears in nothing you typed or approved and the agent first read it in ${t.first} (it says ${JSON.stringify(t.warning)})`);
  }
  return t;
}
