// The job.kind@1 kit (#1922): an offline job kind and a tool that joins it. A fill is the kind's pipeline for one
// tool: `run` is the tool (params and inputs in, outputs out, every value text), `checks` the kind's output checks
// (the name of the first that fails, or null) and `job` what the hub hands back (the outputs an item may name, or the
// check that failed and none). The kit holds the two things the slot's rules are about: a tool joins only once it
// writes each qualification fixture's expected bytes, and a run whose output fails a check names no output.
import type { JsonValue } from '@deepbuild/contracts';
import type { Random } from '../generator.js';
import { fail } from '../slot-types.js';
import type { Fixture, PlantedFill, SlotCase, SlotFill, SlotKitImpl, SlotRule } from '../slot-types.js';
import { object, word } from './shared.js';

const JOB = 'job.kind@1';

type Texts = Record<string, string>;
interface JobReply { outputs: Texts | null; failed: string | null }
export interface JobKindFill extends SlotFill {
  slot: 'job.kind@1';
  kind: string;
  tool: string;
  run(params: Texts, inputs: Texts): Texts;
  checks(outputs: Texts): string | null;
  job(params: Texts, inputs: Texts): JobReply;
}
/** A case: the params and inputs, and the bytes a qualified tool writes, or null when the output must fail a check. */
interface Input { params: Texts; inputs: Texts; expect: Texts | null }

const RULES = {
  bytes: { id: 'qualified-bytes', rule: 'A tool joins its kind only once it writes each qualification fixture\'s expected bytes.', message: 'wrote other bytes than a fixture expects' },
  checked: { id: 'checked-before-named', rule: 'An output reaches an item only after every output check of its kind passes: a run whose output fails one names no output and names that check.', message: 'named an output that failed an output check' },
};
const rules: SlotRule[] = Object.values(RULES).map(({ id, rule }) => ({ id, rule }));

type Fault = 'none' | 'lowercases-last-letter' | 'names-before-checks';
/** test.upper's reference: upper-case the text, or lower-case it; its output check refuses any lower-case letter. */
function reference(fault: Fault = 'none'): JobKindFill {
  const run = (params: Texts, inputs: Texts): Texts => {
    const text = inputs.text ?? '';
    const out = params.case === 'lower' ? text.toLowerCase() : text.toUpperCase();
    if (fault !== 'lowercases-last-letter') return { text: out };
    const at = out.search(/[A-Za-z][^A-Za-z]*$/);
    return { text: at < 0 ? out : `${out.slice(0, at)}${out[at]!.toLowerCase()}${out.slice(at + 1)}` };
  };
  const checks = (outputs: Texts): string | null => (/[a-z]/.test(outputs.text ?? '') ? 'test.upper_only' : null);
  return {
    slot: JOB, revision: 1, kind: 'test.upper', tool: 'upper-a@1.0.0', run, checks,
    job(params, inputs) {
      const outputs = run(params, inputs);
      const failed = checks(outputs);
      return failed && fault !== 'names-before-checks' ? { outputs: null, failed } : { outputs, failed };
    },
  };
}

const plant = (name: Fault & string, breaks: keyof typeof RULES, codes: string[]): PlantedFill<JobKindFill> => ({ name, message: RULES[breaks].message, codes, breaks: RULES[breaks].id, fill: reference(name) });
const plantedFills = (): PlantedFill<JobKindFill>[] => [
  plant('lowercases-last-letter', 'bytes', ['fixture_mismatch']),
  plant('names-before-checks', 'checked', ['named_unchecked']),
];

const toCase = (id: string, part: 'fixed' | 'seeded', input: Input): SlotCase => ({ id, part, input: input as unknown as JsonValue, expected: null });
// The kind's qualification fixtures first, then a run whose output fails the check, so each planted fill is refused at
// the first case its rule reads.
const cases: SlotCase[] = [
  toCase('fx-greeting', 'fixed', { params: { case: 'upper' }, inputs: { text: 'hello' }, expect: { text: 'HELLO' } }),
  toCase('fx-route', 'fixed', { params: { case: 'upper' }, inputs: { text: 'route 66' }, expect: { text: 'ROUTE 66' } }),
  toCase('lower-fails-check', 'fixed', { params: { case: 'lower' }, inputs: { text: 'ABC' }, expect: null }),
];
const fixtures: Fixture[] = cases.map(({ id, input, expected }) => ({ id, input, expected }));

/** Words from the draw: one a qualified tool upper-cases, one whose lower-case output fails the check. */
const generate = (random: Random): SlotCase[] => {
  const text = `${word(random, 6)} ${random.int(0, 99)}`;
  return [
    toCase('seeded-upper', 'seeded', { params: { case: 'upper' }, inputs: { text }, expect: { text: text.toUpperCase() } }),
    toCase('seeded-lower', 'seeded', { params: { case: 'lower' }, inputs: { text: text.toUpperCase() }, expect: null }),
  ];
};

const texts = (what: string, value: unknown): Texts => {
  const o = object(what, value);
  if (!Object.values(o).every((v) => typeof v === 'string')) throw fail(RULES.bytes.message, ['fixture_mismatch'], `${what} holds a value that isn't text`);
  return o as Texts;
};

function* judge(fill: JobKindFill, c: SlotCase): Generator<() => unknown, void, unknown> {
  const { params, inputs, expect } = c.input as unknown as Input;
  if (expect) {
    const wrote = texts('the tool\'s outputs', yield () => fill.run(params, inputs));
    for (const [name, bytes] of Object.entries(expect)) {
      if (wrote[name] !== bytes) throw fail(RULES.bytes.message, ['fixture_mismatch'], `${fill.tool} wrote ${JSON.stringify(wrote[name])} for ${c.id}'s ${name}, which expects ${JSON.stringify(bytes)}`);
    }
    return;
  }
  const reply = object('the job\'s reply', yield () => fill.job(params, inputs)) as unknown as JobReply;
  if (reply.outputs !== null || typeof reply.failed !== 'string') throw fail(RULES.checked.message, ['named_unchecked'], `${c.id}'s output fails ${String(reply.failed ?? 'an output check')}, and the reply names ${JSON.stringify(reply.outputs)}`);
}

export const jobKindKit = (): SlotKitImpl<JobKindFill> => ({
  slot: JOB, fills: 'many', revision: 1, rules, fixtures, planted: plantedFills(),
  clean: () => [reference()], generate, judge,
});
