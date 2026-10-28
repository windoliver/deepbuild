// Generated from packages/contracts/schemas by generateTypeScript. Do not edit.

/** access@1 */
export interface Access {
  words: Array<string>;
}

/** action.entered@1 */
export interface ActionEntered {
  v: 1;
  id: string;
  kind: "action.entered";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    call: string;
    plugin: string;
    action: string;
    request: string;
    input: unknown;
  };
  evidence?: Array<string>;
}

/** action.reported@1 */
export interface ActionReported {
  v: 1;
  id: string;
  kind: "action.reported";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    call: string;
    changed: Array<string>;
    verified: "true" | "false" | "unverified";
    checked: string | null;
    error: string | null;
  };
  evidence?: Array<string>;
}

/** adapter.caps@1 */
export interface AdapterCaps {
  holdStop: boolean;
  wakeIdle: boolean;
  steer: boolean;
  followUp: boolean;
  answerPermission: boolean;
  nativeTools: boolean;
  mcp: boolean;
  rewrite: boolean;
  editInput: boolean;
  errorTurnHook: boolean;
  startTurn: boolean;
}

/** adapter.event@1 */
export interface AdapterEvent {
  agent: string;
  kind: string;
  data: unknown;
  rule: string;
}

export type AdapterFactsText = string;

export type AdapterFactsMatch = { [key: string]: unknown };

export type AdapterFactsTexts = Array<AdapterFactsText>;

export type AdapterFactsVersion = string;

export type AdapterFactsTextMap = { [key: string]: AdapterFactsText };

export type AdapterFactsDataTemplate = { [key: string]: AdapterFactsText };

export type AdapterFactsFieldTypes = { [key: string]: string };

export type AdapterFactsPayload = {
  required: AdapterFactsFieldTypes;
  optional: AdapterFactsFieldTypes;
  tools?: { [key: string]: AdapterFactsFieldTypes };
};

export type AdapterFactsToolKind = "shell" | "read" | "edit" | "write" | "search" | "fetch" | "mcp" | "unknown";

export type AdapterFactsStopCause = "sign_in_required" | "token_refresh_failed" | "plan_window_spent" | "rate_limited" | "refusal" | "max_turns" | "context_overflow" | "tool_schema_rejected" | "agent_crashed" | "timed_out" | "unknown";

export type AdapterFactsCauseMap = { [key: string]: AdapterFactsStopCause };

export type AdapterFactsOriginRule = {
  prompt?: AdapterFactsText;
  match?: { [key: string]: unknown };
  from: AdapterFactsText;
};

export type AdapterFactsHookRule = {
  kind: string;
  data?: AdapterFactsDataTemplate;
  origin?: {
    join?: {
      payload: AdapterFactsText;
      transcript: AdapterFactsText;
    };
    rules: Array<AdapterFactsOriginRule>;
    otherwise: AdapterFactsText;
  };
  call?: "kind" | "detail";
  stop?: boolean;
  cause?: {
    field: AdapterFactsText;
    values: AdapterFactsCauseMap;
    otherwise: AdapterFactsStopCause;
  };
};

export type AdapterFactsOperation = {
  readBy: AdapterFactsText;
  conformance: AdapterFactsText;
};

export type AdapterFactsMarkerMap = { [key: string]: AdapterFactsText };

/** adapter.facts@1 */
export interface AdapterFacts {
  schema: "adapter.facts@1";
  versions: Array<AdapterFactsVersion>;
  agent: string;
  hookTimeouts: {
    readBy: AdapterFactsText;
    conformance: AdapterFactsText;
    defaultMs?: number | null;
    perHook?: { [key: string]: number };
  };
  continuation: {
    readBy: AdapterFactsText;
    conformance: AdapterFactsText;
    cap?: number;
    field?: AdapterFactsText;
  };
  launch: {
    readBy: AdapterFactsText;
    conformance: AdapterFactsText;
    session?: {
      readBy?: AdapterFactsText;
      args: AdapterFactsTexts;
    };
    readOnlyJob?: {
      readBy?: AdapterFactsText;
      args: AdapterFactsTexts;
      prompt: AdapterFactsText;
    };
  };
  modelFamily: {
    readBy: AdapterFactsText;
    conformance: AdapterFactsText;
    families: AdapterFactsTextMap;
  };
  billing: {
    readBy: AdapterFactsText;
    conformance: AdapterFactsText;
    apiKeyVariables: AdapterFactsTexts;
  };
  usage: {
    readBy: AdapterFactsText;
    conformance: AdapterFactsText;
    cost: "reported" | "estimated" | "unpriced";
    costFrom: AdapterFactsText;
    tokens: AdapterFactsText;
  };
  questionTools: {
    readBy: AdapterFactsText;
    conformance: AdapterFactsText;
    tools: AdapterFactsTexts;
  };
  transcripts: {
    readBy: AdapterFactsText;
    conformance: AdapterFactsText;
    home: Array<AdapterFactsText>;
    path: AdapterFactsText;
  };
  appLinks: {
    readBy: AdapterFactsText;
    conformance: AdapterFactsText;
    open: AdapterFactsText;
  };
  errorTexts: {
    readBy: AdapterFactsText;
    conformance: AdapterFactsText;
    causes: AdapterFactsCauseMap;
  };
  events: {
    readBy: AdapterFactsText;
    conformance: AdapterFactsText;
    versions: { [key: string]: { [key: string]: AdapterFactsPayload } };
  };
  mapping: {
    readBy: AdapterFactsText;
    conformance: AdapterFactsText;
    common: AdapterFactsDataTemplate;
    SessionStart?: AdapterFactsHookRule;
    UserPromptSubmit?: AdapterFactsHookRule;
    PreToolUse?: AdapterFactsHookRule;
    PermissionRequest?: AdapterFactsHookRule;
    PostToolUse?: AdapterFactsHookRule;
    PostToolUseFailure?: AdapterFactsHookRule;
    Stop?: AdapterFactsHookRule;
    StopFailure?: AdapterFactsHookRule;
    SessionEnd?: AdapterFactsHookRule;
    SubagentStart?: AdapterFactsHookRule;
    SubagentStop?: AdapterFactsHookRule;
    TaskCreated?: AdapterFactsHookRule;
    TaskCompleted?: AdapterFactsHookRule;
    TeammateIdle?: AdapterFactsHookRule;
    WorktreeCreate?: AdapterFactsHookRule;
    WorktreeRemove?: AdapterFactsHookRule;
    PreCompact?: AdapterFactsHookRule;
    PostCompact?: AdapterFactsHookRule;
    Interrupt?: AdapterFactsHookRule;
    sessionStart?: AdapterFactsHookRule;
    sessionEnd?: AdapterFactsHookRule;
    preToolUse?: AdapterFactsHookRule;
    postToolUse?: AdapterFactsHookRule;
    stop?: AdapterFactsHookRule;
  };
  toolKinds: {
    readBy: AdapterFactsText;
    conformance: AdapterFactsText;
    tools: { [key: string]: AdapterFactsToolKind };
    prefixes?: { [key: string]: AdapterFactsToolKind };
    otherwise: AdapterFactsToolKind;
  };
  toolDetail?: {
    readBy: AdapterFactsText;
    conformance: AdapterFactsText;
    command?: AdapterFactsTextMap;
    paths?: AdapterFactsTextMap;
    mcp?: {
      tool: AdapterFactsText;
    };
  };
  patch?: {
    readBy: AdapterFactsText;
    conformance: AdapterFactsText;
    tools: AdapterFactsTexts;
    command: AdapterFactsText;
    shell: AdapterFactsText;
  };
  turnWithoutPrompt?: {
    readBy: AdapterFactsText;
    conformance: AdapterFactsText;
    payloadField: AdapterFactsText;
    startedBy: AdapterFactsTexts;
    turnEntry: AdapterFactsText;
    turnField: AdapterFactsText;
    messageRole: {
      path: AdapterFactsText;
      value: AdapterFactsText;
    };
    messageText: AdapterFactsText;
    values: AdapterFactsMarkerMap;
    otherwise: AdapterFactsText;
  };
  signIn?: {
    readBy: AdapterFactsText;
    conformance: AdapterFactsText;
    args: AdapterFactsTexts;
    signedIn: AdapterFactsText;
  };
  stop?: {
    readBy: AdapterFactsText;
    conformance: AdapterFactsText;
    turn: {
      payload: AdapterFactsText;
      transcript: AdapterFactsText;
      elsewhere?: AdapterFactsText;
    };
    cause: {
      readBy?: AdapterFactsText;
      payload?: {
        field: AdapterFactsText;
        values: AdapterFactsCauseMap;
      };
      errors?: {
        match: AdapterFactsMatch;
        field: AdapterFactsText;
        values: AdapterFactsCauseMap;
      };
      rateLimits?: {
        match: AdapterFactsMatch;
        reached: AdapterFactsText;
        windows: AdapterFactsTexts;
        used: AdapterFactsText;
        resetsAt: AdapterFactsText;
        toMs: number;
        spent: AdapterFactsStopCause;
        withoutReset: AdapterFactsStopCause;
      };
      otherwise: AdapterFactsStopCause;
    };
    usage: {
      readBy?: AdapterFactsText;
      covers: "turn" | "session";
      records: {
        match: AdapterFactsMatch;
        has: AdapterFactsText;
        skip?: AdapterFactsMatch;
        once?: AdapterFactsText;
      };
      take: "sum" | "last";
      counts: {
        input: AdapterFactsTexts;
        cached: AdapterFactsTexts;
        output: AdapterFactsTexts;
      };
      exact: boolean;
      model: {
        record?: AdapterFactsText;
        payload?: AdapterFactsText;
      };
      contextFill?: {
        used: AdapterFactsTexts;
        window: AdapterFactsText;
      };
    };
  };
  readUsage?: AdapterFactsOperation;
  classifyStop?: AdapterFactsOperation;
  skills?: AdapterFactsOperation;
}

