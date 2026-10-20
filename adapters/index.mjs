// The adapters' mapping from hook payloads to events, read from each agent's facts file
// (adapter.facts@1): a payload is checked against its version's strict payload schema
// (events.versions), then mapped by the facts' rules (mapping, toolKinds, patch, turnWithoutPrompt).
// Each event carries the JSON Pointer of the facts entry that decided it, for `deep explain`.
// Nothing here branches on an agent's name; a new agent fills a facts file.

const get = (value, path) => path.split('.').reduce((inner, key) => (inner && typeof inner === 'object' ? inner[key] : undefined), value);
const typeOf = (value) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);
const escape = (key) => String(key).replaceAll('~', '~0').replaceAll('/', '~1');
const pointer = (...keys) => `/${keys.map(escape).join('/')}`;

/** The strict payload schema: listed fields with their types; an unlisted field is only a reading. */
function verify(schema, payload, version) {
  const readings = [];
  const fields = { ...schema.required, ...schema.optional, ...schema.tools?.[payload.tool_name] };
  for (const [path, types] of Object.entries(fields)) {
    const value = get(payload, path);
    if (value === undefined) { if (path in (schema.required ?? {}) || path in (schema.tools?.[payload.tool_name] ?? {})) readings.push({ code: 'missing_field', field: path, version }); }
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
function resolvePosix(base, path) {
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
  if (patch && typeof command === 'string' && (patch.tools.includes(tool) || new RegExp(patch.shell).test(command))) {
    return { kind: 'edit', detail: { paths: patchPaths(command, payload.cwd) }, rule: pointer('patch') };
  }
  const prefix = Object.keys(kinds.prefixes ?? {}).find((start) => tool?.startsWith(start));
  if (prefix) {
    const [server, ...name] = tool.slice(prefix.length).split('__');
    return { kind: kinds.prefixes[prefix], detail: { server, name: name.join('__') }, rule: pointer('toolKinds', 'prefixes', prefix) };
  }
  const kind = kinds.tools[tool] ?? kinds.otherwise;
  const detail = {};
  const commandPath = facts.toolDetail?.command?.[kind];
  if (commandPath) detail.command = get(payload, commandPath);
  const pathField = facts.toolDetail?.paths?.[tool];
  if (pathField) detail.paths = [get(payload, pathField)];
  return { kind, detail, rule: tool in kinds.tools ? pointer('toolKinds', 'tools', tool) : pointer('toolKinds', 'otherwise') };
}

// The transcript entry a prompt joins to, and the first of the facts' rules it matches names its origin.
function origin(rule, payload, transcript) {
  const otherwise = { from: rule.otherwise, rule: pointer('mapping', 'UserPromptSubmit', 'origin', 'otherwise') };
  if (!rule.join) return otherwise;
  const entry = transcript.find((one) => one[rule.join.transcript] !== undefined && one[rule.join.transcript] === payload[rule.join.payload]);
  const index = entry ? rule.rules.findIndex(({ match }) => Object.entries(match).every(([path, value]) => get(entry, path) === value)) : -1;
  return index < 0 ? otherwise : { from: rule.rules[index].from, rule: pointer('mapping', 'UserPromptSubmit', 'origin', 'rules', index) };
}

// A turn no prompt started (a Codex goal's continuation): the user message that opens it in the
// rollout says what started it.
function startedBy(rule, turn, transcript) {
  const at = transcript.findIndex((entry) => entry.type === rule.turnEntry && get(entry, rule.turnField) === turn);
  const opening = at < 0 ? undefined : transcript.slice(at + 1).find((entry) => get(entry, rule.messageRole.path) === rule.messageRole.value);
  const text = JSON.stringify(get(opening, rule.messageText) ?? '');
  const source = Object.keys(rule.values).find((marker) => text.includes(marker.replaceAll('"', '\\"')));
  return source ? { from: rule.values[source], rule: pointer('turnWithoutPrompt', 'values', source) } : { from: rule.otherwise, rule: pointer('turnWithoutPrompt', 'otherwise') };
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
    Object.assign(event, { data: { ...event.data, ...(rule.call === 'kind' ? { kind: found.kind } : {}), ...found.detail }, rule: found.rule });
  }
  if (rule.cause) {
    const error = payload[rule.cause.field];
    const known = error in rule.cause.values;
    Object.assign(event, { data: { ...event.data, cause: known ? rule.cause.values[error] : rule.cause.otherwise }, rule: pointer('mapping', hook, 'cause', known ? 'values' : 'otherwise', ...(known ? [error] : [])) });
  }
  return [event];
}

/**
 * Replays one recorded session's payloads, in order, as live events of `version`.
 * @returns per payload {events, verified, readings}, and the session's {verified, readings}.
 */
export function replaySession({ facts, version, payloads, transcript = [] }) {
  const schemas = facts?.events?.versions?.[version];
  const turns = new Set();
  const results = payloads.map((payload) => {
    const hook = payload?.hook_event_name;
    if (!schemas) return { events: [], verified: false, readings: [{ code: 'version_not_covered', field: 'version', version }] };
    if (!(hook in schemas) || !facts.mapping[hook]) return { events: [], verified: false, readings: [{ code: 'unknown_event', field: 'hook_event_name', version }] };
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
  });
  const readings = [];
  for (const reading of results.flatMap((result) => result.readings)) if (!readings.some((seen) => seen.code === reading.code && seen.field === reading.field)) readings.push(reading);
  return { payloads: results, verified: results.every((result) => result.verified), readings };
}
