import { execFile } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

import { availableParallelism, loadavg } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';

import { readFacts } from '@deepbuild/adapters';

import { AskRefused } from '@deepbuild/asks';

import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';

import { type Connection, type EventInput, type RecordStore } from '@deepbuild/record';

import { readJson } from './claude-settings.js';
import { statKey } from './agent-files.js';

import { ownHome } from './keychain.js';

import { adapterOf } from './hookmap.js';
import { type Piece } from './context-fit.js';

import { isPrCreate } from './forge.js';

import { type Plant } from './plant.js';

import { AUTHORITY as EFFECTS, Refused, refusal, type HookMeta } from './wire.js';
import type { Live } from './session-types.js';
import type { Requests } from './requests.js';

/** A rule you type in a session (#344): `rule: <text>.` */
export const TYPED_RULE = /(?:^|\s)rule:[ \t]*([^\n]*?)\.(?=\s|$)/gi;

export const RULES_HEAD = 'Your rules, which DeepBuild gives every agent (from your rule files, the rules you typed and your decisions)';

/** A process running Codex's own binary, by the path it was started from. */
export const CODEX_BINARY = /^(?:\S*\/)?codex(?:-[^\s/]+)?(?:\s|$)/;

/** A Claude Code process: its native binary (`claude`, `claude.exe`, `claude/versions/<version>`) or its npm entry. */
export const CLAUDE_BINARY = /^(?:\S*\/)?claude(?:\.exe)?(?:\s|$)|^\S*\/claude\/versions\/[^\s/]+(?:\s|$)|@anthropic-ai\/claude-code\//;

export const HOUR = 3_600_000;

/** The least time between two appends of one running job's row (#1925), however fast its tool counts. */
export const JOB_ROW_MS = 1000;

/** How often open sessions' rollouts are looked for in their agent's archived folder: no hook says one moved (#342). */
export const ARCHIVED_THREADS_MS = 5000;

/** How often the hub reads what workspaces' verdicts pinned (#67). */
export const DRIFT_MS = 5 * 60_000;

export const DAY = 24 * HOUR;

