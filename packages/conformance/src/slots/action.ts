// The action@1 kit (#349, for #350's deep.registerAction): an action is `deep.registerAction(name, { declares, input },
// fn)`. The host holds the declaration at registration (a name the manifest lists, `declares` read, change or send,
// an input JSON Schema it can check) and runs fn only on input the schema admits, handing what it returns to the
// caller as JSON. The kit holds the same on a fill: its declaration, its schema, and that each case the schema admits
// comes back as JSON; a case the schema refuses is never run, as the host never runs it. What read, change and send
// each permit, the ask a change or send needs first, and the schema keywords the host refuses because its validator
// would skip them (it is the stricter side at registration), are the host's rules, not judged here.
import { registry, type JsonValue, type Schema } from '@deepbuild/contracts';
import type { Random } from '../generator.js';
import { fail } from '../slot-types.js';
import type { Fixture, PlantedFill, SlotCase, SlotFill, SlotKitImpl, SlotRule } from '../slot-types.js';
import { word } from './shared.js';

export const ACTION = 'action@1';

export interface ActionTarget { handle: string; version: string }
export interface ActionFill extends SlotFill {
  slot: 'action@1';
  name: string;
  declares: 'read' | 'change' | 'send';
  input: Schema;
  run(input: unknown, ctx: { target: ActionTarget }): unknown;
}
/** A case: the call's input, and the target the host hands the action. */
interface Input { call: JsonValue; target: ActionTarget }

const RULES = {
  declares: { id: 'declares-read-change-or-send', rule: 'An action declares what it does, read, change or send; the host refuses any other word at registration.', message: 'declares neither read, change nor send' },
  schema: { id: 'input-is-a-checkable-schema', rule: 'An action\'s input is a JSON Schema object the host can check, so a call outside it never runs.', message: 'gives no input schema the host can check' },
  output: { id: 'output-is-json', rule: 'An action run on input its schema admits returns JSON: what the caller gets is what the action returned.', message: 'returned something other than JSON' },
};
const rules: SlotRule[] = Object.values(RULES).map(({ id, rule }) => ({ id, rule }));

const INPUT: Schema = { type: 'object', properties: { count: { type: 'integer' } }, required: ['count'], additionalProperties: false } as unknown as Schema;
type Fault = 'none' | 'declares-write' | 'no-schema' | 'not-json';
function reference(fault: Fault = 'none'): ActionFill {
  return {
    slot: ACTION, revision: 1, name: 'ext.kit.count',
    declares: (fault === 'declares-write' ? 'write' : 'read') as ActionFill['declares'],
    input: (fault === 'no-schema' ? 'object' : INPUT) as Schema,
    run(input, ctx) {
      const { count } = input as { count: number };
      return fault === 'not-json' ? { count, target: ctx.target.handle, at: () => Date.now() } : { count, target: ctx.target.handle };
    },
  };
}

const plant = (name: string, breaks: keyof typeof RULES, codes: string[], fill: ActionFill): PlantedFill<ActionFill> => ({ name, message: RULES[breaks].message, codes, breaks: RULES[breaks].id, fill });
const plantedFills = (): PlantedFill<ActionFill>[] => [
  plant('declares-write', 'declares', ['declares_unknown'], reference('declares-write')),
  plant('input-not-a-schema', 'schema', ['schema_unreadable'], reference('no-schema')),
  plant('output-not-json', 'output', ['output_not_json'], reference('not-json')),
];

const toCase = (id: string, part: 'fixed' | 'seeded', input: Input): SlotCase => ({ id, part, input: input as unknown as JsonValue, expected: null });
const fixtures: Fixture[] = [
  toCase('count-one', 'fixed', { call: { count: 1 }, target: { handle: 'ext:deepbuild/kit', version: '1.0.0' } }),
  toCase('count-two-other-target', 'fixed', { call: { count: 2 }, target: { handle: 'ext:deepbuild/other', version: '2.0.0' } }),
  // Outside the reference's schema: the host never runs such a call, and neither does the kit.
  toCase('count-as-text', 'fixed', { call: { count: 'two' }, target: { handle: 'ext:deepbuild/kit', version: '1.0.0' } }),
].map(({ id, input, expected }) => ({ id, input, expected }));

/** Three calls from the draw: the count and the target vary. */
const generate = (random: Random): SlotCase[] => [0, 1, 2].map((i) =>
  toCase(`seeded-${i + 1}`, 'seeded', { call: { count: random.int(0, 1000) }, target: { handle: `ext:deepbuild/${word(random, 6)}`, version: `${random.int(1, 9)}.0.0` } }));

/** Whether a value is JSON as the caller receives it: no function, undefined, bigint, symbol or non-finite number anywhere. */
function isJson(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  if (typeof value === 'object') return Object.getPrototypeOf(value) === Object.prototype && Object.values(value as object).every(isJson);
  return false;
}

function* judge(fill: ActionFill, c: SlotCase): Generator<() => unknown, void, unknown> {
  const { call, target } = c.input as unknown as Input;
  if (!['read', 'change', 'send'].includes(fill.declares)) throw fail(RULES.declares.message, ['declares_unknown'], `${fill.name} declares ${JSON.stringify(fill.declares)}`);
  if (typeof fill.input !== 'object' || fill.input === null || Array.isArray(fill.input)) throw fail(RULES.schema.message, ['schema_unreadable'], `${fill.name}'s input is ${JSON.stringify(fill.input)}, not a schema object`);
  let schemas: ReturnType<typeof registry>;
  try {
    schemas = registry([{ name: fill.name, schema: fill.input }]);
    schemas.validate(fill.name, {});
  } catch (e) {
    throw fail(RULES.schema.message, ['schema_unreadable'], `${fill.name}'s input schema can't be read: ${e instanceof Error ? e.message : String(e)}`);
  }
  // A call the schema refuses never reaches the action: the host refuses it first.
  if (!schemas.validate(fill.name, call).ok) return;
  const output = yield () => fill.run(structuredClone(call), { target: { ...target } });
  if (!isJson(output)) throw fail(RULES.output.message, ['output_not_json'], `${fill.name} returned ${typeof output === 'object' && output !== null ? `an object with ${Object.entries(output).filter(([, v]) => !isJson(v)).map(([k]) => k).join(', ')} that isn't JSON` : String(output)}`);
}

export const actionKit = (): SlotKitImpl<ActionFill> => ({
  slot: ACTION, fills: 'many', revision: 1, rules, fixtures, planted: plantedFills(),
  clean: () => [reference()], generate, judge,
});
