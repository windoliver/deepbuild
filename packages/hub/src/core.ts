// The hub's core: the one writer to the record and the evidence store. It checks each hook against the
// session it claims, binds deep mcp calls to sessions, supervises check runs, replays deep-hook's spool, runs
// retention, and answers the socket's methods. It runs in a worker thread of its own, so a disk sync, a run's
// output or a backfill never holds up the event loop that acknowledges hooks.
import { execFile } from 'node:child_process';
import { appendFileSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { access, chmod, copyFile, mkdir, open, readFile, realpath, stat, type FileHandle } from 'node:fs/promises';
import { writtenOf as wikiWritten } from '@deepbuild/wiki';
import { UsageTail } from '@deepbuild/readings';
import { Numbers } from './numbers.js';
import { availableParallelism, homedir, loadavg, networkInterfaces } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ADAPTERS, readFacts, shipped } from '@deepbuild/adapters';
import { openArchive } from '@deepbuild/archive';
import { AskRefused, duration, openAsks, subjectKey, type Asks, type Delivery, type Resolver } from '@deepbuild/asks';
import { openLedger, type BudgetInput, type Ledger } from '@deepbuild/budget';
import { canonicalize, contextBoundFor, fixtures, registry as schemas, sha256Hex, type JsonValue, type Schema } from '@deepbuild/contracts';
import { openEvidenceStore, scrubText, type Evidence, type EvidenceStore, type Origin, type Peer, type PutResult } from '@deepbuild/evidence';
import { citedEvidence, openExtensionHost, openTrust, type ExtensionHost, type ProjectTrust, type ViewShown } from '@deepbuild/extension-host';
import { openRecord, RecordError, type Connection, type EventInput, type Message, type RecordStore } from '@deepbuild/record';
import { evidence, judge, resolverDecisions } from '@deepbuild/resolver-decisions';
import { answers as stackHealthy, composeKind, downStack, environmentOf, keysOf, leaseKinds, newRun, portKind, SESSION_KINDS, upStack, WarmStack } from '@deepbuild/env-local';
import { endsEmpty, freshCount, judgeStop, leftOpen, openCheckouts, priceDefinition, toldToRun, unitless, validityGate, type Checkouts, type PaidKind, type SessionLog, type StallCount, type StallRule, type TaskListFacts } from '@deepbuild/gate';
import { piAcceptsReplaced } from './plant.js';
import { openLeases, SLOW_SLOT, type LeaseTable } from '@deepbuild/leases';
import { Acceptance } from './acceptance.js';
import { openRunner, type JobRecord, type JobSpec, type Runner, type WindowReport } from '@deepbuild/runner';
import { alive as running, openSupervisor, openUnder, type Grant, type Host, type Supervisor } from '@deepbuild/supervisor';
import { predictionContradictions, recordVerdict, verdict as claimVerdict, verdictHash, verdictLine, type Prediction, type Result, type RunOutcome } from '@deepbuild/verdicts';
import { parse as parseYaml } from 'yaml';
import { ASK_WAIT_MS, claudeSettings, CONTINUATION_CAP, HOLD_MARGIN_MS, installed, readJson, relations, restore, STOP_HOLD_MS, tampered, words } from './claude-settings.js';
import { Confirmer } from './confirm.js';
import { keychain, ownHome } from './keychain.js';
import { recordedHome, codexRelations, holdsFor, modified, readTrust, saveTrust, sessionHomes, stopTimeoutS, trustProblems } from './codex-settings.js';
import { codexReadings, heartbeatsGone, loopsCovered, standingReadings, stands, uncoveredLoops } from './codex-loops.js';
import { sessionStates, statusRows, WAITING_QUIET_MS, type StatusRow } from './status.js';
import { buildRows, jobRow, listRows, orderOf, settle, type Placed, type Row, type RunningJob } from './rows.js';
import { addGuards, blocksCall, provenGuards, writeStanding } from './guards.js';
import { captureRejected, decisionKey, dropKept, guardOf, keepLesson, lessonsOf, rejectedDirections, repoFolders, revives, syncRejected, tasteBlock, tastesFor, type Lesson } from './memory.js';
import { AskTasks, type WorkItem } from './ask-tasks.js';
import { SizeScope } from './scope.js';
import { codexTrusted } from './codex-settings.js';
import { Holds } from './holds.js';
import { Spool } from './spool.js';
import { countMcp } from './mcp-servers.js';
import { opensOf, Questions, type Sorted } from './questions.js';
import { couldDo, reachOf, struck, type Reach, type ReachTool } from './could-do.js';
import { Staging } from './staging.js';
import { CAN_RUN, CANT_RUN, describe, RUN_BY, unrunnable } from './hook-programs.js';
import { SLASH_COMMAND, adapterOf, coveredBy, loopFact, registry, toolClasses, versionOf } from './hookmap.js';
import { continueLine, fit, type Part, type Piece } from './context-fit.js';
import { mergedWithMain, releaseSpec, switchesOff } from './release.js';
import { briefing, commitsBetween, headOf, loadsOf } from './session-facts.js';
import { cachedRuleFiles, creditOf, handleOf as ruleHandle, pageLines, reachOf as ruleReach, reachSince, readHeld, readRuleFiles, repoRoot, ruleId, rulesInFile, rulesOf, saveHeld, savePage, sameRule, setOf, type Held, type Rule, type RuleFile, type RuleFileBefore } from './rules.js';
/** A rule you type in a session (#344): `rule: <text>.` */
const TYPED_RULE = /(?:^|\s)rule:[ \t]*([^\n]*?)\.(?=\s|$)/gi;
const RULES_HEAD = 'Your rules, which DeepBuild gives every agent (from your rule files, the rules you typed and your decisions)';
import { GateRunner, type ClaimCheck, type DefinitionState, type RunKey, type StatePin } from './gate-runner.js';
import { Siblings } from './siblings.js';
import type { KeyFacts } from './shared-runs.js';
import { argsOf, groupUnder, parents, startOf } from './children.js';
import { deepHook, forgeOf, projectIdOf, repoOf, rootOf, type Root } from './paths.js';
import { inviteText, OWNER, People, scopeOf } from './people.js';
import { identityAt } from './identity.js';
import { MEMORY_TRANSCRIPTS, openWikiBuild, projectOf, type WikiBuilt } from './wiki-build.js';
import { Teardowns } from './teardowns.js';
import { Agents, type Sync } from './agents.js';
import { Box } from './box.js';
import { NEWER_SET, OLDER_SET, UNREAD_WINDOW } from './status.js';
import { aboutCall, aboutPermission, standingRules, type About } from './standing.js';
import { Channels, type ChannelAsk } from './channels.js';
import { Workspaces } from './workspaces.js';
import { checkKey, Devices } from './trusted.js';
import { aboutSessions, openIndex, pageClaims, search, type IndexFill } from './search.js';
import { changeSentence, openItemSentence, verdictSentence } from './sentences.js';
import { gateTokens, openGitHub, type AppKey, type GitHub, type GitHubPlant } from '@deepbuild/github';
import { closesIssue, Forge, isPrCreate, parsePrUrl, partOfIssue, prUrlIn } from './forge.js';
import { liveFetch, liveGraphql, readIssue, recordedFetch, recordedGraphql } from './github-source.js';
import { OpenItems } from './open-items.js';
import { claimState, isStatusQuestion, newestClaim, statusAnswer, type ClaimState } from './verdict-chat.js';
import { apiHost, networkCheck, reachable, slackConfig, slackThread, slackThreads } from './reach.js';
import { blockedCause, blockedReading, clockTime, dueReading, ownerOf, promisesIn, setPromise, promiseToken, wakeText, type PromiseState } from './promises.js';
import { Answers, answerText, type Answer } from './answers.js';
import { RUN_AS_YOU, Runs } from './runs.js';
import { Kinds, type ReviewOf } from './kinds.js';
import type { CheckSpec } from '@deepbuild/conformance';
import { retain } from './retention.js';
import { Stacks, type StackWant } from './stacks.js';
import { Starts } from './starts.js';
import { checkArguments, nearest } from './tools.js';
import { Canvas, nameOf, renderStill, showCall, waitForApp, WorldFile, type CanvasWorld } from './canvas.js';
import { panelKit } from './panels.js';
import { Replicas, REPLICA_LEASE } from './drive.js';
import { plantedReload, plantedSessionEnd, plantedStop, type Plant } from './plant.js';
import { draftedPools, HeavyQueue, JobPool, poolTokens } from './heavy.js';
import { Products } from './products.js';
import { LogReads } from './log-reads.js';
import { Hosts } from './hosts.js';
import { Jobs } from './jobs.js';
import { Libraries, LibraryRefused, LIBRARY_HOST_QUOTA, LIMIT_MAX, libraryHosts, type AssetKind } from './libraries.js';
import { readPack } from './packs.js';
import { excerpt, historyKey, type Restored } from './waits.js';
import { claudeHomes, claudeOnPath, denyHolds, homeMods, homeOfTranscript, loginPlan, MODS_GONE, MODS_WATCH, overrideWords, pluginDirs, type HomeMods } from './mods.js';
import { copySynced, disk, synced, testVfs, writeSynced, type Durable } from './vfs.js';
import { AUTHORITY as EFFECTS, CHROME, derivedId, EXTENSION_HOOK_MS, refuse, Refused, refusal, signature, ulid, ulidTime, type CoreOptions, type Draft, type ExtensionReply, type Gated, type HookMeta, type Refusal, type Scope, SCREEN_TOOLS } from './wire.js';

/** A process running Codex's own binary, by the path it was started from. */
const CODEX_BINARY = /^(?:\S*\/)?codex(?:-[^\s/]+)?(?:\s|$)/;
/** A Claude Code process: its native binary (`claude`, `claude.exe`, `claude/versions/<version>`) or its npm entry. */
const CLAUDE_BINARY = /^(?:\S*\/)?claude(?:\.exe)?(?:\s|$)|^\S*\/claude\/versions\/[^\s/]+(?:\s|$)|@anthropic-ai\/claude-code\//;
const HOUR = 3_600_000;
/** The least time between two appends of one running job's row (#1925), however fast its tool counts. */
const JOB_ROW_MS = 1000;
/** How often open sessions' rollouts are looked for in their agent's archived folder: no hook says one moved (#342). */
const ARCHIVED_THREADS_MS = 5000;
/** How often the hub reads what workspaces' verdicts pinned (#67). */
const DRIFT_MS = 5 * 60_000;
const DAY = 24 * HOUR;
/** A value quoted into SQL. */
const sql = (text: string): string => text.replace(/'/g, "''");
/** A session ID as a handle holds it: letters and digits only. */
const letters = (session: string): string => session.replace(/[^0-9A-Za-z]/g, '');
/** How long before its default a later ask comes back (#1462): an hour, drafted. */
const LATER_BEFORE_MS = 60 * 60 * 1000;
/** A rules block as pieces, one per line under its head: a rule you typed must reach the model inline (#1296). */
const rulePieces = (head: string, rules: readonly (readonly [string, string])[]): Piece[] =>
  [{ text: `${head}:`, keep: true }, ...rules.map(([handle, text]) => ({ text: `- ${text}`, ids: [handle], ...(handle.startsWith('rule:typed') ? { keep: true } : {}) }))];
/** The GitHub CLI's token, only while HOME is your own account's home: the archive reads CI logs with it (#20). */
const ghToken = (): Promise<string | undefined> => {
  if (!ownHome()) return Promise.resolve(undefined);
  return new Promise((done) => execFile('gh', ['auth', 'token'], { timeout: 5000 }, (error, out) => done(error || !out.trim() ? undefined : out.trim())));
};
const SECRETS_TTL = 10_000;
const REACHED = 10_000;
/** The reading a session gets for a turn with tool calls none of whose hooks reached the hub. */
const HOOKS_MISSING = 'hooks not reaching DeepBuild';
const TRANSCRIPT_STEP = 64 * 1024 * 1024;
/** How long after the hub reads a turn's end it judges whether any of the turn's hooks reached it. */
const TURN_GRACE = 100;
/** How long cursor changes gather before transcripts.json is written: a busy session writes it once, not per hook. */
const CURSOR_SAVE = 200;
/** How long a working session's hooks may go quiet before its transcript's tail is read and, unchanged, it reads unknown. */
const QUIET_MS = 30_000;
/** How often the hub reads GitHub's record of the repos sessions work in (#46): a pull request that stops merging has 60 s to wake its session. */
const GITHUB_PASS_MS = 15_000;
/** How often the hub checks that the programs its hook entries run are there to run (#993). */
const HOOK_CHECK_MS = 10 * 60_000;
/** A call that ended this recently still counts as running when our settings entries change. */
const CALL_GRACE = 2_000;
/** A shell command that makes commits of its own: git commit, merge, cherry-pick, am, revert or rebase (#29). */
const COMMITS = /(?:^|[\s;&|(])git(?:\s+-[Cc]\s+\S+|\s+--?[\w-]+(?:=\S+)?)*\s+(?:commit|merge|cherry-pick|am|revert|rebase)\b/;
/** How long a handed answer has to show in a turn before its delivery reads stalled and goes by the next route. */
const WAKE_GRACE = 10_000;
/** Completion prompts in a row a session gets for stops that did work and ended on an empty message, before the claim stalls (#82). */
const COMPLETION_PROMPTS = 3;
/** A gap between two of the 1 s beats, on the wall clock, longer than this is time the Mac slept with the hub up (#908). */
const SLEPT = 10_000;
/** How soon after a hook's reply the transcript is read for the answers it carried (#906). */
const SHOWN_SOON = 2_000;
/** What only an answer's own text says, as the transcript shows it in a turn (#906). */
const said = (ask: string) => `Your answer to ask:${ask}`;
/** The most transcript entries of one turn the core keeps for its stop's records. */
const TURN_ENTRIES = 5_000;
/** How long a Claude Code prompt whose transcript entry isn't written yet waits for the session's next hook (#567). */
const PROMPT_PLACE_MS = 3000;
/** The cores the check slots are half of: this machine's, or DEEP_HUB_TEST_CORES's, which only tests set (#965). */
const CORES = Number(process.env.DEEP_HUB_TEST_CORES) > 0 ? Math.floor(Number(process.env.DEEP_HUB_TEST_CORES)) : availableParallelism();
/**
 * The machine's 1-minute load against those cores, for a timing check's failed run (#352): DEEP_HUB_TEST_LOAD names a
 * file holding the load instead, read afresh each time; only tests set it.
 */
const machineLoad = (): { load: number; cores: number } => {
  const file = process.env.DEEP_HUB_TEST_LOAD;
  let read = NaN;
  try { if (file) read = Number(readFileSync(file, 'utf8').trim()); } catch { /* unreadable: the machine's own reading */ }
  return { load: file && Number.isFinite(read) ? read : loadavg()[0]!, cores: CORES };
};
/** How many ended sessions the core still answers for, newest first. */
const ENDED_KEPT = 64;
/** The agents whose hooks run Claude Code's entries but who aren't Claude Code: never a session's asks or claims. */
const FOREIGN = new Set(['cursor', 'grok']);
/** The agents whose adapter has no route to hold a prompt at its submit: pi's package and paseo's plugin take none (#40, #55). */
const HOLDS_NO_PROMPT = new Set(['pi', 'paseo']);
/** An agent whose idle session no answer can wake (caps.wakeIdle): what it is to read reaches it in a held stop or a call's reply. */
const noWake = (agent: string | undefined): boolean => adapterOf(agent)?.caps.wakeIdle === false;
/** An agent whose own tool calls the adapter doesn't see (caps.nativeTools): its turn shows no work but its claim (#55). */
const unseenTools = (agent: string | undefined): boolean => adapterOf(agent)?.caps.nativeTools === false;
/** An agent whose own package places an answer in its session, steering a running turn or starting one (caps.steer, caps.startTurn). */
const placesItself = (agent: string | undefined): boolean => { const caps = adapterOf(agent)?.caps; return caps !== undefined && caps.steer && caps.startTurn; };
/** An agent one of whose processes runs many threads, as its facts' `daemon` says: a process there names no one session. */
const manyThreads = (agent: string | undefined): boolean => (adapterOf(agent)?.facts as Obj | undefined)?.daemon !== undefined;
/** The commands that take effect only once the OS confirms you (#19), as `you.confirm` names them. */
/** The sign-in command each agent's facts name, by the agent's name as a task would say it (#84). */
function signInCommands(): Record<string, string> {
  return readFacts<{ commands: Record<string, string> }>('sign-in.json').commands;
}
const AUTHORITY = new Set(['deep off', 'deep on', 'deep hub stop', 'deep hub use', 'deep setup --undo']);
type Obj = Record<string, unknown>;
/** The PIDs a test says another process now holds (DEEP_HUB_TEST_PID_REUSE, a JSON list read at each check); only tests set it. */
const reusedPids = (): number[] => {
  const file = process.env.DEEP_HUB_TEST_PID_REUSE;
  if (!file) return [];
  try { const list = JSON.parse(readFileSync(file, 'utf8')) as unknown; return Array.isArray(list) ? list.filter((n): n is number => Number.isSafeInteger(n)) : []; } catch { return []; }
};
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A verdict as the hub records and returns it: the gate's, or its opposite in #1334's planted misjudging build. */
const misjudged = <V extends { outcome: string }>(v: V, plant: Plant | undefined): V => (plant === 'judges-claims-wrongly' ? { ...v, outcome: v.outcome === 'PASS' ? 'FAIL' : 'PASS' } : v);
const isUnder = (path: string, dir: string) => {
  const rel = relative(dir, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};

/**
 * What a connection brings to a call: its role, the session it is bound to, for deep mcp the process it serves, and
 * for the app or the CLI the process its hello named as its own.
 */
export interface CallContext { role: string; session?: string | null; parent?: { pid: number; start: string }; cwd?: string; peer?: { pid: number; start: string }; waiter?: number; /** A deep mcp call's `<connection>:<call ID>`, which a cancel names (#1923). */ call?: string }
/** The asks core's refusal as the socket's error@3, with the code that fits what it names. */
const asRefused = (error: unknown): unknown => {
  if (!(error instanceof AskRefused)) return error;
  const code = error.outcome ? 'not_found' : error.option ? 'enum' : error.field === 'writer' ? 'role' : 'type';
  return new Refused(refusal(code, `/params/${error.option ? 'option' : error.field ?? 'ask'}`, error.message, error.option ?? error.ask ?? ''));
};
/**
 * A session as its own hooks established it: the agent process, its working folder and its transcript; and how
 * far the core has read that transcript, the turn it is in there, and the tool calls whose hooks reached the hub.
 */
interface Session {
  id: string; agent: string; pid: number; start: string; cwd: string; transcript: string; ended: boolean;
  /** Ended by a kill, a crash or a shutdown, with no SessionEnd: it can be resumed, and keeps its stacks until it ends (#342). */
  interrupted?: boolean;
  /**
   * Whether a second hook named its process as their parent (#992): the agent's process, then, which the hub watches
   * for its end, and no wrapper that stays for one hook alone.
   */
  watched?: boolean;
  /**
   * The calls whose results its transcript has shown lately, newest last: a prompt's own call among them, with no hook
   * since, shows the prompt closed (#992).
   */
  results?: string[];
  /** The thread its ID joins: IDs rotated by `/clear`, `/compact` or a fork are one thread. */
  thread: string;
  read: number; turn: Turn | undefined; closed: Turn[]; reached: Set<string>;
  /** Calls whose hooks' events are on their way to the record, and how many: their turns wait for them. */
  pending: Map<string, number>;
  /** Whether its closed turns wait for a replay's end to be judged. */
  deferred?: boolean;
  /** The timer that judges its closed turns once their grace has passed. */
  judging?: NodeJS.Timeout | undefined;
  /** Its prompts' transcript entries, by prompt ID, which a prompt's origin joins to. */
  prompts: Map<string, Obj>;
  /** The transcript entries of its current turn, which its stop's cause and usage are read from. */
  entries: Obj[];
  /**
   * Its transcript's queue as it stands, each message marked once a hook found it waiting there (#340); and the
   * prompts recorded from the queue, or from a UserPromptSubmit, that the other hasn't shown yet: each message is
   * recorded once.
   */
  queued?: { text: string; taken: boolean }[]; fromQueue?: string[]; prompted?: string[];
  /**
   * The prompt hooks whose message the queue had shown, with the origin each mapped to and the queue's draft of the
   * message, which holds its task once appended: their event is the queue's, not their own (#83 reads both here).
   */
  spliced?: Map<string, { from: string; task: Draft | undefined }>;
  /** The queue's drafts in order, until the prompt hook that takes each. */
  queuedTasks?: Draft[];
}
/** The watches of monitors a session armed that still run, as its row names them (#997). */
const watching = (live: Live): string[] => [...live.background.values()].filter((b) => b.watch).map((b) => b.what);
/** The reading a session's row shows while its monitors' watches run (#997). */
const waitingOn = (watches: string[]): string => `Waiting on its monitor ${backgrounded(watches)}: each event wakes it, and its stop is judged once the watch ends.`;
/** Background work as a session's row names it: each command in backticks, cut at 80 characters (#907). */
const backgrounded = (what: string[]): string => what.map((w) => `\`${w.length > 80 ? `${w.slice(0, 80)}…` : w}\``).join(', ');
/**
 * What the core follows of every session by its hooks, checked or not: its attention, its open calls, the commit
 * its worktree had, and its loop: wake-ups and crons it scheduled, background subagents and commands still to report, by call,
 * and the watches of monitors it armed, by their ID, each until its stop call, its process group ending or its timeout (#997).
 */
interface Live {
  agent: string; cwd: string; state?: string; last: number; quiet?: NodeJS.Timeout | undefined; quietDue?: number; heard?: number;
  /** Its newest call, and the call whose permission prompt it waits on (#992): a PermissionRequest follows its call's PreToolUse. */
  lastCall?: string; asking?: string | undefined;
  calls: Map<string, { what: string; ended?: number }>; head?: string | undefined; unborn?: boolean; reading?: Promise<void>;
  from?: string; wakeups: number[]; crons: Map<string, { due: number | null; recurring: boolean }>; background: Map<string, { what: string; group?: number; watch?: { expires: number | null } }>; looping: boolean;
  /** The IDs of every watch it armed, running or ended: an event naming one is its monitor's, never another's report (#997). */
  armed?: Set<string>;
  /**
   * What a green stop hands the gate runner with its loop reading (#965): the origin of the prompt that opened the
   * turn (a message typed mid-turn is your words, not the turn's origin), the soonest wake-up or cron job due at the
   * stop, and what starts its slow checks whatever the loop does: a claim made in the turn, or your words since the
   * last turn end.
   */
  turnFrom?: string; due?: { at: number; what: 'wake-up' | 'cron' } | null; claimedInTurn?: boolean; words?: 'words' | 'answer' | undefined;
  /**
   * Its turns as the verdict line judges them (#83): the turn's count and whether the stop rule reads its stop as a
   * claim; the newest claim the line reads and the turn it was made in; the line last delivered to the chat, so
   * one that lands later goes with the next prompt.
   */
  /**
   * What the stop rule's exceptions read (#82): whether its newest stop did no work and isn't an answer, so an ask it
   * leaves open gets one send-back; whether the app's resume prompt came since its last stop and the turn its newest
   * start cut off had done work, for the one automatic continue; whether the reply to its last stop kept the turn
   * going; and the pull request its turn opened.
   */
  idle?: boolean; resumed?: boolean; cutOff?: boolean; sentOn?: boolean; prOpened?: string | undefined;
  turn: number; turnTask?: string | undefined; turnAsk?: string | undefined; judged: boolean; claiming?: Promise<string[]> | undefined; deferred?: (() => Promise<string[]>) | undefined; workedSinceClaim?: boolean; claim?: string | undefined; heldClaim?: string | undefined; claimTurn?: number; delivered?: string | undefined;
}
/**
 * A turn of a transcript: where its prompt starts there, its tool calls, and for a closed one when the hub read
 * its end (its monotonic clock).
 */
interface Turn { uuid: string; from: number; calls: string[]; at?: number; recording?: boolean }
/**
 * A session's numbering and what the stop rule reads of its turn: no prompt since its start, the prompt the turn
 * began with (typed by a person, opening a task or not), and whether it made an edit, a write or an ask.
 */
interface Counter { msgs: number; turns: number; worked: boolean; fresh?: boolean; prompt?: { person: boolean; opened: boolean }; changed?: boolean }
/** The tool kinds that only read: a turn of them alone, begun by your question, is an answer. */
const READS = new Set(['read', 'search', 'fetch']);
/** What Claude Code queues for another session's message, a subagent's report or a task's notice: never typed. */
const AUTOMATIC_QUEUED = /<task-notification>|^\s*<(?:cross-session-message|agent-message)\b/;
/**
 * The routes back into a session (#25): the hooks of ours it showed firing since it last started, on a version its
 * facts cover; its stops held now; when a hook last showed a turn running (wall ms); its waiter; the turn's
 * continuations; send-backs planted for its next stop and what waits past the cap for its next prompt; and whether
 * its app showed a wake working.
 */
interface Routes {
  /**
   * `ended`: when a StopFailure last ended the newest turn (wall ms); the session is idle from then until a hook
   * shows work. `prompt`: the newest prompt's id, the turn a StopFailure must name to end it. `handed`: continues a
   * waiter took that no turn has shown yet; the next prompt carries them unless it is the wake that shows them.
   */
  cwd: string; shown: Set<string>; covered: boolean; holding: number; busy: number; ended: number; prompt?: string | undefined; handed?: string[];
  waiter?: { key: number; at: number; since: number; give(reply: Obj): void } | undefined;
  continued: number; capped: boolean; sendBacks: string[]; later: string[]; wakes?: boolean;
  /** The claims whose slow checks a stop wasn't held for (#39): each one's verdict goes with the next prompt after it ends. */
  slowClaims?: string[];
  /** Its waiter is the agent's own package, which places an answer itself, busy or idle, and says what became of each (#40). */
  places?: boolean; placing?: Set<string>;
  /** paseo's plugin, waiting to prompt a session deep-hook gates where deep-hook's own wake isn't there (#55). */
  relay?: { key: number; at: number; since: number; give(reply: Obj): void } | undefined;
  /**
   * The cause of its newest stop while that cause's task is open (#85): a sign-in, a token refresh, a refusal, a
   * spend limit, a plan window, or any block you own. No turn DeepBuild causes starts there: what would wake it waits
   * on its row and goes with the resume. Cleared by a turn running, a prompt you typed or the continue that resumes it.
   */
  blocked?: string | undefined;
}
/** Whether a stop's cause holds the turns DeepBuild would start in its session until its task closes (#85). */
/** A call of the cut-off turn with no recorded end (#85): how the block names it, the key an identical send matches by, and whether it is a send that opens a pull request. */
interface CutOff { key: string; label: string; send: boolean; pr: boolean }
/**
 * What `<dir>/rules.json` says calls do: the effect classes each `effect:` guard entry stands for, by the entry's
 * name, and the class its `classes` give a tool, as deep-hook reads them.
 */
let rulesSeen: { key: string; value: ReturnType<typeof readEffects> } | undefined;
function effectEntries(dir: string): ReturnType<typeof readEffects> {
  const file = join(dir, 'rules.json');
  const key = `${file}\0${statKey(file)}`;
  if (rulesSeen?.key !== key) rulesSeen = { key, value: readEffects(dir) };
  return rulesSeen.value;
}
function readEffects(dir: string): { effects: Map<string, string[]>; tools: Map<string, string> } {
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
function callOf(d: Obj, { effects, tools }: ReturnType<typeof effectEntries>): { label: string; send: boolean; pr: boolean } {
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
/** A file's identity, size and time, so a change is read once; 'none' while it is missing. */
const statKey = (file: string): string => { try { const s = statSync(file); return `${s.ino}:${s.size}:${s.mtimeMs}`; } catch { return 'none'; } };
/** How long a home's mods, once read, stand without a change to what they're listed from. */
const MODS_MS = 300_000;
/** The key an identical send matches by: a shell call's command, an MCP call's tool and the digest of its input (#1033). */
const sendKey = (tool: string, command: string | undefined, input: unknown): string => (command !== undefined ? `shell:${command}` : `mcp:${tool}#${sha256Hex(canonicalize((input ?? null) as JsonValue))}`);
/** How long the gate waits on the forge for a cut-off send's result (#85): well inside the gate's 10 s hold. */
const PULL_LOOKUP_MS = 4000;
/**
 * In a query over a session's events `e`: not a child session's stop (a subagent's agent.stop@5, which names the
 * child). A child's stop is no turn end of the session, so it never bounds a turn, ends a hold or carries a parked line.
 */
const OWN_TURN = "NOT (e.kind = 'agent.stop' AND json_extract(e.data, '$.child') IS NOT NULL)";
const holdsTurns = (data: Obj): boolean => data.owner === 'you' || ['sign_in_required', 'token_refresh_failed', 'plan_window_spent', 'refusal'].includes(String(data.cause));
/** Your words sent from the app into a session (#340), by the delivery's request ID. */
interface Note { session: string; text: string; request: string }
/**
 * Where a session's transcript is judged from after a restart, and the calls whose hooks reached the hub past there;
 * for an ended session with turns still to judge, its agent too, since no hook of it comes again.
 */
interface Cursor {
  transcript: string; read: number; reached: string[]; ended?: { agent: string };
  /** The agent process the hub watched for the session's end (#992), which a hub started again goes on watching. */
  watch?: { agent: string; pid: number; start: string } | undefined;
}
/** A PreToolUse deep-hook stamped for a deep_* call, which one call of that session's deep mcp may bind to. */
interface Stamp { session: string; tool: string; digest: string }

/** A prompt Codex's subagent got, which its hook names with the root's session ID and an agent_id. */
const childPrompt = (meta: HookMeta): boolean => meta.agent === 'codex' && Boolean(meta.fields?.agent_id);


export class Core {
  private readonly root: Root;
  private readonly now: () => number;
  private readonly durable: Durable;
  private readonly spool: Spool;
  private record!: RecordStore;
  /** The record's raw reads, as the helpers that take them call them: parameters bound. */
  private readonly raw: RecordStore['raw'] = (sql, params) => this.record.raw(sql, params);
  /** The log's pages, read-ahead and stream; a read waits for the appends in flight, and the owner's stream reads what the owner may see (#1337). */
  private readonly log = new LogReads({ raw: this.raw, settled: () => Promise.allSettled([...this.inflight]), ownerSeen: () => this.seenBy(OWNER), emit: (sub, json, caught) => this.emit(sub, json, caught) });
  private asks!: Asks;
  /** Online model libraries (#1731): which are on, your standing rules, searches and fetches. */
  private libraries?: Libraries;
  /** The job kinds' runs (#1922): the cache by key, your standing rules for paid tools, and the asks they wait on. */
  private jobKinds?: Jobs;
  /** Hosts your SSH config names, their facts and the runs on them (#1942). */
  private readonly hosts: Hosts;
  /** What the app last said of macOS and its notifications (#994). */
  private notifications: string | null = null;
  /** Authority at PreToolUse (#321): the planted sorter's proceeds, the servers' tool lists, and the calls held for you. */
  private readonly holds: Holds;
  /** Only real questions reach you (#84): what a stop ends on, and the question cards a turn raises, sorted. */
  private readonly questions: Questions;
  /** Your switches from a provisional ask's option, in flight: the commits made under the old one (#84). */
  private readonly switches = new Map<string, string[]>();
  /** One session's transcript copied into the record now; unset until the archive opens. */
  private archiveSession?: (session: string) => Promise<void>;
  /** The sessions whose transcripts their agents moved to an archived folder; unset until the archive opens. */
  private archivedSessions?: () => Promise<Set<string>>;
  /** The ask each plug-in change or send waits on, by its session and request ID (#363). */
  private readonly actionAsks = new Map<string, string>();
  /** Ask-tasks in the kernel (#303): a task for each prompt you typed that asks for a change, and its definition locked by hash. */
  private readonly tasks: AskTasks;
  private readonly sizing: SizeScope;
  /** What claims leave open, as open items in the record (#323). */
  private readonly openItems: OpenItems;
  /** The commands each claim's final message told you to run, which its gate ran as the agent's own checks (#323). */
  private readonly told = new Map<string, Set<string>>();
  /** The gate runner (#29): each claim's checks on its snapshot, in their lanes, under the stop's hold. */
  private readonly gate: GateRunner;
  /** The session map and the notices it hands each session, and the loop rule (#352). */
  private readonly siblings: Siblings;
  /** The sessions told the loop rule is watch-only for them (#352). */
  private readonly loopWatched = new Set<string>();
  /** Each session's last stop's final message, what its claims cite (#29). */
  private readonly lastMessage = new Map<string, string>();
  /** What each claim's stop waits on: its fast lane, and what the hold reports of it. */
  private readonly lanes = new Map<string, Promise<{ fast: string[]; slow: string[]; snapshot: string; readyAt: number; budgetCost?: string[]; changed?: boolean; findings: string[] }>>();
  private readonly numbers: Numbers;
  /** Each live session's running usage, from its transcript and its subagents'. */
  private readonly tails = new Map<string, UsageTail>();
  /** The project trust decision the core holds (#348), which the done gate reads for a repo's spec checks (#322). */
  private trust!: ProjectTrust;
  /** Each claim's requirements by handle, with the ID and text a send-back names (#322). */
  private readonly claimRequirements = new Map<string, Map<string, { id: string; text: string }>>();
  /** Each claim's task, base and folder, for its size and scope at its stop (#324). */
  private readonly claimScopes = new Map<string, { task: string; base: string; cwd: string }>();
  /** The one ledger of the budgets you approved (#86), each issue's budget ask with the budget your yes approves, and each claim's paid checks (#325). */
  private ledger!: Ledger;
  private readonly budgetAsks = new Map<string, BudgetInput>();
  private readonly paidChecks = new Map<string, Map<string, { paid: PaidKind; task: string }>>();
  /** The sessions whose next stop with no work may be sent on (#82): their stops are held for the reply. */
  private readonly nudgeable = new Set<string>();
  /** The asks each session's no-work stops were sent back on once (#82); a judged stop starts it again. */
  private readonly idleSent = new Map<string, Set<string>>();
  /** Each session's completion prompts in a row (#82): a stop that says something starts the count again. */
  private readonly completions = new Map<string, number>();
  /** Each task's count toward a stalled claim, and each stalled claim's one decision by its ask (#325). */
  private readonly stalls = new Map<string, StallCount>();
  private readonly stallAsks = new Map<string, { task: string; session: string; agent: string }>();
  /** The tasks you accepted as proven, and the switches you decided stay off, by folder and name, with each switch's ask (#325). */
  private readonly accepted = new Set<string>();
  private readonly offDecided = new Set<string>();
  private readonly switchAsks = new Map<string, { key: string; name: string; deployed: string; task: string; issue: number; session: string; agent: string }>();
  /** Claims in an untrusted repo whose spec names checks (#322): watch-only, so none of them passes. */
  private readonly watchOnlyClaims = new Set<string>();
  /** Claims a target of whose requirements no longer resolves (#323): each verdict on them is INVALID, naming it. */
  private readonly unresolvedTargets = new Map<string, { req: string; reason: string }[]>();
  /** Sessions told once that their repo's spec checks are watch-only until the project is trusted. */
  private readonly toldUntrusted = new Set<string>();
  /** Staging for destructive commands (#347): a delete whose reach can't be worked out, staged copy-on-write or asked about. */
  private readonly staging: Staging;
  private readonly devices: Devices;
  private readonly confirmer: Confirmer;
  private store!: EvidenceStore;
  private supervisor!: Supervisor;
  private checkouts!: Checkouts;
  /** The kernel's lease table (#237), read by deep env down for who holds a port now, and the gate runner's cpu.slot. */
  private leases!: LeaseTable;
  /** The queue `deep lease` waits in, and the heavy commands it holds leases for (#1015). */
  private heavy!: HeavyQueue;
  private pool?: JobPool;
  private readonly products: Products;
  /** The test's index@1 fill for the wiki, if it named one; the ledger's own index otherwise. */
  private index!: Promise<IndexFill | undefined>;
  /** A package's index, once rebuilt from the pages. */
  private swapped: IndexFill | undefined;
  /** host@1: where every check run starts, is signalled and waited for; the supervisor, unless a test put another in its place. */
  private host!: Host;
  /** The sessions whose stop a running hub replayed from the spool, to judge once the replay ends (#580). */
  private readonly lateStops: string[] = [];
  /** env-local's compose kind, with the Docker CLI it found when the hub started (#331). */
  private compose?: ReturnType<typeof composeKind>;
  /** DeepBuild's own headless jobs (#159): their hooks are theirs, never a session's. */
  private runner!: Runner;
  /** The blind acceptance job (#1328): the runner's one kind that writes, before an issue's first attempt. */
  private acceptance!: Acceptance;
  /** Sessions started without your Send, under a run you approved (#1330). */
  private sessionStarts!: Starts;
  /** Setup's wiki build (#356). */
  private wikiBuild!: { build(): Promise<WikiBuilt>; forget(claim: string): Promise<string>; writeRules(): Promise<void> };
  /** The taste calls each session was given since it started, and the sessions whose first prompt was read for its screen (#111). */
  private tasted = new Map<string, Set<string>>();
  /** What each session was given of your rules (#344): the set's handles, whether its next prompt carries every rule you typed, and a rule file's lines before an agent's edit. */
  private ruleState = new Map<string, { given: Set<string>; full: boolean; editing: Map<string, RuleFileBefore[]> }>();
  /** Each repo's rule files, read at most once a few seconds, so a call's notice reads no folder tree. */
  private ruleFiles = new Map<string, { at: number; files: RuleFile[] }>();
  private firstPrompted = new Set<string>();
  /** Hooks from a running job's folder held until the runner reads that job's session ID, by job. */
  private readonly parked = new Map<string, Promise<void>>();
  /** Each session a reading named a job for, once. */
  private readonly readings = new Set<string>();
  private readonly ready: Promise<void>;
  private readonly sessions = new Map<string, Session>();
  /** The cursors the last hub left for sessions this one hasn't met yet. */
  private cursors = new Map<string, Cursor>();
  /** The pending write of transcripts.json. */
  private saving: NodeJS.Timeout | undefined;
  /**
   * What the stop rule reads of each session's turns: whether no prompt has come since its start (a startup, a resume
   * or /clear), the prompt its turn began with, and whether the turn made an edit, a write or an ask.
   */
  private readonly counters = new Map<string, Counter>();
  /** The work items prompts name, read off the hook's parse, for the append that opens their tasks. */
  private readonly items = new WeakMap<Draft, WorkItem>();
  /** The sessions that ended, oldest end first. */
  private readonly endedOrder = new Set<string>();
  /** Unspent PreToolUse stamps: a call that binds to one spends it, and SessionEnd spends its session's. */
  private stamps: Stamp[] = [];
  /** How long each run still going is expected to take, in seconds, by run handle: what the line's "about" reads (#83). */
  private readonly expected = new Map<string, number>();
  /** Each process's start time, as `ps -o lstart=` prints it: how a process is told apart from a reused PID. */
  private readonly starts = new Map<number, Promise<string | undefined>>();
  /** A hook's parent's command line, read once for the hook: its start's readers share one `ps`. */
  private readonly argsRead = new WeakMap<HookMeta, Promise<string>>();
  private parentArgs(meta: HookMeta): Promise<string> {
    let read = this.argsRead.get(meta);
    if (!read) this.argsRead.set(meta, (read = argsOf(meta.ppid).catch(() => '')));
    return read;
  }
  /** Hooks and calls run in arrival order: a deep_* call finds the stamp its PreToolUse left. */
  private chain: Promise<unknown> = Promise.resolve();
  /** Whether the start has finished: from then on, work waiting for it joins the queue at once. */
  private opened = false;
  private blocked: string | undefined;
  /** The hub's lock file was removed or replaced under it (#909): appends stop for good, so `blocked` never clears. */
  private lost = false;
  /** Unset until the start opened it: a start that fails before has nothing to close or ask. */
  private extensions: ExtensionHost | undefined;
  /** The ways to reach you (#65), once the extensions are ready. */
  private channels: Channels | undefined;
  /** Work outside a repo (#67). */
  private readonly spaces: Workspaces;
  /** The project each session entered, for its packs (#67). */
  private readonly entered = new Map<string, string>();
  /** The supervisor's runs (runs.ts). */
  private readonly runs: Runs;
  private readonly checkKinds: Kinds;
  /** Each claim's checks of a kind other than command, by check (#1537): its spec, and the claim's session for a review. */
  private readonly kindChecks = new Map<string, Map<string, { spec: CheckSpec; of: ReviewOf }>>();
  /** Each worktree's stack and every stack run a check started (#331, #332). */
  private readonly stacks: Stacks;
  /** Each outside resource a session created, and its teardown task (#342). */
  private readonly teardowns: Teardowns;
  /** The Agents page's syncs (#148): servers and skills written into each agent's own files. */
  private readonly agents: Agents;
  /** The box (#1998): changes in words, each a proposal you approve. */
  private readonly box: Box;
  /** Each session's deep_drive replicas (#124). */
  private readonly replicas: Replicas;
  /** The screen each session's computer use last switched to, one it leases (#332). */
  private readonly onScreen = new Map<string, string>();
  /** Appends handed to the record and not yet settled: a read waits for them, so it sees every hook acknowledged before it. */
  private readonly inflight = new Set<Promise<unknown>>();
  private secrets: { at: number; value: Promise<string> } | undefined;
  private readonly timers: NodeJS.Timeout[] = [];
  /**
   * Each background job's failures in a row, when the first of them was and the last one's error, cleared by its
   * next clean run (#909): one blip reads apart from a job that has failed for an hour.
   */
  private readonly jobs = new Map<string, { failures: number; since: number; at: number; error: string } | null>();
  private stopping = false;
  /** A promotion's drain (#1334): no session starts until the hub restarts on the new build. */
  private draining = false;
  private replaying: Promise<unknown> | undefined;
  /** Only the drops-post-tool-use and replay-appends-twice plants read them. */
  private dropped = false;
  /** Whether appends came back during a replay, so the files it kept are taken again after it. */
  private retake = false;
  /** Every session the hooks named, checked or not, by ID. */
  private readonly live = new Map<string, Live>();
  private github: GitHub | undefined;
  /** The sessions that got their reading for a version past their facts. */
  private readonly versioned = new Set<string>();
  /** Sessions whose caller name the payload contradicted, each read once (#993). */
  private readonly miscalled = new Set<string>();
  /** The commits recorded, so one made across two hooks is recorded once. */
  private readonly committed = new Set<string>();
  /** The watch on Claude Code's user settings, and the readings it and the session-start recheck took. */
  private watcher: FSWatcher | undefined;
  private settingsKey = '';
  private readonly settingsReadings: string[] = [];
  /** Hooks waiting on a network stop's try, which the hub finishes before it stops. */
  private readonly tried = new Set<Promise<unknown>>();
  /**
   * Claude Code prompts set aside until their transcript entry is written, by session (#567): Claude Code writes a
   * prompt's entry only once its hooks have returned, and the origin joins the prompt to that entry.
   */
  private readonly unplaced = new Map<string, { drafts: Draft[]; meta: HookMeta; writer: string; timer: NodeJS.Timeout; done: (settled: Promise<void>) => void }>();
  /** Held stops, each woken when an answer for its session is ready to deliver. */
  private readonly waiting = new Map<string, Set<() => void>>();
  /** The log position of the last session.continued the hub routed (#85). */
  private continuedPos = 0;
  /** The sends each session's cut-off turn started with no recorded end (#85), by the key an identical call matches: denied at PreToolUse with the earlier result. */
  private readonly unknownSends = new Map<string, Map<string, { label: string; pr: boolean; denied?: boolean; done?: boolean }>>();
  /** The calls a guard entry or the gate denied at PreToolUse, by session and call (#1033): what denied each, and the call in words. */
  private readonly denials = new Map<string, Map<string, { guard: string; label: string }>>();
  /** Each session's denied calls that ran anyway (#1033), as they arrive: its claims don't pass on its own evidence. */
  private readonly overrides = new Map<string, { call: string; label: string; ts: number }[]>();
  /** Each session's sends in its turn under way, by call (#1033): the key an identical send matches by, and whether it completed. */
  private readonly turnSends = new Map<string, Map<string, { key: string; label: string; done: boolean }>>();
  /** When this core started: a deny from before it is read back from the record (#1033). */
  private readonly bootAt = Date.now();
  /** Each Claude Code home's mods as last read, by what they were read from (#1033). */
  private readonly modsSeen = new Map<string, { at: number; read: Promise<HomeMods> }>();
  /** Each Claude Code home's login plan as `claude auth status` last read it, by the files a sign-in rewrites. */
  private readonly plansSeen = new Map<string, { key: string; at: number; plan: Promise<unknown> }>();
  /** The continues being read, one reading at a time, so the timer's and a prompt's never carry the same one twice. */
  private continuing: Promise<void> = Promise.resolve();
  /** deep_wait and deep_run calls, by the ask or run they wait on, each woken by the event that settles it (#823). */
  private readonly settling = new Map<string, Set<() => void>>();
  /** Each session's routes back into it, by session ID. */
  private readonly routes = new Map<string, Routes>();
  /**
   * Answers handed to a route that no turn has shown yet, by ask ID (#906): to a waiter, or in a hook's reply (`hook`,
   * the event's ID), whose session's transcript says whether deep-hook got it in time.
   */
  private readonly handed = new Map<string, { session: string; at: number; timer: NodeJS.Timeout; via: 'wake' | 'next_prompt' | 'stop_hold'; hook?: string }>();
  /** Answers whose delivery timed out because their session couldn't be read, by ask ID, with the session. */
  private readonly unread = new Map<string, string>();
  /**
   * Notes from the app (#340): those waiting for a route into their session, by session; those handed to a waiter
   * that no turn has shown yet, by request ID; and those a prompt's hook carries as its context, for its reply.
   */
  private readonly notes = new Map<string, Note[]>();
  private readonly handedNotes = new Map<string, Note & { timer: NodeJS.Timeout }>();
  private readonly carried = new Map<string, Note[]>();
  /** Each Codex session's turn its last hook named, so a turn no prompt hook started is seen at its first hook. */
  private readonly turnsStarted = new Map<string, string>();
  /** Each session's turn whose compaction a PreCompact opened and no PostCompact has closed yet (#1022). */
  private readonly compacting = new Map<string, string>();
  /**
   * Each session's messages typed mid-turn not yet acknowledged, with the task each opened, and all those of its
   * current turn: the queue the chat line shows (#340).
   */
  private readonly acks = new Map<string, { text: string; task: string | undefined }[]>();
  private readonly midTurn = new Map<string, string[]>();
  /** The repo each session works in, from its hooks' folder: what its events carry as their project (#23). */
  private readonly projects = new Map<string, string>();
  /** The people on this hub's projects (#1337), and the person each session's first hook connection named. */
  private readonly people: People;
  private readonly sessionPeople = new Map<string, string>();
  /** The asks raised for permission prompts and saved offers, by handle: their answer is never delivered as a message (#23). */
  private readonly prompts = new Set<string>();
  private readonly answers: Answers;
  /** paseo's plugin (#55): the token each agent's DeepBuild MCP server binds by, to the agent's own session. */
  private readonly binds = new Map<string, string>();
  /** The sessions paseo runs that another adapter gates: a permission prompt there shows in paseo, not a terminal. */
  private readonly inPaseo = new Set<string>();
  /** The ask each permission request paseo's plugin sent became, by session and request ID. */
  private readonly paseoRequests = new Map<string, string>();
  /** A permission prompt held for its ask's answer, by the ask. */
  private readonly permits = new Map<string, (delivery: Delivery) => void>();
  /** Sessions paseo runs whose answer no route could carry: their rows read "answer waiting". */
  private readonly answerWaiting = new Set<string>();
  /** Prompts no decision covered, by session and what the call is, until the call runs and is offered back (#23). */
  private readonly pending = new Map<string, { meta: HookMeta; about: About }>();
  /** Permissions you said yes to in the terminal, offered back as decisions to save, by handle (#23). */
  private readonly offers = new Map<string, { meta: HookMeta; about: About; scope: string }>();
  /** The typed-saves-decision plant's sessions you typed words in. */
  private readonly typedAt = new Map<string, number>();
  /**
   * Each session's state as the core last recorded it, `<state>/<cause>`: the one reading deep status lists, recorded as
   * session.state when it changes so the app draws the same (#992).
   */
  private readonly states = new Map<string, string>();
  private statesRead = false;
  private stating: Promise<void> | undefined;
  private restate = false;
  /** The sessions appended to since the last state pass, or all of them: at the start, each minute and after a failed pass. */
  private touched: Set<string> | 'all' = 'all';
  /** The list's rows as last appended (#1463), by ID; empty until the record's are read at start, which makes the first pass a backfill. */
  private rows = new Map<string, Placed>();
  private rowsFirst = true;
  /** Each running job's row (#1925): when it was last appended, and the newer count held until a second has passed. */
  private readonly jobRows = new Map<string, { at: number; held?: ReturnType<typeof setTimeout> }>();
  /** The job rows' appends in turn, so a row never leaves the list before its last count is recorded. */
  private jobRowsAppended: Promise<void> = Promise.resolve();
  /** When each session's agent process last had its start time read, by the watch for processes gone (#992). */
  private readonly startChecked = new Map<string, number>();
  /** How far test.clock has stepped the hub's clock past the wall clock deep-hook stamps hooks by (#965). */
  private stepped = 0;
  /** Each session's promised check (#120): its state as the record has it, the timer for its due time, and whether its one ask was raised. */
  private readonly promises = new Map<string, PromiseState & { timer?: NodeJS.Timeout | undefined; asked?: boolean; handed?: boolean }>();
  /** resolver-decisions with no ledger, asked whether a saved decision covers a prompt before anything is raised (#23). */
  private precheck!: Resolver;

  /**
   * `asking` hears the sessions with an ask still to deliver whenever that set changes, so the event loop holds a stop
   * only where an answer may come back through it (#19: right after install no stop is held for anything else);
   * `acking` hears a session with a message typed mid-turn to acknowledge, so its next tool call's hook is held (#340).
   */
  constructor(private readonly options: CoreOptions, private readonly emit: (sub: string, event: string, caught?: boolean) => void, private readonly asking: (sessions: string[], judged: string[], resend: string[], cantRun: string[]) => void = () => undefined, private readonly acking: (session: string) => void = () => undefined, private readonly scrubbing: (values: string[]) => void = () => undefined) {
    this.root = rootOf(options.root);
    this.people = new People(this.root.dir);
    this.now = () => options.clock.start + (Date.now() - options.clock.real);
    this.durable = options.vfs ? testVfs(options.vfs) : disk;
    this.devices = new Devices(this.root.devices);
    this.confirmer = new Confirmer({ devices: this.devices, key: this.root.confirmKey, ...(options.confirm !== undefined ? { stub: options.confirm } : {}), ...(options.polkit !== undefined ? { polkit: options.polkit } : {}), ...(options.plant ? { plant: options.plant } : {}) });
    this.spool = new Spool({
      dir: this.root.spool, held: options.held, plant: options.plant, durable: this.durable, stopping: () => this.stopping,
      raw: (query, params) => this.record.raw(query, params), appendCore: (kind, data) => this.appendCore(kind, data),
      tryNetwork: (drafts, meta, tries) => this.tryNetwork(drafts, meta, tries),
      replay: (drafts, meta) => this.queue(() => this.handleHook(drafts, meta, 'hook', true), true).then(({ settled }) => settled),
      sync: () => this.record.sync(),
    });
    this.holds = new Holds({
      raw: (query, params) => this.record.raw(query, params), asks: () => this.asks, now: this.now, plant: options.plant, sorter: options.sorter,
      append: (connection, input) => this.append(connection, input), connection: (session, agent) => this.connection('core', { session, agent }),
      pin: (cwd, question) => this.pinOf(cwd, question), heard: (ask) => this.heardBy(ask),
      archived: async (session) => { await this.archiveSession?.(session); },
      reading: (session, agent, reading) => this.appendReading(session, agent, reading),
    });
    this.questions = new Questions({
      raw: (query, params) => this.record.raw(query, params), asks: () => this.asks, holds: this.holds, plant: options.plant,
      connection: (session, agent) => this.connection('core', { session, agent }),
      pin: (cwd, question) => this.pinOf(cwd, question), reading: (session, agent, reading) => this.appendReading(session, agent, reading),
      reach: (session) => this.reachOfSession(session), checks: (cwd) => [...this.checksOf(cwd).keys()],
      denied: (command) => blocksCall(this.root.dir, deepHook(), command), signIns: () => signInCommands(),
    });
    // Shared build products (#1017): made first, so a session that starts while the hub opens finds them; their builds
    // take the host and the lease queue only once a session's start asks.
    this.products = new Products({
      root: this.root.dir, now: this.now, plant: this.options.plant,
      trusted: (cwd) => this.projectTrusted(cwd),
      append: async (kind, data, session) => {
        const ts = this.now();
        const agent = session ? this.sessions.get(session)?.agent : undefined;
        await this.append(this.connection('core', session ? { session, ...(agent ? { agent } : {}) } : {}), { v: 1, id: ulid(ts), kind, ts, data: data as JsonValue });
      },
      build: (b) => this.buildProduct(b),
      openUnder,
      guard: (given) => addGuards(this.root.dir, given, { deepHook: deepHook(), classes: toolClasses(), plant: this.options.plant }),
    });
    this.staging = new Staging({
      root: this.root.dir, raw: (query, params) => this.record.raw(query, params), now: this.now, plant: options.plant, holds: this.holds,
      append: (connection, input) => this.append(connection, input), connection: (session, agent) => this.connection('core', { session, agent }),
    });
    this.spaces = new Workspaces({
      root: this.root.dir, now: this.now, plant: options.plant, record: () => this.record,
      raw: (query, params) => this.record.raw(query, params), append: (connection, input) => this.append(connection, input),
      connection: (extra) => this.connection('core', extra), keep: (bytes, source) => this.keep(bytes, source), fetch: (sha256) => this.store.read(sha256),
      trust: (folder) => this.trust.answer(this.connection('app'), folder, true), plugin: (name) => this.extensions!.stateSource(name),
      adopted: (session, id) => { this.projects.set(session, id); }, told: (session, cwd, text) => this.later(session, cwd, text), rerun: (claim, checks, state) => this.gate.rerun(claim, checks, state),
    });
    this.tasks = new AskTasks({
      spaces: this.spaces,
      raw: (query, params) => this.record.raw(query, params), asks: () => this.asks, now: this.now, plant: options.plant, drafts: options.drafts, work: options.work,
      github: options.github, forge: options.forge ?? 'https://api.github.com', token: async () => process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? await ghToken(),
      append: (connection, input) => this.append(connection, input), connection: (session, agent) => this.connection('core', { session, agent }),
      reading: (session, agent, text) => this.appendReading(session, agent, text),
      // The window reading of the account the session's agent runs on, in the hub's own home (#322).
      atReserve: (agent) => this.runner.atReserve(agent === 'claude' ? 'claude-code' : agent as Parameters<typeof this.runner.atReserve>[0], homedir()),
      pin: (cwd, question) => this.pinOf(cwd, question), keep: (bytes, source) => this.keep(bytes, source), run: (r) => this.runClaim(r),
      invalid: (claim, commit, reason) => this.invalid(claim, commit, reason),
      // A definition just locked: its paid checks priced (#325), and a plan marked large sized before any code (#324).
      locked: async (d) => {
        await this.priceLocked(d).catch((error: unknown) => process.stderr.write(`deep hub: ${d.task_ref}'s paid checks were not priced: ${error instanceof Error ? error.message : String(error)}\n`));
        await this.sizing.planned(d);
      },
      unresolved: (claim, targets) => this.unresolvedTargets.set(claim, targets),
    });
    this.sizing = new SizeScope({
      raw: (query, params) => this.record.raw(query, params), append: (connection, input) => this.append(connection, input),
      connection: (session, agent) => this.connection('core', { session, agent }), asks: () => this.asks, now: this.now,
      pin: (cwd, question) => this.pinOf(cwd, question), keep: (bytes, source) => this.keep(bytes, source), scopeOf: (task) => this.tasks.scopeOf(task),
      evidence: this.root.evidence, accepted: options.accepted,
    });
    this.openItems = new OpenItems({
      raw: (query, params) => this.record.raw(query, params), append: (connection, input) => this.append(connection, input), now: this.now, plant: options.plant,
      connection: (session, agent) => this.connection('core', session ? { session, ...(agent ? { agent } : {}) } : {}), asks: () => this.asks, pin: (cwd, question) => this.pinOf(cwd, question),
      github: async () => {
        if (options.github) return { fetch: recordedFetch(options.github), graphql: recordedGraphql(options.github) };
        const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? await ghToken();
        const api = options.forge ?? 'https://api.github.com';
        return { fetch: liveFetch(api, token), graphql: liveGraphql(api, token) };
      },
      taskList: (agent) => ((registry().get(agent === 'codex' ? 'codex' : 'claude').facts as Obj).taskList as TaskListFacts | undefined),
    });
    this.gate = new GateRunner({
      raw: (query, params) => this.record.raw(query, params), now: this.now, append: (connection, input) => this.append(connection, input), core: this.connection('core'),
      start: (r) => this.runApproved(r), ended: (run) => this.runEnded(run), judged: (claim) => this.judged(claim), stackStart: (folder, worktree) => this.stacks.expectedStart(folder, worktree), stacked: (folder) => this.stacks.wanted(folder),
      ...(options.plant === 'env-starts-at-every-claim' ? {
        startsAtClaim: async (folder: string, session: string, worktree: string) => {
          const run = newRun();
          if (!this.stacks.wanted(folder)) return;
          const started = await this.stacks.serve({ run, claim: 'claim:planted', check: 'planted', folder, worktree, session, on_base: 'passes', expected_ms: null });
          if (!('cause' in started)) await this.stacks.finish(run);
        },
      } : {}),
      checkouts: () => this.checkouts, invalid: (claim, commit, reason, outcome) => this.invalid(claim, commit, reason, outcome), stopping: () => this.stopping,
      stoodIn: (r) => this.tasks.stoodIn(this.connection('core'), r),
      kept: async (evidence) => (await Promise.all(evidence.map((sha) => this.store.get(sha)))).every(Boolean),
      slots: () => ({ free: Math.max(0, Math.max(1, Math.floor(CORES / 2)) - this.runs.size) }),
      capped: (session, checks) => void this.backgroundCapped(session, checks).catch(() => undefined), plant: options.plant, load: machineLoad,
      // The design's 10 s fast-lane budget and 60 s hold, proposals until the dogfood week measures them (#43).
      budget_ms: 10_000, hold_ms: STOP_HOLD_MS,
    });
    this.siblings = new Siblings({
      raw: (query, params) => this.record.raw(query, params), now: this.now,
      append: (session, agent, input) => this.append(this.connection('core', { session, agent }), input),
      ask: async (session, agent, cwd, source, ask) => this.asks.raise(this.connection('core', { session, agent }), source, {
        ...ask, deadline: this.now() + 2 * DAY, key: sha256Hex(canonicalize({ kind: source, key: String(ask.key) })), pinned_to: await this.pinOf(cwd, String(ask.question)),
      }),
      acking: (session) => this.acking(session), queue: (work) => void this.queue(work).catch(() => undefined), wake: (session, text) => this.noticeWake(session, text),
    });
    this.answers = new Answers({
      raw: (query, params) => this.record.raw(query, params), settled: () => Promise.allSettled([...this.inflight]),
      excluded: (id) => this.handed.has(id) || this.prompts.has(`ask:${id}`),
      delivered: options.plant === 'words-only-at-turn-start' ? undefined : (session) => { const live = this.live.get(session); if (live) live.words ??= 'answer'; },
      append: (data, v) => this.appendCore('delivery.outcome', data, { subject: data.delivery, ...(v === 2 ? { v } : {}) }),
    });
    this.stacks = new Stacks({
      raw: (query, params) => this.record.raw(query, params), now: this.now, plant: options.plant, held: options.held, scrub: (values) => this.scrubbing(values),
      appendCore: (kind, data, extra) => this.appendCore(kind, data, extra), supervisor: () => this.supervisor, leases: () => this.leases,
      environment: {
        newRun, up: (spec) => upStack(this.host, { ...spec, compose: this.compose }), down: (run) => downStack(this.host, run), healthy: stackHealthy, wanted: environmentOf, keys: keysOf,
        warm: (o) => new WarmStack({ ...o, host: this.host, compose: this.compose!, plant: options.plant, products: { declared: (f, p) => this.products.declared(f, p), holds: (w, n, k) => this.products.holds(w, n, k), place: (w, n, k, d) => this.products.placeIn(w, n, k, d), keep: (w, n, p, k, s) => this.products.keep(w, n, p, k, s), placeCache: (w, k, p, d) => this.products.placeCache(w, k, p, d), keepCache: (w, k, p, s) => this.products.keepCache(w, k, p, s) } }),
      },
      stopping: () => this.stopping, session: (id) => this.sessions.get(id),
      pending: (worktree) => this.gate.pendingIn(worktree), idle: (session) => this.live.get(session)?.state !== 'working',
      plantedAsk: async (session, question) => { await this.raiseTask(session, this.sessions.get(session)?.agent ?? 'claude-code', { kind: 'unblock', question, options: [{ id: 'done', label: 'I did it', decision: 'none' }], recommended: 'done', default: 'done', steps: [question], where: 'your terminal', why: 'The pool is full', unblocks: [`session:${letters(session)}`], proves: 'stack.slot', fallback: 'you', provisional: false, owner: 'you', key: sha256Hex(new TextEncoder().encode(question)), pinned_to: { kind: 'evidence', ref: sha256Hex(new TextEncoder().encode(question)) } }); },
    });
    this.teardowns = new Teardowns({
      raw: (query, params) => this.record.raw(query, params), held: options.held, append: (session, agent, kind, data) => this.appendSession(session, agent, kind, data),
      reading: (session, agent, text) => this.appendReading(session, agent, text), raise: (session, agent, ask) => this.raiseTask(session, agent, ask),
    });
    this.agents = new Agents({
      root: this.root.dir, plant: options.plant, durable: this.durable, now: this.now, held: options.held,
      raise: async (source, ask, plan) => { await this.ready; return this.asks.raise(this.connection('core'), source, ask, plan as never); },
      synced: async (data) => { await this.ready; await this.appendCore('agents.synced', data); },
      wanted: async () => { await this.ready; return ((await this.record.raw("SELECT data FROM events WHERE kind = 'agents.synced' ORDER BY log_pos")) as { data: string }[]).map((r) => JSON.parse(r.data) as Obj); },
      sessions: () => [...this.sessions.values()].filter((s) => !s.ended).map((s) => ({ id: s.id, agent: s.agent, pid: s.pid, start: s.start })),
      older: (sync) => this.olderSet(sync),
    });
    this.box = new Box({
      root: this.root.dir, plant: options.plant, now: this.now,
      raise: async (source, ask, plan) => { await this.ready; return this.asks.raise(this.connection('core'), source, ask, plan as never); },
      folders: async () => { await this.ready; return [...new Set([...[...this.sessions.values()].map((s) => s.cwd), ...(await repoFolders(this.record, this.store)).values()])]; },
      lessons: async () => { await this.ready; return (await this.lessons()).map((l) => ({ id: l.id, text: l.text })); },
      forget: async (id) => {
        const lesson = (await this.lessons()).find((l) => l.id === id);
        if (!lesson) return `the lesson ${id} is gone`;
        if (lesson.claim.startsWith('wiki:rules#') && lesson.why) { const r = await this.removeRule(lesson); return r.status === 'refused' ? String(r.reason) : undefined; }
        await this.wikiBuild.forget(lesson.claim);
        return undefined;
      },
      learn: async () => { await this.wikiBuild.build(); await syncRejected(this.raw, this.root.dir); },
    });
    this.hosts = new Hosts({ root: this.root.dir, now: this.now, plant: options.plant, raise: async (ask, plan) => { await this.ready; return this.asks.raise(this.connection('core'), 'host.change', ask, plan); } });
    this.runs = new Runs({
      hosts: () => this.hosts,
      journalFile: this.root.runs, point: () => this.durable.point('journal_rewrite'), checkouts: join(this.root.dir, 'checkouts'), now: this.now, plant: options.plant, held: options.held,
      raw: (query, params) => this.record.raw(query, params), sync: () => this.record.sync(), appendAsCore: (input) => this.append(this.connection('core'), input as EventInput),
      appendCore: (kind, data, extra) => this.appendCore(kind, data, extra), stored: (put, what) => this.stored(put, what),
      invalid: (claim, commit, reason, outcome) => this.invalid(claim, commit, reason, outcome), recorded: (run, record) => this.gate.recorded(run, record), keyed: (key, run, record) => this.gate.keyed(key, run, record),
      stopping: () => this.stopping, stacks: this.stacks, store: () => this.store, host: () => this.host, supervisor: () => this.supervisor, leases: () => this.leases, extensions: () => this.extensions,
      kind: (run, checkout, deadline) => {
        const of = this.kindChecks.get(run.claim)?.get(run.check)?.of ?? { claim: run.claim, task: '', agent: 'claude-code', transcript: undefined };
        const spec = run.spec as unknown as CheckSpec;
        // A review reads the diff from the merge base to the claim's snapshot, both in the hub's object store, which
        // reads the repo's objects as alternates; the checkout is the snapshot's tree alone.
        if (spec.kind === 'review') return this.checkKinds.run({ ...spec, head: this.gate.snapshotOf(run.claim) ?? run.commit } as CheckSpec, { checkout: join(this.root.dir, 'objects'), deadline, now: this.now }, of);
        return this.checkKinds.run(spec, { checkout, deadline, now: this.now }, of);
      },
    });
    // The check kinds the hub holds (#1537): command, review, numbers and the work kinds, each with its routes.
    this.checkKinds = new Kinds({ host: () => this.host, submit: (spec) => this.runner.submit(spec), wait: (job) => this.runner.wait(job), cancel: (job) => this.runner.cancel(job), plant: options.plant });
    this.replicas = new Replicas({ folder: join(this.root.dir, 'replicas'), now: this.now, leases: () => this.leases, plant: options.plant });
    this.numbers = new Numbers({
      raw: (query) => this.record.raw(query), now: this.now, append: (connection, input) => this.append(connection, input), core: this.connection('core'),
      root: this.root.dir, forge: this.options.forge ?? 'https://api.github.com',
      token: async () => process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? await ghToken(),
      held: () => this.options.held,
      keep: (bytes, source) => this.keep(bytes, source),
      evidence: (sha) => this.store.read(sha).catch(() => null),
    });
    this.ready = this.init();
    this.ready.then(() => { this.opened = true; }, () => undefined);
    // A start that fails stops nothing else; each call then reports why.
    this.ready.catch(() => undefined);
  }

  /** Resolves once the record is open, the spool replayed and runs recovered; rejects with why it couldn't start. */
  started(): Promise<void> {
    return this.ready;
  }

  private async init(): Promise<void> {
    this.store = await openEvidenceStore({ root: this.root.evidence, now: this.now });
    const storage = this.durable.backend();
    // Each event its own commit: the durable write points a run makes depend only on the events it appends,
    // never on how many arrived together, so a cut at any one can be replayed.
    this.record = await openRecord({ path: this.root.ledger, now: this.now, evidence: this.store, commitEach: true, ...(storage ? { storage } : {}), ...(this.options.plant === 'turn-closes-at-child-stop' ? { plant: this.options.plant } : {}) });
    if (process.env.DEEP_HUB_TEST_CRASH) this.record = crashing(this.record, process.env.DEEP_HUB_TEST_CRASH);
    if (process.env.DEEP_HUB_TEST_READS) this.record = readsLogged(this.record, process.env.DEEP_HUB_TEST_READS);
    // Every append reaches the stream, whoever appends it: the hub, the asks core, the supervisor or the leases.
    this.record = streamed(this.record, ({ kind, subject, data }, connection) => {
      this.log.stream();
      if (kind !== 'session.state' && kind !== 'row.set') {
        // The next state pass reads the sessions appended to since the last; an event of no session, every session.
        if (this.touched !== 'all') { if (connection.session) this.touched.add(connection.session); else this.touched = 'all'; }
        this.stateSoon();
      }
      if (kind.startsWith('ask.') || kind.startsWith('delivery.') || kind === 'session.start' || kind === 'session.end') this.askingSoon();
      if (kind === 'verdict.made') this.github?.verdicts();
      // A deep_wait or deep_run waiting on what this event settles reads it again now, and answers before the
      // appender's next commit holds this thread with its sync (#823).
      const about = kind === 'decision.applied' && isObj(data) ? data.ask : subject;
      const woken = typeof about === 'string' ? [...this.settling.get(about) ?? []] : [];
      for (const wake of woken) wake();
      return woken.length ? new Promise((done) => setImmediate(done)) : undefined;
    });
    // A start that finds the last run still marked running records that run's stop as a crash.
    try {
      // A cursor whose transcript is gone has no session left to judge.
      this.cursors = new Map(Object.entries(JSON.parse(readFileSync(this.root.transcripts, 'utf8')) as Record<string, Cursor>).filter(([, c]) => typeof c?.transcript === 'string' && existsSync(c.transcript)));
    } catch {
      // None yet, or unreadable: the sessions are read from where this hub meets them.
    }
    const crashed = existsSync(this.root.state) && readFileSync(this.root.state, 'utf8').trim() === 'running';
    this.writeState('running');
    if (crashed) await this.appendCore('hub.stopped', { reason: 'crashed' });
    await this.runs.open();
    // The continues the hub carried before this start are those recorded before it; opening the core below settles
    // what landed while the hub was down (a task's check passed, a window reset, a fresh transient stop), and each
    // continue that records is routed right after, never skipped as already carried (#85).
    this.continuedPos = Number(((await this.record.raw(`SELECT COALESCE(MAX(log_pos), 0) AS pos FROM events WHERE kind = 'session.continued'`)) as { pos: number }[])[0]?.pos ?? 0);
    // A continue parked for a session's next prompt outlives the hub: each that no later turn of its session carried
    // goes with that session's next prompt again (#85).
    for (const row of (await this.record.raw(`SELECT c.session_id, c.data FROM events c WHERE c.kind = 'session.continued' AND c.session_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM events e WHERE e.session_id = c.session_id AND e.log_pos > c.log_pos AND e.kind IN ('user.ask', 'tool.before', 'tool.after', 'agent.stop', 'permission.request') AND ${OWN_TURN}) ORDER BY c.log_pos`)) as { session_id: string; data: string | Obj }[]) {
      const d = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Obj;
      this.routesOf(row.session_id).later.push(await this.continueBlock(row.session_id, String(d.because), typeof d.task === 'string' ? d.task : null, typeof d.stop === 'string' ? d.stop : undefined));
    }
    // A stop whose task is open holds its session's DeepBuild turns across a restart too (#85): each session's newest
    // stop that no turn, prompt or continue followed.
    for (const row of (await this.record.raw(`SELECT s.session_id, s.data FROM events s WHERE s.kind = 'agent.stop' AND s.session_id IS NOT NULL AND json_extract(s.data, '$.child') IS NULL AND NOT EXISTS (SELECT 1 FROM events e WHERE e.session_id = s.session_id AND e.log_pos > s.log_pos AND e.kind IN ('user.ask', 'tool.before', 'tool.after', 'agent.stop', 'session.continued', 'session.end') AND ${OWN_TURN})`)) as { session_id: string; data: string | Obj }[]) {
      const d = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Obj;
      if (holdsTurns(d)) this.routesOf(row.session_id).blocked = String(d.cause);
    }
    // Opening the supervisor reaps what the record says a run left before this start.
    const asks = this.asks = await openAsks({
      record: this.record, now: this.now, deliver: (d) => this.answered(d), home: this.root.dir, threads: slackThreads(this.root.dir), network: networkCheck(),
      // The hub's own adapters answer, so the facts it maps hooks by are the facts that decide a continue.
      errorTurnHook: (agent) => adapterOf(agent)?.caps.errorTurnHook === true,
    });
    await this.continues();
    this.askingSoon();
    // The results every session's claims share (#1018): each kept run's key, from its finish, read once at start.
    const kept = (await this.record.raw(`SELECT data FROM events WHERE kind = 'run.finished' AND json_extract(data, '$.key') IS NOT NULL ORDER BY log_pos`)) as { data: string }[];
    this.gate.kept(kept.map((row) => JSON.parse(row.data) as { run: string; check: string; outcome: string; tests_run: number; findings: string[]; evidence: string[]; key: KeyFacts }));
    // Every second, once an open ask's deadline has passed, the asks core takes its default (showing it first if it
    // hadn't shown), so no ask waits on a read; once a stop or a verdict landed, or while a task waits on its check,
    // it reads them for the task, the continue or the resume they call for (#85). With nothing due it reads nothing,
    // so a backfill never feeds it. The hub takes each continue's route every beat, since an answer records them too.
    // While the Mac sleeps no beat runs: a beat that finds the wall clock far past the last one tells the asks core the
    // hub didn't run in between, which moves the deadline of each ask that hadn't shown (#908).
    let beat = { wall: Date.now(), at: this.now() };
    const landed = async (): Promise<number> => Number(((await this.record.raw(`SELECT COALESCE(MAX(log_pos), 0) AS pos FROM events WHERE kind IN ('agent.stop', 'verdict.made')`)) as { pos: number }[])[0]?.pos ?? 0);
    let ticked = await landed();
    const due = async (): Promise<boolean> => {
      const pos = await landed();
      if (pos > ticked) { ticked = pos; return true; }
      return (await this.record.raw(`SELECT 1 FROM asks WHERE status IN ('open', 'later') AND (deadline <= ? OR kind = 'unblock') LIMIT 1`, [this.now()])).length > 0;
    };
    // The hook programs are checked at start and every 10 minutes on the hub's clock (#993): no hook arrives to say they can't run.
    await this.hookPrograms().catch(() => undefined);
    this.every('hook-programs', 1000, () => this.hookPrograms());
    // A hook that missed its acknowledgement under load may be the last of its turn: its stop is judged without one to follow it (#580).
    this.every('spool', 2000, async () => { this.replayLate(); });
    if (this.options.plant !== 'skip-default-at-deadline') this.every('asks', 1000, async () => {
      const now = { wall: Date.now(), at: this.now() };
      if (now.wall - beat.wall > SLEPT) await asks.away(beat.at, now.at);
      beat = now;
      if (await due()) {
        await asks.tick();
        for (const { handle, data, resource } of await this.teardowns.defaulted()) void this.didIt(handle, resource.session, data).catch(() => undefined);
      }
      await this.continues();
    });
    this.index = openIndex(this.root.wiki, this.options.index);
    this.index.catch(() => undefined);
    // Compose's own folder sits in the hub's, which no run writes: the files a compose stack runs are the hub's.
    const compose = this.compose = composeKind(join(this.root.dir, 'compose'));
    // env-local's port kind (#331): ports from 3000 up, each checked free before it is leased.
    const port = portKind({ free: this.options.plant !== 'env-leases-port-again' });
    // The kernel's one lease table (#237): env-local declares its kinds there with their free checks, the core its
    // cpu.slot, and the supervisor takes every run's keys through it.
    const leases = this.leases = await openLeases({
      record: this.record, now: this.now, cores: CORES, ...(this.options.leaseMs ? { lease_ms: this.options.leaseMs } : {}), ...(this.options.plant === 'fills-every-slot' ? { plant: this.options.plant } : {}),
    });
    for (const kind of leaseKinds) await leases.declare('env-local', kind, [port, compose].find((k) => k.kind === kind.name)?.free);
    // deep_drive's replicas (#124): a replica's process ends with the hub that started it, whose pipe was its stdin,
    // so a replica lease an earlier hub left is released.
    await leases.declare('core', REPLICA_LEASE);
    for (const v of await leases.leases()) if (v.lease.resource.kind === REPLICA_LEASE.name) await leases.release(v.lease.id, []);
    this.every('leases', 1000, () => leases.tick());
    // Heavy commands' kinds beside cpu.slot (#1015): browsers and stacks as pools drafted from the machine; the GPU
    // is env-local's, shared or exclusive.
    const pools = draftedPools(CORES);
    for (const [name, n] of Object.entries(pools)) await leases.declare('core', { name, match: `pool(${n})`, cap: 1000, cooldown: 0, cost: 0 });
    // The warm stacks' pool (#580): your settings size it, drafted as 4 on the reference Mac, an estimate until week 4 measures it.
    await leases.declare('core', { name: 'stack.slot', match: `pool(${this.stackSlots()})`, cap: 1000, cooldown: 0, cost: 0 });
    // One compile job pool per host (#1016): every build deep lease runs joins it.
    this.pool = new JobPool(join(this.root.dir, 'jobserver'), poolTokens(CORES));
    this.heavy = new HeavyQueue({
      table: leases, slow: SLOW_SLOT, now: this.now, pool: this.pool, ...(this.options.plant ? { plant: this.options.plant } : {}),
      append: async (kind, v, data, subject, session) => {
        const ts = this.now();
        const id = ulid(ts);
        const agent = session ? this.sessions.get(session)?.agent : undefined;
        await this.append(this.connection('core', session ? { session, ...(agent ? { agent } : {}) } : {}), { v, id, kind, ts, data: data as JsonValue, ...(subject ? { subject } : {}) });
        return id;
      },
      worktreeOf: (s) => [...this.sessions.values()].find((x) => letters(x.id) === s || x.id === s)?.cwd,
      agentOf: (s) => { const x = this.sessions.get(s); return x ? { pid: x.pid, start: x.start } : undefined; },
    });
    await this.heavy.recover(this.raw);
    await this.heavy.tick();
    this.every('heavy', 500, () => this.heavy.tick());
    this.every('gone', 1000, () => this.goneSessions());
    // Each session's state as last recorded, then any change since; a session goes quiet after a day with no hook.
    for (const row of (await this.record.raw("SELECT session_id, json_extract(data, '$.state') AS state, json_extract(data, '$.cause') AS cause FROM events WHERE kind = 'session.state' AND session_id IS NOT NULL ORDER BY log_pos")) as { session_id: string; state: string; cause: string }[]) this.states.set(row.session_id, `${row.state}/${row.cause}`);
    // The list's rows as last appended (#1463): a record with none yet is a backfill.
    for (const p of await listRows((q) => this.record.raw(q))) this.rows.set(p.row.id, p);
    this.rowsFirst = this.rows.size === 0;
    // A job's row the last hub left listed (#1925): its tool's run ended with that hub, so the row leaves the list.
    for (const id of [...this.rows.keys()].filter((id) => id.startsWith('job:'))) this.jobRowAppend(id, null);
    this.statesRead = true;
    this.stateSoon();
    // Each minute every session is read again: a state that changes with time alone (quiet) has no append to say so.
    this.every('states', 60_000, async () => { this.touched = 'all'; this.stateSoon(); });
    // A background command whose process group has ended no longer holds its session's slow checks (#907); one that
    // ends mid-turn leaves them to the turn's stop. A monitor's watch ends the same way, or at its timeout, and an idle
    // session's row then reads its stop again (#997). An idle session whose facts have emptied starts what they held, and
    // the gate runner's timers come due on the hub's clock (#965). The planted wrong program reads the facts only at stops.
    this.every('background', 2000, async () => {
      for (const [id, live] of this.live) {
        for (const [call, b] of live.background) {
          let ended = b.watch?.expires != null && this.now() >= b.watch.expires ? 'its timeout passed' : undefined;
          if (!ended && b.group) try { process.kill(-b.group, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') ended = 'its process ended'; }
          if (!ended) continue;
          // Off the poll's path: the stop it makes final is judged, with its fast lane, while other sessions are read.
          if (b.watch) void this.watchEnded(id, call, ended).catch(() => undefined);
          else live.background.delete(call);
        }
        if (live.state !== 'working' && this.options.plant !== 'rechecks-facts-at-stops-only') this.gate.idle(id, { background: live.background.size, crons: live.crons.size });
      }
      this.gate.tick();
    });
    this.supervisor = await openSupervisor({
      record: this.record, asks, now: this.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } },
      resources: [port, compose], leases,
      kept: join(this.root.dir, 'kept'),
      ...(this.options.plant === 'kept-in-service-cgroup' ? { plant: 'kept-in-service-cgroup' as const } : {}),
      ...(this.options.plant === 'env-holds-lease-for-helper' ? { plant: 'holds-lease-while-taken' as const } : {}),
      ...(this.options.plant === 'standin-value-in-env' || this.options.plant === 'standin-every-host' || this.options.plant === 'run-ca-in-login-keychain' || this.options.plant === 'sandbox-any-loopback' ? { plant: this.options.plant } : {}),
      ...(this.options.leaseMs ? { lease_ms: this.options.leaseMs } : {}),
      ...(this.options.crash ? { crash: this.options.crash } : {}),
      // No run, run-as-you included, writes the record, the agents' config folders or the Node the hub runs on;
      // the sandbox profile itself keeps every project's agent hook and MCP files. The runner's jobs/ is left to
      // each run's own grant: a job's checkout writes only its own folder.
      guarded: [
        { path: this.root.dir, except: [join(this.root.dir, 'jobs'), join(this.root.dir, 'checkouts'), join(this.root.dir, 'products', '.building'), join(this.root.dir, 'jobserver')] }, join(homedir(), '.claude'), join(homedir(), '.codex'), realpathSync(resolve(fileURLToPath(import.meta.url), '../../..')),
        join(homedir(), 'Library', 'LaunchAgents'),
        process.execPath, resolve(process.execPath, '../../lib/node_modules'),
        ...[process.env.CLAUDE_CONFIG_DIR, process.env.CODEX_HOME].filter((p): p is string => !!p && isAbsolute(p)),
        ...compose.guarded,
      ],
    });
    // The base-commit service (#31), its checkouts under the hub's root: opening removes what a crash left, whose
    // processes the supervisor has just reaped; no run writes the store, each only its own checkout.
    this.checkouts = await openCheckouts({
      store: join(this.root.dir, 'objects'), root: join(this.root.dir, 'checkouts'), kinds: [], host: this.supervisor, leases, now: this.now,
      ...(this.options.plant === 'git-inherits-env' ? { plant: 'git-inherits-env' } : this.options.plant === 'stand-in-always' ? { plant: 'stands-in-always' } : {}),
    });
    // The keys a stack leased per session before this start (#332): its processes were reaped as the supervisor opened,
    // so each ends now that the record proves them gone.
    for (const v of await leases.leases()) {
      if (!SESSION_KINDS.includes(v.lease.resource.kind) || !(v.lease.holder === 'core' || v.lease.holder.startsWith('mcp:'))) continue;
      const [row] = (await this.record.raw(`SELECT json_extract(data, '$.run') AS run FROM events WHERE kind = 'lease.acquired' AND subject = ? LIMIT 1`, [v.lease.id])) as { run: string | null }[];
      if (row?.run) await this.stacks.adopt(row.run, v.lease.id);
    }
    this.host = this.options.host
      ? ((await import(pathToFileURL(this.options.host).href)) as { default: (local: Host) => Host }).default(this.supervisor)
      : this.supervisor;
    this.every('supervisor', 1000, () => this.supervisor.tick());
    // Shared build products (#1017): the store's index, its guard entry and its watch; session starts wait for it.
    await this.products.open();
    const config = this.config();
    // A paid check's price comes from its kind's lookup; none is wired in version 0 but the tests' file, so a paid run with none is BLOCKED (#325).
    const ledger = this.ledger = await openLedger({ record: this.record, asks, now: this.now, price: async (run) => this.priceOf(run.check) });
    // resolver-decisions ships on by default (#23): your saved decisions, and the budgets you approved, answer the
    // asks they cover, each answer gated by the core.
    asks.registerResolver('resolver-decisions', resolverDecisions({ record: this.record, ledger }));
    this.precheck = resolverDecisions({ record: this.record });
    await this.syncStanding().catch(() => undefined);
    this.every('rules', HOUR, () => this.judgeRules());
    // The runner reaps or reports what a crash cut, and ticks itself.
    this.runner = await openRunner({
      record: this.record, asks, supervisor: this.supervisor, ledger, now: this.now, root: this.root.dir, loginPath: config.loginPath, env: process.env, keychain,
      settings: { plan: { reserve_pct: config.reservePct }, asks: { unblock: { deadline_ms: 2 * DAY } } },
    });
    this.sessionStarts = new Starts({
      root: this.root.dir, socket: this.root.socket, lock: this.root.lock, loginPath: () => this.config().loginPath, now: this.now, plant: this.options.plant,
      supervisor: () => this.supervisor, asks: () => asks, raw: (q, p) => this.record.raw(q, p), appendCore: (kind, data, extra) => this.appendCore(kind, data, extra),
      agentAbove: (peer) => this.agentAbove(peer), windowUsed: (agent, home) => this.runner.windowUsed(agent as JobSpec['agent'], home),
      forge: this.options.forge ?? 'https://api.github.com', agentsApp: () => this.forgeApp('agents'), gateToken: (repo) => this.gateToken(repo),
    });
    await this.sessionStarts.open();
    // Every installed extension loads, sandboxed until a signed release lists it; one refused is named and left out.
    const trust = this.trust = await openTrust({ record: this.record, now: this.now });
    await this.spaces.open();
    this.acceptance = new Acceptance({
      record: this.record, runner: () => this.runner, supervisor: () => this.supervisor, checkouts: () => this.checkouts, asks: () => this.asks, core: this.connection('core'), now: this.now, ...this.config().acceptance,
      append: async (kind, data) => { const ts = this.now(); await this.append(this.connection('core'), { v: 1, id: ulid(ts), kind, ts, data: data as JsonValue }); },
      read: async (owner, name, n) => {
        const fetch = this.options.github ? recordedFetch(this.options.github) : liveFetch(this.options.forge ?? 'https://api.github.com', process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? await ghToken());
        return (await readIssue(fetch, owner, name, n, undefined))?.[0];
      },
    });
    // #1922's planted hosts build a tool's digest wrongly: the host's plants, selected with the hub's variable.
    const plant = this.options.plant?.startsWith('job-build-') ? { plant: this.options.plant as 'job-build-entry-only' } : {};
    const extensions = this.extensions = await openExtensionHost({ record: this.record, supervisor: this.supervisor, trust, home: this.root.dir, release: [], now: this.now, leases, runner: this.runner, evidence: this.store, point: () => this.durable.point('terminals_rewrite'), ...plant });
    this.jobKinds = new Jobs({
      root: this.root.dir, now: this.now, host: () => this.extensions, plant: this.options.plant,
      keep: async (bytes, source) => (await this.stored(await this.store.connect({ role: 'deepbuild', via: 'job' }).put({ bytes, kind: 'file', source, redaction: 'complete', license: { name: 'job output', allows: [] } }), `a job output from ${source}`)).sha256,
      has: async (sha) => (await this.store.get(sha)) !== undefined,
      read: (sha) => this.store.read(sha),
      adopt: async (bytes) => { await this.stored(await this.store.connect({ role: 'agent', session: 'unknown' }).put({ bytes, kind: 'file', source: 'unrecorded', redaction: 'unknown', license: { name: 'unknown', allows: [] } }), 'a file of unknown origin'); },
      send: (request, boundary) => this.store.send(request, boundary),
      raise: (source, ask, plan) => this.asks.raise(this.connection('core'), source, ask, plan),
      row: (job, running) => this.jobShown(job, running),
    });
    this.libraries = new Libraries({
      root: this.root.dir, now: this.now, host: () => this.extensions,
      keep: async (bytes, kind, source, license) => (await this.stored(await this.store.connect({ role: 'deepbuild', via: 'job' }).put({ bytes, kind, source, redaction: 'complete', license }), `${kind} from ${source}`)).sha256,
      keepFile: async (file, sha256, kind, source, license) => (await this.stored(await this.store.connect({ role: 'deepbuild', via: 'job' }).file({ file, sha256, kind, source, redaction: 'complete', license }), `${kind} from ${source}`)).sha256,
      has: (sha) => this.store.verify(sha),
      raise: (source, ask, plan) => this.asks.raise(this.connection('core'), source, ask, plan),
    });
    for (const pkg of await extensions.installed()) {
      // One installed by a hub that ran no conformance at install has no kept result: it runs now, once, so the
      // package loads from its result at this start and each later one, as one installed since #785 does. A check
      // that can't run (an untrusted project) is left to the load's refusal, which names it.
      if (!extensions.checked(pkg)) await extensions.check(pkg).catch(() => undefined);
      const load = await extensions.load(pkg);
      if (load.status === 'refused') process.stderr.write(`deep hub: extension ${pkg.id}@${pkg.version} not loaded: ${load.reason}\n`);
      // One installed before panel@1 ran at install has no kept verdict for its views: they run now, once.
      else await this.panelKits(pkg.id, true);
    }
    await this.spool.replay();
    // The replay is done: the extensions start, and each that can't is unloaded and named.
    await extensions.ready().catch((error: unknown) => process.stderr.write(`deep hub: ${error instanceof Error ? error.message : String(error)}\n`));
    // Your channels (#65): the asks reach you where you said, and each answer a channel returns is checked here.
    this.channels = new Channels({
      root: this.root.dir, hub: this.hubId(), now: this.now, plant: this.options.plant, devices: this.devices,
      loaded: () => extensions.channels(),
      call: (name, op, item, ctx) => (op === 'deliver' ? extensions.channel(name, op, item!, ctx) : extensions.channel(name, op, null, ctx)),
      asks: () => this.channelAsks(),
      append: (kind, data, subject) => this.appendCore(kind, data, subject ? { subject } : {}),
      answer: (handle, option, how) => this.answer({ ask: handle, option }, { role: how.proof === 'device' ? 'app' : 'cli' } as CallContext, how).then(() => undefined),
      cancel: (handle) => this.appendCore('ask.cancelled', { answer: 'cancel', plan_hash: null, decision: 'none' }, { subject: handle }),
    });
    this.channels.start();
    // A session that ended with turns still to judge sends no hook again: they are judged now.
    for (const [id, cursor] of this.cursors) {
      if (typeof cursor.ended?.agent !== 'string' || typeof cursor.read !== 'number' || !Array.isArray(cursor.reached)) continue;
      this.cursors.delete(id);
      const session: Session = { id, thread: id, agent: cursor.ended.agent, pid: 0, start: '', cwd: '', transcript: cursor.transcript, ended: true, read: cursor.read, turn: undefined, closed: [], reached: new Set(cursor.reached), pending: new Map(), prompts: new Map(), entries: [] };
      this.sessions.set(id, session);
      await this.readTranscript(session);
      this.endTurn(session);
      this.judge(session);
    }
    await this.judgedAcrossRestart();
    await this.runs.recover();
    await this.retain();
    this.every('retention', DAY, () => this.retain());
    // Each staged copy is let go at its set time (#347): at start, then once an hour.
    await this.staging.prune().catch(() => undefined);
    this.every('staging', HOUR, () => this.staging.prune());
    if (this.options.failJob) this.testJob(this.options.failJob);
    // The transcript archive (#20) copies what the agents' cleanups would delete, and the CI runs of the GitHub repos
    // recent sessions worked in before the forge's retention deletes them: at start, then once an hour, one pass at a time.
    const env: Record<string, string | undefined> = { ...process.env };
    const repos: string[] = [];
    const archive = await openArchive({
      record: this.record, evidence: this.store, asks, adapters: shipped(), transcripts: MEMORY_TRANSCRIPTS, env, connection: this.connection('ext:deepbuild/archive'), now: this.now,
      held: () => this.options.held, forge: { api: this.options.forge ?? 'https://api.github.com', repos },
      // A session's copy is recorded under the repo its folder is in, so what it says reaches that repo's page (#356).
      projectOf: (cwd, agent) => projectOf(cwd, agent, this.options.plant),
    });
    let archiving: Promise<void> | undefined;
    const archivePass = () => {
      archiving ??= (async () => {
        env.GH_TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? (await ghToken());
        // With no token the forge's logs can't be read, so no run is asked for.
        repos.splice(0, repos.length, ...(env.GH_TOKEN ? await this.forgeRepos() : []));
        await archive.pass();
      })().catch((error: unknown) => { process.stderr.write(`deep hub: archive: ${error instanceof Error ? error.message : String(error)}\n`); })
        // The archive's text index follows each pass, whatever the pass copied (#1515): a session it doesn't hold yet is read from its transcript.
        .then(() => this.record.indexTranscripts()).catch((error: unknown) => { process.stderr.write(`deep hub: archive index: ${error instanceof Error ? error.message : String(error)}\n`); })
        .finally(() => { archiving = undefined; });
      return archiving;
    };
    archivePass();
    this.archiveSession = (session) => archive.session(session);
    this.archivedSessions = () => archive.archived();
    this.every('archived-threads', ARCHIVED_THREADS_MS, () => this.archivedThreads());
    // Setup's wiki build (#356) starts from a pass of its own, after the one at start has finished.
    this.wikiBuild = openWikiBuild({
      record: this.record, root: this.root, store: this.store, runner: this.runner, asks, now: this.now, archive: async () => { await archiving; await archivePass(); },
      core: this.connection('core'), cli: this.connection('cli'), plant: this.options.plant, held: this.options.held,
    });
    this.timers.push(setInterval(archivePass, HOUR));
    this.github = this.openGitHub();
    this.timers.push(setInterval(() => void this.github?.pass(), GITHUB_PASS_MS));
    this.timers.push(setInterval(() => void this.spaces.driftAll(), DRIFT_MS));
    // While appends fail, a small synced write is tried every quarter second; the gates come back with it.
    this.timers.push(setInterval(() => { if (this.blocked && !this.lost && this.durable.probe(this.root.dir)) { this.blocked = undefined; this.replayLate(true); } }, 250));
    // Between session starts, a removed or weakened entry of ours in Claude Code's settings goes back at once.
    if (this.options.plant !== 'restores-at-session-start-only') this.watchSettings();
    // A sync a stop cut short is recovered from its journal before anything else is synced (#148).
    void this.agents.recoverAtStart().catch((error: unknown) => process.stderr.write(`deep hub: agent syncs not recovered: ${error instanceof Error ? error.message : String(error)}\n`));
    // The promised checks the record still holds wait on, armed again (#120).
    await this.restorePromises().catch(() => undefined);
    await this.acceptance.open();
    // The session map and what its notices delivered, and the loop rule's count, read back (#352).
    await this.siblings.restore().catch(() => undefined);
    for (const timer of this.timers) timer.unref();
  }

  /** The github extension (#46): what it reads of the hub, and where its status lands. */
  private openGitHub(): GitHub {
    const plant = (['posts-on-head', 'unguarded-marks-every-push', 'unguarded-marks-none'] as const).find((p: GitHubPlant) => p === this.options.plant);
    return openGitHub({
      api: this.options.forge ?? 'https://api.github.com', state: join(this.root.dir, 'github.json'), snapshots: join(this.root.dir, 'objects'), raw: (query, params) => this.record.raw(query, params),
      reads: async () => process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? await ghToken(),
      // The gate's own identity once your settings name it; until then your login, which no ruleset counts (#1325).
      posts: async (repo) => (this.forgeApp('gate') ? this.gateToken(repo) : process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN),
      settings: () => {
        let github: { delivery?: unknown; yours?: unknown } | undefined;
        try { github = (JSON.parse(readFileSync(join(this.root.dir, 'config.json'), 'utf8')) as { github?: typeof github }).github; } catch { /* none yet: nothing is on */ }
        return { delivery: isObj(github?.delivery) ? github.delivery : {}, yours: Array.isArray(github?.yours) ? github.yours.map(String) : [] };
      },
      sessions: () => [...this.live].map(([id, l]) => ({ id, agent: l.agent, cwd: l.cwd })),
      unguarded: (session, data) => {
        const ts = this.now();
        return this.append(this.connection('core', session ? { session: session.id, agent: session.agent } : {}), { v: 1, id: ulid(ts), kind: 'ref.unguarded', ts, ...(session ? { subject: `session:${letters(session.id)}` } : {}), data });
      },
      pushed: (_repo, change) => this.sessionStarts.pushed(change),
      hear: (session, text) => { this.later(session.id, session.cwd, text); this.offer(session.id); },
      ...(plant ? { plant } : {}),
    });
  }
  /** An app your settings name as `github.gate` or `github.agents` (#1325): its ID, and its key from the Keychain service named. */
  private forgeApp(which: 'gate' | 'agents'): AppKey | undefined {
    let app: unknown;
    try { app = (JSON.parse(readFileSync(join(this.root.dir, 'config.json'), 'utf8')) as { github?: Obj }).github?.[which]; } catch { /* none yet */ }
    if (!isObj(app) || !Number.isSafeInteger(app.app_id) || typeof app.key !== 'string' || !app.key) return undefined;
    const service = app.key;
    return { app_id: app.app_id as number, key: () => keychain(service) };
  }
  private gateTokens?: (repo: string) => Promise<string | undefined>;
  /** The gate's token for a repo: minted in this process, kept only in its memory. */
  private gateToken(repo: string): Promise<string | undefined> {
    return (this.gateTokens ??= gateTokens(this.options.forge ?? 'https://api.github.com', () => this.forgeApp('gate')))(repo);
  }
  /** `stack.slot` in <root>/config.json: how many warm stacks this machine keeps. */
  private stackSlots(): number {
    let slot: unknown;
    try { slot = (JSON.parse(readFileSync(join(this.root.dir, 'config.json'), 'utf8')) as { stack?: { slot?: unknown } }).stack?.slot; } catch { /* none yet */ }
    return typeof slot === 'number' && Number.isInteger(slot) && slot > 0 ? slot : 4;
  }
  /** What setup wrote to <root>/config.json for the runner: the login shell's PATH and the plan's reserve. */
  private config(): { loginPath: string; reservePct: number; rules: { margin: number; windowMs: number }; acceptance: { slots: number; gateKey: string | null } } {
    let c: Obj = {};
    try { c = JSON.parse(readFileSync(join(this.root.dir, 'config.json'), 'utf8')) as Obj; } catch { /* none yet: no binary resolves, so every job is refused saying so */ }
    const runner = isObj(c.runner) ? c.runner : {};
    const plan = isObj(c.plan) ? c.plan : {};
    // Standing rules are judged at this margin over this window (#23): the design's 1.5 and 30 days unless you set them.
    const rules = isObj(c.rules) ? c.rules : {};
    return {
      loginPath: typeof runner.login_path === 'string' ? runner.login_path : '',
      reservePct: typeof plan.reserve_pct === 'number' ? plan.reserve_pct : 10,
      rules: { margin: typeof rules.margin === 'number' ? rules.margin : 1.5, windowMs: (typeof rules.window_days === 'number' ? rules.window_days : 30) * DAY },
      // The issues that run at once, and the gate identity's key (#1325): with none, a swap goes to you.
      acceptance: { slots: isObj(c.acceptance) && typeof c.acceptance.slots === 'number' ? c.acceptance.slots : 1, gateKey: isObj(c.gate) && typeof c.gate.key === 'string' ? c.gate.key : null },
    };
  }

  /** One round of judging your standing rules by what later broke, at the margin and over the window in your settings (#23). */
  private async judgeRules(): Promise<void> {
    const { margin, windowMs } = this.config().rules;
    for (const e of await evidence({ record: this.record, now: this.now(), window: windowMs })) {
      await this.asks.judged(this.connection('core'), e.decision, { rule: e.rule, yours: e.yours, margin, judgment: judge(e.rule, e.yours, margin) });
    }
    await this.syncStanding();
    await syncRejected(this.raw, this.root.dir);
  }

  private writeState(state: 'running' | 'stopped'): void {
    writeFileSync(`${this.root.state}.tmp`, `${state}\n`, { mode: 0o600 });
    renameSync(`${this.root.state}.tmp`, this.root.state);
  }

  // ---- Appends.

  /**
   * An event's connection: its actor is the person whose connection sent it, or for the core's own events the person
   * whose session they are about, never a field the event carries (#1337); its scope is who may see it.
   */
  private connection(writer: string, extra: Partial<Connection> = {}): Connection {
    const project = extra.project ?? (extra.session ? this.projects.get(extra.session) : undefined);
    const actor = extra.actor ?? (extra.session ? this.sessionPeople.get(extra.session) : undefined) ?? OWNER;
    return { writer, actor, scope: scopeOf(this.people, actor, project), ...(project ? { project } : {}), ...extra };
  }
  /** Appends one event; a storage failure turns every gate watch-only, BLOCKED, until a write succeeds again. */
  private async append(connection: Connection, input: EventInput, backfill = false): Promise<void> {
    if (this.lost) throw Error(this.blocked);
    const appended = this.record.append(connection, input);
    // No read waits for a backfill: nobody was acknowledged for its events.
    if (!backfill) this.inflight.add(appended);
    try {
      await appended;
    } catch (error) {
      if (error instanceof RecordError && error.code === 'storage') this.blocked = `BLOCKED: appends fail: ${error.message}`;
      throw error;
    } finally {
      this.inflight.delete(appended);
    }
  }
  private appendCore(kind: string, data: Obj, extra: { subject?: string; evidence?: string[]; v?: number } = {}): Promise<void> {
    const ts = this.now();
    return this.append(this.connection('core'), { v: 1, id: ulid(ts), kind, ts, data: data as JsonValue, ...extra });
  }
  /**
   * A background job, run every `ms`: no caller waits on it, so its last failure is kept for hub.health instead of
   * dropped, and its next clean run clears it.
   */
  private every(name: string, ms: number, job: () => Promise<unknown>): void {
    this.jobs.set(name, null);
    this.timers.push(setInterval(() => void this.run(name, job), ms));
  }
  private async run(name: string, job: () => Promise<unknown>): Promise<void> {
    try {
      await job();
      this.jobs.set(name, null);
    } catch (error) {
      const at = this.now();
      const last = this.jobs.get(name);
      this.jobs.set(name, { failures: (last?.failures ?? 0) + 1, since: last?.since ?? at, at, error: error instanceof Error ? error.message : String(error) });
    }
  }
  /** The test job (#909): one run per line a test appends to `file`, `fail` a failed run and `ok` a clean one. */
  private testJob(file: string): void {
    this.jobs.set('test', null);
    let taken = 0;
    this.timers.push(setInterval(() => {
      const lines = readFileSync(file, 'utf8').split('\n').slice(0, -1);
      for (const run of lines.slice(taken)) void this.run('test', async () => { if (run === 'fail') throw Error('the test job failed'); });
      taken = lines.length;
    }, 200));
  }
  /** The hub's lock file is no longer the one it holds (#909): another hub may start on it, so this one appends nothing more. */
  lockLost(path: string): void {
    this.lost = true;
    this.blocked = `BLOCKED: lock lost: ${path} is no longer the file this hub holds locked; stop this hub and start it again`;
  }
  /**
   * Checks the programs the hook entries run (#993), when due: the agents a failing program's settings serve have their
   * gates watch-only, and each of their open sessions reads BLOCKED until a check finds the program again. A session
   * already reading the same is left as it is, so a restart or the next check appends nothing new.
   */
  private async hookPrograms(): Promise<void> {
    if (this.now() < this.hookCheckDue) return;
    this.hookCheckDue = this.now() + HOOK_CHECK_MS;
    const found = unrunnable(this.root.dir);
    this.cantRun = [...new Set(found.flatMap((u) => RUN_BY[u.agent]))].sort();
    this.askingSoon();
    for (const [owner, agents] of Object.entries(RUN_BY)) {
      const problem = found.filter((u) => u.agent === owner).map(describe).join('; ');
      const open = (await this.record.raw(`SELECT id, agent, last_seen FROM sessions WHERE agent IN (${agents.map(() => '?').join(', ')}) AND id NOT IN (SELECT session_id FROM events WHERE kind IN ('session.end', 'session.gone', 'session.archived') AND session_id IS NOT NULL)`, [...agents])) as { id: string; agent: string; last_seen: number | null }[];
      for (const s of open) {
        // A reading counts as the session seen, so one quiet for a day reads BLOCKED only if it already did.
        const quiet = (s.last_seen ?? 0) < this.now() - DAY;
        const [last] = (await this.record.raw(`SELECT json_extract(data, '$.reading') AS text FROM events WHERE session_id = ? AND kind = 'session.reading' AND (json_extract(data, '$.reading') LIKE ? OR json_extract(data, '$.reading') LIKE ?) ORDER BY log_pos DESC LIMIT 1`, [s.id, `${CANT_RUN}%`, `${CAN_RUN}%`])) as { text: string }[];
        if (problem && quiet && !last?.text.startsWith(CANT_RUN)) continue;
        const text = problem ? `${CANT_RUN}, so this session's holds and every block but the floor are watch-only: ${problem}. Run \`deep setup\` to point them at a deep-hook that runs.` : last?.text.startsWith(CANT_RUN) ? `${CAN_RUN}: this session's gates hold again.` : undefined;
        if (text && text !== last?.text) await this.queue(() => this.appendReading(s.id, s.agent, text));
      }
    }
  }
  /**
   * A sync landed (#148): each live session of an agent it reached that started before it runs the older set, until
   * its own evidence shows otherwise; for Codex, whose sessions share a daemon, that daemon is named by its PID.
   */
  private async olderSet(sync: Sync): Promise<void> {
    await this.ready;
    const at = sync.completed ?? this.now();
    const reached = new Set(sync.agents);
    for (const s of [...this.sessions.values()]) {
      if (s.ended || !reached.has(s.agent === 'claude' ? 'claude-code' : s.agent)) continue;
      const [row] = (await this.record.raw(`SELECT MAX(ts) AS ts FROM events WHERE session_id = ? AND kind = 'session.start'`, [s.id])) as { ts: number | null }[];
      if (row?.ts === null || row?.ts === undefined || row.ts > at) continue;
      const text = s.agent === 'codex'
        ? `${OLDER_SET} Codex's daemon (pid ${s.pid}${s.start ? `, started ${s.start}` : ''}) started before sync:${sync.id} landed, so this session loads the new MCP servers and skills only once it starts from a daemon started since.`
        : `${OLDER_SET} it started before sync:${sync.id} landed, and loads the new MCP servers and skills only once it starts again.`;
      await this.queue(() => this.appendReading(s.id, s.agent, text));
    }
  }
  /** A session's start from a process started after the sync its row names: its own evidence of the new set (#148). */
  private async newSet(session: Session, meta: HookMeta): Promise<void> {
    // Its own start: its transcript, from a process of its agent's own binary, a Codex daemon started since included.
    if (meta.transcript && resolve(meta.transcript) !== session.transcript) return;
    // npm's Codex runs as node with its bin script, its native build as codex itself.
    const binaries = meta.agent === 'codex' ? [CODEX_BINARY, /@openai\/codex\/bin\/codex\.js(?:\s|$)/] : meta.agent === 'claude-code' || meta.agent === 'claude' ? [CLAUDE_BINARY] : [];
    const args = binaries.length ? await this.parentArgs(meta) : '';
    if (binaries.length && !binaries.some((b) => b.test(args))) return;
    const ppid = meta.ppid;
    const [last] = (await this.record.raw(`SELECT ts, json_extract(data, '$.reading') AS text FROM events WHERE session_id = ? AND kind = 'session.reading' AND (json_extract(data, '$.reading') LIKE ? OR json_extract(data, '$.reading') LIKE ?) ORDER BY log_pos DESC LIMIT 1`, [session.id, `${OLDER_SET}%`, `${NEWER_SET}%`])) as { ts: number; text: string }[];
    if (!last || last.text.startsWith(NEWER_SET)) return;
    const started = Date.parse((await this.startOf(ppid, true)) ?? '');
    if (!(started > last.ts)) return;
    await this.queue(() => this.appendReading(session.id, session.agent, `${NEWER_SET} its process started after the sync its row named, so it loads the MCP servers and skills synced since.`));
  }
  /** A session.reading for the session, appended as the core. */
  private appendReading(session: string, agent: string, reading: string, hook?: string): Promise<void> {
    const ts = this.now();
    const id = hook && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(hook) ? hook : ulid(ts);
    return this.append(this.connection('core', { session, agent }), { v: 1, id, kind: 'session.reading', ts, data: { reading } });
  }

  // ---- Hooks.

  /** A Claude Code stop whose payload says server_error, under 10 minutes old: the try of the host its API calls go to. */
  private tryNetwork(drafts: Draft[], meta: HookMeta, tries = new Map<string, Promise<boolean>>()): Promise<void> | undefined {
    if ((meta.agent !== 'claude-code' && meta.agent !== 'claude') || meta.fields?.error !== 'server_error' || this.now() - (drafts[0]?.ts ?? 0) >= 10 * 60_000) return undefined;
    const host = apiHost();
    const trying = tries.get(host) ?? reachable(host);
    tries.set(host, trying);
    return trying.then((reached) => { meta.network = { host, reached }; });
  }

  /**
   * One hook's events, checked and handed to the record in the order hooks arrived; the next hook waits only
   * for that, not for the commit. Resolves once each append settled.
   */
  /** A hook another machine spooled for this hub while its link was down (#1338): recorded once, as a spool's line is. */
  async replayed(drafts: Draft[], meta: HookMeta): Promise<void> {
    this.track(meta);
    await (await this.queue(() => this.handleHook(drafts, meta, 'hook', true))).settled;
  }
  hook(drafts: Draft[], meta: HookMeta, writer: string): Promise<void> {
    this.track(meta);
    // What deep-hook spooled ran before this hook, so a replay this hook starts, or one running, goes first.
    this.replayLate();
    const replayed = this.replaying ?? Promise.resolve();
    // A network stop's try runs before it queues, so it holds no other hook of any session (#85).
    const tried = this.tryNetwork(drafts, meta);
    const handled = replayed.then(() => tried).then(() => this.queue(async () => {
      const done = await this.handleHook(drafts, meta, writer);
      // Your rules at a tool call, in the hook's own turn (#344).
      if (meta.event === 'SessionEnd') this.ruleState.delete(meta.session);
      if (meta.event === 'PreToolUse' || meta.event === 'PostToolUse') await this.ruleHook(meta).catch((error: unknown) => process.stderr.write(`deep hub: rules at ${meta.session}'s call: ${error instanceof Error ? error.message : String(error)}\n`));
      return done;
    })).then(({ settled }) => settled);
    if (!tried) return handled;
    // It was acknowledged, so nothing else keeps it: the hub stops only once it's in the record.
    const kept = handled.catch(() => undefined).finally(() => this.tried.delete(kept));
    this.tried.add(kept);
    return handled;
  }
  /** Whether a hook is a Claude Code prompt whose transcript entry isn't written yet, so its origin can't be read (#567). */
  private async entryLater(meta: HookMeta): Promise<boolean> {
    const id = meta.fields?.prompt_id;
    if (meta.event !== 'UserPromptSubmit' || !id || !meta.transcript || childPrompt(meta) || (meta.agent !== 'claude-code' && meta.agent !== 'claude')) return false;
    if (this.sessions.get(meta.session)?.prompts.has(id)) return false;
    const tail = await this.tail(meta.transcript, 4 << 20).catch(() => '');
    return !tail.split('\n').some((l) => l.includes(id) && l.includes('"promptId"'));
  }
  /** Handles the session's prompt set aside for its entry, if any, with whatever the transcript now shows. */
  private async placeHeld(session: string): Promise<void> {
    const held = this.unplaced.get(session);
    if (!held) return;
    this.unplaced.delete(session);
    clearTimeout(held.timer);
    const handled = this.handleHook(held.drafts, held.meta, held.writer, false, false, true);
    held.done(handled.then(({ settled }) => settled));
    await handled.catch(() => undefined);
  }
  /**
   * A hook reaching the running hub shows it answers again: what deep-hook spooled while the hub was late is
   * replayed then, beside the hooks that follow, rather than at the next start.
   */
  private replayLate(kept = false): void {
    if (this.stopping) return;
    if (this.replaying) {
      this.retake ||= kept;
      return;
    }
    // A file a failed replay kept is taken again once appends work again.
    if (!this.spool.waiting(kept)) return;
    // A hub that couldn't start replays nothing; its start reports why.
    this.replaying = this.ready
      .then(() => this.spool.replay(), () => undefined)
      .catch((error: unknown) => process.stderr.write(`deep hub: the spool replay stopped: ${error instanceof Error ? error.message : String(error)}\n`))
      .finally(() => {
        this.replaying = undefined;
        // The turns that waited on the replay are judged now, after the hooks queued before.
        void this.queue(async () => {
          for (const session of this.sessions.values()) {
            if (!session.deferred) continue;
            session.deferred = false;
            this.judge(session);
          }
        }).catch(() => undefined);
        // A stop that missed its acknowledgement has no reply to wait for: the turn it ended is judged now.
        for (const session of this.lateStops.splice(0)) void this.judgeEnded(session).catch(() => undefined);
        // What was spooled during the replay, and the files it kept if appends came back, are taken now.
        const kept = this.retake;
        this.retake = false;
        if (!this.blocked) this.replayLate(kept);
      });
  }
  /**
   * Runs `work` after everything queued before it, and after the start, which the spool replay is part of. Work that
   * waits for the start joins the queue only once the start is done: a hook that reaches the hub while it starts
   * would otherwise hold the queue until the start ends, and the start's own replay, queued behind it, never would (#669).
   */
  private queue<T>(work: () => Promise<T>, starting = false): Promise<T> {
    if (!starting && !this.opened) return this.ready.then(() => this.queue(work));
    const done = this.chain.then(work);
    this.chain = done.catch(() => undefined);
    return done;
  }
  private async handleHook(drafts: Draft[], meta: HookMeta, writer: string, replayed = false, waited = false, placing = false): Promise<{ settled: Promise<void> }> {
    // A prompt set aside for its entry goes first: the session's next hook means its turn has begun (#567).
    if (!placing) await this.placeHeld(meta.session);
    if (!placing && !replayed && await this.entryLater(meta)) {
      let done!: (settled: Promise<void>) => void;
      const settled = new Promise<void>((resolve, reject) => { done = (s) => void s.then(resolve, reject); });
      const timer = setTimeout(() => void this.queue(() => this.placeHeld(meta.session)).catch(() => undefined), PROMPT_PLACE_MS);
      timer.unref();
      this.unplaced.set(meta.session, { drafts, meta, writer, timer, done });
      return { settled };
    }
    // The planted wrong program answers the first PostToolUse it reads and appends nothing for it.
    if (this.options.plant === 'drops-post-tool-use' && meta.event === 'PostToolUse' && !this.dropped) {
      this.dropped = true;
      return { settled: Promise.resolve() };
    }
    // A spooled line whose hook the hub already recorded live changes nothing: no count, no stamp, no append.
    if (replayed && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(meta.id)) {
      // Its live copy may be acknowledged and still on its way to the record.
      await Promise.allSettled([...this.inflight]);
      const known = await this.record.raw(`SELECT json_extract(data, '$.late') AS late FROM events WHERE id = ? LIMIT 1`, [meta.id]);
      if (known.length) {
        // Unless deep-hook gave up on an acknowledgement the hub sent just too late: the live copy is in the record
        // unmarked while deep-hook acted on its own, so the session says so rather than the fail-open going unseen.
        if (meta.late && Number((known[0] as { late?: unknown }).late) !== 1) return { settled: this.lateAnswered(meta, meta.late.matched) };
        return { settled: Promise.resolve() };
      }
    }
    // A heavy command deep-hook let through with the hub away ran unleased (#1015): its session's row says so. With
    // the hub only late, deep-hook leased it itself where the agent's call can be rewritten or denied.
    const leasedAlone = meta.late && (meta.agent === 'claude-code' || meta.agent === 'codex');
    if (replayed && meta.event === 'PreToolUse' && meta.heavy && !leasedAlone && typeof meta.call?.input.command === 'string') {
      await this.appendReading(meta.session, meta.agent, `\`${excerpt(meta.call.input.command)}\` ran unleased: the hub was away when it started, so it took no cpu.slot (heavy command ${meta.heavy.name})`).catch(() => undefined);
    }
    // A call whose prompt went to you has run, live or replayed: offered back as a decision to save (#23).
    if (meta.event === 'PostToolUse' && meta.call) void this.offerBack(meta).catch(() => undefined);
    if (drafts.some((d) => d.kind === 'session.end' && d.data.reason === 'clear')) await this.replaced(meta.session);
    if (drafts.some((d) => d.kind === 'session.end')) {
      void this.leftProject(meta.session);
      // Copied now, verified or not: a desktop app deletes what follows this hook (#342), and a copy changes nothing.
      void this.archiveSession?.(meta.session).catch((error: unknown) => process.stderr.write(`deep hub: archive of ${meta.session}: ${error instanceof Error ? error.message : String(error)}\n`));
    }
    if (meta.printed) void this.sessionStarts.refusals(meta.session, meta.toolUse, meta.printed).catch(() => undefined);
    if (meta.ran && meta.cwd) void this.teardowns.saw({ session: meta.session, agent: meta.agent, cwd: meta.cwd, call: meta.toolUse ?? meta.id, ...meta.ran }).catch(() => undefined);
    if (meta.event === 'UserPromptSubmit' && this.options.plant === 'typed-saves-decision') {
      this.typedAt.set(meta.session, Date.now());
      void this.typedSaves(meta.session).catch(() => undefined);
    }
    const whose = await this.whose(meta, drafts.find((d) => d.seq !== undefined)?.seq);
    if (whose.job) {
      const settled = this.appendCore('job.event', { job: whose.job, event: meta.event });
      settled.catch(() => undefined);
      return { settled };
    }
    if (whose.wait && !waited) {
      // Held, not queued: the hooks behind it go on; it is read again once its job's session ID is known.
      const settled = this.park(whose.wait).then(() => this.queue(() => this.handleHook(drafts, meta, writer, replayed, true))).then(({ settled: s }) => s);
      settled.catch(() => undefined);
      return { settled };
    }
    if (whose.reading && !this.readings.has(`${meta.session}\0${whose.reading.job}`)) {
      this.readings.add(`${meta.session}\0${whose.reading.job}`);
      await this.appendReading(meta.session, meta.agent, whose.reading.text).catch(() => undefined);
    }
    // The server's watch-only for hooks that can't run (#993) is no version's: the session is still verified. A hook
    // arriving says a hook program ran, so the programs are checked again at the next tick.
    if (meta.cantRun) {
      delete meta.watchOnly;
      this.hookCheckDue = 0;
    }
    // A session on a version its facts don't cover is recorded unverified, with one reading naming the version.
    if (!meta.version && meta.transcript) {
      const version = versionOf(meta.transcript);
      if (version) Object.assign(meta, { version, ...(coveredBy(meta.agent, version) ? {} : { watchOnly: true }) });
    }
    if (meta.caller && meta.session && !this.miscalled.has(meta.session)) {
      this.miscalled.add(meta.session);
      await this.appendReading(meta.session, meta.agent, meta.caller).catch(() => undefined);
    }
    const verified = meta.watchOnly ? false : await this.verify(meta);
    // A session's first hook from under a run DeepBuild started (#1330): its start.session first, so its first event names the run.
    if (meta.session) await this.sessionStarts.sessionOf(meta.session, meta.ppid, meta.agent).catch(() => undefined);
    if (meta.watchOnly && meta.session && !this.versioned.has(meta.session)) {
      this.versioned.add(meta.session);
      await this.appendReading(meta.session, meta.agent, meta.paseo?.lacks ?? `This session runs ${meta.agent} ${meta.version}, past the versions its facts cover: it is recorded unverified, and its holds and every block but the floor are watch-only until the live smoke test widens the range to ${meta.version}. The floor still holds: its fail_closed guard entries deny as they do with the hub stopped.`).catch(() => undefined);
    }
    const session = this.sessions.get(meta.session);
    if (session && (verified || this.options.plant === 'ends-binding')) {
      // Only an event checked against its session acts on it: an unverified SessionEnd ends nothing.
      // pi resumes a session it replaced in the same process, so the same session can start again.
      if (meta.event === 'SessionStart' && meta.agent === 'pi') session.ended = false;
      if (meta.event === 'SessionEnd') this.sessionOver(session);
      // A replayed PreToolUse was let through late; its call has run, so it stamps nothing a later call could bind.
      if (verified && meta.stamp && !replayed) this.stamps.push({ session: session.id, tool: meta.stamp.tool, digest: meta.stamp.digest });
    }
    const call = session && verified && drafts.length ? meta.toolUse : undefined;
    if (session && call) session.pending.set(call, (session.pending.get(call) ?? 0) + 1);
    // A switch to a leased screen counts once it ran: Claude Code sends PostToolUse only for a call that succeeded (#332).
    if (session && verified && meta.event === 'PostToolUse' && meta.call && /(^|_)switch_display$/.test(meta.call.tool) && SCREEN_TOOLS.some((prefix) => meta.call!.tool.startsWith(prefix))) await this.switched(session.id, String(meta.call.input.display ?? ''));
    if (session && verified) {
      await this.readTranscript(session);
      if (meta.event === 'SessionEnd') this.endTurn(session);
      this.judge(session);
      // Written at once, like a session's first cursor: no later hook of the session would write it.
      if (meta.event === 'SessionEnd') {
        this.writeCursors();
        this.endedOrder.delete(session.id);
        this.endedOrder.add(session.id);
        this.forgetEnded();
      }
    }
    await this.enrich(drafts, meta, session && verified ? session : undefined);
    // A session's start is its own evidence of the set it loads (#148), from the process it starts in.
    if (meta.event === 'SessionStart' && session && !FOREIGN.has(meta.agent)) void this.newSet(session, meta).catch(() => undefined);
    // The session's newest stop, with its cause and owner read: one whose task is open holds the turns DeepBuild
    // would start there until the task closes (#85); any other stop ends an earlier hold.
    const stopped = meta.session && !meta.fields?.agent_id ? drafts.find((d) => d.kind === 'agent.stop') : undefined;
    if (stopped) this.routesOf(meta.session, meta.cwd).blocked = holdsTurns(stopped.data) ? String(stopped.data.cause) : undefined;
    // The cut-off turn's unknown sends are the continue's business: a turn that ended normally, or a prompt you typed,
    // ends their denial, so a later identical send of yours runs. Not the prompt that carries a parked continue itself:
    // the block goes with it, and its turn is the one the denial is for.
    const carrying = this.routes.get(meta.session ?? '');
    const typedNow = drafts.some((d) => d.kind === 'user.ask' && d.data.from === 'person' && !d.queued) && !carrying?.later.length && !carrying?.handed?.length;
    if (meta.session && this.unknownSends.has(meta.session) && ((stopped && stopped.data.outcome !== 'failed') || typedNow)) {
      this.unknownSends.delete(meta.session);
      this.askingSoon();
    }
    // After a restart the core knows a session's state from its next hook on; a person's status question, which
    // changes none, takes the row's before the prompt's event reads as work (#83). Read before the queue's splice,
    // which may take the prompt's own draft.
    if (session && verified && !replayed && meta.event === 'UserPromptSubmit' && isStatusQuestion(meta.fields?.prompt ?? '') && drafts.some((d) => d.kind === 'user.ask' && d.data.from === 'person')) {
      const live = this.liveOf(meta);
      if (live.state === undefined) {
        const [row] = (await this.record.raw(`SELECT status FROM sessions WHERE id = ?`, [meta.session])) as { status: string | null }[];
        if (row?.status) live.state = row.status;
      }
    }
    if (session && verified && !replayed) {
      await this.promptless(drafts, meta, session);
      this.queuedAsks(drafts, session, meta.event);
      if (meta.event === 'UserPromptSubmit') this.appNotes(drafts, meta.session);
    }
    const count = this.counters.get(meta.session) ?? await this.counterOf(meta.session);
    const live = this.liveOf(meta);
    let claimed = false;
    const typed: { text: string; task: string | undefined }[] = [];
    const appends = drafts.flatMap((draft) => {
      const data = { ...draft.data };
      const opens: Promise<void>[] = [];
      if (draft.kind === 'session.start') {
        count.fresh = true;
        // Work counts from the start (#82): a stop after a resume with nothing done since is no claim, and the turn the
        // start cut off is remembered for the one continue after the app's resume prompt.
        live.cutOff = count.worked;
        count.worked = false;
        count.changed = false;
        if (verified) live.judged = false;
      }
      if (draft.fill === 'msg') data.msg = count.msgs++;
      if (draft.kind === 'user.ask') {
        // A prompt you typed that asks for a change opens a task: the issue it names, or the message that asked for it.
        const item = this.items.get(draft);
        let tasks = this.tasks.tasksOf({ session: meta.session, msg: Number(data.msg), text: String(data.text), from: String(data.from), queued: draft.queued === true, first: data.msg === 0 });
        if (item && tasks.length) tasks = [`task:${letters(item.source_id)}`];
        // Kept on the draft too: the turn it opens reads its task there (#83).
        draft.data.tasks = data.tasks = tasks;
        // A message typed mid-turn joins its turn; the turn's own prompt is what an answer begins with.
        if (childPrompt(meta)) { /* the root's turn reads no prompt of its subagent's */ }
        else if (draft.queued && count.prompt) count.prompt.opened ||= tasks.length > 0;
        else {
          count.prompt = { person: data.from === 'person' || data.from === 'app', opened: tasks.length > 0 };
          this.midTurn.delete(meta.session);
          // The prompt that opens a turn is its origin, and ends the grace window a loop's last stop started (#965).
          live.turnFrom = String(data.from);
          this.siblings.turn(meta.session, draft.id, live.turnFrom, this.now());
          // An adapter with no route to hold a prompt leaves the loop rule watch-only for its session, which says so once (#352).
          if (HOLDS_NO_PROMPT.has(meta.agent) && this.siblings.looping(meta.session) && !this.loopWatched.has(meta.session)) {
            this.loopWatched.add(meta.session);
            void this.appendReading(meta.session, meta.agent, `Another session's messages started more than 20 of this session's turns in 10 minutes with no prompt from you, but its adapter (${meta.agent}) has no route to hold a prompt, so the loop rule is watch-only for it: nothing was held.`).catch(() => undefined);
          }
          live.claimedInTurn = false;
          this.gate.prompted(meta.session);
        }
        // Each message typed mid-turn is acknowledged at the session's next tool call (#340). It starts a loop's held
        // checks at the next green turn end (#965), as the app's words do from when they're sent (`note`), unless the
        // planted wrong program counts only a turn's first.
        if (draft.queued && data.from === 'person' && verified) typed.push({ text: String(data.text), task: tasks[0] });
        if (draft.queued && data.from === 'person' && verified && this.options.plant !== 'words-only-at-turn-start') live.words = 'words';
        if (!childPrompt(meta)) {
          count.fresh = false;
          count.changed = false;
        }
        const session = this.sessions.get(meta.session);
        if (session && verified) {
          // Its stops are held from now, so one with no work that leaves the ask open can be sent on (#82).
          if (tasks.length) { this.nudgeable.add(meta.session); this.askingSoon(); }
          for (const task_ref of tasks) opens.push(this.tasks.opened({ session: meta.session, agent: meta.agent, cwd: meta.cwd, thread: session.thread, task_ref, text: String(data.text), prompt: draft.id, at: draft.ts, ...(item ? { item } : {}) }));
        }
      }
      if (draft.fill === 'turn') {
        data.turn = ++count.turns;
        data.did_work = count.worked;
        // The stop rule (#303): a stop with no prompt since startup, a resume or /clear is no claim, and neither is an
        // answer, a turn begun by a prompt you typed that opened no task, with no edit, write or ask in it.
        data.claim = this.stopRule(count);
        if (data.claim && verified) claimed = true;
        // The stop is judged as the rule reads it (#83): a turn's claim stands until a prompt opens the next turn,
        // and a stop with work the rule reads as no claim (an answer) is not judged, whatever was told ahead.
        if (verified && count.worked) live.judged = Boolean(data.claim);
        // A stop with no work that isn't an answer, nor right after a start: an ask it leaves open gets one send-back (#82).
        // A turn a reply of DeepBuild's kept going wasn't begun by your prompt, so its stop is no answer.
        live.idle = verified && !count.worked && !count.fresh && (live.sentOn === true || !this.isAnswer(count));
        if (verified && !count.worked && this.options.plant === 'no-work-never-sent-back') live.judged = false;
        count.worked = false;
        count.changed = false;
      }
      if (draft.kind === 'tool.after') {
        count.worked = true;
        if (!READS.has(String(data.kind))) {
          count.changed = true;
          // A call of DeepBuild's own tools (the claim itself, a run, an ask) changes no code: the turn's claim stands (#83).
          if (!(data.kind === 'mcp' && data.server === 'deep')) live.workedSinceClaim = true;
        }
      }
      // What the rule would read of a stop now, told ahead so the stop is held for its line (#83).
      if (verified && draft.fill !== 'turn' && !live.judged && this.stopRule(count)) { live.judged = true; this.askingSoon(); }
      // A session's events carry the repo it works in, so your answer there is saved for the repo (#23).
      const project = repoOf(meta.cwd);
      if (project && meta.session) this.projects.set(meta.session, project);
      // The person is the hook connection's, and a session is the person's whose connection first sent its hooks (#1337).
      const actor = meta.person ?? OWNER;
      if (meta.session && !this.sessionPeople.has(meta.session)) this.sessionPeople.set(meta.session, actor);
      const connection = this.connection(writer, { ...(meta.session ? { session: meta.session } : {}), agent: meta.agent, verified, actor });
      // The tasks a prompt opens are appended after it, as the core.
      return [this.append(connection, {
        v: draft.v, id: draft.id, kind: draft.kind, ts: draft.ts, ...(draft.seq !== undefined ? { seq: draft.seq } : {}), ...(draft.subject ? { subject: draft.subject } : {}), data: data as JsonValue,
      }), ...opens];
    });
    this.follow(drafts, meta, verified);
    if (typed.length) {
      this.acks.set(meta.session, [...(this.acks.get(meta.session) ?? []), ...typed]);
      this.midTurn.set(meta.session, [...(this.midTurn.get(meta.session) ?? []), ...typed.map((t) => t.text)].slice(-32));
      this.acking(meta.session);
    }
    const settled = Promise.allSettled(appends).then((results) => {
      // A conflict is an ID the log already holds: a spool replayed again, whose event is there once already.
      const failed = results.filter((r) => r.status === 'rejected' && !(r.reason instanceof RecordError && r.reason.code === 'conflict'));
      for (const result of failed) {
        if (result.status === 'rejected' && !(result.reason instanceof RecordError && result.reason.code === 'storage')) {
          process.stderr.write(`deep hub: hook ${meta.id} (${meta.event}) not recorded: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}\n`);
        }
      }
      if (failed.length) throw Error(`hook ${meta.id} was not recorded`);
      // A stop drops what its turn no longer asks as it lands (#84).
      if (drafts.some((d) => d.kind === 'agent.stop')) void this.asks.tick().catch(() => undefined);
    });
    settled.catch(() => undefined);
    // The session map reads the hook before its reply is asked for (#352), once its appends are watched.
    if (verified && meta.session && !FOREIGN.has(meta.agent)) await this.siblings.hook(drafts, meta).catch(() => undefined);
    // A stop that leaves the agent's question open is recorded as waiting on you once the stop is in the record (#27).
    if (meta.event === 'Stop' && drafts.some((d) => d.kind === 'agent.stop' && d.data.outcome !== 'failed')) {
      void settled.then(async () => { if (await this.asksYou(meta.session)) await this.attention(meta.session, meta.agent, 'waiting'); }).catch(() => undefined);
    }
    // A stop the rule reads as a claim recomputes its tasks' definitions' hashes once the stop is in the record; the
    // agent's final message is what the claim cites, for the validity gate (#29).
    if (claimed) this.lastMessage.set(meta.session, meta.fields?.last_assistant_message ?? '');
    if (claimed && replayed) this.lateStops.push(meta.session);
    // A stop while a monitor's watch runs isn't final (#997): its claims are made once the watch ends, as this stop
    // reads them now, and its row reads waiting on the watch at every stop, held or not, since its events are the
    // session's next turns.
    if (meta.event === 'Stop' && verified && watching(live).length) void settled.then(() => this.appendReading(meta.session, meta.agent, waitingOn(watching(live)))).catch(() => undefined);
    if (claimed) {
      const early = !(live.claim && live.claimTurn === live.turn && !live.workedSinceClaim);
      const task = this.turnTaskOf(meta.session, live);
      const claim = async () => this.tasks.claim(meta.session, meta.agent, meta.cwd, { early, task: await task });
      if (watching(live).length) live.deferred = claim;
      else live.claiming = settled.then(claim).catch((error: unknown): string[] => { process.stderr.write(`deep hub: the claim at ${meta.id} was not recorded: ${error instanceof Error ? error.message : String(error)}\n`); return []; });
    }
    // A call reaches the hub once its hook's event is durable, never before: a restart trusts the cursors kept.
    // Its turn is judged once the append settles, however long past the grace that is.
    if (session && call) {
      void settled.then(() => {
        session.reached.add(call);
      }, () => undefined).finally(() => {
        const left = session.pending.get(call)! - 1;
        if (left) session.pending.set(call, left);
        else session.pending.delete(call);
        // Judged in the start too, as its replay is: queued behind the start, it would hold up the replay that ends it.
        void this.queue(async () => this.judge(session), true).catch(() => undefined);
      });
    }
    if (verified && meta.session) this.watchCalls(drafts, meta, settled);
    if (meta.session) this.products.hook(meta);
    if (meta.event === 'SessionStart') void this.products.sessionStart(meta.session, meta.cwd, meta.id).catch(() => undefined);
    return { settled };
  }

  /**
   * What a session's calls show of its guard (#1033). A call denied at PreToolUse whose PostToolUse or
   * PostToolUseFailure arrives ran anyway, as a Claude Code mod's tool.check can make it: guard.overridden. A send that
   * completed in a turn cut off isn't made again once the session resumes, as the cut-off turn's unfinished sends
   * aren't (#85). A start reads whether the session's home loads a mod that can override the guard.
   */
  private watchCalls(drafts: Draft[], meta: HookMeta, settled: Promise<void>): void {
    const { session, toolUse: call } = meta;
    const before = drafts.find((d) => d.kind === 'tool.before');
    if (before && call) {
      const { label, send } = callOf(before.data as Obj, effectEntries(this.root.dir));
      if (meta.blockedBy?.length) this.denied(session, call, { guard: meta.blockedBy.join(', '), label: label.slice(0, 2000) });
      const command = before.data.kind === 'shell' && typeof before.data.command === 'string' ? before.data.command : undefined;
      if (send && meta.call) (this.turnSends.get(session) ?? this.turnSends.set(session, new Map()).get(session)!).set(call, { key: sendKey(meta.call.tool, command, meta.call.input), label, done: false });
    }
    const after = drafts.find((d) => d.kind === 'tool.after');
    if (after && call) {
      const sent = this.turnSends.get(session)?.get(call);
      if (sent) sent.done = after.data.outcome !== 'failed';
      const denial = this.denials.get(session)?.get(call);
      if (denial) this.denials.get(session)!.delete(call);
      const failed = (error: unknown) => process.stderr.write(`deep hub: ${call}'s override was not recorded: ${error instanceof Error ? error.message : String(error)}\n`);
      if (denial) {
        (this.overrides.get(session) ?? this.overrides.set(session, []).get(session)!).push({ call, label: denial.label, ts: this.now() });
        void settled.then(() => this.overridden(meta, call, denial)).catch(failed);
      } else {
        // A deny from before this hub started (a restart, a spooled PostToolUse) is read back from what its call matched.
        void settled.then(() => this.deniedBefore(session, call)).then((before) => {
          if (!before) return;
          (this.overrides.get(session) ?? this.overrides.set(session, []).get(session)!).push({ call, label: before.label, ts: this.now() });
          return this.overridden(meta, call, before);
        }).catch(failed);
      }
    }
    // A turn ends at its stop, or at the next prompt when it ended with none (an interrupt): its sends go with it.
    if (drafts.some((d) => (d.kind === 'agent.stop' && !d.data.child) || d.kind === 'user.ask')) this.turnSends.delete(session);
    // A session's sends wait past its end for a resume; what it denied and saw run is the record's from then on.
    if (meta.event === 'SessionEnd') { this.denials.delete(session); this.overrides.delete(session); }
    if (meta.event === 'SessionStart') {
      const done = meta.fields?.source === 'resume' ? [...(this.turnSends.get(session)?.values() ?? [])].filter((s) => s.done) : [];
      this.turnSends.delete(session);
      const sends = done.length ? this.unknownSends.get(session) ?? this.unknownSends.set(session, new Map()).get(session)! : undefined;
      for (const s of done) sends!.set(s.key, { label: s.label, pr: false, done: true });
      // The server gates a resumed session's calls until it hears again which sessions have sends to match.
      if (meta.fields?.source === 'resume') { this.askingSent = ''; this.askingSoon(); }
      void settled.then(() => this.modsReading(meta)).catch(() => undefined);
    }
  }
  /** A PreToolUse the server's reply denied (#1033): what denied it and the call in words. */
  denied(session: string, call: string, denial: { guard: string; label: string }): void {
    (this.denials.get(session) ?? this.denials.set(session, new Map()).get(session)!).set(call, { guard: denial.guard.slice(0, 2000), label: denial.label.slice(0, 2000) });
  }
  /** The mods of the Claude Code home a session's transcript lives in, and the folders its command line loads; another agent loads none. */
  private async sessionMods(meta: HookMeta): Promise<HomeMods> {
    if (meta.agent !== 'claude-code' && meta.agent !== 'claude') return { home: '', mods: [] };
    const dirs = pluginDirs(await this.parentArgs(meta));
    const home = homeOfTranscript(meta.transcript) ?? claudeHomes(process.env)[0]!;
    // Read again only when what Claude Code lists them from changes, or after MODS_MS: each read starts claude several
    // times. A read in flight is shared, so starts that arrive together start claude once.
    const key = JSON.stringify([home, meta.cwd, dirs, ...[join(home, 'plugins', 'installed_plugins.json'), join(home, 'settings.json'), join(home, 'skills'), ...dirs].map(statKey)]);
    const seen = this.modsSeen.get(key);
    if (seen && this.now() - seen.at < MODS_MS) return seen.read;
    const read = homeMods(home, claudeOnPath(process.env), process.env, { cwd: meta.cwd, dirs });
    this.modsSeen.set(key, { at: this.now(), read });
    // A read that failed is not kept: the next start reads again.
    read.catch(() => { if (this.modsSeen.get(key)?.read === read) this.modsSeen.delete(key); });
    return read;
  }
  /**
   * The login plan of a Claude Code home (#1033), read again only after MODS_MS or once a file a sign-in rewrites
   * changes: each read starts claude, about 175 ms of CPU, on every Claude Code session's start.
   */
  private planOf(home: string): Promise<unknown> {
    const claude = claudeOnPath(process.env);
    if (!claude) return Promise.resolve(undefined);
    const files = [join(home, '.credentials.json'), join(home, '..', '.claude.json'), join(home, '.claude.json')];
    const key = JSON.stringify([claude, ...files.map(statKey)]);
    const seen = this.plansSeen.get(home);
    if (seen && seen.key === key && this.now() - seen.at < MODS_MS) return seen.plan;
    const plan = loginPlan(claude, { ...process.env, ...(home ? { CLAUDE_CONFIG_DIR: home } : {}) });
    this.plansSeen.set(home, { key, at: this.now(), plan });
    return plan;
  }
  /**
   * A denied call that ran anyway (#1033): guard.overridden with what denied it and the home's mods that could have
   * approved it, one line on the session's row, its claims judged again, and for a send, which may already have left,
   * one ask naming it.
   */
  private async overridden(meta: HookMeta, call: string, denial: { guard: string; label: string }): Promise<void> {
    const [row] = (await this.record.raw(`SELECT data FROM events WHERE session_id = ? AND kind = 'tool.before' AND json_extract(data, '$.call') = ? ORDER BY log_pos DESC LIMIT 1`, [meta.session, call])) as { data: string | Obj }[];
    const d = row ? ((typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Obj) : { kind: 'unknown' };
    const { send } = callOf(d, effectEntries(this.root.dir));
    const read = await this.sessionMods(meta);
    const mods = 'mods' in read ? read.mods.filter((m) => m.overrides).map((m) => m.name) : [];
    const tool = meta.call?.tool ?? (d.kind === 'mcp' ? `mcp__${String(d.server)}__${String(d.tool)}` : String(d.kind));
    await this.appendSession(meta.session, meta.agent, 'guard.overridden', { call, tool: tool.slice(0, 2000), label: denial.label, guard: denial.guard, send, mods: mods.map((m) => m.slice(0, 2000)), mods_unread: 'unread' in read ? read.unread.slice(0, 2000) : null });
    // Its claims first, so a verdict that passed before the override arrived doesn't stand on what follows failing.
    const claims = (await this.record.raw(`SELECT id FROM events WHERE kind = 'claim.made' AND session_id = ?`, [meta.session])) as { id: string }[];
    for (const { id } of claims) await this.judged(`claim:${id}`);
    const by = mods.length ? `, approved past the deny by ${mods.join(', ')}` : '';
    await this.appendReading(meta.session, meta.agent, `DeepBuild denied ${denial.label} (${denial.guard}) and it ran anyway${by}: this session's claims can't pass on its own checks.`.slice(0, 8000));
    if (send) {
      const question = `A send DeepBuild denied ran anyway: ${denial.label.slice(0, 1000)} (call ${call})${by}. It may already have left. Check whether it went out?`;
      const options = [{ id: 'checked', label: 'I checked it', decision: 'none' }, { id: 'later', label: 'Not now', decision: 'none' }];
      const raised = { kind: 'exception', question, options, recommended: 'checked', deadline: this.now() + 2 * 86_400_000, fallback: 'you', default: 'later', provisional: false, owner: 'you', key: sha256Hex(canonicalize({ kind: 'guard.overridden', session: meta.session, call } as JsonValue)), pinned_to: await this.pinOf(meta.cwd, question) };
      await this.asks.raise(this.connection('core', { session: meta.session, agent: meta.agent }), 'guard.overridden', raised);
    }
  }
  /**
   * At a Claude Code session's start (#1033): a home that loads a mod able to approve a call past the guard reads its
   * guard as watch-only on the session's row, unless the setup holds the deny: managed settings, or a Team or Enterprise login.
   */
  private async modsReading(meta: HookMeta): Promise<void> {
    const read = await this.sessionMods(meta);
    if (!read.home) return;
    const held = await denyHolds({ ...process.env, ...(read.home ? { CLAUDE_CONFIG_DIR: read.home } : {}) }, claudeOnPath(process.env), () => this.planOf(read.home));
    const risky = held || !('mods' in read) ? [] : read.mods.filter((m) => m.overrides);
    let reading: string | undefined;
    if ('unread' in read && !held) reading = `${MODS_WATCH} (${read.home}) loads mods DeepBuild couldn't read (${read.unread}), so whether one can approve a call past the guard is not checked: its holds and blocks may be watch-only.`;
    else if (risky.length) reading = `${MODS_WATCH} (${read.home}) loads ${risky.map((m) => `the mod ${m.name}, which ${overrideWords(m)!}`).join('; ')}: its holds and blocks are watch-only until the mod is gone or the setup holds the deny (managed settings, or a Team or Enterprise login).`;
    else {
      // The line a start before this one left on the session's row is taken back.
      const [said] = (await this.record.raw(`SELECT json_extract(data, '$.reading') AS text FROM events WHERE session_id = ? AND kind = 'session.reading' AND (json_extract(data, '$.reading') LIKE ? OR json_extract(data, '$.reading') LIKE ?) ORDER BY log_pos DESC LIMIT 1`, [meta.session, `${MODS_WATCH}%`, `${MODS_GONE}%`])) as { text: string }[];
      if (said?.text.startsWith(MODS_WATCH)) reading = `${MODS_GONE} that can approve a call past the guard${held ? ` that ${held} doesn't hold` : ''}: its holds and blocks apply again.`;
    }
    if (reading) await this.appendReading(meta.session, meta.agent, reading.slice(0, 8000));
  }
  /**
   * What denied a call before this hub started, read from its tool.before: the block-mode guard entries it matched, as
   * the reply denies them; undefined when none did.
   */
  private async deniedBefore(session: string, call: string): Promise<{ guard: string; label: string } | undefined> {
    const [row] = (await this.record.raw(`SELECT ts, data FROM events WHERE session_id = ? AND kind = 'tool.before' AND json_extract(data, '$.call') = ? ORDER BY log_pos DESC LIMIT 1`, [session, call])) as { ts: number; data: string | Obj }[];
    if (!row || row.ts >= this.bootAt) return undefined;
    const d = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Obj;
    const rules = readJson(join(this.root.dir, 'rules.json'));
    const entries = isObj(rules) && isObj(rules.entries) ? rules.entries : {};
    const blocks = (Array.isArray(d.matched) ? d.matched.map(String) : []).filter((n) => { const e = entries[n]; return isObj(e) && e.mode === 'block' && !/^effect:(dependency|cloud-resource|unknown-reach-delete|unrestorable-delete|discard-edits|drop-stash)$/.test(String(e.match)); });
    return blocks.length ? { guard: blocks.join(', ').slice(0, 2000), label: callOf(d, effectEntries(this.root.dir)).label.slice(0, 2000) } : undefined;
  }

  // ---- What the core reads beside a session's hooks (#18).

  private liveOf(meta: HookMeta): Live {
    let live = this.live.get(meta.session);
    if (!live) this.live.set(meta.session, (live = { agent: meta.agent, cwd: meta.cwd, last: 0, calls: new Map(), wakeups: [], crons: new Map(), background: new Map(), looping: false, turn: 0, judged: false }));
    return live;
  }
  /** A request line the adapters map, for a payload the core rebuilt from what the parser kept of the hook. */
  private mapped(meta: HookMeta, draft: Draft, payload: Obj, transcript: readonly Obj[]): Obj | undefined {
    if (meta.agent === 'pi' || meta.agent === 'paseo') return undefined;
    const name = ADAPTERS[meta.agent] ?? 'claude';
    const adapter = registry().get(name);
    const version = ((adapter.facts as Obj).versions as string[]).at(-1)!;
    const line = { v: 1 as const, agent: name, event: meta.event, seq: draft.seq ?? '0', id: draft.id, pid: meta.pid, ppid: meta.ppid, matched: [], payload: { session_id: meta.session, hook_event_name: meta.event, ...payload } as JsonValue };
    return adapter.mapHook(line, version, transcript as JsonValue[]).events.find((e) => e.kind === draft.kind)?.data as Obj | undefined;
  }

  /** Fills what the core reads beside a hook, off the parser: what a session loads, a prompt's origin, a stop's records and loop. */
  private async enrich(drafts: Draft[], meta: HookMeta, session: Session | undefined): Promise<void> {
    if (!meta.session) return;
    const live = this.liveOf(meta);
    const foreign = FOREIGN.has(meta.agent);
    for (const draft of drafts) {
      const data = draft.data;
      // The pull request a `gh pr create` call opened, read once off its own PostToolUse (#83).
      if (draft.kind === 'tool.after' && meta.pr) {
        await this.openedPr(meta.session, live.agent, meta.pr);
        live.claimedInTurn = true;
        live.prOpened = meta.pr;
      }
      if (draft.kind === 'session.start') {
        data.loads = await loadsOf(meta.cwd).catch(() => []);
        if (!foreign) void this.enteredProject(meta.session, meta.cwd);
        // Each server's tool list, read off this hook's path: recorded after the start, its changes held for you.
        if (!foreign && session) void this.holds.listed(meta.session, live.agent, meta.cwd).catch((error: unknown) => process.stderr.write(`deep hub: tool lists for ${meta.session} not recorded: ${error instanceof Error ? error.message : String(error)}\n`));
        if (!foreign) await this.recheck().catch(() => undefined);
        if (session) {
          data.thread = session.thread = await this.threadOf(session, meta.fields?.source);
          void this.childOf(session, live.agent).catch(() => undefined);
        }
      } else if (draft.kind === 'user.ask') {
        // The origin joins the prompt to its transcript entry; one it can't place is unknown and opens no ask.
        const entry = meta.fields?.prompt_id && session ? (await this.turnFrom(session, meta.fields.prompt_id))[0] : undefined;
        // A Codex subagent's prompt carries the root's session ID with an agent_id: no message of yours, nor the root's turn (#39).
        if (childPrompt(meta)) { data.from = 'subagent'; continue; }
        let from = foreign ? 'unknown' : String(this.mapped(meta, draft, { ...meta.fields }, entry ? [entry] : [])?.from ?? data.from);
        if (from === 'unknown' && !foreign && this.options.plant === 'unplaced-is-person') from = 'person';
        // The planted wrong programs take an automatic continuation for yours, or read the resume prompt by its look.
        if (from === 'continuation' && this.options.plant === 'continuation-as-person') from = 'person';
        if (this.options.plant === 'continuation-by-likeness' && String(data.text).startsWith('The app was quit while you were working')) from = 'continuation';
        data.from = from;
        live.from = from;
        // The app's own resume prompt (#82): the stop it leads to gets one automatic continue while asks are open.
        if (from === 'continuation' && live.agent === 'claude-code') { live.resumed = true; this.nudgeable.add(meta.session); this.askingSoon(); }
        if (from === 'person' && !foreign) {
          const item = await this.tasks.itemOf(String(data.text));
          if (item) this.items.set(draft, item);
        }
        // A subagent's report or a command's end notice ends its wait: the call the notice names, or else the oldest
        // that isn't a monitor's watch; a monitor's event, naming a watch the session armed, ends none (#997). A
        // scheduled prompt fires its one-shot crons.
        const watch = /<task-id>([^<]+)<\/task-id>/.exec(String(data.text))?.[1];
        if (from === 'subagent' && !(watch && live.armed?.has(watch))) {
          const named = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(String(data.text))?.[1];
          live.background.delete(named && live.background.has(named) ? named : [...live.background].find(([, b]) => !b.watch)?.[0] ?? '');
        }
        if (from === 'scheduled') for (const [id, cron] of live.crons) if (!cron.recurring) live.crons.delete(id);
      } else if (draft.kind === 'tool.after' && meta.loop) {
        const fact = meta.loop;
        if ('scheduled' in fact) { if (fact.scheduled !== null) live.wakeups.push(draft.ts + this.stepped + fact.scheduled); }
        else if ('cron' in fact) live.crons.set(fact.cron, { due: fact.due, recurring: fact.recurring });
        else if ('cancelled' in fact) live.crons.delete(fact.cancelled);
        else if ('monitor' in fact || 'stopped' in fact) {
          // A monitor's watch holds the session looping until its stop call, its process group ending or its timeout
          // (#997). The planted wrong program reads no monitor, as the merge base did.
          if (this.options.plant === 'monitor-unread') continue;
          if ('stopped' in fact) void this.watchEnded(meta.session, fact.stopped, 'a stop call named it');
          else {
            const id = fact.monitor;
            (live.armed ??= new Set()).add(id);
            live.background.set(id, { what: fact.what, watch: { expires: fact.timeout === null ? null : draft.ts + this.stepped + fact.timeout } });
            void groupUnder(meta.ppid, fact.command).then((group) => { const b = live.background.get(id); if (b && group) b.group = group; });
          }
        } else if (fact.background === 'subagent' || this.options.plant !== 'background-subagents-only') {
          live.background.set(fact.call, { what: fact.what });
          // A command also ends when its process group does, read off the agent's process tree.
          if (fact.background === 'command') void groupUnder(meta.ppid, fact.what).then((group) => { const b = live.background.get(fact.call); if (b && group) b.group = group; });
        }
      } else if (draft.kind === 'agent.stop' && !draft.data.child) {
        await this.stopRecords(draft, meta, session);
        if (session && meta.agent === 'claude-code' && meta.fields?.prompt_id && !meta.fields.agent_id) this.loopsOfTurn(live, await this.turnFrom(session, meta.fields.prompt_id));
        const loop = this.loopAt(live);
        if (loop) data.loop = loop;
        if (session && meta.agent === 'codex' && !meta.fields?.agent_id && !meta.watchOnly) await this.codexStop(meta, data, live).catch(() => undefined);
        // A check the agent promises for later becomes a wake-up (#120); a subagent's stop promises nothing to you.
        if (session && !meta.fields?.agent_id) await this.promised(meta).catch(() => undefined);
      }
    }
  }

  // ---- Long waits and promised checks (#120; design: Before each command, "Commands end.").

  /** An event about a session, appended as the core. */
  private appendSession(session: string, agent: string, kind: string, data: Obj): Promise<void> {
    const ts = this.now();
    return this.append(this.connection('core', { session, agent }), { v: 1, id: ulid(ts), kind, ts, subject: `session:${letters(session)}`, data: data as JsonValue });
  }
  /**
   * The waits as the record holds them, for a hub starting on it (#120): how long each command took before, and
   * each session's turn and calls still running, with the last line its chat could read and each call's overrun.
   */
  async waitsState(): Promise<{ history: [string, number][]; sessions: Restored[] }> {
    await this.ready;
    // One read of the recent events, paired by call in memory: no join the database could not index.
    const events = (await this.record.raw(`SELECT e.session_id AS session, e.kind, e.ts, e.data, s.agent, s.worktree FROM events e JOIN sessions s ON s.id = e.session_id
      WHERE e.kind IN ('user.ask', 'agent.stop', 'session.end', 'tool.before', 'tool.after', 'session.reading', 'call.overrun') AND e.log_pos > (SELECT COALESCE(MAX(log_pos), 0) - 20000 FROM events) ORDER BY e.log_pos`)) as { session: string; kind: string; ts: number; data: string | Obj; agent: string | null; worktree: string | null }[];
    const history: [string, number][] = [];
    const befores = new Map<string, { ts: number; key: string }>();
    const state = new Map<string, Restored>();
    for (const e of events) {
      const d = (typeof e.data === 'string' ? JSON.parse(e.data) : e.data) as Obj;
      let r = state.get(e.session);
      if (!r) state.set(e.session, r = { session: e.session, agent: e.agent ?? 'agent', cwd: e.worktree ?? '', lastLine: e.ts, open: [] });
      const call = typeof d.call === 'string' ? d.call : undefined;
      switch (e.kind) {
        case 'user.ask':
          if (d.from === 'person' || !r.turnStart) { r.ask = excerpt(String(d.text ?? ''), 40) || 'your prompt'; r.turnStart = e.ts; }
          r.lastLine = e.ts;
          r.open = [];
          break;
        // A child's stop (agent.stop@5 naming the child) ends no turn of the session: its open calls stay open.
        case 'agent.stop': if (typeof d.child !== 'string') { r.lastLine = e.ts; r.open = []; } break;
        case 'session.end': state.delete(e.session); break;
        case 'tool.before':
          if (call) {
            const kind = String(d.kind ?? 'unknown');
            const tool = String(d.tool ?? '');
            const command = typeof d.command === 'string' ? d.command : null;
            befores.set(`${e.session}|${call}`, { ts: e.ts, key: historyKey(kind, command, tool) });
            r.open.push({ call, kind, tool, command, started: e.ts, shown: e.ts });
          }
          break;
        case 'tool.after': {
          const before = call ? befores.get(`${e.session}|${call}`) : undefined;
          // A call that ended well teaches the next one its time.
          if (before && d.outcome === 'ok' && e.ts >= before.ts) history.push([before.key, e.ts - before.ts]);
          if (call) befores.delete(`${e.session}|${call}`);
          r.open = r.open.filter((o) => o.call !== call);
          break;
        }
        case 'call.overrun': for (const o of r.open) if (o.call === call) { o.overrun = e.ts; o.shown = e.ts; } break;
        case 'session.reading':
          r.lastLine = e.ts;
          for (const o of r.open) o.shown = e.ts;
          break;
        default:
      }
    }
    return { history, sessions: [...state.values()].filter((r) => r.turnStart !== undefined) };
  }
  /** A line the chat showed of a wait: kept as the session's reading, so the next ten minutes count from it after a restart too. */
  async line(session: string, agent: string, text: string): Promise<void> {
    await this.ready;
    await this.queue(() => this.appendReading(session, agent, text.replace(/^DeepBuild: /gm, '')));
  }
  /** A call still running past its expected time: recorded as an overrun, and the session's row says so. It never becomes a wait on you. */
  async overrun(m: { session: string; agent: string; cwd: string; data: Obj }): Promise<void> {
    await this.ready;
    // The line itself is recorded by the hook that shows it (`line`), once, where the chat read it.
    await this.queue(() => this.appendSession(m.session, m.agent, 'call.overrun', m.data));
    // The session's row says so (#27): a reading naming the call, as the record reads no chat line until a hook shows one.
    const d = m.data as { call: string; command: string | null; expected_ms: number; ran_ms: number };
    const what = d.command === null ? '' : ` (\`${d.command.length > 80 ? `${d.command.slice(0, 80)}…` : d.command}\`)`;
    await this.queue(() => this.appendReading(m.session, m.agent, `Call ${d.call}${what} overran: still running ${words(d.ran_ms)} in, past the ${words(d.expected_ms)} expected for it. What it did is unknown until the session is read, so nothing retries it.`)).catch(() => undefined);
  }
  /** Words for an agent whose hooks take no context: carried by its next prompt. */
  later(session: string, cwd: string, text: string): void {
    this.routesOf(session, cwd).later.push(text);
  }
  /**
   * The checks a stop's last message promises for later: the first sets the session's wake-up, or sets it again,
   * keeping its first end; a wake-up never sets itself again. A promise set a fourth time, or due past its end, is
   * BLOCKED with its owner and at most one ask, and no further wake-up fires.
   */
  private async promised(meta: HookMeta): Promise<void> {
    const text = meta.fields?.last_assistant_message;
    if (!text) return;
    const now = this.now();
    const [next] = promisesIn(text, now);
    if (!next) return;
    const current = this.promises.get(meta.session);
    // BLOCKED stands until the session ends: no further wake-up is set, and the one ask is not asked again.
    if (current?.status === 'blocked') return;
    clearTimeout(current?.timer);
    const state = setPromise(current, next, ulid(now));
    const entry = { ...state, timer: undefined, asked: current?.asked ?? false };
    this.promises.set(meta.session, entry);
    if (state.status === 'blocked') return this.promiseBlocked(meta.session, meta.agent, meta.cwd, entry);
    await this.appendSession(meta.session, meta.agent, 'promise.set', { promise: state.id, quote: state.quote, due: state.due, times_set: state.set, end: state.end });
    this.armPromise(meta.session);
  }
  /** One timer per promise, for its due time; nothing polls, so an idle session costs no CPU while it waits. */
  private armPromise(session: string): void {
    const p = this.promises.get(session);
    if (!p || p.status !== 'set' || this.stopping) return;
    clearTimeout(p.timer);
    p.timer = setTimeout(() => void this.queue(() => this.promiseDue(session)).catch(() => undefined), Math.min(Math.max(0, p.due - this.now()), 2 ** 31 - 1));
    p.timer.unref();
  }
  /**
   * A promise's due time: where the session has shown it can be woken when idle (Claude Code's waiter), the wake-up
   * starts a turn now; elsewhere, as in Codex, whose hooks never start a turn, it starts nothing: the session's row
   * shows it due, and its next prompt or stop carries it. The route is the session's shown routes, never the agent's name.
   */
  private async promiseDue(session: string): Promise<void> {
    const p = this.promises.get(session);
    if (!p || p.status !== 'set' || this.stopping) return;
    if (p.due > this.now()) return this.armPromise(session);
    const agent = this.sessions.get(session)?.agent ?? this.live.get(session)?.agent ?? 'claude-code';
    const r = this.routes.get(session);
    // A session stopped on a cause whose task is open isn't woken for it (#85): the check goes with the resume.
    const idle = r !== undefined && r.waiter !== undefined && r.covered && r.shown.has('waiter') && r.wakes !== false && !r.holding && !r.blocked && r.busy < r.waiter.since;
    await this.appendSession(session, agent, 'promise.due', { promise: p.id, due: p.due, route: idle ? 'wake' : 'next_hook' });
    p.status = 'due';
    if (idle && r.waiter) return this.handPromise(session, p, r);
    await this.appendReading(session, agent, dueReading(p));
    // The event loop holds this session's next stop for it.
    this.askingSoon();
  }
  /**
   * The wake-up handed to the session's waiter: woken only once the wake's prompt shows it (the `promise:<id>` token
   * in the waiter's text). A wake that shows no turn within the grace reads stalled, as an ask's does: the route is
   * marked as not waking, the row shows the check due, and the session's next prompt or stop carries it.
   */
  private handPromise(session: string, p: PromiseState & { timer?: NodeJS.Timeout | undefined; handed?: boolean }, r: Routes): void {
    const waiter = r.waiter;
    if (!waiter) return;
    r.waiter = undefined;
    p.handed = true;
    waiter.give({ session, text: wakeText(p) });
    this.armPromiseGrace(session, p, WAKE_GRACE);
  }
  private armPromiseGrace(session: string, p: PromiseState & { timer?: NodeJS.Timeout | undefined }, inMs: number): void {
    if (this.stopping) return;
    clearTimeout(p.timer);
    p.timer = setTimeout(() => void this.queue(() => this.promiseUnwoken(session, p.id)).catch(() => undefined), Math.max(0, inMs));
    p.timer.unref();
  }
  private async promiseUnwoken(session: string, id: string): Promise<void> {
    const p = this.promises.get(session);
    if (!p || p.id !== id || p.status !== 'due' || p.handed !== true) return;
    p.handed = false;
    const agent = this.sessions.get(session)?.agent ?? 'claude-code';
    const r = this.routes.get(session);
    // A route never seen working counts as absent: this session's promised checks wait for its next prompt or stop.
    if (r && r.wakes !== true) r.wakes = false;
    await this.appendSession(session, agent, 'promise.due', { promise: p.id, due: p.due, route: 'next_hook' });
    await this.appendReading(session, agent, `Claude Code didn't wake this session for its promised check: its waiter handed it over and no turn started. ${dueReading(p)}`);
    this.askingSoon();
  }
  /** The due promise a session's prompt or stop carries, taken once, with how it went. */
  private async promiseCarried(session: string, via: 'next_prompt' | 'stop_hold', prompt = ''): Promise<string | undefined> {
    const p = this.promises.get(session);
    if (!p || p.status !== 'due') return undefined;
    p.status = 'woken';
    const agent = this.sessions.get(session)?.agent ?? 'claude-code';
    // The wake's own prompt, carrying the text the waiter was handed, proves the wake; any other hook carries the check
    // itself. Only a handed wake text carries this set's token, so a late wake (its prompt after the grace) still proves
    // the route, and a typed prompt that lands while the wake is queued finds it in the transcript, as an ask's does.
    const token = promiseToken(p);
    const stalled = p.handed === false;
    const woke = via === 'next_prompt' && (prompt.includes(token) || (p.handed !== undefined && await this.woken(session, token)));
    clearTimeout(p.timer);
    const r = this.routes.get(session);
    if (woke && r) r.wakes = true;
    await this.appendSession(session, agent, 'promise.woken', { promise: p.id, via: woke ? 'waiter' : via }).catch(() => undefined);
    if (woke && stalled) await this.appendReading(session, agent, 'Claude Code woke this session for its promised check after all; the check goes with that wake\'s turn.').catch(() => undefined);
    this.askingSoon();
    return woke ? undefined : wakeText(p);
  }
  private promiseDueFor(session: string): boolean { return this.promises.get(session)?.status === 'due'; }
  private async promiseBlocked(session: string, agent: string, cwd: string, p: PromiseState & { asked?: boolean }): Promise<void> {
    const owner = ownerOf(p.quote);
    let ask: string | null = null;
    if (!p.asked) {
      p.asked = true;
      const question = `The agent's promised check is BLOCKED (${blockedCause(p) === 'set_again' ? `promised ${p.set} times` : 'promised past its end'}; owner: ${owner}): "${p.quote}" Do the check yourself, or drop it?`;
      const options = [{ id: 'take', label: 'I will do the check', decision: 'none' }, { id: 'drop', label: 'Drop it', decision: 'none' }];
      const raised = { kind: 'choice', question, options, recommended: 'drop', fallback: 'you', provisional: false, owner: 'you', key: sha256Hex(canonicalize({ kind: 'promise', session, quote: p.quote } as JsonValue)), pinned_to: await this.pinOf(cwd, question) };
      ask = await this.asks.raise(this.connection('core', { session, agent }), 'promise.blocked', raised).catch(() => null);
    }
    await this.appendSession(session, agent, 'promise.blocked', { promise: p.id, status: 'BLOCKED', quote: p.quote, cause: blockedCause(p), owner, ask });
    await this.appendReading(session, agent, blockedReading(p, owner));
    await this.attention(session, agent, 'stuck');
  }
  /** The promises the record holds that still wait, after a restart: each set one is armed again, each due one waits for its hook. */
  private async restorePromises(): Promise<void> {
    const rows = (await this.record.raw(`SELECT session_id AS session, kind, data, ts FROM events WHERE kind IN ('promise.set', 'promise.due', 'promise.woken', 'promise.blocked', 'session.end') AND session_id IS NOT NULL ORDER BY log_pos`)) as { session: string; kind: string; data: string | Obj; ts: number }[];
    const handedAt = new Map<string, number>();
    for (const row of rows) {
      // A session's end takes its promise with it: nothing wakes a session that is gone.
      if (row.kind === 'session.end') { this.promises.delete(row.session); continue; }
      const d = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Obj;
      const p = this.promises.get(row.session);
      if (row.kind === 'promise.set') this.promises.set(row.session, { id: String(d.promise), quote: String(d.quote), due: Number(d.due), set: Number(d.times_set), end: Number(d.end), status: 'set', timer: undefined, asked: p?.asked ?? false });
      else if (p && p.id === d.promise) {
        p.status = row.kind === 'promise.due' ? 'due' : row.kind === 'promise.woken' ? 'woken' : 'blocked';
        p.handed = row.kind === 'promise.due' && d.route === 'wake';
        if (p.handed) handedAt.set(row.session, Number(row.ts));
      }
      if (row.kind === 'promise.blocked' && p) p.asked = true;
    }
    for (const [session, p] of this.promises) {
      if (p.status === 'set') this.armPromise(session);
      else if (p.status === 'due' && p.handed) this.armPromiseGrace(session, p, WAKE_GRACE - (this.now() - (handedAt.get(session) ?? this.now())));
      else if (p.status === 'due') this.askingSoon();
    }
  }

  /**
   * Messages typed while the agent works (#25), read from the transcript's queue at the end of the call they were
   * typed during (#80: its PostToolUse): each is recorded as a prompt you typed, once, whichever of the queue and its
   * UserPromptSubmit shows it first. Any other hook leaves the queue untaken: one that read the transcript between
   * the desktop app's enqueue of its own prompt (a resume prompt, a scheduled tick) and its dequeue would take that
   * prompt for yours, and drop its UserPromptSubmit, which carries its origin (#340).
   */
  private queuedAsks(drafts: Draft[], session: Session, event: string): void {
    const met = (list: string[], text: string) => { const at = list.indexOf(text); if (at >= 0) list.splice(at, 1); return at >= 0; };
    const fromQueue = session.fromQueue ??= [];
    const prompted = session.prompted ??= [];
    const tasks = session.queuedTasks ??= [];
    const asked = drafts.findIndex((d) => d.kind === 'user.ask');
    const every = this.options.plant === 'counts-every-enqueue';
    if (asked >= 0 && !every) {
      const prompt = drafts[asked]!;
      const text = String(prompt.data.text);
      if (met(fromQueue, text)) {
        const spliced = session.spliced ??= new Map();
        // The queue's drafts are taken in their order, like the messages: the same text twice is two tasks.
        const at = tasks.findIndex((d) => d.data.text === text);
        spliced.set(String(prompt.id), { from: String(prompt.data.from ?? 'unknown'), task: at >= 0 ? tasks.splice(at, 1)[0] : undefined });
        for (const id of spliced.keys()) { if (spliced.size <= 32) break; spliced.delete(id); }
        drafts.splice(asked, 1);
      } else {
        prompted.push(text);
        // In the terminal a message typed while the agent works fires its UserPromptSubmit at once (#80): one whose
        // text waits in the queue joins the turn and is acknowledged (#340).
        const waiting = (session.queued ?? []).find((q) => scrubText(q.text, { held: this.options.held }).slice(0, 8192) === text);
        // Its entry may not be in the transcript yet, so a prompt still waiting in the queue is yours: only what you type waits there.
        if (prompt.data.from === 'unknown' && waiting && !AUTOMATIC_QUEUED.test(waiting.text)) prompt.data.from = 'person';
        if (prompt.data.from === 'person' && waiting) {
          prompt.queued = true;
          waiting.taken = true;
        }
      }
    }
    const reads = every || event === 'PostToolUse' || event === 'PostToolUseFailure';
    for (const queued of reads ? session.queued ?? [] : []) {
      if (queued.taken) continue;
      queued.taken = true;
      // What another session, a subagent or a task's notice queued is an automatic prompt, recorded at its dequeue.
      if (AUTOMATIC_QUEUED.test(queued.text) && !every) continue;
      const text = scrubText(queued.text, { held: this.options.held }).slice(0, 8192);
      if (!every && met(prompted, text)) continue;
      fromQueue.push(text);
      const ts = this.now();
      // Its task is set when it is appended (handleHook); the prompt hook that takes it reads it here.
      const draft: Draft = { kind: 'user.ask', v: 1, id: ulid(ts), ts, data: { msg: 0, text, tasks: [], from: 'person' }, fill: 'msg', queued: true };
      drafts.push(draft);
      tasks.push(draft);
    }
    for (const list of [fromQueue, prompted, tasks]) list.splice(0, Math.max(0, list.length - 32));
  }

  /**
   * A Codex turn no prompt hook started, such as a goal's continuation (#340): it opens with a user.ask before its
   * first hook's events, its origin read from the rollout's opening user message by the facts' turnWithoutPrompt.
   */
  private async promptless(drafts: Draft[], meta: HookMeta, session: Session): Promise<void> {
    const facts = (adapterOf(meta.agent)?.facts as Obj | undefined)?.turnWithoutPrompt as { values: Record<string, string>; otherwise: string } | undefined;
    if (!facts) return;
    const turn = meta.fields?.turn_id;
    // A subagent's hooks carry its own turn; no prompt of the root's stands behind them.
    if (!turn || meta.fields?.agent_id) return;
    // A compaction, /compact's own turn included, and a slash command are no prompt (#1022): they open no ask, and
    // leave the turn unstarted, so a continuation that compacts first still opens its own at its next hook.
    if (meta.event === 'PreCompact' || meta.event === 'PostCompact' || meta.event === SLASH_COMMAND) return;
    const started = this.turnsStarted.get(session.id);
    this.turnsStarted.set(session.id, turn);
    if (meta.event === 'UserPromptSubmit' || meta.event === 'SessionStart' || started === undefined || started === turn) return;
    let text = '';
    let inTurn = false;
    for (const raw of (await this.tail(session.transcript, 4 << 20)).split('\n')) {
      let line: Obj;
      try { line = JSON.parse(raw) as Obj; } catch { continue; }
      const payload = isObj(line.payload) ? line.payload : {};
      if (line.type === 'turn_context') inTurn = payload.turn_id === turn;
      else if (inTurn && payload.type === 'message' && payload.role === 'user' && Array.isArray(payload.content)) {
        text = payload.content.filter(isObj).map((c) => (typeof c.text === 'string' ? c.text : '')).join('\n');
        break;
      }
    }
    let from = Object.entries(facts.values).find(([lead]) => text.startsWith(lead))?.[1] ?? facts.otherwise;
    if (from === 'continuation' && this.options.plant === 'continuation-as-person') from = 'person';
    const live = this.live.get(session.id);
    if (live) live.from = from;
    const ts = this.now();
    drafts.unshift({ kind: 'user.ask', v: 1, id: ulid(ts), ts, data: { msg: 0, text: scrubText(text, { held: this.options.held }).slice(0, 8192), tasks: [], from }, fill: 'msg' });
  }
  /**
   * Your words from the app at a prompt's hook (#340), each recorded `from: app` with its request ID: a note its
   * waiter handed over, which the wake's prompt carries, is that prompt's own ask; one still waiting goes as this
   * prompt's context, an ask beside the prompt's. They are matched by request ID, never by their words.
   */
  private appNotes(drafts: Draft[], session: string): void {
    const at = drafts.findIndex((d) => d.kind === 'user.ask' && !d.queued);
    if (at < 0) return;
    const prompt = drafts[at]!;
    const draft = (note: Note): Draft['data'] => {
      const text = scrubText(note.text, { held: this.options.held }).slice(0, 8000);
      // The planted wrong program takes the app's words for yours, with no request ID.
      if (this.options.plant === 'app-note-as-person') return { msg: 0, text, tasks: [], from: 'person' };
      // Recorded as the session reads them, with their request ID, so the same words typed are never the note.
      return { msg: 0, text: `${text} (request ${note.request})`, tasks: [], from: 'app', request: note.request };
    };
    const woke = [...this.handedNotes.values()].filter((n) => n.session === session && String(prompt.data.text).includes(`(request ${n.request})`));
    for (const note of woke) {
      clearTimeout(note.timer);
      this.handedNotes.delete(note.request);
    }
    const waiting = this.notes.get(session)?.splice(0) ?? [];
    if (waiting.length) this.carried.set(session, [...(this.carried.get(session) ?? []), ...waiting]);
    const asks = waiting.map((note): Draft => {
      const ts = this.now();
      return { kind: 'user.ask', v: 1, id: ulid(ts), ts, data: draft(note), fill: 'msg', queued: true };
    });
    const [first, ...rest] = woke;
    // The planted wrong program delivers a waiter's note and records nothing for it.
    if (first && this.options.plant === 'app-note-unrecorded') drafts.splice(at, 1);
    else if (first) {
      prompt.data = draft(first);
      const live = this.live.get(session);
      if (live) live.from = String(prompt.data.from);
      for (const note of rest) {
        const ts = this.now();
        asks.push({ kind: 'user.ask', v: 1, id: ulid(ts), ts, data: draft(note), fill: 'msg', queued: true });
      }
    }
    drafts.push(...asks);
    // The planted wrong program lets a note's yes answer the session's open authority ask, as the trusted path would.
    if (this.options.plant === 'app-note-answers-authority' && [...woke, ...waiting].some((n) => /\b(?:yes|approve|go ahead)\b/i.test(n.text))) void this.noteAnswers(session).catch(() => undefined);
  }
  /** The app-note-answers-authority plant: the session's open authority asks answered with their allowing option. */
  private async noteAnswers(session: string): Promise<void> {
    const rows = (await this.record.raw(`SELECT id, options FROM asks WHERE session_id = ? AND kind = 'authority' AND status IN ('open', 'later')`, [session])) as { id: string; options: string | null }[];
    for (const row of rows) {
      const option = (JSON.parse(row.options ?? '[]') as { id: string; decision?: string }[]).find((o) => o.decision === 'allow');
      if (option) await this.asks.answer(this.connection('app'), `ask:${row.id}`, { option: option.id, plan_hash: (await this.asks.card(`ask:${row.id}`)).plan?.hash ?? null, token: `os-confirm:${ulid(this.now())}` });
    }
  }
  /** The notes as the agent reads them, each labelled as yours, sent from the app, with its request ID. */
  private noteText(notes: Note[]): string {
    return `DeepBuild delivers your words, sent from the app:\n${notes.map((n) => `(request ${n.request}) ${n.text}`).join('\n')}`;
  }
  /** session.note, from the app: your words into a session, by the route its flags allow, as an answer goes (#25). */
  private note(params: Obj): Obj {
    const { session, text, request } = params;
    if (typeof session !== 'string' || !session) throw refuse('type', '/params/session', 'Name the session by its ID, as its hooks carry it.', session);
    if (typeof text !== 'string' || !text.trim() || text.length > 8192) throw refuse('type', '/params/text', 'Send the note\'s words as a string of 1 to 8192 characters.', text);
    if (typeof request !== 'string' || !/^[0-9A-Za-z_-]{1,64}$/.test(request)) throw refuse('type', '/params/request', 'Give the delivery\'s request ID: 1 to 64 letters, digits, - or _.', request);
    if (!this.live.has(session)) throw refuse('not_found', '/params/session', `No session ${session} has reached the hub; send the note to one deep status lists.`, session);
    // A request ID applies once: a retried send changes nothing.
    const known = [...(this.notes.get(session) ?? []), ...this.handedNotes.values()].some((n) => n.request === request);
    if (!known) {
      this.notes.set(session, [...(this.notes.get(session) ?? []), { session, text, request }]);
      // Your words, sent while a turn runs or between turns: the next green turn end starts a loop's held checks (#965).
      if (this.options.plant !== 'words-only-at-turn-start') this.live.get(session)!.words = 'words';
      this.offer(session);
    }
    return { session, request };
  }

  /**
   * The transcript entries of the turn a prompt opened, from its own entry on. The core keeps the current turn's as
   * it reads them; a session it met after its prompt's entry was written (its first hook came late) is read here
   * from the transcript's last few MiB.
   */
  private async turnFrom(session: Session, promptId: string): Promise<Obj[]> {
    if (session.prompts.has(promptId)) return session.entries[0]?.promptId === promptId ? session.entries : [session.prompts.get(promptId)!];
    const lines = (await this.tail(session.transcript, 4 << 20)).split('\n');
    const at = lines.findIndex((l) => l.includes(promptId) && l.includes('"promptId"'));
    if (at < 0) return [];
    return lines.slice(at).flatMap((l) => { try { const e: unknown = JSON.parse(l); return isObj(e) && e.isSidechain !== true ? [e] : []; } catch { return []; } }).slice(0, TURN_ENTRIES);
  }

  /**
   * A stop's cause from its records: the payload's error, then the turn's transcript error records, never the
   * agent's text; its usage; and for a stop with a cause, its error signature and who can act on it.
   */
  private async stopRecords(draft: Draft, meta: HookMeta, session: Session | undefined): Promise<void> {
    const data = draft.data;
    if (session && meta.fields?.prompt_id && !meta.fields.agent_id) {
      const read = this.mapped(meta, draft, { ...meta.fields }, await this.turnFrom(session, meta.fields.prompt_id));
      if (read && typeof read.cause === 'string') {
        data.cause = read.cause;
        if (read.cause === 'plan_window_spent' && typeof read.plan_resets === 'number') data.plan_resets = read.plan_resets;
      }
      if (read && read.usage !== undefined) data.usage = read.usage;
    }
    if (meta.transcript && !meta.fields?.agent_id) void this.recordUsage(meta).catch(() => undefined);
    const cause = String(data.cause);
    if (cause === 'unknown') return;
    data.signature = signature(`stop:${cause}`, meta.fields?.error ?? cause, meta.cwd);
    // Who clears it. A spend limit reads as a rate limit, but only you can raise it (#85).
    data.owner = cause === 'sign_in_required' || cause === 'token_refresh_failed' || meta.fields?.error === 'billing_error' ? 'you' : cause === 'rate_limited' || cause === 'plan_window_spent' || cause === 'timed_out' ? 'service' : 'agent';
    // The payload can't tell a dropped connection from a network you must reconnect, so the hub tried it (#85).
    if (cause === 'timed_out' && meta.network && !meta.network.reached) { data.owner = 'you'; data.signature = signature('stop:network', meta.network.host); }
  }

  /**
   * What the session has spent so far, as turn.usage (#45), off the hook's path: Claude Code's from its transcript and
   * its subagents', estimated from the rate card; Codex's from its rollout, by its adapter, unpriced. A stop that reads
   * nothing records nothing, so that turn's usage reads unknown.
   */
  private async recordUsage(meta: HookMeta): Promise<void> {
    let usage: Obj | undefined;
    if (meta.agent === 'claude-code') {
      const tail = this.tails.get(meta.session) ?? new UsageTail();
      this.tails.set(meta.session, tail);
      const { tokens, cost, model } = await tail.read(meta.transcript);
      if (model) usage = { turn: this.live.get(meta.session)?.turnAsk ?? meta.fields?.prompt_id ?? meta.id, model, covers: 'session', tokens: { input: tokens.input + tokens.cache_write, cached: tokens.cache_read, output: tokens.output, exact: true }, cost };
    } else if (meta.agent === 'codex') {
      const text = await readFile(meta.transcript, 'utf8').catch(() => '');
      const lines = text.split('\n').flatMap((l) => { try { return [JSON.parse(l) as JsonValue]; } catch { return []; } });
      // The session's total, the last it reads; counted as the growth since the one before.
      usage = registry().get('codex').readUsage?.(lines).at(-1) as unknown as Obj | undefined;
    }
    if (!usage) return;
    const ts = this.now();
    await this.append(this.connection('core', { session: meta.session, agent: meta.agent }), { v: 1, id: ulid(ts), kind: 'turn.usage', ts, subject: `session:${letters(meta.session)}`, data: usage as never });
  }

  /**
   * The wake-ups and cron jobs the turn's transcript shows it scheduled or cancelled, read by the same loop facts as
   * their hooks (#965): a PostToolUse deep-hook spooled under load reaches the hub after the stop, and the stop would
   * otherwise read no loop and start checks on code the next wake-up changes. A wake-up its hook counted too is due
   * at the same time.
   */
  private loopsOfTurn(live: Live, entries: readonly Obj[]): void {
    const results = new Map<string, unknown>();
    const parts = (e: Obj): Obj[] => (isObj(e.message) && Array.isArray(e.message.content) ? e.message.content.filter(isObj) : []);
    for (const e of entries) for (const p of parts(e)) if (p.type === 'tool_result') results.set(String(p.tool_use_id), e.toolUseResult);
    for (const e of entries) {
      for (const p of parts(e)) {
        if (p.type !== 'tool_use' || !results.has(String(p.id))) continue;
        const payload = { tool_input: p.input, tool_response: results.get(String(p.id)), tool_use_id: p.id } as Parameters<typeof loopFact>[3];
        const fact = loopFact('claude', String(p.name), 'PostToolUse', payload, '');
        if (!fact) continue;
        if ('scheduled' in fact) { if (fact.scheduled !== null) live.wakeups.push(Date.parse(String(e.timestamp)) + this.stepped + fact.scheduled); }
        else if ('cron' in fact) { if (!live.crons.has(fact.cron)) live.crons.set(fact.cron, { due: fact.due, recurring: fact.recurring }); }
        else if ('cancelled' in fact) live.crons.delete(fact.cancelled);
      }
    }
  }
  /**
   * A stop's loop reading, from the session's own tool calls: looping while a wake-up or cron job it scheduled is
   * due, or a background subagent or command it started hasn't reported; a loop with none left once neither holds.
   */
  private loopAt(live: Live): Obj | undefined {
    const dues = [...live.wakeups, ...[...live.crons.values()].flatMap((c) => (c.due === null ? [] : [c.due]))];
    const due = dues.length ? Math.min(...dues) : null;
    // What the soonest is, for the gate runner and the line (#965).
    live.due = due === null ? null : { at: due, what: live.wakeups.includes(due) ? 'wake-up' : 'cron' };
    let loop: Obj | undefined;
    if (this.options.plant === 'loop-from-origins') {
      // The planted wrong program reads the loop from the prompt's origin alone.
      loop = live.from === 'scheduled' || live.from === 'subagent' ? { state: 'looping', due: null } : live.wakeups.length || live.background.size ? { state: 'looping', due } : undefined;
    } else if (live.wakeups.length || live.crons.size) loop = { state: 'looping', due };
    else if (live.background.size) loop = { state: 'looping', due: null };
    else if (live.looping || live.from === 'scheduled' || live.from === 'subagent') loop = { state: 'none_left' };
    live.looping = loop?.state === 'looping';
    live.wakeups = [];
    return loop;
  }

  /**
   * What a hook says of its session beyond its events: whether it is working, so its hooks going quiet reads unknown,
   * the calls still running, and the commits made in its worktree.
   */
  private follow(drafts: Draft[], meta: HookMeta, verified: boolean): void {
    if (!meta.session) return;
    const live = this.liveOf(meta);
    // The hub's own ticker firing FileChanged (#120) says nothing of the session: its quiet reading stays timed (#992).
    if (meta.event === 'FileChanged') return;
    const now = Date.now();
    live.last = now;
    const wasWaiting = live.state;
    let state = live.state;
    // A prompt hook opens the turn the next stop is judged on: a person's, with work done in it (#83). A prompt read
    // from the transcript's queue (#25) opens none yet: its turn starts when the agent takes it, at its own prompt
    // hook, which then has no draft left. A wake (the waiter's, or a subagent's report as its `<task-notification>`),
    // the app's resume, a status question answered from the record and a subagent's own prompt all leave the turn
    // as it is, so the stop that finishes the person's task is still judged; a hand-back prompt without that text
    // opens a turn of its own, unjudged.
    const prompt = meta.fields?.prompt ?? '';
    const statusQuestion = meta.event === 'UserPromptSubmit' && live.from === 'person' && isStatusQuestion(prompt);
    const continues = prompt.includes('<task-notification>') || live.from === 'continuation' || statusQuestion || Boolean(meta.fields?.agent_id);
    if (meta.event === 'UserPromptSubmit' && !continues) {
      live.turn++;
      live.judged = false;
      live.sentOn = false;
      live.prOpened = undefined;
      // The task the prompt opened: on its draft, or on the queue's draft of it when the queue showed it first.
      const opened = drafts.find((d) => d.kind === 'user.ask') ?? this.sessions.get(meta.session)?.spliced?.get(meta.id)?.task;
      const ask = opened?.data.tasks;
      live.turnTask = Array.isArray(ask) && typeof ask[0] === 'string' ? ask[0] : undefined;
      // The ask that began the turn is the turn's handle, the one its usage carries (#45).
      live.turnAsk = opened?.id;
      this.askingSoon();
    }
    for (const draft of drafts) {
      const call = typeof draft.data.call === 'string' ? draft.data.call : undefined;
      if (draft.kind === 'user.ask') state = 'working';
      else if (draft.kind === 'permission.request') state = 'waiting';
      // A hook that says the session waits on you, is at work again, or sits idle at its prompt (#992); an idle prompt
      // after a stop that failed or got stuck leaves the stop's state.
      else if (draft.kind === 'session.attention' && typeof draft.data.state === 'string' && !(draft.data.state === 'finished' && (state === 'failed' || state === 'stuck'))) state = draft.data.state;
      else if (draft.kind === 'tool.before' || draft.kind === 'tool.after') {
        // A late call event never reopens a turn that stopped.
        if (state !== 'finished' && state !== 'failed') state = 'working';
        if (call && draft.kind === 'tool.before') live.lastCall = call;
        if (call && draft.kind === 'tool.before') live.calls.set(call, { what: `${String(draft.data.kind)} call ${call}${typeof draft.data.command === 'string' ? ` (\`${draft.data.command}\`)` : ''}` });
        else if (call) { const open = live.calls.get(call); if (open) open.ended = now; }
      } else if (draft.kind === 'agent.stop' && !draft.data.child) {
        // A turn that ended on a block only you or a service can clear (a sign-in, a rate limit) leaves the session stuck.
        state = draft.data.outcome !== 'failed' ? 'finished' : draft.data.owner === 'you' || draft.data.owner === 'service' ? 'stuck' : 'failed';
      }
    }
    for (const [call, c] of live.calls) if (c.ended !== undefined && now - c.ended > CALL_GRACE) live.calls.delete(call);
    // A turn you interrupted (#39) has no stop to say so: it ends here, with no claim.
    if (verified && meta.event === 'Interrupt') { state = 'finished'; void this.attention(meta.session, meta.agent, 'finished'); }
    // A compaction is one event (#1022): a PreCompact of the turn whose compaction is still open is the same one again.
    const turn = meta.fields?.turn_id ?? '';
    const again = meta.event === 'PreCompact' && this.compacting.get(meta.session) === turn;
    if (meta.event === 'PreCompact') this.compacting.set(meta.session, turn);
    else if (meta.event === 'PostCompact' || meta.event === 'SessionEnd') this.compacting.delete(meta.session);
    // Kept under the hook's own ID, so the copy deep-hook spooled when the hub was late is known at its replay.
    if (verified && meta.reading && !again) void this.appendReading(meta.session, meta.agent, meta.reading, meta.id).catch(() => undefined);
    // The record reads these states from the hook events themselves; only unknown, below, is the core's to append.
    // A person's status question changes none: answered from the record it runs no model, and let through (an
    // answer waiting, or DeepBuild off) it shows its state at its next hook, as the record's row does.
    if (state && !statusQuestion) live.state = state;
    clearTimeout(live.quiet);
    live.quiet = undefined;
    if (meta.event === 'SessionEnd') {
      // A watch ends with its session, whose last stop is then judged (#997), before the session is let go.
      const ends = [...live.background].filter(([, b]) => b.watch).map(([id]) => this.watchEnded(meta.session, id, 'its session ended'));
      const end = () => { this.live.delete(meta.session); this.gate.ended(meta.session); this.askingSoon(); };
      if (ends.length) void Promise.all(ends).finally(end);
      else end();
    }
    // A session waiting on you goes quiet as a working one does (#992): a prompt denied with Esc says so in no hook.
    else if ((state === 'working' || state === 'waiting') && !statusQuestion && !this.stopping) {
      // The call whose prompt the session starts waiting on: its result, with no hook, shows the prompt closed.
      if (state === 'waiting' && wasWaiting !== 'waiting') live.asking = drafts.some((d) => d.kind === 'permission.request') ? live.lastCall : undefined;
      live.heard = this.now();
      this.quietIn(meta.session, live, now, live.heard + QUIET_MS);
    }
    // Read on the session's own chain, never the core's: a replay at the start would wait on the start it is part of.
    if (meta.cwd && ['SessionStart', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'SessionEnd'].includes(meta.event)) {
      // A call of the session's that makes commits (git commit, merge, cherry-pick, am, revert, rebase) makes the
      // commits that appear by its end the session's (#29: head trust reads them); any other new head is not.
      const after = drafts.find((d) => d.kind === 'tool.after');
      const made = after !== undefined && typeof after.data.command === 'string' && COMMITS.test(after.data.command);
      live.reading = (live.reading ?? Promise.resolve()).then(() => this.commits(meta, live, made)).catch(() => undefined);
    }
  }
  private async attention(session: string, agent: string, state: string): Promise<void> {
    // A session whose question to you is still open waits on you: its stop never reads as finished (#27).
    if (state === 'finished' && await this.asksYou(session)) state = 'waiting';
    const ts = this.now();
    return this.append(this.connection('core', { session, agent }), { v: 2, id: ulid(ts), kind: 'session.attention', ts, subject: `session:${letters(session)}`, data: { state } }).catch(() => undefined);
  }
  /** Whether the session has an ask still open for you. */
  private async asksYou(session: string): Promise<boolean> {
    return ((await this.record.raw(`SELECT 1 FROM asks WHERE session_id = ? AND status IN ('open', 'later') LIMIT 1`, [session]).catch(() => [])) as unknown[]).length > 0;
  }
  /** Times the session's quiet reading for `due` on the hub's clock, which a stepped test clock brings on (#992). */
  private quietIn(id: string, live: Live, since: number, due: number): void {
    clearTimeout(live.quiet);
    live.quietDue = due;
    live.quiet = setTimeout(() => void this.queue(() => this.quiet(id, since)).catch(() => undefined), Math.max(0, due - this.now()));
    live.quiet.unref();
  }
  /**
   * A working or waiting session whose hooks went quiet: unknown, unless its transcript's tail shows it still at work, or
   * still at a prompt: one that closed with no hook, as Esc does, leaves your entry in the transcript (#992).
   */
  private async quiet(id: string, since: number): Promise<void> {
    const live = this.live.get(id);
    if (!live || live.last !== since || (live.state !== 'working' && live.state !== 'waiting')) return;
    live.quiet = undefined;
    const session = this.sessions.get(id);
    const read = session?.read;
    if (session) await this.readTranscript(session);
    const due = live.quietDue ?? this.now();
    const going = live.state === 'working' ? session !== undefined && session.read !== read
      : !(live.asking && session?.results?.includes(live.asking)) && due - (live.heard ?? due) < WAITING_QUIET_MS;
    if (going) {
      this.quietIn(id, live, since, due + QUIET_MS);
      return;
    }
    live.state = 'unknown';
    await this.attention(id, live.agent, 'unknown');
  }
  /**
   * Every session whose agent's process the hub watched end with no SessionEnd (its terminal closed, it was killed):
   * its session.gone, lease or not (#992). Only a process two of its hooks named is watched. A process is checked each tick, and its start time, which tells a reused
   * ID apart, every half minute; a ps that fails proves nothing.
   */
  private async goneSessions(): Promise<void> {
    const now = Date.now();
    // An agent the last hub watched, whose session no hook has brought to this one yet.
    for (const [id, cursor] of [...this.cursors]) {
      const watch = cursor.watch;
      if (!watch || this.sessions.has(id)) continue;
      let alive = running(watch.pid);
      if (alive && now - (this.startChecked.get(id) ?? 0) >= 30_000) {
        this.startChecked.set(id, now);
        const start = await this.startOf(watch.pid, true);
        alive = start === undefined || start === watch.start;
      }
      if (alive || this.sessions.has(id) || this.cursors.get(id) !== cursor) continue;
      this.cursors.set(id, { ...cursor, watch: undefined });
      this.startChecked.delete(id);
      this.saveCursors();
      const ts = this.now();
      await this.append(this.connection('core', { session: id, agent: watch.agent }), { v: 1, id: ulid(ts), kind: 'session.gone', ts, subject: `session:${letters(id)}`, data: { pid: watch.pid, start: watch.start } }).catch(() => undefined);
    }
    for (const session of [...this.sessions.values()]) {
      if (session.ended || !session.pid || !session.watched) continue;
      let alive = running(session.pid);
      if (alive && now - (this.startChecked.get(session.id) ?? 0) >= 30_000) {
        this.startChecked.set(session.id, now);
        const start = await this.startOf(session.pid, true);
        alive = start === undefined || start === session.start;
      }
      if (alive || session.ended) continue;
      session.ended = true;
      this.startChecked.delete(session.id);
      // The process is gone, so its ID may start another: no session is bound to the start time cached for it.
      if (![...this.sessions.values()].some((s) => !s.ended && s.pid === session.pid)) this.starts.delete(session.pid);
      session.interrupted = true;
      if (this.options.plant === 'reap-on-kill') this.stacks.endFor(session.id);
      this.letGoLive(session.id);
      const ts = this.now();
      await this.append(this.connection('core', { session: session.id, agent: session.agent }), { v: 1, id: ulid(ts), kind: 'session.gone', ts, subject: `session:${letters(session.id)}`, data: { pid: session.pid, start: session.start } }).catch(() => undefined);
      if (session.agent === 'codex' && this.options.plant !== 'leaves-codex-session-open') await this.closedAtExit(session).catch(() => undefined);
      this.endedOrder.delete(session.id);
      this.endedOrder.add(session.id);
      this.forgetEnded();
    }
  }
  /**
   * Codex ended with Ctrl-C may fire no SessionEnd (#1023), so its process ending is its end: the core records the
   * session.end, a reading that says so, and each answer still waiting for it goes by its task, as an ended Codex
   * session's answer does (#39).
   */
  private async closedAtExit(session: Session): Promise<void> {
    this.sessionOver(session);
    const ts = this.now();
    await this.append(this.connection('core', { session: session.id, agent: session.agent }), { v: 2, id: ulid(ts), kind: 'session.end', ts, subject: `session:${letters(session.id)}`, data: { reason: 'process_exited' } });
    await this.appendReading(session.id, session.agent, `Codex fired no SessionEnd: the hub closed this session when its process (pid ${session.pid}) exited`);
    for (const answer of await this.answers.waitingFor(session.id)) await this.answers.outcome(answer.id, 'on_task', 'waiting');
  }
  /** A session has ended, by its SessionEnd or its Archive: what it started goes with it (#342). */
  private sessionOver(session: Session): void {
    session.ended = true;
    session.interrupted = false;
    this.stacks.endFor(session.id);
    // Its replicas end with it, and their leases with them (#124).
    this.replicas.endFor(session.id);
    this.stamps = this.stamps.filter((stamp) => stamp.session !== session.id);
  }
  private letGoLive(id: string): void {
    const live = this.live.get(id);
    if (live) { clearTimeout(live.quiet); this.live.delete(id); this.gate.ended(id); this.askingSoon(); }
  }
  /**
   * Codex Desktop's Archive fires no hook and moves the rollout to its archived folder (#80), so that move is the session's
   * end: the rollout is copied from there and the session ends as a SessionEnd ends it (#342). An interrupted session's Archive
   * ends it too. One whose rollout is back where it was has been unarchived, and goes on.
   */
  private async archivedThreads(): Promise<void> {
    const open = [...this.sessions.values()].filter((s) => (!s.ended || s.interrupted) && !existsSync(s.transcript));
    if (!open.length) return;
    const archived = await this.archivedSessions!();
    for (const session of open) {
      if (!archived.has(letters(session.id)) || (session.ended && !session.interrupted)) continue;
      await this.archiveSession!(session.id).catch(() => undefined);
      this.sessionOver(session);
      this.letGoLive(session.id);
      await this.appendSession(session.id, session.agent, 'session.archived', { transcript: session.transcript });
      this.endedOrder.delete(session.id);
      this.endedOrder.add(session.id);
      this.forgetEnded();
    }
  }
  /** Reads the sessions' states again soon after an append; appends that land meanwhile are read in the next pass. */
  private stateSoon(): void {
    if (!this.statesRead || this.stopping) return;
    if (this.stating) { this.restate = true; return; }
    this.stating = new Promise((done) => setTimeout(done, 200)).then(() => this.recordStates()).catch(() => undefined).finally(() => {
      this.stating = undefined;
      if (this.restate) { this.restate = false; this.stateSoon(); }
    });
  }
  /** Marks the row `id` read, as row.set with `unread: false`, if it's unread; whether it was (#1461). */
  private async seeRow(id: string): Promise<Obj> {
    const placed = this.rows.get(id);
    if (!placed?.row.unread) return { seen: false };
    const row = { ...placed.row, unread: false };
    const ts = this.now();
    const session = row.session;
    const connection = this.connection('core', { ...(this.projects.get(session) ? { project: this.projects.get(session)! } : {}), ...(this.sessionPeople.get(session) ? { actor: this.sessionPeople.get(session)! } : {}) });
    await this.append(connection, { v: 1, id: ulid(ts), kind: 'row.set', ts, data: { listed: true, order: placed.order, ...row } as unknown as JsonValue });
    this.rows.set(id, { order: placed.order, row });
    return { seen: true };
  }
  /** Once no state pass is under way or due, the passes appends since asked for included. */
  private async statesSettled(): Promise<void> {
    while (this.stating) await this.stating;
  }
  /** Appends session.state for each session whose state or cause the one reading now gives differently. */
  private async recordStates(): Promise<void> {
    const only = this.touched;
    this.touched = new Set();
    if (only !== 'all' && !only.size) return;
    try {
      // Appended together, so the record commits them in one batch, as it does a first start's state for every session.
      const query = (q: string) => this.record.raw(q);
      const readings = await sessionStates(query, this.now(), only === 'all' ? undefined : only);
      // The list's rows (#1463): each that changed, and each ask's that left the list, in the same batch.
      const built = await buildRows(query, readings);
      const changed = settle(this.rows, built, this.rowsFirst);
      const open = new Set(built.filter((r) => r.id.startsWith('ask:')).map((r) => r.id));
      const left = [...this.rows.keys()].filter((id) => id.startsWith('ask:') && !open.has(id));
      this.rowsFirst = false;
      const rowOf = (session: string) => this.connection('core', { ...(this.projects.get(session) ? { project: this.projects.get(session)! } : {}), ...(this.sessionPeople.get(session) ? { actor: this.sessionPeople.get(session)! } : {}) });
      await Promise.all([
        ...readings.map(async (r) => {
          const state = `${r.state}/${r.cause}`;
          if (this.states.get(r.id) === state) return;
          const ts = this.now();
          await this.append(this.connection('core', { session: r.id, ...(r.agent ? { agent: r.agent } : {}) }), { v: 1, id: ulid(ts), kind: 'session.state', ts, subject: `session:${letters(r.id)}`, data: { state: r.state, cause: r.cause } });
          this.states.set(r.id, state);
        }),
        ...changed.map(async (p) => {
          const ts = this.now();
          await this.append(rowOf(p.row.session), { v: 1, id: ulid(ts), kind: 'row.set', ts, data: { listed: true, order: p.order, ...p.row } as unknown as JsonValue });
          this.rows.set(p.row.id, p);
        }),
        ...left.map(async (id) => {
          const ts = this.now();
          await this.append(rowOf(this.rows.get(id)!.row.session), { v: 1, id: ulid(ts), kind: 'row.set', ts, data: { id, listed: false } });
          this.rows.delete(id);
        }),
      ]);
    } catch (error) {
      this.touched = 'all';
      throw error;
    }
  }
  /**
   * A running job's row as it now reads (#1925), appended at most once a second however fast its tool counts, with
   * the newest count always appended in the end; or, once its tool's run has ended, the row leaving the list.
   */
  private jobShown(job: RunningJob, running: boolean): void {
    const id = `job:${job.key}`;
    const was = this.jobRows.get(id);
    clearTimeout(was?.held);
    if (!running) {
      this.jobRows.delete(id);
      this.jobRowAppend(id, null);
      return;
    }
    const wait = was ? was.at + JOB_ROW_MS - Date.now() : 0;
    if (wait > 0) {
      this.jobRows.set(id, { at: was!.at, held: setTimeout(() => this.jobShown(job, true), wait) });
      return;
    }
    this.jobRows.set(id, { at: Date.now() });
    this.jobRowAppend(id, jobRow(job));
  }
  /** Appends a job's row as row.set@2, or with none its leaving the list, after the job rows' earlier appends. */
  private jobRowAppend(id: string, row: Row | null): void {
    this.jobRowsAppended = this.jobRowsAppended.then(async () => {
      const ts = this.now();
      if (row) {
        const placed = { order: orderOf(row), row };
        await this.append(this.connection('core'), { v: 2, id: ulid(ts), kind: 'row.set', ts, data: { listed: true, order: placed.order, ...row } as unknown as JsonValue });
        this.rows.set(id, placed);
      } else if (this.rows.has(id)) {
        await this.append(this.connection('core'), { v: 2, id: ulid(ts), kind: 'row.set', ts, data: { id, listed: false } });
        this.rows.delete(id);
      }
    }).catch(() => undefined);
  }
  /** The quiet readings a stepped test clock brought due, each quiet period that passed read in turn. */
  private async quietDue(): Promise<void> {
    for (const [id, live] of this.live) {
      while (live.quiet && live.quietDue !== undefined && live.quietDue <= this.now()) {
        clearTimeout(live.quiet);
        live.quiet = undefined;
        await this.queue(() => this.quiet(id, live.last));
      }
    }
  }
  /**
   * The thread a session's ID joins. `/clear`, `/compact` and a fork inside a session rotate the ID in the same agent
   * process, so the new ID joins that process's last session; `--fork-session` starts a new process, whose arguments
   * name the session it forked. Anything else starts a thread of its own. Codex keeps its ID through a compaction and
   * a clear, its daemon runs many threads, and its payload names no fork's parent: its thread is its own ID.
   */
  private async threadOf(session: Session, source: string | undefined): Promise<string> {
    if (manyThreads(session.agent)) return session.id;
    if (source !== 'clear' && source !== 'compact' && source !== 'fork') return session.id;
    const before = [...this.sessions.values()].filter((s) => s.id !== session.id && s.pid === session.pid && s.start === session.start).at(-1);
    if (before) return before.thread;
    if (source !== 'fork') return session.id;
    const from = /(?:^|\s)(?:--resume|-r)[\s=]([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?=\s|$)/.exec(await argsOf(session.pid))?.[1];
    if (!from) return session.id;
    // One that ended long ago has left memory; the record still names its thread.
    const known = this.sessions.get(from)?.thread;
    if (known) return known;
    const [row] = (await this.record.raw('SELECT thread_id FROM sessions WHERE id = ?', [from])) as { thread_id: string | null }[];
    return row?.thread_id ?? from;
  }
  /** Links a session whose agent process another session's agent process started, such as `codex exec` run by Claude Code, as its child. */
  private async childOf(session: Session, agent: string): Promise<void> {
    const parent = await this.agentAbove({ pid: session.pid, start: session.start });
    if (!parent || parent === session.id) return;
    const ts = this.now();
    await this.append(this.connection('core', { session: session.id, agent }), { v: 1, id: ulid(ts), kind: 'session.child_started', ts, subject: `session:${letters(session.id)}`, data: { parent: `session:${letters(parent)}`, child: `session:${letters(session.id)}`, task_ref: null } });
  }
  /**
   * The commits a session made in its worktree since its last hook, each recorded once under it: only those a call of
   * its own that makes commits brought (`made`), never a head that moved some other way, such as a pull of a
   * stranger's commits, whatever their author and committer fields say.
   */
  private async commits(meta: HookMeta, live: Live, made: boolean): Promise<void> {
    const head = await headOf(meta.cwd).catch(() => undefined);
    // A folder with no commit yet: the first one a call makes is a commit too.
    if (!head) { live.unborn = true; return; }
    const before = live.head;
    const first = before === undefined && live.unborn === true;
    live.head = head.sha;
    live.unborn = false;
    if ((before === undefined && !first) || before === head.sha || !made) return;
    for (const sha of first ? [head.sha] : await commitsBetween(meta.cwd, before!, head.sha)) {
      if (this.committed.has(sha)) continue;
      this.committed.add(sha);
      const ts = this.now();
      await this.append(this.connection('core', { session: meta.session, agent: live.agent }), { v: 1, id: ulid(ts), kind: 'commit.made', ts, subject: `session:${letters(meta.session)}`, data: { sha, worktree: meta.cwd, branch: head.branch } }).catch(() => undefined);
    }
  }

  // ---- Our entries in Claude Code's settings (#18).

  private watchSettings(): void {
    const file = claudeSettings();
    this.settingsKey = statKey(file);
    const check = () => void this.queue(() => this.settingsChanged()).catch(() => undefined);
    try {
      this.watcher = watch(resolve(file, '..'), (_, name) => { if (!name || String(name) === 'settings.json') check(); });
      this.watcher.unref();
    } catch {
      // No folder yet: the poll finds the file once setup writes it.
    }
    this.timers.push(setInterval(check, 500));
  }
  /**
   * The settings changed between session starts: an entry of ours removed or weakened while an agent's call was
   * running goes back at once, with a reading naming the call; a change with none running is yours, and stays.
   */
  private async settingsChanged(): Promise<void> {
    const file = claudeSettings();
    const key = statKey(file);
    if (key === this.settingsKey) return;
    this.settingsKey = key;
    const record = installed(this.root.dir);
    const changed = record ? tampered(readJson(file), record) : [];
    if (!record || !changed.length) return;
    const now = Date.now();
    const running = [...this.live].flatMap(([id, l]) => [...l.calls.values()].filter((c) => c.ended === undefined || now - c.ended <= CALL_GRACE).map((c) => ({ id, agent: l.agent, what: c.what })));
    if (!running.length) return;
    restore(record);
    this.settingsKey = statKey(file);
    for (const r of running) {
      const text = `DeepBuild's hook entries in ${file} were removed or changed (${changed.join('; ')}) while the ${r.what} was running; they were put back at once.`;
      this.settingsReadings.push(text);
      await this.appendReading(r.id, r.agent, text).catch(() => undefined);
    }
  }
  /**
   * The recheck at a session's start: our entries changed, or Claude Code's hooks turned off, by a recorded agent call
   * that wrote the settings file, is tampering, and goes back with a reading naming the call; a change no recorded
   * call made is yours, and stays.
   */
  private async recheck(): Promise<void> {
    const record = installed(this.root.dir);
    if (!record) return;
    const file = claudeSettings();
    const settings = readJson(file);
    const flag = settings?.disableAllHooks === true;
    const changed = tampered(settings, record);
    if (!flag && !changed.length) return;
    if (this.options.plant === 'restores-at-session-start-only') {
      if (changed.length) restore(record);
      return;
    }
    const since = Math.floor(statSync(join(this.root.dir, 'claude-hooks.json')).mtimeMs) - 1000;
    const rows = (await this.record.raw(`SELECT id, session_id, agent, data FROM events WHERE kind IN ('tool.before', 'tool.after') AND ts >= ? AND session_id IS NOT NULL AND (instr(data, ?) > 0 OR instr(data, '.claude/settings.json') > 0) ORDER BY log_pos`, [since, file])) as { id: string; session_id: string; agent: string | null; data: string }[];
    if (!rows.length) return;
    restore(record, flag);
    this.settingsKey = statKey(file);
    const what = [flag ? 'turned Claude Code\'s hooks off (disableAllHooks)' : '', changed.length ? `changed DeepBuild's entries (${changed.join('; ')})` : ''].filter(Boolean).join(' and ');
    for (const session of new Set(rows.map((r) => r.session_id))) {
      const mine = rows.filter((r) => r.session_id === session);
      const calls = [...new Set(mine.map((r) => (JSON.parse(r.data) as Obj).call).filter((c): c is string => typeof c === 'string'))];
      const text = `An agent call ${calls.join(', ') || mine[0]!.id} (events ${mine.map((r) => r.id).join(', ')}) wrote ${file} and ${what}; at this session start DeepBuild put its entries back${flag ? ' and took the flag out' : ''}.`;
      this.settingsReadings.push(text);
      await this.appendReading(session, mine[0]!.agent ?? 'claude-code', text).catch(() => undefined);
    }
  }

  // ---- Answers back to a session (#25): through a held stop, its waiter, or the context of its next prompt or start.

  /** What a session has shown of the routes back into it since it last started, its holds, waiter and continuations. */
  private routesOf(session: string, cwd = ''): Routes {
    let r = this.routes.get(session);
    if (!r) this.routes.set(session, r = { cwd, shown: new Set(), covered: true, holding: 0, busy: 0, ended: 0, continued: 0, capped: false, sendBacks: [], later: [] });
    return r;
  }
  /**
   * What each hook shows of its session's routes, read as it arrives, before the record has it: a hook of ours that
   * fired on a version the facts cover counts its route; a tool call or a prompt starts the turn's count again and
   * shows a turn running, from when its hook started; a session's end retires its waiter.
   */
  private track(meta: HookMeta): void {
    if (!meta.session || FOREIGN.has(meta.agent)) return;
    if (meta.event === 'SessionStart') {
      // What a session has shown resets only when it starts again.
      const before = this.options.plant === 'routes-kept-across-sessions' ? [...this.routes.values()].reverse().find((r) => r.cwd === meta.cwd) : undefined;
      const fresh: Routes = { cwd: meta.cwd, shown: before ? before.shown : new Set(), covered: true, holding: 0, busy: 0, ended: 0, continued: 0, capped: false, sendBacks: [], later: [] };
      const old = this.routes.get(meta.session);
      if (old?.waiter) fresh.waiter = old.waiter;
      // A continue parked for the next prompt goes with the first prompt after a resume (#85); a clear or a
      // compaction starts a new session ID, and the cleared one's continues end with it.
      if (old) fresh.later = [...(old.handed ?? []), ...old.later];
      if (old?.places) fresh.places = true;
      this.routes.delete(meta.session);
      this.routes.set(meta.session, fresh);
    }
    const r = this.routesOf(meta.session, meta.cwd);
    r.covered = !meta.watchOnly;
    if (r.covered && !(this.options.plant === 'routes-kept-across-sessions' && r.shown.size)) r.shown.add(meta.event);
    if (meta.parent) void this.queue(() => this.placeOrRefuse(meta.parent!)).catch(() => undefined);
    if (meta.event === 'PreToolUse') {
      if (this.options.plant !== 'stop-count-never-resets') r.continued = 0;
      r.capped = false;
    }
    // A turn running, or a prompt you typed, is the session yours again: its stop's hold on DeepBuild's turns ends (#85).
    if (meta.event === 'UserPromptSubmit' || meta.event === 'PreToolUse' || meta.event === 'PostToolUse') r.blocked = undefined;
    if (meta.event === 'SessionEnd') {
      plantedSessionEnd(this.options.plant, meta.session);
      if (this.options.plant !== 'waiter-outlives-session') r.waiter?.give({ exit: 'session ended' });
      this.routes.delete(meta.session);
      // Its parked continues wait for the session to be resumed (#85), in an entry of no folder, so nothing reads
      // it as the folder's last session.
      if (r.later.length || r.handed?.length) this.routesOf(meta.session).later = [...(r.handed ?? []), ...r.later];
      // A call running as its session quit returns to nobody: its answer waits for the session's resume.
      for (const [ask, waiting] of this.askWaits) if (waiting === meta.session) this.stopAskWait(ask);
      const promise = this.promises.get(meta.session);
      clearTimeout(promise?.timer);
      this.promises.delete(meta.session);
      for (const map of [this.acks, this.midTurn, this.carried, this.turnsStarted, this.onScreen]) map.delete(meta.session);
    } else if (meta.event === 'StopFailure') {
      // A turn that ends on an API error ends like a Stop, and Claude Code starts its waiter as at a Stop; one an
      // earlier stop started may still wait, and either may wake the idle session (#85). Only the newest turn's: a prompt you
      // queued may start before the failed turn's hook is stamped, and one that names no turn ends none.
      if (!meta.fields?.agent_id && meta.fields?.prompt_id !== undefined && meta.fields.prompt_id === r.prompt) r.ended = Math.max(r.ended, ulidTime(meta.id));
    // A notification shows no turn running: Claude Code sends one at an idle prompt too (#992).
    } else if (meta.event !== 'Stop' && meta.event !== 'SessionStart' && meta.event !== 'Notification') r.busy = Math.max(r.busy, ulidTime(meta.id));
    if (meta.event === 'UserPromptSubmit') r.prompt = meta.fields?.prompt_id;
  }
  /** Claude Code's cap on stop-hook continuations in one turn, from its facts. */
  private cap(): number {
    const continuation = (registry().get('claude').facts as Obj).continuation;
    return isObj(continuation) && typeof continuation.cap === 'number' ? continuation.cap : CONTINUATION_CAP;
  }

  /**
   * The answers waiting for a session: answered asks of its thread (its ID and those `/clear`, `/compact` or a fork
   * joined to it) not yet delivered, nor handed to its waiter and not yet seen in a turn; or, with `scope`, the
   * answered asks it names.
   */
  private async waitingFor(session: string, scope?: string): Promise<Answer[]> {
    return this.answers.waitingFor(session, scope);
  }
  /** The answers as the agent reads them, each naming its ask. */
  private answerText(rows: Answer[]): string {
    return answerText(rows, (ask) => this.switches.get(ask));
  }
  /** The asks a running deep_ask or deep_wait of a session whose package places answers will return itself. */
  private readonly askWaits = new Map<string, string>();
  private async outcome(ask: string, via: string, outcome: 'delivered' | 'stalled' | 'timed_out' | 'replaced' | 'waiting'): Promise<void> {
    return this.answers.outcome(ask, via, outcome);
  }
  /** An answer to a Codex session that ended waits on its task, and only the same thread's resume hears it (#39). */
  private async waitsOnTask(delivery: Delivery): Promise<void> {
    await this.answers.waitsOnTask(delivery);
  }
  /**
   * Each answer handed to a hook's reply once (#906). The session is read first: an answer a turn already shows is
   * recorded delivered and not sent again. The rest are in flight until a turn shows them, read at the session's next
   * prompt or stop, once deep-hook is found gone, or when the grace runs out. A tool's reply (no hook) is delivered now.
   */
  private async deliver(rows: Answer[], via: 'next_prompt' | 'stop_hold', hook?: { session: string; id: string }): Promise<string | undefined> {
    if (!rows.length) return undefined;
    // The planted wrong program records the answer delivered as the hub writes its reply.
    if (!hook || this.options.plant === 'delivered-when-written') {
      for (const row of rows) await this.outcome(row.id, via, 'delivered');
      return this.answerText(rows);
    }
    // The planted wrong program keeps no answer in flight, so each later route sends it again without reading the session.
    if (this.options.plant === 'sends-shown-again') return this.answerText(rows);
    // Codex's rollout shows no hook's context, and its facts name no stable format to read one from (#39): its reply is
    // delivered as written, and one deep-hook had already given up on reads stalled and goes by the next route.
    if (this.sessions.get(hook.session)?.agent === 'codex') {
      const outcome = this.abandoned.has(hook.id) ? 'stalled' : 'delivered';
      for (const row of rows) await this.outcome(row.id, via, outcome);
      return outcome === 'delivered' ? this.answerText(rows) : undefined;
    }
    const shown = await this.shown(hook.session, rows.map((row) => said(row.id)));
    const fresh: Answer[] = [];
    for (const row of rows) {
      if (shown?.has(said(row.id))) await this.outcome(row.id, via, 'delivered');
      else fresh.push(row);
    }
    if (!fresh.length) return undefined;
    const at = Date.now();
    for (const row of fresh) this.handed.set(row.id, { session: hook.session, at, via, hook: hook.id, timer: setTimeout(() => void this.queue(() => this.unwoken(hook.session, row.id)).catch(() => undefined), WAKE_GRACE) });
    // A deep-hook already gone takes no reply: what it would carry goes by the next route.
    if (this.abandoned.has(hook.id)) for (const row of fresh) void this.queue(() => this.unwoken(hook.session, row.id)).catch(() => undefined);
    // Claude Code writes a hook's reply into the transcript as the hook ends, so it is read for again soon after.
    else setTimeout(() => void this.queue(() => this.seen(fresh.map((row) => row.id))).catch(() => undefined), SHOWN_SOON).unref();
    return this.answerText(fresh);
  }
  /** A call held on an ask ran again on your yes, so the session has that answer: its stop needn't be sent back to say it. */
  private async heardBy(ask: string): Promise<void> {
    const id = ask.replace(/^ask:/, '');
    if (this.handed.has(id) || (await this.record.raw(`SELECT 1 FROM deliveries WHERE delivery = ? AND outcome = 'delivered' LIMIT 1`, [id])).length) return;
    await this.outcome(id, 'next_prompt', 'delivered');
  }
  /** Answers still in flight that a turn now shows: delivered; the rest stay in flight (#906). */
  private async seen(asks: string[]): Promise<void> {
    for (const ask of asks) {
      const handed = this.handed.get(ask);
      if (!handed || !await this.woken(handed.session, said(ask))) continue;
      clearTimeout(handed.timer);
      this.handed.delete(ask);
      await this.outcome(ask, handed.via === 'wake' ? 'next_prompt' : handed.via, 'delivered');
    }
  }

  /** An answer the asks core recorded: a stop of its session held now takes it, else its waiter if the session is idle. */
  private answered(delivery: Delivery): void {
    // A permission prompt's answer goes back through the prompt it holds (#23).
    this.permits.get(delivery.ask)?.(delivery);
    if (this.prompts.has(delivery.ask)) return;
    // Your answer to a library fetch's authority ask (#1731), which no session raised: a yes runs the fetch's job.
    if (this.libraries?.answered(delivery.ask, delivery.decision)) return;
    // Your answer to a paid job call's authority ask (#1922): a yes lets that call run once.
    if (this.jobKinds?.answered(delivery.ask, delivery.decision)) return;
    // Your answer to a host's ask for changes as you there (#1942): a yes lets its runs start, now and later.
    if (this.hosts.answered(delivery.ask, delivery.decision)) return;
    this.tasks.answered(delivery);
    this.acceptance?.answered(delivery);
    this.delivery(delivery);
    void this.waitsOnTask(delivery).catch(() => undefined);
    const asker = this.sessions.get(delivery.session);
    if (placesItself(asker?.agent) || this.routes.get(delivery.session)?.places) return void this.queue(() => this.placeOrRefuse(delivery.session)).catch(() => undefined);
    // Inside paseo, with neither deep-hook's waiter nor paseo's plugin there to take it, the answer waits on the row (#55).
    const route = this.routes.get(delivery.session);
    if (this.inPaseo.has(delivery.session) && !route?.waiter && !route?.relay) this.answerWaiting.add(delivery.session);
    // One the restarted hub hasn't heard from may be a pi session replaced before it, or any idle session whose waiter asked again.
    if (!asker) void this.queue(() => this.placeOrRefuse(delivery.session)).catch(() => undefined);
    if (this.routes.get(delivery.session)?.holding) for (const wake of this.waiting.get(delivery.session) ?? []) wake();
    else this.offer(delivery.session);
  }
  /** The planted wrong programs that let a held stop go when its answer comes, leaving the answer to the waiter. */
  private get releases(): boolean {
    return this.options.plant === 'answer-skips-held-stop' || this.options.plant === 'stop-hold-releases-without-answer';
  }
  private askingQueued = false;
  private askingSent = '';
  /** The agents whose hook entries run a program that can't run, as the last check found (#993): their gates are watch-only. */
  private cantRun: string[] = [];
  /** When the next check of the hook programs is due, on the hub's clock (#993). */
  private hookCheckDue = 0;
  /**
   * Sends the event loop the sessions with an ask still to deliver, and those whose next stop the stop rule would read
   * as a claim, so it is held for its line (#83); once per turn of appends, when it changed.
   */
  private askingSoon(): void {
    if (this.askingQueued) return;
    this.askingQueued = true;
    setImmediate(() => {
      this.askingQueued = false;
      void this.askingNow().catch(() => undefined);
    });
  }
  private async askingNow(): Promise<void> {
    // A session whose newest start or end is a verified end sends no stop until it starts again, so it leaves the set
    // (#824): one each churned session otherwise kept.
    const rows = ((await this.record.raw(`SELECT id, session_id FROM asks a WHERE session_id IS NOT NULL AND status IN ('open', 'later', 'answered') AND id NOT IN (SELECT delivery FROM deliveries WHERE outcome = 'delivered')`
      + ` AND NOT COALESCE((SELECT kind = 'session.end' AND unverified = 0 FROM events WHERE session_id = a.session_id AND kind IN ('session.start', 'session.end') ORDER BY log_pos DESC LIMIT 1), 0)`)) as { id: string; session_id: string }[])
      .filter((r) => !this.prompts.has(`ask:${r.id}`));
    // A session with a send-back planted for its next stop has that stop held too (#25), and one whose promised check is due (#120).
    const planted = [...this.routes].filter(([, r]) => r.sendBacks.length).map(([id]) => id);
    const promised = [...this.promises].filter(([, p]) => p.status === 'due').map(([id]) => id);
    const sessions = [...new Set([...rows.map((r) => r.session_id), ...planted, ...promised])].sort();
    const judged = [...this.live].filter(([id, l]) => l.judged || this.nudgeable.has(id)).map(([id]) => id).sort();
    // A session whose cut-off turn started a send with no recorded end has its tool calls held for the gate (#85).
    const resend = [...this.unknownSends].filter(([, sends]) => sends.size).map(([id]) => id).sort();
    const key = `${sessions.join(' ')}|${judged.join(' ')}|${resend.join(' ')}|${this.cantRun.join(' ')}`;
    if (key === this.askingSent) return;
    this.askingSent = key;
    this.asking(sessions, judged, resend, this.cantRun);
  }

  /**
   * Hands what waits for an idle session to its waiter, which exits 2 with it and so wakes the session. Claude Code
   * starts the waiter at a stop, so the session is idle while no stop of it is held (the hold takes the answer) and no
   * hook started since the waiter, or since a StopFailure ended a later turn, shows a turn running; never past the
   * turn's cap (the next prompt does), or once its app has shown it doesn't wake.
   */
  private offer(session: string): void {
    const r = this.routes.get(session);
    if (!r) return;
    if (r.places) return void this.queue(() => this.placeOrRefuse(session)).catch(() => undefined);
    // Where deep-hook's own wake isn't there, paseo's plugin prompts the session on its behalf (#55). The planted wrong
    // program hands it over beside a live waiter too.
    if (r.relay && !r.holding && (!r.waiter || this.options.plant === 'paseo-delivers-beside-waiter')) void this.queue(() => this.relayAnswers(session, r)).catch(() => undefined);
    const idle = () => r.waiter !== undefined && !r.holding && r.busy < Math.max(r.waiter.since, r.ended);
    if (!r.covered || !r.shown.has('waiter') || r.capped || r.wakes === false || !idle()) return;
    void this.queue(async () => {
      const waiter = r.waiter;
      if (!waiter || !idle()) return;
      // While the session's newest stop carries a cause whose task is open, no turn DeepBuild causes starts there (#85):
      // an answer, a promised check or a parked line waits on its row and goes with the resume. Only a message you
      // typed goes at once.
      if (r.blocked && !(this.notes.get(session) ?? []).length) return;
      // A promised check that came due before this waiter asked (a hub restarted on the record, the waiter back a
      // moment later) wakes the session now: the route is the waiter's, however the two arrived (#120).
      const p = this.promises.get(session);
      if (p?.status === 'due' && !p.handed) {
        // The hand follows its recorded route, or not at all.
        const agent = this.sessions.get(session)?.agent ?? 'claude-code';
        await this.appendSession(session, agent, 'promise.due', { promise: p.id, due: p.due, route: 'wake' });
        await this.appendReading(session, agent, 'The promised check\'s wake-up is handed to this session\'s waiter.').catch(() => undefined);
        return this.handPromise(session, p, r);
      }
      const rows = await this.waitingFor(session);
      const notes = this.notes.get(session) ?? [];
      if (!rows.length && !notes.length && !r.later.length) return;
      if (this.options.plant === 'waiter-checks-every-5s') {
        // The planted waiter asks every 5 s instead of being told.
        const due = 5000 - ((Date.now() - waiter.at) % 5000);
        setTimeout(() => this.offer(session), due).unref();
        if (due < 4900) return;
      }
      r.waiter = undefined;
      if (this.options.plant === 'waiter-never-wakes') return waiter.give({ exit: 'planted: never wakes' });
      // A continue parked before this waiter connected goes with it too (#85): a first turn that failed had none open.
      const later = r.later.splice(0);
      if (later.length) r.handed = [...(r.handed ?? []), ...later];
      const standing = rows.length ? await this.lineStanding(session) : undefined;
      waiter.give({ session, text: [rows.length ? this.answerText(rows) : '', standing ? `DeepBuild: ${standing}` : '', notes.length ? this.noteText(notes) : '', ...later].filter(Boolean).join('\n\n') });
      // A note is your words once a turn shows them: the wake's prompt names its request ID, else it goes by the next prompt.
      for (const note of this.notes.get(session)?.splice(0) ?? []) {
        this.handedNotes.set(note.request, { ...note, timer: setTimeout(() => void this.queue(async () => this.notWoken(note.request)).catch(() => undefined), WAKE_GRACE) });
      }
      if (this.options.plant === 'delivered-on-waiter-exit' || this.options.plant === 'wake-assumed' || this.options.plant === 'delivered-to-dead-waiter') {
        for (const row of rows) await this.outcome(row.id, 'next_prompt', 'delivered');
        return;
      }
      // Delivered only once a turn shows it: the wake's prompt carries it, or the transcript does.
      const at = Date.now();
      for (const row of rows) this.handed.set(row.id, { session, at, via: 'wake', timer: setTimeout(() => void this.queue(() => this.unwoken(session, row.id)).catch(() => undefined), WAKE_GRACE) });
    }).catch(() => undefined);
  }
  /** The answers waiting for a session deep-hook gates inside paseo, handed to paseo's plugin, which prompts it once it reads idle. */
  private async relayAnswers(session: string, r: Routes): Promise<void> {
    const relay = r.relay;
    const rows = (await this.waitingFor(session)).filter((row) => !this.handed.has(row.id));
    if (!relay || !rows.length) return;
    r.relay = undefined;
    this.answerWaiting.delete(session);
    relay.give({ session, text: this.answerText(rows), asks: rows.map((row) => row.id) });
    // Delivered only once a turn shows it, as a wake's answer is.
    const at = Date.now();
    for (const row of rows) this.handed.set(row.id, { session, at, via: 'next_prompt', timer: setTimeout(() => void this.queue(() => this.unwoken(session, row.id)).catch(() => undefined), WAKE_GRACE) });
  }
  /** The continues the asks core recorded since the hub last read them (#85): each takes a route back into its session. */
  private continues(): Promise<void> {
    return (this.continuing = this.continuing.then(() => this.readContinues()).catch(() => undefined));
  }
  private async readContinues(): Promise<void> {
    const rows = (await this.record.raw(`SELECT log_pos, session_id, data FROM events WHERE kind = 'session.continued' AND log_pos > ${this.continuedPos} ORDER BY log_pos`)) as { log_pos: number; session_id: string | null; data: string | Obj }[];
    for (const row of rows) {
      this.continuedPos = row.log_pos;
      if (!row.session_id) continue;
      const d = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Obj;
      await this.continueSession(row.session_id, String(d.because), typeof d.task === 'string' ? d.task : null, typeof d.stop === 'string' ? d.stop : undefined);
    }
  }
  /**
   * The words a continue goes into its session with (#85): why it continues, then the block from the record for the
   * turn the stop cut off: each change or send call that started with no recorded end, marked outcome unknown, to
   * check before acting on. A send among them is denied at PreToolUse while its outcome is unknown. The box's resume
   * (#146) reuses the block. The block is kept as the session's reading, so the record says what the session heard.
   */
  private async continueBlock(session: string, because: string, task: string | null, stop: string | undefined): Promise<string> {
    const text = continueText(because, task);
    const calls = stop ? await this.cutOff(session, stop) : [];
    if (!calls.length) return text;
    const sends = this.unknownSends.get(session) ?? this.unknownSends.set(session, new Map()).get(session)!;
    // Only a shell send has its input recorded (its command), so only one can be matched as identical; an MCP send is named, never denied.
    for (const call of calls) if (call.send && call.key.startsWith('shell:')) sends.set(call.key, { label: call.label, pr: call.pr });
    const block = `DeepBuild: the turn that was cut off started ${calls.length === 1 ? 'this call' : 'these calls'} with no recorded end, so ${calls.length === 1 ? 'its' : 'each one\'s'} outcome is unknown; check before acting on it: ${calls.map((c) => `${c.label} (outcome unknown)`).join('; ')}.`;
    const agent = this.live.get(session)?.agent ?? this.sessions.get(session)?.agent ?? 'claude-code';
    const [seen] = await this.record.raw(`SELECT 1 FROM events WHERE session_id = ? AND kind = 'session.reading' AND json_extract(data, '$.reading') = ? LIMIT 1`, [session, block]);
    if (!seen) await this.appendReading(session, agent, block).catch(() => undefined);
    if (sends.size) this.askingSoon();
    return `${text}\n\n${block}`;
  }
  /**
   * The change and send calls of the turn `stop` cut off that started with no recorded end: each tool.before of the
   * session between the stop before it and the stop itself with no tool.after for its call. A change is an edit or
   * a write; a send is a shell call that opens a pull request, or one the `effect:` guard entries deep-hook matched
   * read as a push, merge, dispatch, send or delete, or an MCP tool whose facts give it such an effect.
   */
  private async cutOff(session: string, stop: string): Promise<CutOff[]> {
    const rows = (await this.record.raw(`SELECT kind, data FROM events WHERE session_id = ? AND kind IN ('tool.before', 'tool.after')
      AND log_pos < (SELECT log_pos FROM events WHERE id = ?)
      AND log_pos > COALESCE((SELECT MAX(log_pos) FROM events e WHERE e.session_id = ? AND e.kind IN ('agent.stop', 'session.start') AND ${OWN_TURN} AND e.log_pos < (SELECT log_pos FROM events WHERE id = ?)), 0) ORDER BY log_pos`, [session, stop, session, stop])) as { kind: string; data: string | Obj }[];
    const open = new Map<string, Obj>();
    for (const row of rows) {
      const d = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Obj;
      if (typeof d.call !== 'string') continue;
      if (row.kind === 'tool.before') open.set(d.call, d);
      else open.delete(d.call);
    }
    const rules = effectEntries(this.root.dir);
    const found: CutOff[] = [];
    for (const d of open.values()) {
      const kind = String(d.kind);
      const command = typeof d.command === 'string' ? d.command : undefined;
      const { label, send, pr } = callOf(d, rules);
      const change = kind === 'edit' || kind === 'write';
      if (!send && !change) continue;
      const paths = Array.isArray(d.paths) ? d.paths.map(String).join(', ') : '';
      found.push({ key: kind === 'mcp' ? `mcp:${String(d.server)}/${String(d.tool)}` : `${kind}:${command ?? paths}`, label, send, pr });
    }
    return found;
  }
  /**
   * Whether a PreToolUse repeats a send the cut-off turn started with no recorded end (#85), and why it is denied: with
   * the earlier result when the hub can read it (a pull request the forge holds for the session's branch), else with
   * the outcome unknown, once, so the agent checks before sending again. A send the forge shows never went out runs.
   */
  private async resent(meta: HookMeta): Promise<string | undefined> {
    const sends = this.unknownSends.get(meta.session);
    const call = meta.call;
    if (!sends?.size || !call) return undefined;
    const command = typeof call.input.command === 'string' ? call.input.command : undefined;
    // The recorded command was scrubbed by the parser with the values it held then; either spelling matches.
    const keys = command === undefined ? (call.tool.startsWith('mcp__') ? [sendKey(call.tool, undefined, call.input)] : []) : [...new Set([`shell:${scrubText(command, { held: this.options.held })}`, `shell:${command}`])];
    const key = keys.find((k) => sends.has(k));
    const found = key ? sends.get(key) : undefined;
    if (!key || !found) {
      // A different call ran: the agent went on, or checked, as the denial asked. A send denied once is free to run again.
      for (const [k, v] of sends) if (v.denied) sends.delete(k);
      if (!sends.size) { this.unknownSends.delete(meta.session); this.askingSoon(); }
      return undefined;
    }
    // A send the cut-off turn made and saw complete (#1033): denied once, so the resumed session doesn't make it twice.
    if (found.done) {
      found.denied = true;
      return `DeepBuild denied this: ${found.label} is the send the turn that was cut off already made, and it completed. Don't make it again; go on from there.`;
    }
    const result = found.pr ? await this.pullFor(meta) : undefined;
    if (result === null) {
      // The forge holds no pull request for the branch: the send never went out, so this one runs.
      sends.delete(key);
      if (!sends.size) { this.unknownSends.delete(meta.session); this.askingSoon(); }
      return undefined;
    }
    if (result) {
      const agent = this.live.get(meta.session)?.agent ?? meta.agent;
      await this.openedPr(meta.session, agent, result).catch(() => undefined);
      return `DeepBuild denied this: ${found.label} is the send the turn that was cut off already made. Its result: pull request ${result}. Go on from there; don't open it again.`;
    }
    // Its outcome can't be read from here: denied with that, until a different call shows the agent went on or checked;
    // a retry right after a late reply is denied again, so a hold that ran out never lets the send through.
    found.denied = true;
    return `DeepBuild denied this: ${found.label} is the send the turn that was cut off started with no recorded end, so its outcome is unknown. Check whether it went through before sending again; only a call you've checked, or a different one, runs.`;
  }
  /** The pull request the forge holds for the session's branch, or null when it holds none, or undefined when it can't be read. */
  private async pullFor(meta: HookMeta): Promise<string | null | undefined> {
    const lookup = async (): Promise<string | null | undefined> => {
      const repo = repoOf(meta.cwd);
      const [row] = (await this.record.raw(`SELECT branch FROM sessions WHERE id = ?`, [meta.session])) as { branch: string | null }[];
      const branch = row?.branch || await new Promise<string | undefined>((done) => execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: meta.cwd, timeout: 2000 }, (error, out) => done(error ? undefined : out.trim())));
      if (!repo || !branch) return undefined;
      const forge = new Forge(this.options.forge ?? 'https://api.github.com', process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? await ghToken());
      return forge.pullFor(repo, branch);
    };
    // Well inside the gate's hold, so the reply is never late for this: past it the result is unknown.
    return Promise.race([lookup().catch(() => undefined), new Promise<undefined>((done) => setTimeout(() => done(undefined), PULL_LOOKUP_MS).unref())]);
  }
  /**
   * One automatic continue of a stopped session (#85), by #25's routes: a stop of the session held now is sent back
   * with it; else its idle waiter wakes the session with it; else it goes with the session's next prompt, and the
   * record says so. The core decided it from the stop's structure; the hub only carries it. What waited on the row
   * while the stop's task was open (a parked line, a promised check due) goes with the resume.
   */
  private async continueSession(session: string, because: string, task: string | null, stop?: string): Promise<void> {
    const block = await this.continueBlock(session, because, task, stop);
    // A verdict that landed while the session was stopped (a slow-lane FAIL, say) waited on its row: it goes with the resume.
    const landed = await this.landedLine(session).catch(() => undefined);
    const claim = this.live.get(session)?.claim;
    const text = landed ? `${block}\n\nDeepBuild: while this session was stopped, its claim${claim ? ` ${claim}` : ''} was judged: ${landed}` : block;
    const r = this.routesOf(session);
    r.blocked = undefined;
    if (r.holding) {
      r.sendBacks.push(text);
      for (const wake of this.waiting.get(session) ?? []) wake();
      return;
    }
    const waiter = r.waiter;
    if (waiter && r.covered && r.shown.has('waiter') && !r.capped && r.wakes !== false && r.busy < Math.max(waiter.since, r.ended)) {
      r.waiter = undefined;
      const later = r.later.splice(0);
      r.handed = [...(r.handed ?? []), text, ...later];
      const p = this.promises.get(session);
      let promised: string | undefined;
      if (p?.status === 'due' && !p.handed) { p.handed = true; promised = wakeText(p); this.armPromiseGrace(session, p, WAKE_GRACE); }
      waiter.give({ session, text: [text, ...later, promised].filter(Boolean).join('\n\n') });
      return;
    }
    r.later.push(text);
    const agent = this.live.get(session)?.agent ?? this.sessions.get(session)?.agent ?? 'claude-code';
    await this.appendReading(session, agent, `DeepBuild continues this session (${because}${task ? `, task ${task}` : ''}), but no route into it is open now: the continue goes with its next prompt.`).catch(() => undefined);
  }
  /**
   * An answer handed to a route that no turn has shown: the transcript is read for it, and with none it reads stalled
   * and goes by the next route. A waiter's also says the app didn't wake the session, and its answer goes by the next
   * prompt.
   */
  private async unwoken(session: string, ask: string, prompt?: string): Promise<void> {
    const handed = this.handed.get(ask);
    if (!handed) return;
    clearTimeout(handed.timer);
    this.handed.delete(ask);
    const wake = handed.via === 'wake';
    const via = wake ? 'next_prompt' : handed.via;
    const woken = (wake && (prompt ?? '').includes(`ask:${ask}`)) || await this.woken(session, said(ask));
    if (woken) {
      const r = this.routes.get(session);
      if (r && wake) r.wakes = true;
      return this.outcome(ask, via, 'delivered');
    }
    // A session that can't be read proves nothing either way (#27): timed out, and the next prompt reads it first.
    if (woken === undefined) {
      this.unread.set(ask, session);
      return this.outcome(ask, via, 'timed_out');
    }
    await this.outcome(ask, via, 'stalled');
    if (!wake) {
      await this.appendReading(session, this.sessions.get(session)?.agent ?? 'claude-code', `DeepBuild's ${via === 'stop_hold' ? 'stop' : 'prompt'} reply carrying your answer to ask:${ask} didn't reach the agent: deep-hook had given up on it. The answer goes by the session's next route.`).catch(() => undefined);
      return;
    }
    const r = this.routes.get(session);
    // A route never seen working counts as absent: this session's answers wait for its next prompt.
    if (r && r.wakes !== true) r.wakes = false;
    await this.appendReading(session, this.sessions.get(session)?.agent ?? 'claude-code', `Claude Code didn't wake this session with your answer to ask:${ask}: its waiter handed it over and no turn started. The answer goes with the session's next prompt.`).catch(() => undefined);
  }
  /**
   * A session cleared while its waiter's answers showed in no turn (#27): replaced, and each goes to the thread's new
   * session at its start, as an answer that never reached it.
   */
  private async replaced(session: string): Promise<void> {
    for (const [ask, handed] of [...this.handed]) {
      if (handed.session !== session) continue;
      clearTimeout(handed.timer);
      this.handed.delete(ask);
      await this.outcome(ask, handed.via === 'stop_hold' ? 'stop_hold' : 'next_prompt', 'replaced');
    }
  }
  /** A note its waiter handed over that no turn showed: it waits for the session's next prompt. */
  private notWoken(request: string): void {
    const note = this.handedNotes.get(request);
    if (!note) return;
    this.handedNotes.delete(request);
    this.notes.set(note.session, [...(this.notes.get(note.session) ?? []), { session: note.session, text: note.text, request }]);
  }
  /** Whether the transcript shows a turn carrying `token`; undefined when the transcript can't be read. */
  private async woken(session: string, token: string): Promise<boolean | undefined> {
    return (await this.shown(session, [token]))?.has(token);
  }
  /**
   * The tokens the transcript shows a turn carrying (an ask's answer, a promise's wake-up): a queued wake, a prompt or
   * a stop hook's feedback naming one, or a hook's context or blocking error carrying it (#906); undefined when the
   * transcript can't be read.
   */
  private async shown(session: string, tokens: string[]): Promise<Set<string> | undefined> {
    const seen = new Set<string>();
    const transcript = this.sessions.get(session)?.transcript;
    if (!transcript) return seen;
    try { await access(transcript, constants.R_OK); } catch { return undefined; }
    for (const l of (await this.tail(transcript, 1 << 20)).split('\n')) {
      const hit = tokens.filter((t) => l.includes(t));
      if (!hit.length) continue;
      try {
        const e = JSON.parse(l) as Obj;
        const hook = e.type === 'attachment' && isObj(e.attachment) && (e.attachment.type === 'hook_additional_context' || e.attachment.type === 'hook_blocking_error');
        if (hook || e.type === 'queue-operation' || (e.type === 'user' && isObj(e.message) && typeof e.message.content === 'string')) for (const t of hit) seen.add(t);
      } catch { /* a cut line shows nothing */ }
    }
    return seen;
  }
  private async tail(file: string, bytes: number): Promise<string> {
    try {
      const handle = await open(file, 'r');
      try {
        const { size } = await handle.stat();
        const length = Math.min(size, bytes);
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, size - length);
        return buffer.subarray(0, bytesRead).toString('utf8');
      } finally {
        await handle.close();
      }
    } catch {
      return '';
    }
  }

  /**
   * A PreToolUse the hub held for the gate: why its call waits for you, or nothing when it runs (#321), and the rule
   * that denied it, which the server keeps with the deny it sends (#1033).
   */
  async toolGate(meta: HookMeta, call: Gated): Promise<{ held?: string; allow?: string; deny?: string; rule?: string; answers?: Record<string, string> }> {
    await this.ready;
    // A synced server is called only from a session in its scope (#148).
    const scoped = call.mcp ? this.agents.scopeDenial(call.mcp.server, meta.cwd) : undefined;
    if (scoped) return { deny: scoped, rule: "the server's scope (#148)" };
    // A question card is sorted like a question at a stop (#84).
    if (call.card) {
      if (FOREIGN.has(meta.agent) || !meta.session) return {};
      const live = this.live.get(meta.session);
      const reply = await this.questions.card(meta, call.card, [...(this.claimRequirements.get(live?.claim ?? '')?.values() ?? await this.requirementsOf(meta.session))]);
      return reply.answers ? { answers: reply.answers } : reply.reason ? { held: reply.reason, rule: "the question sort (#84)" } : {};
    }
    // A pull request says Closes only when every requirement of the issue's task passed (#322; design: At the claim).
    if (call.pr && call.command && meta.session && !FOREIGN.has(meta.agent)) {
      const deny = await this.closesGate(meta.session, call.command).catch(() => undefined);
      if (deny) return { deny, rule: "the gate's Closes rule (#322)" };
      if (!call.classes.length && !call.named && !call.mcp && !call.decided?.length && call.stage === undefined && !call.screen && !call.resend) return {};
    }
    // Computer use stays on what the session leases (#332), so your own screen and browser are never touched.
    if (call.screen && meta.call) {
      const deny = await this.offScreen(meta.session, meta.call.tool, meta.call.input);
      if (deny) return { deny };
    }
    // A send the cut-off turn started with no recorded end isn't made again (#85): denied with the earlier result. The
    // hooks before this one go first, so a resume's start has said which sends its cut-off turn made (#1033).
    if (call.resend) {
      await this.queue(async () => undefined);
      const deny = await this.resent(meta).catch(() => undefined);
      if (deny) return { deny, rule: "the gate's repeated-send rule (#85)" };
      if (!call.classes.length && !call.named && !call.mcp && !call.decided?.length && call.stage === undefined) return {};
    }
    // A cloud resource nobody can be asked about from here stays denied, as with the hub down; a destructive command
    // runs only staged.
    if (FOREIGN.has(meta.agent) || !meta.session) {
      if (call.decided?.includes('cloud-resource')) return { deny: 'DeepBuild blocked this: creating a cloud resource the plan doesn\'t name needs your standing rule or your answer, and this session can\'t be asked.' };
      return call.stage !== undefined ? this.staging.gate(meta, call, false) : {};
    }
    const held = await this.holds.gate(meta, call);
    if (held) return { held };
    // A destructive command runs only once what it reaches is staged, or you said yes (#347, #1294).
    if (call.stage !== undefined) {
      const staged = await this.staging.gate(meta, call, true);
      if (staged.held) return staged;
    }
    // A dependency or a cloud resource the plan doesn't name: answered by your standing rule, or asked (#23).
    const about = call.decided?.length && call.command ? aboutCall(call.decided, call.command, homedir()) : undefined;
    return about ? this.holds.decide(meta, about) : {};
  }

  /**
   * Why a `gh pr create` or `gh pr edit` whose body says `Closes #n` is refused (#322): a requirement of the issue's
   * open task that no verdict has passed keeps the PR at "Part of", and so does a review note on its PR that is
   * neither fixed nor accepted by you (#87); the refusal lists what's left; undefined when it may run.
   */
  private async closesGate(session: string, command: string): Promise<string | undefined> {
    const issue = closesIssue(command);
    if (issue === undefined) return this.partOfGate(session, command);
    // The planted wrong program judges the bootstrap's commands alone: the issue's criteria never hold a PR back.
    if (this.options.plant === 'bootstrap-commands-only') return undefined;
    const open = await this.tasks.unproven(session, issue);
    if (!open) return undefined;
    if (!open.locked) return `DeepBuild blocked this: the pull request can't say Closes #${issue} while the definition of ${open.task_ref} hasn't locked, so nothing of it is proven yet. Say Part of #${issue} instead, and list what's left.`;
    // What a split moved to a new issue, or all of it once you accepted what's proven, no longer keeps it open (#325).
    const moved = this.accepted.has(open.task_ref) ? undefined : await this.movedOut(open.task_ref);
    const unproven = moved ? open.left.filter((q) => !moved.has(q.id)) : [];
    if (unproven.length) {
      const left = unproven.map((q) => `${q.id} (${q.text})`).join('; ');
      return `DeepBuild blocked this: the pull request can't say Closes #${issue} while a requirement of ${open.task_ref} is unproven. Say Part of #${issue} instead, and list what's left: ${left}.`;
    }
    const notes = await this.openItems.openNotes(open.task_ref);
    if (notes.length) return `DeepBuild blocked this: the pull request can't say Closes #${issue} while a review note on it is neither fixed nor accepted. Fix each, or have it accepted through its ask, and say Part of #${issue} until then: ${notes.join('; ')}.`;
    // Nor until its release checks pass on its merge with main, and you decided its switches left off stay off (#325).
    return this.deliveryHeld(session, issue, open.task_ref);
  }
  /**
   * A pull request that says Part of #n (#82; design: Every stop is judged): its body lists, under that line, each
   * requirement of the issue's open task still unproven, so they land on the PR as its open items. Why it is refused
   * while one is missing, naming them; undefined when it may run.
   */
  private async partOfGate(session: string, command: string): Promise<string | undefined> {
    const issue = partOfIssue(command);
    if (issue === undefined) return undefined;
    const open = await this.tasks.unproven(session, issue);
    const missing = open?.left.filter((q) => !new RegExp(`\\b${q.id}\\b`).test(command.slice(command.search(/\bpart of\b/i)))) ?? [];
    if (!missing.length) return undefined;
    return `DeepBuild blocked this: the pull request says Part of #${issue}, so list under that line what's left of ${open!.task_ref}, as its open items: ${missing.map((q) => `${q.id} (${q.text})`).join('; ')}.`;
  }
  /**
   * A paid check's price, or its run's cost reading, from the tests' file (DEEP_HUB_TEST_PRICES); null, a price nobody
   * knows, without one.
   */
  private priceOf(check: string, of: 'prices' | 'costs' = 'prices'): number | null {
    if (!this.options.prices) return null;
    try {
      const table = (JSON.parse(readFileSync(this.options.prices, 'utf8')) as Obj)[of];
      const usd = isObj(table) ? table[check] : undefined;
      return typeof usd === 'number' && Number.isFinite(usd) && usd >= 0 ? usd : null;
    } catch {
      return null;
    }
  }
  /**
   * A definition just locked (#325; design: One budget): its paid checks priced, and you asked once for the issue's
   * budget, with the total, for one run of each until a week on. A price nobody knows asks nothing: those runs are
   * BLOCKED until priced, never free.
   */
  private async priceLocked(d: { session: string; agent: string; task_ref: string; requirements: { id: string; check: string | null; paid?: PaidKind }[] }): Promise<void> {
    const pricing = await priceDefinition(d.requirements, async (c) => this.priceOf(c.check));
    const n = pricing.checks.length;
    if (!n) return;
    if (pricing.total_usd === null) {
      const unknown = pricing.checks.filter((c) => c.usd === null).map((c) => c.check);
      return this.appendReading(d.session, d.agent, `${d.task_ref}'s paid check${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')} ${unknown.length === 1 ? 'has' : 'have'} no price, so no budget is asked for yet and ${unknown.length === 1 ? 'its runs are' : 'their runs are'} BLOCKED until priced.`);
    }
    const usd = (v: number) => `$${v.toFixed(2)}`;
    const total = usd(pricing.total_usd);
    const ends = this.now() + 7 * DAY;
    const until = new Date(ends).toISOString().slice(0, 10);
    const budget: BudgetInput = { scope: { kind: 'issue', ref: d.task_ref }, runs: n, cap_usd: pricing.total_usd, ends };
    const listed = pricing.checks.map((c) => `${basename(c.check)} (${c.paid}) ${usd(c.usd!)}`).join(', ');
    const question = `${d.task_ref}'s definition locked with ${n} paid check${n === 1 ? '' : 's'}: ${listed}, ${total} in all. Approve a budget of ${total} for ${n === 1 ? 'its run' : `their ${n} runs`} until ${until}?`;
    const key = sha256Hex(canonicalize({ kind: 'budget.issue', task_ref: d.task_ref, budget } as unknown as JsonValue));
    const ask = await this.asks.raise(this.connection('core', { session: d.session, agent: d.agent }), 'budget.issue', {
      kind: 'authority', question, options: [{ id: 'approve', label: `Approve ${total}`, decision: 'allow' }, { id: 'decline', label: "Don't fund them", decision: 'deny' }],
      recommended: null, deadline: this.now() + DAY, fallback: 'you', default: 'decline', provisional: false, owner: 'you', key, pinned_to: { kind: 'evidence', ref: key },
    }, { steps: [{ does: `Approve a budget of ${total} for ${d.task_ref}: ${listed}, until ${until}`, changes: [d.task_ref], undo: null, public: false, cost: pricing.total_usd }], diff: key });
    this.budgetAsks.set(ask, budget);
  }
  /** Your answer to an ask the done gate raised (#325): an issue's budget approved, a stalled claim split, funded or accepted, a switch left off. */
  private delivery(d: Delivery): void {
    if (this.agents.delivered(d.ask, d.option, d.decision)) return;
    if (this.box.delivered(d.ask, d.option)) return;
    const fail = (what: string) => (error: unknown) => process.stderr.write(`deep hub: ${what} for ${d.ask} was not recorded: ${error instanceof Error ? error.message : String(error)}\n`);
    const budget = this.budgetAsks.get(d.ask);
    if (budget) {
      this.budgetAsks.delete(d.ask);
      if (d.decision === 'allow') void this.ledger.approveOn(this.connection('core'), d.ask, budget).catch(fail('the budget'));
      return;
    }
    const stall = this.stallAsks.get(d.ask);
    if (stall) {
      this.stallAsks.delete(d.ask);
      if (d.option === 'split') void this.split(d.ask, stall).catch(fail('the split'));
      // What's proven is accepted: the rest is dropped, and the issue may close.
      else if (d.option === 'accept') this.accepted.add(stall.task);
      // Funded: the send-backs start again from round 1.
      else if (d.option === 'fund') this.stalls.delete(stall.task);
      return;
    }
    const off = this.switchAsks.get(d.ask);
    if (off && d.option === 'stay-off') {
      this.switchAsks.delete(d.ask);
      this.offDecided.add(off.key);
      void this.followUp(d.ask, off).catch(fail('the follow-up'));
    }
  }
  /** The decision the asks core saved from your answer to `ask`, which lands just after the answer is handed on; null when none does. */
  private async decisionOf(ask: string): Promise<string | null> {
    for (let i = 0; i < 30; i++) {
      const [row] = (await this.record.raw(`SELECT id FROM events WHERE kind = 'decision.created' AND json_extract(data, '$.ask') = ? ORDER BY log_pos DESC LIMIT 1`, [ask])) as { id: string }[];
      if (row) return `decision:${row.id}`;
      await new Promise((done) => setTimeout(done, 100));
    }
    return null;
  }
  /**
   * A stalled claim you split (#325): what's proven closes now, and the rest moves to a new issue, drafted with what
   * each item needs. The draft is recorded; nothing is filed for you.
   */
  private async split(ask: string, s: { task: string; session: string; agent: string }): Promise<void> {
    const left = await this.tasks.leftOf(s.task) ?? [];
    const decision = await this.decisionOf(ask);
    const items = left.map((r) => ({ id: r.id, text: r.text, needs: r.check ? `its check ${r.check} to pass${r.paid ? `, a ${r.paid} the issue's budget pays for` : ''}` : 'a check that proves it' }));
    const ts = this.now();
    await this.append(this.connection('core', { session: s.session, agent: s.agent }), {
      v: 1, id: ulid(ts), kind: 'issue.drafted', ts, subject: ask,
      data: {
        task_ref: s.task, issue: s.task, because: 'split', decision, title: `The rest of ${s.task}: ${items.map((i) => i.text).join('; ') || 'nothing left'}`.slice(0, 200), items,
        follow_up: `File this issue for what the split moved out of ${s.task}; ${s.task} closes with what's proven.`,
      },
    });
  }
  /** A switch you decided stays off (#325): the decision is saved with its follow-up, a drafted issue to turn it on. */
  private async followUp(ask: string, off: { name: string; deployed: string; task: string; issue: number; session: string; agent: string }): Promise<void> {
    const decision = await this.decisionOf(ask);
    const ts = this.now();
    await this.append(this.connection('core', { session: off.session, agent: off.agent }), {
      v: 1, id: ulid(ts), kind: 'issue.drafted', ts, subject: ask,
      data: {
        task_ref: off.task, issue: `#${off.issue}`, because: 'switch', decision, title: `Turn ${off.name} on where it's deployed`,
        items: [{ id: off.name, text: `${off.name} is on where it's deployed`, needs: `${off.name} switched on in ${off.deployed}, and #${off.issue}'s checks run again with it on` }],
        follow_up: `Turn ${off.name} on in ${off.deployed} and check #${off.issue}'s change with it on: you decided it stays off for now${decision ? ` (${decision})` : ''}.`,
      },
    });
  }
  /**
   * What keeps a pull request whose requirements all passed at Part of (#325; design: Done means switched on): a
   * release check that hasn't passed on the PR's commit merged with main, and a switch the change adds that's off or
   * unset where it's deployed, until you decide it stays off; you're asked about each such switch once.
   */
  private async deliveryHeld(session: string, issue: number, task: string): Promise<string | undefined> {
    const cwd = this.live.get(session)?.cwd;
    if (!cwd) return undefined;
    const spec = releaseSpec(cwd);
    const instead = `Say Part of #${issue} instead`;
    if (spec.checks.length) {
      const head = (await headOf(cwd).catch(() => undefined))?.sha;
      const merged = head ? await mergedWithMain(cwd, head) : undefined;
      if (merged && 'conflict' in merged) return `DeepBuild blocked this: the pull request can't say Closes #${issue}: ${merged.conflict}, so its release checks (${spec.checks.join(', ')}) can't pass on its merge with main. ${instead}.`;
      if (merged) {
        const rows = (await this.record.raw(`SELECT check_id, outcome FROM runs WHERE commit_sha = ? AND ended IS NOT NULL ORDER BY started`, [merged.commit])) as { check_id: string; outcome: string | null }[];
        const last = new Map(rows.map((r) => [r.check_id, r.outcome]));
        const open = spec.checks.filter((c) => last.get(c) !== 'passed');
        if (open.length) {
          const said = open.map((c) => `${c} ${last.has(c) ? `${last.get(c) ?? 'ended'} there` : 'is still to run there'}`).join('; ');
          return `DeepBuild blocked this: the pull request can't say Closes #${issue} until the repo's release check${open.length === 1 ? '' : 's'} pass${open.length === 1 ? 'es' : ''} on its commit merged with main (${merged.commit.slice(0, 12)}): ${said}. ${instead}; the PR's claim runs ${open.length === 1 ? 'it' : 'them'} there in the slow lane.`;
        }
      }
    }
    if (spec.switches) {
      const [row] = (await this.record.raw(`SELECT base_commit FROM definitions WHERE task_ref = ? LIMIT 1`, [task])) as { base_commit: string | null }[];
      const base = row?.base_commit;
      if (base) {
        const off = (await switchesOff(cwd, base, spec.switches)).filter((w) => !this.offDecided.has(`${cwd}\0${w.name}`));
        if (off.length) {
          for (const w of off) await this.askSwitch(session, cwd, task, issue, w, spec.switches.deployed).catch(() => undefined);
          const named = off.map((w) => `${w.name} (${w.state === 'off' ? 'off' : 'unset'} in ${spec.switches!.deployed})`).join(' and ');
          return `DeepBuild blocked this: the pull request can't say Closes #${issue} while the change ships behind ${named}, until you decide ${off.length === 1 ? 'it stays' : 'they stay'} off; you're asked in your inbox. ${instead}.`;
        }
      }
    }
    return undefined;
  }
  /** Asks you once whether a switch the change adds stays off where it's deployed (#325). */
  private async askSwitch(session: string, cwd: string, task: string, issue: number, w: { name: string; state: 'off' | 'unset' }, deployed: string): Promise<void> {
    const key = `${cwd}\0${w.name}`;
    if ([...this.switchAsks.values()].some((a) => a.key === key)) return;
    const agent = this.live.get(session)?.agent ?? 'claude-code';
    const question = `The change for #${issue} ships behind ${w.name}, which is ${w.state === 'off' ? 'off' : 'unset'} where it's deployed (${deployed}). Does it stay off for now? Then the pull request may say Closes, with a follow-up to turn ${w.name} on.`;
    const ask = await this.asks.raise(this.connection('core', { session, agent }), 'switch.off', {
      kind: 'exception', question,
      options: [{ id: 'stay-off', label: `${w.name} stays off: close it with a follow-up to turn it on`, decision: 'none' }, { id: 'not-yet', label: "Keep the pull request at Part of until it's on", decision: 'none' }],
      recommended: 'stay-off', deadline: this.now() + 2 * DAY, fallback: 'you', default: 'not-yet', provisional: false, owner: 'you',
      key: sha256Hex(canonicalize({ kind: 'switch.off', cwd, name: w.name })), pinned_to: await this.pinOf(cwd, question),
    });
    this.switchAsks.set(ask, { key, name: w.name, deployed, task, issue, session, agent });
  }
  /**
   * A stop that would be sent back, against its task's count toward a stalled claim (#325; design: Stalled claims): sent
   * back as round n of 3, or not, once the open items came back unchanged on two stops in a row or three send-backs
   * passed without new evidence, when the claim becomes one decision for you. While a question holds the send-back
   * the stop isn't sent back and counts toward neither. What the stop is sent back with, or nothing.
   */
  private async stallGate(meta: HookMeta, claim: string, sendBack: string | undefined): Promise<string | undefined> {
    const [row] = (await this.record.raw(`SELECT subject_ref FROM claims WHERE id = ?`, [claim.slice(6)])) as { subject_ref: string | null }[];
    const task = row?.subject_ref;
    if (!task) return sendBack;
    const standing = this.gate.standing(claim);
    if (!sendBack) {
      // A green claim starts the count again.
      if (standing.length && standing.every((c) => c.result === 'PASS')) this.stalls.delete(task);
      return undefined;
    }
    const held = await this.questionHolds(meta.session);
    // The planted wrong program counts the stops a question holds, though it still doesn't send them back.
    if (held && this.options.plant !== 'counts-waiting-stops') return undefined;
    const items = [...standing.filter((c) => c.result !== 'PASS').map((c) => `${c.check}: ${c.result}`), ...leftOpen(this.lastMessage.get(meta.session) ?? '').map((o) => o.text)];
    const runs = ((await this.record.raw(`SELECT id FROM runs WHERE claim_id = ?`, [claim.slice(6)])) as { id: string }[]).map((r) => r.id);
    let count = this.stalls.get(task);
    if (!count) this.stalls.set(task, count = freshCount());
    // The planted wrong program counts any new run as new evidence, whatever its result.
    const fate = judgeStop(count, { items, passing: standing.filter((c) => c.result === 'PASS').map((c) => c.check), runs }, this.options.plant === 'new-run-is-evidence');
    if (fate.sendBack) {
      if (held) return undefined;
      const [verdict] = (await this.record.raw(`SELECT handle FROM verdicts WHERE claim_id = ? ORDER BY created DESC LIMIT 1`, [claim.slice(6)])) as { handle: string | null }[];
      const ts = this.now();
      if (verdict?.handle) await this.append(this.connection('core', { session: meta.session, agent: meta.agent }), { v: 1, id: ulid(ts), kind: 'claim.sent_back', ts, subject: claim, data: { claim, verdict: verdict.handle, round: fate.round, to: `session:${letters(meta.session)}` } });
      return sendBack;
    }
    if (fate.stalled) await this.stalled(meta, claim, task, fate.stalled);
    return undefined;
  }
  /** The session's newest claim's line as it stands, when a question holds its send-back; undefined otherwise. */
  private async lineStanding(session: string): Promise<string | undefined> {
    if (!await this.questionHolds(session)) return undefined;
    const claim = this.live.get(session)?.claim ?? await newestClaim(this.raw, session).then((id) => (id ? `claim:${id}` : undefined));
    const state = claim ? await this.stateOf(claim) : undefined;
    return state ? this.heldLine(session, verdictLine(state.state)) : undefined;
  }
  /** A line while a question holds the send-back: the session wasn't sent back, so it names the FAIL and that the next step is yours. */
  private async heldLine(session: string, line: string): Promise<string> {
    return await this.questionHolds(session) ? line.replace(/^sent back \d+\/\d+/, 'FAIL').replace(/\bnext: agent\b/, 'next: you') : line;
  }
  /** The requirements of a session's open ask-tasks, as a definition locked them: what a question can name. */
  private async requirementsOf(session: string): Promise<{ id: string; text: string }[]> {
    const rows = (await this.record.raw(`SELECT requirements FROM definitions WHERE task_ref IN (SELECT subject_ref FROM claims WHERE session_id = ?) OR task_ref IN (SELECT j.value FROM events e, json_each(e.data, '$.tasks') j WHERE e.session_id = ? AND e.kind = 'user.ask')`, [session, session])) as { requirements: string | null }[];
    return rows.flatMap((r) => (JSON.parse(r.requirements ?? '[]') as { id: string; text: string }[]).map((q) => ({ id: q.id, text: q.text })));
  }
  /** The newest verdict's smallest failing case for a claim, in words for the reply that carries it. */
  private async smallestOf(claim: string): Promise<string | undefined> {
    await this.verdictWrites.get(claim)?.catch(() => undefined);
    const [row] = (await this.record.raw(`SELECT smallest, requirements FROM verdicts WHERE claim_id = ? ORDER BY created DESC LIMIT 1`, [claim.slice(6)])) as { smallest: string | null; requirements: string | null }[];
    const failing = (JSON.parse(row?.requirements ?? '[]') as { outcome?: string; smallest?: string }[]).find((q) => q.outcome === 'FAIL' && q.smallest)?.smallest ?? row?.smallest;
    return failing ? `Its smallest failing case: ${failing}` : undefined;
  }
  /** The recommended options of the provisional asks the session has open, as the reply that goes on with them says it. */
  private async provisionalCarried(session: string): Promise<string | undefined> {
    const rows = (await this.record.raw(`SELECT id, options, recommended FROM asks WHERE session_id = ? AND status IN ('open', 'later') AND provisional = 1`, [session])) as { id: string; options: string | null; recommended: string | null }[];
    const said = rows.map((r) => `ask:${r.id} goes on with ${(JSON.parse(r.options ?? '[]') as { id: string; label: string }[]).find((o) => o.id === r.recommended)?.label ?? r.recommended}, marked as undoable`);
    return said.length ? `DeepBuild: ${said.join('; ')}.` : undefined;
  }
  /** What a session really has, for the could-the-agent-do-it check (#84): its servers' tools and what it leases. */
  private async reachOfSession(session: string): Promise<Reach> {
    const lists = (await this.record.raw(`SELECT data FROM events WHERE session_id = ? AND kind = 'mcp.tools_listed'`, [session])) as { data: string }[];
    const cwd = this.sessions.get(session)?.cwd ?? '';
    const tools = lists.flatMap((l) => {
      const { server, tools: listed } = JSON.parse(l.data) as { server: string; tools: { name: string }[] };
      return listed.map((t): ReachTool => ({ name: `mcp__${server}__${t.name}`, kind: /computer/.test(server) ? 'computer' : 'mcp', connector: server, read_only: countMcp(server, t.name, cwd).counts === 'read' }));
    });
    const leases = (await this.leases.leases()).filter((v) => v.lease.holder === `mcp:${session}`);
    const profiles = leases.filter((v) => v.lease.resource.kind === 'browser-profile').map((v) => { const [provider = '', profile = ''] = v.lease.resource.key.split(':'); return { profile, provider, leased: true }; });
    return reachOf({ tools, profiles, credentials: await this.extensions?.heldSecrets().catch(() => []) ?? [] });
  }
  /**
   * Whether a question holds a session's send-back (#325; design: A question holds the send-back): a step only you can
   * take, an exception, or a taste call or choice that isn't provisional, open, or answered and not yet delivered.
   */
  private async questionHolds(session: string): Promise<boolean> {
    // The planted wrong programs: one gate never holds, the other holds for every ask, authority and provisional too.
    if (this.options.plant === 'sends-back-held-stop' || this.options.plant === 'hold-as-choice') return false;
    if (this.options.plant === 'holds-every-ask') return (await this.record.raw(`SELECT 1 FROM asks WHERE session_id = ? AND status IN ('open', 'later') LIMIT 1`, [session])).length > 0;
    const asks = (await this.record.raw(`SELECT key FROM asks WHERE session_id = ? AND status IN ('open', 'later', 'answered') AND id NOT IN (SELECT delivery FROM deliveries WHERE outcome = 'delivered')
      AND (kind IN ('unblock', 'exception') OR (kind IN ('taste', 'choice') AND provisional = 0))`, [session])) as { key: string }[];
    if (!asks.length) return false;
    // Size and scope's own asks (#324) are DeepBuild's readings, not a question the agent left: they hold no send-back.
    const sized = await this.sizing.keysIn(session);
    return asks.some((a) => !sized.has(a.key));
  }
  /**
   * The stop of a turn that opened the pull request your ask asked for (#82): the words that keep the agent working on
   * the requirements still unmet in that same pull request, or null when none is unmet or your ask says the pull
   * request ends the work. Undefined for any other stop.
   */
  private async prDelivery(judged: Live): Promise<string | null | undefined> {
    const pr = judged.prOpened;
    if (!pr || !judged.turnAsk || !judged.claim) return undefined;
    const [ask] = (await this.record.raw(`SELECT json_extract(data, '$.text') AS text FROM events WHERE id = ? AND kind = 'user.ask'`, [judged.turnAsk])) as { text: string | null }[];
    const text = ask?.text ?? '';
    if (!/\b(?:pull request|PR)\b/i.test(text)) return undefined;
    const open = this.openRequirements(judged.claim);
    if (!open.length || /\b(?:ends? the work|stop there|then stop|and stop)\b/i.test(text)) return null;
    return `DeepBuild: ${pr} is open as Part of its issue, with ${open.join(', ')} still unmet. Keep working on ${open.length === 1 ? 'it' : 'them'} in the same pull request: push to its branch, open no new one.`;
  }
  /**
   * What each requirement of a claim whose verdict is pending or INCONCLUSIVE still waits for (#82): a run of its
   * check, or your answer where no check covers it; nothing for one passed or failed.
   */
  private needsOf(claim: string): string[] {
    const v = this.gate.verdictOf(claim);
    const named = this.claimRequirements.get(claim);
    if (!v || !named) return [];
    const standing = this.gate.standing(claim);
    return v.requirements.filter((q) => q.outcome === 'pending' || q.outcome === 'INCONCLUSIVE').flatMap((q) => {
      const n = named.get(q.req);
      if (!n) return [];
      const on = standing.filter((c) => c.covers.includes(q.req) && c.result !== 'PASS');
      return [`${n.id} ("${n.text}") waits for ${on.length ? on.map((c) => `${c.result === 'INCONCLUSIVE' ? 'another run' : 'a run'} of ${c.check}`).join(' and ') : 'your answer'}`];
    });
  }
  /** Records what a claim the stop let through still needs, as open items of its task (#82). */
  private async stillNeeded(meta: HookMeta, claim: string): Promise<void> {
    const needs = this.needsOf(claim);
    if (!needs.length) return;
    const [row] = (await this.record.raw(`SELECT subject_ref FROM claims WHERE id = ?`, [claim.slice(6)])) as { subject_ref: string | null }[];
    if (row?.subject_ref) await this.openItems.stillNeeded({ session: meta.session, agent: meta.agent, task: row.subject_ref, cwd: meta.cwd }, needs);
  }
  /** The requirements of a claim its standing checks haven't all passed, by ID and text; else its checks not passed. */
  private openRequirements(claim: string): string[] {
    const standing = this.gate.standing(claim);
    const passed = (req: string) => { const on = standing.filter((c) => c.covers.includes(req)); return on.length > 0 && on.every((c) => c.result === 'PASS'); };
    const reqs = [...(this.claimRequirements.get(claim) ?? [])].filter(([req]) => !passed(req)).map(([, q]) => `${q.id} ("${q.text}")`);
    return reqs.length ? reqs : standing.filter((c) => c.result !== 'PASS').map((c) => c.check);
  }
  /**
   * A judged stop's completion prompt (#82; design: Every stop is judged): when its final message is empty or says
   * nothing and a requirement of its claim is still open, the prompt naming them, with the send-back's failing case
   * when there is one; at the fourth such stop in a row, the claim stalls and the prompt is null. Undefined for a stop
   * that said something or left nothing open, which also starts the count again.
   */
  private async completion(meta: HookMeta, claim: string, sendBack: string | undefined): Promise<string | null | undefined> {
    if (!endsEmpty(meta.fields?.last_assistant_message ?? '')) { this.completions.delete(meta.session); return undefined; }
    const open = this.openRequirements(claim);
    if (!open.length) { this.completions.delete(meta.session); return undefined; }
    const n = (this.completions.get(meta.session) ?? 0) + 1;
    this.completions.set(meta.session, n);
    if (n > COMPLETION_PROMPTS) {
      const [row] = (await this.record.raw(`SELECT subject_ref FROM claims WHERE id = ?`, [claim.slice(6)])) as { subject_ref: string | null }[];
      if (n === COMPLETION_PROMPTS + 1 && row?.subject_ref) await this.stalled(meta, claim, row.subject_ref, 'four stops in a row did work and ended on an empty message');
      return null;
    }
    const prompt = `DeepBuild: this turn did work but ended on an empty message, with ${open.join(', ')} still open. Go on with the work, or end the turn saying what you did and what's still open (completion prompt ${n} of ${COMPLETION_PROMPTS}).`;
    return sendBack ? `${sendBack}\n\n${prompt}` : prompt;
  }
  /** Whether this stop, with no work in it, is its claim's ask's one send-back (#82): true once per ask until work is done again. */
  private async noWorkOnce(session: string, claim: string): Promise<boolean> {
    if (this.live.get(session)?.idle !== true || this.options.plant === 'no-work-never-sent-back') return false;
    const [row] = (await this.record.raw(`SELECT subject_ref FROM claims WHERE id = ?`, [claim.slice(6)])) as { subject_ref: string | null }[];
    const sent = this.idleSent.get(session) ?? new Set<string>();
    if (!row?.subject_ref || sent.has(row.subject_ref)) return false;
    this.idleSent.set(session, sent.add(row.subject_ref));
    return true;
  }
  /**
   * What a stop that isn't sent back on its checks is sent on with (#82; design: Every stop is judged): after the app's
   * own resume prompt, when the interrupted turn had done work and asks are open, one automatic continue; a stop with
   * no work that isn't an answer, leaving an ask open, one send-back naming the requirements still unmet per ask, and
   * after it the ask's row says the session is idle with it open. Undefined for any other stop.
   */
  private async idleOrResumed(meta: HookMeta, judged: Live | undefined, sentBack: boolean): Promise<string | undefined> {
    const live = this.live.get(meta.session);
    if (!live) return undefined;
    const resumed = live.resumed === true;
    live.resumed = false;
    // A stop sent back on its checks needs no other push, and a question that holds the send-back holds this too.
    if (sentBack || await this.questionHolds(meta.session)) return undefined;
    // The planted wrong program drops the send-back of every stop with no work in it.
    const idle = live.idle === true && this.options.plant !== 'no-work-never-sent-back';
    if (!resumed && !idle) {
      if (judged) { this.idleSent.delete(meta.session); this.nudgeable.add(meta.session); }
      return undefined;
    }
    const open = await this.tasks.stillOpen(meta.session);
    if (!open.length) { this.nudgeable.delete(meta.session); this.askingSoon(); return undefined; }
    const named = (left: { id: string; text: string }[]) => left.map((q) => `${q.id} ("${q.text}")`).join(', ');
    if (resumed && live.cutOff) {
      live.cutOff = false;
      // The continue is the one push its asks get: a later stop with no work isn't sent back on them.
      this.idleSent.set(meta.session, new Set(open.map((o) => o.task_ref)));
      const asks = open.map((o) => `${o.task_ref}: ${named(o.left)}`).join('; ');
      return `DeepBuild: the app restarted while this session was working, with ${asks} still unmet. Continue where you left off; this is its one automatic continue.`;
    }
    if (!idle) return undefined;
    const sent = this.idleSent.get(meta.session) ?? new Set<string>();
    this.idleSent.set(meta.session, sent);
    const due = open.filter((o) => !sent.has(o.task_ref));
    if (!due.length) {
      this.nudgeable.delete(meta.session);
      this.askingSoon();
      await this.appendReading(meta.session, meta.agent, `The session is idle with ${open.map((o) => o.task_ref).join(', ')} open.`).catch(() => undefined);
      return undefined;
    }
    for (const o of due) sent.add(o.task_ref);
    return `DeepBuild: this stop did no work, and ${due.map((o) => `${o.task_ref} still has ${named(o.left)} unmet`).join('; ')}. Work on ${due.length === 1 ? 'it' : 'them'}, or say what keeps you from it.`;
  }
  /** A claim that stalled (#325): recorded, and one decision for you instead of another send-back: split the issue, fund the live runs, or accept what's proven. */
  private async stalled(meta: HookMeta, claim: string, task: string, rule: StallRule): Promise<void> {
    const core = this.connection('core', { session: meta.session, agent: meta.agent });
    const ts = this.now();
    await this.append(core, { v: 1, id: ulid(ts), kind: 'claim.stalled', ts, subject: claim, data: { claim, rule } });
    const left = await this.tasks.leftOf(task) ?? [];
    const named = left.length ? left.map((r) => `${r.id} ("${r.text}")`).join(', ') : 'its open items';
    const question = `The claim on ${task} stalled: ${rule} and no new passing evidence, with ${named} still open, so DeepBuild stopped sending the agent back. Split the issue (what's proven closes now, and the rest moves to a new issue with what each item needs), fund the live runs it needs, or accept what's proven?`;
    const ask = await this.asks.raise(core, 'claim.stalled', {
      kind: 'exception', question,
      options: [{ id: 'split', label: "Split the issue: what's proven closes now", decision: 'none' }, { id: 'fund', label: 'Fund the live runs it needs', decision: 'none' }, { id: 'accept', label: "Accept what's proven", decision: 'none' }],
      recommended: 'split', deadline: this.now() + 2 * DAY, fallback: 'you', default: 'split', provisional: false, owner: 'you',
      key: sha256Hex(canonicalize({ kind: 'claim.stalled', task, claim })), pinned_to: await this.pinOf(meta.cwd, question),
    });
    this.stallAsks.set(ask, { task, session: meta.session, agent: meta.agent });
    await this.appendReading(meta.session, meta.agent, `${claim} stalled (${rule}), so it isn't sent back again: it reaches you as one decision, ${ask}.`).catch(() => undefined);
  }
  /** The requirements a split moved to a new issue, by ID, from the record. */
  private async movedOut(task: string): Promise<Set<string>> {
    const rows = (await this.record.raw(`SELECT data FROM events WHERE kind = 'issue.drafted' AND json_extract(data, '$.task_ref') = ? AND json_extract(data, '$.because') = 'split'`, [task])) as { data: string }[];
    return new Set(rows.flatMap((r) => (JSON.parse(r.data) as { items: { id: string }[] }).items.map((i) => i.id)));
  }
  /**
   * A pull request's claim runs the repo's release checks on the PR's commit merged with main (#325): each as a spec
   * check pinned to that commit, in the slow lane, once per head; one that can't merge fails, naming the conflict.
   */
  private async releaseChecks(cwd: string, head: string): Promise<ClaimCheck[]> {
    const names = releaseSpec(cwd).checks;
    if (!names.length || !/^[0-9a-f]{40}$/.test(head) || /^0+$/.test(head)) return [];
    const merged = await mergedWithMain(cwd, head);
    if (!merged) return [];
    const checks = this.checksOf(cwd);
    return names.flatMap((name) => {
      const check = checks.get(name);
      if (!check) return [];
      const deadline = check.deadline === undefined ? undefined : duration(check.deadline as JsonValue);
      const conflict = 'conflict' in merged ? merged.conflict : undefined;
      const command = conflict ? `printf '%s\\n' '${conflict.replaceAll("'", "'\\''")}' >&2; exit 1` : check.run;
      return [{ check: name, approved: null, command, covers: [], depth: 'unit' as const, on_base: 'passes' as const, asserts: [], source: 'spec' as const, commit: 'commit' in merged ? merged.commit : head, ...(deadline ? { deadline_ms: deadline } : {}) }];
    });
  }
  /** The session is on `display` once its switch ran, if that is a screen it leases. */
  private async switched(session: string, display: string): Promise<void> {
    const leased = (await this.leases.leases()).some((v) => v.lease.holder === `mcp:${session}` && v.lease.resource.kind === 'screen' && v.lease.resource.key === display);
    if (leased) this.onScreen.set(session, display);
  }
  /**
   * Why a computer-use or Chrome step is denied, or nothing when it acts on what its session leases (#332): a switch
   * to a screen it leases, an app whose window it leases, and any other step on the leased screen it last switched
   * to. Claude in Chrome, a session that leases no screen, a step naming another, and one before any switch are
   * denied, so your own screen, your browser and their windows are never touched.
   */
  private async offScreen(session: string, action: string, input: Record<string, unknown>): Promise<string | undefined> {
    const holder = `mcp:${session}`;
    const mine = (await this.leases.leases()).filter((v) => v.lease.holder === holder && v.lease.resource.host === 'local');
    const keys = (kind: string) => mine.filter((v) => v.lease.resource.kind === kind).map((v) => v.lease.resource.key);
    const screens = keys('screen');
    const windows = keys('window');
    const leased = screens.length ? `it leases ${screens.join(', ')}` : 'it leases no screen; deep env up leases one when the environment names a screen pool';
    const why = (what: string) => `DeepBuild blocked this: computer use acts only on a screen and windows its session leases, so your own are never touched. This step ${what}, and ${leased}${windows.length ? ` and the windows of ${windows.join(', ')}` : ''}.`;
    // Claude in Chrome acts in your own Chrome profile, with your sign-ins, which no window lease covers.
    if (action.startsWith(CHROME)) return why('acts in your own Chrome, which no lease covers');
    if (/(^|_)switch_display$/.test(action)) {
      const display = String(input.display ?? '');
      // The screen counts as the session's once the switch has run (`switched`), never on the asking alone.
      return screens.includes(display) ? undefined : why(`switches to ${display || 'a screen it doesn\'t name'}`);
    }
    const current = this.onScreen.get(session);
    if (current === undefined || !screens.includes(current)) return why('acts on the screen the session is on, which it hasn\'t switched to a leased one');
    // Your clipboard is yours whichever screen a session is on.
    if (/clipboard/.test(action) || input.clipboardRead || input.clipboardWrite) return why('acts on your clipboard, which no lease covers');
    if (input.systemKeyCombos) return why('asks for key combos that act on your whole machine');
    // Any step naming apps, granting, teaching or opening them, names only apps whose windows it leases.
    const apps = [...(input.app === undefined ? [] : [input.app]), ...(Array.isArray(input.apps) ? input.apps : [])];
    if (!apps.length && /(^|_)(open_application|request_access|request_teach_access)$/.test(action)) return why('names no app');
    const off = apps.find((app) => typeof app !== 'string' || !windows.includes(app));
    if (off !== undefined) return why(`acts on the window of ${typeof off === 'string' ? off : JSON.stringify(off)}, which it doesn't lease`);
    return undefined;
  }

  /**
   * A permission prompt (#23): answered through the hook only from a saved decision that covers it, logged as decided
   * for you. One no decision covers opens no ask: the agent's own prompt asks you in the terminal (#18), and once the
   * call you said yes to runs it is offered back as a decision you save with one click (`deep inbox save`).
   */
  async permission(meta: HookMeta, until = 0, inPaseo = false): Promise<{ decision: 'allow' | 'deny' | 'none'; because?: string }> {
    await this.ready;
    if (FOREIGN.has(meta.agent) || !meta.session || !meta.call) return { decision: 'none' };
    const tool = aboutPermission(meta.call.tool, meta.call.input);
    // A request paseo calls `other` is never one a saved decision answers: it asks you (#55).
    const about = meta.paseo?.kind === 'other' ? { ...tool, subject: { ...tool.subject, target: { ...tool.subject.target, kind: `other:${meta.call.tool}`, owner: `other:${tool.subject.target.owner}` } } } : tool;
    // A prompt shown in paseo, not in a terminal, is asked here: there is no dialog of the agent's own to draw it (#55).
    const shown = meta.agent === 'paseo' || inPaseo || this.inPaseo.has(meta.session);
    if (!shown && !(await this.covered(meta.session, about))) {
      this.pending.set(`${meta.session}|${about.subject.target.owner}`, { meta, about });
      return { decision: 'none' };
    }
    const asked = await this.holds.asked(meta, about);
    this.prompts.add(asked.ask);
    if (asked.decision) return { decision: asked.option === 'approve' ? 'allow' : 'deny', because: asked.decision };
    if (shown) {
      if (meta.paseo?.request) this.paseoRequests.set(`${meta.session}|${meta.paseo.request}`, asked.ask);
      const answer = await new Promise<Delivery | undefined>((done) => {
        const timer = setTimeout(() => { this.permits.delete(asked.ask); done(undefined); }, Math.max(0, until - Date.now()));
        timer.unref();
        this.permits.set(asked.ask, (delivery) => { clearTimeout(timer); this.permits.delete(asked.ask); done(delivery); });
      });
      return { decision: !answer ? 'none' : answer.option === 'approve' ? 'allow' : 'deny' };
    }
    // The core's gate refused what looked covered, as when two decisions disagree: the prompt goes to you, and its ask with it.
    const ts = this.now();
    await this.append(this.connection('core', { session: meta.session, agent: meta.agent }), { v: 1, id: ulid(ts), kind: 'ask.cancelled', subject: asked.ask, ts, data: { answer: 'decline', plan_hash: null, decision: 'none' } });
    return { decision: 'none' };
  }
  /**
   * Who gates a session paseo's plugin sends a line for (#55): the adapter that bound its session ID first, deep-hook
   * or the pi package, or null when that is the plugin. Its MCP server's token binds to the session either way.
   */
  paseoOwner(meta: HookMeta): Promise<string | null> {
    return this.queue(async () => {
      if (meta.paseo?.bind && meta.session) this.binds.set(meta.paseo.bind, meta.session);
      const session = this.sessions.get(meta.session);
      const owner = session && session.agent !== 'paseo' ? session.agent : null;
      if (owner) this.inPaseo.add(meta.session);
      return owner;
    });
  }
  /**
   * A permission request someone answered in paseo's own app (#55): no answer to DeepBuild's ask, which stays open,
   * since an answer with authority counts only on the trusted path or with a paired phone's verified signature.
   */
  async paseoAppAnswer(meta: HookMeta): Promise<Obj> {
    const ask = meta.paseo?.request ? this.paseoRequests.get(`${meta.session}|${meta.paseo.request}`) : undefined;
    if (!ask || !this.permits.has(ask)) return {};
    await this.queue(() => this.appendReading(meta.session, meta.agent, `An answer to ${ask} came from paseo's app with no verified device signature, so DeepBuild refused it and ${ask} stays open: an answer with authority counts only on the trusted path (the DeepBuild app, deep inbox answer once the OS confirms you, or a paired phone that signs).`)).catch(() => undefined);
    return { refused: 'trusted path', ask };
  }
  /** Whether a saved decision covers what a prompt is about, asked of resolver-decisions with nothing raised. */
  private async covered(session: string, about: About): Promise<boolean> {
    const options = [{ id: 'approve', label: about.options[0], decision: 'allow' as const }, { id: 'decline', label: about.options[1], decision: 'deny' as const }];
    const key = subjectKey({ kind: 'authority', subject: about.subject, options } as unknown as Parameters<typeof subjectKey>[0], '');
    const answer = await this.precheck({
      ask: 'ask:0', kind: 'authority', options, plan: null, words: [], changed: null, folded: [], undo: false, cost_usd: null, suggested: null, conflict: [],
      needs_person: [], budget: null, missing: null, targets: [], session, key, repo: this.projects.get(session) ?? null, subject: about.subject,
    });
    return answer !== undefined && !answer.also?.length;
  }
  /** A call whose prompt no decision covered has run: you said yes in the terminal, so it is offered back to save. */
  private async offerBack(meta: HookMeta): Promise<void> {
    // The prompt and the call that ran are matched by session and call: a prompt's payload names no tool_use_id.
    const key = `${meta.session}|${aboutPermission(meta.call!.tool, meta.call!.input).subject.target.owner}`;
    const pending = this.pending.get(key);
    if (!pending) return;
    this.pending.delete(key);
    const project = this.projects.get(meta.session);
    const handle = `offer:${ulid(this.now())}`;
    this.offers.set(handle, { ...pending, scope: project ? `repo:${project}` : `session:${letters(meta.session)}` });
    // The typed-saves-decision plant, when your words came in before the call's run did.
    if (this.options.plant === 'typed-saves-decision' && this.typedAt.has(meta.session)) await this.typedSaves(meta.session);
  }
  /** The typed-saves-decision plant: words you type in the session save what it offers back, with no click. */
  private async typedSaves(session: string): Promise<void> {
    for (const [handle, offer] of [...this.offers]) if (offer.meta.session === session) await this.saveOffer(handle, this.connection('cli'));
  }
  /** The offers still open: each one no saved decision covers yet. */
  private async openOffers(): Promise<Obj[]> {
    const open: Obj[] = [];
    for (const [offer, o] of this.offers) {
      if (await this.covered(o.meta.session, o.about)) this.offers.delete(offer);
      else open.push({ offer, session: o.meta.session, command: o.about.subject.target.ref, scope: o.scope });
    }
    return open;
  }
  /** offers/:id/save, from the app or `deep inbox save`: your one click, once the trusted path allows it, saves the offered permission for its repo. */
  private async saveOffered(params: Obj, context: CallContext): Promise<Obj> {
    const handle = params.offer;
    if (typeof handle !== 'string' || !/^offer:[0-9A-Za-z]+$/.test(handle)) throw new Refused(refusal('handle_syntax', '/params/offer', 'Name the offer by its handle, offer:<id>, as deep inbox lists it.', handle));
    const offer = this.offers.get(handle);
    if (!offer) throw new Refused(refusal('not_found', '/params/offer', `No offer ${handle}; save one deep inbox lists.`, handle));
    await this.trusted('offer.save', params, context, `save “${offer.about.subject.target.ref.slice(0, 120)}” as a decision for ${offer.scope}`, handle, offer.scope);
    return this.saveOffer(handle, this.connection(context.role === 'app' ? 'app' : 'cli'));
  }
  /** The offer saved: its permission raised as an authority ask and answered yes on the trusted path, which saves it for the repo. */
  private async saveOffer(handle: string, as: Connection): Promise<Obj> {
    const offer = this.offers.get(handle)!;
    this.offers.delete(handle);
    const asked = await this.holds.asked(offer.meta, offer.about);
    // Its answer is yours, given here: nothing is delivered to the session.
    this.prompts.add(asked.ask);
    if (!asked.decision) await this.asks.answer(as, asked.ask, { option: 'approve', plan_hash: (await this.asks.card(asked.ask)).plan?.hash ?? null, token: `os-confirm:${ulid(this.now())}` }).catch((error: unknown) => { throw asRefused(error); });
    await this.syncStanding().catch(() => undefined);
    const [saved] = (await this.record.raw(`SELECT id, data FROM events WHERE kind = 'decision.created' AND subject = ? ORDER BY log_pos DESC LIMIT 1`, [asked.ask])) as { id: string; data: string }[];
    return { offer: handle, ask: asked.ask, decision: saved ? `decision:${saved.id}` : asked.decision ?? null, scope: saved ? String((JSON.parse(saved.data) as Obj).scope) : offer.scope };
  }

  /** The past taste decisions `said` names a screen for that this session wasn't given since it started (#111). */
  private async tasteAt(session: string, cwd: string, said: string, starting: boolean): Promise<string | undefined> {
    const given = starting ? new Set<string>() : this.tasted.get(session) ?? new Set<string>();
    this.tasted.set(session, given);
    const fresh = (await tastesFor(this.raw, repoOf(cwd), said)).filter((t) => !given.has(t.ask));
    for (const t of fresh) given.add(t.ask);
    return tasteBlock(fresh);
  }
  /** `deep memory`'s list (#111). */
  private async lessons(): Promise<Lesson[]> {
    const lessons = [...await lessonsOf(this.raw, await repoFolders(this.record, this.store)), ...await this.ruleLessons()];
    return lessons.map((l, i) => ({ ...l, rank: i + 1 }));
  }

  // ---- Your rules (#344): the rules page, the start slice's rules, rules you type, scoped notices and held rule lines.
  private filesOf(repo: string): RuleFile[] {
    return cachedRuleFiles(this.ruleFiles, repo);
  }
  /** The rules you typed, in force: base changes to `rule:typed<id>`. */
  private async typedRules(): Promise<{ target: string; text: string }[]> {
    const rows = (await this.record.raw(`SELECT target, diff FROM learned_layer WHERE kind IN ('learn.applied', 'learn.widened') AND state = 'applied' AND layer = 'base' AND target LIKE 'rule:typed%' ORDER BY log_pos`)) as { target: string; diff: string }[];
    return rows.map((r) => ({ target: r.target, text: r.diff.replace(/^\+ /, '') }));
  }
  /** The rule lines an agent's edit removed, still in force; each leaves once you apply the proposal it became. */
  private async heldRules(): Promise<Held[]> {
    const held = readHeld(this.root.dir);
    const kept: Held[] = [];
    for (const h of held) {
      const [answer] = (await this.record.raw(`SELECT json_extract(data, '$.answer') AS answer FROM events WHERE kind = 'ask.answered' AND subject = ? ORDER BY log_pos DESC LIMIT 1`, [h.ask])) as { answer: unknown }[];
      if (answer?.answer !== 'apply') kept.push(h);
    }
    if (kept.length !== held.length) saveHeld(this.root.dir, kept);
    return kept;
  }
  /** Every rule on the page: each repo a session worked in, your user-level files and the rules you typed. */
  private async allRules(guards: readonly { name: string; rule: string }[]): Promise<{ rules: Rule[]; files: RuleFile[] }> {
    // The record's sessions, and the ones whose hooks reached the hub but aren't folded into it yet.
    const worktrees = [...((await this.record.raw('SELECT DISTINCT worktree FROM sessions WHERE worktree IS NOT NULL')) as { worktree: string }[]).map((w) => w.worktree), ...[...this.routes.values()].map((r) => r.cwd)];
    const repos = [...new Set(worktrees.map((w) => repoRoot(w)).filter((r): r is string => r !== undefined))].sort();
    const files = [...repos.flatMap((repo) => readRuleFiles(repo, null)), ...readRuleFiles(undefined)];
    return { rules: rulesOf({ files, typed: await this.typedRules(), held: await this.heldRules(), guards }), files };
  }
  /** What the start slice gives a session of your rules: every rule for all paths but the files its own agent reads, then the slice's entries. */
  private async startSet(session: string, cwd: string, agent: string): Promise<{ handles: string[]; lines: Map<string, string> }> {
    const repo = repoRoot(cwd);
    const own = agent === 'codex' ? 'codex' : 'claude-code';
    const lines = new Map<string, string>();
    for (const r of rulesOf({ files: [...(repo ? this.filesOf(repo) : []), ...readRuleFiles(undefined)], typed: [], held: await this.heldRules(), guards: [] })) {
      if (r.scope === 'all' && r.native !== own) lines.set(ruleHandle(r), r.text);
    }
    for (const e of await this.record.startSlice(session)) lines.set(e.target, e.text);
    return { handles: [...lines.keys()], lines };
  }
  private ruleStateOf(session: string) {
    let st = this.ruleState.get(session);
    if (!st) this.ruleState.set(session, (st = { given: new Set(), full: false, editing: new Map() }));
    return st;
  }
  /** The record of what a session was given, at the log position its rules and start slice were read at. */
  private async delivered(session: string, via: 'start' | 'prompt' | 'notice', rules: string[]): Promise<void> {
    const [row] = (await this.record.raw('SELECT COALESCE(MAX(log_pos), 0) AS pos FROM events')) as { pos: number }[];
    const ts = this.now();
    await this.append(this.connection('core', { session }), { v: 1, id: ulid(ts), kind: 'session.rules_delivered', ts, subject: `session:${letters(session)}`, data: { via, pos: Number(row?.pos ?? 0), rules } });
  }
  /** At a session's start: its rules, first; after a compaction or a resume its next prompt carries every rule you typed, and a scoped rule is heard once more. */
  private async startRules(meta: HookMeta): Promise<Piece[] | undefined> {
    const st = this.ruleStateOf(meta.session);
    const set = await this.startSet(meta.session, meta.cwd, meta.agent);
    st.given = new Set(set.handles);
    await this.delivered(meta.session, 'start', set.handles);
    return set.lines.size ? rulePieces(RULES_HEAD, [...set.lines]) : undefined;
  }
  /** A rule you type, `rule: <text>.`, saved at once as yours; resolves with the targets this prompt typed. */
  private async saveTyped(prompt: string): Promise<Set<string>> {
    const out = new Set<string>();
    if (prompt.includes('<task-notification>')) return out;
    const have = new Set((await this.typedRules()).map((t) => t.target));
    for (const m of prompt.matchAll(TYPED_RULE)) {
      const text = m[1]!.trim();
      if (!text) continue;
      const target = `rule:typed${ruleId('you', text)}`;
      out.add(target);
      if (have.has(target)) continue;
      have.add(target);
      // The rule's own words are its evidence, never the rest of the prompt.
      const at = await this.record.keep(this.connection('core'), { bytes: new TextEncoder().encode(`rule: ${text}.`), kind: 'user.rule', source: 'prompt' });
      const ts = this.now();
      await this.append(this.connection('cli'), { v: 1, id: ulid(ts), kind: 'learn.applied', ts, data: { layer: 'base', target, diff: `+ ${text}`, evidence: [{ at, quote: text }], scope: 'all', replay: null, applied_by: 'you', supersedes: null } });
    }
    return out;
  }
  /** At a prompt: a new set (a rule typed anywhere, a slice entry) is carried and recorded; after a compaction or a resume, every rule you typed. */
  private async promptRules(meta: HookMeta, prompt: string): Promise<Piece[] | undefined> {
    const typedNow = await this.saveTyped(prompt);
    const st = this.ruleStateOf(meta.session);
    const set = await this.startSet(meta.session, meta.cwd, meta.agent);
    const fresh = set.handles.filter((h) => !st.given.has(h));
    if (!fresh.length && !st.full && set.handles.length === st.given.size) return undefined;
    const typedAll = await this.typedRules();
    for (const t of typedAll) if (!set.lines.has(t.target)) set.lines.set(t.target, t.text);
    const typed = st.full ? typedAll.map((t) => t.target) : [];
    const carried = [...new Set([...typed, ...fresh])].filter((h) => !typedNow.has(h));
    st.given = new Set(set.handles);
    st.full = false;
    await this.delivered(meta.session, 'prompt', set.handles);
    return carried.length ? rulePieces(`${RULES_HEAD}${typed.length ? ', every rule you typed again after the compaction or resume' : ', new since your last prompt'}`, carried.map((h) => [h, set.lines.get(h)!])) : undefined;
  }
  /**
   * At a tool call, behind its hook (#344): the scoped rules the server's reply carried, recorded as delivered; an agent's
   * edit of a rule file, read before the call by the server and after it here, and each rule line it removed held.
   */
  private async ruleHook(meta: HookMeta): Promise<void> {
    if (FOREIGN.has(meta.agent) || !meta.session) return;
    const st = this.ruleStateOf(meta.session);
    const key = meta.toolUse ?? '';
    if (meta.event === 'PreToolUse' && meta.rules) {
      for (const handle of meta.rules.notices) await this.delivered(meta.session, 'notice', [handle]);
      if (meta.rules.before?.length && key) st.editing.set(key, meta.rules.before);
    }
    const before = meta.event === 'PostToolUse' ? st.editing.get(key) : undefined;
    const repo = before ? repoRoot(meta.cwd) : undefined;
    if (before) st.editing.delete(key);
    if (before && repo) await this.holdRemoved(meta.session, repo, before);
  }
  /** Each rule line an agent's edit removed stays in force, held, and becomes one proposal to you, as deep_propose's are. */
  private async holdRemoved(session: string, repo: string, before: { file: string; scope: string; rules: string[] }[]): Promise<void> {
    this.ruleFiles.delete(repo);
    const held = readHeld(this.root.dir);
    for (const b of before) {
      const after = new Set(rulesInFile(join(repo, b.file)).map(sameRule));
      for (const text of b.rules.filter((r) => !after.has(sameRule(r)))) {
        const id = ruleId(b.file, text);
        if (held.some((h) => h.id === id && h.repo === repo)) continue;
        const made = await this.propose(session, { target: `wiki:rules#${id}`, change: `Remove the rule “${text}” from ${b.file}. An agent's edit took this line out; the rule stays in force on the rules page until you apply this.`, evidence: null }).catch(() => undefined);
        if (made) held.push({ id, text, file: b.file, scope: b.scope, repo, proposal: String(made.proposal), ask: String(made.ask) });
      }
    }
    saveHeld(this.root.dir, held);
  }
  /** `deep rules sync`: the rules page, each rule with its file, scope, size and what enforces it, written through the wiki. */
  private async syncRules(): Promise<Obj> {
    this.ruleFiles.clear();
    const { rules, files } = await this.allRules(await this.ruleGuards());
    savePage(this.root.dir, pageLines(rules, files));
    await this.wikiBuild.writeRules();
    return { rules: rules.length, files: new Set(rules.map((r) => `${r.repo ?? ''} ${r.file}`)).size };
  }
  /** The guard entries that enforce a rule: only those whose planted call deep-hook denies and whose twin it allows now. */
  private ruleGuards(): Promise<{ name: string; rule: string }[]> {
    return provenGuards(this.root.dir, process.env.DEEP_HUB_TEST_DEEP_HOOK || deepHook());
  }
  /**
   * The rules offered for removal on the keep-or-remove list (#111): a rule a guard enforces, naming it, and a rule whose
   * path scope matched no session's tool calls in the last 60 days, naming the count. Never one you typed; once each,
   * until its text changes.
   */
  private async ruleLessons(): Promise<Lesson[]> {
    const { rules } = await this.allRules(await this.ruleGuards());
    const decided = new Set(((await this.record.raw("SELECT key FROM decisions WHERE state = 'active'")) as { key: string }[]).map((d) => d.key));
    const out: Lesson[] = [];
    for (const r of rules) {
      if (r.known !== 'repo' || r.held) continue;
      let why: string | undefined;
      if (r.enforcer.kind === 'guard') why = `The guard ${r.enforcer.name} enforces it: its planted call is denied and its twin allowed, so the line in ${r.file} only repeats it.`;
      else if (r.scope !== 'all' && r.repo) {
        const reach = await ruleReach((sql, params) => this.record.raw(sql, params), r.repo, r.scope, reachSince(this.now(), 60));
        if (!reach.sessions.length) why = `Its scope ${r.scope} matched ${reach.sessions.length} sessions' tool calls in the last 60 days.`;
      }
      if (!why) continue;
      const id = `lesson-${sha256Hex(new TextEncoder().encode(`removal ${ruleHandle(r)} ${r.repo ?? ''}`)).slice(0, 12)}`;
      if (!decided.has(decisionKey(id))) out.push({ id, kind: 'removal', text: r.text, rank: 0, claim: ruleHandle(r), scope: 'all', sources: [{ at: null, path: r.file, quote: r.text }], why });
    }
    return out;
  }
  /**
   * Taking a rule's removal lesson: a configuration eval (#112) first; the line leaves its file only if that eval doesn't
   * read as a regression. With no eval run, nothing changes (BLOCKED).
   */
  private async removeRule(lesson: Lesson): Promise<Obj> {
    const { rules } = await this.allRules([]);
    const rule = rules.find((r) => ruleHandle(r) === lesson.claim && r.repo);
    if (!rule?.repo) return { status: 'refused', reason: `${lesson.claim} is no rule in a repo file now; nothing changed.` };
    const path = join(rule.repo, rule.file);
    const given = process.env.DEEP_HUB_TEST_EVAL;
    if (!given) return { status: 'refused', reason: `BLOCKED: removing “${rule.text}” from ${rule.file} needs a configuration eval, and none ran; ${rule.file} is unchanged.` };
    const evaluated = JSON.parse(readFileSync(given, 'utf8')) as { outcome?: string; broke?: string[] };
    if (evaluated.outcome !== 'adopt') {
      return { status: 'refused', reason: `the configuration eval reads removing “${rule.text}” as a regression (${evaluated.outcome ?? 'no outcome'}) on ${(evaluated.broke ?? []).join(', ') || 'no named task'}; ${rule.file} is unchanged.` };
    }
    const lines = readFileSync(path, 'utf8').split('\n');
    const at = lines.findIndex((l) => { const m = /^\s*[-*+]\s+(.+?)\s*$/.exec(l); return m !== undefined && m !== null && sameRule(m[1]!) === sameRule(rule.text); });
    if (at < 0) return { status: 'refused', reason: `${rule.file} no longer holds “${rule.text}”; nothing changed.` };
    lines.splice(at, 1);
    writeFileSync(path, lines.join('\n'));
    this.ruleFiles.delete(rule.repo);
    return { decision: `removed “${rule.text}” from ${rule.file}` };
  }
  /** `deep session rules <id>`: the set a session was given, whether a newer one is in force since, and the set a regression in it is credited to. */
  private async sessionRules(params: Obj): Promise<Obj> {
    const session = String(params.session ?? '');
    const set = await setOf((sql, p) => this.record.raw(sql, p), session);
    if (!set) throw new Refused(refusal('not_found', '/params/session', `No rules were recorded as given to session ${session}.`, session));
    const [row] = (await this.record.raw('SELECT worktree, agent FROM sessions WHERE id = ?', [session])) as { worktree: string | null; agent: string | null }[];
    const now = await this.startSet(session, row?.worktree ?? '', row?.agent ?? 'claude-code');
    const current = [...now.handles].sort().join('\n') === [...set.rules].sort().join('\n');
    return { session: `session:${session}`, runs: current ? 'current' : 'earlier', set: set.pos, credited_to: set.pos };
  }
  /**
   * `deep memory keep` and `remove` (#111): yours alone, from your own terminal, once the OS confirms you. Keeping a
   * proposed guard installs it through the guard engine, checked on its planted call and twin, before the decision is saved.
   */
  private async memoryAct(params: Obj, context: CallContext): Promise<Obj> {
    const verb = params.verb;
    if (context.role !== 'cli') throw new Refused(refusal('role', '/method', 'A lesson is kept or removed from the CLI, once the OS confirms you.', 'memory.act'));
    const lesson = (await this.lessons()).find((l) => l.id === params.lesson);
    if (!lesson) throw new Refused(refusal('not_found', '/params/lesson', `No lesson ${String(params.lesson)}; deep memory lists the lessons left.`, params.lesson));
    // An agent may start this; the OS prompt is yours to refuse, so it says so, and shows the whole rule a guard would install.
    const agent = await this.agentAbove(context.peer);
    const why = await this.confirmer.you(`${verb === 'keep' ? 'keep' : 'remove'} the lesson “${lesson.text}”${agent ? `, asked from inside agent session ${agent}` : ''}`, { handle: lesson.id, revision: lesson.claim, process: context.peer });
    if (why) throw new Refused(refusal('unconfirmed', '', `Nothing changed: the OS didn't confirm you (${why}).`, lesson.id, true));
    if (verb === 'remove' && lesson.claim.startsWith('wiki:rules#') && lesson.why) return this.removeRule(lesson);
    if (verb === 'remove') return { decision: await this.wikiBuild.forget(lesson.claim) };
    const guard = guardOf(lesson);
    if (guard) {
      const added = await addGuards(this.root.dir, guard, { deepHook: deepHook(), classes: toolClasses(), plant: this.options.plant });
      if (added.status === 'refused') return added;
    }
    return { decision: await keepLesson(this.record, this.connection('cli'), this.now, lesson) };
  }

  /** Copies your standing rules for cloud resources into rules.json, so deep-hook honours them with the hub down (#23). */
  private async syncStanding(): Promise<void> {
    if (this.options.plant === 'copies-no-standing-rules') return;
    const rows = (await this.record.raw(`SELECT d.id AS id, d.answer AS answer, d.state AS state, e.data AS data FROM decisions d JOIN events e ON e.id = d.ask_id AND e.kind = 'ask.created'`)) as { id: string; answer: string; state: string; data: string }[];
    const decided = rows.map((r) => {
      const data = JSON.parse(r.data) as Obj;
      return { id: r.id, answer: (JSON.parse(r.answer) as unknown) as string, state: r.state, subject: isObj(data.subject) ? data.subject : null };
    });
    writeStanding(this.root.dir, standingRules(decided));
  }
  /**
   * What the hub says back to a hook it holds: a session's start gets its briefing and the answers of its thread; a
   * prompt the answers waiting for it, or, a person's status question with nothing waiting, the answer from the
   * record that keeps it from the model (#83); a stop, while the agent left a question, waits until `until` for its
   * answer, and is sent back with it while the turn is under Claude Code's cap on continuations; a judged stop
   * carries its verdict line, first in a send-back's reason and beside any reply where the chat shows it (#83).
   */
  async hookReply(meta: HookMeta, until: number): Promise<{ context?: string; block?: string; message?: string }> {
    // Only a hook whose reply is being built can be abandoned; once it is built, its ID is kept no longer (#41's soak).
    this.replying.add(meta.id);
    try {
      return await this.buildReply(meta, until);
    } finally {
      this.replying.delete(meta.id);
      this.abandoned.delete(meta.id);
    }
  }
  /**
   * A reply's context inside the cap the agent's facts set on injected output (#1296): under it, the parts joined as
   * ever; past it, the rules you typed and the requirement IDs inline first, the rest kept as evidence and named by its
   * handle on a line saying where to continue, and the record says which part went how. The planted wrong program
   * sends the whole block, which the agent cuts to a preview.
   */
  /** The extensions' context for a call, fitted as the core's own is (#1296). */
  fitContext(meta: HookMeta, parts: Part[], join: string): Promise<string> { return this.fitted(meta, parts, join); }
  private async fitted(meta: HookMeta, parts: Part[], join?: string): Promise<string> {
    const cap = Number(((adapterOf(meta.agent)?.facts as Obj | undefined)?.contextOutput as Obj | undefined)?.capChars) || Infinity;
    const out = fit(parts, this.options.plant === 'sends-block-whole' ? Infinity : cap, join);
    if (!out.rest) return out.inline;
    const handle = await this.record.keep(this.connection('core'), { bytes: new TextEncoder().encode(out.rest), kind: 'hook.context', source: meta.event });
    const ts = this.now();
    await this.append(this.connection('core', { session: meta.session }), { v: 1, id: ulid(ts), kind: 'session.context_fit', ts, subject: `session:${letters(meta.session)}`, data: { event: meta.event, cap, chars: out.inline.length + out.rest.length, inline: out.inlineNames, inline_ids: out.inlineIds, by_handle: out.restNames, handle }, evidence: [handle.slice(3)] });
    return [out.inline, continueLine(handle, out.restNames, cap)].filter(Boolean).join('\n\n');
  }
  private async buildReply(meta: HookMeta, until: number): Promise<{ context?: string; block?: string; message?: string }> {
    const own = !FOREIGN.has(meta.agent) && meta.session;
    // A tool call's reply carries a message typed mid-turn and the notices waiting for the session (#340, #352).
    if (own && (meta.event === 'PreToolUse' || meta.event === 'PostToolUse')) {
      return this.queue(async () => {
        const ack = this.acknowledge(meta.session);
        const context = await this.fitted(meta, [{ name: 'acknowledgement', text: ack.context, keep: true }, { name: 'sibling sessions', text: await this.siblings.deliver(meta, until) }], '\n');
        return { ...ack, ...(context ? { context } : {}) };
      });
    }
    if (meta.event === 'SessionStart') {
      // After a compaction or a resume the next prompt carries every rule you typed (#344), set before any wait here,
      // so a prompt whose hook arrives before this reply is done still carries them.
      if (own && (meta.fields?.source === 'compact' || meta.fields?.source === 'resume')) this.ruleStateOf(meta.session).full = true;
      // What Codex says of our entries' trust, off this reply's path.
      if (meta.agent === 'codex') void this.readCodexTrust(meta.cwd);
      // The worktree receives its build products first, beside the rest of the reply (#1017).
      const placed = this.products.sessionStart(meta.session, meta.cwd, meta.id).catch((error: unknown) => { process.stderr.write(`deep hub: products weren't placed in ${meta.cwd}: ${error instanceof Error ? error.message : String(error)}\n`); return undefined; });
      const brief = await briefing(meta.cwd);
      const answers = own && this.options.plant !== 'ended-answer-at-next-prompt'
        // The planted wrong program gives a new session the answers of every session that worked in its folder.
        ? await this.queue(async () => this.deliver(await this.waitingFor(meta.session, this.options.plant === 'ended-answer-to-worktree' ? `a.session_id IN (SELECT id FROM sessions WHERE worktree = '${sql(meta.cwd)}')` : undefined), 'next_prompt', { session: meta.session, id: meta.id }))
        : undefined;
      // After a compaction or a resume, the open asks' requirement IDs again, in one short block. The planted wrong
      // programs send them only at startup, or 25 ms late on the hook's path.
      const source = meta.fields?.source;
      const open = own && !(this.options.plant === 'brief-at-startup-only' && source !== 'startup') ? await this.tasks.brief(meta.session, this.sessions.get(meta.session)?.thread) : undefined;
      if (this.options.plant === 'slow-brief' && (source === 'compact' || source === 'resume')) await new Promise((done) => setTimeout(done, 25));
      const taste = own ? await this.tasteAt(meta.session, meta.cwd, (await headOf(meta.cwd))?.branch ?? '', true) : undefined;
      // Your rules first (#344): every agent's rule files and the rules you typed, recorded as the set this session runs under.
      const rules = own ? await this.queue(() => this.startRules(meta)).catch((error: unknown) => { process.stderr.write(`deep hub: no rules for ${meta.session}: ${error instanceof Error ? error.message : String(error)}\n`); return undefined; }) : undefined;
      // Who else is in the repo, and on what (#352).
      const siblings = own ? await this.queue(() => this.siblings.deliver(meta, until)) : undefined;
      const context = await this.fitted(meta, [{ name: 'rules', ...(rules ? { pieces: rules } : {}) }, { name: 'build products', text: await placed }, { name: 'briefing', text: brief }, { name: 'requirement IDs', ...(open ? { pieces: open.text.split('\n').map((text, i) => ({ text, keep: true, ...(i === 0 ? { ids: open.ids } : {}) })) } : {}) }, { name: 'answers', text: answers, keep: true }, { name: 'taste', text: taste }, { name: 'sibling sessions', text: siblings }]);
      return context ? { context } : {};
    }
    if (!own || (meta.event === 'UserPromptSubmit' && childPrompt(meta))) return {};
    // Behind the replay its hook waited for, so the queue holds the hook before this reply. A long replay can
    // put a stop's reply past the server's wait; its line then shows at the next prompt, from the record.
    await (this.replaying ?? Promise.resolve());
    const r = this.routesOf(meta.session, meta.cwd);
    if (meta.event === 'UserPromptSubmit') {
      const prompt = meta.fields?.prompt ?? '';
      // A prompt the waiter's exit started (a wake) is part of the turn's continuations; any other starts the count again.
      if (!prompt.includes('<task-notification>')) {
        r.continued = 0;
        r.capped = false;
      }
      // A status question a person typed is answered from the record, and never reaches the model (#83), unless
      // an answer or a send-back waits for the agent at this prompt: that is never lost, so the prompt goes on
      // with it, and the status rides beside it where the chat shows it.
      const reply = await this.queue(async (): Promise<{ context?: string; block?: string; message?: string }> => {
        // Another session's message past the loop rule's count waits for your answer, at its submit (#352).
        const held = await this.loopHeld(meta);
        if (held) return { block: held, message: held.split(':')[0]! };
        // Behind this prompt's own hook, so its origin is recorded (its event, or the queue's) when read.
        const status = await this.statusReply(meta);
        for (const [ask, handed] of [...this.handed]) if (handed.session === meta.session) await this.unwoken(meta.session, ask, prompt);
        // A continue a waiter took is shown by the wake that carries it; any other prompt carries it instead (#85).
        r.later.unshift(...(r.handed ?? []).filter((text) => !prompt.includes(text)));
        delete r.handed;
        // An answer whose delivery timed out is read for first: one a turn already showed isn't sent again.
        for (const [ask, session] of [...this.unread]) {
          if (session !== meta.session) continue;
          const woken = await this.woken(session, said(ask));
          if (woken === undefined) continue;
          this.unread.delete(ask);
          if (woken) await this.outcome(ask, 'next_prompt', 'delivered');
        }
        const waiting = await this.waitingFor(meta.session);
        if (status && !waiting.length && !r.later.length && !this.promiseDueFor(meta.session)) {
          // The prompt's event read as the session working; it stays as it was, since no model runs on it.
          const live = this.live.get(meta.session);
          if (live?.state && live.state !== 'working') await this.attention(meta.session, live.agent, live.state);
          return { block: status, message: status.split('\n')[0]! };
        }
        // The planted wrong program counts the waiter your settings declare as a route, shown or not, and leaves the answer for it.
        const leaves = this.options.plant === 'routes-from-settings' && !r.shown.has('waiter');
        const answers = leaves ? undefined : await this.deliver(waiting, 'next_prompt', { session: meta.session, id: meta.id });
        // A verdict that landed after the stop's reply goes with the next prompt (#83).
        // Your answer to a question that held the send-back goes with the claim's line as it stands (#84).
        const landed = (await this.landedLine(meta.session)) ?? (answers ? await this.lineStanding(meta.session) : undefined);
        const slow = this.slowVerdicts(r);
        // A continue the core recorded since the timer last read them goes with this prompt, not the one after (#85).
        await this.continues();
        // Notes this prompt's hook recorded go as its context, once; a prompt typed mid-turn is acknowledged in its reply (#340).
        const notes = this.carried.get(meta.session);
        this.carried.delete(meta.session);
        const ack = this.acknowledge(meta.session);
        const promised = await this.promiseCarried(meta.session, 'next_prompt', prompt);
        // What you reject while a session runs stops it now, not at the next wiki build (#111).
        if (prompt.includes('rejected:')) {
          const message = { id: meta.id, role: 'user', text: prompt, outside: false } as Message;
          await captureRejected(this.record, this.connection('cli'), this.now, [{ session: meta.session.replace(/[^0-9A-Za-z]/g, ''), project: repoOf(meta.cwd) ?? null, messages: [message], from: 0 }], true);
          await syncRejected(this.raw, this.root.dir).catch(() => undefined);
        }
        // A branch's name may not say which screen a session works on, so its first prompt is read too.
        const first = !this.firstPrompted.has(meta.session);
        this.firstPrompted.add(meta.session);
        const taste = first ? await this.tasteAt(meta.session, meta.cwd, prompt, false) : undefined;
        // A rule you typed anywhere, or every one after a compaction or a resume (#344).
        const rules = await this.promptRules(meta, prompt).catch((error: unknown) => { process.stderr.write(`deep hub: rules at ${meta.session}'s prompt: ${error instanceof Error ? error.message : String(error)}\n`); return undefined; });
        const siblings = await this.siblings.deliver(meta, until);
        const later = r.later.splice(0).filter((text) => !prompt.includes(text)).map((text) => ({ name: 'continues', text }));
        const context = await this.fitted(meta, [{ name: 'rules', ...(rules ? { pieces: rules } : {}) }, { name: 'answers', text: answers, keep: true }, { name: 'promised checks', text: promised }, { name: 'notes', text: notes ? this.noteText(notes) : undefined }, ...later, { name: 'verdict', text: landed ? `DeepBuild: ${landed}` : undefined }, { name: 'slow verdicts', text: slow }, { name: 'acknowledgement', text: ack.context, keep: true }, { name: 'taste', text: taste }, { name: 'sibling sessions', text: siblings }]);
        const message = [status, ack.message].filter(Boolean).join('\n');
        return { ...(context ? { context } : {}), ...(message ? { message } : {}) };
      });
      return reply;
    }
    if (meta.event !== 'Stop') return {};
    // What earlier replies handed this session is read from its transcript first: shown, or stalled and sent again here (#906).
    await this.queue(async () => { for (const [ask, handed] of [...this.handed]) if (handed.session === meta.session) await this.unwoken(meta.session, ask); });
    r.holding++;
    let block: string | undefined;
    // A judged stop's claim is made, and its pull request recorded, before the hold, behind this stop's own hook (#83).
    const judged = await this.queue(() => this.judging(meta)).catch(async (e: unknown) => {
      await this.appendReading(meta.session, meta.agent, `This stop's claim could not be recorded: ${e instanceof Error ? e.message : String(e)}`).catch(() => undefined);
      return undefined;
    });
    // A record that takes no writes (a full disk, the lock lost) turns every gate watch-only: the stop goes on
    // unjudged, and its line says so and why (#33).
    if (this.blocked && !judged?.claim) {
      r.holding--;
      const said = this.options.plant === 'failures-as-fail' ? this.blocked.replace(/^BLOCKED/, 'FAIL') : this.blocked;
      return { message: `${said}: DeepBuild is watch-only until the record takes writes again, so this stop wasn't judged.` };
    }
    // The claim's fast lane (#29): the hold waits for the checks the budget admitted, and no longer than the hold.
    // deep-hook stamps the stop on the wall clock; a stepped test clock's steps put it on the hub's (#965).
    const stopAt = ulidTime(meta.id) + this.stepped;
    // Codex's hold may run as long as its Stop timeout lets a slow check, but an answer waits no longer than anyone's.
    const held = until;
    until = noWake(meta.agent) ? Math.min(until, Date.now() + STOP_HOLD_MS) : until;
    const lane = judged?.claim ? await this.laneOf(judged.claim, until) : undefined;
    // What the stop ends on, sorted before the stall rule reads whether a question holds its send-back (#84).
    const message = meta.fields?.last_assistant_message?.trim() ?? '';
    // A test's planted sorter answers its question first: what it answered "proceed" is sorted no further (#321).
    const asked = this.holds.planted(meta);
    const sorted: Sorted | undefined = judged && !r.places && !asked ? await this.questions.atStop(meta, {
      message, requirements: [...(this.claimRequirements.get(judged.claim ?? '')?.values() ?? await this.requirementsOf(meta.session))],
    }).catch(async (e: unknown) => { await this.appendReading(meta.session, meta.agent, `This stop's question could not be sorted: ${e instanceof Error ? e.message : String(e)}`).catch(() => undefined); return undefined; }) : undefined;
    const proceeds = asked ? [asked] : sorted?.proceeds ?? [];
    // A send-back names the verdict the record holds, so it waits for the lane's verdict to be written.
    if (lane?.sendBack && judged?.claim) await this.verdictWrites.get(judged.claim)?.catch(() => undefined);
    // A stop that did work and ends on an empty message, with requirements open, gets a completion prompt (#82), at
    // most three in a row; the fourth becomes a stalled claim. It takes the send-back's place and counts apart from it.
    const prompted = judged?.claim ? await this.completion(meta, judged.claim, lane?.sendBack) : undefined;
    // The stop that opens the pull request you asked for is delivery, not a claim to send back (#82): what's still
    // unmet goes on in the same pull request, unless your ask says the pull request ends the work.
    const delivered = judged?.claim && lane ? await this.prDelivery(judged) : undefined;
    if (lane && delivered !== undefined) {
      if (delivered) lane.sendBack = delivered;
      else delete lane.sendBack;
    } else if (lane && prompted !== undefined) {
      if (prompted) lane.sendBack = prompted;
      else delete lane.sendBack;
    }
    // A send-back counts toward a stalled claim, and a question that holds the send-back holds it (#325).
    // A stop with no work that leaves its ask open gets its one send-back before the stall rule counts it (#82).
    else if (lane && judged?.claim && !(lane.sendBack && await this.noWorkOnce(meta.session, judged.claim))) {
      const back = await this.stallGate(meta, judged.claim, lane.sendBack).catch(() => lane.sendBack);
      if (back) lane.sendBack = back;
      else delete lane.sendBack;
    }
    // Size and scope (#324): a reading, never a verdict; what it sends back once rides with a failing check's send-back,
    // and only in time for this reply: past the hold's margin it is recorded and sent nothing.
    // A stop whose snapshot changed nothing is no new size: its last reading stands (#82).
    const sized = judged?.claim && lane?.changed !== false ? await this.sizedAt(judged.claim, meta, held + HOLD_MARGIN_MS / 2) : undefined;
    // A no-work stop that leaves an ask open, and the stop after the app's resume prompt (#82): sent on once.
    const nudge = await this.queue(() => this.idleOrResumed(meta, judged, Boolean(lane?.sendBack || sized))).catch(() => undefined);
    if (nudge) block = nudge;
    let proceeded = false;
    let questionMs = 0;
    try {
      const questionHeld = judged?.claim ? await this.questionHolds(meta.session) : false;
      if (lane && !lane.sendBack && !sized && judged?.claim && noWake(meta.agent) && lane.slow.length && !questionHeld) {
        const failed = await this.slowStop(meta, r, judged.claim, held);
        if (failed) lane.sendBack = failed;
        // An answer that ended the hold is delivered below, with the wait an answer gets.
        until = Math.min(held, Date.now() + STOP_HOLD_MS);
      }
      // A stop answered "proceed" goes on at once: the proceed rides in its one reply with what else waits, the failing
      // requirements with their smallest failing case. What else the sort sends back rides the same way.
      // pi's package places its own answers: a reply here would hand them over a second time.
      // A question that holds the send-back holds what the sort would send back too (#84): a proceed is only recorded.
      const back = questionHeld ? [] : sorted?.back ?? [];
      if (questionHeld && proceeds.length) await this.holds.record(meta, proceeds, until);
      // A provisional choice raised in the turn goes on: its recommended option goes back in the same reply as a send-back.
      const carried = lane?.sendBack ? await this.provisionalCarried(meta.session) : undefined;
      const going = questionHeld ? [] : proceeds;
      if (going.length || back.length) {
        proceeded = true;
        if (going.length) await this.holds.record(meta, going, until);
        const delivered = await this.queue(async () => this.deliver(await this.waitingFor(meta.session), 'stop_hold', { session: meta.session, id: meta.id }));
        const failing = going.length && lane?.sendBack && judged?.claim ? await this.smallestOf(judged.claim) : undefined;
        const said = going.length ? `DeepBuild: proceed (${going.map((p) => `"${p.question}", by rule ${p.rule}`).join('; ')}). Go on with the work. A call that pushes, merges, dispatches, sends or deletes still waits for an authority ask.` : undefined;
        block = (this.options.plant === 'proceed-alone' ? [said] : [r.sendBacks.shift(), delivered, lane?.sendBack, failing, sized, nudge, ...back, said]).filter(Boolean).join('\n\n');
      } else if (lane?.sendBack || sized) {
        // Your answer rides with the send-back: only a question that holds it waits for the first stop after it.
        const delivered = await this.queue(async () => this.deliver(await this.waitingFor(meta.session), 'stop_hold', { session: meta.session, id: meta.id }));
        block = [delivered, lane?.sendBack, carried, sized].filter(Boolean).join('\n\n');
      }
      else if (block) this.askingSoon();
      else if ((questionHeld && lane?.fast.length) || sorted?.noHold) {
        // A judged stop whose checks ran waits no longer for them: no send-back follows, so it isn't held for your answer (#84); one already given goes with it.
        block = await this.queue(async () => this.deliver(await this.waitingFor(meta.session), 'stop_hold', { session: meta.session, id: meta.id }));
      } else if (!r.places) {
        const waited = this.now();
        block = await this.stopHold(meta, r, until);
        questionMs = this.now() - waited;
      }
    } finally {
      this.abandoned.delete(meta.id);
      r.holding--;
      if (block) {
        r.continued++;
        const kept = this.live.get(meta.session);
        if (kept) kept.sentOn = true;
        r.busy = Date.now();
        // The turn goes on with it, and its next stop starts a waiter of its own: this one exits without waking.
        if (this.options.plant === 'both-routes') r.waiter?.give({ session: meta.session, text: block });
        else r.waiter?.give({ exit: 'answered through the stop hold' });
        r.waiter = undefined;
      } else this.offer(meta.session);
    }
    // Slow runs start when the turn ends (#29): only once the fast lane is green and this reply lets the turn end. A
    // looping session's wait in their places for the loop to pause, or for a claim or your words (#965), and work in
    // the background holds them until it ends, at most 30 minutes (#907). Decided before the line, which names them.
    const live = this.live.get(meta.session);
    const background = [...(live?.background.values() ?? [])].map((b) => b.what);
    // A stop let through with its claim pending or INCONCLUSIVE: the claim stays open, and an open item names each run
    // or answer still needed (#82).
    if (!block && judged?.claim) await this.stillNeeded(meta, judged.claim).catch(() => undefined);
    if (!block && !proceeded) {
      const due = live?.due && live.due.at > this.now() ? live.due : null;
      const starter = live?.claimedInTurn ? 'claim' as const : live?.words ?? null;
      await this.gate.turnEnded(lane && judged?.claim ? judged.claim : null, background, stopAt, { session: meta.session, origin: live?.turnFrom, due, starter }).catch(() => undefined);
      if (live) live.words = undefined;
      if (lane && judged?.claim && background.length && lane.slow.length) await this.appendReading(meta.session, meta.agent, `${lane.slow.join(', ')} ${lane.slow.length === 1 ? 'waits' : 'wait'} for ${backgrounded(background)} in the background, and ${lane.slow.length === 1 ? 'starts' : 'start'} once it ends or 30 minutes from this stop.`).catch(() => undefined);
    }
    // The verdict in the chat: one line at every judged stop, as the verdict stands once the hold is over, first in a send-back's reason too (#83).
    if (judged?.claim) await this.verdictWrites.get(judged.claim)?.catch(() => undefined);
    let line = judged ? await this.judgedLine(judged).catch(async (e: unknown) => {
      await this.appendReading(meta.session, meta.agent, `This stop's verdict line could not be read from the record: ${e instanceof Error ? e.message : String(e)}`).catch(() => undefined);
      return undefined;
    }) : undefined;
    // The stop that opens the pull request you asked for is delivery (#82): its line carries the link, never a send-back.
    if (line && delivered !== undefined && judged?.prOpened) line = `${judged.prOpened} · Part of · ${line.replace(/^sent back \d+\/\d+: /, '')}`;
    // A stop a question holds gets no send-back: its line says what fails and that the next step is yours (#84).
    if (line && judged?.claim) line = await this.heldLine(meta.session, line);
    // What the stop's list leaves outside the ask shows on the line (#84).
    if (line && sorted?.followUps.length) line = `${line} · follow-up: ${sorted.followUps.join('; ')}`;
    // The chat has seen it once it is replied in time; a reply past the hold is not, and the next prompt shows the line.
    if (line && judged && Date.now() < held) judged.delivered = line;
    if (block && line) block = `${line}\n${block}`;
    if (judged?.claim) {
      // A later stop on the same claim ran no lane: only its own hold counts, never the lane's times or its budget cost again.
      const again = judged.heldClaim === judged.claim;
      judged.heldClaim = judged.claim;
      const replyAt = this.now();
      const own = replyAt - questionMs;
      const record = (ran: { readyAt: number; changed?: boolean; budgetCost?: string[] }) => this.gate.held({ session: meta.session, stop: meta.id, claim: judged.claim!, stopAt, readyAt: again ? own : ran.readyAt, replyAt, questionMs, codeChanging: !again && ran.changed === true, budgetCost: again ? [] : ran.budgetCost ?? [] });
      // Recorded beside the reply, not before it: the stop's time is stamped already (#82).
      if (lane) void record(lane).catch(() => undefined);
      // A fast lane still going when the hold ran out: its hold counts all the same, once the lane says what it was.
      else void this.lanes.get(judged.claim)?.then(record).catch(() => undefined);
    }
    return { ...(block ? { block } : {}), ...(line ? { message: line } : {}) };
  }
  /** Background work held a session's slow checks 30 minutes: they start now, and its row names what still runs (#907). */
  private async backgroundCapped(session: string, checks: string[]): Promise<void> {
    const live = this.live.get(session);
    const still = [...(live?.background.values() ?? [])].map((b) => b.what);
    await this.queue(() => this.appendReading(session, live?.agent ?? 'claude-code', `${checks.join(', ')} waited 30 minutes for work in the background and ${checks.length === 1 ? 'starts' : 'start'} now${still.length ? `; still running: ${backgrounded(still)}, which DeepBuild leaves running` : ''}.`));
  }
  /**
   * An idle session woken with a notice through its waiter (#352): never one held on an ask still open for you, or
   * whose newest claim's verdict stands BLOCKED (its cause yours to clear, which a BLOCKED verdict names); that one
   * hears it at its next turn instead.
   */
  private async noticeWake(session: string, text: string): Promise<boolean> {
    const r = this.routes.get(session);
    if (!r?.waiter || r.holding || r.places || await this.asksYou(session)) return false;
    const [newest] = (await this.record.raw(`SELECT v.outcome FROM claims c JOIN verdicts v ON v.claim_id = c.id WHERE c.session_id = ? AND v.stale = 0 ORDER BY c.created DESC, v.created DESC LIMIT 1`, [session])) as { outcome: string }[];
    if (newest?.outcome === 'BLOCKED') return false;
    r.waiter.give({ session, text });
    r.waiter = undefined;
    return true;
  }
  /**
   * Whether the loop rule holds this prompt (#352): its origin as the hook mapped it, and the session whose message
   * started it as the prompt's transcript entry names it (Claude Code's origin.from), never the message's text.
   */
  private async loopHeld(meta: HookMeta): Promise<string | undefined> {
    const live = this.live.get(meta.session);
    const session = this.sessions.get(meta.session);
    if (!live?.turnFrom || childPrompt(meta)) return undefined;
    return this.siblings.held(meta, live.turnFrom, async () => {
      const entry = session && meta.fields?.prompt_id ? (await this.turnFrom(session, meta.fields.prompt_id))[0] : undefined;
      const origin = entry && isObj(entry.origin) ? entry.origin : undefined;
      return typeof origin?.from === 'string' ? /^local_(.+)$/.exec(origin.from)?.[1] : undefined;
    });
  }
  /**
   * The messages typed mid-turn since the last acknowledgement (#340): the agent is asked to acknowledge each in one
   * line, and the chat shows each with its task and the queue: every message typed mid-turn in the turn so far.
   */
  private acknowledge(id: string): { context?: string; message?: string } {
    const acks = this.acks.get(id);
    this.acks.delete(id);
    if (!acks?.length) return {};
    const short = (text: string) => (text.length > 80 ? `${text.slice(0, 79)}…` : text);
    const noted = acks.map((a) => `DeepBuild: your message “${short(a.text)}” ${a.task ? `is a new ask, ${a.task}` : 'opens no ask'}.`);
    // The planted wrong program shows only the message just read.
    const waiting = this.options.plant === 'queue-shows-newest' ? [acks.at(-1)!.text] : this.midTurn.get(id) ?? [];
    const queue = `DeepBuild queue (${waiting.length}): ${waiting.map((t) => `“${short(t)}”`).join(' · ')}`;
    const context = acks.map((a) => `You were sent a message while you worked: “${a.text}”${a.task ? `, a new ask (${a.task})` : ''}. Acknowledge it in one line, then go on.`).join('\n');
    return { context, message: [...noted, queue].join('\n') };
  }
  /**
   * A claim's fast lane as the stop's hold sees it (#29), waited for until `until`: the validity gate's findings and a
   * fast-lane check that failed send the claim back, naming what's missing or which check failed.
   */
  private async laneOf(claim: string, until: number): Promise<{ fast: string[]; slow: string[]; readyAt: number; budgetCost?: string[]; changed?: boolean; sendBack?: string } | undefined> {
    const lane = this.lanes.get(claim);
    if (!lane) return undefined;
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<undefined>((done) => { timer = setTimeout(() => done(undefined), Math.max(0, until - Date.now())); });
    const ran = await Promise.race([lane.catch(() => undefined), late]).finally(() => clearTimeout(timer));
    if (!ran) return undefined;
    // A send-back is a FAIL's (or a BLOCKED's cause): an INVALID names a check or a definition the agent can't change,
    // so it is recorded for a person, never sent back.
    // A definition still to lock, or held by a cause outside the code, is never a send-back (#322).
    const failed = this.gate.standing(claim).filter((c) => c.lane === 'fast' && (c.result === 'FAIL' || (c.result === 'BLOCKED' && c.holds)));
    // The message names the missing proof precisely (#322): each requirement left unproven, by its ID and text, with
    // the check that fails it, or the spec's check by name; never just "tests failed".
    const named = this.claimRequirements.get(claim);
    const sendBack = ran.findings.length ? `DeepBuild sent this claim back before any check ran:\n${ran.findings.map((f) => `- ${f}`).join('\n')}`
      : failed.length ? `DeepBuild sent this claim back: ${failed.map((c) => {
        const reqs = c.covers.map((req) => named?.get(req)).filter((q): q is { id: string; text: string } => q !== undefined);
        if (this.told.get(claim)?.has(c.check)) return `the command your final message tells you to run, \`${c.check}\`, ${c.result === 'FAIL' ? 'fails' : c.result}:\n${this.gate.outputOf(claim, c.check)}`;
        return reqs.length ? `${reqs.map((q) => `${q.id} ("${q.text}")`).join(' and ')} ${reqs.length === 1 ? 'is' : 'are'} unproven: its check ${c.check} ${c.result}` : `the repo's spec check ${c.check} ${c.result}`;
      }).join('; ')}.` : undefined;
    return { fast: ran.fast, slow: ran.slow, readyAt: ran.readyAt, ...(ran.budgetCost ? { budgetCost: ran.budgetCost } : {}), ...(ran.changed === undefined ? {} : { changed: ran.changed }), ...(sendBack ? { sendBack } : {}) };
  }
  /**
   * A judged stop's size and scope (#324): measured and recorded as claim.sized; what it sends back once, or undefined.
   * A question that holds the send-back (#325) holds it too, and nothing is spent: sent back or asked once it's answered.
   */
  private async sizedAt(claim: string, meta: HookMeta, deadline: number): Promise<string | undefined> {
    const c = this.claimScopes.get(claim);
    if (!c) return undefined;
    const requirements = [...(this.claimRequirements.get(claim)?.values() ?? [])];
    const holds = await this.questionHolds(meta.session).catch(() => false);
    return this.sizing.atStop({ claim, ...c, session: meta.session, agent: meta.agent, requirements, reached: this.gate.reached(claim), holds, deadline }).catch(async (e: unknown) => {
      await this.appendReading(meta.session, meta.agent, `This stop's size and scope could not be read: ${e instanceof Error ? e.message : String(e)}`).catch(() => undefined);
      return undefined;
    });
  }
  /**
   * A Codex stop with slow checks (#39): held for them only when each one's deadline ends at least 5 s before the Stop
   * entry's timeout, so a FAIL reaches the agent in the same turn; otherwise replied at once, with the row saying why,
   * and the verdict comes with the next message. What it is sent back with, or nothing.
   */
  private async slowStop(meta: HookMeta, r: Routes, claim: string, held: number): Promise<string | undefined> {
    const timeoutS = stopTimeoutS(this.root.dir) ?? 600;
    const slowClaims = (r.slowClaims ??= []);
    const verdictLater = async (why: string) => {
      // A claim the agent stopped on again is told once, and said once.
      if (slowClaims.includes(claim)) return;
      slowClaims.push(claim);
      await this.appendReading(meta.session, meta.agent, `This stop isn't held: ${why}. Its verdict comes with your next message.`).catch(() => undefined);
    };
    // Something already sends the agent on: the turn isn't ending, so no slow check starts.
    const waiting = () => this.queue(() => this.waitingFor(meta.session));
    if (r.sendBacks.length || (await waiting()).length) return undefined;
    const deadlines = this.gate.slowDeadlines(claim);
    const late = deadlines.find((c) => c.deadline_ms === null || !holdsFor(c.deadline_ms, timeoutS));
    await this.gate.turnEnded(claim);
    if (late) {
      const deadline = late.deadline_ms === null ? 'has no deadline' : `has a deadline of ${words(late.deadline_ms)}`;
      await verdictLater(`${late.check} ${deadline}, which must end at least 5 s before Codex's Stop hook timeout, ${timeoutS} s`);
      return undefined;
    }
    // Measured from now, with the check started: `held` already ends 5 s before the timeout, counted from the stop.
    const unstarted = this.gate.slowUnstarted(claim);
    if (unstarted.length) { await verdictLater(`${unstarted[0]} is waiting for a CPU slot, so its deadline can't be kept before Codex's Stop hook timeout, ${timeoutS} s`); return undefined; }
    const tight = deadlines.find((c) => Date.now() + c.deadline_ms! > held);
    if (tight) { await verdictLater(`${tight.check} has a deadline of ${words(tight.deadline_ms!)}, which no longer ends at least 5 s before Codex's Stop hook timeout, ${timeoutS} s`); return undefined; }
    while (Date.now() < held && this.gate.slowStanding(claim).pending) {
      await this.gate.slowEnded(claim, Math.min(held, Date.now() + 500));
      // An answer goes back at once; the check's verdict then comes with your next message.
      if (r.sendBacks.length || (await waiting()).length) { if (!slowClaims.includes(claim)) slowClaims.push(claim); return undefined; }
    }
    const standing = this.gate.slowStanding(claim);
    if (standing.pending) { await verdictLater(`its checks were still going when the hold ended, 5 s before Codex's Stop hook timeout, ${timeoutS} s`); return undefined; }
    return standing.failed.length ? `DeepBuild sent this claim back: ${standing.failed.join(', ')}.` : undefined;
  }
  private async readCodexTrust(cwd: string): Promise<void> {
    const dirs = [...(process.env.PATH ?? '').split(':'), ...this.config().loginPath.split(':')].filter(Boolean);
    const codex = dirs.map((d) => join(d, 'codex')).find((p) => existsSync(p));
    if (codex) await saveTrust(this.root.dir, codex, cwd, { ...process.env, CODEX_HOME: recordedHome(this.root.dir) }).catch(() => undefined);
  }
  /** The verdicts of the slow checks no stop was held for, once each has ended: what a prompt carries, or nothing. */
  private slowVerdicts(r: Routes): string | undefined {
    const told: string[] = [];
    r.slowClaims = (r.slowClaims ?? []).filter((claim) => {
      const { pending, failed } = this.gate.slowStanding(claim);
      if (pending) return true;
      if (failed.length) told.push(`DeepBuild sent this claim back: ${failed.join(', ')}.`);
      return false;
    });
    return told.join('\n') || undefined;
  }
  /** A stop held while the agent left a question: what it is sent back with, or nothing. */
  private async stopHold(meta: HookMeta, r: Routes, until: number): Promise<string | undefined> {
    const session = meta.session;
    // A promised check that came due while no route could wake the session goes back with this stop (#120).
    const promised = await this.queue(() => this.promiseCarried(session, 'stop_hold'));
    if (promised) return promised;
    // Size and scope's own asks (#324) wait days for you and the agent didn't ask them: an open one holds no stop,
    // though your answer to one, once given, is delivered here like any other.
    const sized = await this.sizing.keysIn(session).catch(() => new Set<string>());
    const open = async () => ((await this.record.raw(`SELECT key, status FROM asks WHERE session_id = ? AND (status = 'answered' OR (status IN ('open', 'later') AND provisional = 0)) AND id NOT IN (SELECT delivery FROM deliveries WHERE outcome = 'delivered')`, [session])) as { key: string; status: string }[])
      .some((a) => a.status === 'answered' || (!sized.has(a.key) && !this.holds.offers.has(a.key)));
    if (this.options.plant !== 'no-stop-count' && r.continued >= this.cap()) {
      // One more block would pass Claude Code's cap and be overridden: what would continue the turn waits for its next prompt.
      if (!r.sendBacks.length && !await open()) return undefined;
      r.later.push(...r.sendBacks.splice(0));
      r.capped = true;
      this.askingSoon();
      await this.appendReading(session, meta.agent, `This turn's stop was sent back ${r.continued} times in a row with no tool call between, Claude Code's cap of ${this.cap()} stop-hook continuations, so the next would be overridden: what waits for this session goes with its next prompt instead.`).catch(() => undefined);
      return undefined;
    }
    if (r.sendBacks.length) {
      this.askingSoon();
      return r.sendBacks.shift();
    }
    const polls = this.options.plant === 'stop-hold-polls';
    const held = Date.now();
    while (!this.stopping && Date.now() < until && !this.abandoned.has(meta.id) && await open()) {
      // A continue the core recorded while the stop waited (#85): sent back with it.
      if (r.sendBacks.length) {
        this.askingSoon();
        return r.sendBacks.shift();
      }
      if (this.releases) {
        if ((await this.queue(() => this.waitingFor(session))).length) return undefined;
      } else {
        const block = await this.queue(async () => (this.abandoned.has(meta.id) ? undefined : this.deliver(await this.waitingFor(session), 'stop_hold', { session, id: meta.id })));
        if (block) return block;
      }
      if (polls) await new Promise((done) => setTimeout(done, Math.min(250, Math.max(0, until - Date.now()))));
      else await this.wakeable(this.waiting, session, Math.min(until - Date.now(), 1000)).woken;
    }
    // A hold that ran out with the agent's question still open ends on the record (#27), naming what it waited for.
    if (!this.stopping && !this.abandoned.has(meta.id) && Date.now() >= until) {
      const asks = (await this.record.raw(`SELECT id FROM asks WHERE session_id = ? AND status IN ('open', 'later') ORDER BY created`, [session])) as { id: string }[];
      if (asks.length) await this.appendReading(session, meta.agent, `This stop was held ${words(until - held)} for ${asks.map((a) => `ask:${a.id}`).join(', ')} and nothing was answered, so the hold ended and the stop went through. The session waits on you: your answer goes by its waiter or its next prompt.`).catch(() => undefined);
    }
    return undefined;
  }
  /**
   * The waiter: one per session, the newest. It waits until the session is idle with an answer for it, then hands
   * it over to wake the session; it is told to exit when a newer one replaces it, the stop hold took the answer, or
   * the session ends. Its life is its session's, not this hub's: one that waited across a restart asks again.
   */
  private async waitAnswer(params: Obj, context: CallContext): Promise<Obj> {
    const session = String(params.session);
    const since = typeof params.since === 'number' ? params.since : this.now();
    if (this.stopping) throw refuse('unavailable', '', 'The hub is stopping; ask again once it is back.', session, true);
    if (this.options.plant === 'waiter-gives-up-at-600s' && this.now() - since > 600_000) return { exit: 'planted: gave up at 600 s' };
    const r = this.routesOf(session, typeof params.cwd === 'string' ? params.cwd : '');
    // paseo's plugin on deep-hook's behalf, for a session deep-hook gates inside paseo (#55).
    if (params.relay === true) {
      if (context.session !== session || !this.inPaseo.has(session)) throw refuse('role', '/params/session', 'Wait only on a session paseo runs that this connection is bound to.', session);
      return new Promise((give) => {
        r.relay?.give({ exit: 'replaced by a newer waiter' });
        r.relay = { key: Number(context.waiter ?? 0), at: Date.now(), since, give };
        this.offer(session);
      });
    }
    if (params.push === true || context.role === 'mcp') {
      const agent = this.sessions.get(session)?.agent;
      if (context.session !== session || !placesItself(agent)) throw refuse('role', '/params/session', 'Wait only on the pi or paseo session this connection is bound to.', session);
      r.places = true;
    }
    if (params.poll === true) {
      // The planted Node waiter (waiter-polls) asks each time instead of being told.
      const rows = !r.holding ? await this.queue(() => this.waitingFor(session)) : [];
      if (!rows.length) return {};
      for (const row of rows) await this.outcome(row.id, 'next_prompt', 'delivered');
      return { session, text: this.answerText(rows) };
    }
    return new Promise((give) => {
      const waiter = { key: Number(context.waiter ?? 0), at: Date.now(), since, give: (reply: Obj) => give(reply) };
      const old = r.waiter;
      if (old && this.options.plant !== 'waiter-per-stop') {
        if (old.since > since) return give({ exit: 'replaced by a newer waiter' });
        old.give({ exit: 'replaced by a newer waiter' });
      }
      r.waiter = waiter;
      if (r.covered && this.options.plant !== 'routes-kept-across-sessions') r.shown.add('waiter');
      this.offer(session);
    });
  }
  /** The session that replaced this one in its process, if it hasn't itself been resumed since: its answers are bound to the old generation. */
  private async replacedBy(session: string): Promise<string | undefined> {
    const [row] = (await this.record.raw(`SELECT session_id FROM events WHERE kind = 'session.start' AND json_extract(data, '$.parent') = ?
      AND log_pos > (SELECT COALESCE(MAX(log_pos), 0) FROM events WHERE kind = 'session.start' AND session_id = ?) ORDER BY log_pos DESC LIMIT 1`, [session, session])) as { session_id: string }[];
    // Replaced in its own process: a start naming it as parent from anywhere else replaces nothing.
    const [was, now] = [this.sessions.get(session), row && this.sessions.get(row.session_id)];
    // A hub restarted since knows the old one by no process: the start that named it is what's left.
    return now && (!was || was.pid === 0 || (was.pid === now.pid && was.start === now.start)) ? row!.session_id : undefined;
  }
  /**
   * An answer of a session whose package places them (#40): refused when another session has replaced it, so it never
   * reaches the replacement; else handed to the package, unless the deep_ask or deep_wait still running returns it.
   */
  private async placeOrRefuse(session: string): Promise<void> {
    // A refusal is final: a session resumed later doesn't take what was refused for it.
    const refused = (await this.record.raw(`SELECT delivery FROM deliveries WHERE outcome = 'replaced'`)) as { delivery: string }[];
    // Its own: a fork shares its thread, and only the session that asked takes an answer or reports on it.
    const rows = (await this.waitingFor(session)).filter((row) => row.session === session && !this.askWaits.has(row.id) && !refused.some((d) => d.delivery === row.id));
    if (!rows.length) return;
    const successor = await this.replacedBy(session);
    const r = this.routes.get(successor && piAcceptsReplaced() ? successor : session);
    if (successor && !piAcceptsReplaced()) {
      for (const row of rows) await this.outcome(row.id, 'next_prompt', 'replaced');
      return;
    }
    if (!r?.places || !r.waiter) return;
    const placing = (r.placing ??= new Set());
    const fresh = rows.filter((row) => !placing.has(row.id));
    const waiter = r.waiter;
    if (!fresh.length) return;
    r.waiter = undefined;
    for (const row of fresh) placing.add(row.id);
    waiter.give({ session, text: this.answerText(fresh), asks: fresh.map((row) => row.id) });
  }
  /** What the package did with the answers it took: only the session that raised an ask reports on it. */
  private async placed(params: Obj, context: CallContext): Promise<Obj> {
    const session = String(params.session);
    const agent = this.sessions.get(session)?.agent;
    if (!context.session || context.session !== session || !placesItself(agent)) throw refuse('role', '/params/session', 'Report only on the pi or paseo session this connection is bound to.', session);
    const via = String(params.via);
    const outcome = String(params.outcome);
    if (!['steer', 'next_prompt'].includes(via)) throw refuse('enum', '/params/via', 'Say steer or next_prompt.', via);
    if (!['delivered', 'replaced'].includes(outcome)) throw refuse('enum', '/params/outcome', 'Say delivered or replaced.', outcome);
    const asks = Array.isArray(params.asks) ? params.asks.map(String) : [];
    for (const ask of asks) {
      const [row] = (await this.record.raw(`SELECT session_id, status FROM asks WHERE id = ?`, [ask])) as { session_id: string | null; status: string }[];
      if (!piAcceptsReplaced()) {
        if (row?.session_id !== session || row.status !== 'answered') throw refuse('not_found', '/params/asks', 'Report only on an answered ask this session raised.', ask);
        // Delivered is a word about what the hub handed over, or what a running call returned.
        if (outcome === 'delivered' && !this.routes.get(session)?.placing?.has(ask) && !this.askWaits.has(ask)) throw refuse('not_found', '/params/asks', 'Report only on an answer handed to this session.', ask);
      }
      this.askWaits.delete(ask);
      const [done] = (await this.record.raw(`SELECT 1 AS yes FROM deliveries WHERE delivery = ? AND outcome IN ('delivered', 'replaced')`, [ask])) as unknown[];
      if (done) continue;
      await this.outcome(ask, via as 'steer' | 'next_prompt', outcome as 'delivered' | 'replaced');
    }
    return { reported: asks.length };
  }
  /** Ends a running call's hold on its ask, and wakes the call: nothing about the ask landed to wake it (#823). */
  private stopAskWait(ask: string): void {
    this.askWaits.delete(ask);
    for (const wake of this.settling.get(`ask:${ask}`) ?? []) wake();
  }
  /** Stops this session's running deep_ask and deep_wait: the call was aborted, and its answer comes as a message of its own. */
  private stopWaiting(context: CallContext): Obj {
    for (const [ask, session] of [...this.askWaits]) if (session === context.session) this.stopAskWait(ask);
    // One answered as it was aborted: the call's reply went unread.
    if (context.session && this.sessions.get(context.session)?.agent === 'pi') { const session = context.session; void this.queue(() => this.placeOrRefuse(session)).catch(() => undefined); }
    return {};
  }
  /** The hooks whose deep-hook let them through before reading the hub's reply, by event ID: none of them is held. */
  private readonly abandoned = new Set<string>();
  /** The hooks whose reply the core is building, by event ID. */
  private readonly replying = new Set<string>();
  /** A held hook whose deep-hook is gone: its stop hold ends at once and delivers nothing, and an answer its reply carried reads stalled. */
  hookGone(id: string, session: string): void {
    if (this.replying.has(id)) this.abandoned.add(id);
    for (const wake of this.waiting.get(session) ?? []) wake();
    // What its reply carried never reached the agent (#906): stalled, unless a turn shows it, and it goes by the next route.
    for (const [ask, handed] of this.handed) if (handed.hook === id) void this.queue(() => this.unwoken(handed.session, ask)).catch(() => undefined);
    // The notices it carried wait for the session's next hook (#352).
    this.siblings.gone(id);
  }
  /**
   * A deep mcp call cancelled, or its connection `closed` (#1923): it leaves the job it waits on. A cancel stops the job
   * once no caller is left; a closed session never does, so the job runs on (#1925).
   */
  callGone(call: string, closed = false): void {
    this.jobKinds?.gone(call, closed);
  }
  /** A waiter whose connection closed: Claude Code stopped it, or it exited. */
  waiterGone(key: number): void {
    if (this.options.plant === 'delivered-to-dead-waiter') return;
    for (const [session, r] of this.routes) {
      if (r.relay?.key === key) r.relay = undefined;
      if (r.waiter?.key !== key) continue;
      r.waiter = undefined;
      // The running deep_ask went with it: its answer waits for the next waiter.
      if (r.places) for (const [ask, waiting] of this.askWaits) if (waiting === session) this.stopAskWait(ask);
    }
  }
  // ---- The verdict in the chat, and status from the record (#83; design: The verdict in the chat).

  /** The newest claim the session's line reads, and the turn it was made in. */
  private claimed(session: string, claim: string): void {
    const live = this.live.get(session);
    if (!live) return;
    live.claim = claim;
    live.claimTurn = live.turn;
    live.workedSinceClaim = false;
  }
  /** A claim's state from the record (verdict-chat), with the runs' expected times. */
  private stateOf(claim: string): Promise<ClaimState | undefined> {
    return claimState(this.raw, claim.replace(/^claim:/, ''), this.expected);
  }
  /**
   * A stop that is judged (design: Every stop is judged): one the stop rule (#303) reads as a claim, and a later
   * stop of the same turn with nothing changed since; undefined for any other. The pull request the turn opened is
   * recorded, and a turn with no claim yet gets one, as the agent's claim for the task its prompt named, at the
   * worktree's commit, or at the record's no-commit value (forty zeros) where the folder has none.
   */
  private async judging(meta: HookMeta): Promise<Live | undefined> {
    const live = this.live.get(meta.session);
    if (!live?.judged) return undefined;
    // A stop while a monitor's watch runs isn't final (#997): the turn is judged at the first stop after the watch ends.
    if (watching(live).length) return undefined;
    // The claims the rule made at this stop, for the locked ask-tasks (#303): the newest is the one the line reads.
    const made = (await live.claiming) ?? [];
    live.claiming = undefined;
    const newest = made[made.length - 1];
    if (newest) { this.claimed(meta.session, newest); return live; }
    // With none, the turn's claim stands while nothing changed since it: a stop after a send-back that changed code
    // claims anew, for the turn's own task.
    if (live.claim && live.claimTurn === live.turn && !live.workedSinceClaim) {
      // An agent paseo runs with no hooks of its own claims through deep_claim alone: its turn's end runs the gate on
      // that claim, the repo's spec checks at its commit (#55).
      if (unseenTools(meta.agent) && !this.lanes.has(live.claim)) await this.paseoClaim(meta, live.claim);
      return live;
    }
    // The head as the turn's last commits left it, read by the chain follow() started.
    await live.reading?.catch(() => undefined);
    const commit = live.head ?? (await headOf(meta.cwd).catch(() => undefined))?.sha ?? '0'.repeat(40);
    const ts = this.now();
    const id = ulid(ts);
    const task_ref = await this.turnTaskOf(meta.session, live);
    const [before] = (await this.record.raw(`SELECT COUNT(*) AS n FROM claims WHERE session_id = ? AND subject_ref = ?`, [meta.session, task_ref])) as { n: number }[];
    await this.append(this.connection('core', { session: meta.session, agent: live.agent }), { v: 2, id, kind: 'claim.made', ts, data: { task_ref, attempt: (before?.n ?? 0) + 1, commit, scope: 'session', predictions: [] } });
    this.claimed(meta.session, `claim:${id}`);
    // The claim (and any reading taken with it) lands behind the stop that ended the session's turn: its end is
    // recorded again after them, or an unclean restart would read the idle session as active and its claim as lost.
    if (live.state === 'finished' || live.state === 'failed') await this.attention(meta.session, live.agent, live.state);
    return live;
  }
  /** A deep_claim of a session paseo's plugin gates, judged on the repo's spec at the claim's commit (#55). */
  private async paseoClaim(meta: HookMeta, claim: string): Promise<void> {
    const [row] = (await this.record.raw(`SELECT data FROM events WHERE id = ? AND kind = 'claim.made'`, [claim.slice('claim:'.length)])) as { data: string }[];
    if (!row) return;
    const d = JSON.parse(row.data) as Obj;
    const commit = typeof d.commit === 'string' ? d.commit : '0'.repeat(40);
    await this.runClaim({ claim, session: meta.session, task: String(d.task_ref), commit, base: commit, cwd: meta.cwd, deliverables: [], requirements: [], checks: [], definition: 'pending' });
  }
  /** The turn's task: the one the prompt that opened the turn named, kept at the prompt; after a restart, the newest a person named; else the session's own. */
  private async turnTaskOf(session: string, live: Live): Promise<string> {
    const [prompt] = live.turnTask ? [] : (await this.record.raw(`SELECT json_extract(data, '$.tasks[0]') AS task FROM events WHERE session_id = ? AND kind = 'user.ask' AND json_extract(data, '$.from') = 'person' AND json_extract(data, '$.tasks[0]') IS NOT NULL ORDER BY log_pos DESC LIMIT 1`, [session])) as { task: string | null }[];
    return live.turnTask ?? prompt?.task ?? `session:${letters(session)}#0`;
  }
  /**
   * A monitor's watch ended (#997). Mid-turn, the turn's stop reads it; at an idle session the stop that went before is
   * final now: its row reads it again, and it is judged as it would have been with no watch, its claim made and its
   * checks started.
   */
  private async watchEnded(session: string, id: string, why: string): Promise<void> {
    const live = this.live.get(session);
    const b = live?.background.get(id);
    if (!live || !b?.watch) return;
    live.background.delete(id);
    if (live.state === 'working') return;
    await this.queue(() => this.appendReading(session, live.agent, `Its monitor ${backgrounded([b.what])} ended: ${why}.`)).catch(() => undefined);
    // Another watch still running keeps the row waiting on it; a wake that began a turn meanwhile is judged at its stop.
    if (watching(live).length) return void await this.queue(() => this.appendReading(session, live.agent, waitingOn(watching(live)))).catch(() => undefined);
    await this.judgeEnded(session);
  }
  /** Judges a turn that ended with no stop's reply to hold: its claim is made, its fast lane runs and its slow checks start. */
  private async judgeEnded(session: string): Promise<void> {
    const live = this.live.get(session);
    if (!live?.judged || live.state === 'working') return;
    live.claiming ??= (live.deferred ?? (async () => this.tasks.claim(session, live.agent, live.cwd)))().catch((): string[] => []);
    live.deferred = undefined;
    const judged = await this.queue(() => this.judging({ session, cwd: live.cwd } as HookMeta)).catch(() => undefined);
    // Judged here once: a later wake's stop with no work in it doesn't judge it again.
    live.judged = false;
    if (!judged?.claim) return;
    await this.laneOf(judged.claim, Date.now() + STOP_HOLD_MS);
    await this.gate.turnEnded(judged.claim, [...live.background.values()].map((x) => x.what), this.now(), { session, origin: live.turnFrom, due: null, starter: 'claim' }).catch(() => undefined);
  }
  /**
   * A session whose turn this hub's restart interrupted, with work the stop rule would read as a claim, is judged
   * from the start (#83): its stop is held for its line, as it would have been had the hub stayed up.
   */
  private async judgedAcrossRestart(): Promise<void> {
    const rows = (await this.record.raw(`SELECT id, agent, worktree FROM sessions WHERE status NOT IN ('finished', 'failed') AND id IN (${[...this.cursors.keys()].map(() => '?').join(', ') || "''"})`, [...this.cursors.keys()]).catch(() => [])) as { id: string; agent: string | null; worktree: string | null }[];
    for (const row of rows) {
      if (!this.stopRule(await this.counterOf(row.id))) continue;
      // A session the spool replay already brought back keeps what the replay knew of it.
      const live = this.live.get(row.id);
      if (live) live.judged = true;
      else this.live.set(row.id, { agent: row.agent ?? 'claude-code', cwd: row.worktree && row.worktree !== '-' ? row.worktree : '', last: 0, calls: new Map(), wakeups: [], crons: new Map(), background: new Map(), looping: false, turn: 0, judged: true });
    }
    // Told before the hub reports ready, so the stop that comes first is held.
    await this.askingNow();
  }
  /** The line a judged stop carries, from the record as it stands now, never from the agent's words. */
  private async judgedLine(live: Live): Promise<string> {
    const state = live.claim && live.claimTurn === live.turn ? await this.stateOf(live.claim) : undefined;
    // #669's planted line: PASS whatever the record holds, with no verdict behind it.
    if (this.options.plant === 'line-pass-without-verdict') return verdictLine({ outcome: 'PASS', requirements: (state?.state.requirements ?? []).map((r) => ({ ...r, outcome: 'PASS' as const })), running: [], tests: state?.state.tests ?? 0 });
    return verdictLine(state ? state.state : { outcome: null, requirements: [], running: [] });
  }
  /** A line that changed since the chat last saw one, for the session's next prompt (Codex hears a late verdict there); undefined otherwise. */
  private async landedLine(session: string): Promise<string | undefined> {
    const live = this.live.get(session);
    if (!live) return undefined;
    // After a restart the newest claim is the record's; its line may show once more, never go unseen.
    live.claim ??= await newestClaim(this.raw, session).then((id) => (id ? `claim:${id}` : undefined));
    if (!live.claim) return undefined;
    const state = await this.stateOf(live.claim);
    if (!state) return undefined;
    const line = await this.heldLine(session, verdictLine(state.state));
    if (line === live.delivered) return undefined;
    live.delivered = line;
    return line;
  }
  /**
   * The pull request a session opened with `gh pr create`, read from the call's own PostToolUse (hookmap) and
   * recorded once as a session.reading, for the receipt (#83); a Codex session's too, whose rollout is never read.
   */
  private async openedPr(session: string, agent: string, url: string): Promise<void> {
    const reading = `Opened pull request ${url}`;
    const [seen] = await this.record.raw(`SELECT 1 FROM events WHERE session_id = ? AND kind = 'session.reading' AND json_extract(data, '$.reading') = ? LIMIT 1`, [session, reading]);
    if (!seen) await this.appendReading(session, agent, reading);
  }
  /** What a Codex stop's own records say (#39): its goal and heartbeat as the stop's loop, each new reading once. */
  private async codexStop(meta: HookMeta, data: Obj, live: Live): Promise<void> {
    const read = await codexReadings(meta.session, meta.transcript, meta.fields?.turn_id, live.from === 'continuation');
    if (read.loop) data.loop = read.loop;
    live.looping = read.loop?.state === 'looping' || live.looping;
    // A session's newest windows are what the runner admits the account's Codex jobs by.
    if (read.limits && read.account) await this.runner.report({ agent: 'codex', account: read.account, rate_limits: read.limits } as unknown as WindowReport).then(() => this.tasks.windowChanged()).catch(() => undefined);
    const readings = read.version && !loopsCovered(read.version) && coveredBy('codex', read.version) ? [uncoveredLoops(read.version)] : read.readings;
    const before = (await this.record.raw(`SELECT json_extract(data, '$.reading') AS reading FROM events WHERE session_id = '${sql(meta.session)}' AND kind = 'session.reading' AND json_extract(data, '$.reading') LIKE 'Codex %: %' ORDER BY log_pos`)) as { reading: string }[];
    const standing = standingReadings(before.map((b) => b.reading));
    if (readings === read.readings) for (const gone of heartbeatsGone(standing, readings)) await this.appendReading(meta.session, meta.agent, gone);
    for (const reading of readings) if (!stands(standing, reading)) await this.appendReading(meta.session, meta.agent, reading);
  }
  /** The pull request a session opened, as its readings record it: the newest. */
  private async prOf(session: string | null): Promise<string | undefined> {
    if (!session) return undefined;
    const [row] = (await this.record.raw(`SELECT json_extract(data, '$.reading') AS reading FROM events WHERE session_id = ? AND kind = 'session.reading' AND json_extract(data, '$.reading') LIKE 'Opened pull request %' ORDER BY log_pos DESC LIMIT 1`, [session])) as { reading: string }[];
    return row ? prUrlIn(row.reading) : undefined;
  }
  /**
   * A status question a person typed ("still going?", "all done?", "what's next?", "anything for me?"), answered from
   * the record with no model call: the answer the prompt is blocked with. Undefined for any other prompt, and for
   * the same words from a scheduled task, a subagent's report, another session or a prompt the adapter can't place.
   */
  private async statusReply(meta: HookMeta): Promise<string | undefined> {
    const prompt = meta.fields?.prompt ?? '';
    // #669's planted wrong program: a status question goes on to the model as any prompt does.
    if (!isStatusQuestion(prompt) || this.options.plant === 'status-from-model') return undefined;
    // The prompt's origin as the hook mapped it: kept at the splice for one the transcript's queue had shown first
    // (#25), else on its own event, once its append has settled (one that never lands has no origin: not a person's).
    const spliced = this.sessions.get(meta.session)?.spliced;
    let from = spliced?.get(meta.id)?.from;
    spliced?.delete(meta.id);
    if (from === undefined) {
      await Promise.allSettled([...this.inflight]);
      const [row] = (await this.record.raw(`SELECT json_extract(data, '$.from') AS f FROM events WHERE id = ?`, [meta.id])) as { f: string | null }[];
      from = row ? row.f ?? 'unknown' : undefined;
    }
    if (from !== 'person') return undefined;
    const live = this.live.get(meta.session);
    // A turn newer than the claim's that has not finished (going, waiting, stuck, failed or gone quiet) answers with
    // the session's own state, whatever the earlier claim says; one that finished unjudged has no claim of its own.
    // With no claim at all the session's own state answers too.
    const unjudged = live?.state !== undefined && live.claimTurn !== live.turn && live.state !== 'finished';
    const claim = unjudged ? undefined : live?.claim ?? (await newestClaim(this.raw, meta.session).then((id) => (id ? `claim:${id}` : undefined)));
    const state = claim ? await this.stateOf(claim) : undefined;
    const [stop] = (await this.record.raw(`SELECT MAX(ts) AS at FROM events WHERE session_id = ? AND kind = 'agent.stop' AND json_extract(data, '$.child') IS NULL`, [meta.session])) as { at: number | null }[];
    // The list's one count (#1463): its ask rows, as deep and the app count them.
    await this.statesSettled();
    const needsYou = [...this.rows.keys()].filter((id) => id.startsWith('ask:')).length;
    return statusAnswer(state, { session: meta.session, agent: live?.agent ?? meta.agent, worktree: live?.cwd || meta.cwd, needsYou, now: this.now(), lastStop: stop?.at ?? null, state: claim ? undefined : live?.state });
  }
  /**
   * test.verdict: a record state planted on a session's claim, by the events the core's gate would append (the
   * server serves it only with DEEP_HUB_TEST_VERDICT=1, to the CLI): a verdict.made with the given requirement
   * outcomes, a claim.sent_back for a FAIL's round, a run.started and run.finished for each check that ran, and a
   * run.started for each still going, with its expected time. The line and the receipt then read the record alone.
   */
  private async testVerdict(params: Obj): Promise<Obj> {
    const session = typeof params.session === 'string' ? params.session : undefined;
    const claim = typeof params.claim === 'string' && /^claim:[0-9A-Za-z]+$/.test(params.claim) ? params.claim : undefined;
    if (!session || !claim) throw refuse('type', '/params', 'Name the session and the claim (claim:<id>).', params);
    const [row] = (await this.record.raw(`SELECT commit_sha FROM claims WHERE id = ?`, [claim.slice(6)])) as { commit_sha: string | null }[];
    if (!row) throw new Refused(refusal('not_found', '/params/claim', `No claim ${claim} in the record.`, claim));
    const commit = row.commit_sha && /^[0-9a-f]{40}$/.test(row.commit_sha) ? row.commit_sha : '0'.repeat(40);
    const agent = this.live.get(session)?.agent ?? this.sessions.get(session)?.agent ?? 'claude-code';
    const core = this.connection('core', { session, agent });
    const ran = Array.isArray(params.ran) ? (params.ran as { check: string; outcome: string }[]) : [];
    const running = Array.isArray(params.running) ? (params.running as { check: string; about_s: number }[]) : [];
    const started = async (check: string): Promise<string> => {
      const ts = this.now();
      const run = `run:${ulid(ts)}`;
      await this.append(core, { v: 1, id: ulid(ts), kind: 'run.started', ts, subject: run, data: { run, check, claim, commit } });
      return run;
    };
    for (const r of ran) {
      const run = await started(r.check);
      const ts = this.now();
      await this.append(core, { v: 1, id: ulid(ts), kind: 'run.finished', ts, subject: run, data: { run, outcome: r.outcome, tests_run: 1, passed: r.outcome === 'passed' ? 1 : 0, runs: 1, evidence: [], check: r.check, assertion: null, expected: null, actual: null, step: null, points_to: null, findings: [], environment: 'test' } });
    }
    for (const r of running) this.expected.set(await started(r.check), Number(r.about_s));
    const outcome = params.outcome;
    if (typeof outcome !== 'string') return { planted: true, verdict: null };
    const reqs = (Array.isArray(params.requirements) ? (params.requirements as Obj[]) : []).map((r) => ({
      req: String(r.req), outcome: String(r.outcome), check: String(r.check ?? 'unit'), depth: 'unit', oracle: 'code', runs: { clean: 0, needed: 0, counted: [] },
      smallest: typeof r.smallest === 'string' ? r.smallest : null, points_to: typeof r.points_to === 'string' ? r.points_to : null, evidence: [], proof: 'test_run',
    }));
    const failing = reqs.find((r) => r.outcome === outcome && r.smallest);
    const ts = this.now();
    const id = ulid(ts);
    const verdict = `verdict:${id}`;
    await this.append(core, {
      v: 1, id, kind: 'verdict.made', ts, subject: claim,
      data: { outcome, verdict, claim, reasons: [], requirements: reqs, smallest: failing?.smallest ?? null, points_to: failing?.points_to ?? null, commit, key: { commit, doc_revisions: [], check_digests: [], state_digests: [], environment: 'test', tools: [] } },
    });
    if (outcome === 'FAIL' && typeof params.round === 'number') {
      const at = this.now();
      await this.append(core, { v: 1, id: ulid(at), kind: 'claim.sent_back', ts: at, subject: claim, data: { claim, verdict, round: params.round, to: `session:${letters(session)}` } });
    }
    return { planted: true, verdict };
  }

  /**
   * test.clock: the hub's clock steps forward (the hub runs with DEEP_HUB_TEST_CLOCK_STEPS=1), and what the gate
   * runner timed on it comes due now (#965).
   */
  private testClock(params: Obj): Obj {
    const step = params.advance_ms;
    if (typeof step !== 'number' || !Number.isSafeInteger(step) || step < 0) throw refuse('type', '/params/advance_ms', 'Step the clock by a whole number of ms, 0 or more.', step);
    this.options.clock.start += step;
    this.stepped += step;
    this.gate.tick();
    void this.quietDue().catch(() => undefined);
    return { now: this.now() };
  }
  /** test.send_back: a send-back planted for the session's next stop (the hub runs with DEEP_HUB_TEST_SEND_BACK=1). */
  private sendBack(params: Obj): Obj {
    if (typeof params.session !== 'string' || typeof params.reason !== 'string') throw refuse('type', '/params', 'Name the session and the reason, as strings.', params);
    this.routesOf(params.session).sendBacks.push(params.reason);
    this.askingSoon();
    return { planted: true };
  }
  /**
   * A wait on `key`, woken by whoever wakes `waits` for it, by the hub stopping or after `ms`. It counts from the
   * call, so a wake that comes while the caller still reads what it waits on isn't missed; `cancel` ends it.
   */
  private wakeable(waits: Map<string, Set<() => void>>, key: string, ms: number): { woken: Promise<void>; cancel: () => void } {
    const set = waits.get(key) ?? new Set();
    waits.set(key, set);
    let wake = (): void => undefined;
    const woken = new Promise<void>((done) => {
      wake = () => {
        clearTimeout(timer);
        set.delete(wake);
        if (!set.size && waits.get(key) === set) waits.delete(key);
        done();
      };
    });
    const timer = setTimeout(wake, Math.max(0, ms));
    set.add(wake);
    return { woken, cancel: wake };
  }

  /** The hook kinds some loaded extension handles, read once the extensions have started. */
  hooks(): string[] {
    return this.extensions?.hooks() ?? [];
  }
  /**
   * The extensions' joined reply to a tool.before, or null when it takes the hook's fail-open policy: while appends
   * fail every gate is watch-only, and the extensions' denies and context go with them. A handler that failed is
   * named on stderr; its reply is already out of the join.
   */
  async extensionHook(data: unknown): Promise<ExtensionReply | null> {
    if (this.blocked || !this.extensions) return null;
    const reply = await this.extensions.hook({ kind: 'tool.before', data, deadline: EXTENSION_HOOK_MS, bound: contextBoundFor(EXTENSION_HOOK_MS) });
    for (const { reason } of reply.failed) process.stderr.write(`deep hub: tool.before handler failed: ${reason}\n`);
    return { denies: reply.denies, context: reply.context };
  }

  /** Records, once, that a call the hub answered was let through by deep-hook as late, naming its guard entries. */
  private async lateAnswered(meta: HookMeta, matched: string[]): Promise<void> {
    const reading = `deep-hook let ${meta.event} ${meta.id} through as late, after the hub's answer missed its deadline; `
      + (matched.length ? `it matched ${matched.join(', ')}` : 'it matched no guard entry');
    // The ID is a ULID (checked before this is called), so it goes into the query as it is.
    const known = await this.record.raw(`SELECT 1 FROM events WHERE kind = 'session.reading' AND instr(json_extract(data, '$.reading'), ?) > 0 LIMIT 1`, [meta.id]);
    if (known.length) return;
    await this.appendReading(meta.session, meta.agent, reading);
  }

  /**
   * Reads what the session's transcript gained since the last hook. A turn there that made tool calls, none of
   * whose hooks reached the hub, is recorded once the next prompt shows it ended and a later hook judges it: the
   * session then reads "hooks not reaching DeepBuild", so failing open is never silent.
   */
  private async readTranscript(session: Session): Promise<void> {
    let handle: FileHandle;
    try {
      handle = await open(session.transcript, 'r');
    } catch {
      return;
    }
    try {
      const { size } = await handle.stat();
      // At most TRANSCRIPT_STEP is held at once: more growth than that is read a step at a time.
      while (size > session.read) {
        const want = Buffer.alloc(Math.min(size - session.read, TRANSCRIPT_STEP));
        // Only the bytes the read returned: a transcript cut shorter since the stat returns fewer.
        const { bytesRead } = await handle.read(want, 0, want.length, session.read);
        if (!bytesRead) return;
        const text = want.subarray(0, bytesRead);
        // Only whole lines: a line still being written is read with the next hook. A line longer than a step is
        // passed over; what is left of it doesn't parse, as no prompt or call longer than a step would.
        let end = text.lastIndexOf(0x0a) + 1;
        if (!end) {
          if (text.length < TRANSCRIPT_STEP) return;
          end = text.length;
        }
        const base = session.read;
        session.read += end;
        for (let at = 0; at < end;) {
          const from = base + at;
          const next = text.indexOf(0x0a, at) + 1 || end;
          const raw = text.subarray(at, next).toString('utf8');
          at = next;
          let line: unknown;
          try {
            line = JSON.parse(raw);
          } catch {
            continue;
          }
          // A message typed while the agent works waits in the queue, with no hook until it is dequeued (#80). The
          // desktop app queues every prompt and dequeues it at once (#340): one no hook found waiting never waited.
          if (isObj(line) && line.type === 'queue-operation') {
            const queue = session.queued ??= [];
            if (line.operation === 'enqueue' && typeof line.content === 'string') queue.push({ text: line.content, taken: false });
            // The planted wrong program counts every enqueue, the app's own before each prompt included.
            else if (line.operation === 'dequeue' && this.options.plant !== 'counts-every-enqueue') queue.shift();
            if (queue.length > 64) queue.splice(0, queue.length - 64);
          }
          if (!isObj(line) || line.isSidechain === true || !isObj(line.message)) continue;
          const content = line.message.content;
          const parts = Array.isArray(content) ? content.filter(isObj) : [];
          const prompt = line.type === 'user' && !(parts.length && parts.every((c) => c.type === 'tool_result'));
          if (line.type === 'user' && !prompt) {
            const results = session.results ??= [];
            for (const part of parts) if (part.type === 'tool_result' && typeof part.tool_use_id === 'string') results.push(part.tool_use_id);
            if (results.length > 64) results.splice(0, results.length - 64);
          }
          // A prompt's entry, which its origin joins to, opens the turn whose records its stop reads.
          if (prompt && typeof line.promptId === 'string') {
            if (session.prompts.size >= 256) session.prompts.delete(session.prompts.keys().next().value!);
            session.prompts.set(line.promptId, line);
            session.entries = [line];
          } else if (session.entries.length < TURN_ENTRIES) session.entries.push(line);
          if (prompt) {
            // A person's prompt ends the turn before it.
            if (session.turn?.calls.length) session.closed.push({ ...session.turn, at: performance.now() });
            session.turn = { uuid: typeof line.uuid === 'string' && line.uuid ? line.uuid : `offset:${from}`, from, calls: [] };
          } else if (line.type === 'assistant' && session.turn) {
            for (const part of parts) if (part.type === 'tool_use' && typeof part.id === 'string') session.turn.calls.push(part.id);
          }
        }
      }
    } catch {
      // A transcript that can't be read now is read from the same place with the next hook.
    } finally {
      await handle.close();
    }
  }

  /** A session's last turn ends with it: no prompt comes after it to end it. */
  private endTurn(session: Session): void {
    if (session.turn?.calls.length) session.closed.push({ ...session.turn, at: performance.now() });
    session.turn = undefined;
  }

  /**
   * Judges the turns whose end the hub read at least TURN_GRACE ago, on its own monotonic clock: a hook started
   * before that read has reached the hub by then, since deep-hook gives up on the hub after 20 ms and spools. While
   * a replay runs, or a spool waits for one, the turns wait for it: one of their hooks may be there. A turn none of
   * whose calls reached the hub is recorded. Turns still in their grace are judged by a timer.
   */
  private judge(session: Session): void {
    if (session.closed.length) this.replayLate();
    if (this.replaying) {
      session.deferred = true;
      return;
    }
    const now = performance.now();
    const waits = (turn: Turn) => turn.calls.some((call) => session.pending.has(call));
    for (const turn of session.closed.filter((t) => !t.recording && now - t.at! >= TURN_GRACE)) {
      if (waits(turn)) break;
      if (turn.calls.some((call) => session.reached.has(call))) {
        for (const call of turn.calls) session.reached.delete(call);
        session.closed.splice(session.closed.indexOf(turn), 1);
        continue;
      }
      turn.recording = true;
      // Settled like a hook's drafts: the next hook doesn't wait for its commit. The turn, and so where a restart
      // reads from, stays until its reading is durable; one whose append fails is judged again with the next hook.
      void this.appendReading(session.id, session.agent, HOOKS_MISSING).then(() => {
        session.closed.splice(session.closed.indexOf(turn), 1);
        this.saveCursors();
      }, () => {
        turn.recording = false;
      });
    }
    const next = session.closed.find((t) => !t.recording);
    if (next && !waits(next) && !session.judging && !this.stopping) {
      session.judging = setTimeout(() => {
        session.judging = undefined;
        void this.queue(async () => this.judge(session), true).catch(() => undefined);
      }, Math.max(1, TURN_GRACE - (now - next.at!)));
      session.judging.unref();
    }
    // Calls no read turn holds (a subagent's) are forgotten oldest first; a read turn's are kept until it's judged.
    if (session.reached.size > REACHED) {
      const held = new Set([...session.closed, ...(session.turn ? [session.turn] : [])].flatMap((t) => t.calls));
      for (const call of session.reached) {
        if (session.reached.size <= REACHED) break;
        if (!held.has(call)) session.reached.delete(call);
      }
    }
    this.saveCursors();
  }

  /** Keeps where each live session's transcript is judged from (its oldest unjudged turn), so a restart judges what it missed. */
  private saveCursors(): void {
    if (this.saving || this.stopping) return;
    this.saving = setTimeout(() => this.writeCursors(), CURSOR_SAVE);
    this.saving.unref();
  }
  private writeCursors(): void {
    clearTimeout(this.saving);
    this.saving = undefined;
    const cursors = new Map(this.cursors);
    for (const s of this.sessions.values()) {
      cursors.delete(s.id);
      // An ended session is kept until its last turns are judged and their readings durable.
      if (s.ended && !s.closed.length) continue;
      cursors.set(s.id, { transcript: s.transcript, read: s.closed[0]?.from ?? s.turn?.from ?? s.read, reached: [...s.reached], ...(s.ended ? { ended: { agent: s.agent } } : {}), ...(s.watched && !s.ended ? { watch: { agent: s.agent, pid: s.pid, start: s.start } } : {}) });
    }
    // Synced, so a power cut leaves the last whole save; a failed save is made again with the next hook's.
    try {
      writeSynced(this.root.transcripts, Buffer.from(JSON.stringify(Object.fromEntries(cursors))));
    } catch (error) {
      process.stderr.write(`deep hub: ${this.root.transcripts} not saved: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  /**
   * Whose a hook is: a job's, when its session ID is the one the runner read from that job's own output and it was
   * sent inside the job's run; held, when it comes from a running job's folder before that ID is read; otherwise
   * the session's own, with a reading when it only looks like a job's.
   */
  private async whose(meta: HookMeta, seq: string | undefined): Promise<{ job?: string; wait?: string; reading?: { job: string; text: string } }> {
    const jobs = await this.runner.list();
    const at = seq ? Number(BigInt(seq) / 1_000_000n) : Date.now();
    const during = (j: JobRecord) => j.ran !== undefined && at >= j.ran.from && (j.ran.to === undefined || at <= j.ran.to);
    const own = jobs.find((j) => meta.session && j.session === meta.session && during(j));
    if (own) return { job: own.job };
    const there = jobs.find((j) => meta.cwd && (meta.cwd === j.folder || isUnder(meta.cwd, j.folder)));
    if (there && there.session === undefined && (there.state === 'running' || there.state === 'stopping')) return { wait: there.job };
    const resumed = jobs.find((j) => meta.session && j.session === meta.session);
    if (resumed) return { reading: { job: resumed.job, text: `It resumes the session ID of DeepBuild's job ${resumed.job}, which it is not: it is judged as your own session.` } };
    if (there) return { reading: { job: there.job, text: `It works in the folder of DeepBuild's job ${there.job} (${there.folder}), which it is not: it is judged as your own session.` } };
    return {};
  }
  /** Resolves once the runner has read the job's session ID, or the job has ended without one. */
  private park(job: string): Promise<void> {
    let parked = this.parked.get(job);
    if (!parked) {
      parked = (async () => {
        for (;;) {
          const rec = await this.runner.status(job).catch(() => undefined);
          if (!rec || rec.session !== undefined || (rec.state !== 'running' && rec.state !== 'stopping')) return;
          await new Promise((done) => setTimeout(done, 50));
        }
      })();
      this.parked.set(job, parked);
      void parked.finally(() => this.parked.delete(job));
    }
    return parked;
  }

  /** A process's start time, or undefined when it can't be read. Read from the children's thread, never this one or the event loop. */
  private startOf(pid: number, fresh = false): Promise<string | undefined> {
    const known = this.starts.get(pid);
    if (known && !fresh) return known;
    const read = startOf(pid);
    // A fresh read replaces the kept one once it is in: a hook's check meanwhile reads the kept one, never waits on it.
    // One that fails keeps the kept one, since a failed ps proves nothing about the process.
    if (known) void read.then((start) => { if (start !== undefined) this.starts.set(pid, read); });
    else this.starts.set(pid, read);
    return read;
  }

  /**
   * Whether an event can be checked against the session it claims: its transcript under its agent's home, its
   * working folder and its process tree (its hook's parent, by PID and start time) all as the session's own
   * hooks established them. The first checked event of a session establishes it.
   */
  private async verify(meta: HookMeta): Promise<boolean> {
    // A Codex hook may carry no transcript path (its facts: `transcript_path: string|null`); such a session is checked by
    // its working folder and process tree alone, and nothing is read from a transcript for it (#806).
    // paseo's plugin keeps no transcript: its sessions are checked by working folder and the plugin's process (#55).
    const none = (meta.agent === 'codex' && !meta.transcript) || meta.agent === 'paseo';
    if (!meta.session || !meta.cwd || (!none && !isAbsolute(meta.transcript))) return false;
    const homes = meta.agent === 'codex' ? sessionHomes(this.root.dir) : [join(homedir(), '.claude', 'projects')];
    const transcript = none ? '' : resolve(meta.transcript);
    // pi's --session-dir puts a session's file anywhere; its package runs inside pi, and pi's process is what is checked.
    if (!none && meta.agent !== 'pi' && !homes.some((home) => isUnder(transcript, home))) return false;
    const start = await this.startOf(meta.ppid);
    if (!start) return false;
    const session = this.sessions.get(meta.session);
    // A Codex subagent's SubagentStart names the child's own rollout, whose file ends in its agent_id, with the root's session ID.
    const child = meta.agent === 'codex' && meta.fields?.agent_id && transcript.endsWith(`-${meta.fields.agent_id}.jsonl`);
    if (!session) {
      // A child's rollout is no root's: the root's own next hook establishes the session.
      if (child) return false;
      // A session the last hub met is read from where that hub left it; one this hub meets first, from here on:
      // what its transcript held before isn't judged.
      const cursor = this.cursors.get(meta.session);
      this.cursors.delete(meta.session);
      const left = cursor?.transcript === transcript && typeof cursor.read === 'number' && Array.isArray(cursor.reached) ? cursor : undefined;
      const read = left ? left.read : none ? 0 : await stat(transcript).then((s) => s.size, () => 0);
      const watched = left?.watch?.pid === meta.ppid && left.watch.start === start;
      this.sessions.set(meta.session, { id: meta.session, thread: meta.session, agent: meta.agent, pid: meta.ppid, start, cwd: meta.cwd, transcript, ended: false, watched, read, turn: undefined, closed: [], reached: new Set(left?.reached), pending: new Map(), prompts: new Map(), entries: [] });
      // A session's first cursor is written at once: a restart before it would read the session from its end.
      this.writeCursors();
      return true;
    }
    // A Codex thread's identity is its payload's: resumed in a new Codex process, once the old one is gone or the session
    // ended, it is bound to that process from its start. A Claude Code session resumed in a new process (`--resume`, the
    // desktop app opened again) is too, by its own resume start (#1033).
    const binary = meta.agent === 'codex' ? CODEX_BINARY : meta.agent === 'claude-code' || meta.agent === 'claude' ? CLAUDE_BINARY : undefined;
    const resumed = meta.fields?.source === 'resume' || (meta.agent === 'codex' && meta.fields?.source === 'startup');
    if (binary && transcript === session.transcript && meta.event === 'SessionStart' && resumed
      && (session.ended || await this.startOf(session.pid, true) !== session.start) && binary.test(await this.parentArgs(meta))) {
      Object.assign(session, { pid: meta.ppid, start, cwd: meta.cwd, ended: false, interrupted: false, watched: false });
      return true;
    }
    // pi resumes a session from a new process, by its file: its start takes the session over once the old process is gone.
    const gone = async () => {
      if (!session.pid) return true;
      const was = await this.startOf(session.pid, true);
      return was === undefined ? !running(session.pid) : was !== session.start;
    };
    if (meta.agent === 'pi' && session.agent === 'pi' && meta.event === 'SessionStart' && transcript === session.transcript && await gone()) {
      Object.assign(session, { pid: meta.ppid, start, cwd: meta.cwd, watched: false });
      return true;
    }
    const own = ((child && meta.event === 'SubagentStart') || transcript === session.transcript) && meta.cwd === session.cwd && meta.ppid === session.pid && start === session.start;
    if (own && !session.watched) { session.watched = true; this.saveCursors(); }
    return own;
  }

  /**
   * Past the newest ENDED_KEPT to end, an ended session with its turns judged and no call pending goes, with what the
   * core kept for it (#824): the record holds it, and a `/clear` or a late reading only ever looks at one that just ended.
   */
  private forgetEnded(): void {
    for (const id of this.endedOrder) if (!this.sessions.get(id)?.ended) this.endedOrder.delete(id);
    // A stack it still owns asks whether it lives, and only one in memory can answer that it ended.
    const owning = this.stacks.holders();
    const ended = [...this.endedOrder].filter((id) => { const s = this.sessions.get(id)!; return !s.closed.length && !s.pending.size && !owning.has(`mcp:${id}`); });
    for (const id of ended.slice(0, Math.max(0, ended.length - ENDED_KEPT))) {
      this.endedOrder.delete(id);
      // Its agent's start time, kept for the checks of its hooks; a watch has no process of its own.
      const pid = this.sessions.get(id)!.pid;
      if (pid && ![...this.sessions.values()].some((s) => s.id !== id && s.pid === pid)) this.starts.delete(pid);
      this.sessions.delete(id);
      for (const kept of [this.lastMessage, this.counters, this.typedAt, this.projects, this.tasted, this.idleSent, this.completions, this.tails]) kept.delete(id);
      this.nudgeable.delete(id);
      this.versioned.delete(id);
      this.miscalled.delete(id);
      this.firstPrompted.delete(id);
      this.startChecked.delete(id);
      for (const reading of this.readings) if (reading.startsWith(`${id}\0`)) this.readings.delete(reading);
      // Its answers whose delivery timed out: only its next prompt reads for them, and the record keeps them undelivered.
      for (const [ask, session] of this.unread) if (session === id) this.unread.delete(ask);
    }
  }

  /** Binds a deep mcp to the one live session whose checked hooks came from its parent process, or to none. */
  mcpHello(parent: { pid: number; start: string } | undefined, paseo?: string): Promise<string | null> {
    return this.queue(async () => {
      // A server paseo's plugin added names its agent's session by the token the plugin's lines carry (#55).
      const bound = paseo ? this.binds.get(paseo) : undefined;
      if (bound && !this.sessions.get(bound)?.ended) return bound;
      if (!parent) return null;
      const actual = await this.startOf(parent.pid, true);
      if (!actual || actual !== parent.start) return null;
      const served = [...this.sessions.values()].filter((s) => s.pid === parent.pid && s.start === actual && !s.ended);
      // A Codex process may run another thread at any time: each of its calls binds by its own stamp.
      return served.length === 1 && !manyThreads(served[0]!.agent) ? served[0]!.id : null;
    });
  }

  /** The sessions' rows; one paseo runs whose answer no route could carry reads "answer waiting" (#55). */
  private async sessionRows(seen = ''): Promise<Record<string, unknown>[]> {
    let rows = (await this.record.table('sessions')).rows as Record<string, unknown>[];
    // A reader sees a session whose events it may see (#1337).
    if (seen) {
      const visible = new Set(((await this.record.raw(`SELECT DISTINCT session_id AS id FROM events WHERE session_id IS NOT NULL${seen}`)) as { id: string }[]).map((r) => r.id));
      rows = rows.filter((row) => visible.has(String(row.id)));
    }
    for (const id of [...this.answerWaiting]) if (!(await this.waitingFor(id)).length) this.answerWaiting.delete(id);
    // The session map (#352): each session's repo, branch, issue and changed files, the commands it runs now, its leases and its state.
    const leases = (await this.record.raw(`SELECT kind, key, holder FROM leases WHERE state = 'held'`)) as { kind: string; key: string; holder: string }[];
    return rows.map((row) => {
      const id = String(row.id);
      const placed = this.siblings.row(id);
      const map = placed && {
        ...placed, running: [...(this.live.get(id)?.calls.values() ?? [])].filter((c) => c.ended === undefined).map((c) => c.what),
        leases: leases.filter((l) => l.holder === `session:${letters(id)}`).map((l) => `${l.kind} ${l.key}`), state: row.status,
      };
      // A session DeepBuild started shows its run and what its agent's own sandbox holds (#1330).
      const started = this.sessionStarts.rowOf(id);
      return { ...row, ...(started ? { run: started.run, sandbox: started.sandbox } : {}), ...(map ? { map } : {}), ...(this.answerWaiting.has(id) ? { delivery: 'answer waiting: neither deep-hook\'s waiter nor paseo\'s plugin can carry it, so it goes with the session\'s next prompt' } : {}) };
    });
  }

  // ---- Methods.

  /**
   * One socket method. It sees every hook that arrived before it, but holds the queue only to bind a deep_*
   * call to its session, so a long call (a run's start, a file read, a test load) holds up no session's hooks.
   */
  call(method: string, params: unknown, context: CallContext): Promise<unknown> {
    const p = isObj(params) ? params : {};
    if (method === 'mcp.call') return this.mcpCall(p, context);
    return this.queue(async () => undefined).then(() => this.dispatch(method, p, context));
  }
  private async dispatch(method: string, params: Obj, context: CallContext): Promise<unknown> {
    switch (method) {
      case 'hub.health':
      case 'health': return this.health();
      case 'session.wait': return this.waitAnswer(params, context);
      case 'session.delivered': return this.placed(params, context);
      case 'session.stop_waiting': return this.stopWaiting(context);
      case 'session.note': return this.note(params);
      case 'test.send_back': return this.sendBack(params);
      case 'test.verdict': return this.testVerdict(params);
      case 'test.clock': return this.testClock(params);
      case 'events.read': return this.log.read(params, this.seenBy(context.role));
      // Behind the state pass under way, so the rows it holds are the asks as they stand (#1463).
      case 'inbox.read': return this.statesSettled().then(() => this.log.reflecting(() => this.inbox()));
      case 'sessions.read': return this.log.reflecting(async () => ({ sessions: await this.sessionRows(this.seenBy(context.role)) }));
      case 'person.add': return this.addPerson(params, context);
      case 'library.on': case 'library.off': case 'library.rule': return this.library(method, params, context);
      case 'pack.rule': return this.packRule(params, context);
      case 'job.rule': return this.jobRule(params, context);
      case 'person.invite': return this.invitePerson(params, context);
      case 'person.revoke': return this.revokePerson(params, context);
      // An invite spent over the network (#1338): only the server's network hello calls it, with the key the joining machine proved.
      case 'person.join': {
        if (context.role !== 'network' || typeof params.key !== 'string') throw new Refused(refusal('role', '/method', 'An invite is spent only over the network, by the machine that proves its key.', method));
        const joined = this.people.redeem(params.invite, params.key);
        if (!joined) throw new Refused(refusal('credential', '/invite', 'This invite is spent, lapsed or not one this hub issued.'));
        return joined;
      }
      case 'numbers.read': return this.log.reflecting(async () => {
        const read = await this.numbers.read() as unknown as { rows: unknown[] };
        return { ...read, rows: [...read.rows, await this.handbacks()] } as unknown as Obj;
      });
      case 'numbers.baseline': await this.notAnAgent(context, method); return this.numbers.baseline(String(params.manifest));
      case 'race.start': return this.race(params, context);
      case 'numbers.refresh': await this.notAnAgent(context, method); return this.numbers.refresh();
      case 'numbers.sample': await this.notAnAgent(context, method); return this.numbers.sample(Number(params.before), typeof params.manifest === 'string' ? params.manifest : undefined);
      case 'changes.read': return this.change(params);
      case 'evidence.read': return this.evidence(params);
      case 'ask.answer': return this.answer(params, context);
      case 'ask.card': return this.askCard(params);
      case 'decision.overrule': return this.overrule(params, context);
      case 'ask.undo': return this.undo(params, context);
      case 'ask.take_over': return this.takeOver(params, context);
      case 'offer.save': return this.saveOffered(params, context);
      case 'staged.undo': return this.staging.undo(params);
      case 'agents.propose': await this.ready; return this.agents.propose(params);
      case 'agents.read': return this.agents.read();
      case 'box.say': await this.ready; return this.box.say(String(params.words ?? ''), typeof params.repo === 'string' ? params.repo : undefined);
      case 'agents.restart': await this.ready; return this.agents.restart(params);
      case 'agents.undo': return this.agents.undo(params);
      case 'mcp.exec': return this.agents.exec(params);
      // A hosted terminal the hub keeps past a restart: what the app's tab reads and types into (#70).
      case 'terminal.open': return this.terminal().open(this.connection('app'), params as unknown as Parameters<ExtensionHost['openTerminal']>[1]);
      case 'terminal.tab': return this.terminal().tab(this.connection('app'), String(params.terminal)) as unknown as Obj;
      case 'terminal.input': return this.terminal().rawInput(this.connection('app'), String(params.terminal), String(params.text)).then(() => ({ sent: true }));
      case 'secret.enter': return this.enterSecret(params, context);
      case 'secret.list': return { held: await this.extensions?.heldSecrets() ?? [] };
      case 'device.pair': return this.pair(params, context);
      case 'device.unpair': return this.unpair(params, context);
      case 'channel.link': return this.link(params, context);
      case 'confirm.enroll': return this.enrollAgain(params, context);
      case 'extension.install': return this.install(params, context);
      case 'you.confirm': return this.confirmCommand(params, context);
      case 'ask.confirm': return this.confirmCard(params);
      case 'views.installed': return { views: this.extensions?.installedViews() ?? [] };
      case 'command.run': return this.runCommand(params);
      // The app's action table (#1462): Later on an ask, and Pause on a session's row.
      case 'ask.later': return this.putOff(params);
      case 'session.pause': return this.pauseSession(params);
      // A hook that ended before this read is in the row: one deep-hook spooled is replayed first, and one acknowledged has its turn on the core's queue.
      case 'status.read':
        this.replayLate();
        // The state pass under way lands first (#992): what deep status lists is in the record the app draws from.
        return (this.replaying ?? Promise.resolve()).then(() => this.queue(async () => undefined)).then(() => this.statesSettled()).then(() => this.log.reflecting(async () => ({ rows: await this.statusSeen(context.role) })));
      // The list's rows (#1463), as status.read waits for them: behind every hook received and the state pass under way.
      case 'rows.read':
        this.replayLate();
        return (this.replaying ?? Promise.resolve()).then(() => this.queue(async () => undefined)).then(() => this.statesSettled()).then(() => this.log.reflecting(() => this.rowsSeen(context.role, params.detail === true)));
      // A row's page was open a second while you were present (#1461): the row reads as read in every reader.
      case 'row.read':
        if (context.role !== 'app') throw refuse('role', '/method', 'Only the app says a row was seen.', method);
        if (typeof params.id !== 'string') throw refuse('type', '/params/id', 'Name the row by its id.', method);
        return this.statesSettled().then(() => this.queue(() => this.seeRow(String(params.id))));
      case 'guard.add': return this.addGuard(params, context);
      case 'evidence.paste': return this.paste(params);
      case 'run.start': return this.runs.start(params);
      case 'run.output': return this.runs.output(params);
      case 'host.list': return { hosts: this.hosts.names().map((name) => ({ name })) };
      case 'host.facts': return this.hosts.facts(params.host, params.refresh === true);
      case 'start.approve': return this.sessionStarts.approve(params, context);
      case 'start.session':
        if (this.draining) throw refuse('unavailable', '/method', 'A promotion is draining the hub: no session starts until it restarts on the new build. Start it again then.', method, true);
        return this.sessionStarts.startSession(params, context);
      // A promotion (#1334): the run pauses and its running turns are counted until none is left; the fixture claim
      // judged by this build's own verdict engine; and, on the build that came back, the rollback's one notice.
      case 'hub.drain':
        this.draining = params.on !== false;
        // A turn runs while its session reads working, or waits on a permission prompt, as session.state records it.
        await this.statesSettled();
        return { turns: [...this.states.values()].filter((s) => s.startsWith('working/') || s === 'needs you/waiting').length };
      case 'hub.check': return this.healthClaim();
      case 'build.rolled_back': return this.rolledBack(params);
      case 'test.load': return this.testLoad(params);
      case 'record.backup': return this.backup(params);
      case 'lease.wait': return this.heavy.wait(params, context.peer, () => this.agentAbove(context.peer)).catch((e: Error) => { throw new Refused(refusal('type', '/params', e.message, method)); });
      case 'lease.started': return this.heavy.started(params).catch((e: Error) => { throw new Refused(refusal('type', '/params', e.message, method)); });
      case 'lease.exited': return this.heavy.exited(params).catch((e: Error) => { throw new Refused(refusal('type', '/params', e.message, method)); });
      case 'env.up': return this.envUp(params, context);
      case 'env.down': return this.envDown(params, context);
      case 'wiki.build': {
        const built = await this.wikiBuild.build();
        await syncRejected(this.raw, this.root.dir);
        return built;
      }
      case 'memory.list': return { lessons: await this.lessons(), rejected: await rejectedDirections(this.raw) };
      case 'memory.act': return this.memoryAct(params, context);
      // The rules page (#344): written, a scope's reach over the last 30 days, the sessions a rule was given to, a session's set.
      // Behind every hook already received or spooled, so a session that just started is a repo the page reads.
      case 'rules.sync':
        this.replayLate();
        return (this.replaying ?? Promise.resolve()).then(() => this.queue(() => this.syncRules()));
      case 'rules.reach': return ruleReach((sql, p) => this.record.raw(sql, p), realpathSync(String(params.repo)), String(params.scope), reachSince(this.now(), 30));
      case 'rules.credit': return { sessions: await creditOf((sql, p) => this.record.raw(sql, p), String(params.rule)) };
      case 'session.rules': return this.sessionRules(params);
      case 'acceptance.start': return this.acceptance.start(params);
      case 'acceptance.status': return this.acceptance.status(params);
      case 'acceptance.dispute': return this.acceptance.dispute(params);
      case 'acceptance.ended': return this.acceptance.ended(params).then(() => ({ ended: true }));
      case 'job.submit': return this.runner.submit(params.spec as JobSpec);
      case 'job.status': return this.runner.status(String(params.job));
      case 'job.list': return { jobs: await this.runner.list() };
      case 'checks.kinds': return { kinds: this.checkKinds.list() };
      case 'job.output': return { stdout: await this.runner.output(String(params.job)) };
      case 'canvas.show': return this.showCli(params, context);
      case 'canvas.export': return this.exportStill(params);
      case 'canvas.revisions': return this.canvasCall({ call: 'revisions', doc: String(params.doc) });
      case 'canvas.messages': return this.canvasCall({ call: 'messages', session: String(params.session) });
      case 'canvas.user': return this.canvasUser(params, context);
      case 'canvas.drawn': return this.drawnBy(context);
      case 'work.fix': return await this.workspaceCall(() => this.fixItem(String(params.id ?? ''), typeof params.cwd === 'string' ? params.cwd : homedir()));
      case 'workspace.new': return await this.workspaceCall(() => this.spaces.make(String(params.topic ?? ''), typeof params.folder === 'string' ? params.folder : undefined));
      case 'workspace.move': return await this.workspaceCall(() => this.spaces.move(String(params.id), String(params.folder)));
      case 'workspace.revert': return await this.workspaceCall(() => this.spaces.revert(String(params.id), String(params.commit)));
      case 'workspace.diff': return await this.workspaceCall(() => this.spaces.diff(String(params.id)));
      case 'workspace.drift': return await this.workspaceCall(() => this.spaces.drift(String(params.id)));
      case 'project.views': return { views: this.extensions!.projectViews() };
      // The app API's views/shown and views/hidden (#262): which views it shows, which decides the while-shown cadences.
      case 'views.shown':
      case 'views.hidden': {
        if (context.role !== 'app') throw refuse('role', '/method', 'Only the app reports the views it shows.', method);
        if (!this.extensions) throw new Refused(refusal('unavailable', '', 'The hub has no extension host yet; try again once it is ready.', method, true));
        const report = params as unknown as ViewShown;
        await (method === 'views.shown' ? this.extensions.viewsShown(this.connection('app'), report) : this.extensions.viewsHidden(this.connection('app'), report))
          .catch((e: Error) => { throw new Refused(refusal('type', '/params', e.message, method)); });
        return { reported: true };
      }
      case 'notifications.report': {
        if (context.role !== 'app') throw refuse('role', '/method', 'Only the app reports its notification setting.', method);
        const setting = params.setting;
        if (setting !== 'allowed' && setting !== 'denied' && setting !== 'alerts_none') throw refuse('type', '/params/setting', 'The setting is allowed, denied or alerts_none.', method);
        this.notifications = setting;
        await this.asks.notifications(setting !== 'allowed');
        return { reported: true };
      }
      case 'windows.report': return this.runner.report(params as unknown as WindowReport).then(() => { this.tasks.windowChanged(); this.sessionWindow(params); return { reported: true }; });
      default: throw new Refused(refusal('unknown_method', '/method', `The hub serves no method ${method}.`, method));
    }
  }

  /**
   * `deep backup <folder>` (#572): the record through SQLite's online backup on the writer's connection, which runs
   * here, off the hub's event loop, so hooks are answered while it copies; then the evidence and wiki folders. Evidence
   * is written before the event that cites it commits, so a copy taken after the record's holds every file it cites.
   * The record's copy is named ledger.db only once the folders are copied, so a folder with one holds a whole backup.
   */
  private async backup(params: Obj): Promise<Obj> {
    const folder = params.folder;
    if (typeof folder !== 'string' || !isAbsolute(folder)) throw new Refused(refusal('type', '/params/folder', 'Name the backup folder by its absolute path.', folder));
    const ledger = join(folder, 'ledger.db');
    const partial = `${ledger}.partial`;
    // Checked before anything is made: the folder's nearest part that exists, with its links resolved.
    let nearest = folder;
    while (!existsSync(nearest)) nearest = dirname(nearest);
    const [real, own] = [await realpath(nearest), await realpath(this.root.dir)];
    if (real === own || real.startsWith(`${own}/`)) throw new Refused(refusal('conflict', '/params/folder', `Back up outside DeepBuild's own folder ${own}, which the backup copies.`, folder));
    // Only an empty folder, made yours alone: nothing in it is read or written through, and no one else reads the copy.
    if (existsSync(folder) && readdirSync(folder).length > 0) throw new Refused(refusal('conflict', '/params/folder', `${folder} isn't empty; back up into an empty folder, or one that doesn't exist yet.`, folder));
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await chmod(folder, 0o700);
    const copies = [[this.root.evidence, 'evidence'], [this.root.wiki, 'wiki']] as const;
    try {
      await this.record.backup(partial);
      await chmod(partial, 0o600);
      await synced(partial);
      for (const [from, name] of copies) await copySynced(from, join(folder, name));
      // What the wiki last wrote sits beside its folder (#356): without it, every restored page would read as your edit.
      if (existsSync(wikiWritten(this.root.wiki))) await copyFile(wikiWritten(this.root.wiki), wikiWritten(join(folder, 'wiki')));
      // ledger.db names a whole backup only once all of it is on disk, and lasts once its folder is synced.
      await synced(folder);
      renameSync(partial, ledger);
    } catch (error) {
      rmSync(partial, { force: true });
      for (const [, name] of copies) rmSync(join(folder, name), { recursive: true, force: true });
      rmSync(wikiWritten(join(folder, 'wiki')), { force: true });
      throw error;
    }
    // After the rename the backup is whole, so a failed sync here leaves it as it is.
    await synced(folder);
    return { folder };
  }

  /** The app that reported the setting left: asks no longer wait on its reading, which `deep doctor` keeps showing. */
  async notifierGone(): Promise<void> {
    await this.asks.notifications(false);
  }

  async health(): Promise<Obj> {
    const network = Object.values(networkInterfaces()).flat().some((i) => i && !i.internal) ? 'reachable' : 'unreachable';
    // The timing relations our entries in Claude Code's settings keep, and what the settings watch and recheck put back.
    const claude = { relations: relations(this.root.dir).map((r) => ({ name: r.name, holds: r.holds, reading: r.text })), readings: [...this.settingsReadings] };
    const codex = { relations: codexRelations(this.root.dir).map((r) => ({ name: r.name, holds: r.holds, reading: r.text })), readings: [...modified(this.root.dir), ...trustProblems(this.root.dir).map((p) => `Codex's hook list reports ${p}`)], trust: readTrust(this.root.dir) ?? null };
    // The newest sessions, each closed once an end is on record since its last start (#1023); as `deep status` does, this
    // reads a watch-only session's unverified events too, or its own SessionEnd would leave it open here for good.
    const sessions = ((await this.record.raw(`SELECT s.id, COALESCE((SELECT e.kind <> 'session.start' FROM events e WHERE e.session_id = s.id AND e.kind IN ('session.start', 'session.end', 'session.archived') ORDER BY e.log_pos DESC LIMIT 1), 0) AS closed
      FROM sessions s WHERE s.last_seen IS NOT NULL ORDER BY s.last_seen DESC LIMIT 100`)) as { id: string; closed: number }[]).map((s) => ({ id: s.id, closed: s.closed === 1 }));
    return { gates: { watch_only: this.blocked !== undefined, reason: this.blocked ?? null }, notifications: this.notifications, secrets: await this.secretStore(), network, claude, codex, sessions, jobs: Object.fromEntries([...this.jobs].map(([name, failing]) => [name, { failing }])) };
  }
  /** Whether this process can reach the OS secret store, read at most every ten seconds. */
  private secretStore(): Promise<string> {
    const at = Date.now();
    if (this.secrets && at - this.secrets.at < SECRETS_TTL) return this.secrets.value;
    const value = new Promise<string>((done) => {
      // securityd answers the keychain list for this process's security session, whatever HOME is.
      if (process.platform === 'darwin') execFile('/usr/bin/security', ['list-keychains'], (error) => done(error ? 'unreachable' : 'reachable'));
      else done(process.env.DBUS_SESSION_BUS_ADDRESS ? 'reachable' : 'unreachable');
    });
    this.secrets = { at, value };
    return value;
  }

  /**
   * The list's rows (#1463), a person's only of the sessions they may see (#1338), with each session's detail for deep
   * status when `detail` asks for it.
   */
  private async rowsSeen(role: string, detail: boolean): Promise<Obj> {
    const query = (q: string) => this.record.raw(q);
    let rows = (await listRows(query)).map((p) => p.row);
    const seen = role.startsWith('person:') ? this.seenBy(role) : '';
    if (seen) {
      const visible = new Set(((await this.record.raw(`SELECT DISTINCT session_id AS id FROM events WHERE session_id IS NOT NULL${seen}`)) as { id: string }[]).map((r) => r.id));
      rows = rows.filter((r) => visible.has(r.session));
    }
    return { rows, ...(detail ? { detail: Object.fromEntries((await this.statusSeen(role)).map((r) => [`session:${r.id}`, r])) } : {}) } as unknown as Obj;
  }
  /** deep status's rows, a person's only of the sessions they may see (#1338). */
  /**
   * A five-hour reading the status line forwarder sent with the session its input names (#1296): kept for that
   * session's row alone, and only for a session the hub has met through its hooks.
   */
  private sessionWindow(params: Obj): void {
    const five = isObj(params.rate_limits) && isObj(params.rate_limits.five_hour) ? params.rate_limits.five_hour : undefined;
    if (typeof params.session !== 'string' || !this.sessions.has(params.session) || typeof five?.used_percentage !== 'number') return;
    this.windowOf.set(params.session, { used: five.used_percentage, resets: typeof five.resets_at === 'number' ? five.resets_at * 1000 : null });
  }
  /** Each session's own five-hour reading, as its status line last sent it. */
  private readonly windowOf = new Map<string, { used: number; resets: number | null }>();
  private async statusSeen(role: string): Promise<StatusRow[]> {
    const rows = await statusRows((sql) => this.record.raw(sql), this.now());
    for (const row of rows) {
      const own = this.windowOf.get(row.id);
      const unread = row.readings?.[0]?.startsWith(UNREAD_WINDOW);
      // The planted wrong programs: a session with no reading shows 0%, or the newest reading another session sent.
      const carried = this.options.plant === 'window-carried-from-other-repo' && unread ? [...this.windowOf.values()].at(-1) : undefined;
      const shown = own ?? carried ?? (this.options.plant === 'window-unknown-as-zero' && unread ? { used: 0, resets: null } : undefined);
      if (shown) row.readings = [`5 h · ${Math.max(0, 100 - shown.used)}% left${shown.resets ? ` · resets ${clockTime(shown.resets)}` : ''}`, ...(row.readings ?? []).filter((r) => !r.startsWith(UNREAD_WINDOW))];
    }
    const seen = role.startsWith('person:') ? this.seenBy(role) : '';
    if (!seen) return rows;
    const visible = new Set(((await this.record.raw(`SELECT DISTINCT session_id AS id FROM events WHERE session_id IS NOT NULL${seen}`)) as { id: string }[]).map((r) => r.id));
    return rows.filter((row) => visible.has(row.id));
  }
  /**
   * The events a reader may see, as SQL (#1337): a person reads their own personal scope and the projects they are
   * on; the owner reads everything but another person's personal scope. With nobody else on the hub, everything.
   */
  private seenBy(role: string): string {
    if (!this.people.any) return '';
    const person = role.startsWith('person:') ? role.slice('person:'.length) : OWNER;
    if (person === OWNER) return ` AND scope NOT LIKE 'person:%'`;
    // The planted wrong program: a person's reads without the filter.
    if (this.options.plant === 'reads-unfiltered') return '';
    const scopes = [`person:${person}`, ...[...this.people.projects(person)].map((p) => `repo:${p}`)];
    return ` AND scope IN (${scopes.map((x) => `'${sql(x)}'`).join(',')})`;
  }
  /**
   * changes/:id: a claim, with the runs and verdicts of its checks, and its receipt (#83): the line the chat showed
   * and the second line; the checks it ran; its ask with the PR's state and link, read from the forge now; what it
   * produced (the PR, the files the session wrote, the pages the record saw); and, once it passed, the next
   * unblocked issue in its epic.
   */
  private change(params: Obj): Promise<Obj> {
    const id = typeof params.id === 'string' && /^claim:[0-9A-Za-z]+$/.test(params.id) ? params.id.slice(6) : undefined;
    if (!id) throw new Refused(refusal('pattern', '/params/id', 'Name the change as claim:<id>.', params.id));
    return this.log.reflecting(async () => {
      const [claim] = await this.record.raw(`SELECT * FROM claims WHERE id = ?`, [id]);
      if (!claim) throw new Refused(refusal('not_found', '/params/id', `No change claim:${id} in the record.`, params.id));
      const runs = await this.record.raw(`SELECT * FROM runs WHERE claim_id = ? ORDER BY started`, [id]);
      const verdicts = await this.record.raw(`SELECT * FROM verdicts WHERE claim_id = ? ORDER BY created`, [id]);
      const state = (await this.stateOf(`claim:${id}`))!;
      const line = verdictLine(state.state);
      const url = await this.prOf(state.session);
      const pr = url ? parsePrUrl(url) : undefined;
      const forge = pr ? new Forge(this.options.forge ?? 'https://api.github.com', process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? await ghToken()) : undefined;
      const pulled = pr && forge ? await forge.pull(pr) : undefined;
      const files = state.session ? ((await this.record.raw(`SELECT path FROM session_files WHERE session = ? AND kind IN ('edit', 'write') ORDER BY last`, [state.session])) as { path: string }[]).map((r) => r.path) : [];
      const next_issue = pr && forge && pulled?.closes !== undefined && state.state.outcome === 'PASS' ? await forge.nextIssue(pr, pulled.closes) : null;
      // A forge that didn't answer leaves the state unknown, never a guess.
      const asks = [{ ask: state.task, pr: url ? { state: pulled?.state ?? 'unknown', url } : null }];
      const second = [
        state.checks.length ? `checks: ${state.checks.map((c) => `${c.check} ${c.outcome}${c.spend_usd !== undefined ? ` $${c.spend_usd.toFixed(2)}` : ''}${c.stand_in ? ', proven on a stand-in' : ''}`).join(', ')}` : '',
        url ? `PR ${pulled?.state ?? 'unknown'} ${url}` : '',
        files.length ? `wrote ${files.join(', ')}` : '',
        next_issue ? `next issue #${next_issue.number} ${next_issue.url}` : '',
      ].filter(Boolean).join(' · ');
      // One plain sentence on the change, each verdict and each open item, from the template (#1999).
      const say = (sentence: string): Promise<string> => this.options.plant === 'sentence-from-model' ? this.planted(sentence) : Promise.resolve(sentence);
      const [where] = state.session ? (await this.record.raw(`SELECT worktree FROM sessions WHERE id = ?`, [state.session])) as { worktree: string | null }[] : [];
      const named = files.map((f) => where?.worktree && f.startsWith(`${where.worktree}/`) ? relative(where.worktree, f) : basename(f));
      const said = this.options.plant === 'sentence-from-agent-text' && state.session ? this.lastMessage.get(state.session) : undefined;
      const sentence = said ?? await say(changeSentence(named));
      const rounds = new Map(((await this.record.raw(`SELECT json_extract(data, '$.verdict') AS verdict, json_extract(data, '$.round') AS round FROM events WHERE kind = 'claim.sent_back' AND subject = ?`, [`claim:${id}`])) as { verdict: string; round: number }[]).map((r) => [r.verdict, Number(r.round)]));
      for (const v of verdicts as Obj[]) {
        const reqs = (JSON.parse(String(v.requirements ?? '[]')) as Obj[]).map((r) => ({ req: String(r.req), outcome: String(r.outcome), smallest: typeof r.smallest === 'string' ? r.smallest : null, points_to: typeof r.points_to === 'string' ? r.points_to : null }));
        v.sentence = await say(verdictSentence({ outcome: String(v.outcome), requirements: reqs, smallest: typeof v.smallest === 'string' ? v.smallest : null, stale: Boolean(v.stale), round: rounds.get(String(v.handle)) ?? null }));
      }
      const open_items: Obj[] = [];
      for (const item of (await this.record.raw(`SELECT text FROM open_items WHERE task_ref = ? AND closed IS NULL ORDER BY opened`, [state.task])) as { text: string }[]) {
        open_items.push(this.options.plant === 'open-item-no-sentence' ? { text: item.text } : { text: item.text, sentence: await say(openItemSentence(item.text)) });
      }
      return { change: { claim, sentence, runs, verdicts, open_items, line, second, checks: state.checks, asks, produced: { pr: url ?? null, files, pages: [] }, next_issue } };
    });
  }
  /** The planted wrong program `sentence-from-model`: a headless agent call writes the sentence from the template's. */
  private planted(sentence: string): Promise<string> {
    return new Promise((done) => execFile('claude', ['-p', `Write one plain sentence saying: ${sentence}`], { timeout: 30_000 }, (error, out) => done(error ? sentence : String(out).trim() || sentence)));
  }
  /** evidence/:sha: what the store holds of one file, never its bytes. */
  private evidence(params: Obj): Promise<Obj> {
    const sha = typeof params.sha === 'string' && /^[0-9a-f]{64}$/.test(params.sha) ? params.sha : undefined;
    if (!sha) throw new Refused(refusal('pattern', '/params/sha', 'Name the evidence by its SHA-256, in lower-case hex.', params.sha));
    return this.log.reflecting(async () => {
      const evidence = await this.store.get(sha);
      if (!evidence) throw new Refused(refusal('not_found', '/params/sha', `The store holds no evidence ${sha}.`, sha));
      return { evidence: JSON.parse(JSON.stringify(evidence)) as Obj };
    });
  }

  // ---- Answers on the trusted path (#24, #34).

  private hub: string | undefined;
  /** The hub's ID, as its hello names it (#1338): what an invite and a device's signature name (#1579). */
  private hubId(): string {
    return (this.hub ??= identityAt(join(this.options.root, 'hub.key'), 'deep-hub').id);
  }

  /**
   * Whether an answer may count: a paired device's valid signature for this method, this hub and these params (#1579),
   * from any role; otherwise, from the CLI alone, the OS confirming you with a prompt that names what you answer. The
   * control token and the peer check alone never make one count, and a deep command run inside an agent's process
   * tree acts as that agent's session.
   */
  private async trusted(method: string, params: Obj, context: CallContext, what: string, handle: string, revision: string): Promise<void> {
    if (params.signature !== undefined) {
      const why = this.devices.verify(params.signature, { method, hub: this.hubId(), params, now: this.now() }, { skipsTime: this.options.plant === 'signature-skips-time' });
      if (!why) return;
      const signed = (params.signature as { signed?: Obj }).signed;
      throw new Refused(refusal('credential', why.field === 'signature' ? '/params/signature/sig' : `/params/signature/signed/${why.field}`, `${handle} stays open: the signature's ${why.field} doesn't hold (${why.reason}). Sign it again with a device you paired, for ${method} on this hub, over exactly the params it sends.`, signed?.[why.field] ?? why.field));
    }
    if (context.role !== 'cli') throw new Refused(refusal('unconfirmed', '/params/signature', `${handle} stays open: an answer from the app counts only when a device you paired signs it.`, handle));
    const agent = await this.agentAbove(context.peer);
    if (agent && this.options.plant !== 'answer-inside-session') {
      throw new Refused(refusal('role', '/params/ask', `${handle} stays open: this deep command runs inside agent session ${agent}'s process tree, so it acts as that session, and no agent answers an ask. Answer it from your own terminal or on the question card.`, handle));
    }
    const plant = this.options.plant;
    if (plant === 'answer-on-token' || plant === 'answer-on-peer-check') return;
    const why = await this.confirmer.you(what, { handle, revision, process: context.peer });
    if (why) {
      throw new Refused(refusal('unconfirmed', '/params/ask', `${handle} stays open: the OS didn't confirm you (${why}). An answer from the CLI counts only once it does; answer again and confirm, or answer on the question card.`, handle, true));
    }
  }

  /**
   * The revision an answer to an ask is given on, which deep-confirm's signature covers (#880): the commit its session's
   * worktree moved on to, or else what it was pinned to.
   */
  private async revisionOf(handle: string, ask: { pinned_to?: { ref?: string } | undefined }): Promise<string> {
    const changed = await this.asks.card(handle).then((card) => card.changed?.to, () => undefined);
    return changed ?? ask.pinned_to?.ref ?? 'unpinned';
  }

  /** Every ask, as the inbox projection holds it, with each one's question and options; `deep inbox` lists the open ones. */
  private async inbox(): Promise<Obj> {
    const rows = (await this.record.raw('SELECT id, question, options FROM asks')) as { id: string; question: string | null; options: string | null }[];
    const texts = new Map(rows.map((r) => [r.id, r]));
    // What each decision answered, for the asks it decided for you (#27).
    const saved = new Map(((await this.record.raw('SELECT id, answer FROM decisions')) as { id: string; answer: string | null }[]).map((d) => [`decision:${d.id}`, d.answer === null ? null : JSON.parse(d.answer) as string]));
    // An authority ask's plan, by the digest an approval binds: what `deep inbox` shows before you answer (#69).
    // The first the core proposed for each ask, as the asks core holds it; an agent's plan.proposed binds nothing.
    const plans = (await this.record.raw("SELECT data FROM events WHERE kind = 'plan.proposed' AND writer = 'core' ORDER BY log_pos")) as { data: string }[];
    const planOf = new Map<string, { hash: string; steps: unknown }>();
    for (const { data } of plans) {
      const d = JSON.parse(data) as { ask: string; hash: string; steps: unknown };
      if (!planOf.has(d.ask)) planOf.set(d.ask, { hash: d.hash, steps: d.steps });
    }
    return {
      asks: (await this.asks.inbox()).map((row) => {
        const text = texts.get(row.ask.slice(4));
        const url = this.options.plant === 'link-from-agent-url' ? /https?:\/\/\S+/.exec(text?.question ?? '')?.[0] : undefined;
        const opens = row.kind === 'unblock' && text?.question ? opensOf(text.question, signInCommands()) : undefined;
        return {
          ...row, ...(opens ? { opens } : {}), ...(url ? { link: url } : {}), question: text?.question ?? '', options: text?.options ? (JSON.parse(text.options) as { id: string }[]).map((o) => o.id) : [], plan: planOf.get(row.ask) ?? null,
          ...(row.outcome === 'decided_for_you' && row.decision ? { answer: saved.get(row.decision) ?? null } : {}),
        };
      }),
      // Permissions you said yes to in the terminal, offered back as decisions to save: never asks (#23).
      offers: await this.openOffers(),
      // The open asks' rows, as every reader of the list holds them (#1463).
      rows: (await listRows((q) => this.record.raw(q))).filter((p) => p.row.id.startsWith('ask:')).map((p) => p.row) as unknown as Obj[],
    };
  }

  /** How many hand-backs went back with the tool to use, over the ones the check ran on: a reading, never a pass or a fail (#84). */
  private async handbacks(): Promise<Obj> {
    const rows = (await this.record.raw(`SELECT session_id, json_extract(data, '$.reading') AS reading FROM events WHERE kind = 'session.reading' AND json_extract(data, '$.reading') LIKE 'Hand-back %' ORDER BY log_pos`)) as { session_id: string; reading: string }[];
    const detail = rows.map((r) => ({ session: r.session_id, sent_back: r.reading.startsWith('Hand-back sent back'), reading: r.reading }));
    return { id: 'handbacks_sent_back', label: 'Hand-backs sent back with the tool to use', value: detail.filter((d) => d.sent_back).length, unit: 'count', source: 'record', age_ms: 0, basis: 'observed', of: detail.length, detail };
  }
  /** The question card's document (#84): the asks core's card, with the ask's text and where a task sends you. A URL in the text stays plain text. */
  private async askCard(params: Obj): Promise<Obj> {
    const handle = params.ask;
    if (typeof handle !== 'string' || !/^ask:[0-9A-Za-z]+$/.test(handle)) throw new Refused(refusal('handle_syntax', '/params/ask', 'Name the ask by its handle, ask:<id>.', handle));
    const [row] = (await this.record.raw(`SELECT question FROM asks WHERE id = ?`, [handle.slice(4)])) as { question: string | null }[];
    if (!row) throw new Refused(refusal('not_found', '/params/ask', `No ask ${handle}.`, handle));
    const card = await this.asks.card(handle);
    const question = row.question ?? '';
    const opens = card.kind === 'unblock' ? opensOf(question, signInCommands()) : undefined;
    const url = this.options.plant === 'link-from-agent-url' ? /https?:\/\/\S+/.exec(question)?.[0] : undefined;
    // The card's revision, which an answer from this copy names (#1580).
    const revision = (await this.cards(handle)).get(handle)?.revision ?? 1;
    return { ...card, question, revision, ...(opens ? { opens } : {}), ...(url ? { link: url } : {}) };
  }

  /**
   * asks/:id/answer, from the app or `deep inbox answer`: once the trusted path allows it, the asks core records it
   * and the core saves it as a decision for the ask's repo, or its session; an ask with neither, and a block's task
   * (#85), saves none.
   */
  private async answer(params: Obj, context: CallContext, channel?: { channel: string; proof: 'device' | 'account_link'; plan_hash: string | null }): Promise<Obj> {
    const { ask: handle, device: _device, signature: _signature, revision, ...input } = params;
    if (typeof handle !== 'string' || !/^ask:[0-9A-Za-z]+$/.test(handle)) throw new Refused(refusal('handle_syntax', '/params/ask', 'Name the ask by its handle, ask:<id>, as deep inbox lists it.', handle));
    const [row] = (await this.record.raw(`SELECT e.session_id AS session, e.project_id AS project, e.data AS data, a.status AS status FROM events e JOIN asks a ON a.id = e.id WHERE e.id = ? AND e.kind = 'ask.created'`, [handle.slice(4)])) as { session: string | null; project: string | null; data: string; status: string }[];
    if (!row) throw new Refused(refusal('not_found', '/params/ask', `No ask ${handle}; answer an ask deep inbox lists.`, handle));
    // A channel's answer with an account link (#65) is the asks core's as `channel`: that ask alone, never a decision.
    const writer = channel?.proof === 'account_link' ? 'channel' : context.role === 'app' ? 'app' : 'cli';
    const answered = (): Promise<void> => this.asks.answer(this.connection(writer), handle, input).catch((error: unknown) => { throw asRefused(error); });
    // A closed ask takes no answer: the asks core records the refusal, and there's nothing to confirm you for. The
    // first answer appended stands, and the refusal names it and where it came from (#65).
    if (row.status !== 'open' && row.status !== 'later') {
      const first = row.status === 'answered' ? await this.firstAnswer(handle) : undefined;
      // A hub that takes every answer, the last one written over the first: the planted wrong program.
      if (first && this.options.plant === 'last-writer-wins' && typeof input.option === 'string') {
        await this.appendCore('ask.answered', { answer: input.option, plan_hash: null, decision: 'none', via: 'card', verified: true, on: (JSON.parse(row.data) as { pinned_to: JsonValue }).pinned_to, token: null, words: null, image: null }, { subject: handle, v: 4 });
        return { ask: handle, answer: input.option, scope: null };
      }
      await answered().catch((error: unknown) => { if (!first) throw error; });
      throw new Refused(refusal('not_found', '/params/ask', first ? `${handle} was already answered ${first.answer} ${first.where}; the first answer stands, so ${String(input.option ?? 'this answer')} counts for nothing.` : `${handle} is closed.`, handle));
    }
    const ask = JSON.parse(row.data) as { key: string; question: string; options: { id: string; label: string; decision?: string }[]; pinned_to?: { ref?: string } };
    const chosen = ask.options.find((o) => o.id === input.option);
    if (input.option !== undefined && !chosen) {
      throw new Refused(refusal('enum', '/params/option', `${handle} has no option ${String(input.option)}; its options are ${ask.options.map((o) => o.id).join(', ')}.`, input.option));
    }
    // A channel's answer was checked by the channels (#65): a paired device's signature over the card it showed, or an account link.
    if (!channel) {
      await this.trusted('ask.answer', params, context, `answer “${ask.question.slice(0, 120)}” with ${chosen ? `“${chosen.label.slice(0, 80)}”` : 'your words'}`, handle, await this.revisionOf(handle, ask));
      await this.onRevision(handle, revision, params.signature);
    }
    // A paired phone's yes binds the plan its signature names, which the channels checked against the ask's (#1580),
    // never one the hub fills in, and its own token, as the app's click does.
    if (channel?.proof === 'device' && chosen?.decision === 'allow') {
      input.token = `${channel.channel}:${ulid(this.now())}`;
      input.plan_hash = channel.plan_hash;
    }
    // From the CLI, the OS prompt that just confirmed you is the click an approval binds (#321): its token is minted here,
    // for an approval only, so any other answer is handed on as its twin from the app is (#34).
    if (context.role === 'cli' && chosen?.decision === 'allow' && input.token === undefined) input.token = `os-confirm:${ulid(this.now())}`;
    // `deep inbox answer` names an option, and its prompt named the plan the card shows: an approval binds that one (#69).
    if (context.role === 'cli' && chosen?.decision === 'allow' && input.plan_hash === undefined) input.plan_hash = (await this.asks.card(handle)).plan?.hash ?? null;
    const data = JSON.parse(row.data) as Obj;
    // "The agent can do it" sends the task back with the tools the check found (#84).
    if (chosen?.id === 'agent' && data.kind === 'unblock' && row.session) input.words = this.toolsFound(await this.reachOfSession(row.session));
    // Your answer differs from the option a provisional ask went on with (#84): the commits made under it go with your answer.
    if (data.provisional === true && chosen && chosen.id !== data.recommended && row.session && this.options.plant !== 'records-switch-only') await this.provisionalSwitched(handle, row.session, data).catch(() => undefined);
    await answered();
    // "I did it" to a task proved by a spec check runs that check again at once (#323): a claim never passes on it alone.
    if (data.kind === 'unblock' && chosen?.id === 'done' && row.session && typeof data.proves === 'string' && this.checksOf((await this.teardowns.of(data))?.cwd ?? this.sessions.get(row.session)?.cwd ?? '').has(data.proves)) {
      void this.didIt(handle, row.session, data).catch((error: unknown) => process.stderr.write(`deep hub: ${handle}'s check did not run again: ${error instanceof Error ? error.message : String(error)}\n`));
    }
    // Your waiver of an open item closes it (#323).
    await this.openItems.answered(data, chosen?.id);
    // The asks core saved an option you chose for the ask's repo, or its session, never wider than its card showed.
    const [saved] = (await this.record.raw(`SELECT data FROM events WHERE kind = 'decision.created' AND subject = ? ORDER BY log_pos DESC LIMIT 1`, [handle])) as { data: string }[];
    const answer = chosen?.id ?? String(input.words ?? input.image);
    await this.syncStanding().catch(() => undefined);
    await syncRejected(this.raw, this.root.dir).catch(() => undefined);
    return { ask: handle, answer, scope: saved ? String((JSON.parse(saved.data) as Obj).scope) : null };
  }
  private toolsFound(reach: Reach): string {
    const names = [...reach.tools.map((t) => t.name), ...reach.profiles.filter((p) => p.leased).map((p) => p.profile), ...reach.credentials.map((c) => c.secret)];
    return names.length ? `The check found: ${names.join(', ')}.` : 'The check found no tool for it; say what you tried if you still can\'t.';
  }
  /**
   * You chose another option after the agent went on with a provisional one: the commits made since the ask, for your
   * answer's one send-back, and a reading that keeps the claim from passing on them until a commit after this one.
   */
  private async provisionalSwitched(handle: string, session: string, data: Obj): Promise<void> {
    const cwd = this.sessions.get(session)?.cwd;
    const pinned = data.pinned_to as { kind?: string; ref?: string } | undefined;
    if (!cwd || pinned?.kind !== 'commit') return;
    const git = (...args: string[]) => new Promise<string>((done) => execFile('git', ['-C', cwd, ...args], { timeout: 2000 }, (_, out) => done(String(out ?? '').trim())));
    const commits = (await git('rev-list', '--reverse', `${pinned.ref}..HEAD`)).split('\n').filter(Boolean);
    this.switches.set(handle.slice(4), commits.map((c) => c.slice(0, 7)));
    const head = await git('rev-parse', 'HEAD^{tree}');
    await this.appendReading(session, this.sessions.get(session)!.agent, `Switched ${handle}: tree ${head}`);
  }
  /** Whether a claim stands on the tree your switch of a provisional ask left: no check of your option has run on it (#84). */
  private async onSwitchedTree(claim: string): Promise<string | undefined> {
    const [row] = (await this.record.raw(`SELECT session_id, commit_sha FROM claims WHERE id = ?`, [claim.slice(6)])) as { session_id: string | null; commit_sha: string | null }[];
    if (!row?.session_id || !row.commit_sha) return undefined;
    const rows = (await this.record.raw(`SELECT json_extract(data, '$.reading') AS reading FROM events WHERE session_id = ? AND kind = 'session.reading' AND json_extract(data, '$.reading') LIKE 'Switched ask:%' ORDER BY log_pos DESC LIMIT 1`, [row.session_id])) as { reading: string }[];
    const switched = /^Switched (ask:\S+): tree (\S+)/.exec(rows[0]?.reading ?? '');
    const cwd = this.sessions.get(row.session_id)?.cwd;
    if (!switched || !cwd) return undefined;
    const tree = await new Promise<string>((done) => execFile('git', ['-C', cwd, 'rev-parse', `${row.commit_sha!}^{tree}`], { timeout: 2000 }, (_, out) => done(String(out ?? '').trim())));
    return tree === switched[2] ? `your answer to ${switched[1]} switched the option the agent went on with, and no check has run on a commit after it` : undefined;
  }
  /**
   * Your "I did it" to a task (#323; design: Tasks only you can do): its check runs again at once, as your claim on the
   * session's task, on a snapshot of the session's folder. One that still fails returns the task to you, raised again
   * with what's missing; one that passes leaves it closed.
   */
  private async didIt(handle: string, session: string, data: Obj): Promise<void> {
    // A teardown task's session may be long over: its check runs on the folder that session worked in, for its own
    // resource, with no claim, so one resource's check passing says nothing of another's task on the same check (#342).
    const resource = await this.teardowns.of(data);
    const name = String(data.proves);
    const agent = resource?.agent ?? this.sessions.get(session)!.agent;
    if (resource && this.options.plant === 'teardown-closes-on-word') return;
    let findings: string[] = [];
    try {
      const cwd = resource?.cwd ?? this.sessions.get(session)!.cwd;
      const check = this.checksOf(cwd).get(name);
      if (!check) throw Error(`${name} is no check of ${cwd}'s spec any more`);
      // Run on a snapshot of the session's folder, in a temporary checkout of it, as a claim's checks are (#29).
      const commit = (await this.checkouts.snapshot(cwd)).commit;
      const ts = this.now();
      const id = ulid(ts);
      const checkout = await this.checkouts.checkout({ worktree: cwd, commit, dependencies: ['node_modules', '.venv'], runs: [`claim:${id}`] });
      if (!resource) {
        const live = this.liveOf({ session, agent, cwd } as HookMeta);
        const task_ref = await this.turnTaskOf(session, live);
        const [before] = (await this.record.raw(`SELECT COUNT(*) AS n FROM claims WHERE session_id = ? AND subject_ref = ?`, [session, task_ref])) as { n: number }[];
        await this.append(this.connection('core', { session, agent }), { v: 2, id, kind: 'claim.made', ts, data: { task_ref, attempt: (before?.n ?? 0) + 1, commit, scope: 'session', predictions: [] } });
      }
      const deadline = check.deadline === undefined ? undefined : duration(check.deadline as JsonValue);
      const { run } = await this.runs.start({ check: name, claim: `claim:${id}`, commit, argv: ['/bin/sh', '-c', check.run], command: check.run, cwd: checkout.dir, ...(resource?.key === undefined ? {} : { env: { DEEP_RESOURCE_KEY: resource.key } }) }, deadline);
      const outcome = await this.runEnded(String(run)).finally(() => this.checkouts.ended(checkout, `claim:${id}`).catch(() => undefined));
      if (outcome === 'passed') return;
      const [done] = (await this.record.raw(`SELECT json_extract(data, '$.findings') AS findings FROM events WHERE kind = 'run.finished' AND subject = ? LIMIT 1`, [String(run)])) as { findings: string | null }[];
      findings = (JSON.parse(done?.findings ?? '[]') as string[]).slice(0, 5);
    } catch (error) {
      // A teardown task closes on its check alone: one that couldn't run leaves the task with you.
      if (!resource) throw error;
      findings = [error instanceof Error ? error.message : String(error)];
    }
    const reasons = [`${name} still fails after your "I did it"${findings.length ? `: ${findings.join('; ')}` : ''}`];
    const fields = ['kind', 'question', 'options', 'recommended', 'default', 'steps', 'where', 'why', 'unblocks', 'proves', 'cost_usd', 'fallback', 'provisional', 'owner', 'pinned_to'];
    const again = { ...Object.fromEntries(fields.filter((f) => f in data).map((f) => [f, data[f]])), key: sha256Hex(canonicalize({ again: handle, key: data.key ?? null } as JsonValue)) };
    await this.raiseTask(session, agent, again);
    if (!resource) await this.asks.stillFails(name, reasons);
  }
  private async raiseTask(session: string, agent: string, ask: Obj): Promise<void> {
    await this.asks.raise(this.connection('core', { session, agent }), 'deep_ask.unblock', ask);
  }
  /** asks/:id/undo, from the app or `deep inbox undo`: a defaulted ask opens again, once the trusted path allows it. */
  private async undo(params: Obj, context: CallContext): Promise<Obj> {
    const handle = params.ask;
    if (typeof handle !== 'string' || !/^ask:[0-9A-Za-z]+$/.test(handle)) throw new Refused(refusal('handle_syntax', '/params/ask', 'Name the ask by its handle, ask:<id>.', handle));
    const [row] = (await this.record.raw(`SELECT question, status, pinned_to FROM asks WHERE id = ?`, [handle.slice(4)])) as { question: string; status: string; pinned_to: string | null }[];
    if (!row) throw new Refused(refusal('not_found', '/params/ask', `No ask ${handle}; undo the default of an ask the inbox holds.`, handle));
    if (row.status !== 'defaulted') throw new Refused(refusal('not_found', '/params/ask', `${handle} didn't take its default (it's ${row.status}), so there's nothing to undo.`, handle));
    // A definition that locked on the default stands: a different answer now would change nothing but the record of it.
    const locked = await this.tasks.lockedOn(handle);
    if (locked) throw new Refused(refusal('locked', '/params/ask', `${handle} took its default and the definition of ${locked} locked on it; a change to that definition goes through a dispute, not an undo.`, handle));
    await this.trusted('ask.undo', params, context, `undo the default “${row.question.slice(0, 120)}” took`, handle, await this.revisionOf(handle, { pinned_to: row.pinned_to ? JSON.parse(row.pinned_to) as { ref?: string } : undefined }));
    await this.asks.undo(this.connection(context.role === 'app' ? 'app' : 'cli'), handle).catch((error: unknown) => { throw asRefused(error); });
    const [open] = (await this.record.raw(`SELECT deadline FROM asks WHERE id = ?`, [handle.slice(4)])) as { deadline: number }[];
    return { ask: handle, deadline: open?.deadline ?? null };
  }
  /** decisions/:id/overrule: a saved decision taken out of force, on the trusted path alone. */
  private async overrule(params: Obj, context: CallContext): Promise<Obj> {
    const id = typeof params.decision === 'string' && /^decision:[0-9A-Za-z]+$/.test(params.decision) ? params.decision : undefined;
    if (!id) throw new Refused(refusal('pattern', '/params/decision', 'Name the decision as decision:<id>.', params.decision));
    const [row] = (await this.record.raw(`SELECT key, answer, state FROM decisions WHERE id = ?`, [id.slice(9)])) as { key: string; answer: string; state: string }[];
    if (!row) throw new Refused(refusal('not_found', '/params/decision', `No decision ${id} in the record.`, id));
    if (row.state === 'revoked') return { overruled: id };
    await this.trusted('decision.overrule', params, context, `overrule the saved decision ${row.answer}`, id, row.state);
    // First: a retry finds a revoked decision done, so a guard left behind would never go.
    dropKept(this.root.dir, row.key);
    await this.appendCore('decision.overruled', { decision: id }, { subject: id });
    await this.syncStanding().catch(() => undefined);
    await syncRejected(this.raw, this.root.dir).catch(() => undefined);
    return { overruled: id };
  }
  /**
   * A new secret for a package, on the trusted path (#70): it counts as an answer does, so a deep command in an agent's
   * process tree can't add one, and goes straight to the OS secret store. Neither the value nor anything made from it
   * is recorded.
   */
  private async enterSecret(params: Obj, context: CallContext): Promise<Obj> {
    const { extension, name, value } = params;
    if (typeof extension !== 'string' || typeof name !== 'string' || typeof value !== 'string' || !value) throw new Refused(refusal('required', '/params', 'Name the package and the secret, and give its value.', null));
    if (!this.extensions) throw new Refused(refusal('unavailable', '/params/extension', `${extension} isn't loaded, so nothing can name ${name}.`, extension));
    await this.trusted('secret.enter', params, context, `add the secret ${name} for ${extension}`, `secret:${extension}/${name}`, name);
    const { saved, test } = await this.extensions.enterSecret(this.connection('cli'), extension, name, value);
    return { saved, test };
  }

  private terminal(): { open: ExtensionHost['openTerminal']; tab: ExtensionHost['tab']; rawInput: ExtensionHost['rawInput'] } {
    const host = this.extensions;
    if (!host) throw new Refused(refusal('unavailable', '/method', 'This hub hosts no terminals: its extension host isn\'t open.', null));
    return { open: (c, spec) => host.openTerminal(c, spec), tab: (c, t) => host.tab(c, t), rawInput: (c, t, text) => host.rawInput(c, t, text) };
  }

  /** Pairs a device's key, once the OS confirms you, so the control token alone can't pair one. */
  private async pair(params: Obj, context: CallContext): Promise<Obj> {
    if (typeof params.name !== 'string' || !params.name) throw new Refused(refusal('required', '/params/name', 'Name the device you pair.', params.name));
    const key = checkKey(params.public_key);
    const why = await this.confirmer.you(`pair “${params.name.slice(0, 80)}” with DeepBuild, so what it signs answers for you`, { handle: `device:${params.name.slice(0, 80)}`, revision: key, process: context.peer });
    if (why) throw new Refused(refusal('unconfirmed', '', `Nothing was paired: the OS didn't confirm you (${why}).`, params.name, true));
    const device = `device:${ulid(this.now())}`;
    this.devices.pair(device, params.name, key, this.now());
    return { device };
  }

  /** The answer a closed ask took first, and where it came from: the channel that carried it, or the app or deep inbox. */
  private async firstAnswer(handle: string): Promise<{ answer: string; where: string } | undefined> {
    const [first] = (await this.record.raw(`SELECT json_extract(data, '$.answer') AS answer, json_extract(data, '$.via') AS via FROM events WHERE kind = 'ask.answered' AND subject = ? ORDER BY log_pos LIMIT 1`, [handle])) as { answer: string; via: string }[];
    if (!first) return undefined;
    const [by] = (await this.record.raw(`SELECT json_extract(data, '$.channel') AS channel FROM events WHERE kind = 'channel.answered' AND subject = ? AND json_extract(data, '$.answer') = ? ORDER BY log_pos LIMIT 1`, [handle, first.answer])) as { channel: string }[];
    return { answer: first.answer, where: by ? `on the ${by.channel} channel` : first.via === 'inbox' ? 'from deep inbox' : first.via === 'session' ? 'in the session' : 'in the app' };
  }
  /** The asks as the channels render them (#65): the inbox's state of each, with its words, options and answer. */
  private async channelAsks(): Promise<ChannelAsk[]> {
    const rows = (await this.record.raw('SELECT id, question, options, answer FROM asks')) as { id: string; question: string | null; options: string | null; answer: string | null }[];
    const texts = new Map(rows.map((r) => [`ask:${r.id}`, r]));
    const cards = await this.cards();
    return (await this.asks.inbox()).map((row) => {
      const t = texts.get(row.ask);
      const options = t?.options ? (JSON.parse(t.options) as { id: string; label: string }[]).map((o) => ({ id: String(o.id), label: String(o.label) })) : [];
      let answer: string | null = null;
      try { answer = t?.answer ? String(JSON.parse(t.answer)) : null; } catch { answer = t?.answer ?? null; }
      const card = cards.get(row.ask);
      return { handle: row.ask, kind: row.kind, question: t?.question ?? '', options, status: row.status, outcome: row.outcome, answer, plan: card?.plan ?? null, revision: card?.revision ?? 1 };
    });
  }
  /**
   * Each ask's card as the record holds it (#1580): the newest plan the core proposed, as a card draws it; its revision,
   * 1 and one more for each change of plan and each Take over; and the device it was taken over to last. `handle`
   * narrows it to one ask.
   */
  private async cards(handle?: string): Promise<Map<string, { plan: ChannelAsk['plan']; revision: number; holder: string | null }>> {
    const one = handle ? ` AND (subject = ? OR json_extract(data, '$.ask') = ?)` : '';
    const rows = (await this.record.raw(`SELECT kind, subject, json_extract(data, '$.ask') AS ask, json_extract(data, '$.hash') AS hash, json_extract(data, '$.steps') AS steps, json_extract(data, '$.device') AS device FROM events WHERE ((kind = 'plan.proposed' AND writer = 'core') OR kind = 'ask.taken_over')${one} ORDER BY log_pos`, handle ? [handle, handle] : [])) as { kind: string; subject: string | null; ask: string | null; hash: string | null; steps: string | null; device: string | null }[];
    const held = new Map<string, { hash?: string; steps?: string; revision: number; holder: string | null }>();
    for (const r of rows) {
      const key = String(r.kind === 'ask.taken_over' ? r.subject : r.ask);
      const card = held.get(key) ?? { revision: 1, holder: null };
      held.set(key, card);
      if (r.kind === 'ask.taken_over') Object.assign(card, { revision: card.revision + 1, holder: r.device });
      else if (r.hash !== card.hash) Object.assign(card, { revision: card.revision + (card.hash === undefined ? 0 : 1), hash: String(r.hash), steps: r.steps ?? '[]' });
    }
    return new Map([...held].map(([key, c]) => [key, {
      revision: c.revision, holder: c.holder,
      plan: c.hash === undefined ? null : {
        hash: c.hash,
        steps: (JSON.parse(c.steps!) as Obj[]).map((s) => ({ does: String(s.does), changes: (Array.isArray(s.changes) ? s.changes : []).map(String), undo: String(s.undo), public: s.public === true, cost: Number(s.cost) })),
      },
    }]));
  }
  /**
   * An answer from a copy of an ask's card at an earlier revision is refused, naming the revision; so is a signed one
   * naming none from another device once the card was taken over (#1580). An answer from the CLI, which the OS
   * confirmed, keeps no copy of its own and is held only to a revision it names.
   */
  private async onRevision(handle: string, revision: unknown, signature: unknown): Promise<void> {
    const card = (await this.cards(handle)).get(handle) ?? { revision: 1, holder: null };
    if (revision !== undefined && revision !== card.revision) {
      throw new Refused(refusal('credential', '/params/revision', `${handle} stays open: this answer is from its card at revision ${JSON.stringify(revision)}, and the card is at revision ${card.revision} now${card.holder ? `, taken over to ${card.holder}` : ''}. Answer from the card as it is now.`, revision));
    }
    const device = (signature as { signed?: { device?: unknown } } | undefined)?.signed?.device;
    if (revision === undefined && device !== undefined && card.holder !== null && device !== card.holder) {
      throw new Refused(refusal('credential', '/params/revision', `${handle} stays open: its card moved to ${card.holder} by Take over, at revision ${card.revision}, and this answer from ${String(device)} names no revision. Answer it there, or take it over here.`, handle));
    }
  }
  /**
   * Take over (#1580; design: Channel): a device you paired moves an open ask's card to itself on the trusted path,
   * signing the call with its own key. The card's revision rises, so an answer from a copy at the earlier one is
   * refused, naming the revision, and every channel's card goes out again at the new one.
   */
  private async takeOver(params: Obj, context: CallContext): Promise<Obj> {
    const handle = params.ask;
    if (typeof handle !== 'string' || !/^ask:[0-9A-Za-z]+$/.test(handle)) throw new Refused(refusal('handle_syntax', '/params/ask', 'Name the ask by its handle, ask:<id>, as deep inbox lists it.', handle));
    const [row] = (await this.record.raw(`SELECT status FROM asks WHERE id = ?`, [handle.slice(4)])) as { status: string }[];
    if (!row) throw new Refused(refusal('not_found', '/params/ask', `No ask ${handle}; take over an ask deep inbox lists.`, handle));
    if (row.status !== 'open' && row.status !== 'later') throw new Refused(refusal('not_found', '/params/ask', `${handle} is closed, so its card has nowhere to move.`, handle));
    if (params.signature === undefined) throw new Refused(refusal('unconfirmed', '/params/signature', `Take over moves ${handle}'s card to a device you paired, which signs the call with its own key.`, handle));
    await this.trusted('ask.take_over', params, context, `take over ${handle}`, handle, 'take over');
    const device = String((params.signature as { signed: { device: string } }).signed.device);
    const revision = ((await this.cards(handle)).get(handle)?.revision ?? 1) + 1;
    await this.appendCore('ask.taken_over', { device, revision }, { subject: handle });
    return { ask: handle, device, revision };
  }
  /** Unpairs a device you paired, on the trusted path (#65): its signatures count for nothing, and it is told so. */
  private async unpair(params: Obj, context: CallContext): Promise<Obj> {
    const device = params.device;
    if (typeof device !== 'string' || !/^device:[0-9A-Za-z]+$/.test(device)) throw new Refused(refusal('pattern', '/params/device', 'Name the device as device:<id>, as device.pair returned it.', device));
    if (!this.devices.keyOf(device)) throw new Refused(refusal('not_found', '/params/device', `No paired device ${device}.`, device));
    await this.trusted('device.unpair', params, context, `unpair ${device}, so what it signs counts for nothing`, device, 'unpair');
    this.devices.unpair(device, this.now());
    this.channels?.unpaired(device);
    return { unpaired: device };
  }
  /** Links your account on a channel, once the OS confirms you (#65): its answers count for "I did it", taste and choice. */
  private async link(params: Obj, context: CallContext): Promise<Obj> {
    const { channel, account } = params;
    if (typeof channel !== 'string' || !/^[a-z][a-z0-9-]*$/.test(channel)) throw new Refused(refusal('pattern', '/params/channel', 'Name the channel as it registered.', channel));
    if (typeof account !== 'string' || !account || account.length > 200) throw new Refused(refusal('type', '/params/account', 'Name your account on the channel.', account));
    const why = await this.confirmer.you(`link the account ${account} on ${channel}, so its "I did it", taste and choice answers count`, { handle: `channel:${channel}`, revision: account, process: context.peer });
    if (why) throw new Refused(refusal('unconfirmed', '', `Nothing was linked: the OS didn't confirm you (${why}).`, channel, true));
    if (!this.channels) throw new Refused(refusal('unavailable', '', 'The hub has no channels yet; try again once it is ready.', channel, true));
    this.channels.link(channel, account);
    return { channel, account };
  }

  /**
   * A person joins a project (#1337): the owner names them and a clone of the project's repo, whose forge identity is the
   * project, so every clone of it reads as one. Once the OS confirms the owner, the person's credential comes back
   * once; the hub keeps only its digest. A repo with no remote keeps its path scope, so it can't be shared.
   */
  private async addPerson(params: Obj, context: CallContext): Promise<Obj> {
    if (context.role !== 'cli') throw new Refused(refusal('role', '/method', 'A person is added from your own terminal, once the OS confirms you.', 'person.add'));
    const { person, repo } = params;
    if (typeof person !== 'string') throw new Refused(refusal('type', '/params/person', "Name the person as their forge login.", person));
    if (typeof repo !== 'string' || !isAbsolute(repo)) throw new Refused(refusal('type', '/params/repo', "Name a clone of the project's repo by its absolute path.", repo));
    const forge = forgeOf(repo);
    if (!forge) throw new Refused(refusal('not_found', '/params/repo', `${repo} is in no repo with an origin remote: a repo with no remote keeps its path scope, so it can't be shared.`, repo));
    const agent = await this.agentAbove(context.peer);
    if (agent) throw new Refused(refusal('role', '/method', `Nobody was added: this deep command runs inside agent session ${agent}'s process tree, and no agent adds a person. Run it from your own terminal.`, 'person.add'));
    const what = `add ${person} to ${forge}`;
    const why = await this.confirmer.you(what, { handle: `person:${person}`, revision: forge });
    if (why) throw new Refused(refusal('unconfirmed', '/method', `${what} changed nothing: the OS didn't confirm you (${why}).`, 'person.add', true));
    try {
      return this.people.add(person, forge);
    } catch (error) {
      throw new Refused(refusal('pattern', '/params/person', `Nobody was added: ${error instanceof Error ? error.message : String(error)}.`, person));
    }
  }
  /**
   * A one-time invite to the project of a clone's repo (#1338): the address the person's machine reaches this hub at,
   * which the inviter knows and the hub can't, this hub's ID, which that machine checks before it sends anything, and a
   * secret kept here only as its digest. No address lives in the repo. Asked once the OS confirms you, as adding is.
   */
  private async invitePerson(params: Obj, context: CallContext): Promise<Obj> {
    const { person, repo, address } = params;
    if (typeof person !== 'string') throw new Refused(refusal('type', '/params/person', 'Name the person as their forge login.', person));
    if (typeof repo !== 'string' || !isAbsolute(repo)) throw new Refused(refusal('type', '/params/repo', "Name a clone of the project's repo by its absolute path.", repo));
    if (typeof address !== 'string' || !/^[^\s:]+:\d{1,5}$/.test(address)) throw new Refused(refusal('pattern', '/params/address', "Name where the person's machine reaches this hub, as <host>:<port>.", address));
    const forge = forgeOf(repo);
    if (!forge) throw new Refused(refusal('not_found', '/params/repo', `${repo} is in no repo with an origin remote: a repo with no remote keeps its path scope, so it can't be shared.`, repo));
    await this.asYou(context, 'person.invite', `invite ${person} to ${forge}`, `invite:${person}`, forge);
    try {
      const secret = this.people.invite(person, forge);
      return { invite: inviteText({ v: 1, address, hub: this.hubId(), secret, project: forge, person }), person, project: projectIdOf(forge) };
    } catch (error) {
      throw new Refused(refusal('pattern', '/params/person', `Nobody was invited: ${error instanceof Error ? error.message : String(error)}.`, person));
    }
  }
  /** Revokes a person's credentials and open invites (#1338); the server then closes their connections. */
  private async revokePerson(params: Obj, context: CallContext): Promise<Obj> {
    const { person } = params;
    if (typeof person !== 'string' || !person) throw new Refused(refusal('type', '/params/person', 'Name the person as their forge login.', person));
    await this.asYou(context, 'person.revoke', `revoke ${person}'s credentials`, `revoke:${person}`, person);
    return { person, revoked: this.people.revoke(person) };
  }
  /** A change to who is on a project counts only from your own terminal, never an agent's, once the OS confirms you. */
  private async asYou(context: CallContext, method: string, what: string, handle: string, revision: string): Promise<void> {
    if (context.role !== 'cli') throw new Refused(refusal('role', '/method', 'Who is on a project changes from your own terminal, once the OS confirms you.', method));
    const agent = await this.agentAbove(context.peer);
    if (agent) throw new Refused(refusal('role', '/method', `Nothing changed: this deep command runs inside agent session ${agent}'s process tree, and no agent changes who is on a project. Run it from your own terminal.`, method));
    const why = await this.confirmer.you(what, { handle, revision });
    if (why) throw new Refused(refusal('unconfirmed', '/method', `${what} changed nothing: the OS didn't confirm you (${why}).`, method, true));
  }
  /** `deep race <issue>` (#352): you start a race on an issue, so its sessions settle on the first PASS and raise no "keep which?" ask. */
  private async race(params: Obj, context: CallContext): Promise<Obj> {
    const issue = Number(params.issue);
    if (!Number.isSafeInteger(issue) || issue < 1) throw refuse('type', '/params/issue', 'Name the issue by its number, such as 79.', params.issue);
    const what = `start a race on issue #${issue}`;
    if (context.role !== 'cli' || !context.peer) throw new Refused(refusal('unconfirmed', '/method', `No race started: ${what} counts only from your terminal, once the OS confirms you.`, 'race.start'));
    const agent = await this.agentAbove(context.peer);
    if (agent) throw new Refused(refusal('role', '/method', `No race started: this deep command runs inside agent session ${agent}'s process tree, and only you start a race. Run it from your own terminal.`, 'race.start'));
    // A race keeps an ask from you, so it counts as your decision: once the OS confirms you.
    const why = await this.confirmer.you(what, { handle: `race:${issue}`, revision: what });
    if (why) throw new Refused(refusal('unconfirmed', '/params/issue', `No race started: the OS didn't confirm you (${why}). Run it again and confirm.`, String(issue), true));
    const ts = this.now();
    await this.append(this.connection('core'), { v: 1, id: ulid(ts), kind: 'race.started', ts, data: { issue } });
    return { issue };
  }
  /** What feeds your numbers or labels is yours to run: an agent's word is never evidence. */
  private async notAnAgent(context: CallContext, method: string): Promise<void> {
    const agent = await this.agentAbove(context.peer);
    if (agent) throw new Refused(refusal('role', '/method', `Nothing changed: this deep command runs inside agent session ${agent}'s process tree, and no agent feeds its own numbers. Run it from your own terminal.`, method));
  }
  /**
   * deep-confirm's key set up again, lost or replaced (#880): from the app alone, signed by a device you paired, and
   * counted once you confirm with the new key, when the old one stops counting. The helper's code signature is
   * recorded again with it, so a rebuilt helper counts only from here.
   */
  private async enrollAgain(params: Obj, context: CallContext): Promise<Obj> {
    if (context.role !== 'app') throw new Refused(refusal('role', '/method', "deep-confirm's key is set up again from the app, on the trusted path.", 'confirm.enroll'));
    await this.trusted('confirm.enroll', params, context, "set up deep-confirm's key again", 'device:deep-confirm', 'enroll');
    const why = await this.confirmer.enroll(this.now(), { words: "set up DeepBuild's confirmation key again on this Mac", subject: { handle: 'device:deep-confirm', revision: String((params.signature as { signed?: Obj }).signed?.device) } });
    if (why) throw new Refused(refusal('unconfirmed', '', `deep-confirm's key stays as it was: ${why}.`, 'confirm.enroll', true));
    return { device: this.devices.enclave()!.device };
  }

  /**
   * `deep install` (#351): installs the package in a folder once the OS confirms you, the prompt naming it, after the
   * CLI showed its source and permissions; with `trust_key`, the prompt names the publisher key its envelope names
   * too, and your confirmation trusts that key for the package first. A deep command inside an agent's process tree
   * acts as that session, and no agent installs a package. The installer's refusal comes back as the result.
   */
  private async install(params: Obj, context: CallContext): Promise<Obj> {
    const from = params.from;
    if (typeof from !== 'string' || !isAbsolute(from)) throw new Refused(refusal('type', '/params/from', 'Give the package folder as an absolute path.', from));
    if (context.role !== 'cli') throw new Refused(refusal('role', '/method', 'An install counts from the CLI, once the OS confirms you.', 'extension.install'));
    const agent = await this.agentAbove(context.peer);
    if (agent) throw new Refused(refusal('role', '/method', `Nothing was installed: this deep command runs inside agent session ${agent}'s process tree, and no agent installs a package. Install it from your own terminal.`, 'extension.install'));
    if (!existsSync(join(from, 'deepbuild.json')) && existsSync(join(from, 'pack.json'))) {
      if (!this.libraries) throw refuse('unavailable', '', 'The hub is not ready to install packs.', from, true);
      const pack = readPack(from);
      if (params.digest !== pack.digest) throw refuse('changed', '/params/digest', `${pack.ref} changed since its install plan was read.`, params.digest);
      const why = await this.confirmer.you(`install ${pack.ref} (${pack.digest}) from ${from}; its assets fetch only after a separate authority ask or rule`, { handle: `pack:${pack.ref}`, revision: pack.digest, process: context.peer });
      if (why) throw refuse('unconfirmed', '', `Nothing was installed: ${why}`, from, true);
      const dir = this.libraries.packs.stage(pack);
      const checked = await this.canvasCall({ call: 'install_pack', id: pack.id, dir });
      if (checked.outcome !== 'installed') return { status: 'refused', reason: JSON.stringify(checked.issues) };
      this.libraries.packs.admit(pack);
      return { status: 'installed', id: pack.id, version: pack.version, digest: pack.digest };
    }
    // Only for the prompt's words: the installer reads the manifest again, as data, and refuses what it must.
    const m = await readFile(join(from, 'deepbuild.json'), 'utf8').then((text) => JSON.parse(text) as { id?: unknown; version?: unknown; publisher_key?: unknown; sources?: { variant?: string; host?: string }[] })
      .catch(() => ({ id: undefined, version: undefined, publisher_key: undefined, sources: undefined }));
    // The hosts its library sources name (#1731), which this install grants, each at its source's own quota or under.
    const hosts = libraryHosts(m);
    const key = params.trust_key === true ? m.publisher_key : undefined;
    if (params.trust_key === true && (typeof key !== 'string' || typeof m.id !== 'string')) throw new Refused(refusal('required', '/params/trust_key', 'Only a signed package names a publisher key to trust.', from));
    const why = await this.confirmer.you(`${key ? `trust the publisher key ${String(key)} for ${String(m.id)}, and ` : ''}install ${String(m.id)}@${String(m.version)} from ${from}${hosts.length ? `, reaching ${hosts.join(', ')}` : ''}`, { handle: `package:${String(m.id)}`, revision: String(m.version), process: context.peer });
    if (why) throw new Refused(refusal('unconfirmed', '', `Nothing was installed: the OS didn't confirm you (${why}).`, from, true));
    if (!this.extensions) throw new Refused(refusal('unavailable', '', 'The hub has no extension host yet; try again once it is ready.', from, true));
    try {
      if (key) await this.extensions.trustKey(this.connection('cli'), String(m.id), String(key));
      const pkg = await this.extensions.install({ from, builtBy: null, ...(hosts.length ? { grant: { record: [], hosts: hosts.map((host) => ({ host, quota: LIBRARY_HOST_QUOTA })) } } : {}) });
      const installed = { status: 'installed', id: pkg.id, version: pkg.version, digest: pkg.digest };
      // Nothing loads before its conformance passes (#348): it runs now, and the package loads at once; its result,
      // kept for these bytes, lets each later start load it. One that fails stays installed, and the reason is shown.
      try {
        const checked = await this.extensions.check(pkg);
        const load = checked.passed ? await this.extensions.load(pkg) : { status: 'refused' as const, reason: `it failed conformance: ${checked.reasons.join('; ')}` };
        plantedReload(this.options.plant);
        const panels = load.status === 'refused' ? undefined : await this.panelKits(pkg.id);
        return load.status === 'refused' ? { ...installed, not_loaded: load.reason } : panels ? { ...installed, not_loaded: panels } : installed;
      } catch (error) {
        return { ...installed, not_loaded: error instanceof Error ? error.message : String(error) };
      }
    } catch (error) {
      return { status: 'refused', reason: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Each view's panel held to panel@1 (#1454), its verdict kept for the app: what failed, in words, or undefined. */
  private async panelKits(id: string, unrun = false): Promise<string | undefined> {
    const failed: string[] = [];
    for (const view of this.extensions!.installedViews().filter((v) => v.extension === id && (!unrun || v.kit === null))) {
      const { verdict, why } = await panelKit(view.folder);
      this.extensions!.keepKit(id, { slot: 'panel@1', fill: view.name, verdict });
      if (verdict !== 'PASS') failed.push(`${view.name} reads ${verdict} on panel@1: ${why}`);
    }
    return failed.length ? failed.join('; ') : undefined;
  }

  /** A view's ⌘K command, chosen in the app (#1454): the action its manifest declares, called as you. */
  /**
   * Later on an ask, from the app's action table (#1462): it goes below the open asks and comes back an hour before
   * its default applies. The hour is drafted. The asks core checks it against every deadline it could hide.
   */
  private async putOff(params: Obj): Promise<Obj> {
    const { ask } = params;
    if (typeof ask !== 'string' || !ask.startsWith('ask:')) throw refuse('type', '/params/ask', 'Name the ask by its handle, ask:<id>.', ask);
    try {
      await this.asks.laterBefore(this.connection('app'), ask, LATER_BEFORE_MS);
    } catch (error) {
      if (error instanceof AskRefused) throw refuse('refused', '/params/ask', error.message, ask);
      throw error;
    }
    return { ask };
  }

  /** Pause on a session's row, from the app (#1462): recorded as the core, the session its subject as every session event names it. */
  private async pauseSession(params: Obj): Promise<Obj> {
    const { session } = params;
    if (typeof session !== 'string' || !letters(session)) throw refuse('type', '/params/session', 'Name the session by its ID.', session);
    const ts = this.now();
    await this.append(this.connection('core', { session }), { v: 1, id: ulid(ts), kind: 'session.paused', ts, subject: `session:${letters(session)}`, data: {} });
    return { session, paused: true };
  }

  private async runCommand(params: Obj): Promise<Obj> {
    const { action } = params;
    const view = this.extensions?.installedViews().find((v) => v.commands.some((c) => c.action === action));
    if (!view) throw new Refused(refusal('not_found', '/params/action', `No installed view runs ${String(action)}.`, action));
    return { ...(await this.extensions!.callAction({ action: String(action), target: { handle: `ext:${view.extension}`, version: view.version }, input: {}, caller: this.connection('app') })) };
  }

  /**
   * `deep off`, `deep on`, `deep hub stop`, `deep hub use` and `deep setup --undo` (#19): each takes effect only once
   * the OS confirms you, with a prompt naming the command. Run inside an agent's process tree it acts as that agent's
   * session, and no agent switches DeepBuild off; the peer check alone never makes one count.
   */
  /**
   * The OS confirming you for a press on the question card that wasn't hardware (#1454): one press, one prompt, naming
   * the option's words the app sends and the ask the hub reads, and never cached. The app signs its answer only after this.
   */
  private async confirmCard(params: Obj): Promise<Obj> {
    const { ask: handle, reason } = params;
    if (typeof handle !== 'string' || !/^ask:[0-9A-Za-z]+$/.test(handle)) throw new Refused(refusal('handle_syntax', '/params/ask', 'Name the ask by its handle, ask:<id>.', handle));
    if (typeof reason !== 'string' || !reason) throw new Refused(refusal('required', '/params/reason', "Give the words the OS's prompt shows.", reason));
    const [row] = (await this.record.raw("SELECT e.data AS data FROM events e WHERE e.id = ? AND e.kind = 'ask.created'", [handle.slice(4)])) as { data: string }[];
    if (!row) throw new Refused(refusal('not_found', '/params/ask', `No ask ${handle}.`, handle));
    const why = await this.confirmer.you(reason.slice(0, 200), { handle, revision: await this.revisionOf(handle, JSON.parse(row.data) as { pinned_to?: { ref?: string } }) });
    if (why) throw new Refused(refusal('unconfirmed', '/params/ask', `${handle} stays open: the OS didn't confirm you (${why}).`, handle, true));
    return { confirmed: handle };
  }

  private async confirmCommand(params: Obj, context: CallContext): Promise<Obj> {
    const command = params.command;
    if (typeof command !== 'string' || !AUTHORITY.has(command)) throw new Refused(refusal('enum', '/params/command', `Name one of ${[...AUTHORITY].join(', ')}.`, command));
    const what = typeof params.detail === 'string' ? `${command} ${params.detail.slice(0, 200)}` : command;
    if (context.role !== 'cli') throw new Refused(refusal('unconfirmed', '/method', `${what} changed nothing: from the app it counts only when a device you paired signs it; from your terminal, once the OS confirms you.`, command));
    // A deep command names its process so the peer check can read whose it is; a call that names none counts for
    // nothing, and asks the OS nothing.
    if (!context.peer) throw new Refused(refusal('unconfirmed', '/method', `${what} changed nothing: the call names no process for the peer check; run the deep command itself.`, command));
    const agent = await this.agentAbove(context.peer);
    if (agent) throw new Refused(refusal('role', '/params/command', `${what} changed nothing: it runs inside agent session ${agent}'s process tree, so it acts as that session, and no agent changes what watches it. Run it from your own terminal.`, command));
    if (this.options.plant === 'acts-on-peer-check') return { confirmed: command };
    const why = await this.confirmer.you(what, { handle: `command:${command}`, revision: what, process: context.peer });
    if (why) throw new Refused(refusal('unconfirmed', '/params/command', `${what} changed nothing: the OS didn't confirm you (${why}). It takes effect only once the OS confirms you; run it again and confirm.`, command, true));
    return { confirmed: command };
  }

  /**
   * `deep guard add` (#304): installs the guard entries you wrote once the OS confirms you, the prompt naming them.
   * Each is checked first through deep-hook's check mode on its planted call and twin; a refusal comes back as the
   * result. No agent writes rules.json, so a deep command inside an agent's process tree adds nothing.
   */
  private async addGuard(params: Obj, context: CallContext): Promise<Obj> {
    if (context.role !== 'cli') throw new Refused(refusal('role', '/method', 'A guard is added from the CLI, once the OS confirms you.', 'guard.add'));
    const agent = await this.agentAbove(context.peer);
    if (agent) throw new Refused(refusal('role', '/method', `Nothing was added: this deep command runs inside agent session ${agent}'s process tree, and no agent changes your rules. Add it from your own terminal.`, 'guard.add'));
    const names = isObj(params.guards) && isObj(params.guards.entries) ? Object.keys(params.guards.entries) : [];
    const why = await this.confirmer.you(`add the guard ${names.length === 1 ? 'entry' : 'entries'} ${names.join(', ')} to your rules`, { handle: 'command:guard add', revision: names.join(','), process: context.peer });
    if (why) throw new Refused(refusal('unconfirmed', '', `Nothing was added: the OS didn't confirm you (${why}).`, names.join(', '), true));
    return addGuards(this.root.dir, params.guards, { deepHook: deepHook(), classes: toolClasses(), plant: this.options.plant });
  }

  /**
   * The peer check: the agent session whose process is above the caller's, by PID and start time as that session's
   * hooks established them. It decides whose session a deep command acts as, never whether an answer counts.
   */
  private async agentAbove(peer: CallContext['peer']): Promise<string | undefined> {
    if (!peer || (await this.startOf(peer.pid, true)) !== peer.start) return undefined;
    // Only a session of another process can be above it (a process table has no cycles): with none, the table isn't read.
    if (![...this.sessions.values()].some((s) => s.pid > 1 && s.pid !== peer.pid)) return undefined;
    const up = await parents();
    const seen = new Set<number>();
    for (let pid = up.get(peer.pid); pid !== undefined && pid > 1 && !seen.has(pid); pid = up.get(pid)) {
      seen.add(pid);
      // A PID another process now holds, with a start time no session recorded (#806's test seam): no agent's tree.
      if (reusedPids().includes(pid)) continue;
      // After a `/clear` the process's session is its newest one.
      const session = [...this.sessions.values()].filter((s) => s.pid === pid).at(-1);
      // A start that can't be read (ps failing under load) proves nothing: the session's process still running counts.
      const start = session ? await this.startOf(pid, true) : undefined;
      if (session && (start === undefined ? running(pid) : start === session.start)) return session.id;
    }
    return undefined;
  }

  /** Streams every event after `after` to the subscriber, then each one appended from then on; a scope narrows it (#1575). */
  async subscribe(sub: string, after: number, scope?: Scope): Promise<{ head?: number; snapshot?: true }> {
    await this.ready;
    return this.log.subscribe(sub, after, scope);
  }
  unsubscribe(sub: string): void {
    this.log.unsubscribe(sub);
  }

  // ---- deep mcp.

  /**
   * One deep_* call: its arguments held to its tool's schema, bound to the session it acts for, then served. Binding
   * holds the queue, so it sees every hook that arrived before the call; serving holds up no session's hooks. Its
   * refusal reaches the agent scrubbed of every value the hub holds, scrubbed whole before it is cut.
   */
  private async mcpCall(params: Obj, context: CallContext): Promise<unknown> {
    const tool = String(params.tool);
    // No MCP call starts a session, whatever it claims (#1330): refused before its arguments are read.
    if (tool === 'deep_start') return this.sessionStarts.refuseMcp(context.session);
    try {
      const args = checkArguments(tool, params.arguments);
      const sent = isObj(params.arguments) ? params.arguments : {};
      // What deep-hook spooled ran before this call, as a hook's does: a replay running goes first, so a claim comes
      // after the call it follows, not before the work it claims.
      await (this.replaying ?? Promise.resolve());
      // A call bound to no session still reads what belongs to no session; every other tool needs its session.
      // A deep_show bound to no session is refused by the canvas side with no_session, as its reply (#806).
      const session = await this.queue(async () => this.bind(tool, sent, context, tool !== 'deep_status' && tool !== 'deep_search' && tool !== 'deep_show' && tool !== 'deep_kinds' && tool !== 'deep_job' && tool !== 'find_actions'));
      switch (tool) {
        case 'find_actions': return await this.findActions(args.query as string | null);
        case 'call_action': return await this.callPluginAction(session!, args);
        case 'deep_show': return await this.show(session ? { session } : { session: null }, showCall(args));
        case 'deep_kinds': return await this.kinds(args);
        case 'deep_job': return await this.job(args, context.call);
        case 'deep_status': return await this.status(session);
        case 'deep_search': return await this.find(String(args.query), session, context, typeof args.file === 'string' ? args.file : undefined, typeof args.cursor === 'string' ? args.cursor : undefined);
        case 'deep_ask': return await this.askFor(session!, args);
        case 'deep_wait': return await this.waitFor(session!, String(args.ask));
        case 'deep_open_item': return await this.openItem(session!, String(args.text));
        case 'deep_claim': return await this.claim(session!, args);
        case 'deep_evidence': return await this.attach(session!, args);
        case 'deep_propose': return await this.propose(session!, args);
        case 'deep_env': return await this.deepEnv(session!, String(args.action));
        case 'deep_drive': return await this.replicas.drive(session!, args);
        default: return await this.runCheck(session!, args);
      }
    } catch (error) {
      throw this.forAgent(error, tool);
    }
  }
  private forAgent(error: unknown, tool: string): Refused {
    const refused = error instanceof Refused ? error : error instanceof AskRefused ? (asRefused(error) as Refused)
      : new Refused(refusal('unavailable', '', `${tool} failed in the hub: ${error instanceof Error ? error.message : String(error)}; nothing was recorded.`, tool, true));
    const plant = this.options.plant;
    const scrub = (text: string) => (plant === 'errors-unscrubbed' ? text : scrubText(text, { held: this.options.held }));
    const out: Partial<Refusal> = { ...refused.refusal, remediation: scrub(refused.refusal.remediation), actual: scrub(refused.whole ?? refused.refusal.actual).slice(0, 8192) };
    if (plant === 'errors-without-actual') delete out.actual;
    return new Refused(out as Refusal);
  }
  /**
   * The session a deep_* call acts for: its deep mcp's own, or the one unspent PreToolUse stamped for this very call,
   * by its tool and the digest of its arguments as sent. A call more than one unspent stamp matches binds to none.
   * Unbound, a call that needs its session is refused; one that only reads goes on bound to none.
   */
  private bind(tool: string, args: Obj, context: CallContext, required: boolean): string | undefined {
    const live = (id: string) => { const s = this.sessions.get(id); return s && !s.ended ? s : undefined; };
    if (context.session) {
      if (live(context.session)) return context.session;
      if (!required) return undefined;
      throw refuse('unbound', '/params/tool', `Session ${context.session} has ended; this deep mcp acts for no session now.`, tool);
    }
    const parent = context.parent;
    const digest = sha256Hex(canonicalize(args as JsonValue));
    const matches = parent ? this.stamps.filter((s) => {
      const session = live(s.session);
      return s.tool === tool && s.digest === digest && session !== undefined && session.pid === parent.pid && session.start === parent.start;
    }) : [];
    const bound = this.options.plant === 'binds-first-stamp' || matches.length === 1 ? matches[0] : undefined;
    if (!bound) {
      if (!required) return undefined;
      throw refuse('unbound', '/params/arguments', `This ${tool} call binds to no session: ${matches.length ? 'more than one' : 'no'} PreToolUse stamped for it is unspent.`, tool);
    }
    this.stamps.splice(this.stamps.indexOf(bound), 1);
    return bound.session;
  }
  // ---- The canvas side (#806): deep_show, `deep show`, render-back, and what the app draws.

  /** The canvas core, started at the first canvas call; the world file a test gives it; the app's presentations. */
  private canvasCore?: Canvas;
  private readonly worldFile = new WorldFile(process.env.DEEP_HUB_TEST_SHOW);
  /** Each presented revision for the app, in order; an app's `canvas.drawn` takes those after the last it took. */
  private readonly presented: Obj[] = [];
  /** The documents deep_show has named, each on the app's canvas panel. */
  private readonly shownDocs = new Set<string>();
  private readonly drawnUpTo = new Map<string, number>();
  /** When an app last took what was presented: an app that took it within the last 250 ms is open (it asks every 100 ms), and draws it. */
  private appSeen = 0;
  private readonly appOpen = (): boolean => Date.now() - this.appSeen < 250;

  /** The world the canvas core reads: the hub's live sessions, the record's asks and readings, and the world file. */
  private async canvasWorld(): Promise<CanvasWorld> {
    const file = { ...this.worldFile.read(), packs: this.libraries?.packs.all() ?? [] };
    const sessions = [...this.sessions.values()].filter((s) => !s.ended).map((s) => ({ id: s.id, thread: s.thread, name: nameOf(file, s.id, s.agent) }));
    const record: Obj = {};
    const asks = (await this.record.raw('SELECT id, session_id, status FROM asks')) as { id: string; session_id: string | null; status: string }[];
    for (const a of asks) record[`ask:${a.id}`] = { session: a.session_id, state: a.status === 'open' || a.status === 'later' ? 'needs_you' : 'done' };
    const readings = (await this.record.raw("SELECT e.session_id AS session, e.data AS data FROM events e WHERE e.kind = 'reading.recorded' ORDER BY e.log_pos")) as { session: string | null; data: string }[];
    for (const r of readings) {
      const d = JSON.parse(r.data) as Obj;
      if (typeof d.reading === 'string' && typeof d.value === 'number') record[d.reading] = { session: r.session, value: d.value, as_of: Number(d.as_of ?? 0) };
    }
    return { sessions, record, file, docs: [...this.shownDocs] };
  }
  private canvas(): Canvas {
    return (this.canvasCore ??= new Canvas(this.root.evidence));
  }
  private async canvasCall(call: Obj): Promise<Obj> {
    return (await this.canvas().call(await this.canvasWorld(), call)).reply;
  }

  /**
   * deep_show for a session, or for none (the call binds to no session), or `deep show` from the CLI acting as the
   * session the peer check found, or as you: the writer is the binding's, never the payload's.
   */
  private async show(as: { session: string | null } | { you: true }, call: Obj): Promise<Obj> {
    if (typeof call.doc === 'string') this.shownDocs.add(call.doc);
    // The planted hub stamps the writer the payload claims (#806's wrong program): a session whose thread it names.
    if (this.options.plant === 'deep-show-writer-from-payload' && 'session' in as && isObj(call.document) && typeof call.document.writer === 'string') {
      const claimed = [...this.sessions.values()].find((s) => `agent:${s.thread}` === (call.document as Obj).writer);
      if (claimed) {
        const { writer: _writer, ...document } = call.document;
        as = { session: claimed.id };
        call = { ...call, document };
      }
    }
    if (call.call === 'render_back') {
      // Render-back of a revision the document has had, at a time: the session's own, never one bound to none.
      if (!('session' in as) || !as.session) return { outcome: 'refused', code: 'no_session', issues: [], snapshots: [] };
      let rev = call.rev;
      if (rev === null) rev = ((await this.canvasCall({ call: 'revisions', doc: call.doc })).revisions as { rev: number; state: string }[] | undefined)?.find((r) => r.state === 'current')?.rev ?? 0;
      return this.canvasCall({ ...call, rev, session: as.session });
    }
    if (isObj(call.document)) {
      const held = await this.preparePackAssets(call.document);
      if (held) return held;
    }
    // An asset.game@1 item naming an asset by hash (#1066's from: {asset}, #1731) takes the license kept with it.
    const game = await this.gameAssets(call);
    if (game.refused) return game.refused;
    call = game.call;
    const via = 'you' in as ? { peer: { pid: 0, start: 0 } } : { session: as.session };
    const name = 'you' in as ? 'deep show' : 'deep_show';
    const { reply: drawn, presented } = await this.canvas().call(await this.canvasWorld(), { call: name, ...via, ...call });
    const reply = game.assets.length ? { ...drawn, assets: game.assets } : drawn;
    if (presented) await this.recordRevision(as, presented, reply);
    // The planted hub waits for an app to draw the revision instead of rendering back headless.
    if (this.options.plant === 'deep-show-waits-for-app' && reply.outcome === 'presented' && !(await waitForApp(this.appOpen))) {
      return { ...reply, outcome: 'not_presented', reason: 'timeout', snapshots: [] };
    }
    return reply;
  }
  /**
   * The asset.game@1 items of a document that name an asset by hash (#1731; #1066's `from: {asset}`): each expands to
   * the mesh.asset@1 it draws, with the license the asset was kept with at fetch, listed in the reply's `assets`. An
   * asset no fetch kept with its license is BLOCKED, naming the item and the asset, so the revision is refused.
   */
  private async gameAssets(call: Obj): Promise<{ call: Obj; assets: Obj[]; refused?: Obj }> {
    const doc = call.document;
    if (!isObj(doc) || !isObj(doc.items)) return { call, assets: [] };
    const items: Obj = {};
    const assets: Obj[] = [];
    const issues: Obj[] = [];
    for (const [key, item] of Object.entries(doc.items)) {
      const sha = isObj(item) && item.kind === 'asset.game@1' && isObj(item.from) ? item.from.asset : undefined;
      if (typeof sha !== 'string') { items[key] = item; continue; }
      const it = item as Obj;
      const id = typeof it.id === 'string' ? it.id : key;
      const pinned = this.libraries?.packs.byHash(doc.packs, sha);
      let kept = this.libraries?.asset(sha, pinned?.pack);
      if (pinned && (!kept || !await this.store.verify(sha))) {
        const fetched = await this.libraries!.fetchPack(pinned.pack, pinned.asset.path);
        if (fetched.status !== 'fetched') return { call, assets, refused: { ...fetched, outcome: 'refused', code: 'asset_blocked', issues: [{ severity: 'error', code: 'asset.blocked', ids: [id], message: `BLOCKED: ${JSON.stringify(fetched)}` }], snapshots: [] } };
        kept = fetched.asset;
      }
      if (kept?.pack && (!pinned || pinned.pack !== kept.pack)) kept = undefined;
      if (!kept) {
        issues.push({ severity: 'error', code: 'asset.unlicensed', ids: [id], path: `/items/${key}/from/asset`, message: `BLOCKED: ${id} names asset ${sha}, which no fetch kept with a license; fetch it from a library first` });
        continue;
      }
      assets.push({ item: id, asset: sha, license: kept.license, upstream: kept.upstream, ...(kept.pack ? { pack: kept.pack } : { library: kept.library }) });
      const { from: _from, budget: _budget, params: _params, ...rest } = it;
      items[key] = { ...rest, kind: 'mesh.asset@1', order: typeof rest.order === 'string' ? rest.order : `a${assets.length - 1}`, params: { sha256: sha, node: 0 } };
    }
    if (issues.length) return { call, assets, refused: { outcome: 'refused', code: 'asset_blocked', issues, snapshots: [] } };
    if (!assets.length) return { call, assets };
    // What the expansion draws with is scene3d's, so the document requires it, as one that wrote mesh.asset@1 would.
    const requires = isObj(doc.requires) ? doc.requires : {};
    const modules = isObj(requires.modules) ? requires.modules : {};
    const needs = 'scene3d' in modules ? requires : { ...requires, modules: { ...modules, scene3d: '^1' } };
    return { call: { ...call, document: { ...doc, requires: needs, items } }, assets };
  }
  /**
   * deep_kinds (#412): the canvas core's listing, words, guides and gallery. It reads and changes nothing, so it needs
   * no session; a refusal is the canvas core's error@2, at its path under the call's arguments.
   */
  private async kinds(args: Obj): Promise<Obj> {
    // Asset search and fetch (#1731) span the enabled libraries, which the hub reads; the canvas core holds none.
    if (args.op === 'assets' || args.op === 'fetch') return this.assets(args);
    const call: Obj = { call: 'deep_kinds' };
    for (const [k, v] of Object.entries(args)) if (v !== null) call[k] = v;
    const reply = await this.canvasCall(call);
    const e = reply.error;
    if (isObj(e)) throw refuse(String(e.code), `/params/arguments${String(e.path)}`, String(e.remediation), e.actual);
    return reply;
  }
  /**
   * deep_kinds `assets` and `fetch` (#1731): one ranked list over the enabled libraries' rows, and a fetch of one row
   * by its library and id, held on your answer, refused naming why, or BLOCKED with one unblock ask.
   */
  private async assets(args: Obj): Promise<Obj> {
    const libraries = this.libraries;
    if (!libraries) throw refuse('unavailable', '', 'The hub has no extension host yet; try again once it is ready.', 'deep_kinds', true);
    for (const k of Object.keys(args)) {
      const takes = args.op === 'assets' ? ['op', 'query', 'kind', 'size_m', 'license', 'limit'] : ['op', 'library', 'id', 'pack', 'asset'];
      if (args[k] !== null && args[k] !== undefined && !takes.includes(k)) throw refuse('unlisted_field', `/params/arguments/${k}`, `Leave out ${k}: ${String(args.op)} takes only ${takes.slice(1).join(', ')}.`, k);
    }
    try {
      if (args.op === 'fetch') {
        if (typeof args.pack === 'string') {
          if (typeof args.asset !== 'string' || args.library || args.id) throw refuse('required', '/params/arguments/asset', 'Give pack@version and one asset path, without library or id.', args.asset);
          return { ...(await libraries.fetchPack(args.pack, args.asset)) };
        }
        if (typeof args.library !== 'string' || typeof args.id !== 'string') throw refuse('required', `/params/arguments/${typeof args.library === 'string' ? 'id' : 'library'}`, 'Give library and id, as a search row names them.', null);
        return { ...(await libraries.fetch(args.library, args.id)) };
      }
      if (typeof args.query !== 'string' || !args.query.trim()) throw refuse('required', '/params/arguments/query', 'Give query, the words to search the libraries for.', args.query ?? null);
      const size = args.size_m as number[] | null;
      if (size !== null && (size.length !== 2 || !(size[0]! >= 0 && size[0]! <= size[1]!))) throw refuse('type', '/params/arguments/size_m', 'Give size_m as [least, most] in metres.', size);
      const limit = (args.limit as number | null) ?? LIMIT_MAX;
      if (limit < 1 || limit > LIMIT_MAX) throw refuse('maximum', '/params/arguments/limit', `Give limit from 1 to ${LIMIT_MAX}.`, limit);
      return { ...(await libraries.search({ words: args.query, kind: (args.kind as AssetKind | null) ?? null, size_m: size ? [size[0]!, size[1]!] : null, license: (args.license as string[] | null) ?? null, limit })) };
    } catch (e) {
      if (e instanceof LibraryRefused) return { status: 'refused', reason: e.message };
      throw e;
    }
  }
  /**
   * deep_job (#1922): the job kinds and their qualified tools, or one run of a kind on a pinned tool, outside the hub's
   * process. It changes no document and needs no session; its result is a reading with a receipt, never a verdict.
   */
  private async job(args: Obj, caller: string | undefined): Promise<Obj> {
    if (!this.jobKinds) throw refuse('unavailable', '', 'The hub has no extension host yet; try again once it is ready.', 'deep_job', true);
    return args.op === 'list' ? this.jobKinds.list() : this.jobKinds.run(args, caller);
  }
  /** A pack's network authority is yours, never an agent's, and matches only that pack and license list. */
  private async packRule(params: Obj, context: CallContext): Promise<Obj> {
    const { pack, licenses } = params;
    if (typeof pack !== 'string' || !Array.isArray(licenses) || !licenses.every((l) => typeof l === 'string' && l)) throw refuse('type', '/params', 'Name pack as owner/name and list its allowed license IDs.', params);
    await this.asYou(context, 'pack.rule', `allow ${pack} to fetch assets under ${licenses.join(', ') || 'no license'}`, `pack:${pack}`, JSON.stringify(licenses));
    if (!this.libraries) throw refuse('unavailable', '', 'The hub is not ready.', pack, true);
    return this.libraries.packRule(pack, licenses as string[]);
  }
  /** `job.rule` (#1922): your standing rule for a paid tool, from your own terminal once the OS confirms you: the most a run may cost with no ask. */
  private async jobRule(params: Obj, context: CallContext): Promise<Obj> {
    const { tool, usd } = params;
    if (typeof tool !== 'string' || !/^[a-z0-9][a-z0-9_-]*@\d+\.\d+\.\d+$/.test(tool)) throw new Refused(refusal('type', '/params/tool', 'Name the tool by name@version, as deep_job lists it.', tool));
    if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) throw new Refused(refusal('type', '/params/usd', 'Give usd, the most a run of the tool may cost with no ask, in US dollars.', usd));
    if (context.role !== 'cli') throw new Refused(refusal('role', '/method', 'A paid tool\'s standing rule is set from your own terminal, once the OS confirms you.', 'job.rule'));
    const agent = await this.agentAbove(context.peer);
    if (agent) throw new Refused(refusal('role', '/method', `Nothing changed: this deep command runs inside agent session ${agent}'s process tree, and no agent sets a paid tool's rule. Run it from your own terminal.`, 'job.rule'));
    const what = `let ${tool} run at up to $${usd} a run with no ask`;
    const why = await this.confirmer.you(what, { handle: `job:${tool}`, revision: what });
    if (why) throw new Refused(refusal('unconfirmed', '/method', `${what} changed nothing: the OS didn't confirm you (${why}).`, 'job.rule', true));
    if (!this.jobKinds) throw new Refused(refusal('unavailable', '', 'The hub has no extension host yet; try again once it is ready.', 'job.rule', true));
    return this.jobKinds.rule(tool, usd);
  }
  /** `library.on`, `library.off` and `library.rule` (#1731): yours alone, from your own terminal, once the OS confirms you. */
  private async library(method: string, params: Obj, context: CallContext): Promise<Obj> {
    const { library, licenses } = params;
    if (typeof library !== 'string' || !library) throw new Refused(refusal('type', '/params/library', 'Name the library by its source name, as a search row\'s from names it.', library));
    if (method === 'library.rule' && (!Array.isArray(licenses) || !licenses.every((l) => typeof l === 'string' && l))) throw new Refused(refusal('type', '/params/licenses', 'List the licenses the rule allows, by SPDX ID.', licenses));
    if (context.role !== 'cli') throw new Refused(refusal('role', '/method', 'A library is turned on or off, and its rule set, from your own terminal, once the OS confirms you.', method));
    const agent = await this.agentAbove(context.peer);
    if (agent) throw new Refused(refusal('role', '/method', `Nothing changed: this deep command runs inside agent session ${agent}'s process tree, and no agent changes a library. Run it from your own terminal.`, method));
    const what = method === 'library.rule' ? `let ${library} fetch under ${(licenses as string[]).join(', ') || 'no license'} with no ask` : `turn ${library} ${method === 'library.on' ? 'on' : 'off'}`;
    const why = await this.confirmer.you(what, { handle: `library:${library}`, revision: what });
    if (why) throw new Refused(refusal('unconfirmed', '/method', `${what} changed nothing: the OS didn't confirm you (${why}).`, method, true));
    if (!this.libraries) throw new Refused(refusal('unavailable', '', 'The hub has no extension host yet; try again once it is ready.', method, true));
    try {
      return method === 'library.rule' ? { ...this.libraries.rule(library, licenses as string[]) } : { ...this.libraries.turn(library, method === 'library.on') };
    } catch (e) {
      if (e instanceof LibraryRefused) throw new Refused(refusal('not_found', '/params/library', `${e.message}.`, library));
      throw e;
    }
  }
  /** A revision the canvas core made current: recorded by its hash, its canonical document in evidence, and presented to the app. */
  private async recordRevision(as: { session: string | null } | { you: true }, p: Obj, reply: Obj): Promise<void> {
    const session = 'session' in as ? as.session : null;
    const writer = p.writer as { kind: string; id: string };
    const hash = String(p.hash);
    // The canvas core wrote the canonical document under its hash; the store's index takes it, origin from the binding.
    await this.stored(await this.store.connect(session ? { role: 'agent', session } : { role: 'deepbuild', via: 'job' }).put({
      bytes: new Uint8Array(readFileSync(join(this.root.evidence, hash.slice(0, 2), hash.slice(2)))), kind: 'canvas.revision', source: `doc:${String(p.doc)}`,
      redaction: 'complete', license: { name: 'session', allows: [] },
    }), "the revision's canonical document");
    const ts = this.now();
    const agent = session ? this.sessions.get(session)?.agent : undefined;
    const connection = session ? this.agentConnection(session) : this.connection('cli');
    const count = (k: string) => ((reply[k] as unknown[] | undefined) ?? []).length;
    await this.append({ ...connection, ...(agent ? { agent } : {}) }, {
      v: 2, id: ulid(ts), kind: 'doc.patched', ts, subject: `doc:${String(p.doc)}`, evidence: [hash],
      data: {
        doc: `doc:${String(p.doc)}`, rev: Number(p.rev), patch: null, writer: writer.kind,
        achieved: { created: {}, updated: count('changed'), deleted: {}, unchanged: count('changed') + count('created') + count('removed') === 0 },
        hash, layer: String(p.layer), thread: writer.kind === 'agent' ? writer.id : null,
      } as JsonValue,
    });
    this.presented.push({ doc: p.doc, rev: p.rev, rect: p.rect, layers: p.layers, session });
  }
  /** The same first-use gate for a shown document and its exports, for every asset-reading kind. */
  private async preparePackAssets(document: Obj): Promise<Obj | undefined> {
    if (!this.libraries) return { status: 'BLOCKED', outcome: 'refused', cause: 'The asset host is not ready.', snapshots: [] };
    for (const pack of Array.isArray(document.packs) ? document.packs : []) if (typeof pack !== 'string' || !this.libraries.packs.get(pack)) {
      return { status: 'BLOCKED', outcome: 'refused', cause: `pack_missing: ${String(pack)}`, snapshots: [] };
    }
    for (const { pack, asset } of this.libraries.packs.used(document)) {
      const fetched = await this.libraries.fetchPack(pack, asset.path);
      if (fetched.status !== 'fetched') return { ...fetched, outcome: 'refused', code: 'asset_blocked', issues: [{ severity: 'error', code: 'asset.blocked', ids: [asset.path], message: `BLOCKED: ${JSON.stringify(fetched)}` }], snapshots: [] };
    }
    return undefined;
  }
  /** The hub resolves a pack export through its pinned store. The CLI writes only the returned PNG bytes. */
  private async exportStill(params: Obj): Promise<Obj> {
    if (!isObj(params.document) || typeof params.still !== 'string') throw refuse('type', '/params', 'Give document and still, a frame or marker.', params);
    const held = await this.preparePackAssets(params.document);
    if (held) return held;
    const game = await this.gameAssets({ document: params.document });
    if (game.refused) return game.refused;
    const packs = this.libraries!.packs.all();
    const rendered = await renderStill(game.call.document, params.still, this.root.evidence, packs);
    const hash = (rendered.snapshots as Obj[] | undefined)?.[0]?.sha256;
    if (rendered.outcome !== 'presented' || typeof hash !== 'string') return { status: 'BLOCKED', cause: `No still could be drawn: ${JSON.stringify(rendered)}` };
    // The canvas store's bytes are rehashed before they leave the hub; neither an input path nor an output path
    // is accepted here, so an agent cannot make the hub read or write outside its own evidence folder.
    const bytes = await this.store.read(hash);
    return { status: 'exported', sha256: hash, png: Buffer.from(bytes).toString('base64') };
  }
  /** `deep show` from the CLI: the peer check makes it the agent's whose process tree runs it, never by PID alone; else yours. */
  private async showCli(params: Obj, context: CallContext): Promise<Obj> {
    const session = await this.agentAbove(context.peer);
    return this.show(session ? { session } : { you: true }, showCall(params));
  }
  /** The user's side the app plays (#384, #393): its input, asks and window, through the canvas core. */
  private async canvasUser(params: Obj, context: CallContext): Promise<Obj> {
    if (context.role !== 'app') throw refuse('role', '/method', 'Only the app plays your input on the canvas.', 'canvas.user');
    const call = isObj(params.call) ? params.call : {};
    return this.canvasCall(call);
  }
  /** What the app has yet to draw: every revision presented after the last it took. */
  private drawnBy(context: CallContext): Obj {
    this.appSeen = Date.now();
    const key = context.role;
    const from = this.drawnUpTo.get(key) ?? 0;
    this.drawnUpTo.set(key, this.presented.length);
    return { presented: this.presented.slice(from) };
  }

  /** The connection a session's deep mcp writes through: writer mcp:<session>, from the binding, never the call. */
  private agentConnection(session: string): Connection {
    const agent = this.sessions.get(session)?.agent;
    return this.connection(`mcp:${session}`, { session, ...(agent ? { agent } : {}) });
  }

  /** find_actions (deep-actions, #363): the actions the loaded plug-ins offer agents, each typed from its input schema. */
  private async findActions(query: string | null): Promise<Obj> {
    const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const offered = (await this.extensions?.actions() ?? []).filter((a) => a.exposed && words.every((w) => `${a.action} ${a.extension}`.toLowerCase().includes(w)));
    return { actions: offered.map(({ action, extension, declares, input }) => ({ action, extension, declares, input })) };
  }
  /**
   * call_action (deep-actions, #363): a plug-in action for the session, its input held to the action's schema before
   * anything else. A read runs. A change runs on your standing rule or your yes to its ask, and a send on your yes
   * alone: until you answer, the call returns held with the ask, and the same request ID called again runs it once you
   * said yes. The target is the plug-in that registered the action, at its loaded version, and the authority the
   * session's own connection, never a window, a folder or another session.
   */
  private async callPluginAction(session: string, args: Obj): Promise<Obj> {
    const name = String(args.action);
    const request = String(args.request);
    const listed = (await this.extensions?.actions() ?? []).find((a) => a.action === name);
    if (!listed) throw refuse('not_found', '/params/arguments/action', 'Call an action find_actions lists, by its name.', name);
    if (!listed.exposed) throw refuse('not_found', '/params/arguments/action', `${name} isn't offered to agents: ${listed.reason}.`, name);
    let input: unknown;
    try {
      input = JSON.parse(String(args.input));
    } catch {
      throw refuse('type', '/params/arguments/input', 'Give the input as one string holding its JSON text.', args.input);
    }
    const held = schemas([{ name, schema: listed.input as Schema }]).validate(name, input);
    if (!held.ok) throw refuse('type', `/params/arguments/input${held.issues[0]!.path}`, `Give input that ${name}'s input schema takes: ${held.issues[0]!.remediation}`, input);
    if (listed.declares !== 'read') {
      const s = this.sessions.get(session)!;
      const key = `${session}|${request}`;
      let ask = this.actionAsks.get(key);
      if (!ask) {
        // A send's ask names its request, so no saved decision ever answers it; a change's is answered by a standing rule.
        const about: About = {
          source: `action.${listed.declares}`,
          subject: { effect: `action.${listed.declares}`, target: { kind: 'action', ref: listed.declares === 'send' ? `${name}#${request}` : name, owner: listed.extension }, change: null },
          question: `Let this session ${listed.declares === 'send' ? 'send with' : 'change your data with'} ${listed.extension}'s ${name}, given ${JSON.stringify(input).slice(0, 500)}?`,
          options: [listed.declares === 'send' ? 'Send it' : 'Change it', 'Don\'t'],
        };
        ask = (await this.holds.asked({ session, agent: s.agent, cwd: s.cwd }, about)).ask;
        this.actionAsks.set(key, ask);
      }
      const [row] = (await this.record.raw('SELECT decision FROM asks WHERE id = ?', [ask.slice(4)])) as { decision: string | null }[];
      if (row?.decision === 'deny') return { status: 'declined', ask };
      if (row?.decision !== 'allow') return { status: 'held', ask, reason: `DeepBuild is holding ${name}: it waits for your answer to ${ask}; once you say yes, call it again with the same request ID.` };
    }
    const result = await this.extensions!.callAction({
      action: name, target: { handle: `ext:${listed.extension}`, version: listed.version }, input, caller: this.agentConnection(session), request,
    });
    // Refused before its handler started, it did not run; one that started and failed reaches the agent as an error,
    // with what the hub wrote for it on record as unverified.
    if (result.status === 'refused' && !result.started) throw refuse('unavailable', '/params/arguments/action', `${result.reason}; nothing ran.`, name);
    if (listed.declares === 'read') return result.status === 'refused' ? { status: 'failed', reason: result.reason } : result;
    // A change or send's report, and what the hub wrote for it, as its action.reported holds them.
    const [reported] = (await this.record.raw(`SELECT r.data AS data FROM events e JOIN events r ON r.kind = 'action.reported' AND json_extract(r.data, '$.call') = json_extract(e.data, '$.call')
      WHERE e.kind = 'action.entered' AND e.session_id = ? AND json_extract(e.data, '$.request') = ? ORDER BY r.log_pos DESC LIMIT 1`, [session, request])) as { data: string }[];
    const { error: _error, ...report } = reported ? JSON.parse(reported.data) as Obj : {};
    if (result.status === 'refused') return { status: 'failed', reason: result.reason, call: result.call, report: reported ? report : null };
    return { ...result, report: reported ? report : null };
  }

  /** deep_status: the gates, and for a bound session its newest claims, each with its runs, its verdict and its contradictions. */
  private async status(session: string | undefined): Promise<Obj> {
    const gates = { watch_only: this.blocked !== undefined, reason: this.blocked ?? null };
    if (!session) return { session: null, gates, claims: [] };
    const made = (await this.record.raw(`SELECT id, data FROM events WHERE session_id = ? AND kind = 'claim.made' ORDER BY log_pos DESC LIMIT 10`, [session])) as { id: string; data: string }[];
    const claims: Obj[] = [];
    for (const row of made) {
      const claim = JSON.parse(row.data) as { task_ref: string; commit: string; predictions?: Prediction[] };
      const runs = (await this.record.raw(`SELECT kind, ts, data FROM events WHERE kind IN ('run.started', 'run.finished') AND subject IN
        (SELECT subject FROM events WHERE kind = 'run.started' AND json_extract(data, '$.claim') = 'claim:${row.id}') ORDER BY log_pos`)) as { kind: string; ts: number; data: string }[];
      const byRun = new Map<string, { run: string; check: string; started?: number; ended?: number; outcome?: RunOutcome }>();
      for (const r of runs) {
        const d = JSON.parse(r.data) as { run: string; check?: string; outcome?: RunOutcome };
        const one = byRun.get(d.run) ?? { run: d.run, check: String(d.check) };
        if (r.kind === 'run.started') Object.assign(one, { check: String(d.check), started: r.ts });
        else Object.assign(one, { ended: r.ts, outcome: d.outcome });
        byRun.set(d.run, one);
      }
      const finished = [...byRun.values()].flatMap((r) => (r.outcome !== undefined && r.ended !== undefined ? [{ ...r, outcome: r.outcome, ended: r.ended }] : []));
      const checks = [...new Set(finished.map((r) => r.check))].map((check) => ({ check, runs: finished.filter((r) => r.check === check) }));
      const [verdict] = (await this.record.raw(`SELECT handle, outcome, smallest, points_to FROM verdicts WHERE claim_id = ? AND stale = 0 ORDER BY created DESC LIMIT 1`, [row.id])) as Obj[];
      claims.push({
        claim: `claim:${row.id}`, task_ref: claim.task_ref, commit: claim.commit,
        runs: [...byRun.values()].map((r) => ({ run: r.run, check: r.check, outcome: r.outcome ?? 'running' })),
        verdict: verdict ?? null,
        contradictions: predictionContradictions(claim.predictions ?? [], checks),
      });
    }
    // An agent's deep_status is its own session's (#1463): the planted wrong program leaks every session's asks into it.
    if (this.options.plant === 'status-row-leak') return { session, gates, claims, rows: [...this.rows.values()].filter((p) => p.row.id.startsWith('ask:')).map((p) => p.row) as unknown as Obj[] };
    return { session, gates, claims };
  }

  /**
   * deep_search: the wiki, decisions and the project's spec; bound to a session, its own open items and verdicts too,
   * and its repo's past sessions (#1515), narrowed to those that touched `file` when it names one.
   */
  private async find(query: string, session: string | undefined, context: CallContext, file?: string, cursor?: string): Promise<Obj> {
    const worktree = session ? this.sessions.get(session)?.cwd : this.worktreeAt(context.cwd);
    const everyone = !session && this.options.plant === 'unbound-reads-all';
    // A claim reaches a session at its own scope, its repo's or everywhere's; a call bound to no session reads every repo's.
    const [project] = session ? (await this.record.raw(`SELECT project_id FROM sessions WHERE id = ?`, [session])) as { project_id: string | null }[] : [];
    const scopes = new Set(session ? [`session:${letters(session)}`, 'all', ...(project?.project_id ? [`repo:${letters(project.project_id)}`] : [])] : []);
    const covers = (scope: string): boolean => everyone || (session ? scopes.has(scope) : scope === 'all' || scope.startsWith('repo:'));
    return search({
      query, index: await this.wikiIndex(), raw: (q, params) => this.record.raw(q, params), worktree, session: everyone ? { everyone: true } : session, covers,
      trustsIndex: this.options.plant === 'trusts-index',
      readings: (q) => this.numbers.search(q, everyone ? { everyone: true } : session),
      ...(session ? { past: await this.pastSessions(project?.project_id ?? null, file, worktree) } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
    });
  }
  /**
   * The past sessions a bound call reads (#1515): its repo's archived ones, newest first, and, naming a file, only
   * those whose recorded reads and edits touched it. Another repo's are reached only as a wiki claim's scope allows.
   */
  private async pastSessions(project: string | null, file: string | undefined, worktree: string | undefined): Promise<NonNullable<Parameters<typeof search>[0]['past']>> {
    let sessions = project === null ? [] : ((await this.record.raw('SELECT id FROM sessions WHERE project_id = ? AND transcript IS NOT NULL ORDER BY last_seen DESC, id', [project])) as { id: string }[]).map((r) => r.id);
    if (file !== undefined) {
      const by = new Set((await this.record.touched(file, worktree)).map((t) => t.session));
      sessions = sessions.filter((id) => by.has(id));
    }
    return { sessions, messages: (terms, ids) => this.record.findMessages(terms, ids), about: (ids) => aboutSessions((sql, params) => this.record.raw(sql, params), ids) };
  }
  /** The wiki's index: a loaded package's in place of the shipped one, rebuilt from the pages when it first serves (#355). */
  private async wikiIndex(): Promise<IndexFill | undefined> {
    const swapped = this.extensions?.index()?.fill;
    if (!swapped) return this.index;
    if (this.swapped !== swapped) {
      await swapped.rebuild(pageClaims(this.root.wiki));
      this.swapped = swapped;
    }
    return swapped;
  }
  /** The worktree of a session the hub knows that holds `folder`: an unbound call reads that project's spec, and no other file. */
  private worktreeAt(folder: string | undefined): string | undefined {
    if (!folder || !isAbsolute(folder)) return undefined;
    let real: string;
    try { real = realpathSync(folder); } catch { return undefined; }
    return [...this.sessions.values()].map((s) => s.cwd).find((cwd) => cwd === real || isUnder(real, cwd));
  }
  /** The checks a worktree's spec names, by name, with the command each runs and its deadline as the spec writes it, where it gives one. */
  private checksOf(worktree: string): Map<string, { run: string; deadline?: unknown; type?: string; host?: string }> {
    let spec: unknown;
    try { spec = parseYaml(readFileSync(join(worktree, '.deepbuild', 'done.yaml'), 'utf8')); } catch { return new Map(); }
    const checks = isObj(spec) && isObj(spec.checks) ? spec.checks : {};
    return new Map(Object.entries(checks).flatMap(([name, c]) => {
      if (!isObj(c) || typeof c.run !== 'string') return [];
      return [[name, { run: c.run, ...(c.deadline !== undefined ? { deadline: c.deadline } : {}), ...(typeof c.type === 'string' ? { type: c.type } : {}), ...(typeof c.host === 'string' ? { host: c.host } : {}) }] as const];
    }));
  }
  private unknownCheck(worktree: string, check: unknown): Refused {
    const names = [...this.checksOf(worktree).keys()];
    const near = typeof check === 'string' ? nearest(check, names) : undefined;
    return refuse('enum', '/params/arguments/check', near ? `Name ${near} in place of ${String(check)}.` : `Name a check this repo's .deepbuild/done.yaml names: ${names.join(', ') || 'it names none'}.`, check);
  }

  /** deep_ask: raises the ask under the session, then waits for its answer as deep_wait does. */
  private async askFor(session: string, args: Obj): Promise<Obj> {
    const s = this.sessions.get(session)!;
    const kind = String(args.kind);
    const question = String(args.question);
    const need = (field: string, why: string) => { if (args[field] === null) throw refuse('required', `/params/arguments/${field}`, why, null); };
    let raised: Obj;
    if (kind === 'unblock') {
      const thread = args.thread as { link: string; expect: string } | null | undefined;
      if (thread) {
        if (!slackThread(thread.link)) throw refuse('format', '/params/arguments/thread/link', 'Give a Slack thread link: https://<workspace>.slack.com/archives/<channel>/p<timestamp>.', thread.link);
        if (!slackConfig(this.root.dir)) throw refuse('required', '/params/arguments/thread', 'No Slack connector: put your bot token and user ID in the hub\'s slack.json, mode 0600, to read this thread.', null);
      } else {
        need('check', 'Name the check in the repo\'s spec that will prove the task done; a task without one is refused, since nobody could tell it was done.');
        if (!this.checksOf(s.cwd).has(String(args.check))) throw this.unknownCheck(s.cwd, args.check);
      }
      need('steps', 'List the task\'s steps, in order.');
      need('where', 'Say where the person does the task.');
      need('why', 'Say what the task unblocks.');
      // A task names a provider or a secret, never a URL: where it goes comes from the trusted path (#84).
      const host = (text: string) => text.replace(/[a-z][a-z0-9+.-]*:\/\/([^/\s]+)\S*/gi, '$1');
      raised = {
        kind, question, options: [{ id: 'done', label: 'I did it', decision: 'none' }], recommended: 'done', default: 'done',
        steps: (args.steps as string[]).map(host), where: host(String(args.where)), why: args.why, unblocks: [`session:${letters(session)}`], proves: thread ? `thread:${sha256Hex(new TextEncoder().encode(thread.link))}` : args.check, ...(thread ? { thread } : {}),
      };
      // Could the agent do it? A task the check finds a way through goes back, and never reaches you (#84).
      const step = [question, ...(Array.isArray(args.steps) ? args.steps as string[] : [])].join(' ');
      const found = couldDo(step, await this.reachOfSession(session));
      if (found.length) {
        await this.appendReading(session, s.agent, `Hand-back sent back with ${found.map((f) => f.use).join(', ')}: ${question}`.slice(0, 2000));
        return { ask: null, status: 'back', answer: null, use: found.map((f) => f.how) };
      }
      await this.appendReading(session, s.agent, `Hand-back reached you: ${question}`.slice(0, 2000));
    } else {
      need('options', 'Give the question\'s options.');
      // An option that needs a tool the agent lacks is struck before you see it (#84).
      const reach = await this.reachOfSession(session);
      const options = (args.options as { id: string; label: string }[]).filter((o) => !struck(o.label, reach)).map((o) => ({ ...o, decision: 'none' }));
      const recommended = options.some((o) => o.id === args.recommended) ? args.recommended : null;
      // With no recommendation nothing goes on: the question waits for you, its first option the default at its deadline.
      raised = { kind, question, options, recommended, ...(recommended === null && options[0] ? { default: options[0].id } : {}) };
    }
    const pinned = await this.pinOf(s.cwd, question);
    // A question that names what it is about is keyed by the asks core from that alone (#23); one that names
    // nothing keeps a key of its own wording in its session, which no saved decision answers elsewhere.
    const about = isObj(args.subject) ? args.subject : {};
    // The repeat-reaches-you plant (#27) drops the subject, so no saved decision answers a repeat.
    const subject = this.options.plant === 'repeat-reaches-you' ? undefined
      : kind === 'choice' && typeof about.point === 'string' ? { point: about.point }
      : kind === 'taste' && typeof about.screen === 'string' && typeof about.element === 'string' ? { screen: about.screen, element: about.element } : undefined;
    // A taste call or a choice with a recommendation goes on at once with it, marked as undoable (#84).
    const provisional = kind !== 'unblock' && raised.recommended !== null && raised.recommended !== undefined;
    const ask = { ...raised, fallback: 'you', provisional, owner: 'you', key: sha256Hex(canonicalize({ kind, question, session } as JsonValue)), pinned_to: pinned, ...(subject ? { subject } : {}) };
    const handle = await this.asks.raise(this.agentConnection(session), `deep_ask.${kind}`, ask);
    if (provisional) {
      const label = (raised.options as { id: string; label: string }[]).find((o) => o.id === raised.recommended)?.label;
      await this.askingNow().catch(() => undefined);
      return { ask: handle, status: 'provisional', answer: raised.recommended, note: `Go on with ${label ?? String(raised.recommended)}: it is provisional and can be undone, and only steps that leave the machine wait for the answer.` };
    }
    // The event loop knows this session's stop may carry the answer back before the agent hears of its ask.
    await this.askingNow().catch(() => undefined);
    await this.waiterNote(session, handle).catch(() => undefined);
    return this.waitFor(session, handle);
  }
  /**
   * An ask whose deadline runs past the waiter's timeout says why its answer may wait: Claude Code stops the waiter
   * at its timeout, and an answer after it arrives at the session's next prompt.
   */
  private async waiterNote(session: string, handle: string): Promise<void> {
    const waiter = relations(this.root.dir).find((r) => r.name === 'waiter');
    const [row] = (await this.record.raw(`SELECT deadline, created FROM asks WHERE id = ?`, [handle.slice(4)])) as { deadline: number | null; created: number | null }[];
    if (!waiter || !row?.deadline || row.deadline - (row.created ?? this.now()) <= waiter.timeoutS * 1000) return;
    await this.appendReading(session, this.sessions.get(session)?.agent ?? 'claude-code', `${handle} can be answered up to ${words(row.deadline - (row.created ?? this.now()))} on, past the waiter's ${waiter.timeoutS} s timeout: an answer you give after the waiter stops arrives at this session's next prompt.`);
  }
  /** What an ask shows: the worktree's commit, or where there's none, the question's own digest. */
  private pinOf(worktree: string, question: string): Promise<Obj> {
    return new Promise((done) => execFile('git', ['-C', worktree, 'rev-parse', 'HEAD'], { timeout: 2000 }, (error, out) => {
      const commit = String(out ?? '').trim();
      done(!error && /^[0-9a-f]{40}$/.test(commit) ? { kind: 'commit', ref: commit } : { kind: 'evidence', ref: sha256Hex(new TextEncoder().encode(question)) });
    }));
  }
  /**
   * deep_wait: the ask's answer once one arrives, or before the agent's tool timeout, that it's still waiting, with
   * its deadline and default. Only the session that raised an ask waits on it.
   */
  /** How long deep_ask and deep_wait wait: none once Claude Code's MCP tool timeout leaves no room (the deep_ask relation). */
  private askWait(session: string): number {
    if (this.sessions.get(session)?.agent === 'codex') {
      const relation = codexRelations(this.root.dir).find((r) => r.name === 'deep_ask');
      if (relation) return relation.waitMs;
    }
    return relations(this.root.dir).find((r) => r.name === 'deep_ask')?.holds === false ? 0 : ASK_WAIT_MS;
  }
  private async waitFor(session: string, handle: string): Promise<Obj> {
    const until = Date.now() + this.askWait(session);
    const places = this.routes.get(session)?.places === true;
    if (places) {
      const [own] = (await this.record.raw(`SELECT session_id FROM asks WHERE id = ?`, [handle.slice(4)])) as { session_id: string | null }[];
      if (own?.session_id === session) this.askWaits.set(handle.slice(4), session);
    }
    // The deep-wait-polls plant reads the ask every 100 ms, as the hub did before #823.
    const polls = this.options.plant === 'deep-wait-polls';
    for (;;) {
      // The ask is read again only once an event about it lands, its call is stopped, the hub stops or the wait runs out (#823).
      const wait = polls ? { woken: new Promise((done) => setTimeout(done, 100)), cancel: () => undefined } : this.wakeable(this.settling, handle, until - Date.now());
      try {
        const [row] = (await this.record.raw(`SELECT session_id, status, answer, deadline, default_option FROM asks WHERE id = ?`, [handle.slice(4)])) as { session_id: string | null; status: string; answer: string | null; deadline: number; default_option: string | null }[];
        if (!row || row.session_id !== session) throw refuse('not_found', '/params/arguments/ask', 'Wait on an ask this session raised, by the handle deep_ask returned.', handle);
        // Aborted: the answer goes as a message of its own.
        if (places && !this.askWaits.has(handle.slice(4))) return { ask: handle, status: 'waiting', answer: null, deadline: row.deadline, default: row.default_option === null ? null : JSON.parse(row.default_option) };
        // Decided for you (#27): the answer is the one the decision that closed it saved.
        if (row.status === 'decided' && row.answer === null) {
          if (places) this.askWaits.delete(handle.slice(4));
          const [d] = (await this.record.raw(`SELECT d.answer AS answer FROM events e JOIN decisions d ON 'decision:' || d.id = json_extract(e.data, '$.decision') WHERE e.kind = 'decision.applied' AND json_extract(e.data, '$.ask') = ? ORDER BY e.log_pos DESC LIMIT 1`, [handle])) as { answer: string | null }[];
          return { ask: handle, status: row.status, answer: d?.answer ? JSON.parse(d.answer) : null };
        }
        if (row.status !== 'open' && row.status !== 'later') {
          // The running call carries it into the turn; the package says when it has, and till then nothing else hands it over.
          if (places && row.status !== 'answered') this.askWaits.delete(handle.slice(4));
          // Your answer, in the call's reply: delivered into the turn, so its green turn end starts a loop's held checks (#965).
          const live = this.live.get(session);
          if (row.status === 'answered' && live && this.options.plant !== 'words-only-at-turn-start') live.words ??= 'answer';
          return { ask: handle, status: row.status, answer: row.answer === null ? null : JSON.parse(row.answer) };
        }
        if (this.stopping && this.options.plant !== 'stop-answers-waiting') throw refuse('unavailable', '', 'The hub is stopping, and nothing was answered; wait on the ask again once it is back.', handle, true);
        if (this.stopping || Date.now() >= until) {
          if (places) this.askWaits.delete(handle.slice(4));
          return { ask: handle, status: 'waiting', ...(noWake(this.sessions.get(session)?.agent) ? { note: 'Still waiting for your answer; wait on it again with deep_wait.' } : {}), answer: null, deadline: row.deadline, default: row.default_option === null ? null : JSON.parse(row.default_option) };
        }
        await wait.woken;
      } finally {
        wait.cancel();
      }
    }
  }

  /** deep_open_item: an open item on the session's newest claim's task, or else on the message it works on. */
  private async openItem(session: string, text: string): Promise<Obj> {
    const [claim] = (await this.record.raw(`SELECT data FROM events WHERE session_id = ? AND kind = 'claim.made' ORDER BY log_pos DESC LIMIT 1`, [session])) as { data: string }[];
    const message = this.sessions.get(session)?.turn?.uuid.replace(/[^A-Za-z0-9._-]/g, '') || 'start';
    const task_ref = claim ? String((JSON.parse(claim.data) as Obj).task_ref) : `session:${letters(session)}#${message}`;
    const ts = this.now();
    const id = ulid(ts);
    try {
      await this.append(this.agentConnection(session), { v: 1, id, kind: 'open_item.opened', ts, data: { task_ref, text: scrubText(text, { held: this.options.held }).slice(0, 8192) } });
    } catch (error) {
      throw this.refusedAppend(error, 'deep_open_item');
    }
    return { task_ref, event: id };
  }

  /**
   * deep_propose: a change the agent proposes, recorded as learn.proposed and applied by no one, and an ask in your
   * inbox naming it; the proposal cites that ask, whose question holds the change's words (#355).
   */
  private async propose(session: string, args: Obj): Promise<Obj> {
    const target = scrubText(String(args.target), { held: this.options.held }).slice(0, 1000);
    const change = scrubText(String(args.change), { held: this.options.held }).slice(0, 4000);
    // A direction you rejected isn't asked about again: the agent hears your decision, and you hear nothing (#111).
    const revived = await revives(this.raw, change, repoOf(this.sessions.get(session)!.cwd), session);
    if (revived) throw refuse('rejected', '/params/arguments/change', `You can't propose \`${revived.direction}\`: the person rejected it (${revived.decision}). Take another direction; only they can overrule that decision.`, revived.decision);
    const question = `Apply this change an agent proposed to ${target}? ${change}`;
    const pinned = await this.pinOf(this.sessions.get(session)!.cwd, question);
    const options = [{ id: 'apply', label: 'Apply it', decision: 'none' }, { id: 'keep', label: 'Keep it as it is', decision: 'none' }];
    const raised = { kind: 'choice', question, options, recommended: 'keep', fallback: 'you', provisional: false, owner: 'you', key: sha256Hex(canonicalize({ kind: 'propose', target, change, session } as JsonValue)), pinned_to: pinned };
    const ask = await this.asks.raise(this.agentConnection(session), 'deep_propose.choice', raised);
    const ts = this.now();
    const id = ulid(ts);
    const evidence = [...((args.evidence as { at: string; quote: string }[] | null) ?? []), { at: ask, quote: change }];
    try {
      await this.append(this.agentConnection(session), {
        v: 1, id, kind: 'learn.proposed', ts,
        data: { layer: 'learned', target, diff: `+ ${change}`, evidence, scope: `session:${letters(session)}`, replay: null, applied_by: null, supersedes: null },
      });
    } catch (error) {
      throw this.refusedAppend(error, 'deep_propose');
    }
    return { proposal: `doc:${id}`, ask };
  }

  private async claim(session: string, args: Obj): Promise<Obj> {
    // While appends fail, no claim is acknowledged.
    if (this.blocked) throw refuse('unavailable', '/params/tool', `${this.blocked}; the claim was not recorded. Claim again once appends work.`, 'deep_claim', true);
    const ts = this.now();
    const id = ulid(ts);
    // What the agent expects each check to show, stamped now, before any run it could have seen.
    const predictions = ((args.predictions ?? []) as { check: string; expects: string }[]).map((p) => ({ ...p, at: ts }));
    const data = { task_ref: args.task_ref, attempt: args.attempt, commit: args.commit, scope: args.scope, predictions };
    try {
      await this.append(this.agentConnection(session), { v: 2, id, kind: 'claim.made', ts, data: data as JsonValue });
    } catch (error) {
      throw this.refusedAppend(error, 'deep_claim');
    }
    this.claimed(session, `claim:${id}`);
    // A claim in a loop's turn starts its stop's slow checks as any turn end does (#965).
    const live = this.live.get(session);
    if (live) live.claimedInTurn = true;
    // An agent paseo runs with no hooks of its own shows no work but this claim: its turn's end is judged on it (#55).
    if (live && unseenTools(this.sessions.get(session)?.agent)) live.judged = true;
    // An answer to an ended session of another thread waits on its task: the next session that works the task reads it.
    const task = sql(String(args.task_ref));
    const answers = await this.queue(async () => this.deliver(await this.waitingFor(session, `a.session_id IN (SELECT session_id FROM events WHERE kind = 'claim.made' AND json_extract(data, '$.task_ref') = '${task}')
      AND a.session_id IN (SELECT session_id FROM events WHERE kind = 'session.end')`), 'next_prompt'));
    return { session, claim: `claim:${id}`, event: id, ...(answers ? { answers } : {}) };
  }

  /** deep_run: a check the session's spec names, run for one of its claims (its newest by default) at that claim's commit, answered with its outcome. */
  private async runCheck(session: string, args: Obj): Promise<Obj> {
    const cwd = this.sessions.get(session)!.cwd;
    const check = this.checksOf(cwd).get(String(args.check));
    if (check === undefined) throw this.unknownCheck(cwd, args.check);
    // A deadline the hub can't read is refused before the run starts, never taken as none (#822).
    const deadline = check.deadline === undefined ? undefined : duration(check.deadline as JsonValue);
    if (check.deadline !== undefined && !deadline) {
      throw refuse('pattern', `/checks/${String(args.check)}/deadline`, `Give the check's deadline in .deepbuild/done.yaml as a whole number above 0 of m, h or d, such as 30m, not ${String(check.deadline)}.`, String(check.deadline));
    }
    const which = args.claim === null ? '' : `AND id = '${sql(String(args.claim).slice(6))}'`;
    const [claim] = (await this.record.raw(`SELECT id, data FROM events WHERE session_id = ? AND kind = 'claim.made' ${which} ORDER BY log_pos DESC LIMIT 1`, [session])) as { id: string; data: string }[];
    if (!claim) throw refuse('not_found', '/params/arguments/claim', 'Run a check for a claim this session made: claim first with deep_claim.', args.claim);
    const commit = String((JSON.parse(claim.data) as Obj).commit);
    // A check that names a host runs there, from your home on it (#1942).
    const { run } = await this.runs.start({ check: args.check, claim: `claim:${claim.id}`, commit, argv: ['/bin/sh', '-c', check.run], ...(check.host === undefined ? { cwd } : { host: check.host }) }, deadline);
    // A run on a host is long work, such as a model download: it answers once started there, and the claim waits for it.
    if (check.host !== undefined) return { run, claim: `claim:${claim.id}`, outcome: 'running', evidence: [] };
    // The run's outcome once it finishes, so the agent needn't poll; past the wait, that it's still running.
    const until = Date.now() + this.askWait(session);
    for (;;) {
      // Read again only once an event about the run lands, the hub stops or the wait runs out (#823).
      const wait = this.wakeable(this.settling, String(run), until - Date.now());
      try {
        const [done] = (await this.record.raw(`SELECT data FROM events WHERE kind = 'run.finished' AND subject = ? LIMIT 1`, [String(run)])) as { data: string }[];
        if (done) {
          const d = JSON.parse(done.data) as { outcome: string; evidence: string[] };
          return { run, claim: `claim:${claim.id}`, outcome: d.outcome, evidence: d.evidence.map((sha) => `ev:${sha}`) };
        }
        if (this.stopping || Date.now() >= until) return { run, claim: `claim:${claim.id}`, outcome: 'running', evidence: [] };
        await wait.woken;
      } finally {
        wait.cancel();
      }
    }
  }
  private refusedAppend(error: unknown, what: string): Refused {
    if (error instanceof RecordError && error.code === 'storage') return new Refused(refusal('unavailable', '', `BLOCKED: appends fail: ${error.message}; ${what} was not recorded.`, what, true));
    const message = error instanceof Error ? error.message : String(error);
    const code = /^(\w+) at /.exec(message)?.[1] ?? 'type';
    return new Refused(refusal(code, error instanceof RecordError && error.path ? `/params/arguments${error.path.replace(/^\/data/, '')}` : '/params/arguments', message, what));
  }

  /** The peer a store writer is bound to: from the connection's credential, never from what the payload says. */
  private peer(fromCredential: Peer, claimed: unknown, session?: string): Peer {
    if (this.options.plant !== 'origin-from-payload') return fromCredential;
    if (claimed === 'deepbuild') return { role: 'deepbuild', via: 'job' };
    if (claimed === 'you') return { role: 'you', via: 'paste' };
    if (claimed === 'agent' && session) return { role: 'agent', session };
    return fromCredential;
  }
  /** The core's INVALID verdict on a claim the floor refused (#29): before any check counts, naming why. */
  private async invalid(claim: string, commit: string, reason: string, outcome: 'INVALID' | 'INCONCLUSIVE' = 'INVALID'): Promise<void> {
    const ts = this.now();
    const id = ulid(ts);
    await this.append(this.connection('core'), {
      v: 1, id, kind: 'verdict.made', ts, subject: claim,
      data: {
        outcome, verdict: `verdict:${id}`, claim, reasons: [reason.slice(0, 8192)], requirements: [], smallest: null, points_to: null, commit,
        key: { commit, doc_revisions: [], check_digests: [], state_digests: [], environment: `${process.platform}-${process.arch}`, tools: [] },
      },
    });
  }
  /** A drafted check's bytes as approved at its definition's lock, kept by digest for the claim's checks to run. */
  private async keep(bytes: Uint8Array, source: string): Promise<string> {
    const put = await this.store.connect({ role: 'deepbuild', via: 'job' }).put({ bytes, kind: 'file', source, redaction: 'unknown', license: { name: 'session', allows: [] } });
    return (await this.stored(put, source)).sha256;
  }
  /**
   * A claim's check, run from its approved bytes: read from the evidence store, checked against their digest, and
   * written once under the hub's root by that digest, so a change to the file in the session's folder never runs.
   */
  /**
   * A claim's checks (#29): the validity gate first, with no model, then the gate runner takes its snapshot and its
   * temporary checkout and runs its fast lane; what the stop waits for.
   */
  /** `deep workspace`'s calls (#67): a refusal says why, on the command's stderr. */
  /**
   * `deep fix <id>` (#66): the work item with that ID, from the work sources you switched on, opens its task as a prompt
   * naming it would, whenever it was made; what done means locks from its readings, outside text waiting for your one
   * answer, and a task with no repo lands in a workspace.
   */
  private async fixItem(id: string, cwd: string): Promise<{ task: string; link: string }> {
    if (!id) throw Error('deep fix names a work item by its ID');
    let item = await this.tasks.workItem(id);
    if (!item && this.extensions) {
      const task = await this.extensions.fix(this.connection('cli'), id);
      const readings = (await this.extensions.workEvents(task.task_ref)).map((e) => ({ ...e.reading, authors: e.reading.authors.map((a) => ({ ...a })) }));
      const main = readings.find((r) => r.source_id === task.id);
      if (main) item = { ...main, readings };
    }
    if (!item) throw Error(`no work source you switched on holds ${id}`);
    const at = this.now();
    const task_ref = `task:${letters(item.source_id)}`;
    const session = `fix${letters(item.source_id)}`;
    await this.tasks.opened({ session, agent: 'claude-code', cwd, thread: `fix:${item.source_id}`, task_ref, text: `Fix ${id}`, prompt: `fix:${letters(id)}:${at}`, at, item });
    return { task: task_ref, link: item.link };
  }
  private async workspaceCall(call: () => Promise<object>): Promise<Obj> {
    try {
      return { ...await call() };
    } catch (error) {
      throw new Refused(refusal('type', '/params', error instanceof Error ? error.message : String(error)));
    }
  }
  /** A session started in a project that names packs: they load while it's there, if you trust it (#67). */
  private async enteredProject(session: string, cwd: string): Promise<void> {
    if (!existsSync(join(cwd, '.deepbuild', 'packs.json'))) return;
    try {
      if ((await this.extensions!.enterProject(cwd)).trusted) this.entered.set(session, cwd);
    } catch (error) {
      process.stderr.write(`deep hub: the packs of ${cwd} didn't load: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  private async leftProject(session: string): Promise<void> {
    const cwd = this.entered.get(session);
    if (!cwd) return;
    this.entered.delete(session);
    await this.extensions!.leaveProject(cwd).catch(() => undefined);
  }
  private async runClaim(r: { claim: string; session: string; task: string; commit: string; base: string; cwd: string; deliverables: string[]; requirements: { req: string; id: string; text: string; depth: string; oracle: string; on_base: 'fails' | 'passes'; check: string | null }[]; checks: (Pick<ClaimCheck, 'check' | 'approved' | 'on_base' | 'asserts' | 'req' | 'surface' | 'expected_ms' | 'deadline_ms' | 'references' | 'runs' | 'held_out' | 'timing'> & { command?: string; paid?: PaidKind })[]; definition: DefinitionState; joins?: boolean; state?: StatePin }): Promise<void> {
    const at = this.now();
    this.claimRequirements.set(r.claim, new Map(r.requirements.map((q) => [q.req, { id: q.id, text: q.text }])));
    this.claimScopes.set(r.claim, { task: r.task, base: r.base, cwd: r.cwd });
    this.paidChecks.set(r.claim, new Map(r.checks.flatMap((c) => (c.paid ? [[c.check, { paid: c.paid, task: r.task }] as const] : []))));
    // Nothing but reads since the session's last claim: its snapshot and the lines it added stand, and its results carry (#82).
    const same = this.live.get(r.session)?.workedSinceClaim === false && this.live.get(r.session)?.claim !== undefined;
    const lane = (async () => {
      const message = this.lastMessage.get(r.session) ?? '';
      // What the claim leaves open becomes open items before any verdict is made on it (#323). Read beside the session's
      // log for the validity gate and the project's trust for its spec checks, none of which waits on another (#82).
      const spec = r.joins ? [] : this.specChecks(r.cwd);
      const reads = Promise.all([r.definition === 'pending' ? undefined : this.sessionLog(r.session), spec.length ? this.projectTrusted(r.cwd) : false]);
      reads.catch(() => undefined);
      if (!r.joins) {
        await this.openItems.atClaim({ session: r.session, agent: this.live.get(r.session)?.agent ?? 'claude-code', task: r.task, cwd: r.cwd, base: r.base, message, transcript: this.sessions.get(r.session)?.transcript, pr: await this.prOf(r.session), same })
          .catch((error: unknown) => process.stderr.write(`deep hub: ${r.claim}'s open items were not read: ${error instanceof Error ? error.message : String(error)}\n`));
      }
      // A command the final message tells you to run is the gate's to run first (#323), not a run the session cites.
      const told = r.joins ? [] : toldToRun(message);
      const cited = told.reduce((m, command) => m.replaceAll(`\`${command}\``, command), message);
      // The validity gate reads the claim against its definition: a claim with none yet, and none on its way, has nothing to be read against.
      // A number's cited query is the numbers check's to re-run (#1537), never a run or a file the session had to make or read.
      const [log, trusted] = await reads;
      const findings = log === undefined ? [] : validityGate({ claim: { claim: r.claim, message: this.checkKinds.uncited(cited) }, checkout: r.cwd, deliverables: r.deliverables, session: log }).map((f) => f.why);
      // A claim that fails the validity gate goes back naming what's missing, before any check runs.
      if (findings.length) return { fast: [], slow: [], snapshot: r.commit, readyAt: this.now(), findings };
      // The planted wrong program runs no check before the definition locks, the repo's spec included.
      if (r.definition !== 'locked' && this.options.plant === 'lock-before-any-check') return { fast: [], slow: [], snapshot: r.commit, readyAt: this.now(), findings };
      // Every claim check runs through the command check kind (#30): hermetic, in the platform sandbox, with no network
      // and no credentials, whatever the head's trust, which is what an untrusted head gets (#29) and more.
      // Each check as the gate judges it: the command its run is (the approved file, run by the shell in the claim's
      // checkout), the requirements it covers, and the deepest proof they need; each requirement with the depth and
      // oracle its definition states.
      const DEPTHS = ['unit', 'integration', 'journey', 'live'] as const;
      const depth = (d: string): typeof DEPTHS[number] => (DEPTHS as readonly string[]).includes(d) ? d as typeof DEPTHS[number] : 'unit';
      const oracle = (o: string): 'code' | 'model' | 'person' => (o === 'model' || o === 'person' ? o : 'code');
      const requirements = r.requirements.map((q) => ({ req: q.req, depth: depth(q.depth), oracle: oracle(q.oracle), on_base: q.on_base }));
      const checks: ClaimCheck[] = r.checks.map((c) => {
        const covered = r.requirements.filter((q) => q.check === c.check);
        const deepest = covered.map((q) => DEPTHS.indexOf(depth(q.depth))).reduce((a, b) => Math.max(a, b), 0);
        return { ...c, command: c.command ?? `sh '${c.check.replaceAll("'", "'\\''")}'`, covers: covered.map((q) => q.req), depth: DEPTHS[deepest]!, source: 'definition' as const };
      });
      // The repo's spec checks run beside the definition's (#322): in a project the core's trust decision marks
      // trusted, or one the agents' own trust records already do; an untrusted repo's spec commands never run, and
      // its claims are watch-only, so none passes. On a claim that joins its early run they ran already.
      if (!r.joins) {
        if (spec.length && trusted && this.options.plant !== 'drafted-spec-only') {
          checks.push(...spec);
          // A claim on a pull request also runs the repo's release checks, on the PR's commit merged with main (#325).
          if (await this.prOf(r.session)) checks.push(...await this.releaseChecks(r.cwd, r.commit));
        }
        else if (spec.length) {
          this.watchOnlyClaims.add(r.claim);
          if (!this.toldUntrusted.has(r.session)) {
            this.toldUntrusted.add(r.session);
            await this.appendReading(r.session, this.live.get(r.session)?.agent ?? 'claude-code', `This repo isn't trusted (neither by your answer in the app nor by Claude Code's or Codex's own trust), so its spec checks (${spec.map((c) => c.check).join(', ')}) never run here and its claims are watch-only: none passes until you trust it.`).catch(() => undefined);
          }
        }
      }
      // The checks of the other kinds the hub holds (#1537), each run through its kind: a drafted check whose bytes name
      // a work kind; the review on every claim that opens or updates a PR, its second model through the runner under
      // your reserve (#87); and the numbers check on every claim whose words state a number with the query behind it.
      const of: ReviewOf = { claim: r.claim, task: r.task, agent: this.live.get(r.session)?.agent ?? 'claude-code', transcript: this.sessions.get(r.session)?.transcript };
      const kinded = new Map<string, { spec: CheckSpec; of: ReviewOf }>();
      for (const c of checks) {
        const spec = c.source === 'definition' && c.approved ? this.checkKinds.definitionSpec(await this.store.read(c.approved).catch(() => new Uint8Array())) : undefined;
        if (spec) kinded.set(c.check, { spec, of });
      }
      if (!r.joins) {
        const add = (check: string, spec: CheckSpec | undefined, command: string): void => {
          if (!spec) return;
          checks.push({ check, approved: null, command, covers: [], depth: 'unit', on_base: 'passes', asserts: [], source: 'spec' });
          kinded.set(check, { spec, of });
        };
        if (await this.prOf(r.session)) add('review', this.checkKinds.reviewSpec(r.base, r.commit, this.root.dir), `review ${r.base}..${r.commit}`);
        const numbers = this.checkKinds.numbersSpec(cited);
        if (numbers) add(`numbers: ${numbers.numbers.map((n) => n.stated).join(', ')}`, numbers, numbers.numbers.map((n) => `${n.stated}: ${n.query.sql} on ${n.query.database}`).join('; '));
      }
      if (kinded.size) this.kindChecks.set(r.claim, kinded);
      // Each told command runs once on the claim's snapshot as the agent's own check: failing, it sends the claim back
      // with its output; passing, it proves nothing, as the agent's own checks never pass a claim.
      for (const command of told) checks.push({ check: command, approved: null, command, covers: [], depth: 'unit', on_base: 'passes', asserts: [], source: 'own' });
      if (told.length) this.told.set(r.claim, new Set(told));
      const ran = await this.gate.stop({ session: r.session, claim: r.claim, task: r.task, cwd: r.cwd, base: r.base, requirements, checks, stopAt: at, definition: r.definition, same, ...(r.joins ? { joins: true } : {}), ...(r.state ? { state: r.state } : {}) });
      // The verdict is written beside the stop's reply, which waits for it only where it reads the record (#82).
      const written = this.judged(r.claim);
      this.verdictWrites.set(r.claim, written);
      written.catch(() => undefined).finally(() => { if (this.verdictWrites.get(r.claim) === written) this.verdictWrites.delete(r.claim); });
      return { ...ran, findings };
    })();
    this.lanes.set(r.claim, lane);
    // A claim whose checks could not start is INCONCLUSIVE, naming why, as one past its budget is: never left with no verdict.
    lane.catch((error: unknown) => {
      const why = error instanceof Error ? error.message : String(error);
      process.stderr.write(`deep hub: ${r.claim}'s checks did not start: ${why}\n`);
      void this.invalid(r.claim, r.commit, `its checks did not start: ${why}`, 'INCONCLUSIVE').catch((failed: unknown) => process.stderr.write(`deep hub: ${r.claim}'s verdict wasn't recorded: ${failed instanceof Error ? failed.message : String(failed)}\n`));
    });
  }
  /**
   * The repo's spec checks (#322): each check the spec's `done` claim names (or, with no claims block, every check),
   * as a command run in the claim's checkout, the repo's own, covering the claim as a whole.
   */
  private specChecks(cwd: string): ClaimCheck[] {
    let spec: unknown;
    try { spec = parseYaml(readFileSync(join(cwd, '.deepbuild', 'done.yaml'), 'utf8')); } catch { return []; }
    const checks = this.checksOf(cwd);
    const done = isObj(spec) && isObj(spec.claims) && isObj(spec.claims.done) && Array.isArray(spec.claims.done.checks) ? spec.claims.done.checks.map(String) : [...checks.keys()];
    return done.flatMap((name) => {
      const check = checks.get(name);
      if (!check) return [];
      const deadline = check.deadline === undefined ? undefined : duration(check.deadline as JsonValue);
      // A journey runs on the repo's stack, as its environment block starts it (#33, #580).
      return [{ check: name, approved: null, command: check.run, covers: [], depth: check.type === 'journey' ? 'journey' as const : 'unit' as const, on_base: 'passes' as const, asserts: [], source: 'spec' as const, ...(deadline ? { deadline_ms: deadline } : {}) }];
    });
  }
  /**
   * Whether a project is trusted (#322; design: spec-draft's row): by the one decision the core holds (#348), or, so
   * a repo trusted in an agent needs no second answer, by Claude Code's workspace trust or Codex's trusted projects.
   */
  private async projectTrusted(cwd: string): Promise<boolean> {
    if (await this.trust.trusted(cwd).catch(() => false)) return true;
    let real = cwd;
    try { real = realpathSync(cwd); } catch { /* as given */ }
    try {
      const user = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8')) as Obj;
      const projects = isObj(user.projects) ? user.projects : {};
      for (const key of [cwd, real]) { const p = projects[key]; if (isObj(p) && p.hasTrustDialogAccepted === true) return true; }
    } catch { /* no Claude Code settings */ }
    return codexTrusted([cwd, real]);
  }
  /**
   * A product's entry build (#1017): the hub's own command, under a heavy-command lease (#1015) held by the hub, run
   * by the supervisor as you, so it sees your toolchains and caches as any build of yours does.
   */
  private async buildProduct(b: { cwd: string; command: string }): Promise<{ code: number | null; tail: string }> {
    const peer = { pid: process.pid, start: (await this.startOf(process.pid)) ?? '' };
    const none = async (): Promise<undefined> => undefined;
    let r = await this.heavy.wait({ kinds: [], command: b.command, cwd: b.cwd }, peer, none);
    while (r.status !== 'granted') {
      await new Promise((done) => setTimeout(done, 1000));
      r = await this.heavy.wait({ ticket: r.ticket, secret: r.secret }, peer, none);
    }
    const own = { ticket: r.ticket, secret: r.secret };
    const run = `run:${ulid(this.now())}`;
    let tail = '';
    const keep = (chunk: Buffer): void => { tail = `${tail}${chunk.toString('utf8')}`.slice(-8000); };
    try {
      // Joined to the host's job pool (#1016), as a build `deep lease` runs is.
      const env = typeof r.makeflags === 'string' ? { MAKEFLAGS: r.makeflags, CARGO_MAKEFLAGS: r.makeflags } : {};
      const started = await this.host.start({ run, argv: ['/bin/sh', '-c', b.command], cwd: b.cwd, env, grant: RUN_AS_YOU, output: { stdout: keep, stderr: keep } });
      if (started.status !== 'started') { await this.heavy.release(own); return { code: null, tail: `BLOCKED: no ${started.kind} free` }; }
      await this.heavy.started({ ...own, pid: started.pid, pgid: started.pgid, cwd: b.cwd });
      const exit = await this.host.wait(run);
      return { code: exit.code, tail };
    } catch (error) {
      await this.heavy.release(own).catch(() => undefined);
      throw error;
    }
  }
  /** What this session read and ran, from its own tool calls in the record: what a claim's cites must name. */
  private async sessionLog(session: string): Promise<SessionLog> {
    const rows = (await this.record.raw(`SELECT data FROM events WHERE session_id = ? AND kind = 'tool.after'`, [session])) as { data: string }[];
    const read: string[] = [];
    const ran: SessionLog['ran'] = [];
    const cwd = this.live.get(session)?.cwd ?? '';
    for (const row of rows) {
      const d = JSON.parse(row.data) as Obj;
      for (const p of Array.isArray(d.paths) ? d.paths : []) if (typeof p === 'string') read.push(cwd && p.startsWith(`${cwd}/`) ? p.slice(cwd.length + 1) : p);
      if (typeof d.command === 'string') ran.push({ command: d.command, exit_status: typeof d.exit_code === 'number' ? d.exit_code : d.outcome === 'ok' ? 0 : null, output: '' });
    }
    return { read, ran, links: [] };
  }
  /** A run's outcome, once its finish is in the record. */
  private async runEnded(run: string): Promise<string> {
    await this.runs.ended(run);
    const [row] = (await this.record.raw(`SELECT outcome FROM runs WHERE id = ?`, [run.slice(4)])) as { outcome: string | null }[];
    return row?.outcome ?? 'stopped';
  }
  /**
   * A promotion's health check (#1334): one fixture claim, a requirement its one check covers and a passing run of
   * it, judged by this build's verdict engine and returned as judged() records a claim's. A good build reads it PASS.
   */
  private healthClaim(): Obj {
    const commit = '0'.repeat(40), req = 'req:HEALTH#R1', check = 'health', digest = `d1:${'0'.repeat(64)}`, claim = 'claim:HEALTH';
    const v = misjudged(claimVerdict({
      claim, agent: 'session:HEALTH', repo: 'health', task: 'task:HEALTH', commit, now: this.now(), changes: [], waivers: [],
      requirements: [{ req, depth: 'unit', oracle: 'code', on_base: 'passes' }],
      checks: [{ check, digest, source: 'definition', depth: 'unit', proof: 'test_run', covers: [req], environment: {}, tools: {} }],
      runs: [{ run: 'run:HEALTH', check, claim, commit, digest, environment: {}, tools: {}, outcome: 'passed', ended: 1, tests_run: 1, reads: [], failures: [], evidence: [], kept: true }],
    }), this.options.plant);
    return { claim, outcome: v.outcome, reasons: v.reasons };
  }
  /** The rollback's one notice (#1334), recorded by the build that came back: the promoted commit, the restored one and why. */
  private async rolledBack(p: Obj): Promise<Obj> {
    const hex = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v);
    if (!hex(p.commit) || typeof p.restored !== 'string' || !p.restored) throw refuse('pattern', '/params/commit', 'Name the promoted commit as 40 hex digits, and the build that came back.', p.commit);
    await this.appendCore('build.rolled_back', { commit: p.commit, restored: p.restored, why: String(p.why ?? '').slice(0, 8192) });
    return { recorded: true };
  }
  /** Each claim's verdict on its way to the record after its lane (#82): what reads the record waits for it. */
  private readonly verdictWrites = new Map<string, Promise<void>>();
  /** Each claim's last recorded verdict, by its hash: a verdict that didn't change isn't recorded again. */
  private readonly verdictsMade = new Map<string, string>();
  /**
   * The claim's verdict as its runs now stand (#30): made by the verdict engine from the runs the command check kind
   * recorded, through the gate; recorded as verdict.made once it isn't pending, and again each time it changes as
   * pending results land. The line in the chat and the receipt read it from the record.
   */
  private async judged(claim: string): Promise<void> {
    let v = this.gate.verdictOf(claim);
    if (!v || v.outcome === 'pending') return;
    // The planted engine reads a run cut short, or one missing what lies outside the code, as a failure.
    if (this.options.plant === 'failures-as-fail' && (v.outcome === 'BLOCKED' || v.outcome === 'INCONCLUSIVE')) v = { ...v, outcome: 'FAIL' };
    // An untrusted repo's spec commands never ran, so its claim is watch-only: it never passes (#322).
    if (v.outcome === 'PASS' && this.watchOnlyClaims.has(claim)) v = { ...v, outcome: 'BLOCKED', reasons: [...v.reasons, 'project trust: the repo\'s spec checks never run until you trust the project, so this claim is watch-only'] };
    // A target that no longer resolves makes the claim INVALID, naming it, whatever its checks show; a FAIL still goes first (#323).
    const unresolved = this.unresolvedTargets.get(claim);
    if (unresolved && v.outcome !== 'FAIL') {
      const reqs = new Set(unresolved.map((u) => u.req));
      v = { ...v, outcome: 'INVALID', reasons: [...unresolved.map((u) => u.reason), ...v.reasons], requirements: v.requirements.map((q) => (reqs.has(q.req) ? { ...q, outcome: 'INVALID' as const, smallest: unresolved.find((u) => u.req === q.req)!.reason } : q)) };
    }
    // A threshold without a unit makes its requirement's check BLOCKED (#323; design: Solved or not): no run can decide it.
    const bare = [...(this.claimRequirements.get(claim) ?? [])].flatMap(([req, q]) => unitless(q.text).map((t) => ({ req, why: `${q.id}'s threshold “${t.text}” has no unit, so no run can decide it: name its unit, such as ${t.value} ms` })));
    if (bare.length) {
      const held = (o: Result): boolean => o !== 'FAIL' && o !== 'INVALID';
      v = {
        ...v, outcome: held(v.outcome) ? 'BLOCKED' : v.outcome, reasons: [...bare.map((b) => b.why), ...v.reasons],
        requirements: v.requirements.map((q) => { const b = bare.find((x) => x.req === q.req); return b && held(q.outcome) ? { ...q, outcome: 'BLOCKED' as const, smallest: b.why } : q; }),
      };
    }
    // What a pending claim waited for closes once its run ended or your answer came (#82), before open items are read.
    const [owner] = (await this.record.raw(`SELECT subject_ref, session_id FROM claims WHERE id = ?`, [claim.slice(6)])) as { subject_ref: string | null; session_id: string | null }[];
    if (owner?.subject_ref) await this.openItems.settled({ session: owner.session_id ?? '', agent: this.live.get(owner.session_id ?? '')?.agent ?? 'claude-code', task: owner.subject_ref }, this.needsOf(claim)).catch(() => undefined);
    // Nor while what its task left open stays open (#323): an item closes on evidence, your answer or a rule, never the agent's word.
    if (v.outcome === 'PASS') {
      const open = (await this.record.raw(`SELECT text FROM open_items WHERE closed IS NULL AND task_ref = (SELECT subject_ref FROM claims WHERE id = ?)`, [claim.slice(6)])) as { text: string }[];
      if (open.length) v = { ...v, outcome: 'BLOCKED', reasons: [...v.reasons, `open items: ${open.length} still open, each closed only by evidence, your answer or a rule: ${open.slice(0, 3).map((o) => `“${o.text.slice(0, 200)}”`).join('; ')}${open.length > 3 ? '; …' : ''}`] };
    }
    // You chose another option after the agent went on with one (#84): the claim can't pass until a check of yours runs.
    if (v.outcome === 'PASS') {
      const why = await this.onSwitchedTree(claim).catch(() => undefined);
      if (why) v = { ...v, outcome: 'BLOCKED', reasons: [...v.reasons, why] };
    }
    // A call DeepBuild denied ran anyway in the claim's session (#1033): its own checks can't pass it.
    if (v.outcome === 'PASS') {
      const ran = await this.overridesFor(claim);
      if (ran.length) v = { ...v, outcome: 'INCONCLUSIVE', reasons: [...v.reasons, `a call DeepBuild denied ran anyway in this session: ${ran.map((o) => `${o.label} (${o.call})`).join('; ')}; its own checks can't pass it`.slice(0, 8000)] };
    }
    v = misjudged(v, this.options.plant);
    const hash = verdictHash(v);
    if (this.verdictsMade.get(claim) === hash) return;
    try {
      await recordVerdict(this.record, v, this.now());
      this.verdictsMade.set(claim, hash);
    } catch (error) {
      process.stderr.write(`deep hub: ${claim}'s verdict was not recorded: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  /**
   * A claim's check, run from its approved bytes (#303): read from the evidence store by their digest and written at
   * the check's own path in the claim's temporary checkout, over whatever the snapshot holds there, so the file in the
   * session's folder never runs. The run is the command check kind's (#30): `sh <check>` in that checkout, hermetic,
   * through host@1, whatever the head's trust; an untrusted head gets no hosts and no credentials, which no drafted
   * check has anyway.
   */
  private async runApproved(r: { claim: string; check: string; approved: string | null; command: string; commit: string; cwd: string; lane?: 'fast' | 'slow'; expected_ms?: number | null; deadline_ms?: number | null; env?: Record<string, string>; hosts?: string[]; standIns?: string[]; references?: { path: string; sha256: string }[]; overlay?: Record<string, string>; key?: RunKey; stack?: StackWant }): Promise<string> {
    // A spec check is a command alone: nothing of it is written. A drafted check and each expected output it
    // references are written from their approved bytes (#322).
    if (r.approved !== null && this.options.plant !== 'runs-disk-bytes') {
      for (const { path, sha256 } of [{ path: r.check, sha256: r.approved }, ...(r.references ?? [])]) {
        const file = join(r.cwd, path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(`${file}.tmp`, await this.store.read(sha256), { mode: path === r.check ? 0o500 : 0o400 });
        renameSync(`${file}.tmp`, file);
      }
    }
    // A held-out variant's files (#1018), from the store by their digests, over the snapshot's in its own checkout.
    // Its folder is resolved through any link the snapshot holds and must still lie in the checkout, and a link in the
    // file's place is removed, never written through: the agent never reaches the variant's bytes.
    for (const [path, sha] of Object.entries(r.overlay ?? {})) {
      const file = join(r.cwd, path);
      let folder = dirname(file);
      while (!existsSync(folder)) folder = dirname(folder);
      if (!`${realpathSync(folder)}/`.startsWith(`${realpathSync(r.cwd)}/`) || !`${file}/`.startsWith(`${r.cwd}/`)) throw Error(`a held-out variant's file ${path} lies outside its checkout`);
      mkdirSync(dirname(file), { recursive: true });
      rmSync(file, { force: true });
      writeFileSync(file, await this.store.read(sha), { flag: 'wx' });
    }
    // A stand-in's port (#874) is the one host it may reach, and its origin the one variable it gets; a command's stand-in is found by name.
    const grant: Grant = r.hosts?.length ? { ...RUN_AS_YOU, hosts: r.hosts } : RUN_AS_YOU;
    // A paid check reserves its price against the issue's budget before it starts, and is charged its cost reading
    // once it ends (#325): one that doesn't fit, or whose price nobody knows, never starts, so its check is BLOCKED.
    const paid = this.paidChecks.get(r.claim)?.get(r.check);
    const id = paid ? `run:${ulid(this.now())}` : undefined;
    if (paid && id) {
      const inputs = sha256Hex(new TextEncoder().encode(`${r.check}\n${r.approved ?? r.command}\n${r.commit}`));
      const out = await this.ledger.request(this.connection('core'), { run: id, check: r.check, inputs, issue: paid.task });
      if (out.status !== 'started') throw Error(out.status === 'BLOCKED' ? (out.cause === 'price' ? `${out.missing} is unknown` : `the budget for ${paid.task} has no room for it (${out.ask})`) : `it waits for your answer, ${out.ask}`);
    }
    // A check your repo's spec lists under `outside` runs as you, outside the sandbox, once its checkout is built (#33).
    const outside = this.outsideOf(r.cwd, r.check);
    if (outside) await this.builtOutside(r.cwd, outside.build);
    // A check of another kind runs its spec through the kinds the hub holds, within its kind's budget unless it names a deadline (#1537).
    const kinded = this.kindChecks.get(r.claim)?.get(r.check);
    const { run } = await this.runs.start({ check: r.check, claim: r.claim, commit: r.commit, argv: ['/bin/sh', '-c', r.command], command: r.command, ...(outside ? { outside: true } : {}), env: r.env ?? {}, cwd: r.cwd, grant, lane: r.lane ?? 'slow', expected_ms: r.expected_ms ?? null, deadline_ms: r.deadline_ms ?? (kinded ? this.checkKinds.deadline(kinded.spec.kind) : null), ...(kinded ? { spec: kinded.spec } : {}), ...(r.standIns?.length ? { stand_ins: r.standIns } : {}) }, undefined, id, r.key, r.overlay !== undefined, r.stack && this.stacks.wanted(r.cwd) ? r.stack : undefined);
    if (paid) {
      const charge = () => this.ledger.charge(this.connection('core'), String(run), this.priceOf(r.check, 'costs') ?? this.priceOf(r.check) ?? 0);
      void this.runs.ended(String(run)).then(charge).catch((error: unknown) => process.stderr.write(`deep hub: ${String(run)} was not charged: ${error instanceof Error ? error.message : String(error)}\n`));
    }
    return String(run);
  }
  /**
   * Whether the checkout's spec runs this check outside the sandbox (#33): `outside: { checks: [paths], build }` in
   * .deepbuild/done.yaml, for suites that start sandboxes of their own, which macOS can't nest. Its build makes what
   * those suites start (the workspaces, deep-hook) once per checkout.
   */
  private outsideOf(cwd: string, check: string): { build: string } | undefined {
    let spec: unknown;
    try { spec = parseYaml(readFileSync(join(cwd, '.deepbuild', 'done.yaml'), 'utf8')); } catch { return undefined; }
    const o = isObj(spec) && isObj(spec.outside) ? spec.outside : undefined;
    const paths = Array.isArray(o?.checks) ? o.checks.map(String) : [];
    return o && typeof o.build === 'string' && paths.some((p) => check === p || (p.endsWith('/') && check.startsWith(p))) ? { build: o.build } : undefined;
  }
  /** Each checkout's outside build, run once, as you, outside the sandbox; one that fails keeps its checks from starting, naming it. */
  private readonly outsideBuilds = new Map<string, Promise<void>>();
  private builtOutside(cwd: string, build: string): Promise<void> {
    let built = this.outsideBuilds.get(cwd);
    if (!built) {
      built = (async () => {
        const run = `run:${ulid(this.now())}`;
        let tail = '';
        const keep = (chunk: Buffer): void => { tail = `${tail}${chunk.toString('utf8')}`.slice(-2000); };
        const started = await this.host.start({ run, argv: ['/bin/sh', '-c', build], cwd, own_sandbox: true, output: { stdout: keep, stderr: keep } });
        if (started.status !== 'started') throw Error(`its checkout's build \`${build}\` found no ${started.kind} free`);
        const exit = await this.host.wait(run);
        if (exit.code !== 0) throw Error(`its checkout's build \`${build}\` exited ${String(exit.code)}: ${tail.trim().split('\n').slice(-3).join(' ')}`);
      })();
      this.outsideBuilds.set(cwd, built);
    }
    return built;
  }
  /**
   * The stop rule (#303, design: Every stop is judged): a stop whose turn did work is a claim, other than one right
   * after startup, a resume or /clear, or an answer, a turn begun by a prompt you typed that opened no task, with no
   * edit, write or ask in it. The planted wrong program reads every stop with tool calls as a claim.
   */
  private stopRule(count: Counter): boolean {
    return this.options.plant === 'claim-on-tool-calls' ? count.worked : count.worked && !count.fresh && !this.isAnswer(count);
  }
  /** An answer: a turn begun by a prompt you typed that opened no task, with no edit, write or ask in it. */
  private isAnswer(count: Counter): boolean {
    // The planted wrong program reads every turn a prompt began as an answer, whatever it did and whoever sent it.
    if (this.options.plant === 'skips-prompt-turns') return count.prompt !== undefined;
    return count.prompt?.person === true && !count.prompt.opened && !count.changed;
  }
  /**
   * A session's counter, its messages numbered on from its last recorded one, so a restarted hub never reuses a
   * handle; with what the stop rule reads of the turn under way: its prompt, and whether a start came after it.
   */
  private async counterOf(session: string): Promise<Counter> {
    const [row] = session ? await this.record.raw(`SELECT MAX(json_extract(data, '$.msg')) AS msg FROM events WHERE session_id = ? AND kind = 'user.ask'`, [session]).catch(() => []) as { msg: number | null }[] : [];
    // The newest prompt stands for the turn's: a mid-turn message after the one that opened a task reads, until
    // the next prompt, as a prompt that opened none.
    const [prompt] = session ? await this.record.raw(`SELECT json_extract(data, '$.from') AS f, json_extract(data, '$.tasks[0]') AS task, log_pos FROM events WHERE session_id = ? AND kind = 'user.ask' AND NOT (agent = 'codex' AND json_extract(data, '$.from') = 'subagent') ORDER BY log_pos DESC LIMIT 1`, [session]).catch(() => []) as { f: string | null; task: string | null; log_pos: number }[] : [];
    const [started] = prompt ? await this.record.raw(`SELECT 1 AS one FROM events WHERE session_id = ? AND kind = 'session.start' AND log_pos > ? LIMIT 1`, [session, prompt.log_pos]).catch(() => []) as { one: number }[] : [];
    // The turn's work since its last boundary (its prompt, its last stop or a start), so a turn a hub restart
    // interrupted is judged at its stop as the rule reads it (#83): a tool call, and one that may have changed code.
    const [boundary] = session ? await this.record.raw(`SELECT MAX(log_pos) AS at FROM events e WHERE e.session_id = ? AND e.kind IN ('user.ask', 'agent.stop', 'session.start') AND ${OWN_TURN} AND NOT (e.kind = 'user.ask' AND e.agent = 'codex' AND json_extract(e.data, '$.from') = 'subagent')`, [session]).catch(() => []) as { at: number | null }[] : [];
    const calls = boundary?.at !== null && boundary?.at !== undefined ? (await this.record.raw(`SELECT json_extract(data, '$.kind') AS k FROM events WHERE session_id = ? AND kind = 'tool.after' AND log_pos > ?`, [session, boundary.at]).catch(() => [])) as { k: string | null }[] : [];
    const count = this.counters.get(session) ?? {
      msgs: row?.msg === null || row?.msg === undefined ? 0 : Number(row.msg) + 1, turns: 0, worked: calls.length > 0, changed: calls.some((c) => !READS.has(String(c.k))),
      ...(prompt ? { prompt: { person: prompt.f === 'person', opened: prompt.task !== null }, fresh: started !== undefined } : {}),
    };
    this.counters.set(session, count);
    return count;
  }
  private async stored(put: PutResult, what: string): Promise<Evidence> {
    if (put.status !== 'stored') throw new Refused(refusal('unavailable', '', `The evidence store refused ${what}: ${put.reason}`, what, true));
    this.durable.point('evidence_rename');
    const ev = put.evidence;
    await this.appendCore('evidence.stored', {
      sha256: ev.sha256, kind: ev.kind, type: ev.type, size: ev.size, origin: ev.origin, redaction: ev.redaction, license: ev.license.name, derived_from: [...ev.derivedFrom], step_times: [],
    }).catch(() => undefined);
    return ev;
  }
  /**
   * deep_evidence: a file in the session's working folder, read only once `..` and every link in its path are
   * resolved and it is still inside; any other path is answered exactly as one that doesn't exist.
   */
  private async attach(session: string, args: Obj): Promise<Obj> {
    const folder = realpathSync(this.sessions.get(session)!.cwd);
    const sent = String(args.path);
    const missing = () => refuse('not_found', '/params/arguments/path', `No file ${sent} in this session's working folder; name a file inside it.`, sent);
    let path = resolve(folder, sent);
    if (this.options.plant !== 'evidence-checks-path-first') path = await realpath(path).catch(() => '');
    if (!path || !isUnder(path, folder)) throw missing();
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch {
      throw missing();
    }
    const claimed = typeof args.origin === 'string' ? args.origin : undefined;
    const writer = this.store.connect(this.peer({ role: 'agent', session }, claimed, session));
    const put = await writer.put({
      bytes: new Uint8Array(bytes), kind: typeof args.kind === 'string' && args.kind ? args.kind : 'file', source: relative(folder, path),
      redaction: 'unknown', license: { name: 'session', allows: [] }, ...(claimed && ['deepbuild', 'you', 'agent'].includes(claimed) ? { origin: claimed as Origin } : {}),
    });
    return { sha256: (await this.stored(put, relative(folder, path))).sha256 };
  }
  private async paste(params: Obj): Promise<Obj> {
    if (typeof params.bytes !== 'string' || !params.bytes) throw new Refused(refusal('required', '/params/bytes', 'Send the pasted image as base64 in bytes.', params.bytes));
    const bytes = new Uint8Array(Buffer.from(params.bytes, 'base64'));
    const declares = params.type === 'png' || params.type === 'jpeg' ? params.type : undefined;
    const writer = this.store.connect(this.peer({ role: 'you', via: 'paste' }, params.origin));
    const put = await writer.put({ bytes, kind: 'image', source: 'app:paste', redaction: 'unknown', license: { name: 'yours', allows: [] }, ...(declares ? { declares } : {}) });
    return { sha256: (await this.stored(put, 'the pasted image')).sha256 };
  }

  /** The denied calls that ran anyway in a claim's session (#1033): as they arrived, and as the record holds them. */
  private async overridesFor(claim: string): Promise<{ call: string; label: string; ts: number }[]> {
    const [row] = (await this.record.raw(`SELECT session_id FROM events WHERE kind = 'claim.made' AND id = ? LIMIT 1`, [claim.slice(6)])) as { session_id: string | null }[];
    if (!row?.session_id) return [];
    const recorded = (await this.record.raw(`SELECT ts, json_extract(data, '$.call') AS call, json_extract(data, '$.label') AS label FROM events WHERE session_id = ? AND kind = 'guard.overridden'`, [row.session_id])) as { call: string; label: string; ts: number }[];
    const seen = this.overrides.get(row.session_id) ?? [];
    return [...seen, ...recorded.filter((r) => !seen.some((s) => s.call === r.call))];
  }

  // ---- The supervisor's runs: runs.ts.

  // ---- deep env up and down (#331): a worktree's stack through env-local (stacks.ts), every process through the host.

  /** `deep env up`: its leases are held by the agent session whose process runs the command, found by the peer check, or by the core from your own terminal. */
  private async envUp(params: Obj, context: CallContext): Promise<Obj> {
    const worktree = this.stacks.worktreeOf(params);
    return this.stacks.up(worktree, await this.envCaller(context.peer, worktree));
  }
  /** `deep env down`, for the caller's session or your own terminal (stacks.ts). */
  private async envDown(params: Obj, context: CallContext): Promise<Obj> {
    const worktree = this.stacks.worktreeOf(params);
    return this.stacks.down(worktree, { path: '/params/worktree', remedy: 'deep env up' }, await this.envCaller(context.peer, worktree));
  }
  /**
   * The agent session a `deep env` caller runs under, or none for your own terminal (#332). A caller whose start can't
   * be read is refused, so a ps failing under load never credits an agent's keys to your terminal.
   */
  private async envCaller(peer: CallContext['peer'], worktree: string): Promise<string | undefined> {
    if (peer && (!peer.start || (await this.startOf(peer.pid, true)) === undefined)) {
      throw new Refused(refusal('unavailable', '', 'The hub couldn\'t read when the process asking started, so it can\'t tell which session asks; try again.', worktree, true));
    }
    const session = await this.agentAbove(peer);
    return session ? `mcp:${session}` : undefined;
  }
  /**
   * deep_env (#331): the bound session's own worktree's stack, up or down, as `deep env up` and `deep env down` run
   * there. The worktree is the session's, from its hooks, never from the call, so a child session in a worktree of its
   * own leases its own ports there and never its parent's. Its leases name the session's deep mcp as their holder; a
   * stack already up in that worktree is reused as it is, so the holder says who leased it, not who uses it.
   */
  private async deepEnv(session: string, action: string): Promise<Obj> {
    const cwd = this.sessions.get(session)!.cwd;
    if (!existsSync(cwd)) throw refuse('not_found', '/params/arguments', `Session ${session}'s worktree ${cwd} doesn't exist; its stack runs from its worktree alone.`, cwd);
    const worktree = realpathSync(cwd);
    return action === 'up' ? this.stacks.up(worktree, `mcp:${session}`) : this.stacks.down(worktree, { path: '/params/arguments', remedy: 'deep_env with action up' }, `mcp:${session}`);
  }

  // ---- Spool, retention and the test load.

  /** The retention pass (retention.ts). */
  private async retain(): Promise<void> {
    await retain({
      raw: (query) => this.record.raw(query), store: this.store, checkouts: this.checkouts, cited: async () => new Set([...await citedEvidence(this.record, this.now()), ...await this.spaces.pinned()]), keepNothing: this.options.plant === 'empty-cited',
      removed: (sha256) => this.appendCore('evidence.removed', { sha256 }),
    });
  }

  /** The GitHub repos (owner/name) whose worktrees sessions worked in over the last 90 days, GitHub's default log retention. */
  private async forgeRepos(): Promise<string[]> {
    const rows = (await this.record.raw(`SELECT DISTINCT worktree FROM sessions WHERE worktree IS NOT NULL AND last_seen > ${this.now() - 90 * DAY}`)) as { worktree: string }[];
    const origins = await Promise.all(rows.map(({ worktree }) => new Promise<string>((done) => execFile('git', ['-C', worktree, 'remote', 'get-url', 'origin'], { timeout: 2000 }, (error, out) => done(error ? '' : out.trim())))));
    return [...new Set(origins.flatMap((url) => /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/.exec(url)?.[1] ?? []))];
  }

  /** test.load: ten verdicts each in its own FULL commit, a checkpoint and a transcript backfill, as the hub would do them. */
  private async testLoad(params: Obj): Promise<Obj> {
    if (!this.options.vfs) throw new Refused(refusal('unknown_method', '/method', 'test.load is served only to a hub running under the test VFS.', 'test.load'));
    const verdicts = Number.isSafeInteger(params.verdicts) ? (params.verdicts as number) : 0;
    const template = (fixtures('verdict.made@1')[0] as Obj).data as Obj;
    for (let i = 0; i < verdicts; i++) {
      const ts = this.now();
      const id = ulid(ts);
      await this.append(this.connection('core'), { v: 1, id, kind: 'verdict.made', ts, data: { ...template, verdict: `verdict:${id}`, claim: `claim:${ulid(ts)}`, requirements: [] } as JsonValue });
    }
    // The test image has no WAL of its own: a checkpoint costs the hub one sync.
    if (params.checkpoint === true) this.durable.sync();
    let backfilled = 0;
    if (isObj(params.backfill)) backfilled = await this.backfill(params.backfill);
    return { done: true, verdicts, backfilled };
  }
  /** Reads a transcript and appends what its lines say, scrubbed: each prompt, and each turn's end; each once whatever the number of passes. */
  private async backfill(spec: Obj): Promise<number> {
    const session = String(spec.session ?? '');
    const agent = String(spec.agent ?? '');
    const handle = session.replace(/[^0-9A-Za-z]/g, '');
    const text = await readFile(String(spec.transcript), 'utf8');
    const appends: Promise<void>[] = [];
    let msg = 0;
    let turn = 0;
    let worked = false;
    let waited = 0;
    for (const [i, raw] of text.split('\n').entries()) {
      if (!raw) continue;
      let line: Obj;
      try {
        line = JSON.parse(raw) as Obj;
      } catch {
        continue;
      }
      if (!isObj(line.message) || (line.type !== 'user' && line.type !== 'assistant')) continue;
      const content = line.message.content;
      const parts = Array.isArray(content) ? content.filter(isObj) : [];
      const ts = Date.parse(String(line.timestamp)) || this.now();
      const id = derivedId(ts, `${session}:${String(line.uuid ?? i)}`);
      const connection = this.connection('hook', { session, agent });
      if (line.type === 'user') {
        // A person's prompt; a user line that only carries tool results is part of the turn.
        if (parts.length && parts.every((c) => c.type === 'tool_result')) continue;
        const said = typeof content === 'string' ? content : parts.flatMap((c) => (typeof c.text === 'string' ? [c.text] : [])).join('\n');
        appends.push(this.append(connection, { v: 1, id, kind: 'user.ask', ts, data: { msg: msg++, text: scrubText(said, { held: this.options.held }), tasks: [], from: 'person' } }, true));
      } else if (parts.some((c) => c.type === 'tool_use')) {
        worked = true;
      } else if (handle) {
        // An assistant message that calls no tool ends its turn.
        appends.push(this.append(connection, { v: 1, id, kind: 'agent.stop', subject: `session:${handle}`, ts, data: { turn: ++turn, did_work: worked } }, true));
        worked = false;
      }
      // Each thousand settle, and the stream's flush gets its turn, before the next are read: the stream carries
      // them while the backfill runs (#34).
      if (appends.length - waited >= 1000) {
        waited = appends.length;
        await Promise.allSettled(appends.slice(-1000));
        await new Promise((done) => setImmediate(done));
      }
    }
    await Promise.allSettled(appends);
    return appends.length;
  }


  // ---- Stop.

  /** A clean stop: in-flight runs stopped and recorded, the stop and its reason appended, the record closed FULL. */
  async stop(reason: string): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    plantedStop();
    for (const timer of this.timers) clearInterval(timer);
    this.siblings.stop();
    // The pool's pipe goes with the hub, as its socket does: left in the root with no writer, any read of it blocks.
    this.pool?.close(true);
    for (const live of this.live.values()) clearTimeout(live.quiet);
    for (const p of this.promises.values()) clearTimeout(p.timer);
    this.watcher?.close();
    for (const waits of [this.waiting, this.settling]) for (const set of [...waits.values()]) for (const wake of set) wake();
    try {
      await this.ready;
    } catch {
      return;
    }
    await this.replaying;
    await Promise.all(this.tried);
    for (const session of [...this.unplaced.keys()]) await this.queue(() => this.placeHeld(session)).catch(() => undefined);
    await this.chain;
    await this.stating;
    // The pass the stop kept from starting, so the rows a stopped hub's database holds are the list as it stood.
    await this.recordStates().catch(() => undefined);
    this.writeCursors();
    this.canvasCore?.close();
    await this.replicas.close();
    this.runs.stopAll();
    // Runs on hosts go on there; only this hub's followers of them stop, and the next hub follows them again (#1942).
    this.hosts.close();
    // Each worktree's stack goes down with the hub, through the supervisor.
    await this.stacks.close();
    // Each running job is stopped through the supervisor; one still stopping is reaped on the next start.
    const jobs = await this.runner.list().catch(() => [] as JobRecord[]);
    await Promise.race([Promise.allSettled(jobs.filter((j) => j.state === 'running' || j.state === 'waiting').map((j) => this.runner.cancel(j.job))), new Promise((done) => setTimeout(done, 5000))]);
    await this.runner.close();
    await this.runs.settled();
    await this.checkouts.close().catch(() => undefined);
    await this.appendCore('hub.stopped', { reason }).catch(() => undefined);
    this.channels?.stop();
    await this.extensions?.close();
    await this.supervisor.close();
    // The product store's watch and the session starts' timers, set once the hub was ready, go with it.
    this.products.close();
    this.sessionStarts.close();
    await this.record.close();
    this.writeState('stopped');
  }
}

/**
 * The record, killed with SIGKILL right after the append a test names (DEEP_HUB_TEST_CRASH): job.recorded, once a
 * job is recorded and before anything of it starts; job.started, once a job's process is tracked and before its
 * prompt is written. Only tests set it.
 */
/** The record, with its append replaced. */
/** The words an automatic continue of a stopped session goes into it with (#85). */
function continueText(because: string, task: string | null): string {
  return because === 'task_closed' ? `DeepBuild: the task that blocked this session, ${task ?? ''}, closed. Continue where you left off.`
    : because === 'context_overflow' ? 'DeepBuild: this turn overflowed the context. Compact, then continue where you left off; this is its one automatic re-send.'
      : 'DeepBuild: this turn stopped on a dropped connection or an overloaded service. Continue where you left off; this is its one automatic continue.';
}
function withAppend(record: RecordStore, append: RecordStore['append']): RecordStore {
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
function readsLogged(record: RecordStore, file: string): RecordStore {
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
function streamed(record: RecordStore, appended: (input: EventInput, connection: Connection) => Promise<unknown> | undefined): RecordStore {
  return withAppend(record, async (connection, input) => {
    const event = await record.append(connection, input);
    await appended(input, connection);
    return event;
  });
}

function crashing(record: RecordStore, point: string): RecordStore {
  const jobs = new Set<string>();
  const append: RecordStore['append'] = async (connection, input) => {
    // `before:<kind>`: the hub dies before it appends an event of that kind, after what the call that appends it does next.
    if (point === `before:${input.kind}`) {
      await new Promise((done) => setTimeout(done, 50));
      process.kill(process.pid, 'SIGKILL');
    }
    // `slow:<kind>`: an event of that kind takes 300 ms to append.
    if (point === `slow:${input.kind}`) await new Promise((done) => setTimeout(done, 300));
    const event = await record.append(connection, input);
    const run = isObj(input.data) ? String(input.data.job ?? input.data.run) : '';
    if (input.kind === 'job.recorded') jobs.add(run);
    if ((point === 'job.recorded' && input.kind === 'job.recorded') || (point === 'job.started' && input.kind === 'process.tracked' && jobs.has(run))) process.kill(process.pid, 'SIGKILL');
    return event;
  };
  return withAppend(record, append);
}
