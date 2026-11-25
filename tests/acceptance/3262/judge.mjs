// The judges of the #3262 acceptance tests (README: Criteria to tests). Each decides one criterion from what a run
// gave: #3222's harness's output (criteria 1 and 2), or the lines a canvas side was sent with its answers and a fresh
// hub's replies (criterion 3). They read nothing, start nothing and hold no expected value but the issue's: 1.25 times,
// the first and the last 20 calls, the 15 patches, every reply equal.
//
// A judge returns text: `blocked` (the input isn't the run the criterion names; nothing was judged), `problems` (the
// criterion fails, each naming what its criterion names) or a `reading` (the numbers, each with its load). The test
// files turn `blocked` into a plain Error starting BLOCKED and `problems` into node:assert's AssertionError.
import { isDeepStrictEqual } from 'node:util';

/** Each criterion's ID (scripts/proof-change.mjs `criterionId`: the first 8 hex digits of the SHA-256 of its text). */
export const AC = { 1: '#3262.55d4e80f', 2: '#3262.e02db7d6', 3: '#3262.693f8038' };

/** The issue's bound, criteria 1 and 2: "at most 1.25 times". */
export const TIMES = 1.25;
/** Criterion 1: "the last 20 calls", "the first 20's". */
export const WINDOW = 20;
/** Criterion 2: "the 15 patches". */
export const PATCHES = 15;

/** Nearest rank, as docs/spikes/3222/analyze.mjs takes the issue's medians: the smallest value with at least p of the values at or below it. */
export const percentile = (values, p) => { const s = [...values].sort((a, b) => a - b); return s[Math.max(0, Math.ceil(p * s.length) - 1)]; };
export const median = (values) => percentile(values, 0.5);
/** A call's service: its start in the core to its reply (docs/spikes/3222/README.md, "What a time is"). */
export const serviceOf = (row) => row.repliedMs - row.startedMs;

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const ms = (x) => `${x >= 100 ? Math.round(x) : Number(x.toFixed(1))} ms`;
const times = (a, b) => (b > 0 ? `${(a / b).toFixed(2)} times` : 'more than any multiple of');
const whole = (v) => Number.isInteger(v) && v >= 0;
const nameOf = (row) => `session ${String(row.session).slice(0, 8)}'s ${row.kind} of doc ${row.doc}`;

/** The one-minute load at a run's start and end, as the harness kept it: "each with its load". */
export function loadOf(output) {
  const at = (list) => (Array.isArray(list) && Number.isFinite(list[0]) ? list[0] : null);
  return { start: at(output?.load?.start), end: at(output?.load?.end) };
}
const loadText = (output) => { const l = loadOf(output); return `one-minute load ${l.start ?? 'unread'} at its start and ${l.end ?? 'unread'} at its end`; };

