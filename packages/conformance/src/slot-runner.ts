// The slot form of the one runner (#314): a kit's fixed part (its shipped fixtures) and seeded part (cases
// generated from the seed the install drew and recorded) run on a fill through the kit's judge, each case
// PASS, FAIL with the rule's finding and codes, or BLOCKED. The preflight's kit check runs the same judges
// synchronously: every rule has its one planted fill, and the kit refuses each with its own message.
import { randomInt } from 'node:crypto';
import { ContractError, ERROR_CODES } from '@deepbuild/contracts';
import type { JsonValue } from '@deepbuild/contracts';
import { Random } from './generator.js';
import { Finding } from './slot-types.js';
import type { CheckResult, Judge, SeededCase, SlotCase, SlotCaseResult, SlotFill, SlotKit, SlotKitImpl, SlotReport, SlotRunOptions, Step } from './slot-types.js';
import { isObject } from './types.js';
import type { Problem, Verdict } from './types.js';

const PRECEDENCE: Verdict[] = ['FAIL', 'BLOCKED', 'INVALID', 'INCONCLUSIVE', 'PASS'];
const worst = (verdicts: Verdict[]): Verdict => (verdicts.length ? PRECEDENCE.find((v) => verdicts.includes(v))! : 'INCONCLUSIVE');

const refuse = (code: string, path: string, actual: unknown, remediation: string): ContractError =>
  new ContractError({ code, retryable: false, remediation, path, actual: typeof actual === 'string' ? actual : actual === undefined ? '' : JSON.stringify(actual) ?? '', evidence: [] });

/** Refuses a fill the kit can't run: another slot's, or one with no revision. */
function load(kit: SlotKit, fill: unknown): asserts fill is SlotFill {
  if (!isObject(fill as JsonValue)) throw refuse('type', '', fill, `Give the kit a ${kit.slot} fill: a plain object with its slot, revision and methods.`);
  const f = fill as { [k: string]: unknown };
  if (f.slot !== kit.slot) throw refuse('enum', '/slot', f.slot, `Fill ${kit.slot}; this kit runs no other slot.`);
  if (!Number.isInteger(f.revision) || (f.revision as number) < 1) throw refuse('range', '/revision', f.revision, `Declare a revision of ${kit.slot}'s kit, 1 or later.`);
}

const asImpl = <F extends SlotFill>(kit: SlotKit<F>): SlotKitImpl<F> => {
  const impl = kit as Partial<SlotKitImpl<F>>;
  if (typeof impl.clean !== 'function' || typeof impl.generate !== 'function' || typeof impl.judge !== 'function') throw refuse('required', '/judge', undefined, `Run a kit of slotKits(), or one spread from it; ${kit.slot} has no judge.`);
  return kit as SlotKitImpl<F>;
};

const threw = (error: unknown): Finding => (error instanceof Finding ? error : new Finding('FAIL', `the fill threw: ${String(error)}`, ['type']));
const caseThrew = (error: unknown): Finding => (error instanceof Finding ? error : new Finding('FAIL', `the case threw: ${error instanceof Error ? error.stack ?? String(error) : String(error)}`, ['type']));

/** Drives a judge synchronously; a fill that answers with a promise is a probe this driver can't make. */
function driveSync(gen: Generator<Step, void, unknown>): void {
  let next = gen.next();
  while (!next.done) {
    let out: unknown;
    try { out = next.value(); } catch (error) { gen.return(); throw threw(error); }
    if (out instanceof Promise) { gen.return(); throw new Finding('BLOCKED', 'the fill answered with a promise, which the preflight\'s synchronous kit check can\'t await', []); }
    next = gen.next(out);
  }
}
async function driveAsync(gen: Generator<Step, void, unknown>): Promise<void> {
  let next = gen.next();
  while (!next.done) {
    let out: unknown;
    try { out = await next.value(); } catch (error) { gen.return(); throw threw(error); }
    next = gen.next(out);
  }
}

const ended = (c: SlotCase, error: unknown, prefix: string): SlotCaseResult => {
  const finding = caseThrew(error);
  return { id: c.id, part: c.part, outcome: finding.outcome, message: `${prefix}${finding.message}`, codes: finding.codes, input: c.part === 'seeded' ? c.input : null };
};
const passed = (c: SlotCase): SlotCaseResult => ({ id: c.id, part: c.part, outcome: 'PASS', message: '', codes: [], input: c.part === 'seeded' ? c.input : null });

function runCaseSync<F extends SlotFill>(judge: Judge<F>, fill: F, c: SlotCase, prefix: string): SlotCaseResult {
  try { driveSync(judge(fill, c)); } catch (error) { return ended(c, error, prefix); }
  return passed(c);
}
async function runCaseAsync<F extends SlotFill>(judge: Judge<F>, fill: F, c: SlotCase, prefix: string): Promise<SlotCaseResult> {
  try { await driveAsync(judge(fill, c)); } catch (error) { return ended(c, error, prefix); }
  return passed(c);
}

const fixedCases = (kit: SlotKit): SlotCase[] => kit.fixtures.map((f) => ({ id: f.id, part: 'fixed', input: f.input, expected: f.expected }));
/** A seeded FAIL names its seed, so the install's record and the failure meet. */
const seededPrefix = (seed: number, c: SlotCase): string => `seed ${seed}, ${c.id}: `;

/** The seeded part's cases, pure: deterministic from the seed, never a shipped fixture. */
export function seededCases(kit: SlotKit, seed: number): SeededCase[] {
  return asImpl(kit).generate(new Random(seed)).map((c) => ({ id: c.id, input: c.input }));
}

