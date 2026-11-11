// The hub on its socket (#16): one process per user, listening on <root>/hub.sock, mode 0600, and on no network
// port. The event loop only reads lines, acknowledges, routes and writes replies: parser workers parse and scrub
// each line, and the core, in a worker of its own, owns the record. Every connection takes one role from the
// credential it presents in its first line, and every event takes its writer from that role.
import { execFileSync } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import net from 'node:net';
import tls from 'node:tls';
import { basename, dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { HookRequestLine } from '@deepbuild/adapters';
import { writerGeneration } from '@deepbuild/record/meta';
import { claudeSettings, readJson, relations, HOLD_MARGIN_MS, STOP_HOLD_MS, type Relation } from './claude-settings.js';
import { stopTimeoutS } from './codex-settings.js';
import { contractAdapter, rpcTable, type DeprecatedNotice } from './contracts.js';
import type { CoreMessage, CoreRequest } from './core-worker.js';
import { isPrCreate, isPrEdit } from './forge.js';
import { adapterOf, registry } from './hookmap.js';
import type { Part } from './context-fit.js';
import { takeLock, type Lock } from './lock.js';
import { reaches } from './memory.js';
import { handleOf as ruleHandle, noticeText, scopedAt } from './rules.js';
import { dropTestSettings, installedRoot, repoOf, rootOf, type Root } from './paths.js';
import { shedStartup, YOUNG } from './settle.js';
import { heavyDenial } from './heavy.js';
import { processHealth } from './process-health.js';
import { Waits, type HookSeen, type OpenCall, type Reply as WaitReply, type Restored } from './waits.js';
import { People } from './people.js';
import { identityAt, idOf, type Identity } from './identity.js';
import { plantedStart } from './plant.js';
import { AUTHORITY, CONTRACT, EXTENSION_HOLD_MS, FEATURES, line, plantOf, refuse, refusal, Refused, STAGE_HOLD_MS, ulid, VERSION, type CoreOptions, type Draft, type ExtensionReply, type Gated, type HookMeta, type Parsed, type Plant, type Refusal, type Scope, type Scoped, SCREEN_TOOLS, type StageReach, type VfsSettings } from './wire.js';

/** How often the hub checks that its lock file is still the one it holds (#909): the design says at least once a minute. */
const LOCK_CHECK_MS = 5000;
/** A line longer than this goes to the parser kept for large lines, so it never queues ahead of small ones. */
const BIG = 1 << 20;
const MAX_LINE = 64 << 20;
/**
 * A consumer more than this many frames behind is cut off with fell_behind, never dropped silently (#34): the
 * socket holds at most this many of its frames, and one that takes none of them for STALL_MS while more wait is cut.
 * Bytes count too (#1575): one frame can be as large as an event, so the socket holds at most BEHIND_BYTES of them.
 */
const BEHIND = 10_000;
const BEHIND_BYTES = 8 << 20;
const STALL_MS = 100;

/** A person's connection (#1337) reads only what that person may see. */
type Role = 'hook' | 'app' | 'cli' | 'mcp' | 'person';
/** Which roles may call each method. A hook connection may only send its one request. */
const ALLOWED = new Map<string, readonly Role[]>([
  // A promotion (#1334): the drain, the health check's fixture claim and the rollback's one notice.
  ['hub.drain', ['cli']], ['hub.check', ['cli']], ['build.rolled_back', ['cli']],
  ['hub.health', ['app', 'cli', 'person']], ['health', ['app', 'cli', 'person']], ['events.read', ['app', 'cli', 'person']], ['stream.subscribe', ['app', 'cli']], ['ask.answer', ['app', 'cli']], ['ask.confirm', ['app']], ['views.installed', ['app']], ['command.run', ['app']],
  // The App API (#34): its reads, each with the log_pos it reflects and the hub's start ID, an overrule and pairing a device.
  ['inbox.read', ['app', 'cli']], ['ask.card', ['app', 'cli']], ['sessions.read', ['app', 'cli', 'person']], ['changes.read', ['app', 'cli']], ['evidence.read', ['app', 'cli']],
  ['numbers.read', ['app', 'cli']], ['numbers.baseline', ['cli']], ['race.start', ['cli']], ['numbers.refresh', ['cli']], ['numbers.sample', ['cli']], ['decision.overrule', ['app', 'cli']], ['ask.undo', ['app', 'cli']], ['ask.take_over', ['app', 'cli']], ['device.pair', ['app', 'cli']], ['device.unpair', ['app', 'cli']], ['channel.link', ['app', 'cli']], ['confirm.enroll', ['app']],
  // A permission you said yes to in the terminal, offered back, saved as a decision with one click (#23).
  ['offer.save', ['app', 'cli']],
  // A run of a destructive command undone from the copy staged before it ran (#347).
  ['staged.undo', ['app', 'cli']],
  // The Agents page (#148): a server or a skill proposed for the agents you choose, the page's model, Codex's daemon
  // restarted through an ask, a sync undone; and `deep mcp-exec`, a synced server's command with its secrets by handle.
  ['agents.propose', ['app', 'cli']], ['agents.read', ['app', 'cli']], ['agents.restart', ['app', 'cli']], ['agents.undo', ['app', 'cli']], ['box.say', ['app', 'cli']], ['mcp.exec', ['cli']],
  ['gates.off', ['app', 'cli']], ['gates.on', ['app', 'cli']], ['you.confirm', ['cli']], ['status.read', ['app', 'cli', 'person']], ['rows.read', ['app', 'cli', 'person']], ['row.read', ['app']], ['find.read', ['app']], ['hub.stop', ['app', 'cli']], ['run.start', ['app', 'cli']], ['run.output', ['app', 'cli']], ['host.list', ['app', 'cli']], ['host.facts', ['app', 'cli']], ['host.plan', ['cli']], ['host.ran', ['cli']], ['host.changes', ['app', 'cli']], ['test.load', ['app', 'cli']],
  // A new secret, on the trusted path, and which are held; values never come back (#70).
  ['secret.enter', ['cli']], ['secret.list', ['app', 'cli']],
  // A hosted terminal the hub reattaches after a restart (#70).
  ['terminal.open', ['app']], ['terminal.tab', ['app']], ['terminal.input', ['app']],
  ['env.up', ['app', 'cli']], ['env.down', ['app', 'cli']],
  // Sessions started without your Send (#1330): a run you approve, and a start under it, from your own terminal.
  ['start.approve', ['cli']], ['start.session', ['cli']],
  // A person added to a project, with a credential of their own (#1337).
  ['person.add', ['cli']],
  // An online model library turned on or off, and your standing rule for it (#1731).
  ['library.on', ['cli']], ['library.off', ['cli']], ['library.rule', ['cli']], ['pack.rule', ['cli']], ['job.rule', ['cli']],
  // A one-time invite to a project, and a person's credentials revoked (#1338).
  ['person.invite', ['cli']], ['person.revoke', ['cli']],
  // `deep lease` (#1015): a heavy command's place in the queue, its process group once it starts, and its first process's exit.
  ['lease.wait', ['cli']], ['lease.started', ['cli']], ['lease.exited', ['cli']], ['extension.install', ['cli']], ['guard.add', ['cli']], ['record.backup', ['cli']], ['test.verdict', ['cli']],
  ['mcp.call', ['mcp']], ['mcp.cancel', ['mcp']], ['evidence.paste', ['app']],
  // Setup reads your history into the wiki (#356).
  ['wiki.build', ['cli']],
  // Every agent's memory: the ranked list, and your keep or remove of a lesson (#111).
  ['memory.list', ['cli']], ['memory.act', ['cli']],
  // The rules page (#344): written from your rule files, a scope's reach before you save it, who a rule reached, a session's set.
  ['rules.sync', ['app', 'cli']], ['rules.reach', ['app', 'cli']], ['rules.credit', ['app', 'cli']], ['session.rules', ['app', 'cli']],
  // The blind acceptance job (#1328).
  ['acceptance.start', ['cli']], ['acceptance.status', ['app', 'cli']], ['acceptance.dispute', ['cli']], ['acceptance.ended', ['cli']],
  // Landing in turn (#1331): from your own terminal only.
  ['land.judge', ['cli']], ['land.round', ['cli']], ['work.once', ['cli']],
  ['job.submit', ['app', 'cli']], ['job.status', ['app', 'cli']], ['job.list', ['app', 'cli']], ['checks.kinds', ['app', 'cli']], ['job.output', ['app', 'cli']],
  // A window reading comes from the app, the CLI, or deep-hook's status line forwarder, which connects as a hook does.
  ['windows.report', ['app', 'cli', 'hook']],
  // `deep workspace` (#67), and the views of the projects you're in.
  ['work.fix', ['cli']], ['workspace.new', ['cli']], ['workspace.move', ['cli']], ['workspace.revert', ['cli']], ['workspace.diff', ['cli']], ['workspace.drift', ['cli']], ['project.views', ['app', 'cli']],
  // The app API's views/shown and views/hidden (#262): the views the app shows, repeated every 5 s while shown.
  ['views.shown', ['app']], ['views.hidden', ['app']],
  // What macOS says of the app's notifications (#994), when the app connects and when it changes.
  ['notifications.report', ['app']],
  // The canvas side (#806): `deep show` from the CLI; revisions and messages read; the app's input and what it draws.
  ['canvas.show', ['cli']], ['canvas.export', ['cli']], ['canvas.revisions', ['app', 'cli']], ['canvas.messages', ['app', 'cli']], ['canvas.user', ['app']], ['canvas.drawn', ['app']],
  // Our waiter, run by Claude Code's Stop entry as you, holds until an answer for its session is ready (#18, #25).
  // The pi package holds the same wait on its own connection, and says what became of each answer it took (#40).
  ['session.wait', ['cli', 'mcp']], ['session.delivered', ['mcp']], ['session.stop_waiting', ['mcp']],
  // Your words into a session from the app, a note or a page's box, recorded from: app by their request ID (#340).
  ['session.note', ['app']], ['ask.later', ['app']], ['session.pause', ['app']],
  // A session's name from the Session menu's Rename, and why a session reads as it does, for `deep status <session> --why` (#2018).
  ['session.rename', ['app']], ['row.why', ['app', 'cli', 'person']],
  // A send-back planted for a session's next stop, served only to a hub a test started with DEEP_HUB_TEST_SEND_BACK=1 (#25).
  ['test.send_back', ['cli']],
  // The hub's clock stepped forward, served only to a hub a test started with DEEP_HUB_TEST_CLOCK_STEPS=1 (#965).
  ['test.clock', ['cli']],
]);

/** How long before an acknowledged hold the extensions' reply must be on the socket, so it reaches deep-hook in time. */
const HOLD_MARGIN = 100;
/** How long a session's start or a prompt is held for the core's context: the briefing, or answers waiting for it. */
const CONTEXT_HOLD_MS = 2000;
/** A Claude Code stop's hold; DEEP_HUB_TEST_STOP_HOLD_MS, which only tests set, shortens it so an unanswered hold ends in seconds. */
const STOP_HOLD = Math.min(STOP_HOLD_MS, Number(process.env.DEEP_HUB_TEST_STOP_HOLD_MS) || STOP_HOLD_MS);
/** How long a call that may need your authority is held for the core's gate (#321); one not decided by then is denied. */
const GATE_HOLD_MS = 10_000;
/** A permission request paseo's plugin gates waits for your answer, up to a day (#55). */
const PASEO_PERMISSION_HOLD_MS = 24 * 3600_000;
/** Claude Code's own timeout for a PermissionRequest entry that sets none. */
const PERMISSION_TIMEOUT_MS = 60_000;
/** The guard entries a standing rule decides with the hub up (#23): dependencies and cloud resources the plan doesn't name. */
const DECIDED_MATCH = /^effect:(dependency|cloud-resource)$/;
/** The guard entries whose calls the hub stages before they run with the hub up, or asks about (#347, #1294, #1507). */
const STAGED_MATCH = 'effect:unknown-reach-delete';
const PAST_MATCH = 'effect:unrestorable-delete';
const DISCARD_MATCH = 'effect:discard-edits';
const STASH_MATCH = 'effect:drop-stash';
const STAGED_MATCHES: unknown[] = [STAGED_MATCH, PAST_MATCH, DISCARD_MATCH, STASH_MATCH];
/** The permission modes in which Claude Code denies what isn't allowed already: a standing rule never allows past them. */
const DENYING_MODES = new Set(['dontAsk', 'plan']);
/** The App API's reads beside events.read: each result carries the hub's start ID beside the log_pos it reflects. */
const READS = new Set(['inbox.read', 'sessions.read', 'changes.read', 'evidence.read', 'numbers.read']);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/**
 * The connection as one call of a deprecated method sees it: its reply line carries the notice beside its result.
 * Every other property reads and writes through to the connection itself.
 */
function noticed<C extends object>(conn: C & { write(value: Obj): void }, id: unknown, notice: DeprecatedNotice): C {
  const write = (value: Obj): void => conn.write(value.id === id && 'result' in value ? { ...value, deprecated: notice } : value);
  return new Proxy(conn, {
    get: (target, key) => (key === 'write' ? write : Reflect.get(target, key, target)),
    set: (target, key, value) => Reflect.set(target, key, value, target),
  });
}
const EMPTY_REPLY = line({ exit: 0, stdout: '', stderr: '' });
/** A warn entry's words in the guard entries' reply to a call no entry blocks, or none. */
const warnings = (ruled: string): string[] =>
  ruled === EMPTY_REPLY ? [] : [(JSON.parse(String((JSON.parse(ruled) as Obj).stdout)) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext];
/**
 * The extensions' joined reply as the agent's own hook output (#350): a deny ends the call, its reasons on stderr
 * as deep-hook's own denials are; context goes as Claude Code reads it, after a warn entry's words, each block
 * labelled with its extension. `ruled` is the guard entries' reply: an agent with no context channel, or a reply
 * with no context, gets it as it is.
 */
function agentReply(agent: string, reply: ExtensionReply, ruled: string, fitted?: string): string {
  if (reply.denies.length) return line({ exit: 2, stdout: '', stderr: reply.denies.map((d) => `DeepBuild blocked this: [${d.extension}] ${d.reason}`).join('\n') + '\n' });
  if (!reply.context.length || (agent !== 'claude-code' && agent !== 'claude')) return ruled;
  const additionalContext = fitted ?? contextParts(reply, ruled).map((p) => p.text).join('\n');
  return line({ exit: 0, stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext } }), stderr: '' });
}
/** A warn entry's words, then each extension's block, labelled: the parts of a call's context the cap fits (#1296). */
const contextParts = (reply: ExtensionReply, ruled: string): Part[] =>
  [...warnings(ruled).map((text) => ({ name: 'guard warnings', text, keep: true })), ...reply.context.map((b) => ({ name: `${b.extension}'s context`, text: `[${b.extension}] ${b.text}` }))];
