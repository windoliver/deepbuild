// Shared by the #3539 acceptance tests: reads the spike's record (docs/spikes/3539/record.json), the scripts and run
// outputs it cites and the spike's report, and works out from them, and from the gate package's own `simulate` at the
// record's `main` (base.mjs), everything a test can work out instead of taking the spike's word (AGENTS.md,
// invariant 1). Each check returns a list of problems; an empty list means it holds. Missing or unrun input is a
// problem that starts with its state, never a pass (invariant 2). Formats: README.md, "The surface under test".
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { git, REPO, simulateAt } from './base.mjs';

export { REPO };
export const SPIKE = 'docs/spikes/3539';
export const HARNESS = `${SPIKE}/harness.mjs`;
export const ISSUE = 3539;

/** The issue's counts of sessions whose turns nobody typed, beside the person's session. */
export const OTHERS = [1, 3, 6];
/** The issue's pools, in slots. */
export const POOLS = [2, 4, 9];
/** The issue's slow checks, 1, 5 and 20 minutes: what a run of each takes, and its expected time, the time it took when drafted. */
export const SLOW_MS = [60_000, 300_000, 1_200_000];
/** Today's order, and the issue's one changed order: places whose turn a person opened first and then as today. */
export const ORDERS = ['today', 'person-first'];
/** The planted twins of the spike's harness, each chosen by `--plant <name>` (README.md, "The wrong harnesses"). */
export const PLANTS = { start: 'times-from-start', gain: 'reports-a-gain' };
/** The scheduler's origins (`Origin`, packages/gate/src/scheduler.ts): a person's, and the five nobody typed. */
export const PERSON = 'human';
export const AUTOMATIC = ['continuation', 'scheduled', 'subagent', 'session', 'unknown'];
const ORIGINS = [PERSON, 'app', 'answer', ...AUTOMATIC];
const EVENT_KINDS = ['prompt', 'words', 'edit', 'claim', 'facts', 'tool_call', 'retention', 'stop'];
const CONFIG_KEYS = ['budget_ms', 'hold_ms', 'slots', 'grace_ms', 'stop_timeout_ms'];
const CHECK_KEYS = ['id', 'on_base', 'inputs', 'expected_ms', 'took_ms'];

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const isCommit = (v) => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v);
/** A path a record may name: relative, no `..`, no absolute folder. */
const relative = (p) => nonEmpty(p) && !p.startsWith('/') && !p.startsWith('~') && !p.split('/').includes('..') && !/^[A-Za-z]:/.test(p);
const close = (a, b) => (a === null || b === null ? a === b : finite(a) && Math.abs(a - b) <= 1e-6);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** At most `most` of one output's problems of one kind, the rest counted. */
const some = (problems, at, most = 6) => (problems.length > most ? [...problems.slice(0, most), `${at}: and ${problems.length - most} more rows that differ`] : problems);

// ------------------------------------------------------------------ a failure's state

const PRECEDENCE = ['FAIL', 'INVALID', 'BLOCKED', 'INCONCLUSIVE'];
const NAMED = /^(BLOCKED|INCONCLUSIVE|INVALID)\b:?\s*/;
/** The state a problem names: the one it starts with, else FAIL (as scripts/lanes.mjs reads a failure's message). */
export const stateOf = (problem) => NAMED.exec(problem)?.[1] ?? 'FAIL';

/**
 * Fails the test when `problems` holds any, in the worst state among them by the design's precedence (FAIL, INVALID,
 * BLOCKED, INCONCLUSIVE), as #3444's suite does. The message starts with that state unless it is FAIL, then the
 * criterion's tag and the first problem in that state, then every problem.
 */
export function holds(tag, problems) {
  if (!problems.length) return;
  const worst = PRECEDENCE.find((state) => problems.some((p) => stateOf(p) === state));
  const first = problems.find((p) => stateOf(p) === worst).replace(NAMED, '');
  const head = `${worst === 'FAIL' ? '' : `${worst}: `}${tag}: ${first}`;
  assert.fail(problems.length > 1 ? `${head}\nall ${problems.length} problems:\n${problems.join('\n')}` : head);
}

// ------------------------------------------------------------------ reading what is kept

/** The record, or the problems that kept it from being read. `dir` is the checkout holding docs/spikes/3539/. */
export function loadRecord(dir = REPO) {
  const path = join(dir, SPIKE, 'record.json');
  if (!existsSync(path)) return { problems: [`BLOCKED: no spike record at ${SPIKE}/record.json: the spike hasn't been recorded`] };
  try {
    const record = JSON.parse(readFileSync(path, 'utf8'));
    return isObj(record) ? { record, problems: [] } : { problems: [`${SPIKE}/record.json is not a JSON object`] };
  } catch (error) {
    return { problems: [`${SPIKE}/record.json is not JSON: ${error.message}`] };
  }
}

/** A file of the spike folder, by a path relative to it, or null. */
function spikeBytes(dir, file) {
  if (!relative(file)) return null;
  const path = join(dir, SPIKE, file);
  return existsSync(path) && statSync(path).isFile() ? readFileSync(path) : null;
}

/** The spike's report, docs/spikes/3539/README.md, or null. */
const report = (dir) => spikeBytes(dir, 'README.md')?.toString('utf8') ?? null;
const NO_REPORT = `BLOCKED: no report at ${SPIKE}/README.md`;

/** `main`: the full hash of the main commit the readings ran on, a commit of this checkout's history. */
function mainProblems(record) {
  if (!isCommit(record?.main)) return ['main is not the full hash of the main commit the readings ran on'];
  if (git(['cat-file', '-e', `${record.main}^{commit}`]).status !== 0) return [`BLOCKED: main ${record.main} is not a commit this checkout's git has`];
  if (git(['merge-base', '--is-ancestor', record.main, 'HEAD']).status !== 0) return [`main ${record.main} is not an ancestor of HEAD`];
  return [];
}

/** The gate package's `simulate` at the record's `main`, or null with the BLOCKED problem that says why not. */
async function simulateOf(record, problems) {
  if (problems.length) return null;
  try {
    return await simulateAt(record.main);
  } catch (error) {
    problems.push(String(error?.message ?? error).startsWith('BLOCKED') ? error.message : `BLOCKED: the package's scheduler at main ${record.main} can't be run: ${error?.message ?? error}`);
    return null;
  }
}

/** A kept file the record cites by its path in the spike folder and its sha256: its bytes, or the BLOCKED problem. */
function cited(dir, path, hash, at) {
  if (!relative(path)) return { problems: [`BLOCKED: ${at}: ${JSON.stringify(path)} is not a path relative to ${SPIKE}/`] };
  const bytes = spikeBytes(dir, path);
  if (bytes === null) return { problems: [`BLOCKED: ${at}: ${path} is not kept with the spike`] };
  if (hash !== sha256(bytes)) return { problems: [`BLOCKED: ${at}: sha256 of ${path} is not what the record says`] };
  return { bytes, problems: [] };
}

