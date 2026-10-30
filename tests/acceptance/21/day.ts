// A "day" of tool calls and the checks the criteria put on it, shared by the replayed day (replay.test.ts) and the
// live one (sessions.live.test.ts) so both are judged by the same code (README: Readings).
//
// A day is a run of windows, each with the hub up, stopped (SIGTERM: the process gone, its socket removed) or
// stopped with SIGSTOP. Every tool call's PreToolUse and PostToolUse hook runs deep-hook through the hook timer
// (fixtures/hook-timer.rs), which writes down when it started deep-hook and when deep-hook exited (deep-hook keeps
// the timer's PID and the agent as its parent). Each hook's event
// is then found in the record by its call's tool_use_id (`data.call`, #18), and its `seq` is the wall-clock ns at
// which deep-hook started (#16, #315). So, per hook:
//   over its own start = exit - seq          (deep-hook's own time, after its process has started)
//   whole              = exit - spawn        (with its process start; the floor's whole is the no-op's)
import { HOOK_KIND, median, msBetween, p95, readTimings, type Ev, type Line } from './helpers.ts';

export type Window = 'up' | 'stopped' | 'sigstopped';
export interface Call { window: number; kind: Window; session: string; call: string }
export interface HookTime { call: Call; event: 'PreToolUse' | 'PostToolUse'; code: number | undefined; watched: boolean; spawnNs: bigint; endNs: bigint; seq: bigint | undefined; ownMs: number | undefined; wholeMs: number }
export interface Day {
  /** Each window's kind, in order. */
  windows: Window[];
  /** Every tool call of the day, in order. */
  calls: Call[];
  /** Every timed tool-call hook, joined to its event's seq once the log has settled. */
  hooks: HookTime[];
  /** The no-op floor's whole time (spawn to exit) through the same timer, in ms. */
  floorMs: number[];
  /** The spool's request lines, read as each window that wasn't `up` ended, before the hub came back. */
  spoolAtEnd: Map<number, Line[]>;
  /** The hub's ps state letters, read as each SIGSTOP window began and ended. */
  stoppedStates: Map<number, string[]>;
  /** The log, settled after the last window. */
  events: Ev[];
}

/** Joins the timer's files to the day's calls and to the record's seq; `codes` holds exit codes by `<event> <call>` where the test saw them. */
export function joinHooks(timerDir: string, calls: Call[], events: Ev[], codes: Map<string, number> = new Map()): HookTime[] {
  const byCall = new Map(calls.map((c) => [`${c.session} ${c.call}`, c]));
  const firstEvent = new Map<string, Ev>();
  for (const e of events) if (typeof e.data?.call === 'string' && !firstEvent.has(`${e.kind} ${e.data.call}`)) firstEvent.set(`${e.kind} ${e.data.call}`, e);
  const out: HookTime[] = [];
  for (const t of readTimings(timerDir)) {
    const event = t.payload.hook_event_name as string;
    const kind = HOOK_KIND[event];
    const call = byCall.get(`${t.payload.session_id} ${t.payload.tool_use_id}`);
    if (!kind || !call) continue;
    const recorded = firstEvent.get(`${kind} ${call.call}`);
    const seq = recorded?.seq !== undefined ? BigInt(recorded.seq) : undefined;
    out.push({ call, event: event as HookTime['event'], code: codes.get(`${event} ${call.call}`), watched: t.watched, spawnNs: t.spawnNs, endNs: t.endNs, seq, ownMs: seq === undefined ? undefined : msBetween(seq, t.endNs), wholeMs: msBetween(t.spawnNs, t.endNs) });
  }
  return out;
}

const hooksIn = (day: Day, kinds: Window[]) => day.hooks.filter((h) => kinds.includes(h.call.kind));
const known = (xs: (number | undefined)[]) => xs.filter((x): x is number => x !== undefined);

