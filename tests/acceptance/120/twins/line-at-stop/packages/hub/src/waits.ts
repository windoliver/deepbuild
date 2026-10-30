// Twin of packages/hub/src/waits.ts for #120.557a037b: a hub whose lines wait for the turn's stop, so a 25-minute turn of short calls shows none.
// Long waits shown where you read (#120; design: Before each command, "Commands end."). Each tool call gets an
// expected time, from its kind and from how long the same command took before; a call still running past it is an
// overrun: the agent hears it at its next hook, the session's row says so, and one line shows in the chat, at the
// call's next hook and, in the Claude Code terminal, while the call still runs (a FileChanged notification, the route
// spike #80 found). A wait expected to take over a minute says so when it starts, and a turn or wait that runs ten
// minutes without a line you can read gets one. Nothing here reads a clock, a file or a payload: the event loop
// hands it each hook with the time, and asks what is due; so the line costs under a millisecond in the hook path.

/** The expected time of a call with no history, by its kind. */
export const KIND_EXPECTED_MS: Readonly<Record<string, number>> = { shell: 60_000, read: 15_000, search: 15_000, edit: 15_000, write: 15_000, fetch: 30_000, mcp: 60_000, unknown: 60_000 };
/** A wait expected to take longer than this is announced when it starts. */
export const ANNOUNCE_MS = 60_000;
/** A turn or a wait this long without a readable line gets one, and another after each such span. */
export const LINE_EVERY_MS = 10 * 60_000;
/** How many of a command's past runs the expected time is the median of, and how many commands are remembered. */
const HISTORY_KEPT = 20;
const COMMANDS_KEPT = 2000;
/** How much of a command the line shows. */
const EXCERPT = 60;
/** The longest timeout Claude Code's Bash tool takes, in ms. */
const TIMEOUT_CAP_MS = 600_000;
/** How many of a session's calls are followed at once: past this (a flood from a subagent's hooks), the rest are not waits. */
const OPEN_KEPT = 256;

/**
 * Commands that never end on their own, such as following a log: a log follow, a watcher, a dev server, a pager, an
 * unbounded ping or sleep, a listener. Matched on the command's words, so a `tail -f` inside a pipeline counts too.
 */