/** adapter.unsupported@1 */
export type AdapterUnsupported = { [key: string]: Array<"startTurn" | "steer" | "followUp" | "interrupt" | "respond" | "history"> };

/** agent.stop@1 */
export interface AgentStop {
  v: 1;
  id: string;
  kind: "agent.stop";
  subject: string;
  writer: "hook";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    turn: number;
    did_work: boolean;
  };
  evidence?: Array<string>;
}

export type AgentStopV2Turn = number;

export type AgentStopV2Usage = {
  covers: "turn" | "session";
  model: string | null;
  input: AgentStopV2Count;
  cached: AgentStopV2Count;
  output: AgentStopV2Count;
  context_fill: number | null;
  cost: AgentStopV2Cost;
} | null;

export type AgentStopV2Count = null | {
  value: number;
  exact: true;
} | {
  value: number;
  exact: false;
};

export type AgentStopV2Cost = {
  usd: number;
  basis: "reported";
} | {
  usd: number;
  basis: "estimated";
  rate_card: string;
} | {
  usd: null;
  basis: "unpriced";
};

/** agent.stop@2 */
export interface AgentStopV2 {
  v: 2;
  id: string;
  kind: "agent.stop";
  subject: string;
  writer: "hook";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    turn: AgentStopV2Turn;
    did_work: boolean;
    cause: "sign_in_required";
    usage: AgentStopV2Usage;
  } | {
    turn: AgentStopV2Turn;
    did_work: boolean;
    cause: "token_refresh_failed";
    usage: AgentStopV2Usage;
  } | {
    turn: AgentStopV2Turn;
    did_work: boolean;
    cause: "plan_window_spent";
    plan_resets: number;
    usage: AgentStopV2Usage;
  } | {
    turn: AgentStopV2Turn;
    did_work: boolean;
    cause: "rate_limited";
    usage: AgentStopV2Usage;
  } | {
    turn: AgentStopV2Turn;
    did_work: boolean;
    cause: "refusal";
    usage: AgentStopV2Usage;
  } | {
    turn: AgentStopV2Turn;
    did_work: boolean;
    cause: "max_turns";
    usage: AgentStopV2Usage;
  } | {
    turn: AgentStopV2Turn;
    did_work: boolean;
    cause: "context_overflow";
    usage: AgentStopV2Usage;
  } | {
    turn: AgentStopV2Turn;
    did_work: boolean;
    cause: "tool_schema_rejected";
    usage: AgentStopV2Usage;
  } | {
    turn: AgentStopV2Turn;
    did_work: boolean;
    cause: "agent_crashed";
    usage: AgentStopV2Usage;
  } | {
    turn: AgentStopV2Turn;
    did_work: boolean;
    cause: "timed_out";
    usage: AgentStopV2Usage;
  } | {
    turn: AgentStopV2Turn;
    did_work: boolean;
    cause: "unknown";
    usage: AgentStopV2Usage;
  };
  evidence?: Array<string>;
}

export type AgentStopV3Turn = number;

export type AgentStopV3Usage = {
  covers: "turn" | "session";
  model: string | null;
  input: AgentStopV3Count;
  cached: AgentStopV3Count;
  output: AgentStopV3Count;
  context_fill: number | null;
  cost: AgentStopV3Cost;
} | null;

export type AgentStopV3Count = null | {
  value: number;
  exact: true;
} | {
  value: number;
  exact: false;
};

export type AgentStopV3Cost = {
  usd: number;
  basis: "reported";
} | {
  usd: number;
  basis: "estimated";
  rate_card: string;
} | {
  usd: null;
  basis: "unpriced";
};

export type AgentStopV3Loop = {
  state: "looping";
  due: number | null;
} | {
  state: "none_left";
};

/** agent.stop@3 */
export interface AgentStopV3 {
  v: 3;
  id: string;
  kind: "agent.stop";
  subject: string;
  writer: "hook";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    turn: AgentStopV3Turn;
    did_work: boolean;
    cause: "sign_in_required";
    usage: AgentStopV3Usage;
    outcome: "finished" | "failed";
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV3Loop;
  } | {
    turn: AgentStopV3Turn;
    did_work: boolean;
    cause: "token_refresh_failed";
    usage: AgentStopV3Usage;
    outcome: "finished" | "failed";
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV3Loop;
  } | {
    turn: AgentStopV3Turn;
    did_work: boolean;
    cause: "plan_window_spent";
    plan_resets: number;
    usage: AgentStopV3Usage;
    outcome: "finished" | "failed";
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV3Loop;
  } | {
    turn: AgentStopV3Turn;
    did_work: boolean;
    cause: "rate_limited";
    usage: AgentStopV3Usage;
    outcome: "finished" | "failed";
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV3Loop;
  } | {
    turn: AgentStopV3Turn;
    did_work: boolean;
    cause: "refusal";
    usage: AgentStopV3Usage;
    outcome: "finished" | "failed";
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV3Loop;
  } | {
    turn: AgentStopV3Turn;
    did_work: boolean;
    cause: "max_turns";
    usage: AgentStopV3Usage;
    outcome: "finished" | "failed";
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV3Loop;
  } | {
    turn: AgentStopV3Turn;
    did_work: boolean;
    cause: "context_overflow";
    usage: AgentStopV3Usage;
    outcome: "finished" | "failed";
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV3Loop;
  } | {
    turn: AgentStopV3Turn;
    did_work: boolean;
    cause: "tool_schema_rejected";
    usage: AgentStopV3Usage;
    outcome: "finished" | "failed";
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV3Loop;
  } | {
    turn: AgentStopV3Turn;
    did_work: boolean;
    cause: "agent_crashed";
    usage: AgentStopV3Usage;
    outcome: "finished" | "failed";
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV3Loop;
  } | {
    turn: AgentStopV3Turn;
    did_work: boolean;
    cause: "timed_out";
    usage: AgentStopV3Usage;
    outcome: "finished" | "failed";
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV3Loop;
  } | {
    turn: AgentStopV3Turn;
    did_work: boolean;
    cause: "unknown";
    usage: AgentStopV3Usage;
    outcome: "finished" | "failed";
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV3Loop;
  };
  evidence?: Array<string>;
}

/** answer.refused@1 */
export interface AnswerRefused {
  v: 1;
  id: string;
  kind: "answer.refused";
  subject: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    outcome: "answered" | "decided_for_you" | "escalated" | "defaulted" | "unanswerable" | "cancelled" | "superseded" | "moot" | "unanswered";
    closed_at: number;
    via: "card" | "inbox";
    option: string | null;
  };
  evidence?: Array<string>;
}

/** archive.quiet@1 */
export interface ArchiveQuiet {
  v: 1;
  id: string;
  kind: "archive.quiet";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    agent: string;
    last: number;
  };
  evidence?: Array<string>;
}

/** ask.answered@1 */
export interface AskAnswered {
  v: 1;
  id: string;
  kind: "ask.answered";
  subject: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    answer: string;
    plan_hash: string | null;
    decision: "allow" | "deny" | "none";
  };
  evidence?: Array<string>;
}

export type AskAnsweredV2PinnedTo = {
  kind: "commit";
  ref: string;
} | {
  kind: "doc_revision";
  ref: string;
} | {
  kind: "evidence";
  ref: string;
};

/** ask.answered@2 */
export interface AskAnsweredV2 {
  v: 2;
  id: string;
  kind: "ask.answered";
  subject: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    answer: string;
    plan_hash: string | null;
    decision: "allow" | "deny" | "none";
    via: "card" | "inbox" | "session";
    verified: boolean;
    on: AskAnsweredV2PinnedTo;
    token: string | null;
  };
  evidence?: Array<string>;
}

/** ask.batched@1 */
export interface AskBatched {
  v: 1;
  id: string;
  kind: "ask.batched";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    batch: string;
    asks: Array<{
      ask: string;
      plan_hash: string | null;
    }>;
  };
  evidence?: Array<string>;
}

/** ask.cancelled@1 */
export interface AskCancelled {
  v: 1;
  id: string;
  kind: "ask.cancelled";
  subject: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    answer: string;
    plan_hash: string | null;
    decision: "allow" | "deny" | "none";
  };
  evidence?: Array<string>;
}

export type AskCreatedPinnedTo = {
  kind: "commit";
  ref: string;
} | {
  kind: "doc_revision";
  ref: string;
} | {
  kind: "evidence";
  ref: string;
};

export type AskCreatedOptions = Array<{
  id: string;
  label: string;
  decision: "allow" | "deny" | "none";
}>;

