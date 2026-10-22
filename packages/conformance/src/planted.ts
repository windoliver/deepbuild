// The planted entries (#313, AC16): for every code of every code family, one input that raises exactly that code
// when the kit replays it, its clean twin that raises nothing, and the fix. The kit decides each family's input
// form; `replay` in runner.ts reads them.
import type { JsonValue, Schema } from '@deepbuild/contracts';
import type { CodeFamily, FamilyName, PlantedEntry } from './types.js';

const ULID = '01K74FKZVK8Q2X5R7M3N9P4T6W';
const HEX = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

const entry = (family: FamilyName, code: string, value: JsonValue, twin: JsonValue, fix: string): PlantedEntry => ({ family, code, codes: [code], entry: value, twin: { value: twin, codes: [] }, fix });

/** A run.finished@1 event with the given outcome; its twin is the run's start, which carries no outcome yet. */
const runFinished = (outcome: string): JsonValue => ({
  v: 1, id: ULID, kind: 'run.finished', writer: 'cli', actor: 'you', scope: 'you', ts: 1760013451123,
  data: { run: 'run:01K74G3A5C7E9G1J3M5P7R9T1V', outcome, tests_run: 29, passed: outcome === 'passed' ? 29 : 28, runs: 1, evidence: [], check: 'contracts.unit', assertion: null, expected: null, actual: null, step: null, points_to: null, findings: [], environment: 'node-24.22.0/darwin-arm64' },
});
const runStarted: JsonValue = {
  v: 1, id: ULID, kind: 'run.started', writer: 'cli', actor: 'you', scope: 'you', ts: 1760013451000,
  data: { run: 'run:01K74G3A5C7E9G1J3M5P7R9T1V', check: 'contracts.unit', claim: 'claim:01K74G1Z3X5V7T9R1P3N5M7K9H', commit: '0c5e145756bbdaef4d9b8bdaca2d0bd0f900ed46' },
};

const RUN_FIXES: Record<string, string> = {
  passed: 'Nothing: the run passed. A PASS still needs the run counted at its depth.',
  failed: 'Repair the behavior the failing test names; its assertion and the file and line are on the run.',
  ran_nothing: 'Point the check at tests that exist and run; a run of zero tests is INVALID, never a pass.',
  missing: 'Record the run the claim cites, or cite a run that was made.',
  overran: "Finish within the check's deadline, or raise the deadline in the check's definition.",
  stopped: 'Run the check again; it was stopped (the hub restarted) before it finished.',
  uncounted: "Run the check on the snapshot the claim names, not on the agent's own stack.",
};
const CHECK_FIXES: Record<string, string> = {
  exit_masked: 'Remove the mask (|| true, set +e, a pipe without pipefail) so the command can fail.',
  no_tests_ran: 'Make the check run at least one test, or drop the check.',
  crashed_before_first_assertion: 'Repair the crash (an import, a missing file) so the suite reaches its assertions.',
  reported_after_deadline: "Report within the run's deadline; a result after it is not counted.",
  output_dropped: "Keep a crashed run's output; a result with no output can't be read.",
  type_error_as_assertion: 'Report a TypeError before the first assertion as a crash, never as an assertion failure.',
};
const DOCTOR_FIXES: Record<string, string> = {
  healthy: 'Nothing: the check ran and found nothing wrong.',
  binary_missing: "Install the agent, or put its binary on your login shell's PATH.",
  version_uncovered: "Update the agent's facts file to cover the version installed, or install a covered version.",
  hooks_missing: 'Run deep setup to install the hook entries.',
  hooks_disabled: "Enable DeepBuild's hooks in the agent's settings; a disable flag an agent wrote is put back by setup.",
  hooks_untrusted: "Trust the project's hook configuration in the agent.",
  mcp_unregistered: 'Run deep setup to register the deep MCP server.',
  statusline_missing: 'Run deep setup to install the status line forwarder.',
  signed_out: 'Sign in to the agent; a run is BLOCKED until it is.',
  nested_session: 'Start the session outside another agent session, or clear the variables that mark one.',
  timing_relation_broken: 'Change the setting the relation names so both values hold.',
  telemetry_unreadable: "Change the agent's telemetry setting the item names to a protocol and address the OTLP receiver reads.",
  not_checked: 'Run deep doctor, which runs the check; an item nobody ran is never OK.',
  unknown: "Update deep: this doctor code was added after the reader's minor.",
};
const EXIT_FIXES: Record<string, string> = {
  '0': 'Nothing: the command decided PASS.',
  '1': 'Repair what the FAIL names, then run the command again.',
  '2': 'Call the command as deep --help prints it.',
  '3': 'Resolve what was not decided: a BLOCKED, INVALID or INCONCLUSIVE item, or a code no enum lists.',
};
const VERDICT_FIXES: Record<string, string> = {
  PASS: 'Nothing: every requirement is proven.',
  FAIL: 'Repair the requirement the verdict names.',
  INVALID: "Make the check able to fail: run tests, unmask the exit status, cite a run that was made.",
  BLOCKED: 'Remove what blocks the check: sign in, install the environment, record the missing run.',
  INCONCLUSIVE: 'Settle what the verdict could not: an edited assertion, a flaky check, a run still pending.',
};