const NEVER_ENDS: readonly RegExp[] = [
  /(^|[\s;&|(])tail\s+(?:-[a-zA-Z]*[fF][a-zA-Z]*|--follow)\b/,
  /(^|[\s;&|(])(?:journalctl|kubectl\s+logs|docker\s+logs|docker\s+compose\s+logs|docker-compose\s+logs|gcloud\s+.*logs\s+tail|heroku\s+logs|fly\s+logs|flyctl\s+logs|stern)\b[^;&|]*\s(?:-f|--follow|-t|--tail)\b/,
  /(^|[\s;&|(])(?:watch|top|htop|btop|less|more|fswatch|inotifywait|entr|nodemon|cargo\s+watch|cargo-watch)\b/,
  /(^|[\s;&|(])(?:tsc|jest|vitest|mocha|pytest-watch|ptw|webpack|esbuild|rollup)\b[^;&|]*\s(?:--watch|-w|--watchAll)\b/,
  /(^|[\s;&|(])vitest(?!\s+run)\b(?![^;&|]*\s--run\b)/,
  /(^|[\s;&|(])(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|watch|storybook)\b/,
  /(^|[\s;&|(])(?:vite|next\s+dev|nuxt\s+dev|astro\s+dev|remix\s+dev|ng\s+serve|flask\s+run|uvicorn|gunicorn|rails\s+server|rails\s+s|php\s+-S|python3?\s+-m\s+http\.server|http-server|serve|live-server|hugo\s+server|jekyll\s+serve|mkdocs\s+serve)\b/,
  /(^|[\s;&|(])sleep\s+(?:infinity|inf)\b/,
  /(^|[\s;&|(])ping(?![^;&|]*\s-c\s*\d)\s[^;&|]*$/,
  /(^|[\s;&|(])(?:nc|ncat|netcat)\s+[^;&|]*-l\b/,
  /(^|[\s;&|(])(?:yes|cat)\s*$/,
  /(^|[\s;&|(])(?:redis-server|mongod|postgres|mysqld|ollama\s+serve|caddy\s+run)\b/,
];
/** Whether a shell command never ends on its own, so a deadline is what ends it. */
export function neverEnds(command: string): boolean {
  // The words that name such a command come first; a long script's tail (a heredoc) is not read, so the test stays cheap.
  const plain = command.trim().slice(0, 2048);
  return NEVER_ENDS.some((re) => re.test(plain));
}

/** The key a call's history is kept under: a shell command as typed, white space collapsed; any other call its tool. */
export function historyKey(kind: string, command: string | null, tool: string): string {
  return kind === 'shell' && command ? `shell\0${command.trim().replace(/\s+/g, ' ')}` : `${kind}\0${tool}`;
}

/** How long each command took before, and the expected time that gives: the median of its last runs. */
export class History {
  private readonly runs = new Map<string, number[]>();
  add(key: string, ms: number): void {
    const list = this.runs.get(key) ?? [];
    list.push(ms);
    if (list.length > HISTORY_KEPT) list.splice(0, list.length - HISTORY_KEPT);
    // Re-set, so the map's order is by last use, and the command least used for longest goes first.
    this.runs.delete(key);
    this.runs.set(key, list);
    if (this.runs.size > COMMANDS_KEPT) this.runs.delete(this.runs.keys().next().value!);
  }
  /** The expected time in ms: the median of the command's past runs, or its kind's default. */
  expected(key: string, kind: string): number {
    const list = this.runs.get(key);
    if (!list?.length) return KIND_EXPECTED_MS[kind] ?? KIND_EXPECTED_MS.unknown!;
    const sorted = [...list].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const median = sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
    // A run shorter than a second says little about the next: the floor keeps a fast command from reading as an overrun at once.
    return Math.max(1000, median);
  }
}

/** A span of time in words: "40 s", "3 min", "1 h 20 min". */
export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}
/** What a call waits on, as the line names it: its command, or its tool. */
export function excerpt(text: string, max = EXCERPT): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** The lines. Each names what it is about, so one is readable alone in the chat. */
export const lines = {
  announce: (what: string, expected: number) => `DeepBuild: waiting on \`${what}\` · about ${span(expected)} expected`,
  inCall: (what: string, ran: number, expected: number) => `DeepBuild: still waiting on \`${what}\` · ${span(ran)} so far, about ${span(expected)} was expected`,
  overrun: (what: string, ran: number, expected: number) => `DeepBuild: \`${what}\` ran ${span(ran)}, about ${span(expected)} was expected`,
  overrunContext: (what: string, ran: number, expected: number) =>
    `DeepBuild: your call \`${what}\` ran ${span(ran)}, past the ${span(expected)} expected for it. Its effect is unknown: read what it did before retrying it.`,
  progress: (ask: string, step: string, soFar: number, left: number | null) =>
    `DeepBuild: ${ask} · ${step} · ${span(soFar)} so far · ${left === null ? 'time left unknown' : `about ${span(left)} left`}`,
};

/** A call still running: its session, what it waits on, when it started, its expected time, and what was shown of it. */
export interface OpenCall {
  call: string; kind: string; tool: string; command: string | null; what: string;
  started: number; expected: number; deadline: 'attached' | 'recorded' | 'none';
  /** When its overrun was recorded, once it ran past its expected time. */
  overrun?: number | undefined;
  /** When a line about it last showed while it ran (its start counts), so the next in-call line comes ten minutes after. */
  shown: number;
}
interface SessionWaits {
  agent: string; cwd: string;
  /** The turn's prompt, as the progress line names the ask; and when the turn began. */
  ask?: string | undefined; turnStart?: number | undefined;
  /** When a line you can read last showed in this session's chat: a line of ours, or a prompt or stop of the turn. */
  lastLine: number;
  /** Lines waiting for the session's next hook: the chat's, and the agent's context. */
  message: string[]; context: string[];
  /** The line the in-call route shows while a call still runs, until that call ends. */
  inCall?: string | undefined;
  /** The calls still running, by ID, in the order they started. */
  open: Map<string, OpenCall>;
}
/** A session's waits as the record holds them, for a hub that starts on a record another left (the test clock moves on by a restart). */
export interface Restored {
  session: string; agent: string; cwd: string; ask?: string | undefined; turnStart?: number | undefined; lastLine: number;
  open: { call: string; kind: string; tool: string; command: string | null; started: number; overrun?: number | undefined; shown: number }[];
}

/** An overrun a hook found at a call's end before the timer did: recorded then. */
export interface Overran { call: OpenCall; ran: number }
/** What a hook's reply carries of the waits: a chat line, context for the agent, a rewritten input with the deadline. */
export interface Reply { message?: string; context?: string; updatedInput?: Record<string, unknown>; overran?: Overran }
/** What the event loop does at a due time: show a line while a call runs, and record its overrun. */
export type Due =
  | { kind: 'overrun'; session: string; agent: string; cwd: string; call: OpenCall; ran: number; line: string }
  | { kind: 'progress'; session: string; agent: string; cwd: string; line: string };

export interface HookSeen {
  event: string; session: string; agent: string; cwd: string;
  /** A tool hook's call, from its tool.before or tool.after draft and the payload. */
  call?: { id: string; kind: string; tool: string; command: string | null; input: Record<string, unknown>; mode: string; failed?: boolean };
  /** A prompt's text. */
  prompt?: string;
}
export interface WaitsOptions {
  /** Whether a call's input can be rewritten for this agent (the adapter's rewrite flag). */
  rewrites: (agent: string) => boolean;
  /** The planted wrong program: lines wait for the turn's stop. */
  plant?: string;
}
/** The permission mode in which Claude Code and Codex run every call without asking: only there a deadline is attached. */
const BYPASS = new Set(['bypassPermissions', 'bypass', 'full-access', 'danger-full-access', 'never']);

export class Waits {
  readonly history = new History();
  private readonly sessions = new Map<string, SessionWaits>();
  constructor(private readonly options: WaitsOptions) {}

  private sessionOf(seen: HookSeen, now: number): SessionWaits {
    let s = this.sessions.get(seen.session);
    if (!s) this.sessions.set(seen.session, (s = { agent: seen.agent, cwd: seen.cwd, lastLine: now, message: [], context: [], open: new Map() }));
    return s;
  }
  /** The waits the record held when this hub started: the turns and calls still running, so no restart loses a wait. */
  restore(rows: Restored[]): void {
    for (const r of rows) {
      // A session whose hooks already reached this hub is known better than the record knew it.
      if (this.sessions.has(r.session)) continue;
      const endless = (command: string | null, kind: string) => kind === 'shell' && command !== null && neverEnds(command);
      const open = new Map(r.open.map((o): [string, OpenCall] => {
        const expected = this.history.expected(historyKey(o.kind, o.command, o.tool), o.kind);
        return [o.call, { call: o.call, kind: o.kind, tool: o.tool, command: o.command, what: excerpt(o.command ?? o.tool), started: o.started, expected, deadline: endless(o.command, o.kind) ? 'recorded' : 'none', overrun: o.overrun, shown: o.shown }];
      }));
      this.sessions.set(r.session, { agent: r.agent, cwd: r.cwd, ask: r.ask, turnStart: r.turnStart, lastLine: r.lastLine, message: [], context: [], open });
    }
  }

  /** The chat's and the agent's lines waiting for this hook, taken once; nothing while the plant holds them for the stop. */
  private take(s: SessionWaits, now: number): Reply {
    // The wrong program (twin line-at-stop): lines wait for the turn's stop, so none shows during the turn.
    const out: Reply = {};
    if (s.context.length) out.context = s.context.join('\n');
    s.message = [];
    s.context = [];
    s.lastLine = now;
    return out;
  }

  /** One hook of a session: what its reply carries of the waits. Under a millisecond: map lookups and a few strings. */
  hook(seen: HookSeen, now: number): Reply {
    if (!seen.session) return {};
    const s = this.sessionOf(seen, now);
    switch (seen.event) {
      case 'SessionStart': case 'SessionEnd': this.forget(seen.session); return {};
      case 'UserPromptSubmit':
        if (!(seen.prompt ?? '').includes('<task-notification>')) {
          s.ask = excerpt(seen.prompt ?? '', 40) || 'your prompt';
          s.turnStart = now;
        }
        // A prompt starts a turn: no call of the last one still runs.
        s.open.clear();
        s.inCall = undefined;
        s.lastLine = now;
        return {};
      case 'Stop': case 'StopFailure':
        // A stop ends the turn's calls; a stop sent back goes on in the same turn, so its ask and start stay.
        s.open.clear();
        s.inCall = undefined;
        s.lastLine = now;
        s.message = [];
        s.context = [];
        return {};
      case 'PreToolUse': return this.before(s, seen, now);
      case 'PostToolUse': case 'PostToolUseFailure': return this.after(s, seen, now);
      default: return {};
    }
  }

  private before(s: SessionWaits, seen: HookSeen, now: number): Reply {
    const out: Reply = {};
    const call = seen.call;
    // Our own tools are asks and waits on you, which the asks core times; a call with no ID can't be followed to its
    // end; a call outside a turn the hub saw begin (a subagent's, or one let through while no prompt ran) is no wait.
    // A call run in the background returns at once: no wait, and nothing to learn of its time.
    if (!call || !call.id || call.tool.startsWith('mcp__deep__') || call.input.run_in_background === true || s.turnStart === undefined || s.open.size >= OPEN_KEPT) { this.progressAt(s, now); return this.take(s, now); }
    const key = historyKey(call.kind, call.command, call.tool);
    const expected = this.history.expected(key, call.kind);
    const what = excerpt(call.command ?? call.tool);
    const endless = call.kind === 'shell' && call.command !== null && neverEnds(call.command);
    let deadline: OpenCall['deadline'] = 'none';
    if (endless) {
      // Attached only where the adapter can change the command and the session bypasses approvals: elsewhere a
      // rewritten command could be asked about where you had allowed it, so the overrun is only recorded.
      if (this.options.rewrites(seen.agent) && BYPASS.has(call.mode)) {
        deadline = 'attached';
        // The command itself says when it ends, and the tool's timeout ends it there; neither decides the call. The
        // command rewritten is the one the agent typed (the input's), never the record's redacted copy of it.
        const typed = typeof call.input.command === 'string' ? call.input.command : call.command;
        const timeout = Math.min(expected, TIMEOUT_CAP_MS);
        out.updatedInput = { ...call.input, command: `: 'DeepBuild: ends after ${span(timeout)}'; ${typed}`, timeout };
      } else deadline = 'recorded';
    }
    s.open.set(call.id, { call: call.id, kind: call.kind, tool: call.tool, command: call.command, what, started: now, expected, deadline, shown: now });
    // The ten-minute line names this call as the step; a wait expected to take over a minute says so as it starts.
    this.progressAt(s, now);
    if (expected > ANNOUNCE_MS) s.message.push(lines.announce(what, expected));
    return { ...out, ...this.take(s, now) };
  }

  private after(s: SessionWaits, seen: HookSeen, now: number): Reply {
    this.progressAt(s, now);
    const open = seen.call ? s.open.get(seen.call.id) : undefined;
    let overran: Overran | undefined;
    if (open && seen.call) {
      const ran = now - open.started;
      // A call that ended well teaches the next one its time; a failed or interrupted one says nothing about the command.
      if (!seen.call.failed) this.history.add(historyKey(open.kind, open.command, open.tool), ran);
      if (open.overrun !== undefined || ran >= open.expected) {
        // An overrun the timer never saw (the call ended at the same moment, or another hub held the record) is recorded now.
        if (open.overrun === undefined) overran = { call: open, ran };
        s.message.push(lines.overrun(open.what, ran, open.expected));
        s.context.push(lines.overrunContext(open.what, ran, open.expected));
      }
      s.open.delete(seen.call.id);
      if (!s.open.size) s.inCall = undefined;
    }
    return { ...(overran ? { overran } : {}), ...this.take(s, now) };
  }
  /** The call a session's lines name as its step: the latest still running. */
  private latest(s: SessionWaits): OpenCall | undefined {
    let last: OpenCall | undefined;
    for (const o of s.open.values()) last = o;
    return last;
  }

  /** The ten-minute line at a hook: once the turn has run that long since a line you could read. */
  private progressAt(s: SessionWaits, now: number): void {
    if (s.turnStart === undefined || now - s.lastLine < LINE_EVERY_MS) return;
    s.message.push(this.progressLine(s, now));
  }
  private progressLine(s: SessionWaits, now: number): string {
    const open = this.latest(s);
    const step = open ? `waiting on \`${open.what}\`` : 'between calls';
    const left = open ? Math.max(0, open.started + open.expected - now) : null;
    return lines.progress(s.ask ?? 'your prompt', step, now - (s.turnStart ?? now), open && left === 0 ? null : left);
  }

  /** The reply to a FileChanged hook for a session's ticker: the line about its call that still runs. */
  fileChanged(session: string, now: number): Reply {
    const s = this.sessions.get(session);
    if (!s?.inCall || this.options.plant === 'line-at-stop') return {};
    const line = s.inCall;
    s.inCall = undefined;
    s.lastLine = now;
    return { message: line };
  }

  /** The earliest time something is due: a call's expected end, or the ten minutes after its last in-call line. */
  nextDue(): number | null {
    if (this.options.plant === 'line-at-stop') return null;
    let due: number | null = null;
    for (const s of this.sessions.values()) {
      for (const open of s.open.values()) {
        const at = Math.min(open.overrun === undefined ? open.started + open.expected : Infinity, open.shown + LINE_EVERY_MS);
        if (due === null || at < due) due = at;
      }
    }
    return due;
  }

  /** What is due at `now`: each call past its expected time, and each ten minutes of one still running. */
  due(now: number): Due[] {
    if (this.options.plant === 'line-at-stop') return [];
    const out: Due[] = [];
    for (const [session, s] of this.sessions) {
      for (const open of s.open.values()) {
        const ran = now - open.started;
        if (open.overrun === undefined && ran >= open.expected) {
          open.overrun = now;
          open.shown = now;
          const line = lines.inCall(open.what, ran, open.expected);
          s.inCall = line;
          out.push({ kind: 'overrun', session, agent: s.agent, cwd: s.cwd, call: open, ran, line });
        } else if (now - open.shown >= LINE_EVERY_MS) {
          open.shown = now;
          const line = this.progressLine(s, now);
          s.inCall = line;
          out.push({ kind: 'progress', session, agent: s.agent, cwd: s.cwd, line });
        }
      }
    }
    return out;
  }

  /** A call that will not run (denied, or blocked before it ran) is no wait: it gets no PostToolUse to end it. */
  drop(session: string, call: string | undefined): void {
    const s = call ? this.sessions.get(session) : undefined;
    if (!s) return;
    s.open.delete(call!);
    if (!s.open.size) s.inCall = undefined;
  }
  /** A session's end forgets its waits. */
  forget(session: string): void { this.sessions.delete(session); }
}
