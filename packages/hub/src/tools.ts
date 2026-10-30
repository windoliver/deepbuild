// The deep_* tools deep mcp lists and the hub serves (#26): each one's input schema, in the subset the strict tool
// validators of the model APIs agents use take (every property required, an optional one nullable, no lengths or
// ranges), and the hub's strict check of a call's arguments against it. Their descriptions come from tools.json,
// which scripts/skill.mjs generates from the design's Building blocks table with the skill.
import { readFileSync } from 'node:fs';
import { refuse } from './wire.js';

type Obj = Record<string, unknown>;
type Schema = Obj;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (description?: string, pattern?: string): Schema => ({ type: 'string', ...(pattern ? { pattern } : {}), ...(description ? { description } : {}) });
const maybe = (schema: Schema): Schema => ({ ...schema, type: [schema.type as string, 'null'] });
const object = (properties: Record<string, Schema>): Schema => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const HANDLE = (scheme: string) => `^${scheme}:[0-9A-Za-z]+$`;

/** Each tool's input schema, by name, in the order deep mcp lists them. */
export const SCHEMAS: Readonly<Record<string, Schema>> = {
  deep_ask: object({
    kind: { type: 'string', enum: ['taste', 'choice', 'unblock'], description: 'taste or choice for a question; unblock for a task only a person can do.' },
    question: str('The one question, or the task, in a sentence.'),
    options: maybe({ type: 'array', items: object({ id: str(), label: str() }), description: 'A question\'s options; null for a task.' }),
    recommended: maybe(str('The option you recommend, by its id.')),
    steps: maybe({ type: 'array', items: str(), description: 'A task\'s steps, in order; null for a question.' }),
    where: maybe(str('Where the person does the task, such as their own terminal.')),
    why: maybe(str('What the task unblocks.')),
    check: maybe(str('The check in the repo\'s spec that will prove the task done. A task without one is refused.')),
    subject: maybe({
      ...object({
        point: maybe(str('A choice\'s requirement, by its handle (req:<id>).')),
        screen: maybe(str('A taste call\'s screen or journey step.')),
        element: maybe(str('A taste call\'s element, by its stable name.')),
      }),
      description: 'What the question is about, so your saved answer to it is reused whatever its wording; null when it is about none of these.',
    }),
  }),
  deep_wait: object({ ask: str('The ask, as deep_ask returned it.', HANDLE('ask')) }),
  deep_open_item: object({ text: str('What is still open, in a sentence.') }),
  deep_status: object({}),
  deep_search: object({ query: str('Words every hit must hold.') }),
  deep_claim: object({
    task_ref: str('The task: task:<id>, or the message that asked for it.', '^(task:[0-9A-Za-z]+|session:[0-9A-Za-z]+#[A-Za-z0-9][A-Za-z0-9._-]*)$'),
    attempt: { type: 'integer', description: 'Which attempt at the task this is.' },
    commit: str('The commit the work is at, by its full SHA.', '^[0-9a-f]{40}$'),
    scope: { type: 'string', enum: ['session', 'child', 'task'] },
    predictions: maybe({ type: 'array', items: object({ check: str(), expects: { type: 'string', enum: ['passed', 'failed'] } }), description: 'What you expect each check to show, before it runs.' }),
  }),
  deep_evidence: object({
    path: str('A file in your working folder.'),
    kind: maybe(str('What the file is, such as screenshot.')),
    origin: maybe(str('Leave null: the file is stored with origin agent whatever this says, since origin comes from your connection.')),
  }),
  deep_run: object({ check: str('A check the repo\'s spec names.'), claim: maybe(str('The claim the run is for; null for your newest.', HANDLE('claim'))) }),
  deep_env: object({ action: { type: 'string', enum: ['up', 'down'], description: 'up brings your worktree\'s stack up and answers its leased ports; down takes it down.' } }),
  deep_propose: object({
    target: str('What the change is to, such as a wiki claim, wiki:<page>#<claim>, a rule, a check or a spec.'),
    change: str('The change, in your own words.'),
    evidence: maybe({ type: 'array', items: object({ at: str('A record handle, such as session:<id>#<message>.'), quote: str('The exact words there.') }), description: 'What the change rests on; null for none.' }),
  }),
};

let described: Record<string, string> | undefined;
/** Each tool's description, as scripts/skill.mjs generated it from the Building blocks table. */
export function descriptions(): Record<string, string> {
  return (described ??= JSON.parse(readFileSync(new URL('../tools.json', import.meta.url), 'utf8')) as Record<string, string>);
}

/**
 * The tools as deep mcp lists them. A tool tools.json doesn't describe isn't listed: only what the table generates
 * reaches an agent.
 */
export function toolList(): { name: string; description: string; inputSchema: Schema }[] {
  const text = descriptions();
  return Object.entries(SCHEMAS).filter(([name]) => text[name]).map(([name, inputSchema]) => ({ name, description: text[name]!, inputSchema }));
}

/**
 * A call's arguments held to its tool's schema, as strictly as the hub holds any request: a field it doesn't list, a
 * missing required one or a wrong type is refused at its path. A nullable field left out reads as null.
 */
export function checkArguments(tool: string, args: unknown): Obj {
  const schema = SCHEMAS[tool];
  if (!schema) throw refuse('not_found', '/params/tool', `Call one of the deep_* tools: ${Object.keys(SCHEMAS).join(', ')}.`, tool);
  return check(schema, args ?? {}, '/params/arguments') as Obj;
}
function check(schema: Schema, value: unknown, at: string): unknown {
  const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
  if (value === null || value === undefined) {
    if (types.includes('null')) return null;
    throw refuse('required', at, `Give ${at.split('/').pop()}; it is required.`, value);
  }
  const type = types.find((t) => t !== 'null')!;
  const wrong = () => refuse('type', at, `Give ${at.split('/').pop()} as ${type === 'array' ? 'a list' : type === 'object' ? 'an object' : `a ${type}`}.`, value);
  switch (type) {
    case 'object': {
      if (!isObj(value)) throw wrong();
      const properties = schema.properties as Record<string, Schema>;
      for (const key of Object.keys(value)) {
        if (!(key in properties)) throw refuse('unlisted_field', `${at}/${key}`, `Leave out ${key}: the schema lists only ${Object.keys(properties).join(', ') || 'no fields'}.`, key);
      }
      return Object.fromEntries(Object.entries(properties).map(([key, s]) => [key, check(s, value[key], `${at}/${key}`)]));
    }
    case 'array':
      if (!Array.isArray(value)) throw wrong();
      return value.map((item, i) => check(schema.items as Schema, item, `${at}/${i}`));
    case 'integer':
      if (!Number.isSafeInteger(value)) throw wrong();
      return value;
    case 'string': {
      if (typeof value !== 'string') throw wrong();
      const allowed = schema.enum as string[] | undefined;
      if (allowed && !allowed.includes(value)) throw refuse('enum', at, `Give one of ${allowed.join(', ')}.`, value);
      if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) throw refuse('pattern', at, `Give ${at.split('/').pop()} in the form ${schema.pattern}.`, value);
      return value;
    }
    default:
      throw wrong();
  }
}