/** Small schemas and the values that raise each validation code against them, with each value's clean twin. */
const record = (properties: Schema, required: string[] = Object.keys(properties)): Schema => ({ type: 'object', properties, required, additionalProperties: false });
const REFUSALS: Record<string, { entry: JsonValue; twin: JsonValue; fix: string }> = {
  unknown_schema: { entry: { schema: 'planted.unknown@1', value: {} }, twin: { schema: 'hook.ack@1', value: { ack: ULID, hold_until_ms: null } }, fix: 'Name a published contract schema.' },
  not_json: { entry: { schema: record({ n: { type: 'integer' } }), text: '{"n": 1' }, twin: { schema: record({ n: { type: 'integer' } }), text: '{"n": 1}' }, fix: 'Send one JSON text.' },
  type: { entry: { schema: record({ n: { type: 'integer' } }), value: { n: 'one' } }, twin: { schema: record({ n: { type: 'integer' } }), value: { n: 1 } }, fix: 'Send the type the schema names at this path.' },
  required: { entry: { schema: record({ n: { type: 'integer' } }), value: {} }, twin: { schema: record({ n: { type: 'integer' } }), value: { n: 1 } }, fix: 'Add the field the schema requires.' },
  unlisted_field: { entry: { schema: record({ n: { type: 'integer' } }), value: { n: 1, mood: 'calm' } }, twin: { schema: record({ n: { type: 'integer' } }), value: { n: 1 } }, fix: 'Remove the field, or connect with the contract version that lists it.' },
  enum: { entry: { schema: record({ mood: { type: 'string', enum: ['calm', 'hurried'], 'x-closure': 'open' } }), value: { mood: 'frantic' } }, twin: { schema: record({ mood: { type: 'string', enum: ['calm', 'hurried'], 'x-closure': 'open' } }), value: { mood: 'calm' } }, fix: 'Send one of the values the schema lists.' },
  const: { entry: { schema: record({ v: { const: 1 } }), value: { v: 2 } }, twin: { schema: record({ v: { const: 1 } }), value: { v: 1 } }, fix: 'Send the value the schema fixes.' },
  pattern: { entry: { schema: record({ name: { type: 'string', pattern: '^[a-z]+$' } }), value: { name: 'Fake' } }, twin: { schema: record({ name: { type: 'string', pattern: '^[a-z]+$' } }), value: { name: 'fake' } }, fix: "Send a value that matches the field's pattern." },
  format: { entry: { schema: record({ id: { type: 'string', format: 'ulid' } }), value: { id: 'not-a-ulid' } }, twin: { schema: record({ id: { type: 'string', format: 'ulid' } }), value: { id: ULID } }, fix: "Send the value in the field's format." },
  length: { entry: { schema: record({ name: { type: 'string', minLength: 1 } }), value: { name: '' } }, twin: { schema: record({ name: { type: 'string', minLength: 1 } }), value: { name: 'fake' } }, fix: "Send a value within the field's length bounds." },
  range: { entry: { schema: record({ n: { type: 'integer', minimum: 0, maximum: 10 } }), value: { n: 11 } }, twin: { schema: record({ n: { type: 'integer', minimum: 0, maximum: 10 } }), value: { n: 10 } }, fix: "Send a value within the field's range." },
  union: {
    entry: { schema: { oneOf: [record({ kind: { const: 'a' } }), record({ kind: { const: 'b' } })] }, value: { kind: 'c' } },
    twin: { schema: { oneOf: [record({ kind: { const: 'a' } }), record({ kind: { const: 'b' } })] }, value: { kind: 'a' } },
    fix: "Set the union's tag to one of its listed values.",
  },
  uncatalogued_kind: { entry: { bindings: ['planted.kind'] }, twin: { bindings: ['session.start'] }, fix: "Bind to an event kind in the catalogue, or add the kind's schema." },
  handle_syntax: { entry: { handle: 'no-colon' }, twin: { handle: `task:${ULID}` }, fix: 'Write the handle as <scheme>:<id>[#<fragment>].' },
  handle_scheme: { entry: { handle: `planted:${ULID}` }, twin: { handle: `task:${ULID}` }, fix: 'Use a handle scheme from the closed list.' },
  digest_algorithm: { entry: { digest: `md5:${HEX}` }, twin: { digest: `d1:${HEX}` }, fix: 'Write the digest as d1:<64 lower-case hex>, naming its algorithm.' },
};

/** One planted entry per code of every family, built from the families' current codes. */
export function planted(families: readonly CodeFamily[]): PlantedEntry[] {
  const out: PlantedEntry[] = [];
  const codes = (family: FamilyName): string[] => families.find((f) => f.family === family)?.codes ?? [];
  for (const code of codes('verdict')) out.push(entry('verdict', code, { outcome: code }, { outcome: 'pending' }, VERDICT_FIXES[code] ?? `Resolve the ${code} verdict.`));
  for (const code of codes('run')) out.push(entry('run', code, runFinished(code), runStarted, RUN_FIXES[code] ?? `Resolve the ${code} run.`));
  for (const code of codes('refusal')) {
    const planted = REFUSALS[code];
    if (planted) out.push(entry('refusal', code, planted.entry, planted.twin, planted.fix));
  }
  for (const code of codes('check')) out.push(entry('check', code, { check: 'contracts.unit', findings: [code] }, { check: 'contracts.unit', findings: [] }, CHECK_FIXES[code] ?? `Resolve the ${code} finding.`));
  for (const code of codes('doctor')) {
    out.push(entry('doctor', code, { items: [{ code, level: code === 'healthy' ? 'ok' : code === 'not_checked' ? 'skip' : 'fail', evidence: `planted ${code}`, fix: DOCTOR_FIXES[code] ?? 'See deep doctor.' }] }, { items: [] }, DOCTOR_FIXES[code] ?? `Resolve the ${code} item.`));
  }
  for (const code of codes('exit')) out.push(entry('exit', code, { status: Number(code) }, { status: null, signal: 'SIGTERM' }, EXIT_FIXES[code] ?? `Resolve exit ${code}.`));
  // A refusal code with no planted value above has no entry, which the kit check names until one is planted.
  return out;
}
