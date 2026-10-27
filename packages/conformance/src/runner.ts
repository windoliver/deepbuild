// The conformance runner (#313): loads a fill as the registry would, runs the cases of the fill's revision
// through a harness that holds every reply to the published shapes and the adapter to the truth both ways,
// reads declared coverage never reached as INVALID and a probe it can't make as BLOCKED, and proves each
// broken fake by the exact codes it raises.
import { checkViewBindings, ContractError, getSchema, parseDigest, parseHandle, registry, validate } from '@deepbuild/contracts';
import type { ContractIssue, JsonValue, Schema, SchemaEntry } from '@deepbuild/contracts';
import type { AdapterEvent, HookRequestLine, Mapped } from '@deepbuild/adapters';
import { codeFamilies } from './families.js';
import { cleanFill, HARNESS } from './kit.js';
import { FLAG_OF, isObject, OPERATIONS } from './types.js';
import type { Case, CaseResult, Declared, Driven, Fake, FakeProof, FamilyName, Fill, Flag, Harness, Kit, Operation, Problem, Rect, Report, Verdict } from './types.js';

const FACTS_OPERATIONS = ['readUsage', 'classifyStop', 'skills'] as const;

/** A refusal in error@1's shape at a pointer into the fill. */
export const refuse = (code: string, path: string, actual: unknown, remediation: string): ContractError =>
  new ContractError({ code, retryable: false, remediation, path, actual: typeof actual === 'string' ? actual : actual === undefined ? '' : JSON.stringify(actual) ?? '', evidence: [] });

/** Refuses a fill the contract can't load, at the field that fails, before any case runs. */
function load(fill: Fill): void {
  if (!isObject(fill as unknown) || !isObject(fill.adapter as unknown)) throw refuse('required', '/adapter', undefined, 'Give the fill its adapter.');
  const adapter = fill.adapter;
  if (!('facts' in adapter)) throw refuse('required', '/adapter/facts', undefined, 'Give the adapter its adapter.facts@1 data.');
  const facts = validate('adapter.facts@1', adapter.facts);
  if (!facts.ok) { const first = facts.issues[0] as ContractIssue; throw new ContractError({ ...first, path: `/adapter/facts${first.path}` }); }
  if (typeof adapter.doctor !== 'function') throw refuse('required', '/adapter/doctor', undefined, 'Give the adapter a doctor() that lists its checks, each ok, warn, fail or skip.');
  let items: unknown;
  try { items = adapter.doctor(); } catch (error) { throw refuse('type', '/adapter/doctor', String(error), 'Make doctor() return its items instead of throwing.'); }
  if (!Array.isArray(items)) throw refuse('type', '/adapter/doctor', items, 'doctor() returns a list of doctor.item@1 items.');
  if (!items.length) throw refuse('required', '/adapter/doctor', '[]', 'doctor() lists at least one check; a doctor that checks nothing proves nothing.');
  items.forEach((item, i) => {
    const held = validate('doctor.item@1', item);
    if (!held.ok) { const first = held.issues[0] as ContractIssue; throw new ContractError({ ...first, path: `/adapter/doctor/${i}${first.path}` }); }
  });
  // The caps a case's flags read; a field the schema doesn't list is left to the schema's own check of the adapter.
  const caps = validate('adapter.caps@1', adapter.caps);
  const capsIssue = caps.ok ? undefined : caps.issues.find((i) => i.code !== 'unlisted_field');
  if (capsIssue) throw new ContractError({ ...capsIssue, path: `/adapter/caps${capsIssue.path}` });
  if (typeof adapter.mapHook !== 'function') throw refuse('required', '/adapter/mapHook', undefined, 'Give the adapter a mapHook(); factsAdapter() builds one from its facts.');
  const unsupported = validate('adapter.unsupported@1', adapter.unsupported);
  if (!unsupported.ok) { const first = unsupported.issues[0] as ContractIssue; throw new ContractError({ ...first, path: `/adapter/unsupported${first.path}` }); }
  const data = adapter.facts as { [k: string]: JsonValue };
  for (const operation of FACTS_OPERATIONS) {
    if (adapter[operation] === undefined) continue;
    const section = data[operation];
    if (!isObject(section)) throw refuse('required', `/adapter/facts/${operation}`, undefined, `An adapter that implements ${operation} names the operation in its facts, with its conformance case.`);
    if (typeof section.conformance !== 'string' || !section.conformance) throw refuse('required', `/adapter/facts/${operation}/conformance`, section.conformance, `${operation} ships only with its conformance case.`);
  }
  if (typeof fill.drive !== 'function' || typeof fill.deliver !== 'function') throw refuse('required', typeof fill.drive !== 'function' ? '/drive' : '/deliver', undefined, 'Give the fill its driven surface: drive() and deliver().');
  if (typeof fill.surface !== 'string' || typeof fill.version !== 'string' || !Number.isInteger(fill.revision)) throw refuse('type', typeof fill.surface !== 'string' ? '/surface' : typeof fill.version !== 'string' ? '/version' : '/revision', undefined, 'Name the surface the fill serves, the version its facts cover and the kit revision it declares.');
  if (!Object.hasOwn(adapter.unsupported, fill.surface)) throw refuse('enum', '/surface', fill.surface, 'Serve a surface the adapter lists in adapter.unsupported, with the operations it leaves out there.');
}

