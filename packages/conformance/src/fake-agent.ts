// The adapter kit's fake agent: a small agent that speaks what DeepBuild drives (a turn, a steer, a follow-up,
// an interrupt, a response, the history and a permission answer) with no provider behind it, plus its facts
// file. The clean fill has every fault off; each broken fake turns exactly one on.
import { factsAdapter } from '@deepbuild/adapters';
import type { AdapterEvent, DoctorItem, JsonObject } from '@deepbuild/adapters';
import type { JsonValue } from '@deepbuild/contracts';
import { isObject } from './types.js';
import type { Delivery, Driven, Fill, Flag, Operation } from './types.js';

export const AGENT = 'fake';
export const VERSION = '1.0.0';
export const SURFACE = 'app-server';

/** The faults a fake plants; the clean agent has none. Each name is the fake that carries it. */
export interface Faults {
  // The adapter rules.
  parentOwnsSubagent?: boolean;
  duplicateId?: boolean;
  clockStepsBack?: boolean;
  reopenAfterStop?: boolean;
  quietReportsFinished?: boolean;
  dropThread?: boolean;
  otherSessionDelivery?: boolean;
  allowFromSuggestion?: boolean;
  unparsedStopCause?: boolean;
  noSign?: boolean;
  // Declared items.
  dropKind?: string;
  unsupportedFlag?: Flag;
  ignoreAnswer?: boolean;
  startTurnOtherSession?: boolean;
  steerOtherTurn?: boolean;
  followUpImmediate?: boolean;
  steerOutlivesInterrupt?: boolean;
  respondOtherAsk?: boolean;
  historyEmpty?: boolean;
}

const section = (readBy: string, conformance: string, rest: JsonObject = {}): JsonObject => ({ readBy, conformance, ...rest });
const payload = (required: Record<string, string>, optional: Record<string, string> = {}): JsonObject => ({ required: { session_id: 'string', hook_event_name: 'string', ...required }, optional: { prompt_id: 'string', agent_id: 'string', ...optional } });