/** ask.created@1 */
export interface AskCreated {
  v: 1;
  id: string;
  kind: "ask.created";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    kind: "authority";
    question: string;
    options: AskCreatedOptions;
    recommended: string | null;
    deadline: number;
    fallback: string;
    default: string;
    provisional: boolean;
    owner: string;
    key: string;
    pinned_to: AskCreatedPinnedTo;
  } | {
    kind: "unblock";
    question: string;
    options: AskCreatedOptions;
    recommended: string | null;
    deadline: number;
    fallback: string;
    default: string;
    provisional: boolean;
    owner: string;
    key: string;
    pinned_to: AskCreatedPinnedTo;
    steps: Array<string>;
    where: string;
    why: string;
    unblocks: Array<string>;
    proves: string;
  } | {
    kind: "taste";
    question: string;
    options: AskCreatedOptions;
    recommended: string | null;
    deadline: number;
    fallback: string;
    default: string;
    provisional: boolean;
    owner: string;
    key: string;
    pinned_to: AskCreatedPinnedTo;
  } | {
    kind: "exception";
    question: string;
    options: AskCreatedOptions;
    recommended: string | null;
    deadline: number;
    fallback: string;
    default: string;
    provisional: boolean;
    owner: string;
    key: string;
    pinned_to: AskCreatedPinnedTo;
  } | {
    kind: "choice";
    question: string;
    options: AskCreatedOptions;
    recommended: string | null;
    deadline: number;
    fallback: string;
    default: string;
    provisional: boolean;
    owner: string;
    key: string;
    pinned_to: AskCreatedPinnedTo;
  } | {
    kind: "definition";
    question: string;
    options: AskCreatedOptions;
    recommended: string | null;
    deadline: number;
    fallback: string;
    default: string;
    provisional: boolean;
    owner: string;
    key: string;
    pinned_to: AskCreatedPinnedTo;
  };
  evidence?: Array<string>;
}

export type AskCreatedV2PinnedTo = {
  kind: "commit";
  ref: string;
} | {
  kind: "doc_revision";
  ref: string;
} | {
  kind: "evidence";
  ref: string;
};

export type AskCreatedV2Options = Array<{
  id: string;
  label: string;
  decision: "allow" | "deny" | "none";
}>;

/** ask.created@2 */
export interface AskCreatedV2 {
  v: 2;
  id: string;
  kind: "ask.created";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    kind: "authority";
    question: string;
    options: AskCreatedV2Options;
    recommended: string | null;
    deadline: number;
    fallback: string;
    default: string;
    provisional: boolean;
    owner: string;
    key: string;
    pinned_to: AskCreatedV2PinnedTo;
  } | {
    kind: "unblock";
    question: string;
    options: AskCreatedV2Options;
    recommended: string | null;
    deadline: number;
    fallback: string;
    default: string;
    provisional: boolean;
    owner: string;
    key: string;
    pinned_to: AskCreatedV2PinnedTo;
    steps: Array<string>;
    where: string;
    why: string;
    unblocks: Array<string>;
    proves: string;
  } | {
    kind: "taste";
    question: string;
    options: AskCreatedV2Options;
    recommended: string | null;
    deadline: number;
    fallback: string;
    default: string;
    provisional: boolean;
    owner: string;
    key: string;
    pinned_to: AskCreatedV2PinnedTo;
    dropped?: Array<{
      option: string;
      same_as: string;
    }>;
  } | {
    kind: "exception";
    question: string;
    options: AskCreatedV2Options;
    recommended: string | null;
    deadline: number;
    fallback: string;
    default: string;
    provisional: boolean;
    owner: string;
    key: string;
    pinned_to: AskCreatedV2PinnedTo;
  } | {
    kind: "choice";
    question: string;
    options: AskCreatedV2Options;
    recommended: string | null;
    deadline: number;
    fallback: string;
    default: string;
    provisional: boolean;
    owner: string;
    key: string;
    pinned_to: AskCreatedV2PinnedTo;
  } | {
    kind: "definition";
    question: string;
    options: AskCreatedV2Options;
    recommended: string | null;
    deadline: number;
    fallback: string;
    default: string;
    provisional: boolean;
    owner: string;
    key: string;
    pinned_to: AskCreatedV2PinnedTo;
  };
  evidence?: Array<string>;
}

export type AskCreatedV3PinnedTo = {
  kind: "commit";
  ref: string;
} | {
  kind: "doc_revision";
  ref: string;
} | {
  kind: "evidence";
  ref: string;
};

export type AskCreatedV3Options = Array<{
  id: string;
  label: string;
  decision: "allow" | "deny" | "none";
}>;

/** ask.created@3 */
export interface AskCreatedV3 {
  v: 3;
  id: string;
  kind: "ask.created";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    kind: "authority";
    question: string;
    options: AskCreatedV3Options;
    recommended: string | null;
    deadline: number;
    fallback: string;
    default: string;
    provisional: boolean;
    owner: string;
    key: string;
    pinned_to: AskCreatedV3PinnedTo;
  } | {
    kind: "unblock";
    question: string;
    options: AskCreatedV3Options;
    recommended: string | null;
    deadline: number;
    fallback: string;
    default: string;
    provisional: boolean;
    owner: string;
    key: string;
    pinned_to: AskCreatedV3PinnedTo;
    steps: Array<string>;
    where: string;
    why: string;
    unblocks: Array<string>;
    proves: string;
    cost_usd?: number;
  } | {
    kind: "taste";
    question: string;
    options: AskCreatedV3Options;
    recommended: string | null;
    deadline: number;
    fallback: string;
    default: string;
    provisional: boolean;
    owner: string;
    key: string;
    pinned_to: AskCreatedV3PinnedTo;
    dropped?: Array<{
      option: string;
      same_as: string;
    }>;
  } | {
    kind: "exception";
    question: string;
    options: AskCreatedV3Options;
    recommended: string | null;
    deadline: number;
    fallback: string;
    default: string;
    provisional: boolean;
    owner: string;
    key: string;
    pinned_to: AskCreatedV3PinnedTo;
  } | {
    kind: "choice";
    question: string;
    options: AskCreatedV3Options;
    recommended: string | null;
    deadline: number;
    fallback: string;
    default: string;
    provisional: boolean;
    owner: string;
    key: string;
    pinned_to: AskCreatedV3PinnedTo;
  } | {
    kind: "definition";
    question: string;
    options: AskCreatedV3Options;
    recommended: string | null;
    deadline: number;
    fallback: string;
    default: string;
    provisional: boolean;
    owner: string;
    key: string;
    pinned_to: AskCreatedV3PinnedTo;
  };
  evidence?: Array<string>;
}

/** ask.defaulted@1 */
export interface AskDefaulted {
  v: 1;
  id: string;
  kind: "ask.defaulted";
  subject: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    answer: string;
    plan_hash: string | null;
    decision: "allow" | "deny" | "none";
  };
  evidence?: Array<string>;
}

/** ask.escalated@1 */
export interface AskEscalated {
  v: 1;
  id: string;
  kind: "ask.escalated";
  subject: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    answer: string;
    plan_hash: string | null;
    decision: "allow" | "deny" | "none";
  };
  evidence?: Array<string>;
}

/** ask.later@1 */
export interface AskLater {
  v: 1;
  id: string;
  kind: "ask.later";
  subject: string;
  writer: "app" | "cli" | "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    until: number;
  };
  evidence?: Array<string>;
}

/** ask.moot@1 */
export interface AskMoot {
  v: 1;
  id: string;
  kind: "ask.moot";
  subject: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    because: "check_passed";
    verdict: string;
  } | {
    because: "attempt_replaced";
    session: string;
  };
  evidence?: Array<string>;
}

export type AskSourcesPinnedTo = {
  kind: "commit";
  ref: string;
} | {
  kind: "doc_revision";
  ref: string;
} | {
  kind: "evidence";
  ref: string;
};

export type AskSourcesOptions = Array<{
  id: string;
  label: string;
  decision: "allow" | "deny" | "none";
}>;

export type AskSourcesAsk = {
  kind: "authority";
  question: string;
  options: AskSourcesOptions;
  recommended: string | null;
  deadline: number;
  fallback: string;
  default: string;
  provisional: boolean;
  owner: string;
  key: string;
  pinned_to: AskSourcesPinnedTo;
} | {
  kind: "unblock";
  question: string;
  options: AskSourcesOptions;
  recommended: string | null;
  deadline: number;
  fallback: string;
  default: string;
  provisional: boolean;
  owner: string;
  key: string;
  pinned_to: AskSourcesPinnedTo;
  steps: Array<string>;
  where: string;
  why: string;
  unblocks: Array<string>;
  proves: string;
} | {
  kind: "taste";
  question: string;
  options: AskSourcesOptions;
  recommended: string | null;
  deadline: number;
  fallback: string;
  default: string;
  provisional: boolean;
  owner: string;
  key: string;
  pinned_to: AskSourcesPinnedTo;
} | {
  kind: "exception";
  question: string;
  options: AskSourcesOptions;
  recommended: string | null;
  deadline: number;
  fallback: string;
  default: string;
  provisional: boolean;
  owner: string;
  key: string;
  pinned_to: AskSourcesPinnedTo;
} | {
  kind: "choice";
  question: string;
  options: AskSourcesOptions;
  recommended: string | null;
  deadline: number;
  fallback: string;
  default: string;
  provisional: boolean;
  owner: string;
  key: string;
  pinned_to: AskSourcesPinnedTo;
} | {
  kind: "definition";
  question: string;
  options: AskSourcesOptions;
  recommended: string | null;
  deadline: number;
  fallback: string;
  default: string;
  provisional: boolean;
  owner: string;
  key: string;
  pinned_to: AskSourcesPinnedTo;
};

/** ask.sources@1 */
export type AskSources = Array<{
  source: string;
  kind: "authority" | "unblock" | "taste" | "exception" | "choice" | "definition";
  fixture: {
    ask: AskSourcesAsk;
    at_deadline: {
      decision: "allow" | "deny" | "none";
    };
  };
}>;