/** Ends a case: a finding (FAIL) or a probe the harness can't make (BLOCKED). */
class Stop extends Error {
  constructor(readonly outcome: 'FAIL' | 'BLOCKED', readonly finding: string, readonly codes: string[]) { super(finding); }
}

/** A refusal of a reply as the case's finding: the pointer into the reply and the error@1 codes. */
const refused = (what: string, issues: ContractIssue[]): Stop => new Stop('FAIL', `${what} refused at ${issues.map((i) => `${i.path || '/'}: ${i.code}`).join(', ')}`, [...new Set(issues.map((i) => i.code))]);
const issue = (code: string, path: string, actual: unknown): ContractIssue => ({ code, retryable: false, remediation: 'Reply in the published shape.', path, actual: JSON.stringify(actual) ?? '', evidence: [] });

/** Holds a mapped reply to adapter.event@1 per event, and to the mapping's own shape. */
function heldMapping(mapped: unknown): Mapped {
  if (!isObject(mapped as JsonValue)) throw refused('hook reply', [issue('type', '', mapped)]);
  const m = mapped as { [k: string]: unknown };
  if (!Array.isArray(m.events)) throw refused('hook reply', [issue('type', '/events', m.events)]);
  heldEvents(m.events, 'hook reply');
  if (typeof m.verified !== 'boolean') throw refused('hook reply', [issue('type', '/verified', m.verified)]);
  if (!Array.isArray(m.readings)) throw refused('hook reply', [issue('type', '/readings', m.readings)]);
  return mapped as Mapped;
}
function heldEvents(events: unknown[], what: string): void {
  const issues = events.flatMap((event, i) => { const result = validate('adapter.event@1', event); return result.ok ? [] : result.issues.map((x) => ({ ...x, path: `/events/${i}${x.path}` })); });
  if (issues.length) throw refused(what, issues);
}
/** Holds a driven reply to its two typed outcomes, then to the truth both ways. */
function heldDriven(reply: unknown, operation: Operation, fill: Fill): Driven {
  if (!isObject(reply as JsonValue)) throw refused(`${operation} reply`, [issue('type', '', reply)]);
  const r = reply as { [k: string]: unknown };
  if (r.outcome === 'ok') {
    if (!Array.isArray(r.events)) throw refused(`${operation} reply`, [issue('type', '/events', r.events)]);
    heldEvents(r.events, `${operation} reply`);
  } else if (r.outcome === 'unsupported') {
    if (!OPERATIONS.includes(r.operation as Operation)) throw refused(`${operation} reply`, [issue('enum', '/operation', r.operation)]);
    if (typeof r.surface !== 'string') throw refused(`${operation} reply`, [issue('type', '/surface', r.surface)]);
  } else throw refused(`${operation} reply`, [issue('union', '/outcome', r.outcome)]);
  const driven = reply as Driven;
  const listed = Array.isArray(fill.adapter.unsupported[fill.surface]) && fill.adapter.unsupported[fill.surface]!.includes(operation);
  const flag = FLAG_OF[operation];
  if (listed) {
    // A flag the caps declare can't also be listed unsupported: the two would contradict each other.
    if (flag && fill.adapter.caps[flag] === true) throw new Stop('FAIL', `declared flag ${flag}, but ${operation} is listed unsupported on ${fill.surface}`, [`flag:${flag}`]);
    if (driven.outcome === 'ok') throw new Stop('FAIL', HARNESS.noOpSuccess(operation, fill.surface), ['no_op_success']);
    if (driven.operation !== operation || driven.surface !== fill.surface) throw new Stop('FAIL', HARNESS.wrongUnsupported(operation, fill.surface, driven), ['no_op_success']);
  } else if (driven.outcome === 'unsupported') {
    if (flag && fill.adapter.caps[flag] === true) throw new Stop('FAIL', HARNESS.flagUnsupported(flag, operation, fill.surface), [`flag:${flag}`]);
    // An operation the surface doesn't list unsupported is one the adapter says it serves there.
    throw new Stop('FAIL', HARNESS.unlistedUnsupported(operation, fill.surface), [`operation:${operation}`]);
  }
  return driven;
}

