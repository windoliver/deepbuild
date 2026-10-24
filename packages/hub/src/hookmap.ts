// One line read off the socket, parsed: a hello or a method call is handed back as it is; a hook request is
// held to hook.request@2, mapped through its agent's adapter to its event, and kept to that kind's catalogue
// fields, its text scrubbed of every value the hub holds. Runs in the parser workers, off the event loop.
import { shipped, type AdapterRegistry, type HookRequestLine, type JsonObject } from '@deepbuild/adapters';
import { canonicalize, getSchema, sha256Hex, validate, type JsonValue } from '@deepbuild/contracts';
import { scrubText } from '@deepbuild/evidence';
import { refusal, type Draft, type HookMeta, type Parsed, type Plant } from './wire.js';

/** The agent names a hook request may carry, to the adapter that maps them. */
const ADAPTERS: Readonly<Record<string, string>> = { 'claude-code': 'claude', claude: 'claude', codex: 'codex' };
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
const registry = (): AdapterRegistry => (adapters ??= shipped());
/** The newest agent version an adapter's facts cover: a live hook is read as that version. */
function newest(name: string): string {
  const versions = ((registry().get(name).facts as JsonObject).events as JsonObject).versions as JsonObject;
  return Object.keys(versions).at(-1)!;
}

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
  const checked = validate('hook.request@2', value);
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
  const scrub = (text: string) => scrubText(text, { held });
  const meta: HookMeta = {
    id: request.id, agent: request.agent, event: request.event, session: str(payload.session_id), cwd: str(payload.cwd),
    transcript: str(payload.transcript_path), pid: request.pid, ppid: request.ppid,
  };
  if (str(payload.tool_use_id)) meta.toolUse = str(payload.tool_use_id);
  const tool = str(payload.tool_name);
  if (request.event === 'PreToolUse' && tool.startsWith('mcp__deep__')) meta.stamp = { tool: tool.slice('mcp__deep__'.length), digest: sha256Hex(canonicalize((payload.tool_input ?? null) as JsonValue)) };
  if (plant === 'writer-from-payload' && typeof payload.writer === 'string') meta.payloadWriter = payload.writer;

  const facts = registry().get(name).facts as JsonObject;
  const rule = (facts.mapping as JsonObject)[request.event];
  const kind = isObj(rule) && typeof rule.kind === 'string' ? rule.kind : undefined;
  if (!kind) return { kind: 'hook', drafts: [], meta };
  const version = newest(name);
  const mapOne = (r: HookRequestLine) => registry().mapHook({ ...r, agent: name }, version).events.find((e) => e.kind === kind)?.data ?? {};
  // The event the hook names itself; a turn the facts open without a prompt waits for the core, which sees a session's events in order.
  const mapped = mapOne(request);
  let data: Record<string, unknown> | undefined;
  let fill: Draft['fill'];
  let v = 1;
  switch (kind) {
    case 'session.start':
      data = { agent: request.agent, worktree: meta.cwd || '-', branch: null, thread: meta.session || '-' };
      // Which billing keys the agent had set, never their values.
      if (request.billing) {
        data.billing = request.billing;
        v = 2;
      }
      break;
    case 'session.end':
      data = { reason: str(payload.reason) || 'other' };
      break;
    case 'user.ask':
      data = { msg: 0, text: scrub(str(mapped.text ?? payload.prompt)), tasks: [], from: FROM.includes(str(mapped.from)) ? mapped.from : 'unknown' };
      fill = 'msg';
      break;
    case 'tool.before':
    case 'tool.after': {
      // A tool's kind, command and paths are read from its call, which the facts map on PreToolUse.
      const call = kind === 'tool.before' ? mapped : registry().mapHook({ ...request, agent: name, event: 'PreToolUse', payload: { ...payload, hook_event_name: 'PreToolUse' } }, version).events.find((e) => e.kind === 'tool.before')?.data ?? {};
      const callKind = TOOL_KINDS.includes(str(call.kind)) ? str(call.kind) : 'unknown';
      data = {
        kind: callKind, paths: Array.isArray(call.paths) ? call.paths.filter((p) => typeof p === 'string' && p) : [],
        command: typeof call.command === 'string' ? scrub(call.command) : null,
        ...(callKind === 'mcp' ? { server: str(call.server) || 'unknown', tool: str(call.name) || tool || 'unknown' } : {}),
      };
      // A call deep-hook let through because the hub was late names the guard entries it matched.
      if (kind === 'tool.before' && request.late === true) {
        Object.assign(data, { late: true, matched: request.matched });
        v = 2;
      }
      break;
    }
    case 'agent.stop':
      data = { turn: 0, did_work: false };
      fill = 'turn';
      break;
    case 'permission.request':
      data = {
        kind: ASKS.includes(str(mapped.kind)) ? mapped.kind : 'tool',
        ...(str(mapped.tool) ? { tool: mapped.tool } : {}),
        ...(typeof mapped.command === 'string' ? { command: scrub(mapped.command) } : {}),
        ...(Array.isArray(mapped.paths) ? { paths: mapped.paths.filter((p) => typeof p === 'string' && p) } : {}),
      };
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