/** ask.superseded@1 */
export interface AskSuperseded {
  v: 1;
  id: string;
  kind: "ask.superseded";
  subject: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    by: string;
  };
  evidence?: Array<string>;
}

/** capability.refused@1 */
export interface CapabilityRefused {
  v: 1;
  id: string;
  kind: "capability.refused";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    call: string;
    broke: "grant" | "quota" | "schema";
    clause: string;
    digest: string;
  };
  evidence?: Array<string>;
}

/** check.code@1 */
export type CheckCode = "exit_masked" | "no_tests_ran" | "crashed_before_first_assertion" | "reported_after_deadline" | "output_dropped" | "type_error_as_assertion";

/** check@1 */
export interface Check {
  kind: "validity" | "command" | "journey" | "review" | "numbers" | "docs" | "draft" | "narrowing" | "document" | "physics_golden" | "media";
  runner: string;
  inputs: Array<string>;
  depth: string;
  oracle: "code" | "model" | "person";
  contract: string | null;
}

/** ci.archived@1 */
export interface CiArchived {
  v: 1;
  id: string;
  kind: "ci.archived";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    repo: string;
    run: string;
    result: string;
    logs: Array<{
      job: string;
      evidence: string;
    }>;
  };
  evidence?: Array<string>;
}

/** claim.made@1 */
export interface ClaimMade {
  v: 1;
  id: string;
  kind: "claim.made";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    task_ref: string;
    attempt: number;
    commit: string;
    scope: "session" | "child" | "task";
  };
  evidence?: Array<string>;
}

/** claim.made@2 */
export interface ClaimMadeV2 {
  v: 2;
  id: string;
  kind: "claim.made";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    task_ref: string;
    attempt: number;
    commit: string;
    scope: "session" | "child" | "task";
    predictions: Array<{
      check: string;
      expects: "passed" | "failed";
      at: number;
    }>;
  };
  evidence?: Array<string>;
}

/** claim.sent_back@1 */
export interface ClaimSentBack {
  v: 1;
  id: string;
  kind: "claim.sent_back";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    claim: string;
    verdict: string;
    round: number;
    to: string;
  };
  evidence?: Array<string>;
}

/** claim.stalled@1 */
export interface ClaimStalled {
  v: 1;
  id: string;
  kind: "claim.stalled";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    claim: string;
    rule: string;
  };
  evidence?: Array<string>;
}

/** commit.made@1 */
export interface CommitMade {
  v: 1;
  id: string;
  kind: "commit.made";
  subject: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    sha: string;
    worktree: string;
    branch: string | null;
  };
  evidence?: Array<string>;
}

/** decision.applied@1 */
export interface DecisionApplied {
  v: 1;
  id: string;
  kind: "decision.applied";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    decision: string;
    ask: string;
  };
  evidence?: Array<string>;
}

/** decision.created@1 */
export interface DecisionCreated {
  v: 1;
  id: string;
  kind: "decision.created";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    key: string;
    scope: string;
    answer: string;
    ask: string;
  };
  evidence?: Array<string>;
}

/** decision.overruled@1 */
export interface DecisionOverruled {
  v: 1;
  id: string;
  kind: "decision.overruled";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    decision: string;
  };
  evidence?: Array<string>;
}

/** decision.revoked@1 */
export interface DecisionRevoked {
  v: 1;
  id: string;
  kind: "decision.revoked";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    decision: string;
  };
  evidence?: Array<string>;
}

/** default.undone@1 */
export interface DefaultUndone {
  v: 1;
  id: string;
  kind: "default.undone";
  subject: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    deadline: number;
  };
  evidence?: Array<string>;
}

/** definition.drafted@1 */
export interface DefinitionDrafted {
  v: 1;
  id: string;
  kind: "definition.drafted";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    definition: string;
    task_ref: string;
    requirements: Array<{
      id: string;
      text: string;
      checks: Array<string>;
      oracle: "code" | "model" | "person";
      depth: string;
    }>;
    hash: string;
    base_commit: string;
    budget: {
      runs: number;
      cap_usd: number;
    } | null;
  };
  evidence?: Array<string>;
}

/** definition.locked@1 */
export interface DefinitionLocked {
  v: 1;
  id: string;
  kind: "definition.locked";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    definition: string;
    task_ref: string;
    requirements: Array<{
      id: string;
      text: string;
      checks: Array<string>;
      oracle: "code" | "model" | "person";
      depth: string;
    }>;
    hash: string;
    base_commit: string;
    budget: {
      runs: number;
      cap_usd: number;
    } | null;
  };
  evidence?: Array<string>;
}

/** definition.revised@1 */
export interface DefinitionRevised {
  v: 1;
  id: string;
  kind: "definition.revised";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    definition: string;
    task_ref: string;
    requirements: Array<{
      id: string;
      text: string;
      checks: Array<string>;
      oracle: "code" | "model" | "person";
      depth: string;
    }>;
    hash: string;
    base_commit: string;
    budget: {
      runs: number;
      cap_usd: number;
    } | null;
    dispute_ask: string;
  };
  evidence?: Array<string>;
}

/** delivery.outcome@1 */
export interface DeliveryOutcome {
  v: 1;
  id: string;
  kind: "delivery.outcome";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    delivery: string;
    via: "steer" | "interrupt" | "stop_hold" | "next_prompt";
    outcome: "delivered" | "stalled" | "timed_out" | "replaced";
  };
  evidence?: Array<string>;
}

/** doc.patched@1 */
export interface DocPatched {
  v: 1;
  id: string;
  kind: "doc.patched";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    doc: string;
    rev: number;
    patch: string;
    writer: "you" | "shell" | "record" | "agent" | "plugin";
    achieved: {
      created: { [key: string]: number };
      updated: number;
      deleted: { [key: string]: number };
      unchanged: boolean;
    };
  };
  evidence?: Array<string>;
}

/** doctor.item@1 */
export interface DoctorItem {
  code: "healthy" | "binary_missing" | "version_uncovered" | "hooks_missing" | "hooks_disabled" | "hooks_untrusted" | "mcp_unregistered" | "statusline_missing" | "signed_out" | "nested_session" | "timing_relation_broken" | "telemetry_unreadable" | "not_checked" | "hub_unreachable" | "disk_low" | "ports_taken" | "billing_api_key" | "binary_differs" | "token_expiring" | "prompt_failed" | "unknown";
  level: "ok" | "warn" | "fail" | "skip";
  evidence: string;
  fix: string;
}

/** error@1 */
export interface Error {
  code: "unknown_schema" | "not_json" | "type" | "required" | "unlisted_field" | "enum" | "const" | "pattern" | "format" | "length" | "range" | "union" | "uncatalogued_kind" | "handle_syntax" | "handle_scheme" | "digest_algorithm";
  retryable: boolean;
  remediation: string;
  path: string;
  actual: string;
  evidence: Array<string>;
}

/** error@2 */
export interface ErrorV2 {
  code: "unknown_schema" | "not_json" | "type" | "required" | "unlisted_field" | "enum" | "const" | "pattern" | "format" | "length" | "range" | "union" | "uncatalogued_kind" | "handle_syntax" | "handle_scheme" | "digest_algorithm" | "role" | "credential" | "unknown_method" | "not_found" | "unconfirmed" | "unbound" | "unavailable" | "too_large";
  retryable: boolean;
  remediation: string;
  path: string;
  actual: string;
  evidence: Array<string>;
}

/** error@3 */
export interface ErrorV3 {
  code: "unknown_schema" | "not_json" | "type" | "required" | "unlisted_field" | "enum" | "const" | "pattern" | "format" | "length" | "range" | "union" | "uncatalogued_kind" | "handle_syntax" | "handle_scheme" | "digest_algorithm" | "role" | "credential" | "unknown_method" | "not_found" | "unconfirmed" | "unbound" | "unavailable" | "too_large" | "fell_behind";
  retryable: boolean;
  remediation: string;
  path: string;
  actual: string;
  evidence: Array<string>;
}

/** evidence.put@1 */
export interface EvidencePut {
  v: 1;
  id: string;
  kind: "evidence.put";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    sha256: string;
    kind: string;
    source: string;
    origin: "deepbuild" | "you" | "agent";
    redaction: "complete" | "incomplete" | "unknown";
    license: string;
    step_times: Array<{
      step: string;
      start_ms: number;
      end_ms: number;
    }>;
  };
  evidence?: Array<string>;
}

/** evidence.removed@1 */
export interface EvidenceRemoved {
  v: 1;
  id: string;
  kind: "evidence.removed";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    sha256: string;
  };
  evidence?: Array<string>;
}

/** evidence.stored@1 */
export interface EvidenceStored {
  v: 1;
  id: string;
  kind: "evidence.stored";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    sha256: string;
    kind: string;
    type: "png" | "jpeg" | "mp4" | "text" | "binary";
    size: number;
    origin: "deepbuild" | "you" | "agent";
    redaction: "complete" | "incomplete" | "unknown";
    license: string;
    derived_from: Array<string>;
    step_times: Array<{
      step: string;
      start_ms: number;
      end_ms: number;
    }>;
  };
  evidence?: Array<string>;
}

/** exit.code@1 */
export type ExitCode = "0" | "1" | "2" | "3";

/** extension.edges@1 */
export interface ExtensionEdges {
  conflicts?: Array<string>;
  kernel?: Array<string>;
}