/** `unsupported`: the listed operations that answered unsupported, past which the case could not go. */
interface Ran { outcome: Verdict; message: string; codes: string[]; reached: Declared; probes: string[]; unsupported: Operation[] }

/** Runs one case on a fill through a fresh harness; reached and probes come back with the outcome. */
function runCase(c: Case, fill: Fill, headless: boolean): Ran {
  const reached: Declared = { flags: [], operations: [], kinds: [] };
  const probes: string[] = [];
  const unsupported: Operation[] = [];
  const reach = <T>(list: T[], item: T): void => { if (!list.includes(item)) list.push(item); };
  const kinds = (events: AdapterEvent[]): void => { for (const event of events) reach(reached.kinds, event.kind); };
  const h: Harness = {
    facts: fill.adapter.facts,
    hook(line: HookRequestLine) {
      let mapped: unknown;
      try { mapped = fill.adapter.mapHook(line, fill.version); } catch (error) { throw new Stop('FAIL', `mapHook threw: ${String(error)}`, ['type']); }
      const held = heldMapping(mapped);
      kinds(held.events);
      return held;
    },
    drive(operation, input, session) {
      reach(reached.operations, operation);
      const flag = FLAG_OF[operation];
      if (flag) reach(reached.flags, flag);
      let reply: unknown;
      try { reply = fill.drive(operation, input, session); } catch (error) { throw new Stop('FAIL', `${operation} threw: ${String(error)}`, ['type']); }
      const held = heldDriven(reply, operation, fill);
      if (held.outcome === 'ok') kinds(held.events);
      else if (fill.adapter.unsupported[fill.surface]?.includes(operation)) reach(unsupported, operation);
      return held;
    },
    permission(request, session) {
      reach(reached.flags, 'answerPermission');
      if (fill.adapter.caps.answerPermission !== true) throw new Stop('BLOCKED', `answerPermission is not declared, so the harness can't deliver an answer on ${fill.surface}`, []);
      const decision = isObject(request) && typeof request.decision === 'string' ? request.decision : 'allow';
      let delivery: unknown;
      try { delivery = fill.deliver({ decision, request }, session); } catch (error) { throw new Stop('FAIL', `deliver threw: ${String(error)}`, ['type']); }
      const sign = isObject(delivery as JsonValue) ? (delivery as { sign: unknown }).sign : undefined;
      if (!isObject(delivery as JsonValue) || typeof (delivery as { session: unknown }).session !== 'string' || (typeof sign !== 'string' && sign !== null)) {
        throw refused('delivery', [issue('type', isObject(delivery as JsonValue) ? '/sign' : '', delivery)]);
      }
      return delivery as { session: string; sign: string | null };
    },
    reply(answer, request) {
      const reply = fill.adapter.permissionReply;
      if (typeof reply !== 'function') {
        probes.push('reply');
        throw new Stop('BLOCKED', `the adapter has no permissionReply, so the harness can't read its reply on ${fill.surface}`, []);
      }
      try { return reply.call(fill.adapter, answer, request); } catch (error) { throw new Stop('FAIL', `permissionReply threw: ${String(error)}`, ['type']); }
    },
    bounds(panel): Rect {
      probes.push('bounds');
      // No harness here renders a panel, so none has geometry to measure; the probe is never faked.
      throw new Stop('BLOCKED', `the ${headless ? 'headless ' : ''}harness can't make the bounds probe for ${panel}: no geometry`, []);
    },
    fail(message, codes = []) { throw new Stop('FAIL', message, codes); },
  };
  try {
    c.run(h);
  } catch (error) {
    if (error instanceof Stop) return { outcome: error.outcome, message: error.finding, codes: error.codes, reached, probes, unsupported };
    return { outcome: 'FAIL', message: `the case threw: ${String(error)}`, codes: ['type'], reached, probes, unsupported };
  }
  return { outcome: 'PASS', message: '', codes: [], reached, probes, unsupported };
}

