// The code families (#313, AC7): each has one source, an enum in the published schemas, and a total mapping
// to a verdict. A value an enum lists without a mapping here is unmapped, which the lint names; a value no
// enum lists judges INVALID, naming the raw code, never PASS.
import { listSchemas } from '@deepbuild/contracts';
import type { JsonValue, SchemaEntry } from '@deepbuild/contracts';
import { getAt } from './pointer.js';
import { FAMILIES, isObject } from './types.js';
import type { CodeFamily, FamilyName, Judgement, Verdict } from './types.js';

/** Where each family's enum lives: a published schema and the JSON Pointer of its enum node. */
const SOURCES: Record<FamilyName, { schema: string; pointer: string }> = {
  verdict: { schema: 'verdict.outcome@1', pointer: '' },
  run: { schema: 'run.finished@1', pointer: '/properties/data/properties/outcome' },
  refusal: { schema: 'error@1', pointer: '/properties/code' },
  check: { schema: 'check.code@1', pointer: '' },
  doctor: { schema: 'doctor.item@1', pointer: '/properties/code' },
  exit: { schema: 'exit.code@1', pointer: '' },
};

/** The total mapping, one verdict per code; a code missing here fails the build (unmappedCodes). */
const MAPPING: Record<FamilyName, Record<string, Verdict>> = {
  verdict: { PASS: 'PASS', FAIL: 'FAIL', INVALID: 'INVALID', BLOCKED: 'BLOCKED', INCONCLUSIVE: 'INCONCLUSIVE' },
  run: { passed: 'PASS', failed: 'FAIL', ran_nothing: 'INVALID', missing: 'BLOCKED', overran: 'INCONCLUSIVE', stopped: 'INCONCLUSIVE', uncounted: 'INVALID' },
  // A refusal is a request the contract could not read: the result is INVALID, never a FAIL of what was checked.
  refusal: {
    unknown_schema: 'INVALID', not_json: 'INVALID', type: 'INVALID', required: 'INVALID', unlisted_field: 'INVALID', enum: 'INVALID', const: 'INVALID',
    pattern: 'INVALID', format: 'INVALID', length: 'INVALID', range: 'INVALID', union: 'INVALID', uncatalogued_kind: 'INVALID', handle_syntax: 'INVALID',
    handle_scheme: 'INVALID', digest_algorithm: 'INVALID',
  },
  check: { exit_masked: 'INVALID', no_tests_ran: 'INVALID', crashed_before_first_assertion: 'INVALID', reported_after_deadline: 'INCONCLUSIVE', output_dropped: 'INCONCLUSIVE', type_error_as_assertion: 'INVALID' },
  doctor: {
    healthy: 'PASS', binary_missing: 'FAIL', version_uncovered: 'FAIL', hooks_missing: 'FAIL', hooks_disabled: 'FAIL', hooks_untrusted: 'FAIL', mcp_unregistered: 'FAIL',
    statusline_missing: 'FAIL', statusline_shadowed: 'INCONCLUSIVE', signed_out: 'BLOCKED', nested_session: 'FAIL', timing_relation_broken: 'FAIL', telemetry_unreadable: 'FAIL', not_checked: 'BLOCKED',
    hub_unreachable: 'BLOCKED', disk_low: 'FAIL', ports_taken: 'FAIL', billing_api_key: 'FAIL', binary_differs: 'FAIL', token_expiring: 'BLOCKED', prompt_failed: 'FAIL', deprecated_used: 'FAIL', gpu_unsupported: 'FAIL', render_failed: 'FAIL', hook_program_missing: 'FAIL', job_failing: 'FAIL', notifications_off: 'FAIL', service_unpromoted: 'FAIL', pack_refused: 'FAIL', polkit_action_missing: 'FAIL', hooks_modified: 'FAIL', mod_overrides_guard: 'FAIL',
    unknown: 'INCONCLUSIVE',
  },
  exit: { '0': 'PASS', '1': 'FAIL', '2': 'INVALID', '3': 'INCONCLUSIVE' },
};

/** The state words every version of the row model lists (design: States people see). */
const ROW = ['queued', 'working', 'says done', 'sent back', 'needs you', 'stale', 'quiet', 'stuck', 'flagged', 'finished'];
const WORD = '/properties/data/properties/word';
/**
 * The lists that hold PASS among words that are no verdicts, by schema and the JSON Pointer of the enum: a state's
 * word or an attempt's cause, where PASS is the one success and no other word is read as a verdict. Each list may
 * hold exactly the words here beside the verdicts, so this is an allowlist, not a mapping: a word added to one of
 * these lists, or one of these words on any other list, is named.
 */
