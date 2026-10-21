// The adapters' mapping from hook payloads to events, read from each agent's facts file
// (adapter.facts@1): a payload is checked against its version's strict payload schema
// (events.versions), then mapped by the facts' rules (mapping, toolKinds, patch, turnWithoutPrompt).
// Each event carries the JSON Pointer of the facts entry that decided it, for `deep explain`.
// Nothing here branches on an agent's name; a new agent fills a facts file.

const get = (value, path) => path.split('.').reduce((inner, key) => (inner && typeof inner === 'object' && Object.hasOwn(inner, key) ? inner[key] : undefined), value);
const typeOf = (value) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);
const escape = (key) => String(key).replaceAll('~', '~0').replaceAll('/', '~1');
const pointer = (...keys) => `/${keys.map(escape).join('/')}`;

/** The strict payload schema: listed fields with their types; an unlisted field is only a reading. */
function verify(schema, payload, version) {
  const readings = [];
  const perTool = schema.tools && Object.hasOwn(schema.tools, payload.tool_name) ? schema.tools[payload.tool_name] : {};
  const fields = { ...schema.required, ...schema.optional, ...perTool };
  for (const [path, types] of Object.entries(fields)) {
    const value = get(payload, path);
    if (value === undefined) { if (Object.hasOwn(schema.required ?? {}, path) || Object.hasOwn(perTool, path)) readings.push({ code: 'missing_field', field: path, version }); }
    else if (types !== 'any' && !types.split('|').includes(typeOf(value))) readings.push({ code: 'wrong_type', field: path, version });
  }
  const unverified = readings.length > 0;
  const known = new Set(Object.keys(fields).map((path) => path.split('.')[0]));
  for (const key of Object.keys(payload)) if (!known.has(key)) readings.push({ code: 'unknown_field', field: key, version });
  return { verified: !unverified, readings };
}

// Every path a patch's marker lines name, indented or not, resolved against the folder it runs in.
function patchPaths(text, cwd) {
  const cd = text.match(/(?:^|\s)cd\s+(?:'([^']+)'|"([^"]+)"|(\S+))\s*&&/);
  const base = cd ? resolvePosix(cwd, cd[1] ?? cd[2] ?? cd[3]) : cwd;
  const paths = [...text.matchAll(/^[ \t]*\*\*\*[ \t]*(?:Add File|Update File|Delete File|Move to)[ \t]*:[ \t]*(.+?)[ \t]*$/gm)].map((match) => resolvePosix(base, match[1]));
  return [...new Set(paths)].sort();
}
// An absolute path with . and .. folded; a relative one is taken from `base`, or kept as written when the
// payload names no folder. Symlinks are left alone.
function resolvePosix(base, path) {
  if (!path.startsWith('/') && typeof base !== 'string') return path;
  const out = [];
  for (const part of (path.startsWith('/') ? path : `${base}/${path}`).split('/')) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return `/${out.join('/')}`;
}

/** A data template: each value names a payload path, or `=text` for a constant; absent values drop out. */
function fill(template, payload) {
  const data = {};
  for (const [key, source] of Object.entries(template ?? {})) {
    const value = source.startsWith('=') ? source.slice(1) : get(payload, source);
    if (value !== undefined) data[key] = value;
  }
  return data;
}