/** The fake agent's facts (adapter.facts@1): one version, the hooks it fires, and how each maps. */
function fakeFacts(): JsonValue {
  return {
    schema: 'adapter.facts@1',
    versions: [VERSION],
    agent: AGENT,
    hookTimeouts: section('a hold waits no longer than the agent lets a hook run', 'fake/hookTimeouts/hold-within-timeout', { defaultMs: 60000, perHook: { Stop: 600000 } }),
    continuation: section('a stop hold continues a turn only while the payload says no stop hook already did', 'fake/continuation/stop-hook-active', { field: 'stop_hook_active' }),
    launch: section('how the fake agent starts headless', 'fake/launch/flags', { session: { args: ['--fake'] }, readOnlyJob: { args: ['--fake', '--read-only'], prompt: 'stdin' } }),
    modelFamily: section('which rate card a model name belongs to', 'fake/modelFamily/known-names', { families: { 'fake-model': 'fake' } }),
    billing: section('whether a session bills a plan or an API account', 'fake/billing/api-key-variables', { apiKeyVariables: ['FAKE_API_KEY'] }),
    usage: section('every run prints its cost', 'fake/usage/counting', { cost: 'unpriced', costFrom: 'nothing: the fake agent prices nothing', tokens: 'assistant entries\' usage' }),
    questionTools: section('which tool calls are questions to the person', 'fake/questionTools/question-is-a-request', { tools: ['AskUser'] }),
    transcripts: section('a run keeps its session\'s own transcript', 'fake/transcripts/folder', { home: ['FAKE_HOME'], path: '{session}.jsonl' }),
    appLinks: section('Open on a session\'s row', 'fake/appLinks/open', { open: 'none' }),
    errorTexts: section('a stop\'s cause from the texts the agent writes', 'fake/errorTexts/unknown-otherwise', { causes: {} }),
    events: section('the hooks the fake agent fires per version, with each payload\'s fields', 'fake/events/payloads', {
      versions: {
        [VERSION]: {
          SessionStart: payload({ source: 'string' }, { thread_id: 'string' }),
          UserPromptSubmit: payload({ prompt: 'string' }),
          PreToolUse: payload({ tool_name: 'string', tool_input: 'object', tool_use_id: 'string' }),
          PermissionRequest: payload({ tool_name: 'string', tool_input: 'object' }),
          PostToolUse: payload({ tool_name: 'string', tool_input: 'object', tool_response: 'any', tool_use_id: 'string' }),
          Stop: payload({}, { error: 'string' }),
          SessionEnd: payload({ reason: 'string' }),
        },
      },
    }),
    mapping: section('each hook payload maps to events by these entries', 'fake/mapping/explain', {
      common: { session: 'session_id', turn: 'prompt_id', subagent: 'agent_id' },
      SessionStart: { kind: 'session.start', data: { source: 'source', thread: 'thread_id' } },
      UserPromptSubmit: { kind: 'user.ask', data: { text: 'prompt' } },
      PreToolUse: { kind: 'tool.before', data: { call: 'tool_use_id', tool: 'tool_name' }, call: 'kind' },
      PermissionRequest: { kind: 'permission.request', data: { kind: '=tool', tool: 'tool_name' }, call: 'detail' },
      PostToolUse: { kind: 'tool.after', data: { call: 'tool_use_id', tool: 'tool_name', outcome: '=ok' } },
      Stop: { kind: 'agent.stop', data: { outcome: '=finished' }, stop: true },
      SessionEnd: { kind: 'session.end', data: { reason: 'reason' } },
    }),
    stop: section('each agent.stop names its cause from the closed set and carries its turn\'s usage', 'fake/stop/cause-and-usage', {
      turn: { payload: 'prompt_id', transcript: 'promptId', elsewhere: 'agent_id' },
      cause: { readBy: 'the payload\'s error names a cause; a value not listed is unknown', payload: { field: 'error', values: { rate_limit: 'rate_limited', signed_out: 'sign_in_required' } }, otherwise: 'unknown' },
      usage: { readBy: 'the turn\'s assistant entries\' usage', covers: 'turn', records: { match: { type: 'assistant' }, has: 'usage' }, take: 'sum', counts: { input: ['usage.input'], cached: ['usage.cached'], output: ['usage.output'] }, exact: true, model: { record: 'model' } },
    }),
    toolKinds: section('a tool call\'s kind by tool name', 'fake/toolKinds/unknown-otherwise', { tools: { Bash: 'shell', Read: 'read', Edit: 'edit' }, otherwise: 'unknown' }),
  };
}

/** The fake agent's doctor: one item, not checked, since no binary is looked for. */
const doctor = (): DoctorItem[] => [{ code: 'not_checked', level: 'skip', evidence: 'not checked: the fake agent has no binary', fix: 'Nothing: the fake agent is the kit\'s own.' }];