// ------------------------------------------------------------------ a script

/**
 * A script's own shape (README.md, "A script"): the scheduler's `Scenario` as data, each check's `run` function
 * replaced by `took_ms`, the time one run of it takes. Every run passes.
 */
export function scriptProblems(script, at) {
  if (!isObj(script)) return [`${at}: is not a JSON object`];
  const problems = [];
  if (script.config !== undefined) {
    if (!isObj(script.config)) problems.push(`${at}: config is not an object`);
    else for (const [k, v] of Object.entries(script.config)) if (!CONFIG_KEYS.includes(k) || !finite(v) || v < 0) problems.push(`${at}: config.${k} is not one of the scheduler's settings (${CONFIG_KEYS.join(', ')}) with a number`);
  }
  if (script.foreign !== undefined && !(Array.isArray(script.foreign) && script.foreign.every((f) => isObj(f) && [f.at, f.ms, f.slots].every((n) => finite(n) && n >= 0)))) problems.push(`${at}: foreign is not a list of { at, ms, slots }`);
  const sessions = list(script.sessions);
  if (!sessions.length) problems.push(`${at}: sessions holds no session`);
  const ids = new Set();
  sessions.forEach((s, i) => {
    if (!isObj(s) || !nonEmpty(s.id)) { problems.push(`${at}: sessions[${i}] has no id`); return; }
    const here = `${at}: session ${JSON.stringify(s.id)}`;
    if (ids.has(s.id)) problems.push(`${here} is there twice`);
    ids.add(s.id);
    if (!Array.isArray(s.checks)) problems.push(`${here}: checks is not a list`);
    const checks = new Set();
    for (const c of list(s.checks)) {
      if (!isObj(c) || !nonEmpty(c.id)) { problems.push(`${here}: a check has no id`); continue; }
      const name = `${here}: check ${JSON.stringify(c.id)}`;
      if (checks.has(c.id)) problems.push(`${name} is there twice`);
      checks.add(c.id);
      for (const k of Object.keys(c)) if (!CHECK_KEYS.includes(k)) problems.push(`${name}: ${k} is not a field a script's check holds (${CHECK_KEYS.join(', ')})`);
      if (c.on_base !== 'fails' && c.on_base !== 'passes') problems.push(`${name}: on_base is neither fails nor passes`);
      if (!Array.isArray(c.inputs) || !c.inputs.every(nonEmpty)) problems.push(`${name}: inputs is not a list of globs`);
      if (!finite(c.expected_ms) || c.expected_ms <= 0) problems.push(`${name}: expected_ms is not a time above 0`);
      if (!finite(c.took_ms) || c.took_ms < 0) problems.push(`${name}: took_ms (the time one run of it takes) is not a time`);
    }
    if (!Array.isArray(s.events)) problems.push(`${here}: events is not a list`);
    list(s.events).forEach((e, j) => {
      const event = `${here}: events[${j}]`;
      if (!isObj(e) || !finite(e.at) || e.at < 0 || !EVENT_KINDS.includes(e.kind)) { problems.push(`${event} is not an event of the scheduler's script: at, and a kind among ${EVENT_KINDS.join(', ')}`); return; }
      if (e.kind === 'prompt' && !ORIGINS.includes(e.origin)) problems.push(`${event}: origin ${JSON.stringify(e.origin)} is not one of the scheduler's origins (${ORIGINS.join(', ')})`);
      if ((e.kind === 'stop' || e.kind === 'edit') && (!nonEmpty(e.snapshot) || !Array.isArray(e.changed) || !e.changed.every(nonEmpty))) problems.push(`${event}: ${e.kind === 'stop' ? 'a stop' : 'an edit'} names its snapshot and the paths it changed`);
    });
  });
  return problems;
}

/** The `Scenario` a script is: the same data, each check with a `run` that takes `took_ms` and passes. */
export function scenarioOf(script) {
  const copy = structuredClone(script);
  return { ...copy, sessions: copy.sessions.map((s) => ({ ...s, checks: s.checks.map(({ took_ms, ...check }) => ({ ...check, run: () => ({ took_ms, outcome: 'passed' }) })) })) };
}

/**
 * Who opened each session's turns, read from its prompts: `person`, the sessions whose every prompt is a person's
 * (`human`); `others`, those whose every prompt is one nobody typed and that hold no typed words; `mixed`, the rest
 * (a prompt of the app's or an answer's, both kinds of prompt, typed words in a session nobody types in, or no prompt).
 */
export function whoOf(script) {
  const who = { person: [], others: [], mixed: [] };
  for (const s of list(script?.sessions)) {
    const origins = list(s?.events).filter((e) => e?.kind === 'prompt').map((e) => e.origin);
    const typed = list(s?.events).some((e) => e?.kind === 'words');
    if (origins.length && origins.every((o) => o === PERSON)) who.person.push(s.id);
    else if (origins.length && origins.every((o) => AUTOMATIC.includes(o)) && !typed) who.others.push(s.id);
    else who.mixed.push(s.id);
  }
  return who;
}
const stopsOf = (session) => list(session?.events).filter((e) => e?.kind === 'stop');

/**
 * What the issue's Scope asks of a script of the table: one session whose turns a person opened, beside `others`
 * sessions whose turns nobody typed, each stopping with slow checks of 1, 5 and 20 minutes, on a pool of `pool` slots.
 */
export function tableScriptProblems(script, others, pool, at) {
  const problems = [];
  const who = whoOf(script);
  if (who.person.length !== 1) problems.push(`${at}: ${plural(who.person.length, 'session')} with every turn opened by a person (origin ${PERSON}), not one`);
  if (who.mixed.length) problems.push(`${at}: the turns of ${who.mixed.map((id) => JSON.stringify(id)).join(', ')} are neither all a person's nor all ones nobody typed (${AUTOMATIC.join(', ')}, and no typed words)`);
  if (who.others.length !== others) problems.push(`${at}: ${plural(who.others.length, 'session')} whose turns nobody typed, not ${others}`);
  if (!isDeepStrictEqual(script.config, { slots: pool })) problems.push(`${at}: config is ${JSON.stringify(script.config)}, not { "slots": ${pool} }: a pool of ${pool} slots and the scheduler's own defaults`);
  if (list(script.foreign).length) problems.push(`${at}: foreign holds slots: the others are sessions of the script`);
  for (const s of script.sessions) {
    const times = list(s.checks).map((c) => c.expected_ms).sort((a, b) => a - b);
    if (!isDeepStrictEqual(times, SLOW_MS)) problems.push(`${at}: session ${JSON.stringify(s.id)}'s checks have expected times of ${JSON.stringify(times)} ms, not the three slow checks of 1, 5 and 20 minutes (${JSON.stringify(SLOW_MS)})`);
    for (const c of list(s.checks)) if (c.took_ms !== c.expected_ms) problems.push(`${at}: session ${JSON.stringify(s.id)}'s check ${JSON.stringify(c.id)} takes ${c.took_ms} ms, not its ${c.expected_ms}: a slow check of 1, 5 or 20 minutes takes that long`);
    if (!stopsOf(s).length) problems.push(`${at}: session ${JSON.stringify(s.id)} never stops`);
  }
  const bases = new Set(script.sessions.flatMap((s) => list(s.checks).map((c) => c.on_base)));
  if (bases.size > 1) problems.push(`${at}: its checks are not all of one on_base, so "as today" would sort them too and the changed order can't be read alone`);
  return problems;
}

