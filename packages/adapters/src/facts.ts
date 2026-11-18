// What the package's two entries share (#2655): an adapter built from its facts, the facts files, and the shipped
// adapters loaded one at a time. Nothing here checks a registration, so nothing here loads a validator: index.ts
// registers in a registry that holds each adapter to the published shapes, unchecked.ts in one that checks nothing.
import { readFileSync } from 'node:fs';
import type { JsonValue } from '@deepbuild/contracts';
import { mapHook as mapByFacts } from '../../../adapters/index.mjs';
import { claudeParts, codexParts, paseoParts, piParts } from './shipped.js';
import type { Adapter, AdapterParts, AdapterRegistry, JsonObject } from './types.js';

/**
 * The agent names a hook request or a session.start may carry, to the adapter that maps them. Cursor's CLI and Grok
 * run the hooks in Claude Code's settings file (deep-hook names them from their own variables), so Claude Code's facts
 * read their payloads, but their events are recorded under their own agent, never as Claude Code's.
 */
export const ADAPTERS: Readonly<Record<string, string>> = { 'claude-code': 'claude', claude: 'claude', codex: 'codex', cursor: 'claude', grok: 'claude', pi: 'pi', paseo: 'paseo' };

export const OPERATIONS = ['readUsage', 'classifyStop', 'skills'] as const;
export const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

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
  if (parts.routeAtStart) adapter.routeAtStart = parts.routeAtStart;
  const { contextReply } = parts;
  if (contextReply) adapter.contextReply = (event, text) => contextReply(event, text, facts);
  return adapter;
}

const FACTS = new URL('../../../adapters/', import.meta.url);
/**
 * A shipped facts file by its name in the repo's adapters/ folder, such as `codex.facts.json` or `loops.facts.json`.
 * Every package reads the agents' facts through here, so one place decides where they live (tests/facts-entry.test.mjs).
 */
export function readFacts<T = JsonValue>(file: string): T {
  if (!/^[a-z][a-z0-9-]*(?:\.facts)?\.json$/.test(file)) throw Error(`${JSON.stringify(file)} is not a facts file in adapters/`);
  return JSON.parse(readFileSync(new URL(file, FACTS), 'utf8')) as T;
}

/**
 * The shipped adapters over `reg`. A reader of one agent need not parse every other agent's facts: each loads at its
 * first use, and `check` sees its file and facts before it registers.
 */
export function shippedIn(reg: AdapterRegistry, check: (name: string, file: string, facts: JsonValue) => void): AdapterRegistry {
  const pending = new Map<string, readonly [string, AdapterParts]>([
    ['claude', ['claude-code.facts.json', claudeParts]], ['codex', ['codex.facts.json', codexParts]],
    ['pi', ['pi.facts.json', piParts]], ['paseo', ['paseo.facts.json', paseoParts]],
  ]);
  const names = [...pending.keys()];
  const load = (name: string): void => {
    const entry = pending.get(name);
    if (!entry) return;
    const [file, parts] = entry;
    const facts = readFacts(file);
    check(name, file, facts);
    reg.register(name, factsAdapter(facts, parts));
    pending.delete(name);
  };
  return {
    names: () => [...names, ...reg.names().filter((name) => !names.includes(name))],
    get(name) { load(name); return reg.get(name); },
    register(name, adapter) { load(name); reg.register(name, adapter); },
    mapHook(request, version, transcript) { load(request.agent); return reg.mapHook(request, version, transcript); },
  };
}