/** Why `output` isn't a harness output whose rows can be timed, or null. */
export function rowsBlocked(output) {
  if (!isObject(output) || !Array.isArray(output.calls)) return 'it is not the harness\'s output: one JSON object with `calls`';
  if (!output.calls.length) return 'it holds no call';
  const bad = output.calls.findIndex((c) => !isObject(c) || typeof c.session !== 'string' || typeof c.kind !== 'string' || !Number.isFinite(c.startedMs) || !Number.isFinite(c.repliedMs) || c.repliedMs < c.startedMs);
  if (bad >= 0) return `its row ${bad + 1} has no session, kind, or start in the core at or before its reply: ${JSON.stringify(output.calls[bad]).slice(0, 300)}`;
  const failed = output.calls.filter((c) => c.outcome === 'error');
  if (failed.length) return `${failed.length} of its ${output.calls.length} calls got no reply from the hub (outcome error), the first ${nameOf(failed[0])}`;
  const l = loadOf(output);
  if (l.start === null || l.end === null) return 'it doesn\'t hold the machine\'s load at its start and its end (`load.start`, `load.end`)';
  return null;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 1: "in each of its 1, 4 and 16-session runs, the median service of the last 20 calls is at most 1.25
// times the first 20's".

/** The medians criterion 1 names, in the order the core started the calls (analyze.mjs `growth`). */
export function growthOf(output) {
  const s = [...output.calls].sort((a, b) => a.startedMs - b.startedMs).map(serviceOf);
  return { calls: s.length, first: median(s.slice(0, WINDOW)), last: median(s.slice(-WINDOW)) };
}

/** Judges one `--sessions <n>` run: `{ blocked }`, or `{ problems, reading, within }`. */
export function judgeGrowth(output, n) {
  const blocked = rowsBlocked(output);
  if (blocked) return { blocked: `the ${n}-session run's output can't be judged: ${blocked}` };
  const sessions = new Set(output.calls.map((c) => c.session)).size;
  if (sessions !== n) return { blocked: `the output holds calls of ${sessions} sessions, not ${n}: it is not the harness's ${n}-session run` };
  const planted = output.calls.find((c) => c.planted);
  if (planted || output.calls.every((c) => c.kind === 'revision' || c.kind === 'patch')) return { blocked: `the output is not the harness's ${n}-session run of the five kinds of call (it ${planted ? 'holds a planted call' : 'holds only revisions and patches'})` };
  if (output.calls.length < 2 * WINDOW) return { blocked: `the ${n}-session run made ${output.calls.length} calls: its first ${WINDOW} and its last ${WINDOW} would share calls` };
  const g = growthOf(output);
  const within = g.last <= TIMES * g.first;
  const reading = `with ${n} session${n === 1 ? '' : 's'}, ${g.calls} calls: the last ${WINDOW} calls' median service is ${ms(g.last)}, ${times(g.last, g.first)} the first ${WINDOW}'s, ${ms(g.first)} (${loadText(output)})`;
  return { problems: within ? [] : [`${reading}; the criterion allows at most ${TIMES} times`], reading, within };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 2: "the 15 patches' median service with the slow call in flight is at most 1.25 times their median with
// none … A planted canvas side that keeps render-backs fails, naming the render-back".

const patchesOf = (output) => output.calls.filter((c) => c.kind === 'patch' && !c.planted);
const keyOf = (row) => `${row.session} ${row.doc}`;

/** Judges the pair `--sessions 15 --patches --slow` and `--sessions 15 --patches`: `{ blocked }`, or `{ problems, reading, within }`. */
export function judgeSlowCall(slow, without) {
  for (const [what, output] of [['with --slow', slow], ['without --slow', without]]) {
    const blocked = rowsBlocked(output);
    if (blocked) return { blocked: `the run ${what} can't be judged: ${blocked}` };
    const patches = patchesOf(output);
    if (patches.length !== PATCHES || new Set(patches.map((c) => c.session)).size !== PATCHES) {
      return { blocked: `the run ${what} holds ${patches.length} patches from ${new Set(patches.map((c) => c.session)).size} sessions, not ${PATCHES} from ${PATCHES}: it is not the harness's \`--sessions ${PATCHES} --patches\` run` };
    }
  }
  const stray = without.calls.find((c) => c.planted);
  if (stray) return { blocked: `the run without --slow holds a planted call (${nameOf(stray)})` };
  const planted = slow.calls.filter((c) => c.planted);
  if (planted.length !== 1 || !String(planted[0].kind).startsWith('render_back')) return { blocked: `the run with --slow holds ${planted.length} planted calls${planted[0] ? `, the first a ${planted[0].kind}` : ''}: the slow call is one planted render-back` };
  const call = planted[0];
  const a = patchesOf(slow), b = patchesOf(without);
  const other = a.find((p) => !b.some((q) => keyOf(q) === keyOf(p)));
  if (other) return { blocked: `the two runs don't hold the same ${PATCHES} patches: ${nameOf(other)} is in the run with --slow only` };
  const early = a.find((p) => p.startedMs < call.startedMs);
  if (early) return { blocked: `${nameOf(early)} started in the core before the slow call did, so it wasn't played with the slow call in flight` };
  // The call the core played just before the slow call: what the side held then is what it holds with no render-back kept.
  const before = slow.calls.filter((c) => c.startedMs < call.startedMs).sort((x, y) => y.startedMs - x.startedMs)[0];
  if (!before) return { blocked: 'the slow call is the first call of its run: nothing shows what the side held before it' };
  if (!whole(call.held) || !whole(before.held)) return { blocked: `the harness's rows don't say how many calls the side held (\`held\`, a whole number: ${JSON.stringify(before.held)} after ${nameOf(before)}, ${JSON.stringify(call.held)} after the slow call)` };

  const problems = [];
  const named = `the slow call, ${nameOf(call)}, the planted render-back`;
  if (call.held !== before.held) {
    problems.push(`the side kept the render-back: after ${named}, it held ${call.held} calls, and ${before.held} after the call before it (${nameOf(before)}); a render-back is answered and not kept, so the count stays`);
  }
  const withSlow = median(a.map(serviceOf)), withNone = median(b.map(serviceOf));
  const within = withSlow <= TIMES * withNone;
  const reading = `the ${PATCHES} patches' median service is ${ms(withSlow)} with ${named} (service ${ms(serviceOf(call))}), in flight (${loadText(slow)}), ${times(withSlow, withNone)} their median with none, ${ms(withNone)} (${loadText(without)})`;
  if (!within) problems.push(`${reading}; the criterion allows at most ${TIMES} times`);
  return { problems, reading, within };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 3: "Every reply equals the reply of a fresh hub that plays every kept call".

/** Flicks a second (crates/deep-show `shared::FLICKS`). */
export const FLICKS = 705_600_000;
/** The side's clock, as the base keeps it (canvas_side.rs `CANVAS_CLOCK`, `CANVAS_SPACING`): the n-th call, a read included, at n spacings. */
export const CLOCK = { refresh_hz: 120, lead: 1_411_200, check: 352_800 };
export const SPACING = 10 * (FLICKS / 120);
/** The six reads the side answers and doesn't keep (canvas_side.rs `READS`, #2694). */
export const READS = ['deep_kinds', 'cells', 'cell', 'updates', 'revisions', 'deep_query'];
/** The calls whose time the side writes as `arrives`: their `at` means something else (canvas_side.rs `timed`). */
export const ARRIVES = ['deep_query', 'geometry', 'fn', 'deep_kinds'];
/** A kept call, by the issue: every call but the six reads and, from this issue on, a render-back. */
export const isKept = (call) => !READS.includes(call.call) && call.call !== 'render_back';
/** A call as it is played: at its place on the side's clock. */
export const timed = (call, n) => ({ ...call, [ARRIVES.includes(call.call) ? 'arrives' : 'at']: n * SPACING });

/** What a call is, for a message: its place, its name, who sent it and on which document. */
export function callName(call, n) {
  const by = typeof call.session === 'string' ? ` by session ${call.session}` : call.peer ? ' from the command line' : '';
  return `call ${n} (${call.call}${by}${typeof call.doc === 'string' ? ` on doc ${call.doc}` : ''})`;
}

/**
 * What a fresh hub is asked, for the lines a side was sent (`{world}` and `{call}` lines, in order): the scenarios to
 * play, each once through a new hub, and where each call's reply is among their replies.
 *
 * The reply to a call is that of a new hub, in the world as the side last had it, that plays every kept call before
 * it, each at the time it was first played, and then the call at its own. One scenario per world holds that world's
 * kept calls after every earlier one: the new hub answers each having played exactly the kept calls before it. A call
 * that isn't kept (a read, a render-back) gets a scenario of its own, so that no later reply comes from a hub that
 * played it.
 */
export function freshPlan(lines) {
  const scenarios = [];
  const calls = [];
  let world = null, kept = [], open = null, n = 0;
  for (const line of lines) {
    if (isObject(line.world)) { world = line.world; open = null; continue; }
    if (!isObject(line.call) || world === null) throw Error(`a line that is neither a world nor a call after one: ${JSON.stringify(line).slice(0, 200)}`);
    n += 1;
    const call = timed(line.call, n);
    if (isKept(line.call)) {
      if (!open) { open = { world, calls: [...kept] }; scenarios.push(open); }
      open.calls.push(call);
      kept = [...kept, call];
      calls.push({ n, call: line.call, kept: true, scenario: scenarios.indexOf(open), reply: open.calls.length - 1, before: kept.length - 1 });
    } else {
      scenarios.push({ world, calls: [...kept, call] });
      calls.push({ n, call: line.call, kept: false, scenario: scenarios.length - 1, reply: kept.length, before: kept.length });
    }
  }
  return { scenarios: scenarios.map((s) => ({ ...s.world, clock: CLOCK, calls: s.calls })), calls };
}

/** Where two JSON values first differ, as a path and both values; null when they are equal. */
export function whereDiffer(a, b, path = 'reply') {
  if (isDeepStrictEqual(a, b)) return null;
  const show = (v) => (v === undefined ? 'nothing' : JSON.stringify(v).slice(0, 240));
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = whereDiffer(a[i], b[i], `${path}[${i}]`); if (d) return d; }
  } else if (isObject(a) && isObject(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) { const d = whereDiffer(a[k], b[k], `${path}.${k}`); if (d) return d; }
  }
  return `\`${path}\` is ${show(a)} from the side and ${show(b)} from a fresh hub`;
}

/**
 * The first call whose reply differs from a fresh hub's: `{ n, text }`, or null when every reply is equal, whole.
 * `answers` are the side's answer lines to the plan's calls, in order; `fresh` the fresh hub's reply to each.
 */
export function firstDifference(plan, answers, fresh) {
  for (const [i, c] of plan.calls.entries()) {
    const answer = answers[i];
    const name = callName(c.call, c.n);
    const after = `a fresh hub that played the ${c.before} kept call${c.before === 1 ? '' : 's'} before it`;
    if (!isObject(answer) || answer.ok !== true || !isObject(answer.reply)) return { n: c.n, text: `${name}: the side gave no reply (${JSON.stringify(answer ?? null).slice(0, 300)}), where ${after} gives one` };
    const d = whereDiffer(answer.reply, fresh[i]);
    if (d) return { n: c.n, text: `${name} is the first call whose reply differs from that of ${after}: ${d}` };
  }
  return null;
}