/** The script with its person's session's checks marked `on_base: fails` and every other check `passes`. */
function personFirstScript(script, person) {
  const copy = structuredClone(script);
  for (const s of copy.sessions) for (const c of s.checks) c.on_base = s.id === person ? 'fails' : 'passes';
  return copy;
}

// ------------------------------------------------------------------ a run's rows

export const placeKey = (p) => `${p?.session}\u0000${p?.check}\u0000${p?.snapshot}`;
export const placeName = (p) => `${p?.session}'s check ${p?.check} on snapshot ${p?.snapshot}`;
const stopKey = (s) => `${s?.session}\u0000${s?.stop}`;

/**
 * The rows a run's output holds (README.md, "A run's output"), read from the `Trace` `simulate` returns.
 * `places`: every slow-lane place, a session's check on one snapshot that took a place, queued or held (`Trace.queue`),
 * with the time it took it, the start of its first slow-lane run and the end of its last (`Trace.runs`), null when it
 * never started. `stops`: every green stop, one whose reply ended the turn (`StopReply.kind` `ends_turn`), with its
 * time and the time its claim's verdict landed: the end of the last run its checks rest on, never before its reply,
 * and null while its claim reads `pending` when the script ends.
 */
export function rowsOf(trace) {
  const places = new Map();
  for (const q of trace.queue) {
    if ((q.op === 'queued' || q.op === 'held') && !places.has(placeKey(q))) places.set(placeKey(q), { session: q.session, check: q.check, snapshot: q.snapshot, queued_at: q.at, started_at: null, ended_at: null });
  }
  for (const r of trace.runs) {
    if (r.lane !== 'slow') continue;
    if (!places.has(placeKey(r))) places.set(placeKey(r), { session: r.session, check: r.check, snapshot: r.snapshot, queued_at: r.queued_at ?? r.started_at, started_at: null, ended_at: null });
    const place = places.get(placeKey(r));
    if (place.started_at === null) place.started_at = r.started_at;
    place.ended_at = Math.max(place.ended_at ?? r.ended_at, r.ended_at);
  }
  const runs = new Map(trace.runs.map((r) => [r.run, r]));
  const claims = new Map(trace.claims.map((c) => [c.claim, c]));
  const stops = trace.stops.filter((s) => s.kind === 'ends_turn').map((s) => {
    const claim = claims.get(s.claim);
    const rests = claim && claim.verdict !== 'pending' ? Object.values(claim.checks).flatMap((c) => [...c.runs, ...c.carried_runs]) : null;
    return { session: s.session, stop: s.stop, snapshot: s.snapshot, at: s.at, verdict_at: rests ? Math.max(s.reply_at, ...rests.map((id) => runs.get(id)?.ended_at ?? s.reply_at)) : null };
  });
  return { places: [...places.values()], stops };
}

/**
 * A script's rows under an order, from the package's own `simulate`. Today's order is the script as it is. The
 * changed order, places whose turn a person opened first and then as today, is the same `simulate` on the script
 * with the person's session's checks marked `on_base: fails` and every other check `passes`: its dispatch takes
 * `on_base: fails` places first, then by the time they queued, then by number, so with one `on_base` in the script
 * and every turn of a session opened the same way that is exactly the person's places first and the rest as today
 * (README.md, "The changed order, to a test"). A script whose person's session never stops has no such place, so it
 * runs as it is.
 */
export function expectedRows(simulate, script, order, at) {
  const run = (s) => rowsOf(simulate(scenarioOf(s)));
  try {
    if (order === 'today') return { rows: run(script), problems: [] };
    const who = whoOf(script);
    if (who.person.length !== 1 || who.mixed.length) return { problems: [`${at}: who opened each session's turns can't be read (one session whose every prompt is ${PERSON}, the others' every prompt one nobody typed), so the changed order can't be run on it`] };
    const person = script.sessions.find((s) => s.id === who.person[0]);
    if (!stopsOf(person).length) return { rows: run(script), problems: [] };
    if (new Set(script.sessions.flatMap((s) => s.checks.map((c) => c.on_base))).size > 1) return { problems: [`${at}: its checks are not all of one on_base, so the changed order can't be run on it`] };
    return { rows: run(personFirstScript(script, person.id)), problems: [] };
  } catch (error) {
    return { problems: [`BLOCKED: ${at}: the package's simulate at main threw on the script: ${error?.message ?? error}`] };
  }
}

// ------------------------------------------------------------------ a run's output

const time = (v) => v === null || finite(v);

/** A run output's own shape, for the script (by sha256) and the order it is cited or was run for. */
export function outputProblems(out, at, want) {
  if (!isObj(out)) return [`${at}: is not a JSON object`];
  const problems = [];
  if (out.script_sha256 !== want.sha) problems.push(`${at}: script_sha256 is not the sha256 of the script it stands for: the output is another script's`);
  if (out.order !== want.order) problems.push(`${at}: order is ${JSON.stringify(out.order)}, not ${JSON.stringify(want.order)}`);
  if (!Array.isArray(out.places)) problems.push(`${at}: places is not a list`);
  const hub = want.order === 'hub';
  const seen = new Set();
  list(out.places).forEach((p, i) => {
    if (!isObj(p) || ![p.session, p.check, p.snapshot].every(nonEmpty)) { problems.push(`${at}: places[${i}] doesn't name its session, check and snapshot`); return; }
    const here = `${at}: ${placeName(p)}`;
    if (seen.has(placeKey(p))) problems.push(`${here} is there twice`);
    seen.add(placeKey(p));
    if (!time(p.started_at)) problems.push(`${here}: started_at is neither a time nor null`);
    if (hub) return;
    if (!finite(p.queued_at)) problems.push(`${here}: queued_at is not a time`);
    if (!time(p.ended_at) || (p.started_at === null) !== (p.ended_at === null)) problems.push(`${here}: ended_at is a time when it started and null when it didn't`);
    else if (finite(p.queued_at) && finite(p.started_at) && !(p.queued_at <= p.started_at && p.started_at <= p.ended_at)) problems.push(`${here}: queued ${p.queued_at}, started ${p.started_at}, ended ${p.ended_at} are out of order`);
  });
  if (hub) return problems;
  if (!Array.isArray(out.stops)) problems.push(`${at}: stops is not a list`);
  const stops = new Set();
  list(out.stops).forEach((s, i) => {
    if (!isObj(s) || ![s.session, s.stop, s.snapshot].every(nonEmpty)) { problems.push(`${at}: stops[${i}] doesn't name its session, stop and snapshot`); return; }
    const here = `${at}: stop ${s.stop}`;
    if (stops.has(stopKey(s))) problems.push(`${here} is there twice`);
    stops.add(stopKey(s));
    if (!finite(s.at)) problems.push(`${here}: at is not a time`);
    if (!time(s.verdict_at) || (finite(s.verdict_at) && finite(s.at) && s.verdict_at < s.at)) problems.push(`${here}: verdict_at is neither a time at or after the stop nor null`);
  });
  return problems;
}