// What a tool call is: its kind from the facts' table, and the command or paths that kind carries.
function call(facts, payload) {
  const kinds = facts.toolKinds;
  const tool = payload.tool_name;
  const patch = facts.patch;
  const command = get(payload, patch?.command ?? '');
  // A patch is a command that carries marker lines; a shell command that merely mentions apply_patch keeps its own kind.
  if (patch && typeof command === 'string' && (patch.tools.includes(tool) || new RegExp(patch.shell).test(command))) {
    const paths = patchPaths(command, payload.cwd);
    if (paths.length > 0 || patch.tools.includes(tool)) return { kind: 'edit', detail: { paths }, rule: pointer('patch') };
  }
  const prefix = Object.keys(kinds.prefixes ?? {}).find((start) => typeof tool === 'string' && tool.startsWith(start));
  if (prefix) {
    const [server, ...name] = tool.slice(prefix.length).split('__');
    // The MCP tool's own name goes under the field the facts' toolDetail.mcp names; `name` by default.
    return { kind: kinds.prefixes[prefix], detail: { server, [facts.toolDetail?.mcp?.tool ?? 'name']: name.join('__') }, rule: pointer('toolKinds', 'prefixes', prefix) };
  }
  const listed = Object.hasOwn(kinds.tools, tool);
  const kind = listed ? kinds.tools[tool] : kinds.otherwise;
  const detail = {};
  const commandPath = facts.toolDetail?.command && Object.hasOwn(facts.toolDetail.command, kind) ? facts.toolDetail.command[kind] : undefined;
  if (commandPath) detail.command = get(payload, commandPath);
  const pathField = facts.toolDetail?.paths && Object.hasOwn(facts.toolDetail.paths, tool) ? facts.toolDetail.paths[tool] : undefined;
  const path = pathField === undefined ? undefined : get(payload, pathField);
  // A path that isn't a string is a retyped field: verify() reads it, and the call carries no paths.
  if (typeof path === 'string') detail.paths = [resolvePosix(payload.cwd, path)];
  return { kind, detail, rule: listed ? pointer('toolKinds', 'tools', tool) : pointer('toolKinds', 'otherwise') };
}

// A prompt's origin: the first of the facts' rules that holds, either a prefix of the prompt text the
// agent's own app writes, or a field of the transcript entries the prompt joins to.
function origin(rule, payload, transcript) {
  const entries = rule.join ? transcript.filter((one) => get(one, rule.join.transcript) !== undefined && get(one, rule.join.transcript) === payload[rule.join.payload]) : [];
  const holds = ({ prompt, match }) => (prompt !== undefined ? typeof payload.prompt === 'string' && payload.prompt.startsWith(prompt)
    : match !== undefined && entries.some((entry) => Object.entries(match).every(([path, value]) => get(entry, path) === value)));
  const index = (rule.rules ?? []).findIndex(holds);
  return index < 0 ? { from: rule.otherwise, rule: pointer('mapping', 'UserPromptSubmit', 'origin', 'otherwise') }
    : { from: rule.rules[index].from, rule: pointer('mapping', 'UserPromptSubmit', 'origin', 'rules', index) };
}

// A turn no prompt started (a Codex goal's continuation): the user message that opens it in the
// rollout says what started it.
function startedBy(rule, turn, transcript) {
  const at = transcript.findIndex((entry) => get(entry, 'type') === rule.turnEntry && get(entry, rule.turnField) === turn);
  const opening = at < 0 ? undefined : transcript.slice(at + 1).find((entry) => get(entry, rule.messageRole.path) === rule.messageRole.value);
  const text = JSON.stringify(get(opening, rule.messageText) ?? '');
  const source = Object.keys(rule.values).find((marker) => text.includes(marker.replaceAll('"', '\\"')));
  return source ? { from: rule.values[source], rule: pointer('turnWithoutPrompt', 'values', source) } : { from: rule.otherwise, rule: pointer('turnWithoutPrompt', 'otherwise') };
}

// Where the turn a payload names lies in the transcript: from the first entry that carries its join value
// to the next entry that carries another. A payload carrying the `elsewhere` field ran in another
// transcript, so none of this one's entries is its turn.
function turnOf(turn, payload, transcript) {
  if (turn.elsewhere && payload[turn.elsewhere] !== undefined) return { start: 0, end: 0 };
  const value = payload[turn.payload];
  const start = value === undefined ? -1 : transcript.findIndex((entry) => get(entry, turn.transcript) === value);
  if (start < 0) return { start: 0, end: 0 };
  const after = transcript.slice(start + 1).findIndex((entry) => ![undefined, value].includes(get(entry, turn.transcript)));
  return { start, end: after < 0 ? transcript.length : start + 1 + after };
}

