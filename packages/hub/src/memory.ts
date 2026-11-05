// Every agent's memory, and what it stops (#111). The keep-or-remove list: each claim the wiki compiled that is a lesson
// becomes a proposed guard, a shared rule or a removal, ranked for you, read from the record each time; `deep memory keep`
// and `remove` are your decisions, once the OS confirms you. Rejected directions: what you said no to in chat, and the
// option you passed over when you answered a choice, stop an agent's proposal, citing the decision; what you said yourself
// stops its tool calls too, through deep-hook. Your past taste decisions: the ones for the screen a session starts on.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwdOf } from '@deepbuild/archive';
import type { EvidenceStore } from '@deepbuild/evidence';
import { ulid, type Connection, type Message, type RecordStore } from '@deepbuild/record';
import { startOf } from './wire.js';
import { call, type Reply } from './client.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';
import { dropEntries, writeRejected } from './guards.js';

export type LessonKind = 'guard' | 'shared-rule' | 'removal';
export interface Lesson {
  id: string; kind: LessonKind; text: string; rank: number; claim: string; scope: string;
  sources: { at: string | null; path: string | null; quote: string }[];
}
type Raw = RecordStore['raw'];
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const letters = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');
const parsed = (text: string | null): unknown => { try { return JSON.parse(text ?? 'null'); } catch { return text; } };
/** What a text names in backticks. */
const ticked = (text: string): string[] => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
/** A repo path a line names: relative, with a folder in it, and no scheme. */
const REPO_PATH = /^[\w.-]+(?:\/[\w.-]+)+$/;
const NEVER = /^never run `([^`]+)`/i;
const REJECTED = /(?:^|[.!?]\s+|\n\s*)rejected:[ \t]*`([^`\n]{1,200})`/g;
/** What an agent's host writes under the user's role: a repo's AGENTS.md, as a Codex rollout carries it, or its environment. */
const INJECTED = /^\s*(?:<|# AGENTS\.md)/;
const decisionKey = (lesson: string): string => sha256(`memory ${lesson}`);
const rejectedKey = (scope: string, direction: string): string => sha256(`rejected ${scope} ${direction}`);

/** The folder each repo's sessions worked in, read from the first of its transcripts that names one. */
export async function repoFolders(record: RecordStore, store: EvidenceStore): Promise<Map<string, string>> {
  const rows = (await record.raw('SELECT project_id AS project, transcript FROM sessions WHERE transcript IS NOT NULL AND project_id IS NOT NULL ORDER BY id')) as { project: string; transcript: string }[];
  const out = new Map<string, string>();
  for (const r of rows) {
    if (out.has(r.project)) continue;
    const cwd = cwdOf(Buffer.from(await store.read(r.transcript.replace(/^ev:/, ''))).toString('utf8'));
    if (cwd) out.set(r.project, cwd);
  }
  return out;
}

/** The lessons you haven't decided, most to gain first: a guard, then the rule most agents hold, then what's gone stale. */
export async function lessonsOf(raw: Raw, folders: ReadonlyMap<string, string>): Promise<Lesson[]> {
  const claims = (await raw("SELECT handle, page, scope, text FROM wiki_claims WHERE state = 'in force' AND (page = 'rules' OR page LIKE 'repos/%') ORDER BY log_pos")) as { handle: string; page: string; scope: string; text: string }[];
  const sources = new Map<string, Lesson['sources']>();
  for (const s of (await raw('SELECT claim, at, path, quote FROM wiki_sources ORDER BY n')) as { claim: string; at: string | null; path: string | null; quote: string }[]) {
    sources.set(s.claim, [...(sources.get(s.claim) ?? []), { at: s.at, path: s.path, quote: s.quote }]);
  }
  const decided = new Set(((await raw("SELECT key FROM decisions WHERE state = 'active'")) as { key: string }[]).map((d) => d.key));
  const stale = (c: (typeof claims)[number], held: Lesson['sources']): boolean => {
    if (!held.some((s) => s.at?.startsWith('ev:'))) return false;
    const folder = c.scope.startsWith('repo:') ? folders.get(c.scope.slice(5)) : undefined;
    if (!folder || !existsSync(folder)) return false;
    return ticked(c.text).some((p) => REPO_PATH.test(p) && !existsSync(join(folder, p)));
  };
  const lessons: Omit<Lesson, 'rank'>[] = [];
  for (const c of claims) {
    const held = sources.get(c.handle) ?? [];
    const kind: LessonKind | undefined = NEVER.test(c.text) ? 'guard' : c.page === 'rules' && held.length >= 2 ? 'shared-rule' : stale(c, held) ? 'removal' : undefined;
    if (!kind) continue;
    const id = `lesson-${sha256(`${kind} ${c.handle}`).slice(0, 12)}`;
    if (!decided.has(decisionKey(id))) lessons.push({ id, kind, text: c.text, claim: c.handle, scope: c.scope, sources: held });
  }
  const order: LessonKind[] = ['guard', 'shared-rule', 'removal'];
  lessons.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.sources.length - a.sources.length || a.text.localeCompare(b.text));
  return lessons.map((l, i) => ({ ...l, rank: i + 1 }));
}

/** Your decision, saved by the core; `subject` is what it came from, when that's a record object. */
export async function saveDecision(record: RecordStore, you: Connection, now: () => number, d: { key: string; scope: string; answer: string; subject?: string }): Promise<string> {
  const ts = now();
  const id = ulid(ts);
  await record.append({ writer: 'core', actor: you.actor, scope: you.scope }, {
    v: 1, id, kind: 'decision.created', ts, ...(d.subject ? { subject: d.subject } : {}), data: { key: d.key, scope: d.scope, answer: d.answer, ask: `ask:${ulid(ts)}` },
  });
  return `decision:${id}`;
}
/** Your `keep` of a lesson, saved at its claim's scope; it leaves the list. */
export const keepLesson = (record: RecordStore, you: Connection, now: () => number, lesson: Lesson): Promise<string> =>
  saveDecision(record, you, now, { key: decisionKey(lesson.id), scope: lesson.scope, answer: `keep: ${lesson.text}` });

/** The guard entry a kept `Never run` lesson installs, with its planted call and twin; deep-hook's matcher checks both. */
export function guardOf(lesson: Lesson): { v: 1; entries: Record<string, unknown>; proofs: Record<string, unknown> } | undefined {
  const command = NEVER.exec(lesson.text)?.[1];
  if (!command) return undefined;
  const name = `memory-${lesson.id.slice('lesson-'.length)}`;
  const bash = (c: string) => ({ tool_name: 'Bash', tool_input: { command: c } });
  return {
    v: 1,
    entries: { [name]: { match: /[|&;<>()$`"'\\*]/.test(command) ? `shell:${command}` : `run:${command}`, scope: lesson.scope === 'all' ? 'all_repos' : lesson.scope, mode: 'block', reason: `You kept this rule: ${lesson.text}.`, next_step: 'Ask the person, or do the work another way.', fail_closed: lesson.scope === 'all' } },
    proofs: { [name]: { planted: bash(command), twin: bash(`${command}x`) } },
  };
}

/** Whether a decision's scope covers a session in a repo. */
const covers = (scope: string, project: string | undefined, session: string | undefined): boolean =>
  scope === 'all' || (project !== undefined && scope === `repo:${project}`) || (session !== undefined && scope === `session:${letters(session)}`);
export interface Rejected { direction: string; decision: string; scope: string; said: boolean }
/**
 * The directions you rejected, from active decisions only: what you said in chat (`said`), and each option you passed over
 * when you answered a choice, keyed by the backticks in its label, unless the option you chose names it too. An option's
 * label is an agent's words, so only what you said yourself reaches a tool call.
 */
export async function rejectedDirections(raw: Raw): Promise<Rejected[]> {
  const rows = (await raw("SELECT d.id AS id, d.key AS key, d.answer AS answer, d.scope AS scope, (SELECT e.data FROM events e WHERE e.id = d.ask_id AND e.kind = 'ask.created') AS ask FROM decisions d WHERE d.state = 'active' ORDER BY d.id")) as { id: string; key: string; answer: string | null; scope: string | null; ask: string | null }[];
  const out: Rejected[] = [];
  for (const r of rows) {
    const answer = parsed(r.answer);
    const scope = String(parsed(r.scope));
    const decision = `decision:${r.id}`;
    // Only captureRejected's key: an option an agent named `rejected: ...`, or a page line you edited, says the same words.
    const spoken = typeof answer === 'string' ? /^rejected: `(.+)`$/.exec(answer)?.[1] : undefined;
    if (spoken && r.ask === null && r.key === rejectedKey(scope, spoken)) { out.push({ direction: spoken, decision, scope, said: true }); continue; }
    const ask = parsed(r.ask) as { kind?: string; options?: { id: string; label: string }[] } | null;
    if (ask?.kind !== 'choice' || !Array.isArray(ask.options)) continue;
    if (!ask.options.some((o) => o.id === answer)) continue;
    const chosen = new Set(ask.options.filter((o) => o.id === answer).flatMap((o) => ticked(o.label)));
    for (const o of ask.options) if (o.id !== answer) for (const direction of ticked(o.label)) if (!chosen.has(direction)) out.push({ direction, decision, scope, said: false });
  }
  return out;
}
/** Whether `text` holds `key` as a whole word, in any case: as deep-hook's `word:` reads a command, with case folded. */
function namesWord(text: string, key: string): boolean {
  const [hay, needle] = [text.toLowerCase(), key.toLowerCase()];
  const word = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}_./-]/u.test(c);
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
    if (!word(hay[at - 1]) && !word(hay[at + needle.length])) return true;
  }
  return false;
}
/**
 * The rejected direction a proposal's change revives, in the session's repo: what you said, named anywhere in it; an option
 * you passed over, an agent's label, only as the exact key in backticks.
 */
export async function revives(raw: Raw, change: string, project: string | undefined, session: string): Promise<Rejected | undefined> {
  const named = new Set(ticked(change));
  return (await rejectedDirections(raw)).find((r) => (r.said ? namesWord(change, r.direction) : named.has(r.direction)) && covers(r.scope, project, session));
}
/**
 * Your `rejected: \`x\`.` in the messages not yet read, each saved once as a decision for the repo you said it in. A transcript
 * read again may hold what you since overruled, so that stays overruled; a prompt `live` is new, so it rejects it again.
 */
export async function captureRejected(record: RecordStore, you: Connection, now: () => number, unread: readonly { session: string; project: string | null; messages: Message[]; from: number }[], live = false): Promise<void> {
  for (const u of unread) {
    for (const m of u.messages.slice(u.from)) {
      if (m.role !== 'user' || m.outside || m.tool !== undefined || INJECTED.test(m.text) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(m.id)) continue;
      for (const hit of m.text.matchAll(REJECTED)) {
        const scope = u.project ? `repo:${u.project}` : `session:${u.session}`;
        const key = rejectedKey(scope, hit[1]!);
        if (((await record.raw(`SELECT 1 FROM decisions WHERE key = ?${live ? " AND state = 'active'" : ''}`, [key])) as unknown[]).length) continue;
        await saveDecision(record, you, now, { key, scope, answer: `rejected: \`${hit[1]!}\``, subject: `session:${u.session}#${m.id}` });
      }
    }
  }
}
/** A kept lesson's guard entry, when the decision overruled is that keep: the lesson is back on your list, and its guard gone. */
export function dropKept(dir: string, key: string): void {
  dropEntries(dir, (name) => name.startsWith('memory-') && decisionKey(`lesson-${name.slice('memory-'.length)}`) === key);
}
/** What you said no to, as guard entries in rules.json: deep-hook reads the word, the hub each entry's repo. */
export async function syncRejected(raw: Raw, dir: string): Promise<void> {
  const entries = Object.fromEntries((await rejectedDirections(raw)).filter((r) => r.said).map((r) => [`rejected-${r.decision.slice('decision:'.length)}`, {
    match: `word:${r.direction}`, scope: r.scope === 'all' ? 'all_repos' : r.scope, mode: 'block',
    reason: `You rejected \`${r.direction}\` (${r.decision}).`, next_step: 'Take another direction, or ask the person to overrule that decision.', fail_closed: false,
  }]));
  writeRejected(dir, entries);
}
/** Whether a guard entry reaches a session: one this file wrote for a repo reads nothing elsewhere; any other's scope is free text. */
export const reaches = (name: string, scope: unknown, project: string | undefined, session: string): boolean =>
  !/^(?:memory|rejected)-/.test(name) || typeof scope !== 'string' || !/^(repo|session):/.test(scope) || covers(scope, project, session);

const words = (text: string): string => ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
export interface Taste { ask: string; text: string }
/**
 * Your past taste decisions in this repo for a screen `said` names as a whole word (a branch's name, a first prompt): what
 * you chose, never what you passed over, with its screenshot by hash. Only an option you chose saves a decision, never a default.
 */
export async function tastesFor(raw: Raw, project: string | undefined, said: string): Promise<Taste[]> {
  if (!project || !said) return [];
  const rows = (await raw("SELECT d.id AS id, d.answer AS answer, d.ask_id AS ask, e.data AS data FROM decisions d JOIN events e ON e.id = d.ask_id AND e.kind = 'ask.created' WHERE d.state = 'active' AND e.project_id = ? AND json_extract(e.data, '$.kind') = 'taste' ORDER BY e.log_pos", [project])) as { id: string; answer: string; ask: string; data: string }[];
  const out: Taste[] = [];
  const looking = words(said);
  for (const r of rows) {
    const data = JSON.parse(r.data) as { subject?: { screen?: unknown; element?: unknown }; options?: { id: string; label: string }[] };
    const screen = String(data.subject?.screen ?? '');
    if (!screen || !looking.includes(words(screen))) continue;
    const chosen = data.options?.find((o) => o.id === parsed(r.answer));
    if (!chosen) continue;
    const [answered] = (await raw("SELECT json_extract(data, '$.image') AS image FROM events WHERE kind = 'ask.answered' AND subject = ? ORDER BY log_pos DESC LIMIT 1", [`ask:${r.ask}`])) as { image: string | null }[];
    const shot = answered?.image ? `screenshot ev:${answered.image} (deep read ev:${answered.image})` : 'no screenshot was kept';
    out.push({ ask: r.ask, text: `- ${screen}, ${String(data.subject?.element ?? '')}: you chose "${chosen.label}" (decision:${r.id}); ${shot}.` });
  }
  return out;
}
export const tasteBlock = (tastes: readonly Taste[]): string | undefined =>
  tastes.length ? `Your person's past taste decisions for the screen this session works on:\n${tastes.map((t) => t.text).join('\n')}` : undefined;

const USAGE = 'Usage: deep memory [--json]\n       deep memory keep <lesson>\n       deep memory remove <lesson>\n       deep memory overrule <decision>';
/** `deep memory`: the ranked list and your rejections; keep, remove or overrule one once the OS confirms you. Exit 0 done, 1 refused, 2 usage, 3 not decided. */
export async function memoryCommand(args: readonly string[]): Promise<number> {
  const overruling = args[0] === 'overrule';
  const acting = args[0] === 'keep' || args[0] === 'remove' || overruling;
  if (acting ? args.length !== 2 : args.length > 1 || (args.length === 1 && args[0] !== '--json')) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  let reply: Reply;
  try {
    const token = readFileSync(rootOf(installedRoot()).token, 'utf8').trim();
    const peer = { pid: process.pid, start: (await startOf(process.pid)) ?? '' };
    reply = overruling
      ? await call(hubAddress().path, token, 'decision.overrule', { decision: args[1] }, peer)
      : acting
      ? await call(hubAddress().path, token, 'memory.act', { verb: args[0], lesson: args[1] }, peer)
      : await call(hubAddress().path, token, 'memory.list', {});
  } catch (error) {
    process.stderr.write(`BLOCKED: ${error instanceof Error ? error.message : String(error)}\n`);
    return 3;
  }
  if ('error' in reply) {
    process.stderr.write(`${reply.error.remediation}\n`);
    return reply.error.code === 'not_found' ? 1 : 3;
  }
  if (acting) {
    if (reply.result.status === 'refused') { process.stderr.write(`REFUSED: ${String(reply.result.reason)}\n`); return 1; }
    process.stdout.write(overruling ? `Overruled ${args[1]!}.\n` : `${args[0] === 'keep' ? 'Kept' : 'Removed'} ${args[1]!}: ${String(reply.result.decision)}\n`);
    return 0;
  }
  const lessons = reply.result.lessons as Lesson[];
  const rejected = reply.result.rejected as Rejected[];
  if (args[0] === '--json') { process.stdout.write(`${JSON.stringify({ lessons, rejected }, null, 2)}\n`); return 0; }
  if (!lessons.length) process.stdout.write('No lessons to keep or remove.\n');
  for (const l of lessons) process.stdout.write(`${l.rank}. [${l.kind}] ${l.text} (${l.sources.length} source${l.sources.length === 1 ? '' : 's'}) ${l.id}\n`);
  for (const r of rejected) process.stdout.write(`Rejected \`${r.direction}\` in ${r.scope}: ${r.decision}\n`);
  return 0;
}
