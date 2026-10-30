// One line read off the socket, parsed: a hello or a method call is handed back as it is; a hook request is
// held to hook.request@3, mapped through its agent's adapter to its event, and kept to that kind's catalogue
// fields, its text scrubbed of every value the hub holds. Runs in the parser workers, off the event loop.
import { closeSync, openSync, readFileSync, readSync, readdirSync, fstatSync } from 'node:fs';
import { join } from 'node:path';
import { factsAdapter, registry as emptyRegistry, shipped, type Adapter, type AdapterRegistry, type HookRequestLine, type JsonObject } from '@deepbuild/adapters';
import { canonicalize, getSchema, sha256Hex, validate, type JsonValue } from '@deepbuild/contracts';
import { scrubText } from '@deepbuild/evidence';
import { isPrCreate, prUrlIn } from './forge.js';
import { countMcp } from './mcp-servers.js';
import { refusal, signature, type Draft, type HookMeta, type Parsed, type Plant } from './wire.js';

/**
 * The agent names a hook request may carry, to the adapter that maps them. Cursor's CLI and Grok run the hooks in
 * Claude Code's settings file (deep-hook names them from their own variables), so Claude Code's facts read their
 * payloads, but their events are recorded under their own agent, never as Claude Code's.
 */
const ADAPTERS: Readonly<Record<string, string>> = { 'claude-code': 'claude', claude: 'claude', codex: 'codex', cursor: 'claude', grok: 'claude', pi: 'pi' };
/** The hub's moments an agent's own event names stand for, where the agent's differ from the hook names the core reads. */
const MOMENTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  pi: { session_start: 'SessionStart', session_shutdown: 'SessionEnd', input: 'UserPromptSubmit', tool_call: 'PreToolUse', tool_result: 'PostToolUse', agent_before_settle: 'Stop' },
};
const TOOL_KINDS = ['shell', 'read', 'edit', 'write', 'search', 'fetch', 'mcp', 'unknown'];
const FROM = ['person', 'scheduled', 'subagent', 'session', 'continuation', 'unknown'];
const ASKS = ['tool', 'plan', 'question', 'mode'];
const SEQ_WHY = 'seq is when the hook started, in ns since the Unix epoch, as a canonical decimal string from 0 to 9223372036854775807: digits only, no sign, no leading zero, never a JSON number.';
const MAX_MS = 9_007_199_254_740_991n;

const isObj = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Whether a kind's event must name the session it is about. */
const aboutSession = new Map<string, boolean>();
const needsSubject = (kind: string): boolean => {
  let needs = aboutSession.get(kind);
  if (needs === undefined) aboutSession.set(kind, (needs = ((getSchema(`${kind}@1`) as { required?: string[] }).required ?? []).includes('subject')));
  return needs;
};

let adapters: AdapterRegistry | undefined;
/**
 * The shipped adapters; DEEP_HUB_TEST_FACTS names a folder whose facts files they read instead, as a widened range
 * would after the live smoke test (only tests set it).
 */
export function hubAdapters(): AdapterRegistry {
  const folder = process.env.DEEP_HUB_TEST_FACTS;
  const base = shipped();
  if (!folder) return base;
  const reg = emptyRegistry();
  for (const file of readdirSync(folder).filter((f) => f.endsWith('.facts.json') && f !== 'mcp-servers.facts.json' && f !== 'loops.facts.json')) {
    const facts = JSON.parse(readFileSync(join(folder, file), 'utf8')) as JsonObject;
    const name = String(facts.agent);
    reg.register(name, factsAdapter(facts, base.get(name) as Adapter));
  }
  return reg;
}
const registry = (): AdapterRegistry => (adapters ??= hubAdapters());

/**
 * What each tool the agents' facts list counts as where it isn't change (#304), for rules.json: a read or a search
 * counts as read. Any other tool, one they don't list included, counts as change.
 */
export function toolClasses(): Record<string, 'read'> {
  const classes: Record<string, 'read'> = {};
  for (const name of registry().names()) {
    const kinds = (registry().get(name).facts as JsonObject).toolKinds;
    const tools = isObj(kinds) && isObj(kinds.tools) ? kinds.tools : {};
    for (const [tool, kind] of Object.entries(tools)) if (kind === 'read' || kind === 'search') classes[tool] = 'read';
  }
  return classes;
}