const holds = (entry, match) => Object.entries(match ?? {}).every(([path, value]) => get(entry, path) === value);

// A stop's cause from the closed set: the hook payload's error, then the turn's transcript error records,
// then its last rate-limit record, the first that names one; never the agent's text. Otherwise the facts'
// fallback, unknown.
function cause(rule, payload, entries) {
  const at = (...keys) => pointer('stop', 'cause', ...keys);
  const named = (values, value) => typeof value === 'string' && Object.hasOwn(values, value);
  const error = rule.payload && payload[rule.payload.field];
  if (rule.payload && named(rule.payload.values, error)) return { cause: rule.payload.values[error], rule: at('payload', 'values', error) };
  for (const entry of rule.errors ? entries.filter((one) => holds(one, rule.errors.match)) : []) {
    const value = get(entry, rule.errors.field);
    if (named(rule.errors.values, value)) return { cause: rule.errors.values[value], rule: at('errors', 'values', value) };
  }
  const limits = rule.rateLimits && entries.filter((one) => holds(one, rule.rateLimits.match)).at(-1);
  if (limits && get(limits, rule.rateLimits.reached) != null) {
    // The window spent resets last; a reached limit with no reset time is a plain rate limit.
    const { windows, used, resetsAt, toMs } = rule.rateLimits;
    const resets = windows.map((path) => get(limits, path)).filter((window) => get(window, used) >= 100 && Number.isInteger(get(window, resetsAt))).map((window) => get(window, resetsAt) * toMs);
    return resets.length ? { cause: 'plan_window_spent', plan_resets: Math.max(...resets), rule: at('rateLimits', 'spent') } : { cause: 'rate_limited', rule: at('rateLimits', 'withoutReset') };
  }
  return { cause: rule.otherwise, rule: at('otherwise') };
}

// A stop's usage by the facts' counting rules: the records of its turn, or of the session up to its turn's
// end, each counted once. A count its records don't carry is null and no records is null, never 0.
function usage(rule, payload, entries) {
  const kept = new Map();
  for (const entry of entries) {
    if (!holds(entry, rule.records.match) || get(entry, rule.records.has) === undefined || (rule.records.skip && holds(entry, rule.records.skip))) continue;
    const key = rule.records.once ? get(entry, rule.records.once) : kept.size;
    if (!kept.has(key)) kept.set(key, entry);
  }
  const records = rule.take === 'last' ? [...kept.values()].slice(-1) : [...kept.values()];
  if (!records.length) return null;
  // A path with a leading - is taken away, as Codex's cached tokens are from its input.
  const sum = (paths) => records.reduce((total, entry) => paths.reduce((inner, path) => {
    const value = get(entry, path.replace(/^-/, ''));
    return inner === null || typeof value !== 'number' ? null : inner + (path.startsWith('-') ? -value : value);
  }, total), 0);
  const count = (paths) => { const value = sum(paths); return value === null ? null : { value, exact: rule.exact }; };
  const last = records.at(-1);
  const model = rule.model.payload ? payload[rule.model.payload] : get(last, rule.model.record);
  const used = rule.contextFill ? sum(rule.contextFill.used) : null;
  const window = rule.contextFill && get(last, rule.contextFill.window);
  return {
    covers: rule.covers,
    model: typeof model === 'string' && model ? model : null,
    ...Object.fromEntries(['input', 'cached', 'output'].map((name) => [name, count(rule.counts[name])])),
    context_fill: typeof used === 'number' && typeof window === 'number' && window > 0 ? Math.min(1, used / window) : null,
    // No hook payload or transcript record carries a price, and no rate card is verified.
    cost: { usd: null, basis: 'unpriced' },
  };
}