/** Hook overhead with the hub up, two readings: p95 of each hook's time over its own start, and p95 whole minus the floor's p95. */
export function overhead(day: Day): { ownP95Ms: number; overFloorP95Ms: number; hooks: number; ms: number } {
  const up = hooksIn(day, ['up']);
  const ownP95Ms = p95(known(up.map((h) => h.ownMs)));
  const overFloorP95Ms = p95(up.map((h) => h.wholeMs)) - p95(day.floorMs);
  return { ownP95Ms, overFloorP95Ms, hooks: up.length, ms: Math.max(ownP95Ms, overFloorP95Ms) };
}
/** Fail-open time in the windows the hub wasn't answering, the same two readings at p95 (the floor's median, as a hook's process start). */
export function failOpen(day: Day): { ownP95Ms: number; overFloorP95Ms: number; hooks: number; ms: number } {
  const away = hooksIn(day, ['stopped', 'sigstopped']);
  const ownP95Ms = p95(known(away.map((h) => h.ownMs)));
  const overFloorP95Ms = p95(away.map((h) => h.wholeMs)) - median(day.floorMs);
  return { ownP95Ms, overFloorP95Ms, hooks: away.length, ms: Math.max(ownP95Ms, overFloorP95Ms) };
}
/** The p95 overhead check, as a list of what is wrong (empty when it holds). */
export function overheadProblems(day: Day, limitMs = 10): string[] {
  const o = overhead(day);
  const out: string[] = [];
  if (o.hooks === 0) out.push('no tool-call hook ran with the hub up');
  const missing = hooksIn(day, ['up']).filter((h) => h.seq === undefined);
  if (missing.length) out.push(`${missing.length} hooks run with the hub up have no event in the record to read their seq from, e.g. ${missing[0]!.event} of ${missing[0]!.call.call}`);
  if (!(o.ownP95Ms < limitMs)) out.push(`p95 hook time over its own process start, with the hub up, is ${o.ownP95Ms.toFixed(2)} ms over ${o.hooks} hooks, not under ${limitMs} ms`);
  if (!(o.overFloorP95Ms < limitMs)) out.push(`p95 hook time (spawn to exit) minus the native no-op's p95 is ${o.overFloorP95Ms.toFixed(2)} ms over ${o.hooks} hooks, not under ${limitMs} ms`);
  return out;
}

const callName = (c: Call) => `${c.call} (window ${c.window + 1}, hub ${c.kind}, session ${c.session})`;