/** A ULID-shaped ID from a counter, so every run of the fake agent stamps the same IDs. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ulid = (n: number): string => {
  let tail = '';
  for (let rest = n, i = 0; i < 8; i++, rest = Math.floor(rest / 32)) tail = CROCKFORD[rest % 32] + tail;
  return `01K74FKZVK8Q2X5R7M${tail}`;
};

const RECENT_TURNS = 8;

type Turn = { id: string; open: boolean; events: AdapterEvent[]; steers: AdapterEvent[]; ask?: string };

/** A fill of the fake agent with the given faults; `revision` is the kit revision it declares. */
export function fakeFill(revision: number, faults: Faults = {}): Fill {
  const facts = fakeFacts();
  const stopped = new Map<string, Set<string>>();
  const base = factsAdapter(facts, {
    caps: { holdStop: true, wakeIdle: true, steer: true, followUp: true, answerPermission: true, nativeTools: true, mcp: false, rewrite: false, editInput: false, errorTurnHook: false, startTurn: true },
    unsupported: { [SURFACE]: [], cli: [] },
    doctor,
  });
  const adapter = {
    ...base,
    mapHook: (request: Parameters<typeof base.mapHook>[0], version: string, transcript?: readonly JsonValue[]) => {
      const mapped = base.mapHook(request, version, transcript);
      const payload = isObject(request.payload) ? request.payload : {};
      const session = String(payload.session_id ?? '');
      const turn = String(payload.prompt_id ?? '');
      let events = mapped.events.map((event) => ({ ...event, data: { ...event.data } }));
      if (faults.parentOwnsSubagent) events = events.map(({ data: { subagent: _dropped, ...data }, ...rest }) => ({ ...rest, data }));
      if (faults.dropThread) events = events.map(({ data: { thread: _dropped, ...data }, ...rest }) => ({ ...rest, data }));
      if (faults.unparsedStopCause) events = events.map((event) => (event.kind === 'agent.stop' && payload.error !== undefined && event.data.cause === 'unknown' ? { ...event, data: { ...event.data, cause: 'timed_out' } } : event));
      if (events.some((event) => event.kind === 'agent.stop')) (stopped.get(session) ?? stopped.set(session, new Set()).get(session)!).add(turn);
      if (faults.reopenAfterStop && payload.hook_event_name === 'PostToolUse' && stopped.get(session)?.has(turn)) {
        events = [{ agent: request.agent, kind: 'user.ask', data: { session, turn, from: 'unknown' }, rule: '/mapping/PostToolUse' }, ...events];
      }
      if (faults.dropKind) events = events.filter((event) => event.kind !== faults.dropKind);
      return { ...mapped, events };
    },
  };

  // The driven side: one clock, one ID counter, the turns per session.
  let clock = 1760013451123456789n;
  let counter = 0;
  const turns = new Map<string, Turn[]>();
  const numbered = new Map<string, number>();
  const stamp = (session: string, turn: string, kind: string, data: JsonObject, back = false): AdapterEvent => {
    clock += back ? -5000n : 1000n;
    counter += 1;
    return { agent: AGENT, kind, data: { session, turn, seq: String(clock), id: ulid(faults.duplicateId && counter % 2 === 0 ? counter - 1 : counter), ...data }, rule: `/driven/${kind}` };
  };
  const current = (session: string): Turn | undefined => turns.get(session)?.at(-1);
  const drive = (operation: Operation, input: JsonValue, session: string): Driven => {
    const reply = driven(operation, input, session);
    return reply.outcome === 'ok' && faults.dropKind ? { outcome: 'ok', events: reply.events.filter((event) => event.kind !== faults.dropKind) } : reply;
  };
  const driven = (operation: Operation, input: JsonValue, session: string): Driven => {
    if (faults.unsupportedFlag && operation === faults.unsupportedFlag) return { outcome: 'unsupported', operation, surface: SURFACE };
    const list = turns.get(session) ?? turns.set(session, []).get(session)!;
    const script = isObject(input) && typeof input.script === 'string' ? input.script : 'short';
    switch (operation) {
      case 'startTurn': {
        numbered.set(session, (numbered.get(session) ?? 0) + 1);
        const id = `turn_${String(numbered.get(session)).padStart(2, '0')}`;
        const turn: Turn = { id, open: true, events: [], steers: [] };
        list.push(turn);
        // The agent keeps its recent turns only, so a fill driven many times answers history in bounded time.
        if (list.length > RECENT_TURNS) list.shift();
        const where = faults.startTurnOtherSession ? `${session}_other` : session;
        const first = stamp(where, id, 'user.ask', { from: 'person', text: isObject(input) && typeof input.prompt === 'string' ? input.prompt : '' });
        const second = stamp(where, id, 'tool.before', { call: `call_${counter}`, tool: 'Read', kind: 'read' }, script === 'clock-back');
        // A clock that stepped back never stamps an event before its turn's first.
        if (!faults.clockStepsBack && BigInt(second.data.seq as string) < BigInt(first.data.seq as string)) { second.data.seq = first.data.seq as string; clock = BigInt(second.data.seq); }
        turn.events.push(first, second);
        if (script === 'question') {
          const ask = stamp(where, id, 'permission.request', { kind: 'question', tool: 'AskUser' });
          turn.ask = ask.data.id as string;
          turn.events.push(ask);
        } else if (script === 'short') {
          turn.events.push(stamp(where, id, 'tool.after', { call: `call_${counter}`, tool: 'Read', outcome: 'ok' }), stamp(where, id, 'agent.stop', { outcome: 'finished' }));
          turn.open = false;
        } else if (script === 'quiet' && faults.quietReportsFinished) {
          turn.events.push(stamp(where, id, 'agent.stop', { outcome: 'finished' }));
        }
        return { outcome: 'ok', events: [...turn.events] };
      }
      case 'steer': {
        const turn = current(session);
        if (!turn) return { outcome: 'ok', events: [] };
        const event = stamp(session, faults.steerOtherTurn ? `${turn.id}_other` : turn.id, 'turn.steered', { text: isObject(input) && typeof input.text === 'string' ? input.text : '' });
        turn.steers.push(event);
        turn.events.push(event);
        return { outcome: 'ok', events: [event] };
      }
      case 'followUp': {
        const turn = current(session);
        if (!turn) return { outcome: 'ok', events: [] };
        const event = stamp(session, turn.id, 'turn.followed_up', { after: faults.followUpImmediate ? '' : turn.id, text: isObject(input) && typeof input.text === 'string' ? input.text : '' });
        turn.events.push(event);
        return { outcome: 'ok', events: [event] };
      }
      case 'interrupt': {
        const turn = current(session);
        if (!turn || !turn.open) return { outcome: 'ok', events: [] };
        const events = [stamp(session, turn.id, 'turn.interrupted', {})];
        if (faults.steerOutlivesInterrupt && turn.steers.length) events.push(stamp(session, turn.id, 'turn.steered', { text: 'late' }));
        events.push(stamp(session, turn.id, 'agent.stop', { outcome: 'interrupted' }));
        turn.open = false;
        turn.events.push(...events);
        return { outcome: 'ok', events };
      }
      case 'respond': {
        const turn = current(session);
        const ask = isObject(input) && typeof input.ask === 'string' ? input.ask : turn?.ask ?? '';
        if (!turn) return { outcome: 'ok', events: [] };
        const event = stamp(session, turn.id, 'ask.answered', { ask: faults.respondOtherAsk ? `${ask}_other` : ask, text: isObject(input) && typeof input.text === 'string' ? input.text : '' });
        turn.events.push(event);
        return { outcome: 'ok', events: [event] };
      }
      case 'history':
        return { outcome: 'ok', events: faults.historyEmpty ? [] : list.flatMap((turn) => turn.events) };
      default:
        return { outcome: 'unsupported', operation, surface: SURFACE };
    }
  };
  const deliver = (answer: JsonValue, session: string): Delivery => {
    const where = faults.otherSessionDelivery ? `${session}_other` : session;
    if (faults.noSign) return { session: where, sign: null };
    if (faults.ignoreAnswer) return { session: where, sign: `ignored:${where}` };
    const request = isObject(answer) && isObject(answer.request) ? answer.request : {};
    const decision = faults.allowFromSuggestion && typeof request.suggestion === 'string' ? request.suggestion : isObject(answer) && typeof answer.decision === 'string' ? answer.decision : 'allow';
    return { session: where, sign: `delivered:${decision}:${where}` };
  };
  return { adapter, version: VERSION, revision, surface: SURFACE, drive, deliver };
}