/** extension.manifest@1 */
export interface ExtensionManifest {
  id: string;
  version: string;
  digest: string;
  publisher_key?: string;
  access?: {
    words: Array<string>;
  };
  panels?: Array<{
    name: string;
    area: "sidebar" | "home" | "tab" | "line";
    media?: Array<"sound" | "microphone" | "camera">;
  }>;
  provides?: Array<{
    interface: string;
    kind: "reading" | "action" | "notice" | "view" | "check";
    minor: number;
  }>;
  uses?: Array<{
    interface: string;
    minor: number;
    digest: string;
  }>;
  replaces?: Array<string>;
  events?: Array<string>;
  stores?: Array<string>;
  checks?: Array<string>;
  codes?: Array<string>;
  notices?: Array<string>;
  actions?: Array<string>;
}

/** guard@1 */
export interface Guard {
  match: string;
  scope: string;
  mode: "watch" | "warn" | "block";
  reason: string;
  next_step: string;
  fail_closed: boolean;
}

/** hook.ack@1 */
export interface HookAck {
  ack: string;
  hold_until_ms: number | null;
}

/** hook.ack@2 */
export interface HookAckV2 {
  v: 1;
  ack: string;
  hold_until_ms: number | null;
}

/** hook.joined@1 */
export interface HookJoined {
  order: Array<string>;
  bound: number;
  denies: Array<{
    extension: string;
    reason: string;
  }>;
  context: Array<{
    extension: string;
    text: string;
  }>;
}

/** hook.reply@1 */
export interface HookReply {
  exit: number;
  stdout: string;
  stderr: string;
}

/** hook.reply@2 */
export interface HookReplyV2 {
  v: 1;
  exit: number;
  stdout: string;
  stderr: string;
}

/** hook.request@1 */
export interface HookRequest {
  v: 1;
  agent: string;
  event: string;
  seq: bigint;
  id: string;
  pid: number;
  ppid: number;
  matched: Array<string>;
  payload: unknown;
}

/** hook.request@2 */
export interface HookRequestV2 {
  v: 1;
  agent: string;
  event: string;
  seq: bigint;
  id: string;
  pid: number;
  ppid: number;
  matched: Array<string>;
  payload: unknown;
  late?: boolean;
  billing?: { [key: string]: boolean };
}

/** hook.request@3 */
export interface HookRequestV3 {
  v: 1;
  agent: string;
  event: string;
  seq: bigint;
  id: string;
  pid: number;
  ppid: number;
  matched: Array<string>;
  notes?: { [key: string]: string };
  payload: unknown;
  late?: boolean;
  billing?: { [key: string]: boolean };
}

/** hook.template@1 */
export interface HookTemplate {
  name: string;
  hook: "session.start" | "tool.before" | "tool.after" | "prompt.submit" | "agent.stop";
  text: string;
  fields: { [key: string]: {
    type: "handle";
  } | {
    type: "number";
  } | {
    type: "name";
  } | {
    type: "one_of";
    values: Array<string>;
  } };
}

/** hub.stopped@1 */
export interface HubStopped {
  v: 1;
  id: string;
  kind: "hub.stopped";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    reason: string;
  };
  evidence?: Array<string>;
}

/** job.ended@1 */
export interface JobEnded {
  v: 1;
  id: string;
  kind: "job.ended";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    job: string;
    state: string;
    refused?: string;
    cause?: string;
    session?: string;
    model?: string;
    binary?: {
      path: string;
      version: string;
    };
    usage?: {
      input: number;
      cached: number;
      output: number;
    };
    cost_usd?: number;
    lingered?: Array<string>;
    from?: number;
    to?: number;
  };
  evidence?: Array<string>;
}

/** job.event@1 */
export interface JobEvent {
  v: 1;
  id: string;
  kind: "job.event";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    job: string;
    event: string;
  };
  evidence?: Array<string>;
}

/** job.recorded@1 */
export interface JobRecorded {
  v: 1;
  id: string;
  kind: "job.recorded";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    job: string;
    kind: string;
    agent: string;
    account: string | null;
    folder: string;
    prompt: string;
    waiting: Array<string>;
  };
  evidence?: Array<string>;
}

/** layer.rows@1 */
export interface LayerRows {
  v: 1;
  id: string;
  kind: "layer.rows";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    layer: string;
    project: string;
    parent: string | null;
    level: number;
    file: string;
  };
  evidence?: Array<string>;
}

export type LearnAppliedEvidence = Array<{
  at: string;
  quote: string;
}>;

export type LearnAppliedReplay = {
  tasks: number;
  regressions: number;
} | null;

export type LearnAppliedSupersedes = string | null;

/** learn.applied@1 */
export interface LearnApplied {
  v: 1;
  id: string;
  kind: "learn.applied";
  subject?: string;
  writer: "app" | "cli" | "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    layer: "learned";
    target: string;
    diff: string;
    evidence: LearnAppliedEvidence;
    scope: string;
    replay: LearnAppliedReplay;
    applied_by: string;
    supersedes: LearnAppliedSupersedes;
  } | {
    layer: "base";
    target: string;
    diff: string;
    evidence: LearnAppliedEvidence;
    scope: string;
    replay: LearnAppliedReplay;
    applied_by: string;
    supersedes: LearnAppliedSupersedes;
  };
  evidence?: Array<string>;
}

export type LearnProposedEvidence = Array<{
  at: string;
  quote: string;
}>;

export type LearnProposedReplay = {
  tasks: number;
  regressions: number;
} | null;

export type LearnProposedSupersedes = string | null;

/** learn.proposed@1 */
export interface LearnProposed {
  v: 1;
  id: string;
  kind: "learn.proposed";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    layer: "learned";
    target: string;
    diff: string;
    evidence: LearnProposedEvidence;
    scope: string;
    replay: LearnProposedReplay;
    applied_by: string | null;
    supersedes: LearnProposedSupersedes;
  } | {
    layer: "base";
    target: string;
    diff: string;
    evidence: LearnProposedEvidence;
    scope: string;
    replay: LearnProposedReplay;
    applied_by: string;
    supersedes: LearnProposedSupersedes;
  };
  evidence?: Array<string>;
}

export type LearnRolledBackEvidence = Array<{
  at: string;
  quote: string;
}>;

export type LearnRolledBackReplay = {
  tasks: number;
  regressions: number;
} | null;

export type LearnRolledBackSupersedes = string | null;

/** learn.rolled_back@1 */
export interface LearnRolledBack {
  v: 1;
  id: string;
  kind: "learn.rolled_back";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    layer: "learned";
    target: string;
    diff: string;
    evidence: LearnRolledBackEvidence;
    scope: string;
    replay: LearnRolledBackReplay;
    applied_by: string | null;
    supersedes: LearnRolledBackSupersedes;
  } | {
    layer: "base";
    target: string;
    diff: string;
    evidence: LearnRolledBackEvidence;
    scope: string;
    replay: LearnRolledBackReplay;
    applied_by: string;
    supersedes: LearnRolledBackSupersedes;
  };
  evidence?: Array<string>;
}

export type LearnWidenedEvidence = Array<{
  at: string;
  quote: string;
}>;

export type LearnWidenedReplay = {
  tasks: number;
  regressions: number;
} | null;

export type LearnWidenedSupersedes = string | null;

/** learn.widened@1 */
export interface LearnWidened {
  v: 1;
  id: string;
  kind: "learn.widened";
  subject?: string;
  writer: "app" | "cli" | "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    layer: "learned";
    target: string;
    diff: string;
    evidence: LearnWidenedEvidence;
    scope: string;
    replay: LearnWidenedReplay;
    applied_by: string;
    supersedes: LearnWidenedSupersedes;
  } | {
    layer: "base";
    target: string;
    diff: string;
    evidence: LearnWidenedEvidence;
    scope: string;
    replay: LearnWidenedReplay;
    applied_by: string;
    supersedes: LearnWidenedSupersedes;
  };
  evidence?: Array<string>;
}

/** learn_check.made@1 */
export interface LearnCheckMade {
  v: 1;
  id: string;
  kind: "learn_check.made";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    change: string;
    reason: string;
  };
  evidence?: Array<string>;
}

/** lease.acquired@1 */
export interface LeaseAcquired {
  v: 1;
  id: string;
  kind: "lease.acquired";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    resource: {
      host: string;
      kind: string;
      key: string;
    };
    holder: string;
    mode: "exclusive" | "shared";
    expires: number;
  };
  evidence?: Array<string>;
}

/** lease.acquired@2 */
export interface LeaseAcquiredV2 {
  v: 2;
  id: string;
  kind: "lease.acquired";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    resource: {
      host: string;
      kind: string;
      key: string;
    };
    holder: string;
    mode: "exclusive" | "shared";
    expires: number;
    run?: string;
    agent?: {
      pid: number;
      start: string;
    };
  };
  evidence?: Array<string>;
}

/** lease.denied@1 */
export interface LeaseDenied {
  v: 1;
  id: string;
  kind: "lease.denied";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    resource: {
      host: string;
      kind: string;
      key: string;
    };
    holder: string;
    mode: "exclusive" | "shared";
    expires: number;
  };
  evidence?: Array<string>;
}

/** lease.kind@1 */
export interface LeaseKind {
  name: string;
  match: string;
  cap: number;
  cooldown: number;
  cost: number;
}

/** lease.released@1 */
export interface LeaseReleased {
  v: 1;
  id: string;
  kind: "lease.released";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    resource: {
      host: string;
      kind: string;
      key: string;
    };
    holder: string;
    mode: "exclusive" | "shared";
    expires: number;
  };
  evidence?: Array<string>;
}