/** Everything in the day that falls short of AC2, each naming the call; empty when the criterion holds. */
export function failOpenProblems(day: Day, o: { limitMs?: number; minCalls?: number; minPerWindow?: number } = {}): string[] {
  const limit = o.limitMs ?? 50;
  const out: string[] = [];
  const count = (kind: Window) => day.calls.filter((c) => c.kind === kind).length;
  if (day.calls.length < (o.minCalls ?? 1000)) out.push(`INCONCLUSIVE: the day made ${day.calls.length} tool calls, fewer than ${o.minCalls ?? 1000}`);
  for (const kind of ['stopped', 'sigstopped'] as const) {
    if (count(kind) < (o.minPerWindow ?? 200)) out.push(`INCONCLUSIVE: ${count(kind)} tool calls ran with the hub ${kind === 'stopped' ? 'stopped' : 'SIGSTOPped'}, fewer than ${o.minPerWindow ?? 200}`);
  }
  // Every hook of every call ran deep-hook, decided (0 allows, 2 denies) and is in the record with its seq.
  const floorStart = median(day.floorMs);
  for (const c of day.calls) {
    for (const event of ['PreToolUse', 'PostToolUse'] as const) {
      const h = day.hooks.find((x) => x.call === c && x.event === event);
      if (!h) { out.push(`the ${event} hook of ${callName(c)} never ran deep-hook through its entry`); continue; }
      if (!h.watched) out.push(`the timer couldn't watch the ${event} hook of ${callName(c)} exit, so its time is unknown`);
      if (h.code !== undefined && h.code !== 0 && h.code !== 2) out.push(`the ${event} hook of ${callName(c)} exited ${h.code}${h.code === -1 ? ' (killed at the stand-in hook timeout)' : ''}, neither an allow (0) nor a deny (2)`);
      if (h.ownMs === undefined) out.push(`the ${event} hook of ${callName(c)} has no event in the record`);
      else if (h.ownMs > limit) out.push(`the ${event} hook of ${callName(c)} took ${h.ownMs.toFixed(2)} ms over its own process start (exit - seq), more than ${limit} ms`);
      if (h.wholeMs - floorStart > limit) out.push(`the ${event} hook of ${callName(c)} took ${h.wholeMs.toFixed(2)} ms from spawn to exit, ${(h.wholeMs - floorStart).toFixed(2)} ms over the native no-op's ${floorStart.toFixed(2)} ms, more than ${limit} ms`);
    }
  }
  // The windows: the hub really wasn't answering, and each such call failed open into the spool.
  day.windows.forEach((kind, w) => {
    if (kind === 'up') return;
    const lines = day.spoolAtEnd.get(w) ?? [];
    for (const c of day.calls.filter((x) => x.window === w)) {
      if (!lines.some((l) => l.event === 'PreToolUse' && l.payload?.tool_use_id === c.call)) out.push(`the PreToolUse of ${callName(c)} wasn't in the spool when the window ended, so it didn't fail open`);
    }
    if (kind === 'sigstopped') {
      const states = day.stoppedStates.get(w) ?? [];
      if (!states.length || states.some((s) => !s.includes('T'))) out.push(`the hub wasn't stopped through window ${w + 1}: its ps states were ${JSON.stringify(states)}`);
    }
  });
  if (day.windows.includes('stopped') && !day.events.some((e) => e.kind === 'hub.stopped' && e.data?.reason === 'signal:SIGTERM')) {
    out.push('the record has no hub.stopped with reason signal:SIGTERM for the window the hub was stopped');
  }
  // All the windows' events are in the record once after the hub resumed.
  for (const c of day.calls.filter((x) => x.kind !== 'up')) {
    const n = day.events.filter((e) => e.kind === 'tool.before' && e.data?.call === c.call).length;
    if (n !== 1) out.push(`the event of ${callName(c)} (its tool.before) is in the record ${n} times after the hub resumed, not once`);
  }
  const ids = new Map<string, number>();
  for (const e of day.events) ids.set(e.id, (ids.get(e.id) ?? 0) + 1);
  for (const [id, n] of ids) if (n > 1) out.push(`event ${id} is in the record ${n} times`);
  return out;
}

/** A problem list as a test shows it: the count and the first 40, so a day with thousands stays readable. */
export const shown = (problems: string[]): string[] => (problems.length ? [`${problems.length} problems`, ...problems.slice(0, 40)] : []);

/** One line for a test's log: how the day went. */
export function summary(day: Day): string {
  const o = overhead(day);
  const f = failOpen(day);
  const start = known(day.hooks.map((h) => (h.seq === undefined ? undefined : msBetween(h.spawnNs, h.seq))));
  return `${day.calls.length} calls (${day.windows.map((k, w) => `${k} ${day.calls.filter((c) => c.window === w).length}`).join(', ')}), ${day.hooks.length} hooks; `
    + `overhead p95 ${o.ownP95Ms.toFixed(2)} ms over own start, ${o.overFloorP95Ms.toFixed(2)} ms over the floor; `
    + `fail-open p95 ${f.ownP95Ms.toFixed(2)} ms over own start, ${f.overFloorP95Ms.toFixed(2)} ms over the floor; `
    + `process start (spawn to seq) median ${median(start).toFixed(2)} ms; floor median ${median(day.floorMs).toFixed(2)} ms, p95 ${p95(day.floorMs).toFixed(2)} ms`;
}
