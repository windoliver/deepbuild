// One line read off the socket, parsed: a hello or a method call is handed back as it is; a hook request is
// held to hook.request@3, mapped through its agent's adapter to its event, and kept to that kind's catalogue
// fields, its text scrubbed of every value the hub holds. Runs in the parser workers, off the event loop.
import { closeSync, openSync, readFileSync, readSync, readdirSync, fstatSync } from 'node:fs';
import { join } from 'node:path';
import { ADAPTERS, factsAdapter, readFacts, registry as emptyRegistry, shipped, type Adapter, type AdapterRegistry, type HookRequestLine, type JsonObject } from '@deepbuild/adapters';
import { isObject as isObj, canonicalize, getSchema, sha256Hex, validate, type JsonValue } from '@deepbuild/contracts';
import { scrubText } from '@deepbuild/evidence';
import { isPrCreate, prUrlIn } from './forge.js';
import { countMcp } from './mcp-servers.js';
import { derivedId, refusal, signature, type Draft, type HookMeta, type Hunk, type Parsed, type Plant } from './wire.js';

/** The hub's moments an agent's own event names stand for, where the agent's differ from the hook names the core reads. */
const MOMENTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  pi: { session_start: 'SessionStart', session_shutdown: 'SessionEnd', input: 'UserPromptSubmit', tool_call: 'PreToolUse', tool_result: 'PostToolUse', agent_before_settle: 'Stop' },
  paseo: { 'agent.turn.after': 'Stop', 'agent.permission.before': 'PermissionRequest' },
};
const TOOL_KINDS = ['shell', 'read', 'edit', 'write', 'search', 'fetch', 'mcp', 'unknown'];
const FROM = ['person', 'scheduled', 'subagent', 'session', 'continuation', 'unknown'];
const ASKS = ['tool', 'plan', 'question', 'mode'];
const ATTENTION = ['working', 'waiting', 'finished'];
/**
 * The hub's moment for a Codex slash command that fires UserPromptSubmit (#1022): the command isn't a prompt you typed,
 * so a reader keyed on the prompt's moment (a turn's start, its ask, the continue's count) passes it by.
 */
export const SLASH_COMMAND = 'SlashCommand';
/** Codex's own slash commands, which Codex runs itself: never words for the model. */
const CODEX_COMMAND = /^\/(compact|review|init|new|clear|undo|diff|status|model|permissions|approvals|mention|mcp|goal|plan|resume|fork|rename|logout|quit|exit|feedback)(?=\s|$)/;
const SEQ_WHY = 'seq is when the hook started, in ns since the Unix epoch, as a canonical decimal string from 0 to 9223372036854775807: digits only, no sign, no leading zero, never a JSON number.';
const MAX_MS = 9_007_199_254_740_991n;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Whether a kind's event must name the session it is about. */
const aboutSession = new Map<string, boolean>();
const needsSubject = (kind: string): boolean => {
  let needs = aboutSession.get(kind);
  if (needs === undefined) aboutSession.set(kind, (needs = ((getSchema(`${kind}@1`) as { required?: string[] }).required ?? []).includes('subject')));
  return needs;
};

/**
 * A structuredPatch hunk in line numbers (#352): one hunk per run of removed and added lines, its context lines left
 * out and its lines equal at both ends taken off, so an insert above a line counts as the insert alone; a run that only
 * removes marks where it was. Each starts where it stands once the runs above it are applied. The lines' text is
 * compared here and dropped.
 */