/** The loop facts (adapters/loops.facts.json): the tools that schedule, cancel and run in the background, per agent. */
let loopFacts: JsonObject | undefined;
const loopsOf = (name: string): JsonObject => {
  loopFacts ??= JSON.parse(readFileSync(new URL('../../../adapters/loops.facts.json', import.meta.url), 'utf8')) as JsonObject;
  const agents = loopFacts.agents as JsonObject;
  return isObj(agents[name]) ? agents[name] : {};
};
const at = (value: unknown, path: string): unknown => path.split('.').reduce<unknown>((inner, key) => (isObj(inner) ? inner[key] : undefined), value);

/**
 * The version of the agent a session runs, as the newest entry of its transcript names it, or undefined while it
 * holds none. Read from the file's last 64 KiB; kept once found, since a session doesn't change version.
 */
const versions = new Map<string, string>();
export function versionOf(transcript: string): string | undefined {
  const known = versions.get(transcript);
  if (known || !transcript) return known;
  let fd: number | undefined;
  try {
    fd = openSync(transcript, 'r');
    const { size } = fstatSync(fd);
    const length = Math.min(size, 65_536);
    const tail = Buffer.alloc(length);
    readSync(fd, tail, 0, length, size - length);
    const lines = tail.toString('utf8').split('\n');
    // The first line may be cut by the window; only whole entries are read.
    for (let i = lines.length - 1; i >= (length < size ? 1 : 0); i--) {
      if (!lines[i]!.includes('"version"')) continue;
      let entry: unknown;
      try { entry = JSON.parse(lines[i]!); } catch { continue; }
      const version = isObj(entry) ? entry.version : undefined;
      if (typeof version !== 'string' || !version) continue;
      if (versions.size > 4096) versions.clear();
      versions.set(transcript, version);
      return version;
    }
  } catch {
    // No transcript yet: the version is read at the session's next hook.
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return undefined;
}
/** The newest agent version an adapter's facts cover: a live hook is read as that version. */
function newest(name: string): string {
  const versions = ((registry().get(name).facts as JsonObject).events as JsonObject).versions as JsonObject;
  return Object.keys(versions).at(-1)!;
}
/** Whether the facts of the adapter an agent's hooks map through cover a version. */
export const coveredBy = (agent: string, version: string): boolean => ((registry().get(ADAPTERS[agent] ?? agent).facts as JsonObject).versions as string[]).includes(version);

/** Loads the adapters' facts ahead of the first request. */
export function warm(): void {
  for (const name of new Set(Object.values(ADAPTERS))) newest(name);
  // One request mapped ahead of the first, so the first hook's acknowledgement doesn't wait on compiling its checks.
  const payload = { session_id: 'warm', cwd: '/', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'true' }, tool_use_id: 'warm' };
  mapRequest({ v: 1, agent: 'claude-code', event: 'PreToolUse', seq: '0', id: '00000000000000000000000000', pid: 1, ppid: 1, matched: [], payload }, []);
}

/** Parses one line. `first` is a connection's first line, the only place a hook request is read. */
export function parseLine(bytes: Uint8Array, first: boolean, held: readonly string[], plant?: Plant): Parsed {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8'));
  } catch {
    return { kind: 'refused', id: null, error: refusal('not_json', '', 'Send one JSON object on one line.', Buffer.from(bytes.subarray(0, 200)).toString('utf8')) };
  }
  if (!isObj(value)) return { kind: 'refused', id: null, error: refusal('type', '', 'Send one JSON object on one line.', value) };
  if (!first || 'hello' in value || 'method' in value) return { kind: 'control', value };
  return mapRequest(value, held, plant);
}

