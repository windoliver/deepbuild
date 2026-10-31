// The adapter contract (#312): one adapter per agent, each driven by its facts file (adapter.facts@1),
// held to the published shapes at registration, and a registry that maps a hook request through the
// adapter its agent names. No rule here reads an agent's name: the shipped adapters are facts files
// plus the parts that aren't data (caps, what they can't do, doctor, usage reading).
import { readFileSync } from 'node:fs';
import { ContractError, validate } from '@deepbuild/contracts';
import type { ContractIssue, JsonValue, Schema } from '@deepbuild/contracts';
import { mapHook as mapByFacts } from '../../../adapters/index.mjs';
import { claudeParts, codexParts, piParts } from './shipped.js';
import type { Adapter, AdapterParts, AdapterRegistry, Drift, JsonObject } from './types.js';

export type {
  Adapter, AdapterCaps, AdapterEvent, AdapterParts, AdapterRegistry, DoctorItem, Drift, HookRequestLine, JsonObject, Mapped, PermissionAnswer, Reading,
  Skill, StopCause, StopReading, TurnUsage, Unsupported,
} from './types.js';

const NAME = /^[a-z][a-z0-9-]*$/;
const OPERATIONS = ['readUsage', 'classifyStop', 'skills'] as const;
const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A refusal in error@1's shape, at the pointer into the adapter that names the field. */
function refuse(code: string, path: string, actual: unknown, remediation: string): ContractError {
  const text = typeof actual === 'string' ? actual : actual === undefined ? '' : JSON.stringify(actual) ?? String(actual);
  return new ContractError({ code, retryable: false, remediation, path, actual: text, evidence: [] });
}
/** The first refusal a published shape makes of `value`, re-rooted under `at`. */
function held(name: string, value: unknown, at: string): ContractError | undefined {
  const result = validate(name, value);
  if (result.ok) return undefined;
  const first = result.issues[0] as ContractIssue;
  return new ContractError({ ...first, path: at + first.path });
}

/** An adapter driven by its facts: the facts decide every event; no rule in it reads the agent's name. */
export function factsAdapter(facts: JsonValue, parts: AdapterParts): Adapter {
  // The turns already seen, per session (the payload field the facts' common template maps to `session`), so a turn
  // no prompt started opens its user.ask once; forgotten when a session.end is mapped, which needs the facts to list
  // the agent's SessionEnd (Codex's facts don't yet, #47).
  const sessionField = isObject(facts) && isObject(facts.mapping) && isObject(facts.mapping.common) ? facts.mapping.common.session : undefined;
  const turnsBySession = new Map<string, Set<unknown>>();
  const sessionOf = (payload: JsonObject): string => {
    const value = typeof sessionField === 'string' ? sessionField.split('.').reduce<unknown>((inner, key) => (isObject(inner) ? inner[key] : undefined), payload) : undefined;
    return typeof value === 'string' ? value : '';
  };
  const adapter: Adapter = {
    facts,
    caps: parts.caps,
    unsupported: parts.unsupported,
    doctor: parts.doctor,
    mapHook(request, version, transcript = []) {
      const payload = isObject(request.payload) ? request.payload : {};
      const session = sessionOf(payload);
      const turns = turnsBySession.get(session) ?? new Set<unknown>();
      const mapped = mapByFacts({ facts, version, payload, transcript: transcript as readonly Record<string, unknown>[], turns });
      // A stop names its cause from the closed set: one the facts gave no cause is unknown, never a pass.
      const events = mapped.events.map(({ kind, data, rule }) => ({
        agent: request.agent, kind, data: (kind === 'agent.stop' && data.cause === undefined ? { ...data, cause: 'unknown' } : data) as JsonObject, rule,
      }));
      if (events.some((event) => event.kind === 'session.end') || !turns.size) turnsBySession.delete(session);
      else turnsBySession.set(session, turns);
      return { events, verified: mapped.verified, readings: mapped.readings };
    },
  };
  for (const operation of OPERATIONS) if (parts[operation]) (adapter as unknown as Record<string, unknown>)[operation] = parts[operation];
  if (parts.permissionReply) adapter.permissionReply = parts.permissionReply;
  return adapter;
}

/** An empty registry: every adapter it holds passed the contract at registration. */
export function registry(): AdapterRegistry {
  const adapters = new Map<string, Adapter>();
  return {
    register(name, adapter) {
      if (typeof name !== 'string' || !NAME.test(name)) throw refuse('pattern', '/name', name, 'Name the adapter one lower-case word: ^[a-z][a-z0-9-]*$.');
      if (name === 'deep') throw refuse('enum', '/name', name, "deep is the hub's own writer; register the adapter under its agent's name.");
      if (adapters.has(name)) throw refuse('enum', '/name', name, 'One adapter fills a name once; register the second under another name.');
      if (!isObject(adapter) || !('facts' in adapter)) throw refuse('required', '/facts', undefined, 'Give the adapter its adapter.facts@1 data.');
      const failed = held(isObject(adapter.facts) && adapter.facts.schema === 'adapter.facts@2' ? 'adapter.facts@2' : 'adapter.facts@1', adapter.facts, '/facts') ?? held('adapter.caps@1', adapter.caps, '/caps') ?? held('adapter.unsupported@1', adapter.unsupported, '/unsupported');
      if (failed) throw failed;
      if (typeof adapter.doctor !== 'function') throw refuse('required', '/doctor', undefined, 'Give the adapter a doctor() that lists its checks, each ok, warn, fail or skip.');
      if (typeof adapter.mapHook !== 'function') throw refuse('required', '/mapHook', undefined, 'Give the adapter a mapHook(); factsAdapter() builds one from its facts.');
      const facts = adapter.facts as JsonObject;
      for (const operation of OPERATIONS) {
        if (adapter[operation] === undefined) continue;
        const section = facts[operation];
        if (!isObject(section)) throw refuse('required', `/facts/${operation}`, undefined, `An adapter that implements ${operation} names the operation in its facts, with its conformance case.`);
        if (typeof section.conformance !== 'string' || !section.conformance) throw refuse('required', `/facts/${operation}/conformance`, section.conformance, `${operation} ships only with its conformance case.`);
      }
      adapters.set(name, adapter);
    },
    names: () => [...adapters.keys()],
    get(name) {
      const adapter = adapters.get(name);
      if (!adapter) throw refuse('enum', '/name', name, `Register an adapter under ${JSON.stringify(name)} first.`);
      return adapter;
    },
    mapHook(request, version, transcript) {
      const adapter = adapters.get(request.agent);
      if (!adapter) throw refuse('enum', '/agent', request.agent, 'Send hooks from an agent whose adapter is registered.');
      const mapped = adapter.mapHook(request, version, transcript);
      return { ...mapped, events: mapped.events.map((event) => ({ ...event, agent: request.agent })) };
    },
  };
}