/** lease.released@2 */
export interface LeaseReleasedV2 {
  v: 2;
  id: string;
  kind: "lease.released";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    resource: {
      host: string;
      kind: string;
      key: string;
    };
    holder: string;
    mode: "exclusive" | "shared";
    expires: number;
    proof: Array<string>;
  };
  evidence?: Array<string>;
}

/** lease.stale@1 */
export interface LeaseStale {
  v: 1;
  id: string;
  kind: "lease.stale";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    resource: {
      host: string;
      kind: string;
      key: string;
    };
    holder: string;
    mode: "exclusive" | "shared";
    expires: number;
  };
  evidence?: Array<string>;
}

/** merge.dry_run@1 */
export interface MergeDryRun {
  v: 1;
  id: string;
  kind: "merge.dry_run";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    a: string;
    b: string;
    conflicts: Array<string>;
  };
  evidence?: Array<string>;
}

/** note.closed@1 */
export interface NoteClosed {
  v: 1;
  id: string;
  kind: "note.closed";
  subject?: string;
  writer: "core" | "app";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    note: string;
    by: "you" | "check";
    rev: number;
    run: string | null;
  };
  evidence?: Array<string>;
}

/** note.opened@1 */
export interface NoteOpened {
  v: 1;
  id: string;
  kind: "note.opened";
  subject?: string;
  writer: "app";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    note: string;
    doc: string;
    item: string;
    rev: number;
    t?: string;
    region: {
      x: number;
      y: number;
      w: number;
      h: number;
    };
    text: string;
  };
  evidence?: Array<string>;
}

/** notice.sent@1 */
export interface NoticeSent {
  v: 1;
  id: string;
  kind: "notice.sent";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    notice: string;
    cites: Array<string>;
  };
  evidence?: Array<string>;
}

/** notice.subscribed@1 */
export interface NoticeSubscribed {
  v: 1;
  id: string;
  kind: "notice.subscribed";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    notice_kind: string;
    key: string;
    by: string;
  };
  evidence?: Array<string>;
}

/** open_item.closed@1 */
export interface OpenItemClosed {
  v: 1;
  id: string;
  kind: "open_item.closed";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    task_ref: string;
    text: string;
  };
  evidence?: Array<string>;
}

/** open_item.opened@1 */
export interface OpenItemOpened {
  v: 1;
  id: string;
  kind: "open_item.opened";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    task_ref: string;
    text: string;
  };
  evidence?: Array<string>;
}

/** package.envelope@1 */
export interface PackageEnvelope {
  id: string;
  version: string;
  digest: string;
  publisher_key?: string;
}

/** package.signature@1 */
export interface PackageSignature {
  signature: string;
}

/** permission.answer@1 */
export interface PermissionAnswer {
  decision: "allow" | "deny" | "cancel";
  for: "call" | "session";
  input?: unknown;
}

/** permission.request@1 */
export interface PermissionRequest {
  v: 1;
  id: string;
  kind: "permission.request";
  subject: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    kind: "tool" | "plan" | "question" | "mode";
    tool?: string;
    command?: string | null;
    paths?: Array<string>;
  };
  evidence?: Array<string>;
}

/** plan.proposed@1 */
export interface PlanProposed {
  v: 1;
  id: string;
  kind: "plan.proposed";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    ask: string;
    steps: Array<{
      does: string;
      changes: Array<string>;
      undo: string;
      public: boolean;
      cost: number;
    }>;
    diff: string;
    hash: string;
  };
  evidence?: Array<string>;
}

/** pr.merged@1 */
export interface PrMerged {
  v: 1;
  id: string;
  kind: "pr.merged";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    pr: number;
    merge_sha: string;
  };
  evidence?: Array<string>;
}

/** process.ended@1 */
export interface ProcessEnded {
  v: 1;
  id: string;
  kind: "process.ended";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    run: string;
    pid: number;
  };
  evidence?: Array<string>;
}

/** process.starting@1 */
export interface ProcessStarting {
  v: 1;
  id: string;
  kind: "process.starting";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    run: string;
    cwd: string;
  };
  evidence?: Array<string>;
}

/** process.tracked@1 */
export interface ProcessTracked {
  v: 1;
  id: string;
  kind: "process.tracked";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    run: string;
    pid: number;
    start: string;
    pgid: number;
    cwd: string;
    token: string | null;
  };
  evidence?: Array<string>;
}

/** reading.answer@1 */
export interface ReadingAnswer {
  findings: Array<{
    text: string;
    cites: Array<{
      at: string;
      quote: string;
    }>;
  }>;
}

/** reading.batch@1 */
export interface ReadingBatch {
  v: 1;
  id: string;
  kind: "reading.batch";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    source: string;
    as_of: number;
    file: string;
  };
  evidence?: Array<string>;
}

/** reading.dropped@1 */
export interface ReadingDropped {
  v: 1;
  id: string;
  kind: "reading.dropped";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    reading: string;
    at: string;
    quote: string;
    reason: string;
  };
  evidence?: Array<string>;
}

/** reading.finished@1 */
export interface ReadingFinished {
  v: 1;
  id: string;
  kind: "reading.finished";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    reading: string;
    kind: "install" | "replay" | "premise" | "summary";
    runs: Array<string>;
    state: string;
    findings: number;
    dropped: number;
    undelivered: number;
    plan: {
      five_hour_pct: number;
    } | null;
    models: {
      final: string;
      subreads: Array<string>;
    };
    written: number;
    invalid?: string;
  };
  evidence?: Array<string>;
}

/** reading.recorded@1 */
export interface ReadingRecorded {
  v: 1;
  id: string;
  kind: "reading.recorded";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    reading: string;
    value: number;
    unit: string;
    as_of: number;
    source: string;
    n: number;
    outside: boolean;
  };
  evidence?: Array<string>;
}

/** reading.rollup@1 */
export interface ReadingRollup {
  v: 1;
  id: string;
  kind: "reading.rollup";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    source: string;
    span: "minute" | "hour";
    start: number;
    file: string;
  };
  evidence?: Array<string>;
}

/** reading.slice@1 */
export interface ReadingSlice {
  handle: string;
  covers: string;
  text: string;
  next?: string;
  messages?: Array<{
    at: string;
    role: string;
    outside: boolean;
    tool?: string;
    start: number;
    end: number;
  }>;
}

/** request.cost@1 */
export interface RequestCost {
  v: 1;
  id: string;
  kind: "request.cost";
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    model: string;
    request_id: string | null;
    cost: {
      basis: "reported";
      usd: number;
    };
    tokens: {
      input: number;
      cached: number;
      output: number;
      exact: boolean;
    };
    reading: string;
  };
  evidence?: Array<string>;
}

/** run.cleaned@1 */
export interface RunCleaned {
  v: 1;
  id: string;
  kind: "run.cleaned";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    run: string;
    outcome: "clean" | "unfinished";
    left: Array<string>;
    stopped: Array<number>;
  };
  evidence?: Array<string>;
}

/** run.finished@1 */
export interface RunFinished {
  v: 1;
  id: string;
  kind: "run.finished";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    run: string;
    outcome: "passed" | "failed" | "ran_nothing" | "missing" | "overran" | "stopped" | "uncounted";
    tests_run: number;
    passed: number;
    runs: number;
    evidence: Array<string>;
    check: string;
    assertion: string | null;
    expected: string | null;
    actual: string | null;
    step: string | null;
    points_to: string | null;
    findings: Array<string>;
    environment: string;
  };
  evidence?: Array<string>;
}

/** run.started@1 */
export interface RunStarted {
  v: 1;
  id: string;
  kind: "run.started";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    run: string;
    check: string;
    claim: string;
    commit: string;
  };
  evidence?: Array<string>;
}

/** sandbox.denied@1 */
export interface SandboxDenied {
  v: 1;
  id: string;
  kind: "sandbox.denied";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    run: string;
    operation: string;
    target: string;
  };
  evidence?: Array<string>;
}

/** session.attention@1 */
export interface SessionAttention {
  v: 1;
  id: string;
  kind: "session.attention";
  subject: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    state: "finished" | "failed" | "waiting_permission" | "unknown";
  };
  evidence?: Array<string>;
}

/** session.attention@2 */
export interface SessionAttentionV2 {
  v: 2;
  id: string;
  kind: "session.attention";
  subject: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    state: "working" | "waiting" | "stuck" | "finished" | "failed" | "unknown";
  };
  evidence?: Array<string>;
}

/** session.child_started@1 */
export interface SessionChildStarted {
  v: 1;
  id: string;
  kind: "session.child_started";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    parent: string;
    child: string;
    task_ref: string | null;
  };
  evidence?: Array<string>;
}

/** session.end@1 */
export interface SessionEnd {
  v: 1;
  id: string;
  kind: "session.end";
  subject?: string;
  writer: "hook";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    reason: string;
  };
  evidence?: Array<string>;
}

/** session.gone@1 */
export interface SessionGone {
  v: 1;
  id: string;
  kind: "session.gone";
  subject: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    pid: number;
    start: string;
  };
  evidence?: Array<string>;
}

/** session.reading@1 */
export interface SessionReading {
  v: 1;
  id: string;
  kind: "session.reading";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    reading: string;
  };
  evidence?: Array<string>;
}

/** session.start@1 */
export interface SessionStart {
  v: 1;
  id: string;
  kind: "session.start";
  subject?: string;
  writer: "hook";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    agent: string;
    worktree: string;
    branch: string | null;
    thread: string;
  };
  evidence?: Array<string>;
}