function map(facts, payload, transcript) {
  const hook = payload.hook_event_name;
  const rule = facts.mapping[hook];
  const common = fill(facts.mapping.common, payload);
  const event = { kind: rule.kind, data: { ...common, ...fill(rule.data, payload) }, rule: pointer('mapping', hook) };
  if (rule.origin) {
    const found = origin(rule.origin, payload, transcript);
    Object.assign(event, { data: { ...common, from: found.from, ...fill(rule.data, payload) }, rule: found.rule });
  }
  if (rule.call) {
    const found = call(facts, payload);
    // `kind` takes the call's kind and all its detail; `detail` takes only the command or paths the call carries.
    const detail = rule.call === 'kind' ? { kind: found.kind, ...found.detail } : Object.fromEntries(Object.entries(found.detail).filter(([key]) => key === 'command' || key === 'paths'));
    Object.assign(event, { data: { ...event.data, ...detail }, rule: found.rule });
  }
  // A call of a tool the facts list as a question to the person is a request of kind question.
  const questions = facts.questionTools?.tools ?? [];
  if (rule.kind === 'permission.request' && questions.includes(payload.tool_name)) {
    Object.assign(event, { data: { ...event.data, kind: 'question' }, rule: pointer('questionTools', 'tools', questions.indexOf(payload.tool_name)) });
  }
  if (rule.stop) {
    const { start, end } = turnOf(facts.stop.turn, payload, transcript);
    const found = cause(facts.stop.cause, payload, transcript.slice(start, end));
    const counted = transcript.slice(facts.stop.usage.covers === 'session' ? 0 : start, end);
    const { rule: decided, ...named } = found;
    Object.assign(event, { data: { ...event.data, ...named, usage: usage(facts.stop.usage, payload, counted) }, rule: decided });
  } else if (rule.cause) {
    // A facts file without a stop section names a stop's cause from one payload field alone.
    const error = payload[rule.cause.field];
    const known = Object.hasOwn(rule.cause.values, error);
    Object.assign(event, { data: { ...event.data, cause: known ? rule.cause.values[error] : rule.cause.otherwise }, rule: pointer('mapping', hook, 'cause', known ? 'values' : 'otherwise', ...(known ? [error] : [])) });
  }
  return [event];
}

/**
 * Maps one hook payload as a live event of `version`. `turns` holds the turn IDs already seen in the
 * session, so a turn no prompt started opens with its user.ask once.
 * @returns {events, verified, readings} for the payload.
 */
export function mapHook({ facts, version, payload, transcript = [], turns = new Set() }) {
  const schemas = facts?.events?.versions?.[version];
  const hook = payload?.hook_event_name;
  if (!schemas) return { events: [], verified: false, readings: [{ code: 'version_not_covered', field: 'version', version }] };
  if (typeof hook !== 'string' || !Object.hasOwn(schemas, hook) || !Object.hasOwn(facts.mapping, hook)) return { events: [], verified: false, readings: [{ code: 'unknown_event', field: 'hook_event_name', version }] };
  const { verified, readings } = verify(schemas[hook], payload, version);
  const events = map(facts, payload, transcript);
  const turnRule = facts.turnWithoutPrompt;
  const turn = turnRule && payload[turnRule.payloadField];
  if (turnRule && turn !== undefined && !turns.has(turn)) {
    turns.add(turn);
    if (!turnRule.startedBy.includes(hook)) {
      const found = startedBy(turnRule, turn, transcript);
      events.unshift({ kind: 'user.ask', data: { ...fill(facts.mapping.common, payload), from: found.from, turn }, rule: found.rule });
    }
  }
  return { events, verified, readings };
}

/**
 * Replays one recorded session's payloads, in order, as live events of `version`.
 * @returns per payload {events, verified, readings}, and the session's {verified, readings}.
 */
export function replaySession({ facts, version, payloads, transcript = [] }) {
  const turns = new Set();
  const results = payloads.map((payload) => mapHook({ facts, version, payload, transcript, turns }));
  const readings = [];
  for (const reading of results.flatMap((result) => result.readings)) if (!readings.some((seen) => seen.code === reading.code && seen.field === reading.field)) readings.push(reading);
  return { payloads: results, verified: results.every((result) => result.verified), readings };
}