/** A value quoted into SQL. */
export const sql = (text: string): string => text.replace(/'/g, "''");

/** A session ID as a handle holds it: letters and digits only. */
export const letters = (session: string): string => session.replace(/[^0-9A-Za-z]/g, '');

/** How long before its default a later ask comes back (#1462): an hour, drafted. */
export const LATER_BEFORE_MS = 60 * 60 * 1000;

/** A rules block as pieces, one per line under its head: a rule you typed must reach the model inline (#1296). */
export const rulePieces = (head: string, rules: readonly (readonly [string, string])[]): Piece[] =>
  [{ text: `${head}:`, keep: true }, ...rules.map(([handle, text]) => ({ text: `- ${text}`, ids: [handle], ...(handle.startsWith('rule:typed') ? { keep: true } : {}) }))];

/** The GitHub CLI's token, only while HOME is your own account's home: the archive reads CI logs with it (#20). */
export const ghToken = (): Promise<string | undefined> => {
  if (!ownHome()) return Promise.resolve(undefined);
  return new Promise((done) => execFile('gh', ['auth', 'token'], { timeout: 5000 }, (error, out) => done(error || !out.trim() ? undefined : out.trim())));
};

export const SECRETS_TTL = 10_000;

export const REACHED = 10_000;

/** The reading a session gets for a turn with tool calls none of whose hooks reached the hub. */
export const HOOKS_MISSING = 'hooks not reaching DeepBuild';

export const TRANSCRIPT_STEP = 64 * 1024 * 1024;

/** How long after the hub reads a turn's end it judges whether any of the turn's hooks reached it. */
export const TURN_GRACE = 100;

/** How long cursor changes gather before transcripts.json is written: a busy session writes it once, not per hook. */
export const CURSOR_SAVE = 200;

/** How long a working session's hooks may go quiet before its transcript's tail is read and, unchanged, it reads unknown. */
export const QUIET_MS = 30_000;

/** How often the hub reads GitHub's record of the repos sessions work in (#46): a pull request that stops merging has 60 s to wake its session. */
export const GITHUB_PASS_MS = 15_000;

/** How often the hub checks that the programs its hook entries run are there to run (#993). */
export const HOOK_CHECK_MS = 10 * 60_000;

/** A call that ended this recently still counts as running when our settings entries change. */
export const CALL_GRACE = 2_000;

/** A shell command that makes commits of its own: git commit, merge, cherry-pick, am, revert or rebase (#29). */
export const COMMITS = /(?:^|[\s;&|(])git(?:\s+-[Cc]\s+\S+|\s+--?[\w-]+(?:=\S+)?)*\s+(?:commit|merge|cherry-pick|am|revert|rebase)\b/;

/** How long a handed answer has to show in a turn before its delivery reads stalled and goes by the next route. */
export const WAKE_GRACE = 10_000;

/** Completion prompts in a row a session gets for stops that did work and ended on an empty message, before the claim stalls (#82). */
export const COMPLETION_PROMPTS = 3;

/** A gap between two of the 1 s beats, on the wall clock, longer than this is time the Mac slept with the hub up (#908). */
export const SLEPT = 10_000;

/** How soon after a hook's reply the transcript is read for the answers it carried (#906). */
export const SHOWN_SOON = 2_000;

/** What only an answer's own text says, as the transcript shows it in a turn (#906). */
export const said = (ask: string) => `Your answer to ask:${ask}`;

/** The most transcript entries of one turn the core keeps for its stop's records. */
export const TURN_ENTRIES = 5_000;

/** How long a Claude Code prompt whose transcript entry isn't written yet waits for the session's next hook (#567). */
export const PROMPT_PLACE_MS = 3000;

/** The cores the check slots are half of: this machine's, or DEEP_HUB_TEST_CORES's, which only tests set (#965). */
export const CORES = Number(process.env.DEEP_HUB_TEST_CORES) > 0 ? Math.floor(Number(process.env.DEEP_HUB_TEST_CORES)) : availableParallelism();

/**
 * The machine's 1-minute load against those cores, for a timing check's failed run (#352): DEEP_HUB_TEST_LOAD names a
 * file holding the load instead, read afresh each time; only tests set it.
 */
export const machineLoad = (): { load: number; cores: number } => {
  const file = process.env.DEEP_HUB_TEST_LOAD;
  let read = NaN;
  try { if (file) read = Number(readFileSync(file, 'utf8').trim()); } catch { /* unreadable: the machine's own reading */ }
  return { load: file && Number.isFinite(read) ? read : loadavg()[0]!, cores: CORES };
};

/** How many ended sessions the core still answers for, newest first. */
export const ENDED_KEPT = 64;

/** The agents whose hooks run Claude Code's entries but who aren't Claude Code: never a session's asks or claims. */
export const FOREIGN = new Set(['cursor', 'grok']);

/** The agents whose adapter has no route to hold a prompt at its submit: pi's package and paseo's plugin take none (#40, #55). */
export const HOLDS_NO_PROMPT = new Set(['pi', 'paseo']);

/** An agent whose idle session no answer can wake (caps.wakeIdle): what it is to read reaches it in a held stop or a call's reply. */
export const noWake = (agent: string | undefined): boolean => adapterOf(agent)?.caps.wakeIdle === false;

/** An agent whose own tool calls the adapter doesn't see (caps.nativeTools): its turn shows no work but its claim (#55). */
export const unseenTools = (agent: string | undefined): boolean => adapterOf(agent)?.caps.nativeTools === false;

/** An agent whose own package places an answer in its session, steering a running turn or starting one (caps.steer, caps.startTurn). */
export const placesItself = (agent: string | undefined): boolean => { const caps = adapterOf(agent)?.caps; return caps !== undefined && caps.steer && caps.startTurn; };

/** An agent one of whose processes runs many threads, as its facts' `daemon` says: a process there names no one session. */
export const manyThreads = (agent: string | undefined): boolean => (adapterOf(agent)?.facts as Obj | undefined)?.daemon !== undefined;

/** The commands that take effect only once the OS confirms you (#19), as `you.confirm` names them. */
/** The sign-in command each agent's facts name, by the agent's name as a task would say it (#84). */
export function signInCommands(): Record<string, string> {
  return readFacts<{ commands: Record<string, string> }>('sign-in.json').commands;
}

export const AUTHORITY = new Set(['deep off', 'deep on', 'deep hub stop', 'deep hub use', 'deep setup --undo']);

export type Obj = Record<string, unknown>;

/** The PIDs a test says another process now holds (DEEP_HUB_TEST_PID_REUSE, a JSON list read at each check); only tests set it. */
export const reusedPids = (): number[] => {
  const file = process.env.DEEP_HUB_TEST_PID_REUSE;
  if (!file) return [];
  try { const list = JSON.parse(readFileSync(file, 'utf8')) as unknown; return Array.isArray(list) ? list.filter((n): n is number => Number.isSafeInteger(n)) : []; } catch { return []; }
};

export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A verdict as the hub records and returns it: the gate's, or its opposite in #1334's planted misjudging build. */
export const misjudged = <V extends { outcome: string }>(v: V, plant: Plant | undefined): V => (plant === 'judges-claims-wrongly' ? { ...v, outcome: v.outcome === 'PASS' ? 'FAIL' : 'PASS' } : v);

export const isUnder = (path: string, dir: string) => {
  const rel = relative(dir, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};

/** The asks core's refusal as the socket's error@3, with the code that fits what it names. */
export const asRefused = (error: unknown): unknown => {
  if (!(error instanceof AskRefused)) return error;
  const code = error.outcome ? 'not_found' : error.option ? 'enum' : error.field === 'writer' ? 'role' : 'type';
  return new Refused(refusal(code, `/params/${error.option ? 'option' : error.field ?? 'ask'}`, error.message, error.option ?? error.ask ?? ''));
};

/** The watches of monitors a session armed that still run, as its row names them (#997). */
export const watching = (live: Live): string[] => [...live.background.values()].filter((b) => b.watch).map((b) => b.what);

/** The reading a session's row shows while its monitors' watches run (#997). */
export const waitingOn = (watches: string[]): string => `Waiting on its monitor ${backgrounded(watches)}: each event wakes it, and its stop is judged once the watch ends.`;

/** Background work as a session's row names it: each command in backticks, cut at 80 characters (#907). */
export const backgrounded = (what: string[]): string => what.map((w) => `\`${w.length > 80 ? `${w.slice(0, 80)}…` : w}\``).join(', ');

/** The tool kinds that only read: a turn of them alone, begun by your question, is an answer. */
export const READS = new Set(['read', 'search', 'fetch']);

/** What Claude Code queues for another session's message, a subagent's report or a task's notice: never typed. */
export const AUTOMATIC_QUEUED = /<task-notification>|^\s*<(?:cross-session-message|agent-message)\b/;

/**
 * What `<dir>/rules.json` says calls do: the effect classes each `effect:` guard entry stands for, by the entry's
 * name, and the class its `classes` give a tool, as deep-hook reads them.
 */
export let rulesSeen: { key: string; value: ReturnType<typeof readEffects> } | undefined;

export function effectEntries(dir: string): ReturnType<typeof readEffects> {
  const file = join(dir, 'rules.json');
  const key = `${file}\0${statKey(file)}`;
  if (rulesSeen?.key !== key) rulesSeen = { key, value: readEffects(dir) };
  return rulesSeen.value;
}

export function readEffects(dir: string): { effects: Map<string, string[]>; tools: Map<string, string> } {
  const effects = new Map<string, string[]>();
  const rules = readJson(join(dir, 'rules.json'));
  const entries = isObj(rules) && isObj(rules.entries) ? rules.entries : rules;
  for (const [name, entry] of Object.entries(isObj(entries) ? entries : {})) {
    const effect = isObj(entry) && typeof entry.match === 'string' ? /^effect:([\w-]+)$/.exec(entry.match)?.[1] : undefined;
    if (effect) effects.set(name, [effect]);
  }
  return { effects, tools: new Map(Object.entries(isObj(rules) && isObj(rules.classes) ? rules.classes : {}).map(([tool, c]) => [tool, String(c)])) };
}

/**
 * A call's tool.before as a person reads it, and whether it sends: a shell call that opens a pull request, one the
 * `effect:` guard entries deep-hook matched read as a push, merge, dispatch, send or delete, or an MCP tool whose
 * facts give it such an effect.
 */
export function callOf(d: Obj, { effects, tools }: ReturnType<typeof effectEntries>): { label: string; send: boolean; pr: boolean } {
  const kind = String(d.kind);
  const command = typeof d.command === 'string' ? d.command : undefined;
  const matched = (Array.isArray(d.matched) ? d.matched : []).flatMap((n) => effects.get(String(n)) ?? []);
  const pr = kind === 'shell' && command !== undefined && isPrCreate(command);
  // An MCP tool sends when its facts give it such an effect, or when it counts as send or destructive, by its facts or your rules.json.
  const counts = kind === 'mcp' ? tools.get(`mcp__${String(d.server)}__${String(d.tool)}`) ?? d.counts : undefined;
  const send = pr || matched.some((c) => EFFECTS.has(c)) || (kind === 'mcp' && ((typeof d.effect === 'string' && EFFECTS.has(d.effect)) || counts === 'send' || counts === 'destructive'));
  const paths = Array.isArray(d.paths) ? d.paths.map(String).join(', ') : '';
  const label = kind === 'shell' ? `Bash \`${command ?? ''}\`` : kind === 'mcp' ? `${String(d.server)} ${String(d.tool)}` : `${kind} ${paths}`;
  return { label, send, pr };
}

/** How long a home's mods, once read, stand without a change to what they're listed from. */
export const MODS_MS = 300_000;

/** The key an identical send matches by: a shell call's command, an MCP call's tool and the digest of its input (#1033). */
export const sendKey = (tool: string, command: string | undefined, input: unknown): string => (command !== undefined ? `shell:${command}` : `mcp:${tool}#${sha256Hex(canonicalize((input ?? null) as JsonValue))}`);

/** How long the gate waits on the forge for a cut-off send's result (#85): well inside the gate's 10 s hold. */
export const PULL_LOOKUP_MS = 4000;

/**
 * In a query over a session's events `e`: not a child session's stop (a subagent's agent.stop@5, which names the
 * child). A child's stop is no turn end of the session, so it never bounds a turn, ends a hold or carries a parked line.
 */
export const OWN_TURN = "NOT (e.kind = 'agent.stop' AND json_extract(e.data, '$.child') IS NOT NULL)";

export const holdsTurns = (data: Obj): boolean => data.owner === 'you' || ['sign_in_required', 'token_refresh_failed', 'plan_window_spent', 'refusal'].includes(String(data.cause));

/** A prompt Codex's subagent got, which its hook names with the root's session ID and an agent_id. */
export const childPrompt = (meta: HookMeta): boolean => meta.agent === 'codex' && Boolean(meta.fields?.agent_id);

/**
 * The record, killed with SIGKILL right after the append a test names (DEEP_HUB_TEST_CRASH): job.recorded, once a
 * job is recorded and before anything of it starts; job.started, once a job's process is tracked and before its
 * prompt is written. Only tests set it.
 */
/** The record, with its append replaced. */
/** The words an automatic continue of a stopped session goes into it with (#85). */
export function continueText(because: string, task: string | null): string {
  return because === 'task_closed' ? `DeepBuild: the task that blocked this session, ${task ?? ''}, closed. Continue where you left off.`
    : because === 'context_overflow' ? 'DeepBuild: this turn overflowed the context. Compact, then continue where you left off; this is its one automatic re-send.'
      : 'DeepBuild: this turn stopped on a dropped connection or an overloaded service. Continue where you left off; this is its one automatic continue.';
}

export function withAppend(record: RecordStore, append: RecordStore['append']): RecordStore {
  return new Proxy(record, {
    get: (target, key) => {
      if (key === 'append') return append;
      const value = Reflect.get(target, key, target) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/**
 * The record, each read it serves first logged to `file` as a JSON line: when it began, the method, and its SQL with
 * its bound values, or its arguments (DEEP_HUB_TEST_READS, #823). Only tests set it.
 */
export function readsLogged(record: RecordStore, file: string): RecordStore {
  writeFileSync(file, '');
  const reads = new Set(['raw', 'read', 'table', 'session', 'resolve', 'startSlice', 'loadLearned']);
  return new Proxy(record, {
    get: (target, key) => {
      const value = Reflect.get(target, key, target) as unknown;
      if (typeof value !== 'function') return value;
      const bound = (value as (...a: unknown[]) => unknown).bind(target);
      if (typeof key !== 'string' || !reads.has(key)) return bound;
      return (...args: unknown[]) => {
        // A raw read's bound values follow its SQL, so a read of an ask names its ID whether the ID is in the text or bound.
        const query = key === 'raw' ? (Array.isArray(args[1]) && args[1].length ? `${String(args[0])} -- ${JSON.stringify(args[1])}` : args[0]) : JSON.stringify(args);
        appendFileSync(file, `${JSON.stringify({ at: Date.now(), via: key, query })}\n`);
        return bound(...args);
      };
    },
  });
}

/** The record, calling `appended` after each append it took, and waiting for what it returns. */
export function streamed(record: RecordStore, appended: (input: EventInput, connection: Connection) => Promise<unknown> | undefined): RecordStore {
  return withAppend(record, async (connection, input, receipt) => {
    const event = await record.append(connection, input, receipt);
    await appended(input, connection);
    return event;
  });
}

/** The record, with a write's receipt committed beside the first event of it the write's effect names (#1577). */
export function receipted(record: RecordStore, requests: Requests): RecordStore {
  return withAppend(record, (connection, input, given) => {
    const taking = given ? undefined : requests.receiptFor(input);
    // An append that takes no receipt is the record's own promise: no step is added to the hook's path.
    if (!taking) return record.append(connection, input, given);
    return record.append(connection, input, taking.receipt).then(
      (appended) => { taking.landed(appended); return appended; },
      (error: unknown) => { taking.landed(undefined); throw error; },
    );
  });
}

export function crashing(record: RecordStore, point: string): RecordStore {
  const jobs = new Set<string>();
  const append: RecordStore['append'] = async (connection, input, receipt) => {
    // `before:<kind>`: the hub dies before it appends an event of that kind, after what the call that appends it does next.
    if (point === `before:${input.kind}`) {
      await new Promise((done) => setTimeout(done, 50));
      process.kill(process.pid, 'SIGKILL');
    }
    // `slow:<kind>`: an event of that kind takes 300 ms to append.
    if (point === `slow:${input.kind}`) await new Promise((done) => setTimeout(done, 300));
    const event = await record.append(connection, input, receipt);
    const run = isObj(input.data) ? String(input.data.job ?? input.data.run) : '';
    if (input.kind === 'job.recorded') jobs.add(run);
    if ((point === 'job.recorded' && input.kind === 'job.recorded') || (point === 'job.started' && input.kind === 'process.tracked' && jobs.has(run))) process.kill(process.pid, 'SIGKILL');
    return event;
  };
  return withAppend(record, append);
}