/**
 * The core's reply as the agent's hook output: a block with its reason (a stop sent back, a prompt answered from the
 * record), or context the agent adds at a session's start or a prompt, never a decision; beside either, the one
 * line the chat shows (`systemMessage`, #83). Nothing to say is the hook's empty reply.
 */
function coreReplyLine(agent: string, event: string, reply: { context?: string; block?: string; message?: string }, watchPaths?: string[]): string {
  const out: Record<string, unknown> = {};
  // Context goes as the agent's adapter gives it the model (#1296); one that gives none at this event sends nothing.
  const adapter = adapterOf(agent);
  const given = reply.context && !reply.block && adapter?.contextReply ? adapter.contextReply(event, reply.context) : undefined;
  if (reply.block) Object.assign(out, { decision: 'block', reason: reply.block });
  else if (given) {
    const json = ((): unknown => { try { return JSON.parse(given.stdout); } catch { return undefined; } })();
    if (!isObj(json)) return line(given);
    Object.assign(out, json);
  }
  else if (reply.context && !adapter?.contextReply) out.hookSpecificOutput = { hookEventName: event, additionalContext: reply.context };
  // A session's start names the ticker file whose change fires its FileChanged hook: the route a line takes into the
  // terminal while a call still runs (#120).
  if (watchPaths?.length && !reply.block) out.hookSpecificOutput = { hookEventName: event, ...(isObj(out.hookSpecificOutput) ? out.hookSpecificOutput : {}), watchPaths };
  if (reply.message) out.systemMessage = reply.message;
  return Object.keys(out).length ? line({ exit: 0, stdout: JSON.stringify(out), stderr: '' }) : EMPTY_REPLY;
}
/**
 * A hook's reply with what the waits add (#120): the one line the chat shows, context for the agent, and a rewritten
 * input carrying a deadline, never a decision. A reply that already denies the call stands as it is.
 */
function withWaits(ruled: string, event: string, wait: WaitReply): string {
  if (!wait.message && !wait.context && !wait.updatedInput) return ruled;
  const reply = ruled === EMPTY_REPLY ? { exit: 0, stdout: '', stderr: '' } : JSON.parse(ruled) as { exit: number; stdout: string; stderr: string };
  if (reply.exit !== 0) return ruled;
  const out = reply.stdout ? JSON.parse(reply.stdout) as Record<string, unknown> : {};
  const specific = isObj(out.hookSpecificOutput) ? out.hookSpecificOutput : { hookEventName: event };
  if (wait.context) specific.additionalContext = [specific.additionalContext, wait.context].filter(Boolean).join('\n');
  if (wait.updatedInput) specific.updatedInput = wait.updatedInput;
  if (wait.context || wait.updatedInput) out.hookSpecificOutput = specific;
  if (wait.message) out.systemMessage = [out.systemMessage, wait.message].filter(Boolean).join('\n');
  return line({ exit: 0, stdout: JSON.stringify(out), stderr: reply.stderr });
}
/** A file's identity, size and time, so a change is read once; 'none' while it is missing. */
const fileKey = (file: string): string => { try { const s = statSync(file); return `${s.ino}:${s.size}:${s.mtimeMs}`; } catch { return 'none'; } };
const versionRefusal = (value: Obj): Refusal =>
  refusal('v' in value ? 'const' : 'required', '/v', 'Send every line with "v": 1, the socket protocol version.', value.v);
/** A subscribe's scope (#1575): none, as the app subscribes; one session; or the list's rows. Anything else is refused, never read as none. */
function scopeOf(given: unknown): Scope | undefined | Refused {
  if (given === undefined) return undefined;
  if (isObj(given) && given.kind === 'list') return { kind: 'list' };
  if (!isObj(given) || given.kind !== 'session') return refuse('enum', '/params/scope/kind', 'Scope the stream to one session, {"kind": "session", "session": <its ID>}, or to the list\'s rows, {"kind": "list"}.', isObj(given) ? given.kind : given);
  if (typeof given.session !== 'string' || !given.session) return refuse('required', '/params/scope/session', 'Name the session the stream is scoped to by its ID.', given.session);
  return { kind: 'session', session: given.session };
}


interface CoreLink {
  post(message: CoreMessage & { op: 'hook' | 'replayed' | 'unsubscribe' | 'waiter-gone' | 'notifier-gone' | 'hook-gone' | 'overrun' | 'later' | 'line' | 'denied' | 'call-gone' }): void;
  request(request: CoreRequest): Promise<unknown>;
  /** Resolves once the record is open, the spool replayed, in-flight runs recovered and the extensions started, with the hook kinds they handle. */
  started: Promise<{ hooks: string[] }>;
  close(): Promise<void>;
}
/** `scrub` adds values every hook line read from now on is scrubbed of (#332: credentials env-local loaded). */
interface Parsers { parse(chunks: Buffer[], first: boolean): Promise<Parsed>; scrub(values: string[]): void; close(): Promise<void> }

/** A frame from the core: its event's JSON text, or, `caught` set, the head its subscriber's replay reached (#1575). */
type OnFrame = (sub: string, event: string, caught?: boolean) => void;

function coreWorker(options: CoreOptions, onFrame: OnFrame, onFatal: (why: string) => void, onAsking: (sessions: string[], judged: string[], resend: string[], cantRun: string[]) => void, onAcking: (session: string) => void, onScrub: (values: string[]) => void): CoreLink {
  const worker = new Worker(new URL('./core-worker.js', import.meta.url), { workerData: { core: options }, resourceLimits: YOUNG });
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: unknown): void }>();
  let n = 0;
  let started!: (v: { hooks: string[] }) => void;
  const ready = new Promise<{ hooks: string[] }>((resolve) => { started = resolve; });
  worker.on('message', (m: { op?: string; n?: number; sub?: string; event?: string; caught?: boolean; message?: string; result?: unknown; error?: Refusal; hooks?: string[]; sessions?: string[]; judged?: string[]; resend?: string[]; cantRun?: string[]; session?: string; values?: string[] }) => {
    if (m.op === 'frame') return onFrame(m.sub!, m.event!, m.caught);
    if (m.op === 'asking') return onAsking(m.sessions ?? [], m.judged ?? [], m.resend ?? [], m.cantRun ?? []);
    if (m.op === 'acking') return onAcking(m.session!);
    if (m.op === 'scrub') return onScrub(m.values ?? []);
    if (m.op === 'started') return started({ hooks: m.hooks ?? [] });
    if (m.op === 'fatal') return onFatal(m.message!);
    const waiting = pending.get(m.n!);
    pending.delete(m.n!);
    if (m.error) waiting?.reject(new Refused(m.error));
    else waiting?.resolve(m.result);
  });
  worker.on('error', (error) => onFatal(error.stack ?? error.message));
  return {
    post: (message) => worker.postMessage(message),
    request: (request) => new Promise((resolve, reject) => {
      pending.set(++n, { resolve, reject });
      worker.postMessage({ ...request, n });
    }),
    started: ready,
    close: async () => { await worker.terminate(); },
  };
}
/** The commit-on-event-loop plant: the core on the event loop, committing through the synchronous binding there. */
async function coreInline(options: CoreOptions, onFrame: OnFrame, onFatal: (why: string) => void, onAsking: (sessions: string[], judged: string[], resend: string[], cantRun: string[]) => void, onAcking: (session: string) => void, onScrub: (values: string[]) => void): Promise<CoreLink> {
  const { Core } = await import('./core.js');
  const { answer, asRefusal } = await import('./core-worker.js');
  const core = new Core(options, onFrame, onAsking, onAcking, onScrub);
  const started = core.started().then(() => ({ hooks: core.hooks() }));
  started.catch((error: unknown) => onFatal(error instanceof Error ? error.stack ?? error.message : String(error)));
  return {
    started,
    post: (message) => {
      if (message.op === 'hook') void core.hook(message.drafts, message.meta, message.writer).catch(() => undefined);
      else if (message.op === 'replayed') void core.replayed(message.drafts, message.meta).catch(() => undefined);
      else if (message.op === 'waiter-gone') core.waiterGone(message.key);
      else if (message.op === 'notifier-gone') void core.notifierGone();
      else if (message.op === 'hook-gone') core.hookGone(message.id, message.session);
      else if (message.op === 'overrun') void core.overrun(message).catch(() => undefined);
      else if (message.op === 'later') core.later(message.session, message.cwd, message.text);
      else if (message.op === 'line') void core.line(message.session, message.agent, message.text).catch(() => undefined);
      else if (message.op === 'denied') core.denied(message.session, message.call, { guard: message.guard, label: message.label });
      else if (message.op === 'call-gone') core.callGone(message.call, message.closed === true);
      else core.unsubscribe(message.sub);
    },
    request: (request) => answer(core, request).catch((error: unknown) => { throw new Refused(asRefusal(error)); }),
    close: async () => undefined,
  };
}

function parserPool(given: readonly string[], plant: Plant | undefined, dir: string): Parsers {
  // The pool's own list: each scrub's values join it, so a parser started later begins with all its elder was sent.
  const held = [...given];
  const pending = new Map<number, (parsed: Parsed) => void>();
  let n = 0;
  const make = () => {
    const worker = new Worker(new URL('./parser.js', import.meta.url), { workerData: { held, dir, ...(plant ? { plant } : {}) }, resourceLimits: YOUNG });
    worker.on('message', ({ n: id, parsed }: { n: number; parsed: Parsed }) => {
      pending.get(id)?.(parsed);
      pending.delete(id);
    });
    return worker;
  };
  // One parser for small lines, and one for large ones, started at the first: an idle hub holds one thread fewer.
  const small = make();
  let big: Worker | undefined;
  return {
    parse(chunks, first) {
      const size = chunks.reduce((sum, c) => sum + c.length, 0);
      const worker = size > BIG ? (big ??= make()) : small;
      return new Promise((resolve) => {
        pending.set(++n, resolve);
        worker.postMessage({ n, chunks, first });
      });
    },
    scrub(values) {
      held.push(...values);
      for (const worker of [small, big]) worker?.postMessage({ scrub: values });
    },
    close: async () => { await Promise.all([small, big].map((w) => w?.terminate())); },
  };
}
/** The parse-on-event-loop plant: every line it reads scrubbed and parsed on the event loop. */
async function parserInline(held: string[], plant: Plant, dir: string): Promise<Parsers> {
  const { parseLine } = await import('./hookmap.js');
  const { scrubText } = await import('@deepbuild/evidence');
  return {
    parse: async (chunks, first) => {
      const line = Buffer.concat(chunks);
      const parsed = parseLine(line, first, held, plant);
      // A hook line is scrubbed whole, as a hub that scrubs what it reads before keeping any field would.
      if (parsed.kind === 'hook') scrubText(line.toString('utf8'), { held });
      const scoped = parsed.kind === 'hook' ? scopedAt(parsed.meta, dir) : undefined;
      return scoped ? { ...parsed, scoped } : parsed;
    },
    scrub(values) { held.push(...values); },
    close: async () => undefined,
  };
}