/** One kept run output, cited as `{ out, sha256 }`: the parsed output or the problems. */
function readOutput(dir, ref, at, want) {
  if (!isObj(ref)) return { problems: [`BLOCKED: ${at}: the record cites no output: the script wasn't run under ${want.order}`] };
  const { bytes, problems } = cited(dir, ref.out, ref.sha256, at);
  if (!bytes) return { problems };
  let out;
  try { out = JSON.parse(bytes.toString('utf8')); } catch (error) { return { problems: [`${at}: ${ref.out} is not JSON: ${error.message}`] }; }
  const shape = outputProblems(out, `${at} (${ref.out})`, want);
  return shape.length ? { problems: shape } : { out, problems: [] };
}

/** One kept script, cited as `{ script, sha256 }`: the parsed script, its sha256 and its name, or the problems. */
function readScript(dir, entry, at) {
  const { bytes, problems } = cited(dir, entry?.script, entry?.sha256, at);
  if (!bytes) return { problems };
  const name = `${SPIKE}/${entry.script}`;
  let script;
  try { script = JSON.parse(bytes.toString('utf8')); } catch (error) { return { problems: [`${at}: ${entry.script} is not JSON: ${error.message}`] }; }
  const shape = scriptProblems(script, name);
  return shape.length ? { problems: shape } : { script, name, sha: sha256(bytes), file: join(dir, SPIKE, entry.script), problems: [] };
}

/** A kept output's rows against those the package's `simulate` at main gives for its script and order. */
function rowProblems(out, want, at, source) {
  const places = [];
  const got = new Map(out.places.map((p) => [placeKey(p), p]));
  for (const w of want.places) {
    const g = got.get(placeKey(w));
    got.delete(placeKey(w));
    if (!g) { places.push(`${at}: holds no place for ${placeName(w)}, which ${source} gives`); continue; }
    for (const field of ['queued_at', 'started_at', 'ended_at']) if (!close(g[field], w[field])) places.push(`${at}: ${placeName(w)} has ${field} ${g[field]}; ${source} gives ${w[field]}`);
  }
  for (const g of got.values()) places.push(`${at}: holds a place for ${placeName(g)}, which ${source} doesn't give`);
  const stops = [];
  const kept = new Map(out.stops.map((s) => [stopKey(s), s]));
  for (const w of want.stops) {
    const g = kept.get(stopKey(w));
    kept.delete(stopKey(w));
    if (!g) { stops.push(`${at}: holds no green stop ${w.stop}, which ${source} gives`); continue; }
    for (const field of ['at', 'verdict_at']) if (!close(g[field], w[field])) stops.push(`${at}: stop ${w.stop} has ${field} ${g[field]}; ${source} gives ${w[field]}`);
    if (g.snapshot !== w.snapshot) stops.push(`${at}: stop ${w.stop} is on snapshot ${g.snapshot}; ${source} gives ${w.snapshot}`);
  }
  for (const g of kept.values()) stops.push(`${at}: holds a green stop ${g.stop}, which ${source} doesn't give`);
  return [...some(places, at), ...some(stops, at)];
}

const SOURCES = {
  today: "the package's simulate at main",
  'person-first': "the package's simulate at main, taking the places whose turn a person opened first and then as today,",
};

// ------------------------------------------------------------------ the readings

/** Nearest rank, as #2649's, #3222's and #3444's suites read it: the smallest sample with at least p of the samples at or below it; null of none. */
export const percentile = (samples, p) => { const sorted = [...samples].sort((a, b) => a - b); return sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : null; };
/** A place's wait for a slot: from the time it took its place, at its green stop's reply, to its start; null when it never started. */
export const waitOf = (p) => (finite(p?.started_at) && finite(p?.queued_at) ? p.started_at - p.queued_at : null);
/** A green stop's time to a verdict: from the stop to the time its claim's verdict landed; null when none did. */
export const verdictOf = (s) => (finite(s?.verdict_at) && finite(s?.at) ? s.verdict_at - s.at : null);

/** Waits for a slot of some places, in ms: how many started (`n`), how many never did, the median and the 95th percentile. */
function waitsOf(places) {
  const waits = places.map(waitOf).filter((w) => w !== null);
  return { n: waits.length, unstarted: places.length - waits.length, p50: percentile(waits, 0.5), p95: percentile(waits, 0.95) };
}
/** One session's reading in a run: its places' waits for a slot and its green stops' times to a verdict. */
export function readingOf(rows, session) {
  const stops = rows.stops.filter((s) => s.session === session);
  const times = stops.map(verdictOf).filter((v) => v !== null);
  return { wait: waitsOf(rows.places.filter((p) => p.session === session)), verdict: { n: times.length, none: stops.length - times.length, p50: percentile(times, 0.5), p95: percentile(times, 0.95) } };
}
/** The other sessions' waits for a slot, all their places together. */
export const othersOf = (rows, person) => waitsOf(rows.places.filter((p) => p.session !== person));
/** The longest wait of any place that started, the person's or another's; null when none started. */
export function longestOf(rows) {
  let longest = null;
  for (const p of rows.places) { const wait = waitOf(p); if (wait !== null && (longest === null || wait > longest.wait)) longest = { session: p.session, check: p.check, snapshot: p.snapshot, wait }; }
  return longest;
}

/** One cell of the table: the person's session alone and beside the others, the others' waits and the longest wait. */
export const cellOf = (alone, beside) => ({ alone: readingOf(alone.rows, alone.person), beside: readingOf(beside.rows, beside.person), others: othersOf(beside.rows, beside.person), longest: longestOf(beside.rows) });