/** session.start@2 */
export interface SessionStartV2 {
  v: 2;
  id: string;
  kind: "session.start";
  subject?: string;
  writer: "hook";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    agent: string;
    worktree: string;
    branch: string | null;
    thread: string;
    billing?: { [key: string]: boolean };
  };
  evidence?: Array<string>;
}

/** session.start@3 */
export interface SessionStartV3 {
  v: 3;
  id: string;
  kind: "session.start";
  subject?: string;
  writer: "hook";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    agent: string;
    worktree: string;
    branch: string | null;
    thread: string;
    billing?: { [key: string]: boolean };
    loads: Array<{
      kind: "instructions" | "skill" | "hooks" | "mcp";
      name: string;
      source: string;
      digest: string;
      tools?: Array<string>;
    }>;
  };
  evidence?: Array<string>;
}

/** spend.approved@1 */
export interface SpendApproved {
  v: 1;
  id: string;
  kind: "spend.approved";
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    scope: {
      kind: "issue" | "resource" | "project" | "work";
      ref: string;
    };
    cap_usd: number;
    ends: number;
    via: "card" | "inbox";
  };
  evidence?: Array<string>;
}

/** spend.asked@1 */
export interface SpendAsked {
  v: 1;
  id: string;
  kind: "spend.asked";
  subject: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    run: string;
    check: string;
    inputs: string;
    issue: string;
    resource: string | null;
    usd: number;
    ask: string;
    because: "raise" | "rerun" | "uncovered";
    budgets: Array<string>;
  };
  evidence?: Array<string>;
}

/** spend.charged@1 */
export interface SpendCharged {
  v: 1;
  id: string;
  kind: "spend.charged";
  subject: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    run: string;
    usd: number;
  };
  evidence?: Array<string>;
}

/** spend.reserved@1 */
export interface SpendReserved {
  v: 1;
  id: string;
  kind: "spend.reserved";
  subject: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    run: string;
    check: string;
    inputs: string;
    issue: string;
    resource: string | null;
    budgets: Array<{
      budget: string;
      usd: number;
    }>;
    ask: string | null;
    decision: string | null;
  };
  evidence?: Array<string>;
}

/** spool.refused@1 */
export interface SpoolRefused {
  v: 1;
  id: string;
  kind: "spool.refused";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    file: string;
    offset: number;
    reason: string;
  };
  evidence?: Array<string>;
}

/** suggestion.filed@1 */
export interface SuggestionFiled {
  v: 1;
  id: string;
  kind: "suggestion.filed";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    suggestion: string;
    doc: string;
    item: string;
    writer: "you" | "shell" | "record" | "agent" | "plugin";
    patch: string;
    base: number;
    ops: Array<unknown>;
  };
  evidence?: Array<string>;
}

/** suggestion.settled@1 */
export interface SuggestionSettled {
  v: 1;
  id: string;
  kind: "suggestion.settled";
  subject?: string;
  writer: "app" | "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    suggestion: string;
    outcome: "accepted" | "superseded";
    rev: number;
  };
  evidence?: Array<string>;
}

/** task.closed@1 */
export interface TaskClosed {
  v: 1;
  id: string;
  kind: "task.closed";
  subject: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    by_verdict: string;
  };
  evidence?: Array<string>;
}

/** task.completed@1 */
export interface TaskCompleted {
  v: 1;
  id: string;
  kind: "task.completed";
  subject: string;
  writer: "hook";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    agent_task: string;
    title: string;
  };
  evidence?: Array<string>;
}

/** task.created@1 */
export interface TaskCreated {
  v: 1;
  id: string;
  kind: "task.created";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    task_ref: string;
    thread: string;
    owner: string;
    title: string;
  };
  evidence?: Array<string>;
}

/** tool.after@1 */
export interface ToolAfter {
  v: 1;
  id: string;
  kind: "tool.after";
  subject?: string;
  writer: "hook";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    kind: "shell";
    paths: Array<string>;
    command: string | null;
  } | {
    kind: "read";
    paths: Array<string>;
    command: string | null;
  } | {
    kind: "edit";
    paths: Array<string>;
    command: string | null;
  } | {
    kind: "write";
    paths: Array<string>;
    command: string | null;
  } | {
    kind: "search";
    paths: Array<string>;
    command: string | null;
  } | {
    kind: "fetch";
    paths: Array<string>;
    command: string | null;
  } | {
    kind: "mcp";
    paths: Array<string>;
    command: string | null;
    server: string;
    tool: string;
  } | {
    kind: "unknown";
    paths: Array<string>;
    command: string | null;
  };
  evidence?: Array<string>;
}

/** tool.after@2 */
export interface ToolAfterV2 {
  v: 2;
  id: string;
  kind: "tool.after";
  subject?: string;
  writer: "hook";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    kind: "shell";
    paths: Array<string>;
    command: string | null;
    call?: string;
    outcome: "ok" | "failed";
    exit_code?: number | null;
    signature?: string;
    cause?: "command_failed" | "tool_error" | "interrupted" | "permission_denied" | "unknown";
    owner?: "agent" | "you" | "service";
  } | {
    kind: "read";
    paths: Array<string>;
    command: string | null;
    call?: string;
    outcome: "ok" | "failed";
    exit_code?: number | null;
    signature?: string;
    cause?: "command_failed" | "tool_error" | "interrupted" | "permission_denied" | "unknown";
    owner?: "agent" | "you" | "service";
  } | {
    kind: "edit";
    paths: Array<string>;
    command: string | null;
    call?: string;
    outcome: "ok" | "failed";
    exit_code?: number | null;
    signature?: string;
    cause?: "command_failed" | "tool_error" | "interrupted" | "permission_denied" | "unknown";
    owner?: "agent" | "you" | "service";
  } | {
    kind: "write";
    paths: Array<string>;
    command: string | null;
    call?: string;
    outcome: "ok" | "failed";
    exit_code?: number | null;
    signature?: string;
    cause?: "command_failed" | "tool_error" | "interrupted" | "permission_denied" | "unknown";
    owner?: "agent" | "you" | "service";
  } | {
    kind: "search";
    paths: Array<string>;
    command: string | null;
    call?: string;
    outcome: "ok" | "failed";
    exit_code?: number | null;
    signature?: string;
    cause?: "command_failed" | "tool_error" | "interrupted" | "permission_denied" | "unknown";
    owner?: "agent" | "you" | "service";
  } | {
    kind: "fetch";
    paths: Array<string>;
    command: string | null;
    call?: string;
    outcome: "ok" | "failed";
    exit_code?: number | null;
    signature?: string;
    cause?: "command_failed" | "tool_error" | "interrupted" | "permission_denied" | "unknown";
    owner?: "agent" | "you" | "service";
  } | {
    kind: "mcp";
    paths: Array<string>;
    command: string | null;
    server: string;
    tool: string;
    call?: string;
    outcome: "ok" | "failed";
    exit_code?: number | null;
    signature?: string;
    cause?: "command_failed" | "tool_error" | "interrupted" | "permission_denied" | "unknown";
    owner?: "agent" | "you" | "service";
  } | {
    kind: "unknown";
    paths: Array<string>;
    command: string | null;
    call?: string;
    outcome: "ok" | "failed";
    exit_code?: number | null;
    signature?: string;
    cause?: "command_failed" | "tool_error" | "interrupted" | "permission_denied" | "unknown";
    owner?: "agent" | "you" | "service";
  };
  evidence?: Array<string>;
}

/** tool.before@1 */
export interface ToolBefore {
  v: 1;
  id: string;
  kind: "tool.before";
  subject?: string;
  writer: "hook";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    kind: "shell";
    paths: Array<string>;
    command: string | null;
  } | {
    kind: "read";
    paths: Array<string>;
    command: string | null;
  } | {
    kind: "edit";
    paths: Array<string>;
    command: string | null;
  } | {
    kind: "write";
    paths: Array<string>;
    command: string | null;
  } | {
    kind: "search";
    paths: Array<string>;
    command: string | null;
  } | {
    kind: "fetch";
    paths: Array<string>;
    command: string | null;
  } | {
    kind: "mcp";
    paths: Array<string>;
    command: string | null;
    server: string;
    tool: string;
  } | {
    kind: "unknown";
    paths: Array<string>;
    command: string | null;
  };
  evidence?: Array<string>;
}

/** tool.before@2 */
export interface ToolBeforeV2 {
  v: 2;
  id: string;
  kind: "tool.before";
  subject?: string;
  writer: "hook";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    kind: "shell";
    paths: Array<string>;
    command: string | null;
    late?: boolean;
    matched?: Array<string>;
  } | {
    kind: "read";
    paths: Array<string>;
    command: string | null;
    late?: boolean;
    matched?: Array<string>;
  } | {
    kind: "edit";
    paths: Array<string>;
    command: string | null;
    late?: boolean;
    matched?: Array<string>;
  } | {
    kind: "write";
    paths: Array<string>;
    command: string | null;
    late?: boolean;
    matched?: Array<string>;
  } | {
    kind: "search";
    paths: Array<string>;
    command: string | null;
    late?: boolean;
    matched?: Array<string>;
  } | {
    kind: "fetch";
    paths: Array<string>;
    command: string | null;
    late?: boolean;
    matched?: Array<string>;
  } | {
    kind: "mcp";
    paths: Array<string>;
    command: string | null;
    server: string;
    tool: string;
    late?: boolean;
    matched?: Array<string>;
  } | {
    kind: "unknown";
    paths: Array<string>;
    command: string | null;
    late?: boolean;
    matched?: Array<string>;
  };
  evidence?: Array<string>;
}