const STATE_LISTS: Record<string, readonly string[]> = {
  [`row.set@1 ${WORD}`]: ROW,
  [`row.set@2 ${WORD}`]: [...ROW, 'running'],
  [`row.set@3 ${WORD}`]: [...ROW, 'running'],
  [`row.set@4 ${WORD}`]: [...ROW, 'running'],
  'session.state@2 /properties/data/properties/state': ROW,
  [`work.state@1 ${WORD}`]: ['queued', 'working', 'says done', 'sent back', 'needs you', 'stale', 'finished', 'closed', 'closed before the gate'],
  // Attempt and plan's closed set of causes, the two a work run adds, and none for an attempt that hasn't ended.
  'work.attempt@1 /properties/data/properties/cause': ['none', 'landed with the budget window open', 'gave up its slot', 'replaced by you', 'sent back past its rounds', 'stalled', 'context full', 'plan window or spend cap', 'crashed or interrupted'],
  // The five verdicts, or none for a landing step that reads no verdict.
  'landing.made@1 /properties/data/properties/outcome': ['none'],
};

const enumAt = (entries: readonly SchemaEntry[], schema: string, pointer: string): string[] => {
  const entry = entries.find((e) => e.name === schema);
  const node = entry ? getAt(entry.schema as JsonValue, pointer) : undefined;
  return isObject(node) && Array.isArray(node.enum) ? node.enum.map(String) : [];
};

/** The six families over the published schemas, or the given ones. */
export function codeFamilies(schemas?: readonly SchemaEntry[]): CodeFamily[] {
  if (schemas) return FAMILIES.map((family) => ({ family, ...SOURCES[family], codes: enumAt(schemas, SOURCES[family].schema, SOURCES[family].pointer) }));
  // The published schemas never change in a process, so their families are read once; callers get copies.
  published ??= codeFamilies(listSchemas());
  return published.map((f) => ({ ...f, codes: [...f.codes] }));
}
let published: CodeFamily[] | undefined;

/**
 * Enum values with no mapping to a verdict, and values of a verdict-shaped enum elsewhere (one listing PASS, as
 * verdict records do) that verdict.outcome@1 doesn't list: the verdict family has one source, so a
 * record's own outcome list can't grow past it. `pending` is a record's state before its verdict, not one, and a
 * list STATE_LISTS names also holds its own words.
 */
export function unmappedCodes(schemas?: readonly SchemaEntry[]): { family: FamilyName; code: string }[] {
  const families = codeFamilies(schemas);
  const unmapped = families.flatMap((f) => f.codes.filter((code) => !Object.hasOwn(MAPPING[f.family], code)).map((code) => ({ family: f.family, code })));
  const verdicts = new Set([...families.find((f) => f.family === 'verdict')!.codes, 'pending']);
  const outside = new Set<string>();
  const walk = (node: JsonValue | undefined, at: string): void => {
    if (Array.isArray(node)) return void node.forEach((child, i) => walk(child, `${at}/${i}`));
    if (!isObject(node)) return;
    if (Array.isArray(node.enum) && node.enum.includes('PASS')) {
      const words = Object.hasOwn(STATE_LISTS, at) ? STATE_LISTS[at]! : [];
      for (const v of node.enum) if (!verdicts.has(String(v)) && !words.includes(String(v))) outside.add(String(v));
    }
    // A union tagged by verdicts, as verdict records are: its tags are a verdict list too.
    if (Array.isArray(node.oneOf)) {
      const tags = new Map<string, string[]>();
      for (const branch of node.oneOf) if (isObject(branch) && isObject(branch.properties)) for (const [key, p] of Object.entries(branch.properties)) if (isObject(p) && typeof p.const === 'string') tags.set(key, [...(tags.get(key) ?? []), p.const]);
      for (const values of tags.values()) if (values.includes('PASS')) for (const v of values) if (!verdicts.has(v)) outside.add(v);
    }
    for (const [key, child] of Object.entries(node)) if (key !== 'enum') walk(child, `${at}/${key}`);
  };
  for (const entry of schemas ?? listSchemas()) walk(entry.schema as JsonValue, `${entry.name} `);
  return [...unmapped, ...[...outside].map((code) => ({ family: 'verdict' as const, code }))];
}

/** A code's verdict; one its family doesn't list is INVALID, naming the raw code. */
export function judge(family: FamilyName, code: string): Judgement {
  const listed = codeFamilies().find((f) => f.family === family)!.codes.includes(code) && Object.hasOwn(MAPPING[family], code);
  if (!listed) return { family, code, listed: false, verdict: 'INVALID', message: `${family} code ${JSON.stringify(code)} is not listed by ${SOURCES[family].schema}: INVALID, never a success (raw code ${code})` };
  const verdict = MAPPING[family][code]!;
  return { family, code, listed: true, verdict, message: `${family} code ${code} reads ${verdict}` };
}

/** The one exit-code table: 1 for any FAIL, 0 when every verdict is PASS, 3 for anything not decided (nothing checked among it). */
export function exitCode(verdicts: readonly Verdict[]): 0 | 1 | 3 {
  if (verdicts.includes('FAIL')) return 1;
  return verdicts.length > 0 && verdicts.every((v) => v === 'PASS') ? 0 : 3;
}
