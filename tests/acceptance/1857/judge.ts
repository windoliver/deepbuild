// The judges of the #1857 acceptance tests: each decides one clause of a criterion from what a bounded child gave
// back (`bounded.mjs`'s result, a reply, a time, a peak) and returns its failures as sentences that name what
// failed. Nothing here starts a process or imports the test runner, so each judge can be run against planted
// inputs by itself (README: What was checked without a build). Nothing here stands in for the check or the draw.

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const isObject = (value: JsonValue | undefined): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);
const sortedKeys = (o: JsonObject): string[] => Object.keys(o).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
/** One canonical text per JSON value (keys sorted at every depth). */
export function canon(value: JsonValue | undefined): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (isObject(value)) return `{${sortedKeys(value).map((k) => `${JSON.stringify(k)}:${canon(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const shown = (value: JsonValue | undefined, most = 1500): string => (JSON.stringify(value) ?? 'undefined').slice(0, most);

// ---------------------------------------------------------------------------------------------------
// The issue's own numbers.

/** A repeat's most (Recipe: "at most 1,024 per repeat"); every fixture's count. */
export const REPEAT = 1024;
/** Criteria 1 to 4: "in under 1 s", read on the check's own clock (`timing.check_ms`). */
export const CHECK_LIMIT_MS = 1000;
/** Criterion 1: "peak memory under 64 MB", read on the child's peak memory footprint (README: Readings). */
export const PEAK_LIMIT_BYTES = 64 * 1024 * 1024;
/** Criterion 5: "hangs a child process past 5 s". */
export const HANG_MS = 5000;

// ---------------------------------------------------------------------------------------------------
// The cap, as the design states it.

/** The words the issue's Scope says the cap is stated beside. */
export const BESIDE = 'at most 1,024 per repeat';

/** One section of a design file: from its `#### <title>` line to the next heading. */
export function sectionOf(markdown: string, title: string): string | null {
  const lines = markdown.split('\n');
  const from = lines.findIndex((line) => line.trim() === `#### ${title}`);
  if (from < 0) return null;
  const rest = lines.slice(from + 1);
  const to = rest.findIndex((line) => /^#{1,6} /.test(line));
  return rest.slice(0, to < 0 ? rest.length : to).join('\n');
}

/** The first whole number written in digits in `text` (`100,000` or `100000`), or null. */
function firstNumber(text: string): number | null {
  const found = /\d{1,3}(?:,\d{3})+|\d+/.exec(text);
  return found ? Number(found[0].replace(/,/g, '')) : null;
}

/**
 * The cap the Recipe section states: on the line that holds "at most 1,024 per repeat", the first number written
 * after those words. `{cap}` or `{failure}`.
 */
export function capOf(design: string): { cap: number; failure: null } | { cap: null; failure: string } {
  const recipe = sectionOf(design, 'Recipe');
  if (recipe === null) return { cap: null, failure: 'docs/canvas-primitives.md holds no `#### Recipe` section' };
  const line = recipe.split('\n').find((l) => l.includes(BESIDE));
  if (line === undefined) return { cap: null, failure: `the Recipe section no longer says "${BESIDE}"` };
  const cap = firstNumber(line.slice(line.indexOf(BESIDE) + BESIDE.length));
  if (cap === null) return { cap: null, failure: `the Recipe section states no cap beside "${BESIDE}": no number follows those words on their line` };
  if (!Number.isSafeInteger(cap) || cap < REPEAT) return { cap: null, failure: `the cap the Recipe section states beside "${BESIDE}", ${cap}, is below one repeat's ${REPEAT}` };
  return { cap, failure: null };
}

/** `text` holds the whole number `n`, in digits or grouped by commas, and not as part of a longer number. */
export function holdsNumber(text: string, n: number): boolean {
  const plain = String(n);
  const grouped = plain.replace(/\B(?=(\d{3})+$)/g, ',');
  if (new RegExp(`(?<![\\d.])${plain}(?!\\.?\\d)`).test(text)) return true;
  return grouped !== plain && new RegExp(`(?<![\\d.])(?<!\\d,)${grouped}(?!,?\\d)`).test(text);
}

// ---------------------------------------------------------------------------------------------------
// A bounded child: what `bounded.mjs` writes.

export interface Stopped { why: 'memory' | 'deadline' | 'exit'; line: number | null; bytes?: number; afterMs?: number }
export interface Bounded {
  spawned: boolean; error?: string; timed: boolean;
  answers: { text: string | null; ms: number }[];
  stopped: Stopped | null;
  exit: { code: number | null; signal: string | null } | null;
  peakBytes: number | null; footprintBytes: number | null; sampledPeakBytes: number; samples: number;
  stderrTail: string; wallMs: number;
}
const mb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** The words every "ran out" failure starts with, which a planted program's test reads. */
export const OUT_OF_TIME = 'ran out of time';
export const OUT_OF_MEMORY = 'ran out of memory';
export const BLOCKED = 'BLOCKED';

/**
 * Whether the child ran to its own end inside its limits: started, never stopped by PID, exit 0, one answer per
 * line. A child that had to be stopped ran out of time or memory, whatever the machine.
 */
export function boundFailures(r: Bounded, what: string, limits: { limitBytes: number }): string[] {
  if (!r.spawned) return [`${BLOCKED}: ${what} could not start: ${r.error ?? 'no process'}`];
  const failures: string[] = [];
  if (r.stopped?.why === 'memory') failures.push(`${what} ${OUT_OF_MEMORY}: its resident memory reached ${mb(r.stopped.bytes ?? 0)}, past its limit of ${mb(limits.limitBytes)}, and it was stopped by PID`);
  else if (r.stopped?.why === 'deadline') failures.push(`${what} ${OUT_OF_TIME}: no answer ${((r.stopped.afterMs ?? 0) / 1000).toFixed(1)} s after it was asked, and it was stopped by PID`);
  else if (r.stopped?.why === 'exit') failures.push(`${what} ${OUT_OF_TIME}: it was still running ${((r.stopped.afterMs ?? 0) / 1000).toFixed(1)} s after its input closed, and it was stopped by PID`);
  else if (r.answers.some((a) => a.text === null)) failures.push(`${what} ended without an answer (exit ${r.exit?.code ?? 'none'}, signal ${r.exit?.signal ?? 'none'}): ${r.stderrTail.slice(-600)}`);
  else if (r.exit === null || r.exit.code !== 0) failures.push(`${what} did not stay up to its own end: exit ${r.exit?.code ?? 'none'}, signal ${r.exit?.signal ?? 'none'}: ${r.stderrTail.slice(-600)}`);
  return failures;
}

/** A failure that says the child ran out of time or of memory: how criterion 1's planted expansion must fail. */
export const ranOut = (failure: string): boolean => failure.includes(OUT_OF_TIME) || failure.includes(OUT_OF_MEMORY);

// ---------------------------------------------------------------------------------------------------
// Replies of `deep-show run`.

/** The replies of one scenario line: `{ok: true, replies: [...]}`. */
export function repliesOf(answer: string | null, calls: number, what: string): { replies: JsonObject[]; failures: string[] } {
  if (answer === null) return { replies: [], failures: [`${what} gave no answer`] };
  let parsed: JsonValue;
  try { parsed = JSON.parse(answer) as JsonValue; } catch { return { replies: [], failures: [`${what} answered no JSON: ${answer.slice(0, 300)}`] }; }
  if (!isObject(parsed) || parsed['ok'] !== true) return { replies: [], failures: [`${what}: deep-show run refused the scenario: ${shown(parsed, 1200)}`] };
  const list = parsed['replies'];
  if (!Array.isArray(list) || list.length !== calls || !list.every(isObject)) return { replies: [], failures: [`${what}: deep-show run gave ${Array.isArray(list) ? list.length : 'no'} replies for ${calls} calls`] };
  return { replies: list as JsonObject[], failures: [] };
}

/**
 * The `packs` reply (#306) lists the test pack as installed. A pack of this suite that doesn't install is a fault of
 * the fixture or a refusal at the pack's check, where the criteria refuse the instance at the document's.
 */
export function installFailures(reply: JsonObject, pack: { id: string; version: string }, what: string): string[] {
  const rows = (Array.isArray(reply['packs']) ? reply['packs'] : []).filter(isObject).filter((r) => r['pack'] === pack.id && String(r['version'] ?? '') === pack.version);
  if (rows.length !== 1) return [`${what}: the packs reply has ${rows.length} rows for ${pack.id}@${pack.version}: ${shown(reply, 600)}`];
  if (rows[0]!['state'] !== 'installed') return [`${what}: the test pack ${pack.id}@${pack.version} is not installed (${shown(rows[0]!['state'])}), so its instance was never checked: ${shown(rows[0]!['issues'] ?? null, 800)}`];
  return [];
}

export interface Issue { code: string; severity: string; ids: string[]; path: string; actual: JsonValue | undefined; raw: JsonObject }
export function issuesOf(reply: JsonObject): Issue[] {
  const list = reply['issues'];
  if (!Array.isArray(list)) return [];
  return list.filter(isObject).map((o) => ({
    code: typeof o['code'] === 'string' ? o['code'] : '', severity: typeof o['severity'] === 'string' ? o['severity'] : '',
    ids: Array.isArray(o['ids']) ? o['ids'].filter((x): x is string => typeof x === 'string') : [],
    path: typeof o['path'] === 'string' ? o['path'] : '', actual: o['actual'], raw: o,
  }));
}
const brief = (list: Issue[]): string => list.length === 0 ? 'none' : list.slice(0, 6).map((i) => shown(i.raw, 400)).join(' | ');

/** What a criterion says its `over_budget` refusal names. */
export interface Names {
  /** The document's instance: in the issue's `ids`, as itself or as a derived ID under it. */
  instance: string;
  /** Criterion 1: the issue's `path` holds `steps/<one of these>`. */
  steps?: readonly string[];
  /** Criterion 2: the issue's text holds the input's name. */
  input?: string;
  /** Criterion 3: the issue's `path` holds this run of segments (`steps/<step>/params/<param>`). */
  param?: string;
  /** The cap the Recipe section states; null when it states none (itself a failure, reported by `capOf`). */
  cap: number | null;
}

const segments = (path: string): string[] => path.split('/');
const holdsRun = (path: string, run: string): boolean => `/${path}/`.includes(`/${run}/`);

/** What one `over_budget` error lacks of what its criterion says it names; [] when it names all of it. */
export function lacks(issue: Issue, names: Names): string[] {
  const out: string[] = [];
  const text = canon(issue.raw);
  if (!issue.ids.some((id) => id === names.instance || id.startsWith(`${names.instance}.`))) out.push(`its ids ${shown(issue.ids)} don't name the instance ${names.instance}`);
  if (names.steps) {
    const at = segments(issue.path);
    if (!names.steps.some((step) => at.some((s, i) => s === 'steps' && at[i + 1] === step))) out.push(`its path \`${issue.path}\` names no step of the chain (steps/${names.steps.join(' | steps/')})`);
  }
  if (names.input !== undefined && !new RegExp(`(?<![A-Za-z0-9_])${names.input}(?![A-Za-z0-9_])`).test(text)) out.push(`it doesn't name the input ${names.input}`);
  if (names.param !== undefined && !holdsRun(issue.path, names.param)) out.push(`its path \`${issue.path}\` doesn't hold the param's path ${names.param}`);
  if (names.cap !== null) {
    if (!holdsNumber(text, names.cap)) out.push(`it doesn't name the cap ${names.cap}`);
    if (typeof issue.actual !== 'number' || !Number.isInteger(issue.actual) || issue.actual <= names.cap) out.push(`its actual ${shown(issue.actual, 120)} is not the count it would reach, a whole number past the cap ${names.cap}`);
  }
  return out;
}

/**
 * A reply that refuses the document with one `over_budget` error naming what the criterion says: the instance,
 * the step or the input or the param's path, the cap, and the count it would reach.
 */
export function refusalFailures(reply: JsonObject, names: Names, what: string): string[] {
  const failures: string[] = [];
  if (reply['outcome'] !== 'refused') failures.push(`${what} is not refused: its outcome is ${shown(reply['outcome'])}`);
  const errors = issuesOf(reply).filter((i) => i.severity === 'error');
  const over = errors.filter((i) => i.code === 'over_budget');
  if (over.length === 0) return [...failures, `${what} has no over_budget error: no cap refuses it; its errors: ${brief(errors)}`];
  const missing = over.map((i) => lacks(i, names));
  if (!missing.some((m) => m.length === 0)) failures.push(`${what}: no over_budget error names all its criterion says: ${over.map((i, k) => `${shown(i.raw, 400)}: ${missing[k]!.join('; ')}`).join(' | ')}`);
  return failures;
}

/** The check's own time, `timing.check_ms` (#306's reply field), or a failure naming its absence. */
export function checkMs(reply: JsonObject, what: string): { ms: number; failure: null } | { ms: null; failure: string } {
  const timing = reply['timing'];
  const ms = isObject(timing) ? timing['check_ms'] : undefined;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return { ms: null, failure: `${what} carries no timing.check_ms though the call asked for it: ${shown(timing, 200)}` };
  return { ms, failure: null };
}

// ---------------------------------------------------------------------------------------------------
// The design's rule for a timing or a peak (Every task carries its own budgets).

export type Verdict = { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; shown: string };
/** Five runs after a warm-up: PASS all under the limit; FAIL all over it by more than the margin (the larger of 5% and their spread); else INCONCLUSIVE. */
export function judgeRuns(name: string, runs: readonly number[], limit: number, unit: string): Verdict {
  const low = Math.min(...runs);
  const margin = Math.max(0.05, (Math.max(...runs) - low) / Math.max(low, 1e-9));
  const text = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} ${unit} against ${limit} ${unit} (margin ${(margin * 100).toFixed(0)}%)`;
  if (runs.length !== 5) return { status: 'INCONCLUSIVE', shown: `${text}: not five runs` };
  if (runs.every((r) => r < limit)) return { status: 'PASS', shown: text };
  if (runs.every((r) => r > limit * (1 + margin))) return { status: 'FAIL', shown: text };
  return { status: 'INCONCLUSIVE', shown: text };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 4: the check ran whole.

/** The expansion of `instance` holds exactly the derived IDs `expected`, and no error is `over_budget`. */
export function expandedFailures(reply: JsonObject, instance: string, expected: readonly string[], what: string): string[] {
  const failures: string[] = [];
  const over = issuesOf(reply).filter((i) => i.code === 'over_budget' && i.severity === 'error');
  if (over.length) failures.push(`${what} is refused with over_budget, though it expands to ${expected.length} derived items: ${shown(over[0]!.raw, 400)}`);
  const rows = Array.isArray(reply['expansions']) ? reply['expansions'].filter(isObject).filter((e) => e['instance'] === instance) : [];
  if (rows.length !== 1) return [...failures, `${what} has ${rows.length} expansions of ${instance}, not one: its issues: ${shown(reply['issues'] ?? null, 600)}`];
  const derived = rows[0]!['derived'];
  const got = isObject(derived) ? Object.keys(derived) : [];
  const want = new Set(expected);
  const have = new Set(got);
  const missing = expected.filter((id) => !have.has(id));
  const extra = got.filter((id) => !want.has(id));
  if (missing.length || extra.length) failures.push(`${what}: ${instance} expands to ${got.length} derived items, not the ${expected.length} its recipe makes: missing ${missing.slice(0, 5).join(', ') || 'none'}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}; extra ${extra.slice(0, 5).join(', ') || 'none'}${extra.length > 5 ? ` and ${extra.length - 5} more` : ''}`);
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// Criteria 5 and 6: a look's refusal, as a `layers` reply of `deep-gpu run` gives it (#149: a refused call
// answers `{code, path, …}` and no `layers`).

/** The replies of one `deep-gpu run` line: `{ok: true, replies: [...]}`. */
export const gpuRepliesOf = (answer: string | null, calls: number, what: string): { replies: JsonObject[]; failures: string[] } => {
  const read = repliesOf(answer, calls, what);
  return { replies: read.replies, failures: read.failures.map((f) => f.replace('deep-show run', 'deep-gpu run')) };
};

/** The look is refused with `out_of_range` at exactly `path`, and nothing is drawn. */
export function lookRefusalFailures(reply: JsonObject, path: string, what: string): string[] {
  const failures: string[] = [];
  if (reply['code'] === undefined) return [`${what} is not refused: the look was admitted${Array.isArray(reply['layers']) ? ' and drawn' : ''}: ${shown(reply, 300)}`];
  if (reply['code'] !== 'out_of_range') failures.push(`${what} is refused with ${shown(reply['code'])}, not out_of_range: ${shown(reply, 300)}`);
  if (reply['path'] !== path) failures.push(`${what}: the refusal names ${shown(reply['path'])}, not ${path}`);
  if (reply['layers'] !== undefined) failures.push(`${what} is refused and drawn all the same`);
  return failures;
}

/** The look is admitted and its layers are drawn: no `code`, and a `layers` list. */
export function lookAdmittedFailures(reply: JsonObject, what: string): string[] {
  if (reply['code'] !== undefined) return [`${what} is refused: ${shown(reply, 400)}`];
  if (!Array.isArray(reply['layers']) || reply['layers'].length === 0) return [`${what} draws no layer: ${shown(reply, 400)}`];
  return [];
}