/** tool.before@3 */
export interface ToolBeforeV3 {
  v: 3;
  id: string;
  kind: "tool.before";
  subject?: string;
  writer: "hook";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    kind: "shell";
    paths: Array<string>;
    command: string | null;
    late?: boolean;
    matched?: Array<string>;
    call?: string;
  } | {
    kind: "read";
    paths: Array<string>;
    command: string | null;
    late?: boolean;
    matched?: Array<string>;
    call?: string;
  } | {
    kind: "edit";
    paths: Array<string>;
    command: string | null;
    late?: boolean;
    matched?: Array<string>;
    call?: string;
  } | {
    kind: "write";
    paths: Array<string>;
    command: string | null;
    late?: boolean;
    matched?: Array<string>;
    call?: string;
  } | {
    kind: "search";
    paths: Array<string>;
    command: string | null;
    late?: boolean;
    matched?: Array<string>;
    call?: string;
  } | {
    kind: "fetch";
    paths: Array<string>;
    command: string | null;
    late?: boolean;
    matched?: Array<string>;
    call?: string;
  } | {
    kind: "mcp";
    paths: Array<string>;
    command: string | null;
    server: string;
    tool: string;
    late?: boolean;
    matched?: Array<string>;
    call?: string;
    counts: "read" | "change" | "send" | "destructive";
    effect?: "push" | "merge" | "dispatch" | "send" | "delete";
  } | {
    kind: "unknown";
    paths: Array<string>;
    command: string | null;
    late?: boolean;
    matched?: Array<string>;
    call?: string;
  };
  evidence?: Array<string>;
}

/** tool.span@1 */
export interface ToolSpan {
  v: 1;
  id: string;
  kind: "tool.span";
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    tool: string;
    tool_use_id: string | null;
    duration_ms: number;
    blocked_ms: number | null;
    decision: string | null;
    reading: string;
  };
  evidence?: Array<string>;
}

/** transcript.archived@1 */
export interface TranscriptArchived {
  v: 1;
  id: string;
  kind: "transcript.archived";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    session: string;
    evidence: string;
  };
  evidence?: Array<string>;
}

/** transcript.archived@2 */
export interface TranscriptArchivedV2 {
  v: 2;
  id: string;
  kind: "transcript.archived";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    session: string;
    evidence: string;
    source: {
      size: number;
      sha256: string;
    };
  };
  evidence?: Array<string>;
}

/** turn.usage@1 */
export interface TurnUsage {
  v: 1;
  id: string;
  kind: "turn.usage";
  subject: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    turn: string;
    model: string;
    covers: "turn" | "session";
    tokens: {
      input: number;
      cached: number;
      output: number;
      exact: boolean;
    };
    cost: {
      basis: "reported";
      usd: number;
    } | {
      basis: "estimated";
      usd: number;
      rate_card: string;
    } | {
      basis: "unpriced";
    };
    context?: {
      used: number;
      window: number;
    };
  };
  evidence?: Array<string>;
}

/** user.ask@1 */
export interface UserAsk {
  v: 1;
  id: string;
  kind: "user.ask";
  subject?: string;
  writer: "hook";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    msg: number;
    text: string;
    tasks: Array<string>;
    from: "person" | "scheduled" | "subagent" | "session" | "continuation" | "unknown";
  };
  evidence?: Array<string>;
}

export type VerdictMadeRequirements = Array<{
  req: string;
  outcome: "PASS" | "FAIL" | "INVALID" | "BLOCKED" | "INCONCLUSIVE" | "pending";
  check: string;
  depth: string;
  oracle: "code" | "model" | "person";
  runs: {
    clean: number;
    needed: number;
    counted: Array<string>;
  };
  smallest: string | null;
  points_to: string | null;
  evidence: Array<string>;
  proof: "statement" | "static_check" | "test_run" | "journey" | "decision";
  ask?: string;
}>;

export type VerdictMadeKey = {
  commit: string;
  doc_revisions: Array<string>;
  check_digests: Array<string>;
  state_digests: Array<string>;
  environment: string;
  tools: Array<string>;
};

/** verdict.made@1 */
export interface VerdictMade {
  v: 1;
  id: string;
  kind: "verdict.made";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    outcome: "PASS";
    verdict: string;
    claim: string;
    reasons: Array<string>;
    requirements: Array<{
      req: string;
      outcome: "PASS";
      check: string;
      depth: string;
      oracle: "code" | "model" | "person";
      runs: {
        clean: number;
        needed: number;
        counted: Array<string>;
      };
      smallest: string | null;
      points_to: string | null;
      evidence: Array<string>;
      proof: "statement" | "static_check" | "test_run" | "journey" | "decision";
      ask?: string;
    }>;
    smallest: string | null;
    points_to: string | null;
    commit: string;
    key: VerdictMadeKey;
  } | {
    outcome: "FAIL";
    verdict: string;
    claim: string;
    reasons: Array<string>;
    requirements: VerdictMadeRequirements;
    smallest: string | null;
    points_to: string | null;
    commit: string;
    key: VerdictMadeKey;
  } | {
    outcome: "INVALID";
    verdict: string;
    claim: string;
    reasons: Array<string>;
    requirements: VerdictMadeRequirements;
    smallest: string | null;
    points_to: string | null;
    commit: string;
    key: VerdictMadeKey;
  } | {
    outcome: "BLOCKED";
    verdict: string;
    claim: string;
    reasons: Array<string>;
    requirements: VerdictMadeRequirements;
    smallest: string | null;
    points_to: string | null;
    commit: string;
    key: VerdictMadeKey;
  } | {
    outcome: "INCONCLUSIVE";
    verdict: string;
    claim: string;
    reasons: Array<string>;
    requirements: VerdictMadeRequirements;
    smallest: string | null;
    points_to: string | null;
    commit: string;
    key: VerdictMadeKey;
  };
  evidence?: Array<string>;
}

/** verdict.outcome@1 */
export type VerdictOutcome = "PASS" | "FAIL" | "INVALID" | "BLOCKED" | "INCONCLUSIVE";

/** verdict.stale@1 */
export interface VerdictStale {
  v: 1;
  id: string;
  kind: "verdict.stale";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    verdict: string;
    because: string;
  };
  evidence?: Array<string>;
}

export type VerdictRequirement = {
  req: string;
  outcome: "PASS" | "FAIL" | "INVALID" | "BLOCKED" | "INCONCLUSIVE" | "pending";
  check: string;
  depth: string;
  oracle: "code" | "model" | "person";
  runs: {
    clean: number;
    needed: number;
    counted: Array<string>;
  };
  smallest: string | null;
  points_to: string | null;
  evidence: Array<string>;
  proof: "statement" | "static_check" | "test_run" | "journey" | "decision";
  ask?: string;
};

export type VerdictPassed = {
  req: string;
  outcome: "PASS";
  check: string;
  depth: string;
  oracle: "code" | "model" | "person";
  runs: {
    clean: number;
    needed: number;
    counted: Array<string>;
  };
  smallest: string | null;
  points_to: string | null;
  evidence: Array<string>;
  proof: "statement" | "static_check" | "test_run" | "journey" | "decision";
  ask?: string;
};

export type VerdictKey = {
  commit: string;
  doc_revisions: Array<string>;
  check_digests: Array<string>;
  state_digests: Array<string>;
  environment: string;
  tools: Array<string>;
};

/** verdict@1 */
export type Verdict = {
  verdict: string;
  claim: string;
  outcome: "PASS";
  reasons: Array<string>;
  requirements: Array<VerdictPassed>;
  smallest: string | null;
  points_to: string | null;
  commit: string;
  key: VerdictKey;
  checkout: string;
} | {
  verdict: string;
  claim: string;
  outcome: "FAIL";
  reasons: Array<string>;
  requirements: Array<VerdictRequirement>;
  smallest: string | null;
  points_to: string | null;
  commit: string;
  key: VerdictKey;
  checkout: string;
} | {
  verdict: string;
  claim: string;
  outcome: "INVALID";
  reasons: Array<string>;
  requirements: Array<VerdictRequirement>;
  smallest: string | null;
  points_to: string | null;
  commit: string;
  key: VerdictKey;
  checkout: string;
} | {
  verdict: string;
  claim: string;
  outcome: "BLOCKED";
  reasons: Array<string>;
  requirements: Array<VerdictRequirement>;
  smallest: string | null;
  points_to: string | null;
  commit: string;
  key: VerdictKey;
  checkout: string;
} | {
  verdict: string;
  claim: string;
  outcome: "INCONCLUSIVE";
  reasons: Array<string>;
  requirements: Array<VerdictRequirement>;
  smallest: string | null;
  points_to: string | null;
  commit: string;
  key: VerdictKey;
  checkout: string;
};

/** worktree.created@1 */
export interface WorktreeCreated {
  v: 1;
  id: string;
  kind: "worktree.created";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    path: string;
    branch: string | null;
    owner: string;
    base: string;
  };
  evidence?: Array<string>;
}

/** worktree.removed@1 */
export interface WorktreeRemoved {
  v: 1;
  id: string;
  kind: "worktree.removed";
  subject?: string;
  writer: "app";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    path: string;
    branch: string | null;
    owner: string;
  };
  evidence?: Array<string>;
}
