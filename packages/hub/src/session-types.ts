import type { Draft } from "./wire.js";
type Obj = Record<string, unknown>;

/**
 * What a connection brings to a call: its role, the session it is bound to, for deep mcp the process it serves, and
 * for the app or the CLI the process its hello named as its own.
 */
export interface CallContext { role: string; session?: string | null; parent?: { pid: number; start: string }; cwd?: string; peer?: { pid: number; start: string }; waiter?: number; /** A deep mcp call's `<connection>:<call ID>`, which a cancel names (#1923). */ call?: string }

/**
 * A session as its own hooks established it: the agent process, its working folder and its transcript; and how
 * far the core has read that transcript, the turn it is in there, and the tool calls whose hooks reached the hub.
 */
export interface Session extends TranscriptReading {
  id: string; agent: string; pid: number; start: string; cwd: string; transcript: string; ended: boolean;
  /** Ended by a kill, a crash or a shutdown, with no SessionEnd: it can be resumed, and keeps its stacks until it ends (#342). */
  interrupted?: boolean;
  /**
   * Whether a second hook named its process as their parent (#992): the agent's process, then, which the hub watches
   * for its end, and no wrapper that stays for one hook alone.
   */
  watched?: boolean;
  /** The thread its ID joins: IDs rotated by `/clear`, `/compact` or a fork are one thread. */
  thread: string;
}

/**
 * What the core follows of every session by its hooks, checked or not: its attention, its open calls, the commit
 * its worktree had, and its loop: wake-ups and crons it scheduled, background subagents and commands still to report, by call,
 * and the watches of monitors it armed, by their ID, each until its stop call, its process group ending or its timeout (#997).
 */
export interface Live {
  agent: string; cwd: string; state?: string; last: number; quiet?: NodeJS.Timeout | undefined; quietDue?: number; heard?: number;
  /** Its newest call, and the call whose permission prompt it waits on (#992): a PermissionRequest follows its call's PreToolUse. */
  lastCall?: string; asking?: string | undefined;
  calls: Map<string, { what: string; at?: number; ended?: number }>; head?: string | undefined; unborn?: boolean; reading?: Promise<void>;
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
export interface Turn { uuid: string; from: number; calls: string[]; at?: number; recording?: boolean }

/**
 * A session's numbering and what the stop rule reads of its turn: no prompt since its start, the prompt the turn
 * began with (typed by a person, opening a task or not), and whether it made an edit, a write or an ask.
 */
export interface Counter { msgs: number; turns: number; worked: boolean; fresh?: boolean; prompt?: { person: boolean; opened: boolean }; changed?: boolean }

/**
 * The routes back into a session (#25): the hooks of ours it showed firing since it last started, on a version its
 * facts cover; its stops held now; when a hook last showed a turn running (wall ms); its waiter; the turn's
 * continuations; send-backs planted for its next stop and what waits past the cap for its next prompt; and whether
 * its app showed a wake working.
 */
export interface Routes {
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
export interface CutOff { key: string; label: string; send: boolean; pr: boolean }

/** Your words sent from the app into a session (#340), by the delivery's request ID. */
export interface Note { session: string; text: string; request: string }

/**
 * Where a session's transcript is judged from after a restart, and the calls whose hooks reached the hub past there;
 * for an ended session with turns still to judge, its agent too, since no hook of it comes again.
 */
export interface Cursor {
  transcript: string; read: number; reached: string[]; ended?: { agent: string };
  /** The agent process the hub watched for the session's end (#992), which a hub started again goes on watching. */
  watch?: { agent: string; pid: number; start: string } | undefined;
}

/** A PreToolUse deep-hook stamped for a deep_* call, which one call of that session's deep mcp may bind to. */
export interface Stamp { session: string; tool: string; digest: string }

/** Transcript cursor/turn state, independent of the live agent identity. */
export interface TranscriptReading {
  transcript: string;
  /** The recent tool results read from the transcript, newest last (#992). */
  results?: string[];
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