const PRECEDENCE: Verdict[] = ['FAIL', 'BLOCKED', 'INVALID', 'INCONCLUSIVE', 'PASS'];
/** The verdict that decides a run: the first of PRECEDENCE among its verdicts; none is INCONCLUSIVE. */
export const worst = (verdicts: Verdict[]): Verdict => (verdicts.length ? PRECEDENCE.find((v) => verdicts.includes(v))! : 'INCONCLUSIVE');

/** The fakes that mishandle an item the case declares. */
const fakesOf = (kit: Kit, c: Case): Fake[] => kit.fakes.filter((f) =>
  (f.breaks.flag !== undefined && c.declares.flags.includes(f.breaks.flag))
  || (f.breaks.operation !== undefined && c.declares.operations.includes(f.breaks.operation))
  || (f.breaks.kind !== undefined && c.declares.kinds.includes(f.breaks.kind)));

/** Runs the cases of the fill's revision or earlier; throws a ContractError when the fill can't load. */
export function runKit(kit: Kit, fill: Fill, options: { headless: boolean }): Report {
  load(fill);
  if (fill.revision < 1) throw refuse('range', '/revision', String(fill.revision), `Declare a revision of ${kit.name}, 1 or later.`);
  // An optional method ships only with its conformance case, so the case it names must be one the kit runs.
  for (const operation of FACTS_OPERATIONS) {
    const section = (fill.adapter.facts as { [k: string]: JsonValue })[operation];
    const named = isObject(section) ? kit.cases.find((c) => c.id === section.conformance) : undefined;
    if (fill.adapter[operation] !== undefined && isObject(section) && !(named?.declares.operations as string[] | undefined)?.includes(operation)) {
      throw refuse('enum', `/adapter/facts/${operation}/conformance`, section.conformance, `${operation} names no case of ${kit.name} that exercises it; name the case that drives ${operation}, or leave the method out until the kit has one.`);
    }
  }
  const cases: CaseResult[] = kit.cases.filter((c) => c.revision <= fill.revision).map((c) => {
    const ran = runCase(c, fill, options.headless);
    const never = [...new Set([...c.declares.flags, ...c.declares.operations, ...c.declares.kinds])].filter((item) => !ran.reached.flags.includes(item as Flag) && !ran.reached.operations.includes(item as Operation) && !ran.reached.kinds.includes(item));
    // The fakes of its declared items: a case that lets one survive proves nothing about that item. A fake is
    // killed only by a failure that raises one of its own codes, not by a crash it happens to cause.
    const killed: string[] = [];
    const survived: string[] = [];
    for (const fake of fakesOf(kit, c)) {
      const against = runCase(c, fake.fill, options.headless);
      const own = against.codes.length > 0 && against.codes.every((code) => fake.codes.includes(code));
      (against.outcome === 'FAIL' && own ? killed : survived).push(fake.name);
    }
    const notes: string[] = [];
    let outcome = ran.outcome;
    if (ran.message) notes.push(ran.message);
    // Past an operation the fill lists unsupported and answers so, the case can't go. A declared item it then never
    // reached is excused only when the surface lists it unsupported too (or it is the flag behind such an
    // operation), which the runner holds both ways. Anything else never reached, an operation the adapter says it
    // serves or an event kind, is missing coverage.
    const listedHere = new Set(ran.unsupported.length ? fill.adapter.unsupported[fill.surface] ?? [] : []);
    const excusable = (item: string): boolean => listedHere.has(item as Operation) || [...listedHere].some((op) => FLAG_OF[op as Operation] === item);
    const excused = never.filter(excusable);
    const missing = never.filter((item) => !excusable(item));
    if (outcome === 'PASS' && (missing.length || survived.length)) outcome = 'INVALID';
    if (ran.unsupported.length) notes.push(`stopped at ${ran.unsupported.join(', ')}, listed unsupported on ${fill.surface}${excused.length ? `; ${excused.join(', ')} not reached` : ''}`);
    notes.push(...missing.map((item) => `declared ${item}, never reached`));
    if (survived.length) notes.push(`fakes survived: ${survived.join(', ')}`);
    return { id: c.id, outcome, message: notes.join('; '), codes: ran.codes, declared: c.declares, reached: ran.reached, probes: ran.probes, killed, survived };
  });
  // A fill declaring a revision the kit doesn't have yet is judged on the kit's cases, but the later revisions'
  // requirements never ran, so the run can't pass.
  const unrun: Verdict[] = fill.revision > kit.revision ? ['INCONCLUSIVE'] : [];
  return { verdict: worst([...cases.map((c) => c.outcome), ...unrun]), revision: fill.revision, cases };
}