const ROOT = new URL('../../../', import.meta.url);
const readFacts = (file: string): JsonValue => JSON.parse(readFileSync(new URL(`adapters/${file}`, ROOT), 'utf8')) as JsonValue;

/** The shipped adapters, each its facts file plus the parts that aren't data, named by the facts' agent field. */
export function shipped(): AdapterRegistry {
  const reg = registry();
  for (const [file, parts] of [['claude-code.facts.json', claudeParts], ['codex.facts.json', codexParts], ['pi.facts.json', piParts]] as const) {
    const facts = readFacts(file);
    reg.register(String((facts as JsonObject).agent), factsAdapter(facts, parts));
  }
  return reg;
}

/** The type set a published schema node takes: `true` is every type; a $ref follows draft-07 definitions. */
function publishedTypes(node: unknown, root: Schema): Set<string> | 'any' {
  if (!isObject(node)) return 'any';
  if (typeof node.$ref === 'string') {
    const key = node.$ref.replace(/^#\/(definitions|\$defs)\//, '');
    const defs = root.definitions ?? root.$defs;
    return publishedTypes(isObject(defs) ? defs[key] : undefined, root);
  }
  if ('const' in node) return new Set([node.const === null ? 'null' : Array.isArray(node.const) ? 'array' : typeof node.const]);
  if (Array.isArray(node.enum)) return new Set(node.enum.map((v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)));
  const type = node.type;
  if (typeof type === 'string') return new Set([type === 'integer' ? 'number' : type]);
  if (Array.isArray(type)) return new Set(type.map((t) => (t === 'integer' ? 'number' : String(t))));
  return 'any';
}

/**
 * Where the facts' strict payload types for one hook of one version drift from the published schema:
 * a field either side has that the other lacks, one the schema requires that the facts leave optional
 * (or the reverse), or a type that differs. A hook the facts don't list is drift at hook_event_name.
 */
export function factsDrift(facts: JsonValue, version: string, hook: string, published: Schema): Drift[] {
  const versions = isObject(facts) && isObject(facts.events) && isObject(facts.events.versions) ? facts.events.versions : {};
  const hooks = isObject(versions[version]) ? versions[version] : {};
  const types = isObject(hooks[hook]) ? hooks[hook] : undefined;
  if (!types) return [{ field: 'hook_event_name', reason: `the facts list no ${hook} payload for version ${version}, so its types can't be checked` }];
  const factsRequired = isObject(types.required) ? types.required : {};
  const factsOptional = isObject(types.optional) ? types.optional : {};
  const factsFields: Record<string, string> = Object.fromEntries(Object.entries({ ...factsOptional, ...factsRequired }).map(([field, type]) => [field, String(type)]));
  const properties = isObject(published.properties) ? published.properties : {};
  const required = new Set(Array.isArray(published.required) ? published.required.map(String) : []);
  const drift: Drift[] = [];
  const typed = (field: string, node: unknown) => {
    const want = publishedTypes(node, published);
    const have = factsFields[field]!;
    if (want === 'any' || have === 'any') return;
    const got = new Set(have.split('|'));
    if (got.size !== want.size || [...want].some((t) => !got.has(t))) drift.push({ field, reason: `the published schema types it ${[...want].join('|')}, the facts ${have}` });
  };
  for (const [field, node] of Object.entries(properties)) {
    if (!(field in factsFields)) { drift.push({ field, reason: 'the published schema has it, the facts do not' }); continue; }
    typed(field, node);
    if (required.has(field) && !(field in factsRequired)) drift.push({ field, reason: 'the published schema requires it, the facts leave it optional' });
    if (!required.has(field) && field in factsRequired) drift.push({ field, reason: 'the facts require it, the published schema leaves it optional' });
  }
  // A dotted facts field (tool_input.command) is checked against the nested property it names, when the schema has one.
  for (const field of Object.keys(factsFields)) {
    if (!field.includes('.')) { if (!(field in properties)) drift.push({ field, reason: 'the facts list it, the published schema does not' }); continue; }
    const node = field.split('.').reduce<unknown>((inner, key) => (isObject(inner) && isObject(inner.properties) ? inner.properties[key] : undefined), published);
    if (node === undefined) drift.push({ field, reason: 'the facts list it, the published schema does not' });
    else typed(field, node);
  }
  return drift;
}
