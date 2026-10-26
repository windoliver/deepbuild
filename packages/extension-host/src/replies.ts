// Hook replies (#350): what one handler may give, checked before anything of it reaches the agent, and the join of
// every handler's reply into the one reply a hook gets. A handler adds context for the agent, denies the call with a
// reason, or gives nothing. A package inside DeepBuild's signed release gives its words as text; any other package
// only fills the templates its manifest declares, with typed values: handles, numbers, values from a closed list and
// its own name. Anything else in a reply is recorded as failed, and none of that reply reaches the agent.
import { joinHookReplies, parseHandle, type HookContribution, type JoinedHookReply } from '@deepbuild/contracts';

/** A hook context template, as hook.template@1 declares one in a manifest's `templates`. */
export interface Template {
  name: string;
  hook: string;
  text: string;
  fields: Record<string, { type: 'handle' | 'number' | 'name' } | { type: 'one_of'; values: string[] }>;
}
export interface Replier { id: string; firstParty: boolean; templates: readonly Template[] }
export type Checked = { ok: true; context: string[]; deny?: { reason: string } } | { ok: false; reason: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A handle's id that carries no words: a record's ULID or a definition's SHA-256. */
const BARE_ID = /^(?:[0-7][0-9A-HJKMNP-TV-Z]{25}|[0-9a-f]{64})$/;

/** Whether a value is of a field's type; `id` is the replying extension's own name. */
function typed(field: Template['fields'][string], value: unknown, id: string): boolean {
  switch (field.type) {
    case 'handle': {
      // No fragment: a fragment is a name, and a name could carry words to the agent.
      if (typeof value !== 'string') return false;
      try {
        const handle = parseHandle(value);
        return handle.fragment === undefined && BARE_ID.test(handle.id);
      } catch {
        return false;
      }
    }
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'name': return value === id;
    case 'one_of': return typeof value === 'string' && field.values.includes(value);
    default: return false;
  }
}

/**
 * An outside package's context or deny: `{ template, values }`, a template its manifest declares for this hook, each
 * of its fields given a value of its type and nothing else. `unchecked` is the planted pass-through host (AC2's wrong
 * program), which fills the text with whatever values it was given.
 */
function fill(r: Replier, hook: string, what: string, part: unknown, unchecked: boolean): { text: string } | { reason: string } {
  if (!isObject(part) || typeof part.template !== 'string' || !isObject(part.values)) return { reason: `${r.id}'s ${what} isn't { template, values } filling a template its manifest declares` };
  const template = r.templates.find((t) => t.name === part.template && t.hook === hook);
  // A failure names only what the manifest declares, never a name the reply chose.
  if (!template) return { reason: `${r.id}'s ${what} names no ${hook} template its manifest declares` };
  const values = part.values;
  for (const name of Object.keys(values)) if (!Object.hasOwn(template.fields, name)) return { reason: `${r.id}'s ${what} gives a field its template ${template.name} doesn't have` };
  for (const [name, field] of Object.entries(template.fields)) {
    if (!Object.hasOwn(values, name)) return { reason: `${r.id}'s ${what} leaves out the field ${name} of its template ${template.name}` };
    if (!unchecked && !typed(field, values[name], r.id)) return { reason: `${r.id}'s ${what}: the field ${name} of its template ${template.name} takes a ${field.type}, and it was given something else` };
  }
  return { text: template.text.replace(/\{([^{}]*)\}/g, (_, name: string) => String(values[name])) };
}

/** One handler's reply: context, a deny with its reason, or nothing; any other field fails the whole reply. */
export function checkReply(r: Replier, hook: string, reply: unknown, unchecked = false): Checked {
  if (reply === null || reply === undefined) return { ok: true, context: [] };
  if (!isObject(reply)) return { ok: false, reason: `${r.id}'s reply isn't context or a deny` };
  for (const key of Object.keys(reply)) if (key !== 'context' && key !== 'deny') return { ok: false, reason: `${r.id}'s reply carries a field besides context and deny: a handler can only add context or deny` };
  const context: string[] = [];
  let deny: { reason: string } | undefined;
  if (reply.context !== undefined) {
    if (r.firstParty) {
      if (typeof reply.context !== 'string') return { ok: false, reason: `${r.id}'s context isn't text` };
      context.push(reply.context);
    } else {
      const filled = fill(r, hook, 'context', reply.context, unchecked);
      if ('reason' in filled) return { ok: false, reason: filled.reason };
      context.push(filled.text);
    }
  }
  if (reply.deny !== undefined) {
    if (r.firstParty) {
      const d = reply.deny;
      if (!isObject(d) || Object.keys(d).some((k) => k !== 'reason') || typeof d.reason !== 'string' || !d.reason) return { ok: false, reason: `${r.id}'s deny isn't { reason } with its reason` };
      deny = { reason: d.reason };
    } else {
      const filled = fill(r, hook, 'deny reason', reply.deny, unchecked);
      if ('reason' in filled) return { ok: false, reason: filled.reason };
      deny = { reason: filled.text };
    }
  }
  return { ok: true, context, ...(deny ? { deny } : {}) };
}

/** The planted wrong joins AC8 names; tests only. */
export type JoinPlant = 'join-by-id-alone' | 'cut-in-join-order';

/** The replies joined in their fixed order (contracts' joinHookReplies), or as a planted wrong join does it. */
export function join(contributions: HookContribution[], bound: number, plant?: JoinPlant): JoinedHookReply {
  if (plant === 'join-by-id-alone') return joinHookReplies(contributions.map((c) => ({ ...c, firstParty: false })), bound);
  const joined = joinHookReplies(contributions, bound);
  if (plant !== 'cut-in-join-order') return joined;
  // Fills the room block by block in join order: the first that doesn't fit is cut, and the rest get none.
  const byId = new Map(contributions.map((c) => [c.extension, c]));
  let room = joined.bound;
  const context: JoinedHookReply['context'] = [];
  for (const id of joined.order) {
    for (const text of byId.get(id)?.context ?? []) {
      const kept = [...text].slice(0, room).join('');
      room -= [...kept].length;
      if (kept) context.push({ extension: id, text: kept });
    }
  }
  return { ...joined, context };
}