const WAIT = ['n', 'unstarted', 'p50', 'p95'];
const VERDICT = ['n', 'none', 'p50', 'p95'];
function numbersProblems(got, want, fields, at, from) {
  if (!isObj(got)) return [`${at} is missing`];
  return fields.filter((f) => !close(got[f] ?? null, want[f])).map((f) => `${at}.${f} is ${JSON.stringify(got[f])}; ${from} gives ${want[f]}`);
}
/** A table cell of the record against the one worked out from the kept runs. `full`: the changed order's, with the others' waits and the longest wait. */
function cellProblems(got, want, at, full, rows) {
  const problems = [];
  for (const side of ['alone', 'beside']) {
    const from = `the kept run of the person's session ${side === 'alone' ? 'alone' : 'beside the others'}`;
    if (!isObj(got[side])) { problems.push(`${at}.${side} is missing`); continue; }
    problems.push(...numbersProblems(got[side].wait, want[side].wait, WAIT, `${at}.${side}.wait`, from), ...numbersProblems(got[side].verdict, want[side].verdict, VERDICT, `${at}.${side}.verdict`, from));
  }
  if (full || got.others !== undefined) problems.push(...numbersProblems(got.others, want.others, WAIT, `${at}.others (the other sessions' waits)`, 'the kept run'));
  if (full || got.longest !== undefined) {
    const named = isObj(got.longest) ? rows.places.find((p) => placeKey(p) === placeKey(got.longest)) : undefined;
    if (want.longest === null) { if (got.longest !== null) problems.push(`${at}.longest is ${JSON.stringify(got.longest)}; no place started in the kept run`); }
    else if (!isObj(got.longest)) problems.push(`${at}.longest (the longest wait of any place) is missing; the kept run gives ${want.longest.wait} ms, ${placeName(want.longest)}`);
    else if (!close(got.longest.wait, want.longest.wait)) problems.push(`${at}.longest.wait is ${JSON.stringify(got.longest.wait)}; the longest wait of any place in the kept run is ${want.longest.wait} ms, ${placeName(want.longest)}`);
    else if (!named || !close(waitOf(named), want.longest.wait)) problems.push(`${at}.longest names ${placeName(got.longest)}, which didn't wait ${want.longest.wait} ms in the kept run`);
  }
  return problems;
}

// ------------------------------------------------------------------ a report's tables (as #3444's suite reads one)

const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
/** A cell without the backticks around it. */
const plain = (cell = '') => cell.trim().replace(/^`+|`+$/g, '').trim();
/** A header cell as the tests match it: no backticks, lower case, single spaces. */
const key = (cell) => plain(cell).toLowerCase().replace(/\s+/g, ' ');

/** The markdown tables of a text: each its header's cells and its rows' cells, as written. */
export function tables(text) {
  const found = [];
  let rows = null;
  for (const line of [...text.split('\n'), '']) {
    if (line.trim().startsWith('|')) { (rows ??= []).push(cellsOf(line)); continue; }
    if (rows && rows.length >= 2 && rows[1].every((cell) => /^:?-+:?$/.test(cell))) found.push({ header: rows[0], rows: rows.slice(2) });
    rows = null;
  }
  return found;
}