/** Runs the kit on a fake's fill and compares the codes raised with those it names; killed only when equal. */
export const proveFake = (kit: Kit, fake: Fake): FakeProof => prove(kit, fake).proof;

/** The proof, and whether a failing case carries the fake's own message. */
function prove(kit: Kit, fake: Fake): { proof: FakeProof; saysMessage: boolean } {
  const report = runKit(kit, fake.fill, { headless: true });
  const failing = report.cases.filter((c) => c.outcome === 'FAIL');
  const raised = [...new Set(failing.flatMap((c) => c.codes))].sort();
  const named = new Set(fake.codes);
  const extra = raised.filter((code) => !named.has(code));
  const missing = [...named].filter((code) => !raised.includes(code)).sort();
  // A case's own finding leads its message, before any '; '-joined notes; the fake's message must be that finding,
  // or lead it before the ': ' that names what it found (the ID, the turn).
  const saysMessage = fake.message.length > 0 && failing.some((c) => c.message === fake.message || c.message.startsWith(`${fake.message}; `) || c.message.startsWith(`${fake.message}: `));
  return { proof: { raised, extra, missing, killed: extra.length === 0 && missing.length === 0 }, saysMessage };
}

const inlineRegistry = (schema: Schema) => registry([{ name: 'planted@1', schema }]);
const codesOf = (fn: () => void): string[] => { try { fn(); return []; } catch (error) { return error instanceof ContractError ? [error.code] : ['type']; } };

/** The codes a family input raises when the kit replays it; each family's input form is the kit's (planted.ts). */
export function replay(_kit: Kit, family: FamilyName, input: JsonValue): string[] {
  switch (family) {
    case 'verdict':
      return isObject(input) && typeof input.outcome === 'string' && input.outcome !== 'pending' ? [input.outcome] : [];
    case 'run':
      return isObject(input) && input.kind === 'run.finished' && isObject(input.data) && typeof input.data.outcome === 'string' ? [input.data.outcome] : [];
    case 'check':
      return isObject(input) && Array.isArray(input.findings) ? [...new Set(input.findings.map(String))] : [];
    case 'doctor':
      return isObject(input) && Array.isArray(input.items) ? [...new Set(input.items.flatMap((item) => (isObject(item) && typeof item.code === 'string' ? [item.code] : [])))] : [];
    case 'exit':
      return isObject(input) && typeof input.status === 'number' && Number.isInteger(input.status) ? [String(input.status)] : [];
    case 'refusal': {
      if (!isObject(input)) return [];
      if (typeof input.handle === 'string') return codesOf(() => parseHandle(input.handle as string));
      if (typeof input.digest === 'string') return codesOf(() => parseDigest(input.digest as string));
      if (Array.isArray(input.bindings)) { const result = checkViewBindings(input.bindings.map(String)); return result.ok ? [] : [...new Set(result.issues.map((i) => i.code))]; }
      if (typeof input.schema === 'string') {
        try { const result = validate(input.schema, input.value); return result.ok ? [] : [...new Set(result.issues.map((i) => i.code))]; } catch (error) { return error instanceof ContractError ? [error.code] : ['type']; }
      }
      if (!isObject(input.schema)) return [];
      let value: unknown = input.value;
      if (typeof input.text === 'string') { try { value = JSON.parse(input.text); } catch { return ['not_json']; } }
      const result = inlineRegistry(input.schema).validate('planted@1', value);
      return result.ok ? [] : [...new Set(result.issues.map((i) => i.code))];
    }
    default:
      return [];
  }
}