class Conn {
  role: Role | undefined;
  name = '';
  session: string | null = null;
  parent: { pid: number; start: string } | undefined;
  /** For a deep mcp, the folder it runs in: which known worktree's spec an unbound deep_search reads. */
  cwd: string | undefined;
  /** For an app or cli connection, the process its hello names as its own: the peer check starts there. */
  peer: { pid: number; start: string } | undefined;
  /** The person whose credential the connection presented (#1337); none for the owner. */
  person: string | undefined;
  /**
   * A connection over the network listener (#1338), with the ID of the key its TLS handshake proved, if any: it says
   * hello first, with a credential bound to that key, or it gets nothing.
   */
  remote: { key: string | undefined } | undefined;
  /** A network connection that carries hooks its machine spooled while the link was down (#1338), one per line. */
  spool = false;
  first = true;
  done = false;
  /** A waiter's connection: its close tells the core the waiter is gone. */
  waiter = false;
  queue: Promise<void> = Promise.resolve();
  pending: Buffer[] = [];
  size = 0;
  readonly subs = new Set<string>();
  /** Its deep mcp calls in flight, each `<connection>:<call ID>`: a cancel or the connection's close tells the core their caller is gone (#1923). */
  readonly calls = new Set<string>();
  constructor(readonly id: number, readonly sock: net.Socket) {}
  write(o: object): void {
    if (!this.done && this.sock.writable) this.sock.write(line(o));
  }
  end(): void {
    if (this.done) return;
    this.done = true;
    this.sock.end();
  }
}

/**
 * One subscription: how many of its frames the socket holds and hasn't taken, and their bytes, the frames waiting
 * beyond those, and since when it has taken none.
 */
interface Sub { conn: Conn; id: unknown; queued: number; bytes: number; held: string[]; next: number; since: number; watch?: NodeJS.Timeout | undefined }
/** What the hub reads of a guard@1 entry in rules.json. */
/** The defaults the core decides from the thread's prompts (#84), each with what it does. */
const NAMED_RULES: Record<string, 'push' | 'pr' | 'merge'> = { 'push-needs-ask': 'push', 'pr-needs-ask': 'pr', 'merge-needs-ask': 'merge', 'merge-names-head': 'merge' };
/** What a merge names (#84): deep-hook's read of a shell call, or the MCP tool's own `sha` and pull request number. */
function mergeNamed(meta: HookMeta, data: Obj): NonNullable<Gated['merge']> {
  const read = Object.values(meta.notes ?? {}).find((n) => n.startsWith('merge'));
  if (read !== undefined) {
    const part = (name: string) => new RegExp(`\\b${name}=(\\S+)`).exec(read)?.[1];
    const [pr, head] = [part('pr'), part('head')];
    return { ...(pr ? { pr } : {}), ...(head ? { head } : {}), ...(/ auto\b/.test(read) ? { auto: true } : {}), ...(/ disable\b/.test(read) ? { disable: true } : {}), ...(/ blind\b/.test(read) ? { blind: true } : {}) };
  }
  const input = isObj(meta.call?.input) ? meta.call.input : {};
  const pr = input.pullNumber ?? input.pull_number;
  return data.effect === 'merge' ? { ...(typeof input.sha === 'string' ? { head: input.sha } : {}), ...(pr !== undefined ? { pr: String(pr) } : {}) } : {};
}
interface Guard { match?: unknown; scope?: unknown; mode?: unknown; reason?: unknown; next_step?: unknown; fail_closed?: unknown }

class Hub {
  private readonly server = net.createServer({ allowHalfOpen: false });
  private readonly conns = new Set<Conn>();
  /** The connection that last reported the app's notification setting. */
  private notifier: Conn | undefined;
  private readonly subs = new Map<string, Sub>();
  private core!: CoreLink;
  private parsers!: Parsers;
  private ids = 0;
  private ino = 0;
  private stopping = false;
  /** The lock file was removed or replaced under this hub (#909): another start can take it, so no hook is acknowledged. */
  private lost = false;
  /** The hook kinds some extension handles: only such a hook is held for the extensions' reply. */
  private hooks = new Set<string>();
  /** The sessions with an ask still to deliver, as the core last said: only their stops are held (#18, #19). */
  private asking = new Set<string>();
  /** The sessions whose cut-off turn started a send with no recorded end (#85), as the core tells it: their shell and MCP calls are checked at the gate first. */
  private resend = new Set<string>();
  /** The sessions with a message typed mid-turn to acknowledge (#340): the next tool call's hook is held for it. */
  private readonly acking = new Set<string>();
  /** `deep off` in effect (#19): every gate watch-only, while the floor (the fail_closed entries) holds. */
  private off = false;
  /** The agents whose hook entries run a program that can't run, as the core's last check found (#993): their gates are watch-only. */
  private cantRun = new Set<string>();
  /** The published JSON-RPC methods: a deprecated one is served through its replacement, with a notice (#139). */
  private readonly adapter = contractAdapter(rpcTable());
  readonly start = ulid(Date.now());
  private helloLine = '';
  /** The long waits (#120): expected times, overruns and the lines they show; one timer for the earliest due. */
  private readonly waits: Waits;
  private waitTimer: NodeJS.Timeout | undefined;
  /** The hub's clock (the test clock, moved on by a restart): what the waits measure by, like the record's `ts`. */
  private now: () => number = Date.now;

  /** The people this hub holds credentials for (#1337), read again when one is added. */
  private readonly people: People;
  /** The hub's own key (#1338): its ID is in every hello, and the network listener's certificate carries it. */
  private identity!: Identity;
  /** The network listener (#1338), open only while a project here has a member. */
  private network: tls.Server | undefined;
  constructor(private readonly root: Root, private readonly token: string, private readonly lock: Lock, private readonly plant: Plant | undefined, private readonly vfs: VfsSettings | undefined) {
    this.people = new People(root.dir);
    this.waits = new Waits({ rewrites: (agent) => this.rewrites(agent), ...(plant ? { plant } : {}) });
  }