/** Runs the kit's fixed and seeded parts on a fill; throws a ContractError when the fill isn't the slot's. */
export async function runSlotKit<F extends SlotFill>(kit: SlotKit<F>, fill: F, options: SlotRunOptions = {}): Promise<SlotReport> {
  const impl = asImpl(kit);
  load(kit, fill);
  const parts = options.parts ?? ['fixed', 'seeded'];
  const seed = options.seed ?? randomInt(0, 2 ** 31);
  const cases: SlotCaseResult[] = [];
  if (parts.includes('fixed')) for (const c of fixedCases(kit)) cases.push(await runCaseAsync(impl.judge, fill, c, ''));
  if (parts.includes('seeded')) for (const c of impl.generate(new Random(seed))) cases.push(await runCaseAsync(impl.judge, fill, c, seededPrefix(seed, c)));
  // A fill declaring a revision the kit doesn't have yet is judged on the kit's cases, but the later revision's
  // requirements never ran, so the run can't pass (the adapter runner's rule, held here too).
  const unrun: Verdict[] = fill.revision > kit.revision ? ['INCONCLUSIVE'] : [];
  return { verdict: worst([...cases.map((c) => c.outcome), ...unrun]), slot: kit.slot, revision: kit.revision, seed, cases };
}

/** The core's stale rule over a run's read set: the changed paths the run read; non-empty means the PASS reads stale. */
export const stalePaths = (result: CheckResult, changed: readonly string[]): string[] => changed.filter((path) => result.read.includes(path));

/**
 * The preflight's kit checks for a slot kit, on its fixed part: a rule no planted fill isolates, a planted fill
 * breaking no listed rule or naming only shape refusals, planted fills sharing a name or a message, a reference
 * fill the kit fails, and a planted fill the kit admits or refuses with other codes than it names.
 */
export function slotKitProblems<F extends SlotFill>(kit: SlotKit<F>): Problem[] {
  const problems: Problem[] = [];
  const problem = (check: string, name: string, reason: string): void => { problems.push({ check, name, reason }); };
  let impl: SlotKitImpl<F>;
  try { impl = asImpl(kit); } catch (error) { problem('kit', kit.slot, String(error)); return problems; }
  for (const rule of kit.rules) {
    const breaking = kit.planted.filter((p) => p.breaks === rule.id);
    if (breaking.length !== 1) problem('rule planted', rule.id, `rule ${rule.id} ("${rule.rule}") has ${breaking.length} planted fills; it needs exactly one that breaks it alone`);
  }
  const names = kit.planted.map((p) => p.name);
  for (const name of new Set(names.filter((n, i) => names.indexOf(n) !== i))) problem('planted name', name, `planted fills share the name "${name}"`);
  const messages = kit.planted.map((p) => p.message);
  for (const message of new Set(messages.filter((m, i) => messages.indexOf(m) !== i))) problem('planted message', message, `planted fills share the message "${message}"`);
  if (!kit.fixtures.length) problem('fixtures', kit.slot, `${kit.slot} ships no fixture for its fixed part`);
  const cases = fixedCases(kit);
  let cleans: F[] = [];
  try { cleans = impl.clean(); } catch (error) { problem('clean fill', kit.slot, `the kit's reference fills can't be made: ${String(error)}`); }
  if (!cleans.length) problem('clean fill', kit.slot, `${kit.slot} has no reference fill`);
  for (const fill of cleans) {
    for (const c of cases) {
      const result = runCaseSync(impl.judge, fill, c, '');
      if (result.outcome !== 'PASS') problem('clean fill', c.id, `the kit's reference fill${fill.variant ? ` (${fill.variant})` : ''} reads ${result.outcome} on ${c.id}: ${result.message}`);
    }
  }
  for (const p of kit.planted) {
    if (!kit.rules.some((rule) => rule.id === p.breaks)) problem('planted rule', p.name, `planted fill ${p.name} breaks rule ${p.breaks}, which the kit doesn't list`);
    if (!p.message) problem('planted message', p.name, `planted fill ${p.name} has no message`);
    if (!p.codes.length) problem('planted codes', p.name, `planted fill ${p.name} names no codes`);
    else if (p.codes.every((code) => ERROR_CODES.includes(code))) problem('planted codes', p.name, `planted fill ${p.name} names only shape refusals (${p.codes.join(', ')}); it raises its rule's finding too`);
    // The planted fill's first refusal on the fixed part must be its own rule's finding: a fill the kit refuses
    // first for another rule, or for a shape it gets wrong, doesn't isolate the rule it claims to break.
    let first: SlotCaseResult | undefined;
    for (const c of cases) {
      const result = runCaseSync(impl.judge, p.fill, c, '');
      if (result.outcome !== 'PASS') { first = result; break; }
    }
    if (!first) { problem('planted proof', p.name, `planted fill ${p.name} passes every case of the fixed part; the kit admits it`); continue; }
    if (first.outcome !== 'FAIL' || !p.message || !first.message.includes(p.message)) {
      const other = kit.planted.find((q) => q !== p && q.message && first!.message.includes(q.message));
      problem('planted proof', p.name, `planted fill ${p.name} is first refused on ${first.id} as ${first.outcome} "${first.message}"${other ? `, planted fill ${other.name}'s finding,` : ''} not with its own message "${p.message}"`);
      continue;
    }
    const unraised = p.codes.filter((code) => !first.codes.includes(code));
    if (unraised.length) problem('planted codes', p.name, `planted fill ${p.name} is refused on ${first.id} with ${first.codes.join(', ') || 'no codes'}, not ${p.codes.join(', ')} (unraised: ${unraised.join(', ')})`);
  }
  return problems;
}