/** The preflight's kit checks: a rule with no fake, a code no entry raises, a fake, entry or twin naming codes it doesn't raise. */
export function kitProblems(kit: Kit, schemas?: readonly SchemaEntry[]): Problem[] {
  const problems: Problem[] = [];
  const problem = (check: string, name: string, reason: string): void => { problems.push({ check, name, reason }); };
  const rules = ((catalogueRules() as { id: string; rule: string }[]));
  for (const rule of rules) {
    const fakes = kit.fakes.filter((f) => f.breaks.rule === rule.id);
    if (fakes.length !== 1) problem('rule fake', rule.id, `rule ${rule.id} ("${rule.rule}") has ${fakes.length} broken fakes; it needs exactly one that breaks it alone`);
  }
  for (const fake of kit.fakes) {
    const keys = Object.entries(fake.breaks).filter(([, v]) => v !== undefined).map(([k]) => k);
    if (keys.length !== 1) problem('fake item', fake.name, `fake ${fake.name} mishandles ${keys.length} items; a fake breaks exactly one`);
    if (!fake.codes.length) problem('fake codes', fake.name, `fake ${fake.name} names no codes`);
  }
  const messages = kit.fakes.map((f) => f.message);
  for (const message of new Set(messages.filter((m, i) => messages.indexOf(m) !== i))) problem('fake message', message, `fakes share the message "${message}"`);
  const items = new Set(kit.cases.flatMap((c) => [...c.declares.flags.map((f) => `flag ${f}`), ...c.declares.operations.map((o) => `operation ${o}`), ...c.declares.kinds.map((k) => `kind ${k}`)]));
  for (const item of items) {
    const [key, name] = item.split(' ') as ['flag' | 'operation' | 'kind', string];
    const fakes = kit.fakes.filter((f) => f.breaks[key] === name);
    if (fakes.length !== 1) problem('item fake', name, `declared ${item} has ${fakes.length} broken fakes; it needs exactly one`);
  }
  for (const fake of kit.fakes) {
    if (fake.breaks.rule !== undefined && !rules.some((rule) => rule.id === fake.breaks.rule)) problem('rule fake', fake.name, `fake ${fake.name} breaks rule ${fake.breaks.rule}, which adapter.facts@1's x-rules doesn't list`);
    let proof: FakeProof;
    let saysMessage: boolean;
    try { ({ proof, saysMessage } = prove(kit, fake)); } catch (error) { problem('fake proof', fake.name, `fake ${fake.name} can't load: ${String(error)}`); continue; }
    if (!saysMessage) problem('fake message', fake.name, `fake ${fake.name} fails no case with its own message "${fake.message}"`);
    if (!proof.killed) problem('fake proof', fake.name, `fake ${fake.name} raised ${proof.raised.join(', ') || 'nothing'}; it names ${fake.codes.join(', ')} (extra: ${proof.extra.join(', ') || 'none'}; missing: ${proof.missing.join(', ') || 'none'})`);
  }
  // The kit's own reference fill passes every case, with no fake of any declared item surviving.
  // A probe the headless run can't make is BLOCKED there, which is the harness's limit, not the kit's.
  try {
    for (const c of runKit(kit, cleanFill(kit), { headless: true }).cases) if (c.outcome !== 'PASS' && c.outcome !== 'BLOCKED') problem('clean fill', c.id, `the kit's reference fill reads ${c.outcome} on ${c.id}: ${c.message}`);
  } catch (error) { problem('clean fill', kit.name, `the kit has no reference fill that loads: ${String(error)}`); }
  for (const family of codeFamilies(schemas)) {
    for (const code of family.codes) {
      const entries = kit.planted.filter((e) => e.family === family.family && e.code === code);
      if (entries.length !== 1) problem('planted code', code, `${family.family} code ${code} has ${entries.length} planted entries; each code is raised alone by one`);
    }
  }
  for (const e of kit.planted) {
    const raised = replay(kit, e.family, e.entry);
    if (e.codes.length !== 1 || e.codes[0] !== e.code) problem('planted codes', e.code, `${e.family} entry ${e.code} names ${e.codes.join(', ')}; an entry names exactly its code`);
    const unraised = e.codes.filter((c) => !raised.includes(c));
    const extra = raised.filter((c) => !e.codes.includes(c));
    if (unraised.length || extra.length) problem('planted replay', e.code, `${e.family} entry ${e.code} raises ${raised.join(', ') || 'nothing'}, not ${e.codes.join(', ')} (unraised: ${unraised.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`);
    const twin = replay(kit, e.family, e.twin.value);
    if (e.twin.codes.length) problem('planted twin', e.code, `${e.family} entry ${e.code}'s twin names ${e.twin.codes.join(', ')}; a twin raises nothing`);
    if (twin.length) problem('planted twin', e.code, `${e.family} entry ${e.code}'s twin raises ${twin.join(', ')}; a twin raises nothing`);
    if (!e.fix) problem('planted fix', e.code, `${e.family} entry ${e.code} has no fix`);
  }
  return problems;
}

/** The adapter rules, adapter.facts@1's x-rules. */
function catalogueRules(): unknown[] {
  const list = (getSchema('adapter.facts@1') as { 'x-rules'?: unknown })['x-rules'];
  return Array.isArray(list) ? list : [];
}