  async open(clock: CoreOptions['clock']): Promise<void> {
    this.now = () => clock.start + (Date.now() - clock.real);
    const held = [this.token, ...testHeld()];
    this.off = gatesOff(this.root);
    const options: CoreOptions = { root: this.root.dir, clock, held, ...(this.plant ? { plant: this.plant } : {}), ...(this.vfs ? { vfs: this.vfs } : {}),
      ...(process.env.DEEP_HUB_TEST_HOST ? { host: process.env.DEEP_HUB_TEST_HOST } : {}),
      ...(Number(process.env.DEEP_HUB_TEST_LEASE_MS) > 0 ? { leaseMs: Number(process.env.DEEP_HUB_TEST_LEASE_MS) } : {}),
      ...(process.env.DEEP_HUB_TEST_CRASH === 'start-recorded' || process.env.DEEP_HUB_TEST_CRASH === 'spawned' ? { crash: process.env.DEEP_HUB_TEST_CRASH } : {}),
      ...(process.env.DEEP_HUB_TEST_CONFIRM ? { confirm: process.env.DEEP_HUB_TEST_CONFIRM } : {}),
      ...(process.env.DEEP_HUB_TEST_POLKIT ? { polkit: process.env.DEEP_HUB_TEST_POLKIT } : {}),
      ...(process.env.DEEP_HUB_TEST_INDEX ? { index: process.env.DEEP_HUB_TEST_INDEX } : {}),
      ...(process.env.DEEP_HUB_TEST_FORGE ? { forge: process.env.DEEP_HUB_TEST_FORGE } : {}),
      ...(process.env.DEEP_HUB_TEST_SORTER ? { sorter: process.env.DEEP_HUB_TEST_SORTER } : {}),
      ...(process.env.DEEP_HUB_TEST_DRAFTS ? { drafts: process.env.DEEP_HUB_TEST_DRAFTS } : {}),
      ...(process.env.DEEP_HUB_TEST_ACCEPTED ? { accepted: process.env.DEEP_HUB_TEST_ACCEPTED } : {}),
      ...(process.env.DEEP_HUB_TEST_WORK ? { work: process.env.DEEP_HUB_TEST_WORK } : {}),
      ...(process.env.DEEP_HUB_TEST_PRICES ? { prices: process.env.DEEP_HUB_TEST_PRICES } : {}),
      ...(process.env.DEEP_HUB_TEST_GITHUB ? { github: process.env.DEEP_HUB_TEST_GITHUB } : {}),
      ...(process.env.DEEP_HUB_TEST_FAIL_JOB ? { failJob: process.env.DEEP_HUB_TEST_FAIL_JOB } : {}) };
    const frame = (sub: string, event: string, caught?: boolean) => {
      const s = this.subs.get(sub);
      if (!s || s.conn.done) return;
      const text = `{"v":${VERSION},"id":${JSON.stringify(s.id)},${caught ? `"caught_up":${event}` : `"event":${event}`}}\n`;
      if (s.next === s.held.length && s.queued < BEHIND && s.bytes < BEHIND_BYTES) return this.send(sub, s, text);
      s.held.push(text);
      s.watch ??= setInterval(() => {
        if (s.next < s.held.length && Date.now() - s.since > STALL_MS) this.cut(sub, s);
      }, STALL_MS / 5);
    };
    const fatal = (why: string) => {
      process.stderr.write(`deep hub: the core stopped: ${why}\n`);
      this.exit(1);
    };
    const asking = (sessions: string[], judged: string[], resend: string[], cantRun: string[]) => { this.asking = new Set(sessions); this.worked = new Set(judged); this.resend = new Set(resend); this.cantRun = new Set(cantRun); };
    const acking = (session: string) => { this.acking.add(session); };
    const scrub = (values: string[]) => { this.parsers.scrub(values); };
    // The record's writer generation (#572), read before the core opens the ledger so every hello carries it from the
    // first; read-only, so this thread never checkpoints or syncs the ledger, and one that can't be read stops the start.
    this.identity = identityAt(join(this.root.dir, 'hub.key'), 'deep-hub');
    // The planted hub of #1334 speaks a contract one major ahead, so this checkout's deep-hook is the older side.
    const contract = this.plant === 'contract-major-ahead' ? `${Number(CONTRACT.split('.')[0]) + 1}.0` : CONTRACT;
    this.helloLine = line({ hello: 'deep-hub', start: this.start, contract, features: FEATURES, generation: writerGeneration(this.root.ledger), hub: this.identity.id });
    this.core = this.plant === 'commit-on-event-loop' ? await coreInline(options, frame, fatal, asking, acking, scrub) : coreWorker(options, frame, fatal, asking, acking, scrub);
    this.parsers = this.plant === 'parse-on-event-loop' ? await parserInline(held, this.plant, this.root.dir) : parserPool(held, this.plant, this.root.dir);
    this.server.on('connection', (sock) => this.accept(sock));
    // Out of descriptors, the accept loop keeps going: libuv sheds the connections it can't take, and the next one is served.
    this.server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EMFILE' && error.code !== 'ENFILE') process.stderr.write(`deep hub: ${error.message}\n`);
    });
    // The lock is held and nothing listens there, so whatever is at the socket's path is a dead hub's: removed, then
    // made again only you can open.
    rmSync(this.root.socket, { force: true });
    const umask = process.umask(0o177);
    try {
      await new Promise<void>((resolve, reject) => {
        this.server.once('error', reject);
        this.server.listen(this.root.socket, () => { this.server.off('error', reject); resolve(); });
      });
    } finally {
      process.umask(umask);
    }
    chmodSync(this.root.socket, 0o600);
    this.ino = statSync(this.root.socket).ino;
    await this.syncNetwork();
    // Hooks are acknowledged from the moment the socket exists; the hub reports ready once its core has started.
    this.hooks = new Set((await this.core.started).hooks);
    // Once lost, the lock stays lost: every gate turns watch-only, BLOCKED, and deep-hook spools what this hub won't take.
    const checking = setInterval(() => {
      if (this.lost || this.lock.held() || this.plant === 'lock-never-rechecked') return;
      this.lost = true;
      clearInterval(checking);
      process.stderr.write(`deep hub: lock lost: ${this.root.lock} is no longer the file this hub holds locked\n`);
      void this.core.request({ op: 'lock-lost', path: this.root.lock }).catch(() => undefined);
    }, LOCK_CHECK_MS);
    checking.unref();
    mkdirSync(join(this.root.dir, 'tickers'), { recursive: true, mode: 0o700 });
    // The waits start where the last hub left them: how long each command took, and the turns and calls still running.
    await this.core.request({ op: 'waits' }).then((state) => {
      const { history, sessions } = state as { history: [string, number][]; sessions: Restored[] };
      for (const [key, ms] of history) this.waits.history.add(key, ms);
      this.waits.restore(sessions);
      this.arm();
    }).catch(() => undefined);
  }

  // ---- Long waits (#120): the lines at each hook, the in-call route, and the timer for what is due.

  /**
   * A heavy command (#1015), which deep-hook matched against the heavy.command@1 entries, runs under `deep lease`:
   * rewritten where the agent's adapter can rewrite a call, otherwise denied once with the leased command to run
   * instead, which deep-hook matches no more. A reply that already denies the call stands, and `deep off` leaves it.
   */
  private leased(meta: HookMeta, ruled: string): string {
    if (meta.event !== 'PreToolUse' || this.off) return ruled;
    const command = typeof meta.call?.input.command === 'string' ? meta.call.input.command : undefined;
    const rewrites = this.rewrites(meta.agent);
    // The planted wrong program for AC2 denies the leased form too, so the agent's retry is denied again.
    const retried = this.plant === 'denies-every-retry' && !rewrites && command !== undefined && /^\s*deep lease\b/.test(command);
    if ((!meta.heavy && !retried) || command === undefined || this.plant === 'runs-matched-as-written') return ruled;
    const reply = ruled === EMPTY_REPLY ? { exit: 0, stdout: '', stderr: '' } : JSON.parse(ruled) as { exit: number; stdout: string; stderr: string };
    if (reply.exit !== 0) return ruled;
    const form = retried ? command : meta.heavy!.form;
    if (!rewrites) {
      return line({ exit: 2, stdout: '', stderr: `${heavyDenial(command, form, meta.heavy?.name ?? 'deep lease')}\n` });
    }
    const out = reply.stdout ? JSON.parse(reply.stdout) as Record<string, unknown> : {};
    const specific = isObj(out.hookSpecificOutput) ? out.hookSpecificOutput : { hookEventName: 'PreToolUse' };
    specific.updatedInput = { ...meta.call!.input, ...(isObj(specific.updatedInput) ? specific.updatedInput : {}), command: form };
    out.hookSpecificOutput = specific;
    return line({ exit: 0, stdout: JSON.stringify(out), stderr: reply.stderr });
  }

  /** Whether an agent's adapter can rewrite a call's input, so a deadline can be attached to a command that never ends. */
  private rewrites(agent: string): boolean {
    try { return registry().get(agent === 'claude-code' ? 'claude' : agent).caps.rewrite; } catch { return false; }
  }
  /** Whether an agent's hooks include FileChanged, by its facts: the route a line takes while a call still runs. */
  private watches(agent: string): boolean {
    try {
      const facts = registry().get(agent === 'claude-code' ? 'claude' : agent).facts;
      const versions = isObj(facts) && isObj(facts.events) && isObj(facts.events.versions) ? facts.events.versions : {};
      return Object.values(versions).some((hooks) => isObj(hooks) && 'FileChanged' in hooks);
    } catch { return false; }
  }
  /** A session's ticker file: its change fires the session's FileChanged hook. */
  private ticker(session: string): string { return join(this.root.dir, 'tickers', session.replace(/[^0-9A-Za-z]/g, '')); }
  /** Whether a changed path is the session's ticker, by its name: the root may be reached by another path (a symlinked /tmp). */
  private isTicker(path: unknown, session: string): boolean {
    return typeof path === 'string' && basename(dirname(path)) === 'tickers' && basename(path) === basename(this.ticker(session));
  }
  /** What a hook shows the waits of its call: the tool.before or tool.after draft's kind, command and call. */
  private seen(meta: HookMeta, drafts: Draft[]): HookSeen {
    const seen: HookSeen = { event: meta.event, session: meta.session, agent: meta.agent, cwd: meta.cwd };
    if (meta.fields?.prompt !== undefined) seen.prompt = meta.fields.prompt;
    const draft = drafts.find((d) => d.kind === 'tool.before' || d.kind === 'tool.after');
    if (meta.call && draft) {
      seen.call = { id: String(draft.data.call ?? meta.toolUse ?? ''), kind: String(draft.data.kind ?? 'unknown'), tool: meta.call.tool, command: typeof draft.data.command === 'string' ? draft.data.command : null, input: meta.call.input, mode: meta.call.mode, ...(meta.event === 'PostToolUseFailure' ? { failed: true } : {}) };
    }
    return seen;
  }
  /** Arms the one timer for the earliest due wait; nothing due, no timer, so an idle hub costs nothing here. */
  private arm(): void {
    clearTimeout(this.waitTimer);
    this.waitTimer = undefined;
    const due = this.waits.nextDue();
    if (due === null || this.stopping) return;
    this.waitTimer = setTimeout(() => this.fire(), Math.max(0, due - this.now()));
    this.waitTimer.unref();
  }
  private overran(session: string, agent: string, cwd: string, call: OpenCall, ran: number): void {
    this.core.post({ op: 'overrun', session, agent, cwd, data: { call: call.call, kind: call.kind, command: call.command, expected_ms: call.expected, ran_ms: ran, deadline: call.deadline } });
  }
  private fire(): void {
    for (const due of this.waits.due(this.now())) {
      if (due.kind === 'overrun') this.overran(due.session, due.agent, due.cwd, due.call, due.ran);
      // The line is recorded by the hook that shows it: the FileChanged reply here, or the call's next hook.
      // The in-call route: the ticker's change fires the session's FileChanged hook, whose reply carries the line.
      if (this.watches(due.agent)) void writeFile(this.ticker(due.session), `${due.line}\n`, { mode: 0o600 }).catch(() => undefined);
    }
    this.arm();
  }

  private accept(sock: net.Socket, remote?: Conn['remote']): void {
    if (this.plant === 'accept-stops-at-emfile') {
      // The plant stops accepting the first time it finds no descriptor left.
      try {
        closeSync(openSync('/dev/null', 'r'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EMFILE') this.server.close();
      }
    }
    const conn = new Conn(++this.ids, sock);
    conn.remote = remote;
    this.conns.add(conn);
    sock.on('error', () => undefined);
    sock.on('close', () => {
      conn.done = true;
      this.conns.delete(conn);
      for (const sub of conn.subs) this.unsubscribe(conn, sub);
      if (conn.waiter) this.core.post({ op: 'waiter-gone', key: conn.id });
      for (const call of conn.calls) this.core.post({ op: 'call-gone', call, closed: true });
      if (conn === this.notifier) {
        this.notifier = undefined;
        this.core.post({ op: 'notifier-gone' });
      }
    });
    sock.on('data', (chunk: Buffer) => this.read(conn, chunk));
    sock.write(this.helloLine);
  }

  private unsubscribe(conn: Conn, sub: string): void {
    const s = this.subs.get(sub);
    if (s?.watch) clearInterval(s.watch);
    conn.subs.delete(sub);
    this.subs.delete(sub);
    this.core.post({ op: 'unsubscribe', sub });
  }
  /** Hands the socket one frame; the frames and bytes it takes let held ones through. */
  private send(sub: string, s: Sub, text: string): void {
    // Since the socket last took a frame, or since it was handed one with none waiting.
    if (s.queued++ === 0) s.since = Date.now();
    const size = Buffer.byteLength(text);
    s.bytes += size;
    s.conn.sock.write(text, () => {
      s.queued--;
      s.bytes -= size;
      s.since = Date.now();
      if (this.subs.get(sub) !== s) return;
      while (s.next < s.held.length && s.queued < BEHIND && s.bytes < BEHIND_BYTES) this.send(sub, s, s.held[s.next++]!);
      if (s.next === s.held.length && s.held.length) {
        s.held = [];
        s.next = 0;
        clearInterval(s.watch);
        s.watch = undefined;
      }
    });
  }
  /**
   * Cut off, never dropped silently: after the frames the socket holds, the consumer resumes from its last log_pos.
   * The refusal counts the frames and bytes the socket held for it (#1575).
   */
  private cut(sub: string, s: Sub): void {
    this.unsubscribe(s.conn, sub);
    s.held = [];
    s.conn.write({ id: s.id, error: refusal('fell_behind', '', `This consumer fell more than ${BEHIND} frames or ${BEHIND_BYTES >> 20} MiB behind; subscribe again after the last log_pos you hold.`, { frames: s.queued, bytes: s.bytes }) });
  }

  /** Frames lines: each newline ends one, however the bytes arrived. */
  private read(conn: Conn, chunk: Buffer): void {
    let from = 0;
    for (let nl = chunk.indexOf(10); nl >= 0; nl = chunk.indexOf(10, from)) {
      const parts = [...conn.pending, chunk.subarray(from, nl)];
      conn.pending = [];
      conn.size = 0;
      conn.queue = conn.queue.then(() => this.line(conn, parts)).catch((error: unknown) => {
        process.stderr.write(`deep hub: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      });
      from = nl + 1;
    }
    if (from < chunk.length) {
      conn.pending.push(chunk.subarray(from));
      conn.size += chunk.length - from;
      if (conn.size > MAX_LINE) {
        conn.write({ id: null, error: refusal('too_large', '', `Send lines under ${MAX_LINE} bytes.`) });
        conn.end();
        conn.pending = [];
      }
    }
  }

  private async line(conn: Conn, parts: Buffer[]): Promise<void> {
    if (conn.done && !conn.first) return;
    const first = conn.first;
    conn.first = false;
    const size = parts.reduce((sum, p) => sum + p.length, 0);
    // A small line is copied out of the socket's buffer, so only its own bytes cross to the parser.
    const chunks = size > BIG ? parts : [parts.length === 1 ? Buffer.from(parts[0]!) : Buffer.concat(parts)];
    const parsed = await this.parsers.parse(chunks, first);
    if (parsed.kind === 'hook' && this.plant === 'log-raw-command') {
      // The planted wrong program: the command as the hook sent it, unscrubbed, in the hub's log.
      try { process.stderr.write(`deep hub: call ${String((JSON.parse(Buffer.concat(chunks).toString('utf8')) as { payload?: { tool_input?: { command?: unknown } } }).payload?.tool_input?.command)}\n`); } catch { /* not JSON */ }
    }
    if (parsed.kind === 'hook' && conn.spool) {
      // Stamped with the connection's person, as a live hook is, and recorded once whichever copy arrives first.
      if (conn.person) parsed.meta.person = conn.person;
      this.core.post({ op: 'replayed', drafts: parsed.drafts, meta: parsed.meta });
      conn.first = true;
      return conn.write({ ack: parsed.meta.id });
    }
    if (parsed.kind === 'hook' && conn.remote && conn.person === undefined) {
      conn.write({ id: null, error: refusal('credential', '/hello', 'Say hello first, with a credential this hub issued, from the machine holding its key.') });
      return conn.end();
    }
    if (parsed.kind === 'hook') return parsed.meta.agent === 'paseo' ? this.paseoHook(conn, parsed) : this.hook(conn, parsed);
    if (parsed.kind === 'refused') {
      conn.write({ id: parsed.id, error: parsed.error });
      if (first) conn.end();
      return;
    }
    if (conn.done) return;
    const value = parsed.value;
    // A browser Origin means a web page: refused, whatever credential the line carries, so no page can reach the hub.
    if ('origin' in value || 'Origin' in value) {
      conn.write({ id: value.id ?? null, error: refusal('credential', '/origin', 'The hub serves no web page: connect from the app or the CLI, without a browser Origin.', value.origin ?? value.Origin) });
      return conn.end();
    }
    if (first && 'hello' in value) return conn.remote ? this.remoteHello(conn, value) : this.hello(conn, value);
    // Over the network, nothing is served before a credential's hello (#1338).
    if (conn.remote && (first || !conn.role)) {
      conn.write({ id: value.id ?? null, error: refusal('credential', '/hello', 'Say hello first, with a credential this hub issued, from the machine holding its key.') });
      return conn.end();
    }
    // A first line with no credential makes the connection a hook connection, which may call no method.
    if (first) {
      conn.role = 'hook';
      conn.name = 'hook';
    }
    return this.method(conn, value);
  }

  /**
   * A line from paseo's plugin (#55). A session deep-hook or the pi package bound first is theirs: the line is only
   * relayed, recorded nowhere, and its reply names the owner, so the plugin raises, answers and sends nothing for it.
   * An answer someone gave in paseo's own app is no answer to DeepBuild's ask. Anything else is a hook as any other.
   */
  private async paseoHook(conn: Conn, parsed: Extract<Parsed, { kind: 'hook' }>): Promise<void> {
    const meta = parsed.meta;
    const owner = (await this.core.request({ op: 'paseo-owner', meta }).catch(() => null)) as string | null;
    const reply = (value: Obj) => {
      conn.role = 'hook';
      conn.name = 'hook';
      conn.done = true;
      if (conn.sock.writable) conn.sock.end(line({ ack: meta.id, hold_until_ms: null }) + line({ exit: 0, stdout: JSON.stringify(value), stderr: '' }));
    };
    if (owner) {
      this.inPaseo.add(meta.session);
      return reply({ owner });
    }
    if (meta.event === 'agent.permission.after') return reply((await this.core.request({ op: 'paseo-app-answer', meta }).catch(() => ({}))) as Obj);
    this.hook(conn, parsed);
  }
  /** The sessions paseo runs that another adapter gates: a permission prompt there shows in paseo, not in a terminal (#55). */
  private inPaseo = new Set<string>();

  private hook(conn: Conn, parsed: Extract<Parsed, { kind: 'hook' }>): void {
    conn.role = 'hook';
    conn.name = 'hook';
    if (this.plant === 'git-in-hook-handler') {
      try { execFileSync('git', ['rev-parse', '--show-toplevel'], { stdio: 'ignore' }); } catch { /* the plant only needs the call */ }
    }
    // A deep-hook gone before its acknowledgement spooled the request marked late: that copy is the one recorded.
    if (conn.done || !conn.sock.writable) return;
    conn.done = true;
    // With its lock lost the hub acknowledges nothing: closed with no ack, deep-hook fails open and spools the hook.
    if (this.lost) return void conn.sock.end();
    // A tool.before some extension handles, and no guard entry blocks, is held for their joined reply (#350); a
    // session's start, a prompt and a stop the hub can hold are held for the core's (#18); every other hook gets
    // the acknowledgement and the reply in one write, which also ends the connection.
    const meta = parsed.meta;
    // The person is the connection's, never the payload's, but for the planted wrong program (#1337).
    const person = this.plant === 'actor-from-payload' && meta.payloadActor ? meta.payloadActor : conn.person;
    if (person) meta.person = person;
    else delete meta.person;
    if (this.cantRun.has(meta.agent)) Object.assign(meta, { watchOnly: true, cantRun: true });
    // The planted wrong program consults your standing rules before the guards: their blocks wait for the gate.
    let ruled = this.plant === 'decision-before-guard' && this.gated(meta, parsed.drafts)?.decided ? EMPTY_REPLY : this.reply(meta);
    // A rule you scoped to paths, at the session's first call inside its scope (#344): its words ride this reply.
    const notice = meta.watchOnly ? undefined : this.rulesAt(meta, parsed.scoped, ruled);
    if (notice) ruled = withWaits(ruled, meta.event, { context: notice });
    // The long waits (#120): each hook shows the waits its call's start or end, and takes the lines waiting for it.
    if (!meta.watchOnly) {
      const now = this.now();
      const wait = meta.event === 'FileChanged'
        ? (this.isTicker(meta.fields?.file_path, meta.session) ? this.waits.fileChanged(meta.session, now) : {})
        : this.waits.hook(this.seen(meta, parsed.drafts), now);
      if (meta.event === 'SessionEnd') rmSync(this.ticker(meta.session), { force: true });
      // An agent whose hooks take no context hears the words at its next prompt instead.
      if (wait.context && meta.agent !== 'claude-code' && meta.agent !== 'claude') {
        this.core.post({ op: 'later', session: meta.session, cwd: meta.cwd, text: wait.context });
        delete wait.context;
      }
      if (wait.overran) this.overran(meta.session, meta.agent, meta.cwd, wait.overran.call, wait.overran.ran);
      // A line the chat shows is kept as the session's reading: the next ten minutes count from it, restarts included.
      if (wait.message) this.core.post({ op: 'line', session: meta.session, agent: meta.agent, text: wait.message });
      ruled = withWaits(ruled, meta.event, wait);
      this.arm();
      ruled = this.leased(meta, ruled);
    }
    // A call that may need your authority, or that a standing rule decides, and no guard entry blocks, is held for
    // the core's gate first (#321, #23); a warn entry's words go out with the gate's reply.
    const blocked = meta.denied !== undefined || (ruled !== EMPTY_REPLY && (JSON.parse(ruled) as { exit: number }).exit !== 0);
    // A call blocked before it ran gets no PostToolUse: it is no wait.
    if (blocked) this.waits.drop(meta.session, meta.toolUse);
    const gated = blocked ? undefined : this.gated(meta, parsed.drafts);
    // A permission prompt is held while the core reads whether a saved decision covers it (#23).
    const prompted = ruled === EMPTY_REPLY && this.prompted(meta);
    const before = !blocked && !this.off && this.hooks.has('tool.before') ? parsed.drafts.find((d) => d.kind === 'tool.before') : undefined;
    // A tool call this hub saw run marks its session as having worked, so the stop that follows at once is held for
    // its line whether or not the core's word of the turn has come back yet (#83).
    if (parsed.drafts.some((d) => d.kind === 'tool.after')) this.sawWork.add(meta.session);
    // A blocked call's reply is its block: no acknowledgement takes its place, and the next call carries the acknowledgement.
    const held = !blocked && !before && !gated && !prompted && parsed.drafts.length ? this.holdFor(meta) : null;
    if (meta.event === 'Stop' || meta.event === 'SessionEnd') this.sawWork.delete(meta.session);
    // A resumed session's calls go to the gate until the core says whether its cut-off turn left a send to match (#85, #1033).
    if (meta.event === 'SessionStart' && meta.fields?.source === 'resume') this.resend.add(meta.session);
    const hold = prompted ? Date.now() + this.permissionHold(meta) : gated ? Date.now() + (gated.stage !== undefined ? STAGE_HOLD_MS : GATE_HOLD_MS) + (before ? EXTENSION_HOLD_MS : 0) : before ? Date.now() + EXTENSION_HOLD_MS : held;
    if (hold === null) conn.sock.end(line({ ack: meta.id, hold_until_ms: null }) + ruled);
    else conn.sock.write(line({ ack: meta.id, hold_until_ms: hold }));
    // The writer is the connection's, whatever the payload says. Posted in the same step as the reply, before any
    // other line is read, so a deep_* call that follows this hook finds its stamp.
    const writer = this.plant === 'writer-from-payload' && meta.payloadWriter ? meta.payloadWriter : 'hook';
    this.core.post({ op: 'hook', drafts: parsed.drafts, meta, writer });
    if (prompted) void this.permissionReply(conn, meta, hold!);
    else if (gated) void this.gateReply(conn, meta, gated, hold!, before?.data, ruled);
    else if (before) void this.extensionReply(conn, meta, before.data, hold!, ruled);
    else if (held !== null) void this.coreReply(conn, meta, held);
  }

  /**
   * What a PreToolUse's call does that may need your authority, by the guard engine's classes: the effect classes of
   * the `effect:` entries deep-hook matched and of the facts' MCP tool, and the MCP tool itself, whose server may have
   * changed it. Our own deep tools, watch-only sessions and `deep off` hold nothing.
   */
  private gated(meta: HookMeta, drafts: Draft[]): Gated | undefined {
    if (meta.event !== 'PreToolUse' || meta.watchOnly || this.off || meta.stamp) return undefined;
    const data = drafts.find((d) => d.kind === 'tool.before')?.data;
    if (!data) return undefined;
    const entries = this.rules();
    const classes = meta.matched.flatMap((n) => /^effect:([\w-]+)$/.exec(String(entries[n]?.match ?? ''))?.slice(1) ?? []);
    if (typeof data.effect === 'string') classes.push(data.effect);
    const authority = [...new Set(classes.filter((c) => AUTHORITY.has(c)))];
    const named = this.namedDefaults(meta, data, entries);
    const decided = [...new Set(meta.matched.filter((n) => DECIDED_MATCH.test(String(entries[n]?.match ?? ''))).map((n) => String(entries[n]!.match).slice('effect:'.length)))];
    const mcp = data.kind === 'mcp' && typeof data.server === 'string' && typeof data.tool === 'string' ? { server: data.server, tool: data.tool } : undefined;
    // A destructive call is staged first (#347, #1294): what deep-hook read of its reach, or null when it couldn't
    // name it. The planted stager stages the working folder of every shell call.
    const reach = (match: string) => {
      const n = meta.matched.find((m) => entries[m]?.match === match);
      return n === undefined ? undefined : meta.stage?.[n] ?? null;
    };
    const [folders, past, edits, stash] = [reach(STAGED_MATCH), reach(PAST_MATCH), this.plant === 'stages-untracked-only' ? undefined : reach(DISCARD_MATCH), reach(STASH_MATCH)];
    const stage: StageReach | undefined = folders !== undefined || past !== undefined || edits !== undefined || stash !== undefined
      ? { ...(folders !== undefined ? { folders } : {}), ...(past !== undefined ? { past } : {}), ...(edits !== undefined ? { edits } : {}), ...(stash !== undefined ? { stash } : {}) }
      : this.plant === 'stages-unpredicted-writes' && data.kind === 'shell' && typeof data.command === 'string' ? { folders: [meta.cwd] } : undefined;
    // A computer-use or Chrome step is checked against the screens and windows its session leases (#332).
    const screen = SCREEN_TOOLS.some((prefix) => meta.call?.tool.startsWith(prefix));
    // A shell or MCP call in a session whose cut-off turn started a send with no recorded end is checked against it (#85).
    const resend = this.resend.has(meta.session) && (data.kind === 'shell' || data.kind === 'mcp');
    // A `gh pr create`, or a `gh pr edit` of its body (#87), is checked for its body's Closes against the issue's task
    // (#322), whatever else it needs.
    const pr = data.kind === 'shell' && typeof data.command === 'string' && (isPrCreate(data.command) || isPrEdit(data.command));
    const card = this.cardOf(meta);
    if (!authority.length && !mcp && !decided.length && stage === undefined && !screen && !resend && !pr && !named.length && !card) return undefined;
    const label = mcp ? `${mcp.server} ${mcp.tool}` : screen ? meta.call!.tool : typeof data.command === 'string' ? data.command : String(data.kind);
    const command = typeof data.command === 'string' ? { command: data.command } : {};
    return {
      label, classes: authority, ...(card ? { card } : {}), ...(named.length ? { named, merge: mergeNamed(meta, data) } : {}), ...(mcp ? { mcp } : {}), ...(decided.length ? { decided, ...command } : {}), ...(stage !== undefined ? { stage, ...command } : {}), ...(screen ? { screen } : {}), ...(resend ? { resend } : {}), ...(pr ? { pr, ...command } : {}),
    };
  }
  /** A question card's questions (#84): a tool the agent's facts name as a question to the person. */
  private cardOf(meta: HookMeta): Obj[] | undefined {
    if (!meta.call) return undefined;
    const facts = registry().get(meta.agent === 'codex' ? 'codex' : 'claude').facts as Obj;
    const tools = (facts.questionTools as { tools?: string[] } | undefined)?.tools ?? [];
    const questions = meta.call.input.questions;
    return tools.includes(meta.call.tool) && Array.isArray(questions) ? questions as Obj[] : undefined;
  }
  /**
   * The push, PR and merge defaults a call meets (#84), by the entries deep-hook matched and the facts' effect of an
   * MCP tool: the core reads each against the thread's prompts. Only an entry rules.json holds in block mode counts.
   */
  private namedDefaults(meta: HookMeta, data: Obj, entries: Record<string, Guard | undefined>): NonNullable<Gated['named']> {
    const blocks = (rule: string) => entries[rule]?.mode === 'block';
    let matched = meta.matched;
    // The planted wrong program ignores what deep-hook matched and reads the command line as plain text.
    if (this.plant === 'defaults-match-text') {
      const words: [string, string[]][] = [['git push', ['push-needs-ask']], ['gh pr create', ['pr-needs-ask']], ['gh pr merge', ['merge-needs-ask', 'merge-names-head']]];
      matched = words.filter(([w]) => String(data.command ?? '').includes(w)).flatMap(([, rules]) => rules);
    }
    // The planted wrong program for #1523 holds every call to the programs the new forms run, as a push.
    if (this.plant === 'holds-every-program' && /^\s*(?:jj|gt|sl|glab|git[\s-]town|gh\s+api)\b/.test(String(data.command ?? ''))) matched = [...matched, 'push-needs-ask'];
    const shell = Object.entries(NAMED_RULES).flatMap(([rule, effect]) => (matched.includes(rule) ? [{ rule, effect }] : []));
    const tool = Object.entries(NAMED_RULES).flatMap(([rule, effect]) => (effect === data.effect ? [{ rule, effect }] : []));
    return [...shell, ...tool.filter((t) => !shell.some((s) => s.rule === t.rule))].filter((n) => blocks(n.rule));
  }
  /** Whether a hook is a permission prompt the hub holds for its ask: Claude Code's, in a session its facts cover, gates on. */
  private prompted(meta: HookMeta): boolean {
    return meta.event === 'PermissionRequest' && (meta.agent === 'claude-code' || meta.agent === 'claude' || meta.agent === 'codex' || meta.agent === 'paseo') && !meta.watchOnly && !this.off && meta.call !== undefined;
  }
  /**
   * How long a permission prompt is held: one paseo's plugin gates waits for your answer, since paseo doesn't wait on
   * it; one inside paseo that deep-hook gates waits for its ask's answer up to 5 s before its entry's timeout (#55).
   */
  private permissionHold(meta: HookMeta): number {
    if (meta.agent === 'paseo') return PASEO_PERMISSION_HOLD_MS;
    return this.inPaseo.has(meta.session) ? PERMISSION_TIMEOUT_MS - HOLD_MARGIN_MS : GATE_HOLD_MS;
  }
  /**
   * The prompt's reply, written by its hold: the adapter's reply to the answer a saved decision gave; with none, no
   * decision at all, so the agent's own prompt asks you (#18).
   */
  private async permissionReply(conn: Conn, meta: HookMeta, hold: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<{ decision: 'none'; because?: string }>((resolve) => { timer = setTimeout(() => resolve({ decision: 'none' }), Math.max(0, hold - Date.now() - HOLD_MARGIN)); });
    const asked = this.core.request({ op: 'permission', meta, until: hold - HOLD_MARGIN, inPaseo: this.inPaseo.has(meta.session) }).catch(() => ({ decision: 'none' as const })) as Promise<{ decision: 'allow' | 'deny' | 'none'; because?: string }>;
    const { decision, because } = await Promise.race([asked, late]).finally(() => clearTimeout(timer));
    await this.lateReply(hold);
    if (!conn.sock.writable) return;
    if (decision === 'none') return void conn.sock.end(EMPTY_REPLY);
    // paseo's plugin answers the request in paseo with the hub's decision, and says when a saved one gave it.
    if (meta.agent === 'paseo') return void conn.sock.end(line({ exit: 0, stdout: JSON.stringify({ decision, ...(because ? { because } : {}), ...(decision === 'deny' ? { message: `DeepBuild denied this${because ? ` by your saved decision ${because}` : ''}.` } : {}) }), stderr: '' }));
    if (decision === 'deny') this.waits.drop(meta.session, meta.toolUse);
    const request = { payload: { permission_suggestions: meta.call?.suggestions ?? [] } } as unknown as HookRequestLine;
    // A Codex deny carries its reason, or Codex treats the reply as a failed hook.
    const words = meta.agent === 'codex' && decision === 'deny' ? `DeepBuild denied this by your saved decision ${because ?? ''}`.trim() : null;
    const reply = registry().get(meta.agent === 'codex' ? 'codex' : 'claude').permissionReply!({ ask: '', session: meta.session, option: null, label: null, decision, for: 'call', words, provisional: false, undoes: null }, request) as Obj;
    // The planted wrong program picks the agent's own "always allow", writing a lasting rule into its settings.
    if (this.plant === 'permission-always-allow' && decision === 'allow' && isObj(reply.hookSpecificOutput) && isObj(reply.hookSpecificOutput.decision)) {
      reply.hookSpecificOutput.decision.updatedPermissions = meta.call?.suggestions ?? [];
    }
    conn.sock.end(line({ exit: 0, stdout: JSON.stringify(reply), stderr: '' }));
  }
  /**
   * The gate's reply, written by its hold: a held call is denied with its ask; one the gate didn't decide in time too.
   * A call it lets go gets `ruled`, the guard entries' reply.
   */
  private async gateReply(conn: Conn, meta: HookMeta, call: Gated, hold: number, before: unknown, ruled: string): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<{ late: true }>((resolve) => { timer = setTimeout(() => resolve({ late: true }), Math.max(0, hold - Date.now() - HOLD_MARGIN - (before === undefined ? 0 : EXTENSION_HOLD_MS))); });
    const asked = this.core.request({ op: 'tool-gate', meta, call }).catch((error: unknown) => ({ failed: error instanceof Error ? error.message : String(error) })) as Promise<{ held?: string; allow?: string; deny?: string; answers?: Record<string, string>; rule?: string; failed?: string }>;
    const gate = await Promise.race([asked, late]).finally(() => clearTimeout(timer));
    await this.lateReply(hold);
    if (!conn.sock.writable) return;
    const why = 'late' in gate ? `DeepBuild held this: it couldn't check whether \`${call.label}\` needs your authority in time. Run it again.`
      : gate.failed !== undefined ? `DeepBuild held this: checking whether \`${call.label}\` needs your authority failed (${gate.failed}). Run it again.` : gate.held ?? gate.deny;
    if (why) {
      this.waits.drop(meta.session, meta.toolUse);
      // The deny that reached the agent, late and failed checks included, is kept for a PostToolUse that shows it ran anyway (#1033).
      if (meta.toolUse) this.core.post({ op: 'denied', session: meta.session, call: meta.toolUse, guard: 'rule' in gate && gate.rule ? gate.rule : "the gate's authority hold (#321)", label: call.label });
      return void conn.sock.end(line({ exit: 2, stdout: '', stderr: `${why}\n` }));
    }
    // A saved decision answers the card: the call runs with its questions and the decided options, never blocked (#84).
    if (!('late' in gate) && gate.answers) {
      const output = { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'DeepBuild answered this from your saved decision.', updatedInput: { questions: meta.call?.input.questions, answers: gate.answers } };
      return void conn.sock.end(line({ exit: 0, stdout: JSON.stringify({ hookSpecificOutput: output }), stderr: '' }));
    }
    if (before !== undefined) return this.extensionReply(conn, meta, before, hold, ruled);
    // Your standing rule's yes, and why: Claude Code's explicit allow, never past a permission mode that denies the call;
    // a warn entry's words go with it.
    const allow = 'late' in gate ? undefined : gate.allow;
    if (allow !== undefined && (meta.agent === 'claude-code' || meta.agent === 'claude')) {
      const past = !DENYING_MODES.has(meta.call?.mode ?? '') || this.plant === 'decision-over-mode';
      const additionalContext = [...warnings(ruled), allow].join('\n');
      const output = { hookEventName: 'PreToolUse', ...(past ? { permissionDecision: 'allow', permissionDecisionReason: allow } : {}), additionalContext };
      return void conn.sock.end(line({ exit: 0, stdout: JSON.stringify({ hookSpecificOutput: output }), stderr: '' }));
    }
    conn.sock.end(ruled);
  }

  /** The scoped rules each session heard since its start, compaction or resume, by rule ID (#344). */
  private rulesHeard = new Map<string, Set<string>>();
  /**
   * Your rules at a hook, said here so no call waits on the core (#344): a session's start, compaction or resume lets
   * each scoped rule be heard once more; a PreToolUse inside a rule's scope carries it once, and an Edit or Write of a
   * rule file has the file's rules read before it runs. The parser read both (`scoped`); they go to the core on the
   * hook's meta, to record.
   */
  private rulesAt(meta: HookMeta, scoped: Scoped | undefined, ruled: string): string | undefined {
    if (!meta.session || !['claude-code', 'claude', 'codex'].includes(meta.agent)) return undefined;
    if (meta.event === 'SessionStart' || meta.event === 'SessionEnd') { this.rulesHeard.delete(meta.session); return undefined; }
    if (!scoped) return undefined;
    // A call blocked before it runs hears nothing.
    const blocked = ruled !== EMPTY_REPLY && (JSON.parse(ruled) as { exit: number }).exit !== 0;
    const heard = this.rulesHeard.get(meta.session) ?? new Set<string>();
    this.rulesHeard.set(meta.session, heard);
    const notices = blocked ? [] : scoped.rules.filter((r) => !heard.has(r.id));
    for (const r of notices) heard.add(r.id);
    if (notices.length || scoped.before.length) meta.rules = { notices: notices.map(ruleHandle), ...(scoped.before.length ? { before: scoped.before } : {}) };
    return notices.length ? noticeText(notices) : undefined;
  }

  /**
   * The hold the hub takes on a hook it answers from the core, or null: a session's start and a prompt for their
   * context; a stop while the stop-hold relation holds, ending at least 5 s before the Stop entry's timeout. A
   * session past its facts, or a broken relation, is watch-only: its stop is let through at once.
   */
  private holdFor(meta: HookMeta): number | null {
    const now = Date.now();
    // pi takes no context from a hook: what waits for it comes through the package's own wait (#40).
    if (meta.agent === 'pi' && (meta.event === 'SessionStart' || meta.event === 'UserPromptSubmit')) return null;
    if (meta.event === 'SessionStart' || meta.event === 'UserPromptSubmit') return now + CONTEXT_HOLD_MS;
    // A message typed while the agent works is acknowledged at the session's next tool call, the queue beside it (#340).
    if ((meta.event === 'PreToolUse' || meta.event === 'PostToolUse') && this.acking.delete(meta.session)) return now + CONTEXT_HOLD_MS;
    if (meta.event !== 'Stop') return null;
    // A stop of a session paseo's plugin gates is held for its line and a send-back; paseo doesn't wait on it (#55).
    if (meta.agent === 'paseo') return !meta.watchOnly && !this.off ? now + STOP_HOLD_MS : null;
    // A pi stop that did work is held for its line and a send-back; an open ask never holds it, since pi takes the answer as a turn of its own (#40).
    if (meta.agent === 'pi') return !meta.watchOnly && !this.off && (this.worked.has(meta.session) || this.sawWork.has(meta.session)) ? now + STOP_HOLD_MS : null;
    // A Codex stop that did work is held for its line (#83): the core reads it from the record at once.
    // Its hold can run up to 5 s before the Stop entry's timeout, for a slow check that ends by then (#39); the core ends it early otherwise.
    if (meta.agent === 'codex') {
      if (meta.watchOnly || this.off || !(this.worked.has(meta.session) || this.sawWork.has(meta.session) || this.asking.has(meta.session))) return null;
      const timeoutS = stopTimeoutS(this.root.dir);
      return now + (timeoutS === undefined ? STOP_HOLD_MS : timeoutS * 1000 - HOLD_MARGIN_MS);
    }
    const relation = this.stopHold();
    if (this.plant === 'holds-stop-anyway') return now + STOP_HOLD_MS;
    if (meta.watchOnly || !relation.holds || this.off) return null;
    // Until you approve a repo's checks no verdict holds a stop: only an answer on its way back does (design: How it
    // installs), and a stop whose turn did work is held for the one line the chat shows of it (#83), which the core
    // reads from the record at once. The planted wrong program holds every stop, as gates on unapproved checks would.
    // A test's planted sorter (#321) may answer any stop "proceed".
    if (this.plant !== 'gates-before-approval' && !this.asking.has(meta.session) && !this.worked.has(meta.session) && !this.sawWork.has(meta.session) && !process.env.DEEP_HUB_TEST_SORTER) return null;
    return now + Math.min(STOP_HOLD, relation.timeoutS * 1000 - HOLD_MARGIN_MS);
  }
  /** The sessions whose next stop the stop rule would read as a claim, as the core tells it beside `asking`: it is held for its line (#83). */
  private worked = new Set<string>();
  /** The sessions a tool call of which this hub saw run since their last stop; the core's word may still be on its way. */
  private sawWork = new Set<string>();
  private settingsSeen = { key: '', relation: { name: 'stop hold', holds: true, timeoutS: 600, text: '' } as Relation };
  /** The stop-hold relation our Stop entry keeps, read again only when Claude Code's settings or our record change. */
  private stopHold(): Relation {
    const files = [claudeSettings(), join(this.root.dir, 'claude-hooks.json')];
    const key = files.map(fileKey).join('|');
    if (key !== this.settingsSeen.key) {
      const relation = relations(this.root.dir, readJson(files[0]!)).find((r) => r.name === 'stop hold');
      this.settingsSeen = { key, relation: relation ?? { name: 'stop hold', holds: true, timeoutS: 600, text: '' } };
    }
    return this.settingsSeen.relation;
  }
  /**
   * The planted delay (#906), which only tests set: while DEEP_HUB_TEST_LATE_REPLY's file exists, a held hook's reply,
   * once in hand, is written no sooner than 1 s past its hold, when deep-hook has given up on it.
   */
  private async lateReply(hold: number): Promise<void> {
    const file = process.env.DEEP_HUB_TEST_LATE_REPLY;
    if (!file || !existsSync(file)) return;
    await new Promise((done) => setTimeout(done, Math.max(0, hold + 1000 - Date.now())));
  }
  /** The core's reply to a held hook, written by its hold; one that isn't in by then is the hook's fail-open one. */
  private async coreReply(conn: Conn, meta: HookMeta, hold: number): Promise<void> {
    // A deep-hook that gave up on the hub before reading its reply has let the hook through: nothing is held for it (#27).
    let replied = false;
    conn.sock.once('close', () => { if (!replied) this.core.post({ op: 'hook-gone', id: meta.id, session: meta.session }); });
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), Math.max(0, hold - Date.now() - HOLD_MARGIN)); });
    const asked = this.core.request({ op: 'hook-reply', meta, until: hold - HOLD_MARGIN * 5 }).catch(() => null) as Promise<{ context?: string; block?: string; message?: string } | null>;
    const reply = await Promise.race([asked, late]).finally(() => clearTimeout(timer));
    await this.lateReply(hold);
    if (!conn.sock.writable) return;
    replied = true;
    // A core reply past the hold isn't written: an answer it handed the agent reads stalled and goes by the next route (#906).
    if (!reply) this.core.post({ op: 'hook-gone', id: meta.id, session: meta.session });
    // With DeepBuild off every gate is watch-only: a status answer shows beside the prompt, never in its place.
    const shown = reply && this.off && meta.event === 'UserPromptSubmit' && reply.block ? { ...(reply.context ? { context: reply.context } : {}), message: reply.block } : reply;
    const watch = meta.event === 'SessionStart' && !meta.watchOnly && meta.session && this.watches(meta.agent) ? [this.ticker(meta.session)] : undefined;
    conn.sock.end(shown || watch ? coreReplyLine(meta.agent, meta.event, shown ?? {}, watch) : EMPTY_REPLY);
  }

  /**
   * The extensions' reply, written by the hold deep-hook was given: one that isn't in by then, a core that can't
   * answer, or watch-only gates give the reply a hub with no extension gives, the hook's fail-open policy.
   */
  private async extensionReply(conn: Conn, meta: HookMeta, data: unknown, hold: number, ruled: string): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), Math.max(0, hold - Date.now() - HOLD_MARGIN)); });
    const asked = this.core.request({ op: 'extension-hook', data }).catch(() => null) as Promise<ExtensionReply | null>;
    const reply = await Promise.race([asked, late]).finally(() => clearTimeout(timer));
    await this.lateReply(hold);
    // Past the agent's cap, the core keeps what doesn't fit and names where to continue (#1296).
    const fitted = reply?.context.length && !reply.denies.length ? ((await this.core.request({ op: 'context-fit', meta, parts: contextParts(reply, ruled), join: '\n' }).catch(() => undefined)) as string | undefined) : undefined;
    if (conn.sock.writable) conn.sock.end(reply ? agentReply(meta.agent, reply, ruled, fitted) : ruled);
  }

  /**
   * The reply to a hook: deep-hook matched the call against every entry in rules.json, and the hub decides what
   * each matched entry does by its mode (#304), never reading its `match`. A matched entry in block mode denies a
   * tool call before it runs, with its reason and next step; one in warn mode lets it through and tells the agent
   * why; one in watch mode is only recorded, in the call's tool.before.
   */
  private reply(meta: HookMeta): string {
    // The planted wrong program answers a permission prompt itself, where the watch-only adapter only records it.
    if (this.plant === 'adapter-decides' && meta.event === 'PermissionRequest') {
      return line({ exit: 0, stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } }), stderr: '' });
    }
    // A patch the adapter can't read is Codex's deny, with its reason and nothing else.
    if (meta.denied && !this.off) return line({ exit: 0, stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: meta.denied } }), stderr: '' });
    if (meta.event !== 'PreToolUse' || (!meta.matched.length && this.plant !== 'matches-text')) return EMPTY_REPLY;
    // A watch-only session (one past its facts, #1501) gets the reply every session gets under `deep off`: a matched
    // entry is recorded, never a block, but the floor's, which deep-hook applies with no facts and no hub at all.
    const watching = this.off || meta.watchOnly === true;
    const entries = this.rules();
    // The planted wrong program for #304's AC3 ignores what deep-hook matched and reads the command line as text.
    const matched = this.plant === 'matches-text'
      ? Object.keys(entries).filter((n) => { const m = String(entries[n]?.match ?? ''); return m.startsWith('run:') && (meta.command ?? '').includes(m.slice(4)); })
      : meta.matched.filter((n) => reaches(n, entries[n]?.scope, repoOf(meta.cwd), meta.session));
    // The planted wrong program for #1097's AC3 blocks a warn entry the call met only through what couldn't be read.
    const unread = (n: string) => this.plant === 'unknown-as-block' && /couldn't be read/.test(meta.notes?.[n] ?? '');
    const mode = (n: string): unknown => ((this.plant === 'warn-as-block' || unread(n)) && entries[n]?.mode === 'warn' ? 'block' : entries[n]?.mode);
    const words = (n: string): string => `${String(entries[n]!.reason)} ${String(entries[n]!.next_step)}${meta.notes?.[n] ? ` ${meta.notes[n]}` : ''} (guard ${n})`;
    // Watch-only or off, only the floor still denies, the fail_closed entries, which hold with the hub away too; no warns.
    const floor = (n: string) => entries[n]?.fail_closed === true && this.plant !== 'off-guards-watch-only';
    // With the hub up, a dependency or a cloud resource the plan doesn't name is a decision: answered by your
    // standing rule or asked at the gate (#23), after every other guard.
    // A destructive command is staged or asked about at the gate (#347, #1294, #1507), never blocked outright.
    const decided = (n: string) => !watching && (n in NAMED_RULES || DECIDED_MATCH.test(String(entries[n]?.match ?? '')) || (STAGED_MATCHES.includes(entries[n]?.match) && !meta.stamp));
    const blocks = matched.filter((n) => mode(n) === 'block' && !decided(n) && (!watching || floor(n)));
    if (blocks.length) {
      meta.blockedBy = blocks;
      return line({ exit: 2, stdout: '', stderr: blocks.map((n) => `DeepBuild blocked this: ${words(n)}\n`).join('') });
    }
    if (watching) return EMPTY_REPLY;
    const warns = matched.filter((n) => mode(n) === 'warn');
    if (!warns.length || (meta.agent !== 'claude-code' && meta.agent !== 'claude')) return EMPTY_REPLY;
    const additionalContext = warns.map((n) => `DeepBuild warns: ${words(n)}`).join('\n');
    return line({ exit: 0, stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext } }), stderr: '' });
  }

  private rulesSeen = { key: '', entries: {} as Record<string, Guard | undefined> };
  /** The entries of rules.json, read again only when the file changes. */
  private rules(): Record<string, Guard | undefined> {
    const file = join(this.root.dir, 'rules.json');
    // No rules.json: no entries.
    const key = fileKey(file);
    if (key !== this.rulesSeen.key) {
      let entries: Record<string, Guard | undefined> = {};
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as { entries?: unknown };
        if (typeof parsed.entries === 'object' && parsed.entries !== null) entries = parsed.entries as Record<string, Guard | undefined>;
      } catch { /* unreadable: deep-hook names it; the hub decides nothing from it */ }
      this.rulesSeen = { key, entries };
    }
    return this.rulesSeen.entries;
  }

  /**
   * Opens the network listener while a project here has a member, an invited person included, and closes it once none
   * is left (#1338): `hub.listen` in this hub's config.json, `<host>:<port>`, else every interface's port 7433. TLS 1.3
   * only, with this hub's own certificate, and each client's certificate asked for, so its key is proved.
   */
  private async syncNetwork(): Promise<void> {
    const want = this.people.any || this.plant === 'listen-without-members';
    if (!want) {
      if (this.network) {
        this.network.close();
        for (const c of this.conns) if (c.remote) c.sock.destroy();
        this.network = undefined;
      }
      return;
    }
    if (this.network) return;
    const at = listenAt(this.root.dir);
    const server = tls.createServer({ key: this.identity.key, cert: this.identity.cert, requestCert: true, rejectUnauthorized: false, minVersion: 'TLSv1.3' }, (sock) => {
      const cert = sock.getPeerX509Certificate();
      this.accept(sock, { key: cert ? idOf(cert) : undefined });
    });
    server.on('tlsClientError', () => undefined);
    server.on('error', (error) => process.stderr.write(`deep hub: the network listener: ${error.message}\n`));
    this.network = server;
    await new Promise<void>((resolve) => server.listen(at.port, at.host, () => resolve()).once('error', () => resolve()));
  }

  /**
   * A hello over the network (#1338): an invite spent by the machine that proves its key, or a person's credential,
   * bound to the key this connection's TLS handshake proved. The control token never counts here: it stays on the
   * hub's own machine, as the app and the CLI there hold it.
   */
  private async remoteHello(conn: Conn, value: Obj): Promise<void> {
    const key = conn.remote!.key;
    const refuse = (path: string, why: string) => {
      conn.write({ id: null, error: refusal('credential', path, why) });
      conn.end();
    };
    if (value.v !== 1) {
      conn.write({ id: null, error: versionRefusal(value) });
      return conn.end();
    }
    if (value.hello === 'join') {
      if (!key) return refuse('/proof', 'Join from a machine that proves a key of its own in the TLS handshake: the credential is bound to it.');
      const joined = (await this.core.request({ op: 'call', method: 'person.join', params: { invite: value.invite, key }, context: { role: 'network' } }).catch(() => null)) as Obj | null;
      if (!joined) return refuse('/invite', 'This invite is spent, lapsed or not one this hub issued: ask someone on the project for a new one.');
      this.people.load();
      conn.write({ joined: { ...joined, hub: this.identity.id } });
      return conn.end();
    }
    if (value.hello !== 'hook' && value.hello !== 'cli' && value.hello !== 'spool') return refuse('/hello', 'Over the network a hub takes a person\'s hooks, the ones spooled while the link was down, and reads only: say hello as hook, spool or cli.');
    const holder = this.people.holder(value.token);
    if (!holder) return refuse('/token', "Present a person's credential this hub issued; a revoked one no longer counts, and the control token stays on the hub's own machine.");
    if (!holder.key || holder.key !== key) {
      return refuse('/proof', `The credential's proof doesn't match: it is bound to key ${holder.key ? holder.key.slice(0, 16) : '(none: it was issued for this machine only)'}, and this connection's TLS handshake proved ${key ? `key ${key.slice(0, 16)}` : 'no key'}. A credential works only on the machine that holds its key.`);
    }
    conn.person = holder.person;
    if (value.hello === 'hook') {
      conn.first = true;
      return;
    }
    if (value.hello === 'spool') {
      conn.spool = true;
      conn.first = true;
      return conn.write({ role: `spool:${holder.person}` });
    }
    conn.role = 'person';
    conn.name = `person:${holder.person}`;
    conn.write({ role: conn.name });
  }

  private tokenMatches(token: unknown): boolean {
    if (typeof token !== 'string') return false;
    const given = Buffer.from(token);
    const held = Buffer.from(this.token);
    return given.length === held.length && timingSafeEqual(given, held);
  }

  private async hello(conn: Conn, value: Obj): Promise<void> {
    if (value.v !== 1) {
      conn.write({ id: null, error: versionRefusal(value) });
      return conn.end();
    }
    // A person's credential (#1337): their reads, or their hooks, whose events are stamped with them.
    const person = (value.hello === 'cli' || value.hello === 'hook') && !this.tokenMatches(value.token) ? this.people.holder(value.token)?.person : undefined;
    if (value.hello === 'hook') {
      if (!person && !this.tokenMatches(value.token)) {
        conn.write({ id: null, error: refusal('credential', '/token', "Present the control token or a person's credential this hub issued.") });
        return conn.end();
      }
      conn.person = person;
      // The next line is the hook's request, read as a first line is.
      conn.first = true;
      return;
    }
    if (value.hello === 'cli' && person) {
      conn.role = 'person';
      conn.name = `person:${person}`;
      conn.person = person;
      return conn.write({ role: conn.name });
    }
    if (value.hello === 'app' || value.hello === 'cli') {
      if (!this.tokenMatches(value.token)) {
        conn.write({ id: null, error: refusal('credential', '/token', "Present the control token this hub wrote to control.token at its launch; an earlier launch's token no longer counts.") });
        return conn.end();
      }
      conn.role = value.hello;
      conn.name = value.hello;
      const peer = value.peer;
      if (isObj(peer) && Number.isSafeInteger(peer.pid) && typeof peer.start === 'string') conn.peer = { pid: peer.pid as number, start: peer.start };
      return conn.write({ role: conn.name });
    }
    if (value.hello === 'mcp') {
      const parent = value.parent;
      const proved = isObj(parent) && Number.isSafeInteger(parent.pid) && typeof parent.start === 'string' ? { pid: parent.pid as number, start: parent.start } : undefined;
      // A DeepBuild MCP server paseo's plugin added binds by the token it was opened with (#55).
      const paseo = typeof value.paseo === 'string' && value.paseo ? value.paseo : undefined;
      const session = proved || paseo ? ((await this.core.request({ op: 'mcp-hello', parent: proved, ...(paseo ? { paseo } : {}) }).catch(() => null)) as string | null) : null;
      conn.role = 'mcp';
      conn.session = session;
      conn.parent = proved;
      if (typeof value.cwd === 'string') conn.cwd = value.cwd;
      conn.name = session ? `mcp:${session}` : 'mcp';
      return conn.write({ role: conn.name });
    }
    conn.write({ id: null, error: refusal('enum', '/hello', 'Say hello as app, cli or mcp.', value.hello) });
    conn.end();
  }

  private method(given: Conn, value: Obj): void {
    let conn = given;
    const id = value.id ?? null;
    if (value.v !== 1) return conn.write({ id, error: versionRefusal(value) });
    if (!('method' in value)) {
      return conn.write({ id, error: refusal('role', '', `A hook request is read only as a connection's first line; this ${conn.name} connection can't send one.`, conn.name) });
    }
    const called = value.method;
    if (typeof called !== 'string') return conn.write({ id, error: refusal('type', '/method', 'Name the method as a string.', called) });
    // A deprecated method is served through the adapter (#139): the method that replaced it runs, and the reply says so.
    const replaced = this.adapter.replacing(called);
    const method = replaced?.replaced_by ?? called;
    const notice: DeprecatedNotice | undefined = replaced && this.plant !== 'silent-deprecated' ? this.adapter.serve(called, null, () => null).deprecated : undefined;
    if (notice) conn = noticed(conn, id, notice);
    const allowed = ALLOWED.get(method);
    if (!allowed || (method === 'test.load' && !this.vfs) || (method === 'test.send_back' && process.env.DEEP_HUB_TEST_SEND_BACK !== '1') || (method === 'test.verdict' && process.env.DEEP_HUB_TEST_VERDICT !== '1') || (method === 'test.clock' && process.env.DEEP_HUB_TEST_CLOCK_STEPS !== '1')) return conn.write({ id, error: refusal('unknown_method', '/method', `The hub serves no method ${method}.`, method) });
    if (!allowed.includes(conn.role!)) {
      return conn.write({ id, error: refusal('role', '/method', `A ${conn.name} connection can't call ${method}: its credential allows ${allowed.join(' or ')} connections only.`, method) });
    }
    const reply = (work: Promise<unknown>) => work.then(
      (result) => conn.write({ id, result: result ?? {} }),
      (error: unknown) => conn.write({ id, error: error instanceof Refused ? error.refusal : refusal('unavailable', '', error instanceof Error ? error.message : String(error), method, true) }),
    );
    const params = isObj(value.params) ? value.params : {};
    switch (method) {
      case 'hub.stop':
        conn.write({ id, result: { stopping: true } });
        return void this.stop('requested');
      case 'gates.off':
      case 'gates.on': {
        const off = method === 'gates.off';
        // The core asks the OS to confirm you; only then do the gates change.
        return void reply(this.core.request({ op: 'call', method: 'you.confirm', params: { command: off ? 'deep off' : 'deep on' }, context: { role: conn.name, ...(conn.peer ? { peer: conn.peer } : {}) } }).then(() => {
          // The planted wrong program answers `deep on` as done and keeps every gate watch-only.
          const stays = off || this.plant === 'on-stays-off';
          this.off = stays;
          setGatesOff(this.root, stays);
          return { off };
        }));
      }
      case 'notifications.report':
        this.notifier = conn;
        return void reply(this.core.request({ op: 'call', method, params, context: { role: conn.name } }));
      case 'hub.health':
      case 'health':
        // The process readings after the core's: its own checks start short-lived children (the secret store's) that
        // would count as the hub's.
        return void reply(this.core.request({ op: 'health' }).then(async (health) => ({ pid: process.pid, start: this.start, off: this.off, ...(health as Obj), process: await processHealth() })));
      case 'stream.subscribe': {
        const sub = `${conn.id}:${JSON.stringify(id)}`;
        const after = Number.isSafeInteger(params.after) && (params.after as number) >= 0 ? (params.after as number) : 0;
        const scope = scopeOf(params.scope);
        if (scope instanceof Refused) return conn.write({ id, error: scope.refusal });
        conn.subs.add(sub);
        this.subs.set(sub, { conn, id, queued: 0, bytes: 0, held: [], next: 0, since: Date.now() });
        // The reply is the stream's first frame: it carries the start ID, so a consumer that sees a new one redoes its reads.
        // A scoped one also names the head (#1575): its replay ends there, with one frame marking it; or, too far behind
        // for a replay, it says to read a fresh snapshot, and no frame follows.
        return void reply(this.core.request({ op: 'subscribe', sub, after, ...(scope ? { scope } : {}) }).then((got) => {
          if (!scope) return { subscribed: true, after, start: this.start };
          const { head, snapshot } = got as { head: number; snapshot?: true };
          if (!snapshot) return { subscribed: true, after, start: this.start, head };
          conn.subs.delete(sub);
          this.subs.delete(sub);
          return { subscribed: false, snapshot: true, after, start: this.start, head };
        }));
      }
      case 'person.add':
      case 'person.invite':
      case 'person.revoke':
        return void reply(this.core.request({ op: 'call', method, params, context: { role: conn.name, ...(conn.peer ? { peer: conn.peer } : {}) } }).then(async (result) => {
          this.people.load();
          // A revoked person's connections close now, so nothing they hold open outlives the credential (#1338).
          if (method === 'person.revoke') for (const c of this.conns) if (c.person === params.person) c.sock.destroy();
          await this.syncNetwork();
          return result;
        }));
      case 'mcp.cancel': {
        const call = `${conn.id}:${String(params.call)}`;
        if (conn.calls.delete(call)) this.core.post({ op: 'call-gone', call });
        return conn.write({ id, result: {} });
      }
      case 'session.wait':
        conn.waiter = true;
        return void reply(this.core.request({ op: 'call', method, params, context: { role: conn.name, waiter: conn.id, session: conn.session } }));
      default:
        if (method === 'events.read') {
          // The page's events come as one JSON array's text, written as it is, with the start ID beside its log_pos.
          return void this.core.request({ op: 'call', method, params, context: { role: conn.name } }).then((result) => {
            const { log_pos, events } = result as { log_pos: number; events: string };
            if (!conn.done && conn.sock.writable) conn.sock.write(`{"v":${VERSION},"id":${JSON.stringify(id)},"result":{"start":${JSON.stringify(this.start)},"log_pos":${log_pos},"events":${events}}}\n`);
          }, (error: unknown) => reply(Promise.reject(error)));
        }
        if (READS.has(method)) {
          return void reply(this.core.request({ op: 'call', method, params, context: { role: conn.name } }).then((result) => ({ start: this.start, ...(result as Obj) })));
        }
        {
          const call = method === 'mcp.call' ? `${conn.id}:${String(id)}` : undefined;
          if (call) conn.calls.add(call);
          const work = this.core.request({ op: 'call', method, params, context: { role: conn.name, session: conn.session, ...(conn.parent ? { parent: conn.parent } : {}), ...(conn.cwd ? { cwd: conn.cwd } : {}), ...(conn.peer ? { peer: conn.peer } : {}), ...(call ? { call } : {}) } });
          return void reply(call ? work.finally(() => conn.calls.delete(call)) : work);
        }
    }
  }

  /** A stop with its reason recorded: no new connections, the core's clean stop, then only our own socket removed. */
  async stop(reason: string): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    clearTimeout(this.waitTimer);
    this.server.close();
    this.network?.close();
    // The stop-answers-waiting plant (#823) keeps the connections until the core stops, so a waiting call is answered.
    const answers = this.plant === 'stop-answers-waiting';
    if (!answers) for (const conn of this.conns) conn.sock.destroy();
    try {
      await Promise.race([this.core.request({ op: 'stop', reason }), new Promise((_, reject) => setTimeout(() => reject(Error('the core took over 20 s to stop')), 20_000))]);
    } catch (error) {
      process.stderr.write(`deep hub: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    if (answers) for (const conn of this.conns) conn.sock.destroy();
    this.exit(0);
  }
  private exit(code: number): void {
    try {
      if (this.ino && statSync(this.root.socket).ino === this.ino) rmSync(this.root.socket, { force: true });
    } catch { /* already gone */ }
    try { this.lock.release(); } catch { /* the OS drops it at exit anyway */ }
    process.exit(code);
  }
}

/** Whether a process listens at the socket's path: a dead hub's socket refuses, and one that doesn't answer in time counts as live. */
function listening(path: string): Promise<boolean> {
  return new Promise((done) => {
    const sock = net.connect(path);
    const timer = setTimeout(() => { sock.destroy(); done(true); }, 1000);
    sock.once('connect', () => { clearTimeout(timer); sock.destroy(); done(true); });
    sock.once('error', () => { clearTimeout(timer); done(false); });
  });
}

/** Values the hub holds by handle from its start, as tests name them in DEEP_HUB_TEST_HELD: scrubbed from all it writes. */
function testHeld(): string[] {
  const file = process.env.DEEP_HUB_TEST_HELD;
  if (!file) return [];
  try { return readFileSync(file, 'utf8').split('\n').map((v) => v.trim()).filter(Boolean); } catch { return []; }
}
/** Where the network listener listens (#1338): `hub.listen` in the hub's config.json, else every interface's port 7433. */
function listenAt(dir: string): { host: string; port: number } {
  let at: unknown;
  try { at = (JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as { hub?: { listen?: unknown } }).hub?.listen; } catch { /* the default */ }
  const m = typeof at === 'string' ? /^(.*):(\d{1,5})$/.exec(at) : null;
  return m ? { host: m[1]!.replace(/^\[|\]$/g, '') || '0.0.0.0', port: Number(m[2]) } : { host: '0.0.0.0', port: 7433 };
}
/** Whether `deep off` is in effect: <root>/gates.json, which only the hub writes, once the OS confirmed you. */
function gatesOff(root: Root): boolean {
  try { return (JSON.parse(readFileSync(join(root.dir, 'gates.json'), 'utf8')) as { off?: unknown }).off === true; } catch { return false; }
}
function setGatesOff(root: Root, off: boolean): void {
  const file = join(root.dir, 'gates.json');
  writeFileSync(`${file}.tmp`, `${JSON.stringify({ off, since: Date.now() })}\n`, { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

/** Writes the control token: random, new each launch, readable only by you, never on a command line. */
function writeToken(root: Root): string {
  const token = randomBytes(32).toString('base64url');
  const tmp = `${root.token}.${process.pid}`;
  writeFileSync(tmp, `${token}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, root.token);
  return token;
}