/** A number as a report's cell shows it: digits, `,` between thousands, a decimal point, `s` after it or not. Its value and how many decimals it shows; null for anything else. */
export function shown(cell) {
  const text = plain(cell).replace(/\u2212/g, '-').replace(/\s*s$/, '');
  const m = /^(-?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/.exec(text);
  return m ? { value: Number(`${m[1]}${m[2].replaceAll(',', '')}${m[3] ? `.${m[3]}` : ''}`), decimals: m[3]?.length ?? 0 } : null;
}
/** A shown number agrees with a worked-out one when it is that number rounded to the decimals it shows. */
const agrees = (cell, want) => Math.abs(cell.value - want) <= 0.5 * 10 ** -cell.decimals + 1e-9;
const blank = (cell = '') => ['', '-', '\u2013', '\u2014', 'n/a'].includes(plain(cell).toLowerCase());
/** A time of the record, in ms, against a report's cell, in seconds; a null reading is an empty cell. */
function shownProblem(cell, ms, what) {
  if (ms === null) return blank(cell) ? [] : [`the report shows ${JSON.stringify(cell)} for ${what}, which has no reading: the cell is left empty (or -, n/a)`];
  const number = shown(cell);
  if (!number) return [`the report shows ${JSON.stringify(cell ?? '')} for ${what}, not a number of seconds; the kept runs give ${ms / 1000}`];
  return agrees(number, ms / 1000) ? [] : [`the report shows ${plain(cell)} s for ${what}; the kept runs give ${ms / 1000}`];
}

/** The report's columns of the table, in seconds, and where each comes from in a cell. */
const COLUMNS = Object.fromEntries(['wait', 'verdict'].flatMap((reading) => ['alone', 'beside'].flatMap((side) => ['p50', 'p95'].map((q) => [`${reading} ${q} ${side} s`, (cell) => cell[side][reading][q]]))));
const MORE = { 'others wait p50 s': (cell) => cell.others.p50, 'others wait p95 s': (cell) => cell.others.p95, 'longest wait s': (cell) => cell.longest?.wait ?? null };
/** For each order, the columns its rows of the report's table show, each with the reading of a cell it shows. */
export const REPORT_COLUMNS = { today: COLUMNS, 'person-first': { ...COLUMNS, ...MORE } };

/**
 * The report's table for one order, against the cells worked out from the kept runs: among the tables whose header
 * holds `Order`, `Others` and `Pool`, each count and pool has a row for the order, and every column of the order is
 * shown there, in seconds, as the kept runs give it.
 */
function reportTableProblems(readme, order, cells) {
  const rows = [];
  for (const table of tables(readme)) {
    const header = table.header.map(key);
    const at = ['order', 'others', 'pool'].map((name) => header.indexOf(name));
    if (at.some((i) => i < 0)) continue;
    for (const row of table.rows) rows.push({ header, row, order: key(row[at[0]]), others: shown(row[at[1]])?.value, pool: shown(row[at[2]])?.value });
  }
  const problems = [];
  for (const [name, cell] of cells) {
    const [others, pool] = name.split('/').map(Number);
    const here = `${order}, ${plural(others, 'other')}, a pool of ${pool}`;
    const mine = rows.filter((r) => r.order === order && r.others === others && r.pool === pool);
    if (!mine.length) { problems.push(`the report's table has no row for ${here} (a table whose header holds Order, Others and Pool)`); continue; }
    for (const [column, of] of Object.entries(REPORT_COLUMNS[order])) {
      const shownIn = mine.filter((r) => r.header.includes(column));
      if (!shownIn.length) { problems.push(`the report's table gives no "${column}" for ${here}`); continue; }
      for (const r of shownIn) problems.push(...shownProblem(r.row[r.header.indexOf(column)], of(cell), `"${column}" of ${here}`));
    }
  }
  return problems;
}

// ------------------------------------------------------------------ criteria 1 and 2: the table under an order

const cellName = (others, pool) => `${others}/${pool}`;
const runName = (others, pool) => (others === 0 ? `the person's session alone on a pool of ${pool} slots` : `${plural(others, 'other session')} on a pool of ${pool} slots`);

/**
 * The runs of the table under one order: for the person's session alone and beside 1, 3 and 6 others, on each pool,
 * a kept script that is what the Scope asks, and its kept output under the order, equal row for row to what the
 * package's `simulate` at main gives for that script. Returns each run's script, person and kept rows.
 */
function readRuns(record, order, dir, simulate) {
  const problems = [];
  const read = new Map();
  if (!Array.isArray(record?.runs)) problems.push('BLOCKED: runs (the scripts and their outputs under each order) is missing');
  for (const pool of POOLS) for (const others of [0, ...OTHERS]) {
    const entries = list(record?.runs).filter((r) => isObj(r) && r.others === others && r.pool === pool);
    const at = `runs: ${runName(others, pool)}`;
    if (!entries.length) { problems.push(`BLOCKED: runs holds no run of ${runName(others, pool)}`); continue; }
    if (entries.length > 1) problems.push(`${at}: there ${entries.length} times`);
    const [entry] = entries;
    const kept = readScript(dir, entry, at);
    problems.push(...kept.problems);
    if (!kept.script) continue;
    const shape = tableScriptProblems(kept.script, others, pool, kept.name);
    problems.push(...shape);
    const output = readOutput(dir, entry[order], `${at}, ${order}`, { sha: kept.sha, order });
    problems.push(...output.problems);
    if (shape.length) continue;
    const [person] = whoOf(kept.script).person;
    if (simulate) {
      const today = expectedRows(simulate, kept.script, 'today', kept.name);
      problems.push(...today.problems);
      for (const s of today.rows ? kept.script.sessions : []) if (!today.rows.stops.some((stop) => stop.session === s.id)) problems.push(`${kept.name}: session ${JSON.stringify(s.id)} has no green stop: none of its stops' replies ends the turn under the package's simulate at main`);
      const want = order === 'today' ? today : expectedRows(simulate, kept.script, order, kept.name);
      if (order !== 'today') problems.push(...want.problems);
      if (want.rows && output.out) problems.push(...rowProblems(output.out, want.rows, `${at}, ${order} (${entry[order].out})`, SOURCES[order]));
    }
    if (output.out) read.set(cellName(others, pool), { script: kept.script, name: kept.name, person, rows: output.out });
  }
  for (const pool of POOLS) for (const others of OTHERS) {
    const alone = read.get(cellName(0, pool));
    const beside = read.get(cellName(others, pool));
    if (!alone || !beside) continue;
    const session = (run) => run.script.sessions.find((s) => s.id === run.person);
    if (!isDeepStrictEqual(session(alone), session(beside)) || !isDeepStrictEqual(alone.script.config, beside.script.config)) problems.push(`${beside.name}: its person's session is not the session of ${alone.name}, the same session alone on the same pool`);
  }
  return { problems, read };
}

/**
 * Criterion 1 (`today`) and the first sentence of criterion 2 (`person-first`): the table under one order. For each
 * count of sessions and each pool, the person's session's wait for a slot and its time to a verdict at the median
 * and the 95th percentile, alone and beside the others, and under the changed order the other sessions' waits and
 * the longest wait of any place: worked out from the kept runs, which are held to the package's `simulate` at the
 * record's `main`, and compared with the record's table and the report's.
 */
export async function tableProblems(record, order, dir = REPO) {
  const problems = [...mainProblems(record)];
  const simulate = await simulateOf(record, problems);
  const runs = readRuns(record, order, dir, simulate);
  problems.push(...runs.problems);
  const cells = new Map();
  if (!Array.isArray(record?.table)) problems.push('BLOCKED: table (the readings for each count of sessions and each pool) is missing');
  for (const others of OTHERS) for (const pool of POOLS) {
    const alone = runs.read.get(cellName(0, pool));
    const beside = runs.read.get(cellName(others, pool));
    if (!alone || !beside) continue;
    const cell = cellOf(alone, beside);
    cells.set(cellName(others, pool), cell);
    const rows = list(record?.table).filter((r) => isObj(r) && r.others === others && r.pool === pool);
    const at = `table: ${plural(others, 'other')}, a pool of ${pool}`;
    if (rows.length !== 1 || !isObj(rows[0][order])) { problems.push(`BLOCKED: ${at}: ${rows.length > 1 ? `${rows.length} rows` : `no row with a reading under ${order}`}`); continue; }
    problems.push(...cellProblems(rows[0][order], cell, `${at}: ${order}`, order === 'person-first', beside.rows));
  }
  const readme = report(dir);
  if (readme === null) problems.push(NO_REPORT);
  else problems.push(...reportTableProblems(readme, order, cells));
  return problems;
}

// ------------------------------------------------------------------ criterion 2: the script in which the person's session never stops

/**
 * A script in which the person's session never stops, read under both orders: the check a well-formed spike's kept
 * outputs pass and a harness that reports a gain there fails. No place and no green stop is the person's; every
 * place and green stop reads the same under both orders; a place that waits less, or a verdict that lands sooner,
 * under the changed order is a gain. Each problem names the script.
 */
export function sameUnderBothProblems(name, script, today, changed) {
  const here = `script ${name}, in which the person's session never stops`;
  const [person] = whoOf(script).person;
  const problems = [];
  const sides = [['today', today], ['person-first', changed]];
  for (const [order, out] of sides) {
    for (const p of list(out?.places)) if (p?.session === person) problems.push(`${here}: the ${order} output holds a place for the person's session (${placeName(p)}), which took none`);
    for (const s of list(out?.stops)) if (s?.session === person) problems.push(`${here}: the ${order} output holds a green stop of the person's session (${s.stop}), which never stops`);
  }
  const mapped = (rows, of) => new Map(list(rows).filter(isObj).map((r) => [of(r), r]));
  const [a, b] = sides.map(([, out]) => mapped(out?.places, placeKey));
  for (const [k, p] of a) {
    const q = b.get(k);
    if (!q) { problems.push(`${here}: doesn't read the same under both orders: ${placeName(p)} is in the today output and not in the person-first one`); continue; }
    const [was, is] = [waitOf(p), waitOf(q)];
    if (is !== null && (was === null || is < was)) problems.push(`${here}: the harness reports a gain: ${placeName(p)} waits ${is} ms for a slot under person-first and ${was === null ? 'never starts' : `${was} ms`} under today's order`);
    else if (!['queued_at', 'started_at', 'ended_at'].every((f) => close(p[f] ?? null, q[f] ?? null))) problems.push(`${here}: doesn't read the same under both orders: ${placeName(p)} is queued ${p.queued_at}, started ${p.started_at}, ended ${p.ended_at} under today's order and ${q.queued_at}, ${q.started_at}, ${q.ended_at} under person-first`);
  }
  for (const [k, q] of b) if (!a.has(k)) problems.push(`${here}: doesn't read the same under both orders: ${placeName(q)} is in the person-first output and not in the today one`);
  const [c, d] = sides.map(([, out]) => mapped(out?.stops, stopKey));
  for (const [k, s] of c) {
    const t = d.get(k);
    if (!t) { problems.push(`${here}: doesn't read the same under both orders: green stop ${s.stop} is in the today output and not in the person-first one`); continue; }
    const [was, is] = [verdictOf(s), verdictOf(t)];
    if (is !== null && (was === null || is < was)) problems.push(`${here}: the harness reports a gain: stop ${s.stop}'s verdict lands ${is} ms after it under person-first and ${was === null ? 'never' : `${was} ms after it`} under today's order`);
    else if (!close(s.at ?? null, t.at ?? null) || !close(s.verdict_at ?? null, t.verdict_at ?? null)) problems.push(`${here}: doesn't read the same under both orders: stop ${s.stop} is at ${s.at} with its verdict at ${s.verdict_at} under today's order and at ${t.at} with ${t.verdict_at} under person-first`);
  }
  for (const [k, t] of d) if (!c.has(k)) problems.push(`${here}: doesn't read the same under both orders: green stop ${t.stop} is in the person-first output and not in the today one`);
  return problems;
}

/** The kept script in which the person's session never stops: that it is one, with other sessions nobody typed in that do stop. */
export function readNeverStops(record, dir = REPO) {
  const entry = record?.neverStops;
  if (!isObj(entry)) return { problems: ['BLOCKED: neverStops (the script in which the person\'s session never stops, and its output under both orders) is missing'] };
  const kept = readScript(dir, entry, 'neverStops');
  if (!kept.script) return kept;
  const who = whoOf(kept.script);
  const problems = [];
  if (who.person.length !== 1 || who.mixed.length) problems.push(`${kept.name}: not one session whose every turn a person opened beside sessions whose turns nobody typed (${plural(who.person.length, 'person\'s session')}; neither: ${who.mixed.join(', ') || 'none'})`);
  else if (stopsOf(kept.script.sessions.find((s) => s.id === who.person[0])).length) problems.push(`${kept.name}: the person's session ${JSON.stringify(who.person[0])} stops in it`);
  if (!who.others.some((id) => stopsOf(kept.script.sessions.find((s) => s.id === id)).length)) problems.push(`${kept.name}: no other session stops in it, so nothing takes a place`);
  return { ...kept, entry, problems };
}

/**
 * Criterion 2's second sentence, on what the spike keeps: the script in which the person's session never stops is
 * kept with its output under both orders; each is what the package's `simulate` at main gives for the script as it
 * is (no place's turn was a person's, so the changed order starts every place as today's does); some place waits
 * for a slot, so an order could have read differently; and the two outputs read the same.
 */
export async function neverStopsProblems(record, dir = REPO) {
  const problems = [...mainProblems(record)];
  const simulate = await simulateOf(record, problems);
  const kept = readNeverStops(record, dir);
  problems.push(...kept.problems);
  if (!kept.script || kept.problems.length) return problems;
  const outs = {};
  for (const order of ORDERS) {
    const output = readOutput(dir, kept.entry[order], `neverStops, ${order}`, { sha: kept.sha, order });
    problems.push(...output.problems);
    outs[order] = output.out;
  }
  if (simulate) {
    const want = expectedRows(simulate, kept.script, 'today', kept.name);
    problems.push(...want.problems);
    if (want.rows && !want.rows.places.some((p) => waitOf(p) > 0)) problems.push(`INVALID: ${kept.name}: no place waits for a slot in it under the package's simulate at main, so no order could read differently and the check can't fail`);
    for (const order of ORDERS) if (want.rows && outs[order]) problems.push(...rowProblems(outs[order], want.rows, `neverStops, ${order} (${kept.entry[order].out})`, "the package's simulate at main, whose order the changed one is where no place's turn was a person's,"));
  }
  if (outs.today && outs['person-first']) problems.push(...sameUnderBothProblems(kept.name, kept.script, outs.today, outs['person-first']));
  return problems;
}

// ------------------------------------------------------------------ criterion 3: a pool held full by the test

/**
 * What a harness read of a session's slow checks queued while the test held every slot of the pool
 * (ac3-held-full.test.mjs): each check of the stop took its place no earlier than its green stop, started no earlier
 * than the hold ended, and so waited at least from the stop to the hold's end. Each problem names the check.
 */
export function heldFullProblems(out, held) {
  const problems = [];
  const least = held.heldUntil - held.stopAt;
  for (const check of held.checks) {
    const name = `${held.session}'s check ${check} on snapshot ${held.snapshot}`;
    const p = list(out?.places).find((row) => row?.session === held.session && row?.check === check && row?.snapshot === held.snapshot);
    if (!p) { problems.push(`the harness's output holds no place for ${name}, queued at its green stop (${held.stopAt})`); continue; }
    if (!finite(p.queued_at) || !finite(p.started_at)) { problems.push(`the harness read no time ${finite(p.queued_at) ? 'of a start' : 'in the queue'} for ${name}, which starts once the hold ends (${held.heldUntil})`); continue; }
    if (p.queued_at < held.stopAt) problems.push(`the harness read ${name} as queued at ${p.queued_at}, before its green stop (${held.stopAt})`);
    if (p.started_at < held.heldUntil) problems.push(`the harness read ${name} as started at ${p.started_at}, while the test held every slot of the pool (until ${held.heldUntil})`);
    if (!(waitOf(p) >= least)) problems.push(`the harness read a wait of ${waitOf(p)} ms for ${name}, a slow check queued at its green stop (${held.stopAt}) while the test held every slot of the pool until ${held.heldUntil}; it waited at least ${least} ms`);
  }
  return problems;
}

// ------------------------------------------------------------------ criterion 4: the hub's order and the package's

const START_HEADER = ['session', 'check', 'snapshot', 'package start s', 'hub start s'];

/**
 * One kept script with its starts under the package's order and under the hub's. The package's output is what the
 * package's `simulate` at main gives for the script; the hub's output shows a start (or null) for every place the
 * package's has, each row a place of the script that starts no earlier than its stop; `differs` lists exactly the
 * places whose start is not the same under both, with both starts; and the report names each of them.
 */
export async function ordersProblems(record, dir = REPO) {
  const problems = [...mainProblems(record)];
  const simulate = await simulateOf(record, problems);
  const entry = record?.orders;
  if (!isObj(entry)) return [...problems, 'BLOCKED: orders (the one script, with its starts under the package\'s order and the hub\'s) is missing'];
  const kept = readScript(dir, entry, 'orders');
  problems.push(...kept.problems);
  if (!kept.script) return problems;
  const pkg = readOutput(dir, entry.package, 'orders, the package\'s order', { sha: kept.sha, order: 'today' });
  const hub = readOutput(dir, entry.hub, 'orders, the hub\'s order', { sha: kept.sha, order: 'hub' });
  problems.push(...pkg.problems, ...hub.problems);
  if (simulate) {
    const want = expectedRows(simulate, kept.script, 'today', kept.name);
    problems.push(...want.problems);
    if (want.rows && pkg.out) problems.push(...rowProblems(pkg.out, want.rows, `orders, the package's order (${entry.package.out})`, SOURCES.today));
    if (want.rows && !want.rows.places.some((p) => waitOf(p) > 0)) problems.push(`INVALID: ${kept.name}: no place waits for a slot in it under the package's order, so that order decides no start in it and the check can't fail`);
  }
  if (!pkg.out || !hub.out) return problems;
  const sessions = new Map(kept.script.sessions.map((s) => [s.id, s]));
  for (const p of hub.out.places) {
    const s = sessions.get(p.session);
    const stops = stopsOf(s).filter((e) => e.snapshot === p.snapshot);
    if (!s || !list(s.checks).some((c) => c.id === p.check) || !stops.length) problems.push(`orders, the hub's order (${entry.hub.out}): ${placeName(p)} is not a place of ${kept.name}: a check of one of its sessions on a snapshot that session stops on`);
    else if (finite(p.started_at) && p.started_at < Math.min(...stops.map((e) => e.at))) problems.push(`orders, the hub's order (${entry.hub.out}): ${placeName(p)} starts at ${p.started_at}, before its stop (${Math.min(...stops.map((e) => e.at))})`);
  }
  const under = { package: new Map(pkg.out.places.map((p) => [placeKey(p), p])), hub: new Map(hub.out.places.map((p) => [placeKey(p), p])) };
  for (const [k, p] of under.package) if (!under.hub.has(k)) problems.push(`orders, the hub's order (${entry.hub.out}): shows no start for ${placeName(p)}: each place's start is shown under both orders, null where it never started`);
  const differing = new Map();
  for (const [k, p] of new Map([...under.hub, ...under.package])) {
    const starts = { package: under.package.get(k)?.started_at ?? null, hub: under.hub.get(k)?.started_at ?? null };
    if (!close(starts.package, starts.hub)) differing.set(k, { ...p, ...starts });
  }
  if (!Array.isArray(entry.differs)) problems.push('orders.differs (every place that starts at a different time; an empty list says none) is missing');
  const listed = new Set();
  for (const [i, row] of list(entry.differs).entries()) {
    const want = differing.get(placeKey(row));
    if (listed.has(placeKey(row))) problems.push(`orders.differs[${i}]: ${placeName(row)} is listed twice`);
    listed.add(placeKey(row));
    if (!want) { problems.push(`orders.differs[${i}]: ${placeName(row)} doesn't start at a different time: the two outputs give ${JSON.stringify(under.package.get(placeKey(row))?.started_at ?? null)} and ${JSON.stringify(under.hub.get(placeKey(row))?.started_at ?? null)}`); continue; }
    for (const side of ['package', 'hub']) if (!close(row[side] ?? null, want[side])) problems.push(`orders.differs[${i}]: ${placeName(row)} has ${side} ${JSON.stringify(row[side])}; the ${side === 'hub' ? "hub's" : "package's"} output gives ${want[side]}`);
  }
  for (const [k, want] of differing) if (!listed.has(k)) problems.push(`orders.differs doesn't name ${placeName(want)}, which starts at ${want.package} under the package's order and ${want.hub} under the hub's`);
  const readme = report(dir);
  if (readme === null) return [...problems, NO_REPORT];
  const rows = tables(readme).filter(({ header }) => START_HEADER.every((cell) => header.map(key).includes(cell)))
    .flatMap(({ header, rows: found }) => found.map((row) => Object.fromEntries(START_HEADER.map((cell) => [cell, row[header.map(key).indexOf(cell)]]))));
  for (const want of differing.values()) {
    const mine = rows.filter((r) => placeKey({ session: plain(r.session), check: plain(r.check), snapshot: plain(r.snapshot) }) === placeKey(want));
    if (!mine.length) { problems.push(`the report doesn't name ${placeName(want)}, which starts at a different time under the hub's order (a row of the table whose header holds Session, Check, Snapshot, Package start s and Hub start s)`); continue; }
    for (const r of mine) problems.push(...shownProblem(r['package start s'], want.package, `the package's start of ${placeName(want)}`), ...shownProblem(r['hub start s'], want.hub, `the hub's start of ${placeName(want)}`));
  }
  for (const r of rows) {
    const place = { session: plain(r.session), check: plain(r.check), snapshot: plain(r.snapshot) };
    if (!differing.has(placeKey(place))) problems.push(`the report names ${placeName(place)} as starting at a different time, and the two outputs give it one start`);
  }
  return problems;
}

// ------------------------------------------------------------------ criterion 5: the follow-up, or why the order stays

/**
 * Either a follow-up filed with its own criteria (`followUp`: its issue number, above this issue's, its title and its
 * criteria), named in the spike's report, or one paragraph saying why the order stays as it is (`stays`), the same
 * paragraph in the report. Not both, as #3222's suite holds its follow-up.
 */
export function followUpProblems(record, dir = REPO) {
  const f = record?.followUp;
  const stays = record?.stays;
  const filed = f !== undefined && f !== null;
  const said = stays !== undefined && stays !== null;
  if (filed === said) return ['the record holds either followUp (the task filed) or stays (why the order stays as it is), not both and not neither'];
  const readme = report(dir);
  const problems = readme === null ? [NO_REPORT] : [];
  const squash = (t) => t.replace(/\s+/g, ' ').trim();
  if (filed) {
    if (!isObj(f) || !Number.isInteger(f.issue) || f.issue <= ISSUE) problems.push(`followUp.issue is not the number of an issue filed after #${ISSUE}`);
    if (!nonEmpty(f?.title)) problems.push('followUp.title is missing');
    if (!list(f?.criteria).length || !f.criteria.every(nonEmpty)) problems.push('followUp.criteria (its own acceptance criteria) is missing or has an empty one');
    if (readme !== null && Number.isInteger(f?.issue) && !new RegExp(`#${f.issue}(?!\\d)`).test(readme)) problems.push(`the report doesn't name the follow-up #${f.issue}`);
  } else if (!nonEmpty(stays)) problems.push('stays (why the order stays as it is) is empty');
  else if (/\n[ \t]*\n/.test(stays.trim())) problems.push('stays is more than one paragraph');
  else if (readme !== null && !squash(readme).includes(squash(stays))) problems.push("the report doesn't hold the paragraph saying why the order stays as it is");
  return problems;
}