function hunkOf(h: JsonObject): Hunk[] {
  const nums = [h.oldStart, h.oldLines, h.newStart, h.newLines];
  if (!nums.every((n) => Number.isInteger(n) && Number(n) >= 0) || !Array.isArray(h.lines)) return [];
  const runs: Hunk[] = [];
  let line = h.newStart as number;
  let gone: string[] = [];
  let came: string[] = [];
  const flush = () => {
    let head = 0;
    while (head < gone.length && head < came.length && gone[head] === came[head]) head++;
    let tail = 0;
    while (tail < gone.length - head && tail < came.length - head && gone[gone.length - 1 - tail] === came[came.length - 1 - tail]) tail++;
    const first = line - came.length + head;
    const removed = gone.length - head - tail;
    const added = came.length - head - tail;
    if (removed || added) runs.push({ oldStart: first, oldLines: removed, newLines: added, changed: added ? Array.from({ length: added }, (_, i) => first + i) : [first] });
    gone = [];
    came = [];
  };
  for (const raw of h.lines) {
    const text = str(raw);
    if (text.startsWith('-')) { if (came.length) flush(); gone.push(text.slice(1)); }
    else if (text.startsWith('+')) { came.push(text.slice(1)); line++; }
    // "\ No newline at end of file" is about the line before it, not a line of its own.
    else if (!text.startsWith('\\')) { flush(); line++; }
  }
  flush();
  return runs;
}

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
  // A facts file for an agent with no shipped adapter (cursor's, opencode's) is data for other readers, as the
  // MCP and loop facts are: it registers nothing.
  for (const file of readdirSync(folder).filter((f) => f.endsWith('.facts.json'))) {
    const facts = JSON.parse(readFileSync(join(folder, file), 'utf8')) as JsonObject;
    const name = String(facts.agent);
    if (base.names().includes(name)) reg.register(name, factsAdapter(facts, base.get(name) as Adapter));
  }
  return reg;
}
/** The hub's adapters, read once per thread. */
export const registry = (): AdapterRegistry => (adapters ??= hubAdapters());

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
  loopFacts ??= readFacts<JsonObject>('loops.facts.json');
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
    // Codex's rollout names it once, in the session_meta that opens the file, whose line may outrun the window.
    const head = Buffer.alloc(Math.min(size, 65_536));
    readSync(fd, head, 0, head.length, 0);
    const named = /"cli_version"\s*:\s*"([^"]+)"/.exec(head.toString('utf8'))?.[1];
    if (named) {
      if (versions.size > 4096) versions.clear();
      versions.set(transcript, named);
      return named;
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
/** The adapter an agent's hooks map through, whose caps and facts answer for it; none for a name no adapter maps. */
export function adapterOf(agent: string | undefined): Adapter | undefined {
  const name = agent === undefined ? undefined : ADAPTERS[agent];
  return name === undefined ? undefined : registry().get(name);
}
/** A model call as the agent's own transcript records it (#2019): a retry, with its attempt, most and cause, or the reply that ends the retries. */
export interface ModelCall { outcome: 'retry' | 'reply'; attempt?: number; max?: number; cause?: string; at: number; record: string }
/**
 * A transcript entry the agent's facts (`retries`) mark as its retry of a model call, or as the model's reply that
 * ends retries; read by the facts alone, never the agent's name or text. Undefined for any other entry.
 */
export function modelCallOf(agent: string | undefined, entry: Record<string, unknown>): ModelCall | undefined {
  const r = (adapterOf(agent)?.facts as JsonObject | undefined)?.retries as JsonObject | undefined;
  if (!r) return undefined;
  const at = (path: unknown): unknown => String(path).split('.').reduce<unknown>((inner, key) => (inner && typeof inner === 'object' && Object.hasOwn(inner, key) ? (inner as JsonObject)[key] : undefined), entry);
  const holds = (match: unknown): boolean => Object.entries((match ?? {}) as JsonObject).every(([path, value]) => at(path) === value);
  const when = Date.parse(String(at(r.at)));
  const record = at(r.id);
  if (!Number.isFinite(when) || typeof record !== 'string' || !record) return undefined;
  if (holds(r.match)) {
    const cause = r.cause as { fields: string[]; values: Record<string, string>; otherwise: string };
    const named = cause.fields.map((f) => at(f)).find((v) => (typeof v === 'string' || typeof v === 'number') && Object.hasOwn(cause.values, String(v)));
    const n = (path: unknown): number | undefined => (Number.isSafeInteger(at(path)) && (at(path) as number) >= 1 ? (at(path) as number) : undefined);
    const attempt = n(r.attempt);
    const max = n(r.max);
    return { outcome: 'retry', ...(attempt ? { attempt } : {}), ...(max ? { max } : {}), cause: named === undefined ? cause.otherwise : cause.values[String(named)]!, at: when, record };
  }
  return holds(r.reply) ? { outcome: 'reply', at: when, record } : undefined;
}
/** Whether the facts of the adapter an agent's hooks map through cover a version. */
export const coveredBy =(agent: string, version: string): boolean => ((registry().get(ADAPTERS[agent] ?? agent).facts as JsonObject).versions as string[]).includes(version);

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
  // A table's own entries only: a name every object has, such as constructor, is no agent and no event (#2043).
  const name = Object.hasOwn(ADAPTERS, request.agent) ? ADAPTERS[request.agent] : undefined;
  if (!name) return { kind: 'refused', id, error: refusal('enum', '/agent', `No adapter maps ${request.agent}; send one of ${Object.keys(ADAPTERS).join(', ')}.`, request.agent) };
  if (!isObj(request.payload)) return { kind: 'refused', id, error: refusal('type', '/payload', "Send the agent's hook JSON object as the payload.", request.payload) };
  const payload = request.payload;
  const moments = MOMENTS[name];
  const event = moments && Object.hasOwn(moments, request.event) ? moments[request.event]! : request.event;
  // Who is calling: a payload that carries another tool's own fields is that tool's, whatever command or variable
  // named it; a name its fields contradict is recorded as a reading (#993), and a tool that isn't Claude Code is kept.
  const said = name === 'claude' ? payloadCaller(payload) : undefined;
  const named = request.agent === 'claude' ? 'claude-code' : request.agent;
  const agent = said && said !== 'claude-code' ? said : request.agent;
  const scrub = (text: string) => scrubText(text, { held });
  const meta: HookMeta = {
    id: request.id, seq: request.seq, agent, event, session: str(payload.session_id), cwd: str(payload.cwd),
    transcript: str(payload.transcript_path), pid: request.pid, ppid: request.ppid, matched: request.matched,
  };
  if (said && said !== named) meta.caller = `deep-hook named this hook's caller ${named}, but its payload's own fields say ${said} (${said === 'cursor' ? 'cursor_version' : `transcript_path ${str(payload.transcript_path)}`}); it is recorded under ${agent}.`;
  if (str(payload.tool_use_id)) meta.toolUse = str(payload.tool_use_id);
  if (request.late === true) meta.late = { matched: request.matched };
  if (request.notes) meta.notes = request.notes;
  if (request.stage) meta.stage = request.stage;
  if (request.heavy) meta.heavy = request.heavy;
  const fields: NonNullable<HookMeta['fields']> = {};
  for (const key of ['prompt_id', 'prompt', 'error', 'agent_id', 'source', 'last_assistant_message', 'turn_id', 'file_path'] as const) if (str(payload[key])) fields[key] = str(payload[key]);
  // The agent's own title for the session (#2018), on one line, scrubbed as a prompt's text is.
  const titled = scrub(str(payload.session_title)).split(/\r?\n/)[0]!.trim();
  if (titled) fields.session_title = titled.slice(0, 512);
  if (Object.keys(fields).length) meta.fields = fields;
  if (name === 'pi' && str(payload.parent)) meta.parent = str(payload.parent);
  if (name === 'paseo') {
    const provider = str(payload.provider);
    meta.paseo = { provider, agent: str(payload.paseo_agent), bind: str(payload.bind) };
    for (const [key, field] of [['request', 'request_id'], ['kind', 'permission_kind'], ['behavior', 'behavior'], ['from', 'from']] as const) if (str(payload[field])) meta.paseo[key] = str(payload[field]);
    // A provider the facts have no entry for is watch-only, and says which facts it lacks (#55).
    const providers = (registry().get(name).facts as JsonObject).providers;
    if (!isObj(providers) || !isObj(providers[provider])) {
      meta.watchOnly = true;
      meta.paseo.lacks = `This session runs ${provider || 'an unnamed provider'} through paseo, which DeepBuild's paseo facts have no entry for, so it is watch-only: nothing is held, answered or sent for it, while its fail_closed guard entries still deny. The facts it lacks: bridge (its pinned bridge version), permissions (its permission quirks), modelCheck (the check of the exact model before the first prompt) and timeouts.`;
    }
  }
  const tool = str(payload.tool_name);
  if (event === 'PreToolUse' && tool.startsWith('mcp__deep__')) meta.stamp = { tool: tool.slice('mcp__deep__'.length), digest: sha256Hex(canonicalize((payload.tool_input ?? null) as JsonValue)) };
  if (plant === 'writer-from-payload' && typeof payload.writer === 'string') meta.payloadWriter = payload.writer;
  if (plant === 'actor-from-payload' && typeof payload.actor === 'string') meta.payloadActor = payload.actor;
  if (plant === 'matches-text' && tool === 'Bash' && isObj(payload.tool_input)) meta.command = str(payload.tool_input.command);
  if (event === 'PostToolUse' && isObj(payload.tool_response) && Array.isArray(payload.tool_response.structuredPatch)) {
    const hunks = payload.tool_response.structuredPatch.flatMap((h) => (isObj(h) ? hunkOf(h) : []));
    if (hunks.length) meta.hunks = hunks;
  }
  if ((event === 'PreToolUse' || event === 'PermissionRequest' || event === 'PostToolUse') && tool) {
    meta.call = { mode: str(payload.permission_mode), tool, input: isObj(payload.tool_input) ? payload.tool_input : {}, suggestions: Array.isArray(payload.permission_suggestions) ? payload.permission_suggestions : [] };
  }
  // A session on a version its agent's facts don't cover has its holds and every block but the floor watch-only. Only a reply that holds
  // or blocks reads the version here; the core reads it for every other hook, off the acknowledgement's path.
  const replies = event === 'Stop' || event === 'PermissionRequest' || (event === 'PreToolUse' && request.matched.length > 0);
  // An agent whose transcript names no version says it in the payload.
  const version = str(payload.agent_version) || (replies ? versionOf(meta.transcript) : undefined);
  if (version) meta.version = version;
  if (version && !coveredBy(agent, version)) meta.watchOnly = true;

  const facts = registry().get(name).facts as JsonObject;
  const rule = (facts.mapping as JsonObject)[request.event];
  let kind = isObj(rule) && typeof rule.kind === 'string' ? rule.kind : undefined;
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
    case 'user.ask': {
      // A Codex slash command is no prompt (#1022): a reading naming it, which opens no ask and bounds no turn.
      const command = name === 'codex' ? CODEX_COMMAND.exec(str(payload.prompt).trim())?.[0] : undefined;
      if (command) {
        meta.event = SLASH_COMMAND;
        meta.reading = `${request.event}: the slash command ${command}`;
        return { kind: 'hook', drafts: [], meta };
      }
      // Where the prompt came from is the core's to read, from the transcript entry it joins to.
      data = { msg: 0, text: scrub(str(mapped.text ?? payload.prompt)), tasks: [], from: FROM.includes(str(mapped.from)) ? mapped.from : 'unknown' };
      fill = 'msg';
      if (mapped.disposition === 'handled') {
        data.disposition = 'handled';
        v = 2;
      }
      break;
    }
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
        // The tool's own name: Codex's call has it as `name` beside the payload's full `tool`, Claude Code's as `tool`.
        const named = str(call.name) || str(call.tool) || tool || 'unknown';
        Object.assign(data, { server, tool: named });
        if (kind === 'tool.before') Object.assign(data, countMcp(server, named, meta.cwd, plant === 'unknown-tool-read' ? 'read' : 'change', plant === 'trusts-hints'));
      }
      if (kind === 'tool.before') {
        // A call names the guard entries deep-hook matched, so a watched match is recorded; one deep-hook let
        // through because the hub was late is marked late.
        if (request.late === true) Object.assign(data, { late: true, matched: request.matched });
        else if (request.matched.length) data.matched = request.matched;
        // A fetch names the host its URL names, never its path or query, for the line that says what a turn does (#2021).
        const url = callKind === 'fetch' ? str(at(payload, 'tool_input.url')) : '';
        const host = url && URL.canParse(url) ? scrub(new URL(url).hostname) : '';
        if (host) data.host = host.slice(0, 253);
        // Only a fetch that names its host needs the version that has the field.
        v = host ? 4 : 3;
      } else {
        Object.assign(data, failure(mapped.outcome === 'failed', payload, callKind, meta.cwd));
        v = 2;
        // The agent's own record of the calls this one made: incomplete stays incomplete.
        if (isObj(mapped.nested) && typeof mapped.nested.complete === 'boolean') {
          data.nested = { complete: mapped.nested.complete, ...(Number.isSafeInteger(mapped.nested.calls) ? { calls: mapped.nested.calls } : {}) };
          v = 3;
        }
        // What the target said first when it failed, scrubbed and clamped: the receipt quotes it, never the agent's words.
        const said = mapped.outcome === 'failed' ? [...scrub(errorLine(str(payload.error)))] : [];
        if (said.length) {
          data.error = said.length > ERROR_LINE ? `${said.slice(0, ERROR_LINE - 1).join('')}…` : said.join('');
          v = 4;
        }
        // An MCP call's arguments as a hash, never the arguments, so a repeat is read by its tool and arguments (#2019).
        if (callKind === 'mcp' && isObj(payload.tool_input)) {
          data.args = sha256Hex(canonicalize(payload.tool_input as JsonValue));
          v = 5;
        }
        // The pull request a `gh pr create` call opened, from the call's own response (#83): only a call that is that
        // one command counts, so an echoed URL never passes for the one gh printed. Read here for both agents, since a
        // Codex session's rollout is never read.
        if (callKind === 'shell' && typeof call.command === 'string' && isPrCreate(call.command)) {
          const url = prUrlIn(typeof payload.tool_response === 'string' ? payload.tool_response : JSON.stringify(payload.tool_response ?? ''));
          if (url) meta.pr = url;
        }
        if (callKind === 'shell' && typeof call.command === 'string' && mapped.outcome !== 'failed') {
          const response = payload.tool_response;
          meta.ran = { command: call.command, stdout: typeof response === 'string' ? response : isObj(response) && typeof response.stdout === 'string' ? response.stdout : '' };
          meta.ran.stdout = meta.ran.stdout.slice(0, 65_536);
        }
        // All a shell call printed, failed or not, where a started session's own sandbox says what it refused (#1330).
        if (callKind === 'shell') {
          const response = payload.tool_response;
          const parts = typeof response === 'string' ? [response] : isObj(response) ? [response.stdout, response.stderr, response.output] : [];
          const printed = [...parts, payload.error].filter((p): p is string => typeof p === 'string' && p !== '').join('\n').slice(0, 65_536);
          if (printed) meta.printed = printed;
        }
      }
      const loop = loopFact(name, tool, event, payload, typeof data.command === 'string' ? data.command : scrub(str(at(payload, 'tool_input.description')) || tool));
      if (loop) meta.loop = loop;
      // A patch the adapter can't read is denied before it runs (#39), unless the session's version is past its facts.
      if (kind === 'tool.before' && typeof mapped.denied === 'string') {
        const past = versionOf(meta.transcript);
        if (past && !coveredBy(agent, past)) meta.watchOnly = true;
        else meta.denied = mapped.denied;
      }
      break;
    }
    case 'session.compact':
    case 'subagent.start':
    case 'turn.interrupted': {
      // What Codex says beside a turn is a reading, which is no event of its turn: it names the hook it came from.
      const said = kind === 'turn.interrupted' ? 'you interrupted this turn' : kind === 'subagent.start' ? `subagent ${str(payload.agent_id) || 'unknown'} (${str(mapped.type) || 'unknown'}) started` : `the context compacts (${str(mapped.trigger) || 'unknown'})`;
      meta.reading = `${request.event}: ${scrub(said)}`;
      return { kind: 'hook', drafts: [], meta };
    }
    case 'agent.stop':
      // A Codex subagent's hooks carry the root's session ID with an agent_id: its stop is the child's (#39), no turn of the root's.
      if (name === 'codex' && request.event === 'SubagentStop') {
        data = { turn: 0, did_work: false, claim: false, outcome: 'finished', cause: 'unknown', usage: null, child: str(payload.agent_id) || 'unknown' };
        v = 5;
        break;
      }
      // The turn's cause is read from the payload here; the core reads the turn's transcript records, its usage and its loop.
      // Whether it is a claim is the core's stop rule's to read.
      data = { turn: 0, did_work: false, claim: false, outcome: mapped.outcome === 'failed' ? 'failed' : 'finished', cause: STOP_CAUSES.includes(str(mapped.cause)) ? mapped.cause : 'unknown', usage: null };
      // A child session's stop (a subagent's) names the child, from the payload field the facts' common template maps
      // to `subagent`: it is no turn end of the session, so it takes no number from the session's turns, and the core
      // and the hub leave it out of them.
      if (str(mapped.subagent)) data.child = str(mapped.subagent);
      else fill = 'turn';
      v = 5;
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
    case 'session.attention':
      // What a hook says of its session's state (#992): waiting on you, at work again, or its turn over. A value the
      // facts don't list maps to no event, so it says nothing.
      if (!ATTENTION.includes(str(mapped.state))) return { kind: 'hook', drafts: [], meta };
      // The planted adapter opens an ask from a notification.
      if (plant === 'ask-from-notification' && request.event === 'Notification') {
        kind = 'permission.request';
        data = { kind: 'question', tool: 'Notification' };
        break;
      }
      data = { state: mapped.state };
      v = 2;
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
  // A Codex question card fires PreToolUse and no permission hook, so it is caught here: the call, and its request (#39).
  const questions = ((facts.questionTools as JsonObject).tools ?? []) as JsonValue[];
  if (name === 'codex' && kind === 'tool.before' && questions.includes(tool)) {
    const asked: Draft = { kind: 'permission.request', v: 1, id: derivedId(draft.ts, `${request.id}.question`), ts: draft.ts, seq: request.seq, data: { kind: 'question', tool } };
    if (handle) asked.subject = `session:${handle}`;
    return { kind: 'hook', drafts: [draft, asked], meta };
  }
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