/** `deep hub run [--root <folder>]`: the hub itself, in this process. Resolves only if it couldn't start. */
/**
 * Runs the hub. In safe mode (`safe`) it loads no extension; the hub loads none yet in either mode, and the
 * floor (the fail_closed entries and the `.deepbuild/` guard) is deep-hook's, so it holds the same in both.
 */
export async function runHub(options: { root?: string; safe?: boolean }): Promise<number> {
  dropTestSettings(options.root ?? installedRoot());
  const plant = plantOf(process.env.DEEP_HUB_PLANT);
  // The kit gate@1's fault for rows no commit reaches (#33): only the kit sets it, and a name it doesn't know stops the hub.
  const fault = process.env.DEEP_HUB_TEST_JUDGE_FAULT;
  // The gate's modules load only then: the hub's thread runs none of them.
  if (fault && !((await import('@deepbuild/gate')).JUDGE_FAULTS as readonly string[]).includes(fault)) throw Error(`DEEP_HUB_TEST_JUDGE_FAULT=${fault} names no fault the kit plays`);
  plantedStart(plant);
  const vfs = process.env.DEEP_HUB_TEST_VFS ? (JSON.parse(process.env.DEEP_HUB_TEST_VFS) as VfsSettings) : undefined;
  // Both read at one moment, so with no test clock the hub's is the wall clock exactly.
  const real = Date.now();
  const clock = { start: process.env.DEEP_HUB_TEST_CLOCK ? Number(process.env.DEEP_HUB_TEST_CLOCK) : real, real };
  const root = rootOf(options.root ?? installedRoot());
  // Everything the hub writes, the record and the evidence included, is readable only by you.
  process.umask(0o077);
  mkdirSync(root.dir, { recursive: true, mode: 0o700 });
  if (plant === 'unlink-before-lock') rmSync(root.socket, { force: true });
  const lock = takeLock(root.lock);
  if (!lock) {
    process.stderr.write(`deep hub: a hub is already running on ${root.dir}: it holds the lock\n`);
    return 1;
  }
  // A hub whose lock file was removed under it still listens (#909): its socket is never removed, and this start stops.
  if (await listening(root.socket)) {
    lock.release();
    process.stderr.write(`deep hub: a hub is already running on ${root.dir}: it answers on ${root.socket}, though it no longer holds the lock\n`);
    return 1;
  }
  // A restore cut off midway may have put back the record without its evidence and wiki, or the reverse (#572).
  if (existsSync(root.restoring)) {
    lock.release();
    process.stderr.write(`deep hub: a restore didn't finish: run deep restore ${readFileSync(root.restoring, 'utf8').trim()} again, then start the hub\n`);
    return 1;
  }
  // A hangup isn't a stop: closing the terminal or SSH session that started the hub leaves it running.
  process.on('SIGHUP', () => undefined);
  process.stdout.on('error', () => undefined);
  process.stderr.on('error', () => undefined);
  const hub = new Hub(root, writeToken(root), lock, plant, vfs);
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => void hub.stop(`signal:${signal}`));
  await hub.open(clock);
  process.stdout.write(`${JSON.stringify({ v: 1, ready: true, pid: process.pid, socket: root.socket, start: hub.start, ...(options.safe ? { safe: true } : {}) })}\n`);
  shedStartup();
  const headroom = process.env.DEEP_HUB_TEST_HEADROOM;
  if (headroom) {
    // Takes descriptors until the OS refuses one, then gives `headroom` back: the limit is the open count plus that.
    const held: number[] = [];
    try { for (;;) held.push(openSync('/dev/null', 'r')); } catch { /* the limit */ }
    for (let i = 0; i < Number(headroom); i++) closeSync(held.pop()!);
  }
  return new Promise<number>(() => undefined);
}