function mapRequest(value: JsonObject, held: readonly string[], plant?: Plant): Parsed {
  const id = typeof value.id === 'string' ? value.id : null;
  const checked = validate('hook.request@3', value);
  // A field the hub doesn't know is refused, never ignored: an ignored deny or answer would read as a success.
  const issues = checked.ok ? [] : checked.issues.filter((issue) => !(plant === 'ignores-unknown-field' && issue.code === 'unlisted_field'));
  if (issues.length) {
    const issue = issues[0]!;
    return { kind: 'refused', id, error: { ...issue, remediation: issue.path === '/seq' ? SEQ_WHY : issue.remediation } };
  }
  const request = value as unknown as HookRequestLine;
  const name = ADAPTERS[request.agent];
  if (!name) return { kind: 'refused', id, error: refusal('enum', '/agent', `No adapter maps ${request.agent}; send one of ${Object.keys(ADAPTERS).join(', ')}.`, request.agent) };
  if (!isObj(request.payload)) return { kind: 'refused', id, error: refusal('type', '/payload', "Send the agent's hook JSON object as the payload.", request.payload) };
  const payload = request.payload;
  const moments = MOMENTS[name];
  const event = moments?.[request.event] ?? request.event;
  // Who is calling: a payload that carries Cursor's own fields is Cursor's, whatever command ran it.
  const agent = request.agent === 'claude-code' && typeof payload.cursor_version === 'string' ? 'cursor' : request.agent;
  const scrub = (text: string) => scrubText(text, { held });
  const meta: HookMeta = {
    id: request.id, agent, event, session: str(payload.session_id), cwd: str(payload.cwd),
    transcript: str(payload.transcript_path), pid: request.pid, ppid: request.ppid, matched: request.matched,
  };
  if (str(payload.tool_use_id)) meta.toolUse = str(payload.tool_use_id);
  if (request.late === true) meta.late = { matched: request.matched };
  if (request.notes) meta.notes = request.notes;
  if (request.stage) meta.stage = request.stage;
  const fields: NonNullable<HookMeta['fields']> = {};
  for (const key of ['prompt_id', 'prompt', 'error', 'agent_id', 'source', 'last_assistant_message', 'turn_id', 'file_path'] as const) if (str(payload[key])) fields[key] = str(payload[key]);
  if (!fields.prompt && str(payload.text)) fields.prompt = str(payload.text);
  if (Object.keys(fields).length) meta.fields = fields;
  if (name === 'pi' && str(payload.parent)) meta.parent = str(payload.parent);
  const tool = str(payload.tool_name);
  if (event === 'PreToolUse' && tool.startsWith('mcp__deep__')) meta.stamp = { tool: tool.slice('mcp__deep__'.length), digest: sha256Hex(canonicalize((payload.tool_input ?? null) as JsonValue)) };
  if (plant === 'writer-from-payload' && typeof payload.writer === 'string') meta.payloadWriter = payload.writer;
  if (plant === 'matches-text' && tool === 'Bash' && isObj(payload.tool_input)) meta.command = str(payload.tool_input.command);
  if ((event === 'PreToolUse' || event === 'PermissionRequest' || event === 'PostToolUse') && tool) {
    meta.call = { mode: str(payload.permission_mode), tool, input: isObj(payload.tool_input) ? payload.tool_input : {}, suggestions: Array.isArray(payload.permission_suggestions) ? payload.permission_suggestions : [] };
  }
  // A session on a version its agent's facts don't cover has its holds and blocks watch-only. Only a reply that holds
  // or blocks reads the version here; the core reads it for every other hook, off the acknowledgement's path.
  const replies = event === 'Stop' || event === 'PermissionRequest' || (event === 'PreToolUse' && request.matched.length > 0);
  // An agent whose transcript names no version says it in the payload.
  const version = str(payload.agent_version) || (replies ? versionOf(meta.transcript) : undefined);
  if (version) meta.version = version;
  if (version && !coveredBy(agent, version)) meta.watchOnly = true;

  const facts = registry().get(name).facts as JsonObject;
  const rule = (facts.mapping as JsonObject)[request.event];
  const kind = isObj(rule) && typeof rule.kind === 'string' ? rule.kind : undefined;
  if (!kind) return { kind: 'hook', drafts: [], meta };
  const mapped = registry().mapHook({ ...request, agent: name }, newest(name)).events.find((e) => e.kind === kind)?.data ?? {};
  let data: Record<string, unknown> | undefined;
  let fill: Draft['fill'];
  let v = 1;
  switch (kind) {
    case 'session.start':
      // What the session loads is read by the core, off this thread.
      data = { agent, worktree: meta.cwd || '-', branch: null, thread: meta.session || '-', loads: [] };
      // Which billing keys the agent had set, never their values.
      if (request.billing) data.billing = request.billing;
      fill = 'loads';
      v = 3;
      if (typeof mapped.parent === 'string' && mapped.parent) {
        data.parent = mapped.parent;
        v = 4;
      }
      break;
    case 'session.end':
      data = { reason: str(payload.reason) || 'other' };
      break;
    case 'user.ask':
      // Where the prompt came from is the core's to read, from the transcript entry it joins to.
      data = { msg: 0, text: scrub(str(mapped.text ?? payload.prompt)), tasks: [], from: FROM.includes(str(mapped.from)) ? mapped.from : 'unknown' };
      fill = 'msg';
      if (mapped.disposition === 'handled') {
        data.disposition = 'handled';
        v = 2;
      }
      break;
    case 'tool.before':
    case 'tool.after': {
      // A tool's kind, command and paths are read from its call, which the facts map on PreToolUse.
      const before = Object.entries(moments ?? {}).find(([, moment]) => moment === 'PreToolUse')?.[0] ?? 'PreToolUse';
      const call = kind === 'tool.before' ? mapped : registry().mapHook({ ...request, agent: name, event: before, payload: { ...payload, hook_event_name: before } }, newest(name)).events.find((e) => e.kind === 'tool.before')?.data ?? {};
      const callKind = TOOL_KINDS.includes(str(call.kind)) ? str(call.kind) : 'unknown';
      data = {
        kind: callKind, paths: Array.isArray(call.paths) ? call.paths.filter((p) => typeof p === 'string' && p) : [],
        command: typeof call.command === 'string' ? scrub(call.command) : null,
        ...(meta.toolUse ? { call: meta.toolUse } : {}),
      };
      if (callKind === 'mcp') {
        const server = str(call.server) || 'unknown';
        const named = str(call.tool) || str(call.name) || tool || 'unknown';
        Object.assign(data, { server, tool: named });
        if (kind === 'tool.before') Object.assign(data, countMcp(server, named, meta.cwd, plant === 'unknown-tool-read' ? 'read' : 'change', plant === 'trusts-hints'));
      }
      if (kind === 'tool.before') {
        // A call names the guard entries deep-hook matched, so a watched match is recorded; one deep-hook let
        // through because the hub was late is marked late.
        if (request.late === true) Object.assign(data, { late: true, matched: request.matched });
        else if (request.matched.length) data.matched = request.matched;
        v = 3;
      } else {
        Object.assign(data, failure(mapped.outcome === 'failed', payload, callKind, meta.cwd));
        v = 2;
        // The agent's own record of the calls this one made: incomplete stays incomplete.
        if (isObj(mapped.nested) && typeof mapped.nested.complete === 'boolean') {
          data.nested = { complete: mapped.nested.complete, ...(Number.isSafeInteger(mapped.nested.calls) ? { calls: mapped.nested.calls } : {}) };
          v = 3;
        }
        // The pull request a `gh pr create` call opened, from the call's own response (#83): only a call that is that
        // one command counts, so an echoed URL never passes for the one gh printed. Read here for both agents, since a
        // Codex session's rollout is never read.
        if (callKind === 'shell' && typeof call.command === 'string' && isPrCreate(call.command)) {
          const url = prUrlIn(typeof payload.tool_response === 'string' ? payload.tool_response : JSON.stringify(payload.tool_response ?? ''));
          if (url) meta.pr = url;
        }
      }
      const loop = loopFact(name, tool, event, payload);
      if (loop) meta.loop = loop;
      break;
    }
    case 'agent.stop':
      // The turn's cause is read from the payload here; the core reads the turn's transcript records, its usage and its loop.
      // Whether it is a claim is the core's stop rule's to read.
      data = { turn: 0, did_work: false, claim: false, outcome: mapped.outcome === 'failed' ? 'failed' : 'finished', cause: STOP_CAUSES.includes(str(mapped.cause)) ? mapped.cause : 'unknown', usage: null };
      fill = 'turn';
      v = 4;
      break;
    case 'permission.request':
      data = {
        kind: ASKS.includes(str(mapped.kind)) ? mapped.kind : 'tool',
        ...(str(mapped.tool) ? { tool: mapped.tool } : {}),
        ...(typeof mapped.command === 'string' ? { command: scrub(mapped.command) } : {}),
        ...(Array.isArray(mapped.paths) ? { paths: mapped.paths.filter((p) => typeof p === 'string' && p) } : {}),
      };
      break;
    case 'session.activity':
      data = { activity: str(mapped.activity) || request.event };
      break;
    case 'task.completed':
      data = { agent_task: str(mapped.agent_task) || '-', title: scrub(str(mapped.title)) || '-' };
      break;
    default:
      return { kind: 'hook', drafts: [], meta };
  }
  const ms = BigInt(request.seq) / 1_000_000n;
  const draft: Draft = { kind, v, id: request.id, ts: Number(ms > MAX_MS ? MAX_MS : ms), seq: request.seq, data };
  if (fill) draft.fill = fill;
  // A stop, a permission request or a finished task is about its session: the session: handle takes the agent's session ID's letters and digits.
  const handle = meta.session.replace(/[^0-9A-Za-z]/g, '');
  if (handle && needsSubject(kind)) draft.subject = `session:${handle}`;
  return { kind: 'hook', drafts: [draft], meta };
}