/** The most characters of a failed call's error line the record keeps (tool.after@4's `error`). */
const ERROR_LINE = 300;
/**
 * A failure's first error line from its target (#2029), which an allowed step's receipt quotes: the agent's own
 * "Exit code N" line left out and whitespace runs made one space; the first line that reads as an error (git's `!`,
 * `error:`, `fatal:`, an exception's name), else the first line.
 */
function errorLine(error: string): string {
  const lines = error.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const own = /^Exit code \d+$/.test(lines[0] ?? '') ? lines.slice(1) : lines;
  return own.find((l) => /^(!|error\b|fatal\b|\w*(Error|Exception)\b)/i.test(l)) ?? own[0] ?? '';
}

/** The loop fact a tool hook carries, by the agent's loop facts: wake-ups and crons once they ran, background subagents and commands, and monitors' watches. */
export function loopFact(name: string, tool: string, event: string, payload: JsonObject, what: string): HookMeta['loop'] {
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
  const call = String(payload.tool_use_id ?? '');
  const background = isObj(facts.background) ? facts.background[tool] : undefined;
  if (typeof background === 'string' && at(payload, background) === true) return { background: 'subagent', call, what };
  const command = isObj(facts.commands) ? facts.commands[tool] : undefined;
  if (typeof command === 'string' && at(payload, command) === true) return { background: 'command', call, what };
  // A watch whose events wake the session (#997): looping until a stop call names it, or it ends.
  const monitor = isObj(facts.monitors) ? facts.monitors[tool] : undefined;
  if (isObj(monitor)) {
    const id = at(payload, String(monitor.id));
    const timeout = at(payload, String(monitor.timeoutMs));
    if (typeof id === 'string' && id) return { monitor: id, what, command: str(at(payload, String(monitor.command))), timeout: typeof timeout === 'number' && timeout > 0 ? timeout : null };
  }
  const stop = isObj(facts.stops) ? facts.stops[tool] : undefined;
  if (isObj(stop)) return { stopped: String(at(payload, String(stop.id)) ?? '') };
  return undefined;
}

/**
 * The tool a Claude-shaped payload's own fields name (#993): Cursor's carries cursor_version, Grok's transcript sits
 * under ~/.grok, Claude Code's under its projects folder. Undefined when they name none.
 */
function payloadCaller(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.cursor_version === 'string') return 'cursor';
  const transcript = str(payload.transcript_path);
  if (/[\\/]\.grok[\\/]/.test(transcript)) return 'grok';
  if (/[\\/]\.claude[\\/]projects[\\/]/.test(transcript)) return 'claude-code';
  return undefined;
}