const STOP_CAUSES = ['sign_in_required', 'token_refresh_failed', 'plan_window_spent', 'rate_limited', 'refusal', 'max_turns', 'context_overflow', 'tool_schema_rejected', 'agent_crashed', 'timed_out', 'unknown'];

/**
 * How a call ended: ok, or failed at its failure hook with the exit code its error reports, an error signature that
 * is the same for the same failure in any session, a cause and who can act on it.
 */
function failure(failed: boolean, payload: JsonObject, kind: string, cwd: string): Record<string, unknown> {
  if (!failed) return { outcome: 'ok' };
  const error = str(payload.error);
  const code = /^Exit code (\d{1,3})\b/.exec(error);
  const exit = code ? Number(code[1]) : null;
  const cause = payload.is_interrupt === true ? 'interrupted' : exit !== null ? 'command_failed' : /permission|denied by the user/i.test(error) ? 'permission_denied' : error ? 'tool_error' : 'unknown';
  return { outcome: 'failed', exit_code: exit !== null && exit <= 255 ? exit : null, signature: signature(`${kind}:${cause}`, error, cwd), cause, owner: cause === 'permission_denied' ? 'you' : 'agent' };
}

/** The loop fact a tool hook carries, by the agent's loop facts: wake-ups and crons once they ran, background subagents. */
function loopFact(name: string, tool: string, event: string, payload: JsonObject): HookMeta['loop'] {
  if (event !== 'PostToolUse') return undefined;
  const facts = loopsOf(name);
  const wakeup = isObj(facts.wakeups) ? facts.wakeups[tool] : undefined;
  if (isObj(wakeup)) {
    const delay = at(payload, String(wakeup.delaySeconds));
    return { scheduled: typeof delay === 'number' && delay >= 0 ? delay * 1000 : null };
  }
  const cron = isObj(facts.crons) ? facts.crons[tool] : undefined;
  if (isObj(cron)) {
    const due = at(payload, String(cron.due));
    return { cron: String(at(payload, String(cron.id)) ?? payload.tool_use_id), due: typeof due === 'number' ? Math.round(due) : null, recurring: at(payload, String(cron.recurring)) === true };
  }
  const cancel = isObj(facts.cancels) ? facts.cancels[tool] : undefined;
  if (isObj(cancel)) return { cancelled: String(at(payload, String(cancel.id)) ?? '') };
  const background = isObj(facts.background) ? facts.background[tool] : undefined;
  if (typeof background === 'string' && at(payload, background) === true) return { background: true };
  return undefined;
}
