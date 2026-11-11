// Generated from packages/contracts/schemas by generateTypeScript. Do not edit.

/** acceptance.state@1 */
export interface AcceptanceState {
  v: 1;
  id: string;
  kind: "acceptance.state";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    issue: string;
    entry: unknown;
  };
  evidence?: Array<string>;
}

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

export type AdapterFactsReach = "model" | "user" | "debug" | "none";

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
  state?: {
    field: AdapterFactsText;
    values: { [key: string]: "working" | "waiting" | "finished" };
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
    archived?: AdapterFactsText;
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
    Notification?: AdapterFactsHookRule;
    Elicitation?: AdapterFactsHookRule;
    ElicitationResult?: AdapterFactsHookRule;
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
  taskList?: {
    readBy: AdapterFactsText;
    conformance: AdapterFactsText;
    tool: AdapterFactsText;
    items: AdapterFactsText;
    text: AdapterFactsText;
    status: AdapterFactsText;
    open: AdapterFactsTexts;
  };
  tokenizer?: {
    readBy: AdapterFactsText;
    conformance: AdapterFactsText;
    name: AdapterFactsText;
    package: AdapterFactsText;
    version: AdapterFactsVersion;
  };
  mods?: {
    readBy: AdapterFactsText;
    conformance: AdapterFactsText;
    since: {
      terminal: AdapterFactsVersion;
      desktop: AdapterFactsVersion;
    };
    validate: {
      args: AdapterFactsTexts;
      hooks: AdapterFactsText;
      calls: AdapterFactsText;
    };
    overrides: {
      event: AdapterFactsText;
      past: AdapterFactsText;
    };
    promptCalls: AdapterFactsTexts;
    holdsWhen: Array<{
      case: "managed" | "login" | "plan" | "interactive";
      text: AdapterFactsText;
      subscriptionTypes?: AdapterFactsTexts;
      mode?: AdapterFactsText;
      since?: AdapterFactsVersion;
      tools?: AdapterFactsTexts;
    }>;
  };
  contextOutput?: {
    readBy: AdapterFactsText;
    conformance: AdapterFactsText;
    capChars: number;
    previewChars: number;
    versions: Array<AdapterFactsVersion>;
    source: AdapterFactsText;
    events: { [key: string]: {
      additionalContext: AdapterFactsReach;
      systemMessage: AdapterFactsReach;
      stdout: AdapterFactsReach;
      stderr: AdapterFactsReach;
      stderrOnBlock: AdapterFactsReach;
    } };
  };
  classifyStop?: AdapterFactsOperation;
  skills?: AdapterFactsOperation;
  entries?: {
    readBy?: string;
    name: string;
    home?: string;
    mcp?: {
      file: string;
      format: "json" | "toml";
      key: string;
      perProject?: string;
      transports: {
        stdio?: {
          type?: string;
          fields: Array<string>;
          names?: { [key: string]: string };
          commandArray?: boolean;
        };
        http?: {
          type?: string;
          fields: Array<string>;
          names?: { [key: string]: string };
          commandArray?: boolean;
        };
      };
      refused: Array<{
        transport: "stdio" | "http";
        field: string;
        reason?: string;
      }>;
      list?: Array<string>;
    };
    skills?: {
      write: string;
      readFrom: Array<string>;
    };
  };
  daemon?: {
    readBy?: string;
    restart: Array<string>;
    picksUp: { [key: string]: {
      "hooks.json": boolean;
      mcp_servers: boolean;
      readBy?: string;
    } };
  };
}

export type AdapterFactsV2Text = string;

export type AdapterFactsV2Match = { [key: string]: unknown };

export type AdapterFactsV2Texts = Array<AdapterFactsV2Text>;

export type AdapterFactsV2Version = string;

export type AdapterFactsV2TextMap = { [key: string]: AdapterFactsV2Text };

export type AdapterFactsV2DataTemplate = { [key: string]: AdapterFactsV2Text };

export type AdapterFactsV2FieldTypes = { [key: string]: string };

export type AdapterFactsV2Payload = {
  required: AdapterFactsV2FieldTypes;
  optional: AdapterFactsV2FieldTypes;
  tools?: { [key: string]: AdapterFactsV2FieldTypes };
};

export type AdapterFactsV2ToolKind = "shell" | "read" | "edit" | "write" | "search" | "fetch" | "mcp" | "unknown";

export type AdapterFactsV2StopCause = "sign_in_required" | "token_refresh_failed" | "plan_window_spent" | "rate_limited" | "refusal" | "max_turns" | "context_overflow" | "tool_schema_rejected" | "agent_crashed" | "timed_out" | "unknown";

export type AdapterFactsV2CauseMap = { [key: string]: AdapterFactsV2StopCause };

export type AdapterFactsV2OriginRule = {
  prompt?: AdapterFactsV2Text;
  match?: { [key: string]: unknown };
  from: AdapterFactsV2Text;
};

export type AdapterFactsV2HookRule = {
  kind: string;
  data?: AdapterFactsV2DataTemplate;
  origin?: {
    join?: {
      payload: AdapterFactsV2Text;
      transcript: AdapterFactsV2Text;
    };
    rules: Array<AdapterFactsV2OriginRule>;
    otherwise: AdapterFactsV2Text;
  };
  call?: "kind" | "detail";
  stop?: boolean;
  cause?: {
    field: AdapterFactsV2Text;
    values: AdapterFactsV2CauseMap;
    otherwise: AdapterFactsV2StopCause;
  };
};

export type AdapterFactsV2Operation = {
  readBy: AdapterFactsV2Text;
  conformance: AdapterFactsV2Text;
};

export type AdapterFactsV2MarkerMap = { [key: string]: AdapterFactsV2Text };

/** adapter.facts@2 */
export interface AdapterFactsV2 {
  schema: "adapter.facts@2";
  versions: Array<AdapterFactsV2Version>;
  agent: string;
  hookTimeouts: {
    readBy: AdapterFactsV2Text;
    conformance: AdapterFactsV2Text;
    defaultMs?: number | null;
    perHook?: { [key: string]: number };
  };
  continuation: {
    readBy: AdapterFactsV2Text;
    conformance: AdapterFactsV2Text;
    cap?: number;
    field?: AdapterFactsV2Text;
    hook?: AdapterFactsV2Text;
  };
  launch: {
    readBy: AdapterFactsV2Text;
    conformance: AdapterFactsV2Text;
    session?: {
      readBy?: AdapterFactsV2Text;
      args: AdapterFactsV2Texts;
    };
    readOnlyJob?: {
      readBy?: AdapterFactsV2Text;
      args: AdapterFactsV2Texts;
      prompt: AdapterFactsV2Text;
    };
  };
  modelFamily: {
    readBy: AdapterFactsV2Text;
    conformance: AdapterFactsV2Text;
    families: AdapterFactsV2TextMap;
  };
  billing: {
    readBy: AdapterFactsV2Text;
    conformance: AdapterFactsV2Text;
    apiKeyVariables: AdapterFactsV2Texts;
  };
  usage: {
    readBy: AdapterFactsV2Text;
    conformance: AdapterFactsV2Text;
    cost: "reported" | "estimated" | "unpriced";
    costFrom: AdapterFactsV2Text;
    tokens: AdapterFactsV2Text;
  };
  questionTools: {
    readBy: AdapterFactsV2Text;
    conformance: AdapterFactsV2Text;
    tools: AdapterFactsV2Texts;
  };
  transcripts: {
    readBy: AdapterFactsV2Text;
    conformance: AdapterFactsV2Text;
    home: Array<AdapterFactsV2Text>;
    path: AdapterFactsV2Text;
  };
  appLinks: {
    readBy: AdapterFactsV2Text;
    conformance: AdapterFactsV2Text;
    open: AdapterFactsV2Text;
  };
  errorTexts: {
    readBy: AdapterFactsV2Text;
    conformance: AdapterFactsV2Text;
    causes: AdapterFactsV2CauseMap;
  };
  events: {
    readBy: AdapterFactsV2Text;
    conformance: AdapterFactsV2Text;
    versions: { [key: string]: { [key: string]: AdapterFactsV2Payload } };
  };
  mapping: {
    readBy: AdapterFactsV2Text;
    conformance: AdapterFactsV2Text;
    common: AdapterFactsV2DataTemplate;
    SessionStart?: AdapterFactsV2HookRule;
    UserPromptSubmit?: AdapterFactsV2HookRule;
    PreToolUse?: AdapterFactsV2HookRule;
    PermissionRequest?: AdapterFactsV2HookRule;
    PostToolUse?: AdapterFactsV2HookRule;
    PostToolUseFailure?: AdapterFactsV2HookRule;
    Stop?: AdapterFactsV2HookRule;
    StopFailure?: AdapterFactsV2HookRule;
    SessionEnd?: AdapterFactsV2HookRule;
    SubagentStart?: AdapterFactsV2HookRule;
    SubagentStop?: AdapterFactsV2HookRule;
    TaskCreated?: AdapterFactsV2HookRule;
    TaskCompleted?: AdapterFactsV2HookRule;
    TeammateIdle?: AdapterFactsV2HookRule;
    WorktreeCreate?: AdapterFactsV2HookRule;
    WorktreeRemove?: AdapterFactsV2HookRule;
    PreCompact?: AdapterFactsV2HookRule;
    PostCompact?: AdapterFactsV2HookRule;
    Interrupt?: AdapterFactsV2HookRule;
    sessionStart?: AdapterFactsV2HookRule;
    sessionEnd?: AdapterFactsV2HookRule;
    preToolUse?: AdapterFactsV2HookRule;
    postToolUse?: AdapterFactsV2HookRule;
    stop?: AdapterFactsV2HookRule;
    session_start?: AdapterFactsV2HookRule;
    session_shutdown?: AdapterFactsV2HookRule;
    input?: AdapterFactsV2HookRule;
    tool_call?: AdapterFactsV2HookRule;
    tool_result?: AdapterFactsV2HookRule;
    agent_start?: AdapterFactsV2HookRule;
    agent_end?: AdapterFactsV2HookRule;
    agent_before_settle?: AdapterFactsV2HookRule;
    agent_settled?: AdapterFactsV2HookRule;
  };
  toolKinds: {
    readBy: AdapterFactsV2Text;
    conformance: AdapterFactsV2Text;
    tools: { [key: string]: AdapterFactsV2ToolKind };
    prefixes?: { [key: string]: AdapterFactsV2ToolKind };
    otherwise: AdapterFactsV2ToolKind;
  };
  toolDetail?: {
    readBy: AdapterFactsV2Text;
    conformance: AdapterFactsV2Text;
    command?: AdapterFactsV2TextMap;
    paths?: AdapterFactsV2TextMap;
    mcp?: {
      tool: AdapterFactsV2Text;
    };
  };
  patch?: {
    readBy: AdapterFactsV2Text;
    conformance: AdapterFactsV2Text;
    tools: AdapterFactsV2Texts;
    command: AdapterFactsV2Text;
    shell: AdapterFactsV2Text;
  };
  turnWithoutPrompt?: {
    readBy: AdapterFactsV2Text;
    conformance: AdapterFactsV2Text;
    payloadField: AdapterFactsV2Text;
    startedBy: AdapterFactsV2Texts;
    turnEntry: AdapterFactsV2Text;
    turnField: AdapterFactsV2Text;
    messageRole: {
      path: AdapterFactsV2Text;
      value: AdapterFactsV2Text;
    };
    messageText: AdapterFactsV2Text;
    values: AdapterFactsV2MarkerMap;
    otherwise: AdapterFactsV2Text;
  };
  signIn?: {
    readBy: AdapterFactsV2Text;
    conformance: AdapterFactsV2Text;
    args: AdapterFactsV2Texts;
    signedIn: AdapterFactsV2Text;
  };
  stop?: {
    readBy: AdapterFactsV2Text;
    conformance: AdapterFactsV2Text;
    turn: {
      payload: AdapterFactsV2Text;
      transcript: AdapterFactsV2Text;
      elsewhere?: AdapterFactsV2Text;
    };
    cause: {
      readBy?: AdapterFactsV2Text;
      payload?: {
        field: AdapterFactsV2Text;
        values: AdapterFactsV2CauseMap;
      };
      errors?: {
        match: AdapterFactsV2Match;
        field: AdapterFactsV2Text;
        values: AdapterFactsV2CauseMap;
      };
      rateLimits?: {
        match: AdapterFactsV2Match;
        reached: AdapterFactsV2Text;
        windows: AdapterFactsV2Texts;
        used: AdapterFactsV2Text;
        resetsAt: AdapterFactsV2Text;
        toMs: number;
        spent: AdapterFactsV2StopCause;
        withoutReset: AdapterFactsV2StopCause;
      };
      otherwise: AdapterFactsV2StopCause;
    };
    usage: {
      readBy?: AdapterFactsV2Text;
      covers: "turn" | "session";
      records: {
        match: AdapterFactsV2Match;
        has: AdapterFactsV2Text;
        skip?: AdapterFactsV2Match;
        once?: AdapterFactsV2Text;
      };
      take: "sum" | "last";
      counts: {
        input: AdapterFactsV2Texts;
        cached: AdapterFactsV2Texts;
        output: AdapterFactsV2Texts;
      };
      exact: boolean;
      model: {
        record?: AdapterFactsV2Text;
        payload?: AdapterFactsV2Text;
      };
      contextFill?: {
        used: AdapterFactsV2Texts;
        window: AdapterFactsV2Text;
      };
    };
  };
  readUsage?: AdapterFactsV2Operation;
  classifyStop?: AdapterFactsV2Operation;
  skills?: AdapterFactsV2Operation;
  install?: {
    readBy: AdapterFactsV2Text;
    conformance: AdapterFactsV2Text;
    source: AdapterFactsV2Text;
  };
  entries?: {
    readBy?: string;
    name: string;
    home?: string;
    mcp?: {
      file: string;
      format: "json" | "toml";
      key: string;
      perProject?: string;
      transports: {
        stdio?: {
          type?: string;
          fields: Array<string>;
          names?: { [key: string]: string };
          commandArray?: boolean;
        };
        http?: {
          type?: string;
          fields: Array<string>;
          names?: { [key: string]: string };
          commandArray?: boolean;
        };
      };
      refused: Array<{
        transport: "stdio" | "http";
        field: string;
        reason?: string;
      }>;
      list?: Array<string>;
    };
    skills?: {
      write: string;
      readFrom: Array<string>;
    };
  };
  daemon?: {
    readBy?: string;
    restart: Array<string>;
    picksUp: { [key: string]: {
      "hooks.json": boolean;
      mcp_servers: boolean;
      readBy?: string;
    } };
  };
}

export type AdapterFactsV3Text = string;

export type AdapterFactsV3Match = { [key: string]: unknown };

export type AdapterFactsV3Texts = Array<AdapterFactsV3Text>;

export type AdapterFactsV3Version = string;

export type AdapterFactsV3TextMap = { [key: string]: AdapterFactsV3Text };

export type AdapterFactsV3DataTemplate = { [key: string]: AdapterFactsV3Text };

export type AdapterFactsV3FieldTypes = { [key: string]: string };

export type AdapterFactsV3Payload = {
  required: AdapterFactsV3FieldTypes;
  optional: AdapterFactsV3FieldTypes;
  tools?: { [key: string]: AdapterFactsV3FieldTypes };
};

export type AdapterFactsV3ToolKind = "shell" | "read" | "edit" | "write" | "search" | "fetch" | "mcp" | "unknown";

export type AdapterFactsV3StopCause = "sign_in_required" | "token_refresh_failed" | "plan_window_spent" | "rate_limited" | "refusal" | "max_turns" | "context_overflow" | "tool_schema_rejected" | "agent_crashed" | "timed_out" | "unknown";

export type AdapterFactsV3CauseMap = { [key: string]: AdapterFactsV3StopCause };

export type AdapterFactsV3OriginRule = {
  prompt?: AdapterFactsV3Text;
  match?: { [key: string]: unknown };
  from: AdapterFactsV3Text;
};

export type AdapterFactsV3HookRule = {
  kind: string;
  data?: AdapterFactsV3DataTemplate;
  origin?: {
    join?: {
      payload: AdapterFactsV3Text;
      transcript: AdapterFactsV3Text;
    };
    rules: Array<AdapterFactsV3OriginRule>;
    otherwise: AdapterFactsV3Text;
  };
  call?: "kind" | "detail";
  stop?: boolean;
  cause?: {
    field: AdapterFactsV3Text;
    values: AdapterFactsV3CauseMap;
    otherwise: AdapterFactsV3StopCause;
  };
};

export type AdapterFactsV3Operation = {
  readBy: AdapterFactsV3Text;
  conformance: AdapterFactsV3Text;
};

export type AdapterFactsV3MarkerMap = { [key: string]: AdapterFactsV3Text };

/** adapter.facts@3 */
export interface AdapterFactsV3 {
  schema: "adapter.facts@3";
  versions: Array<AdapterFactsV3Version>;
  agent: string;
  hookTimeouts: {
    readBy: AdapterFactsV3Text;
    conformance: AdapterFactsV3Text;
    defaultMs?: number | null;
    perHook?: { [key: string]: number };
  };
  continuation: {
    readBy: AdapterFactsV3Text;
    conformance: AdapterFactsV3Text;
    cap?: number;
    field?: AdapterFactsV3Text;
    hook?: AdapterFactsV3Text;
  };
  launch: {
    readBy: AdapterFactsV3Text;
    conformance: AdapterFactsV3Text;
    session?: {
      readBy?: AdapterFactsV3Text;
      args: AdapterFactsV3Texts;
    };
    readOnlyJob?: {
      readBy?: AdapterFactsV3Text;
      args: AdapterFactsV3Texts;
      prompt: AdapterFactsV3Text;
    };
  };
  modelFamily: {
    readBy: AdapterFactsV3Text;
    conformance: AdapterFactsV3Text;
    families: AdapterFactsV3TextMap;
  };
  billing: {
    readBy: AdapterFactsV3Text;
    conformance: AdapterFactsV3Text;
    apiKeyVariables: AdapterFactsV3Texts;
  };
  usage: {
    readBy: AdapterFactsV3Text;
    conformance: AdapterFactsV3Text;
    cost: "reported" | "estimated" | "unpriced";
    costFrom: AdapterFactsV3Text;
    tokens: AdapterFactsV3Text;
  };
  questionTools: {
    readBy: AdapterFactsV3Text;
    conformance: AdapterFactsV3Text;
    tools: AdapterFactsV3Texts;
  };
  transcripts: {
    readBy: AdapterFactsV3Text;
    conformance: AdapterFactsV3Text;
    home: Array<AdapterFactsV3Text>;
    path: AdapterFactsV3Text;
  };
  appLinks: {
    readBy: AdapterFactsV3Text;
    conformance: AdapterFactsV3Text;
    open: AdapterFactsV3Text;
  };
  errorTexts: {
    readBy: AdapterFactsV3Text;
    conformance: AdapterFactsV3Text;
    causes: AdapterFactsV3CauseMap;
  };
  events: {
    readBy: AdapterFactsV3Text;
    conformance: AdapterFactsV3Text;
    versions: { [key: string]: { [key: string]: AdapterFactsV3Payload } };
  };
  mapping: {
    readBy: AdapterFactsV3Text;
    conformance: AdapterFactsV3Text;
    common: AdapterFactsV3DataTemplate;
    SessionStart?: AdapterFactsV3HookRule;
    UserPromptSubmit?: AdapterFactsV3HookRule;
    PreToolUse?: AdapterFactsV3HookRule;
    PermissionRequest?: AdapterFactsV3HookRule;
    PostToolUse?: AdapterFactsV3HookRule;
    PostToolUseFailure?: AdapterFactsV3HookRule;
    Stop?: AdapterFactsV3HookRule;
    StopFailure?: AdapterFactsV3HookRule;
    SessionEnd?: AdapterFactsV3HookRule;
    SubagentStart?: AdapterFactsV3HookRule;
    SubagentStop?: AdapterFactsV3HookRule;
    TaskCreated?: AdapterFactsV3HookRule;
    TaskCompleted?: AdapterFactsV3HookRule;
    TeammateIdle?: AdapterFactsV3HookRule;
    WorktreeCreate?: AdapterFactsV3HookRule;
    WorktreeRemove?: AdapterFactsV3HookRule;
    PreCompact?: AdapterFactsV3HookRule;
    PostCompact?: AdapterFactsV3HookRule;
    Interrupt?: AdapterFactsV3HookRule;
    sessionStart?: AdapterFactsV3HookRule;
    sessionEnd?: AdapterFactsV3HookRule;
    preToolUse?: AdapterFactsV3HookRule;
    postToolUse?: AdapterFactsV3HookRule;
    stop?: AdapterFactsV3HookRule;
    session_start?: AdapterFactsV3HookRule;
    session_shutdown?: AdapterFactsV3HookRule;
    input?: AdapterFactsV3HookRule;
    tool_call?: AdapterFactsV3HookRule;
    tool_result?: AdapterFactsV3HookRule;
    agent_start?: AdapterFactsV3HookRule;
    agent_end?: AdapterFactsV3HookRule;
    agent_before_settle?: AdapterFactsV3HookRule;
    agent_settled?: AdapterFactsV3HookRule;
    "agent.turn.before"?: AdapterFactsV3HookRule;
    "agent.turn.after"?: AdapterFactsV3HookRule;
    "agent.permission.before"?: AdapterFactsV3HookRule;
    "agent.permission.after"?: AdapterFactsV3HookRule;
  };
  toolKinds: {
    readBy: AdapterFactsV3Text;
    conformance: AdapterFactsV3Text;
    tools: { [key: string]: AdapterFactsV3ToolKind };
    prefixes?: { [key: string]: AdapterFactsV3ToolKind };
    otherwise: AdapterFactsV3ToolKind;
  };
  toolDetail?: {
    readBy: AdapterFactsV3Text;
    conformance: AdapterFactsV3Text;
    command?: AdapterFactsV3TextMap;
    paths?: AdapterFactsV3TextMap;
    mcp?: {
      tool: AdapterFactsV3Text;
    };
  };
  patch?: {
    readBy: AdapterFactsV3Text;
    conformance: AdapterFactsV3Text;
    tools: AdapterFactsV3Texts;
    command: AdapterFactsV3Text;
    shell: AdapterFactsV3Text;
  };
  turnWithoutPrompt?: {
    readBy: AdapterFactsV3Text;
    conformance: AdapterFactsV3Text;
    payloadField: AdapterFactsV3Text;
    startedBy: AdapterFactsV3Texts;
    turnEntry: AdapterFactsV3Text;
    turnField: AdapterFactsV3Text;
    messageRole: {
      path: AdapterFactsV3Text;
      value: AdapterFactsV3Text;
    };
    messageText: AdapterFactsV3Text;
    values: AdapterFactsV3MarkerMap;
    otherwise: AdapterFactsV3Text;
  };
  signIn?: {
    readBy: AdapterFactsV3Text;
    conformance: AdapterFactsV3Text;
    args: AdapterFactsV3Texts;
    signedIn: AdapterFactsV3Text;
  };
  stop?: {
    readBy: AdapterFactsV3Text;
    conformance: AdapterFactsV3Text;
    turn: {
      payload: AdapterFactsV3Text;
      transcript: AdapterFactsV3Text;
      elsewhere?: AdapterFactsV3Text;
    };
    cause: {
      readBy?: AdapterFactsV3Text;
      payload?: {
        field: AdapterFactsV3Text;
        values: AdapterFactsV3CauseMap;
      };
      errors?: {
        match: AdapterFactsV3Match;
        field: AdapterFactsV3Text;
        values: AdapterFactsV3CauseMap;
      };
      rateLimits?: {
        match: AdapterFactsV3Match;
        reached: AdapterFactsV3Text;
        windows: AdapterFactsV3Texts;
        used: AdapterFactsV3Text;
        resetsAt: AdapterFactsV3Text;
        toMs: number;
        spent: AdapterFactsV3StopCause;
        withoutReset: AdapterFactsV3StopCause;
      };
      otherwise: AdapterFactsV3StopCause;
    };
    usage: {
      readBy?: AdapterFactsV3Text;
      covers: "turn" | "session";
      records: {
        match: AdapterFactsV3Match;
        has: AdapterFactsV3Text;
        skip?: AdapterFactsV3Match;
        once?: AdapterFactsV3Text;
      };
      take: "sum" | "last";
      counts: {
        input: AdapterFactsV3Texts;
        cached: AdapterFactsV3Texts;
        output: AdapterFactsV3Texts;
      };
      exact: boolean;
      model: {
        record?: AdapterFactsV3Text;
        payload?: AdapterFactsV3Text;
      };
      contextFill?: {
        used: AdapterFactsV3Texts;
        window: AdapterFactsV3Text;
      };
    };
  };
  readUsage?: AdapterFactsV3Operation;
  classifyStop?: AdapterFactsV3Operation;
  skills?: AdapterFactsV3Operation;
  install?: {
    readBy: AdapterFactsV3Text;
    conformance: AdapterFactsV3Text;
    source: AdapterFactsV3Text;
  };
  providers?: { [key: string]: {
    readBy: AdapterFactsV3Text;
    conformance: AdapterFactsV3Text;
    hooks: "own" | "plugin";
    bridge?: string;
    permissions?: AdapterFactsV3Text;
    modelCheck?: AdapterFactsV3Text;
    timeouts?: { [key: string]: number };
  } };
}

export type AdapterFactsV4Text = string;

export type AdapterFactsV4Match = { [key: string]: unknown };

export type AdapterFactsV4Texts = Array<AdapterFactsV4Text>;

export type AdapterFactsV4Version = string;

export type AdapterFactsV4TextMap = { [key: string]: AdapterFactsV4Text };

export type AdapterFactsV4DataTemplate = { [key: string]: AdapterFactsV4Text };

export type AdapterFactsV4FieldTypes = { [key: string]: string };

export type AdapterFactsV4Payload = {
  required: AdapterFactsV4FieldTypes;
  optional: AdapterFactsV4FieldTypes;
  tools?: { [key: string]: AdapterFactsV4FieldTypes };
};

export type AdapterFactsV4ToolKind = "shell" | "read" | "edit" | "write" | "search" | "fetch" | "mcp" | "unknown";

export type AdapterFactsV4StopCause = "sign_in_required" | "token_refresh_failed" | "plan_window_spent" | "rate_limited" | "refusal" | "max_turns" | "context_overflow" | "tool_schema_rejected" | "agent_crashed" | "timed_out" | "unknown";

export type AdapterFactsV4CauseMap = { [key: string]: AdapterFactsV4StopCause };

export type AdapterFactsV4OriginRule = {
  prompt?: AdapterFactsV4Text;
  match?: { [key: string]: unknown };
  from: AdapterFactsV4Text;
};

export type AdapterFactsV4HookRule = {
  kind: string;
  data?: AdapterFactsV4DataTemplate;
  origin?: {
    join?: {
      payload: AdapterFactsV4Text;
      transcript: AdapterFactsV4Text;
    };
    rules: Array<AdapterFactsV4OriginRule>;
    otherwise: AdapterFactsV4Text;
  };
  call?: "kind" | "detail";
  stop?: boolean;
  cause?: {
    field: AdapterFactsV4Text;
    values: AdapterFactsV4CauseMap;
    otherwise: AdapterFactsV4StopCause;
  };
  state?: {
    field: AdapterFactsV4Text;
    values: { [key: string]: "working" | "waiting" | "finished" };
  };
};

export type AdapterFactsV4Operation = {
  readBy: AdapterFactsV4Text;
  conformance: AdapterFactsV4Text;
};

export type AdapterFactsV4MarkerMap = { [key: string]: AdapterFactsV4Text };

/** adapter.facts@4 */
export interface AdapterFactsV4 {
  schema: "adapter.facts@4";
  versions: Array<AdapterFactsV4Version>;
  agent: string;
  hookTimeouts: {
    readBy: AdapterFactsV4Text;
    conformance: AdapterFactsV4Text;
    defaultMs?: number | null;
    perHook?: { [key: string]: number };
  };
  continuation: {
    readBy: AdapterFactsV4Text;
    conformance: AdapterFactsV4Text;
    cap?: number;
    field?: AdapterFactsV4Text;
  };
  launch: {
    readBy: AdapterFactsV4Text;
    conformance: AdapterFactsV4Text;
    session?: {
      readBy?: AdapterFactsV4Text;
      args: AdapterFactsV4Texts;
    };
    readOnlyJob?: {
      readBy?: AdapterFactsV4Text;
      args: AdapterFactsV4Texts;
      prompt: AdapterFactsV4Text;
    };
    started?: {
      readBy?: AdapterFactsV4Text;
      args: AdapterFactsV4Texts;
      asks: AdapterFactsV4Text;
      modes: AdapterFactsV4TextMap;
      skipping: AdapterFactsV4Texts;
      nested: AdapterFactsV4Texts;
      home: AdapterFactsV4Text;
      defaultHome: AdapterFactsV4Text;
      trust?: {
        readBy?: AdapterFactsV4Text;
        file: AdapterFactsV4Text;
        homeFile: AdapterFactsV4Text;
        set: AdapterFactsV4Text;
      };
    };
  };
  sandbox?: {
    readBy: AdapterFactsV4Text;
    conformance: AdapterFactsV4Text;
    versions: { [key: string]: {
      settings?: AdapterFactsV4Text;
      args?: AdapterFactsV4Texts;
      modes?: AdapterFactsV4TextMap;
      walls: {
        writes?: AdapterFactsV4Text;
        credentials?: AdapterFactsV4Text;
        network?: AdapterFactsV4Text;
      };
      wayOut: {
        call: AdapterFactsV4Text;
        setting: AdapterFactsV4Text;
        off: boolean;
      };
    } };
  };
  modelFamily: {
    readBy: AdapterFactsV4Text;
    conformance: AdapterFactsV4Text;
    families: AdapterFactsV4TextMap;
  };
  billing: {
    readBy: AdapterFactsV4Text;
    conformance: AdapterFactsV4Text;
    apiKeyVariables: AdapterFactsV4Texts;
  };
  usage: {
    readBy: AdapterFactsV4Text;
    conformance: AdapterFactsV4Text;
    cost: "reported" | "estimated" | "unpriced";
    costFrom: AdapterFactsV4Text;
    tokens: AdapterFactsV4Text;
  };
  questionTools: {
    readBy: AdapterFactsV4Text;
    conformance: AdapterFactsV4Text;
    tools: AdapterFactsV4Texts;
  };
  transcripts: {
    readBy: AdapterFactsV4Text;
    conformance: AdapterFactsV4Text;
    home: Array<AdapterFactsV4Text>;
    path: AdapterFactsV4Text;
    archived?: AdapterFactsV4Text;
  };
  appLinks: {
    readBy: AdapterFactsV4Text;
    conformance: AdapterFactsV4Text;
    open: AdapterFactsV4Text;
  };
  errorTexts: {
    readBy: AdapterFactsV4Text;
    conformance: AdapterFactsV4Text;
    causes: AdapterFactsV4CauseMap;
  };
  events: {
    readBy: AdapterFactsV4Text;
    conformance: AdapterFactsV4Text;
    versions: { [key: string]: { [key: string]: AdapterFactsV4Payload } };
  };
  mapping: {
    readBy: AdapterFactsV4Text;
    conformance: AdapterFactsV4Text;
    common: AdapterFactsV4DataTemplate;
    SessionStart?: AdapterFactsV4HookRule;
    UserPromptSubmit?: AdapterFactsV4HookRule;
    PreToolUse?: AdapterFactsV4HookRule;
    PermissionRequest?: AdapterFactsV4HookRule;
    PostToolUse?: AdapterFactsV4HookRule;
    PostToolUseFailure?: AdapterFactsV4HookRule;
    Stop?: AdapterFactsV4HookRule;
    StopFailure?: AdapterFactsV4HookRule;
    SessionEnd?: AdapterFactsV4HookRule;
    SubagentStart?: AdapterFactsV4HookRule;
    SubagentStop?: AdapterFactsV4HookRule;
    TaskCreated?: AdapterFactsV4HookRule;
    TaskCompleted?: AdapterFactsV4HookRule;
    Notification?: AdapterFactsV4HookRule;
    Elicitation?: AdapterFactsV4HookRule;
    ElicitationResult?: AdapterFactsV4HookRule;
    TeammateIdle?: AdapterFactsV4HookRule;
    WorktreeCreate?: AdapterFactsV4HookRule;
    WorktreeRemove?: AdapterFactsV4HookRule;
    PreCompact?: AdapterFactsV4HookRule;
    PostCompact?: AdapterFactsV4HookRule;
    Interrupt?: AdapterFactsV4HookRule;
    sessionStart?: AdapterFactsV4HookRule;
    sessionEnd?: AdapterFactsV4HookRule;
    preToolUse?: AdapterFactsV4HookRule;
    postToolUse?: AdapterFactsV4HookRule;
    stop?: AdapterFactsV4HookRule;
  };
  toolKinds: {
    readBy: AdapterFactsV4Text;
    conformance: AdapterFactsV4Text;
    tools: { [key: string]: AdapterFactsV4ToolKind };
    prefixes?: { [key: string]: AdapterFactsV4ToolKind };
    otherwise: AdapterFactsV4ToolKind;
  };
  toolDetail?: {
    readBy: AdapterFactsV4Text;
    conformance: AdapterFactsV4Text;
    command?: AdapterFactsV4TextMap;
    paths?: AdapterFactsV4TextMap;
    mcp?: {
      tool: AdapterFactsV4Text;
    };
  };
  patch?: {
    readBy: AdapterFactsV4Text;
    conformance: AdapterFactsV4Text;
    tools: AdapterFactsV4Texts;
    command: AdapterFactsV4Text;
    shell: AdapterFactsV4Text;
  };
  turnWithoutPrompt?: {
    readBy: AdapterFactsV4Text;
    conformance: AdapterFactsV4Text;
    payloadField: AdapterFactsV4Text;
    startedBy: AdapterFactsV4Texts;
    turnEntry: AdapterFactsV4Text;
    turnField: AdapterFactsV4Text;
    messageRole: {
      path: AdapterFactsV4Text;
      value: AdapterFactsV4Text;
    };
    messageText: AdapterFactsV4Text;
    values: AdapterFactsV4MarkerMap;
    otherwise: AdapterFactsV4Text;
  };
  signIn?: {
    readBy: AdapterFactsV4Text;
    conformance: AdapterFactsV4Text;
    args: AdapterFactsV4Texts;
    signedIn: AdapterFactsV4Text;
  };
  stop?: {
    readBy: AdapterFactsV4Text;
    conformance: AdapterFactsV4Text;
    turn: {
      payload: AdapterFactsV4Text;
      transcript: AdapterFactsV4Text;
      elsewhere?: AdapterFactsV4Text;
    };
    cause: {
      readBy?: AdapterFactsV4Text;
      payload?: {
        field: AdapterFactsV4Text;
        values: AdapterFactsV4CauseMap;
      };
      errors?: {
        match: AdapterFactsV4Match;
        field: AdapterFactsV4Text;
        values: AdapterFactsV4CauseMap;
      };
      rateLimits?: {
        match: AdapterFactsV4Match;
        reached: AdapterFactsV4Text;
        windows: AdapterFactsV4Texts;
        used: AdapterFactsV4Text;
        resetsAt: AdapterFactsV4Text;
        toMs: number;
        spent: AdapterFactsV4StopCause;
        withoutReset: AdapterFactsV4StopCause;
      };
      otherwise: AdapterFactsV4StopCause;
    };
    usage: {
      readBy?: AdapterFactsV4Text;
      covers: "turn" | "session";
      records: {
        match: AdapterFactsV4Match;
        has: AdapterFactsV4Text;
        skip?: AdapterFactsV4Match;
        once?: AdapterFactsV4Text;
      };
      take: "sum" | "last";
      counts: {
        input: AdapterFactsV4Texts;
        cached: AdapterFactsV4Texts;
        output: AdapterFactsV4Texts;
      };
      exact: boolean;
      model: {
        record?: AdapterFactsV4Text;
        payload?: AdapterFactsV4Text;
      };
      contextFill?: {
        used: AdapterFactsV4Texts;
        window: AdapterFactsV4Text;
      };
    };
  };
  readUsage?: AdapterFactsV4Operation;
  taskList?: {
    readBy: AdapterFactsV4Text;
    conformance: AdapterFactsV4Text;
    tool: AdapterFactsV4Text;
    items: AdapterFactsV4Text;
    text: AdapterFactsV4Text;
    status: AdapterFactsV4Text;
    open: AdapterFactsV4Texts;
  };
  tokenizer?: {
    readBy: AdapterFactsV4Text;
    conformance: AdapterFactsV4Text;
    name: AdapterFactsV4Text;
    package: AdapterFactsV4Text;
    version: AdapterFactsV4Version;
  };
  mods?: {
    readBy: AdapterFactsV4Text;
    conformance: AdapterFactsV4Text;
    since: {
      terminal: AdapterFactsV4Version;
      desktop: AdapterFactsV4Version;
    };
    validate: {
      args: AdapterFactsV4Texts;
      hooks: AdapterFactsV4Text;
      calls: AdapterFactsV4Text;
    };
    overrides: {
      event: AdapterFactsV4Text;
      past: AdapterFactsV4Text;
    };
    promptCalls: AdapterFactsV4Texts;
    holdsWhen: Array<{
      case: "managed" | "login" | "plan" | "interactive";
      text: AdapterFactsV4Text;
      subscriptionTypes?: AdapterFactsV4Texts;
      mode?: AdapterFactsV4Text;
      since?: AdapterFactsV4Version;
      tools?: AdapterFactsV4Texts;
    }>;
  };
  classifyStop?: AdapterFactsV4Operation;
  skills?: AdapterFactsV4Operation;
  entries?: {
    readBy?: string;
    name: string;
    home?: string;
    mcp?: {
      file: string;
      format: "json" | "toml";
      key: string;
      perProject?: string;
      transports: {
        stdio?: {
          type?: string;
          fields: Array<string>;
          names?: { [key: string]: string };
          commandArray?: boolean;
        };
        http?: {
          type?: string;
          fields: Array<string>;
          names?: { [key: string]: string };
          commandArray?: boolean;
        };
      };
      refused: Array<{
        transport: "stdio" | "http";
        field: string;
        reason?: string;
      }>;
      list?: Array<string>;
    };
    skills?: {
      write: string;
      readFrom: Array<string>;
    };
  };
  daemon?: {
    readBy?: string;
    restart: Array<string>;
    picksUp: { [key: string]: {
      "hooks.json": boolean;
      mcp_servers: boolean;
      readBy?: string;
    } };
  };
}

export type AdapterFactsV5Text = string;

export type AdapterFactsV5Match = { [key: string]: unknown };

export type AdapterFactsV5Texts = Array<AdapterFactsV5Text>;

export type AdapterFactsV5Version = string;

export type AdapterFactsV5Reach = "model" | "user" | "debug" | "none";

export type AdapterFactsV5TextMap = { [key: string]: AdapterFactsV5Text };

export type AdapterFactsV5DataTemplate = { [key: string]: AdapterFactsV5Text };

export type AdapterFactsV5FieldTypes = { [key: string]: string };

export type AdapterFactsV5Payload = {
  required: AdapterFactsV5FieldTypes;
  optional: AdapterFactsV5FieldTypes;
  tools?: { [key: string]: AdapterFactsV5FieldTypes };
};

export type AdapterFactsV5ToolKind = "shell" | "read" | "edit" | "write" | "search" | "fetch" | "mcp" | "unknown";

export type AdapterFactsV5StopCause = "sign_in_required" | "token_refresh_failed" | "plan_window_spent" | "rate_limited" | "refusal" | "max_turns" | "context_overflow" | "tool_schema_rejected" | "agent_crashed" | "timed_out" | "unknown";

export type AdapterFactsV5CauseMap = { [key: string]: AdapterFactsV5StopCause };

export type AdapterFactsV5OriginRule = {
  prompt?: AdapterFactsV5Text;
  match?: { [key: string]: unknown };
  from: AdapterFactsV5Text;
};

export type AdapterFactsV5HookRule = {
  kind: string;
  data?: AdapterFactsV5DataTemplate;
  origin?: {
    join?: {
      payload: AdapterFactsV5Text;
      transcript: AdapterFactsV5Text;
    };
    rules: Array<AdapterFactsV5OriginRule>;
    otherwise: AdapterFactsV5Text;
  };
  call?: "kind" | "detail";
  stop?: boolean;
  cause?: {
    field: AdapterFactsV5Text;
    values: AdapterFactsV5CauseMap;
    otherwise: AdapterFactsV5StopCause;
  };
  state?: {
    field: AdapterFactsV5Text;
    values: { [key: string]: "working" | "waiting" | "finished" };
  };
};

export type AdapterFactsV5Operation = {
  readBy: AdapterFactsV5Text;
  conformance: AdapterFactsV5Text;
};

export type AdapterFactsV5MarkerMap = { [key: string]: AdapterFactsV5Text };

/** adapter.facts@5 */
export interface AdapterFactsV5 {
  schema: "adapter.facts@5";
  versions: Array<AdapterFactsV5Version>;
  agent: string;
  hookTimeouts: {
    readBy: AdapterFactsV5Text;
    conformance: AdapterFactsV5Text;
    defaultMs?: number | null;
    perHook?: { [key: string]: number };
  };
  routes?: {
    network: {
      readBy: AdapterFactsV5Text;
      measured: AdapterFactsV5Text;
      hookOverheadMs: number;
      failOpenMs: number;
    };
  };
  continuation: {
    readBy: AdapterFactsV5Text;
    conformance: AdapterFactsV5Text;
    cap?: number;
    field?: AdapterFactsV5Text;
  };
  launch: {
    readBy: AdapterFactsV5Text;
    conformance: AdapterFactsV5Text;
    session?: {
      readBy?: AdapterFactsV5Text;
      args: AdapterFactsV5Texts;
    };
    readOnlyJob?: {
      readBy?: AdapterFactsV5Text;
      args: AdapterFactsV5Texts;
      prompt: AdapterFactsV5Text;
    };
    started?: {
      readBy?: AdapterFactsV5Text;
      args: AdapterFactsV5Texts;
      asks: AdapterFactsV5Text;
      modes: AdapterFactsV5TextMap;
      skipping: AdapterFactsV5Texts;
      nested: AdapterFactsV5Texts;
      home: AdapterFactsV5Text;
      defaultHome: AdapterFactsV5Text;
      trust?: {
        readBy?: AdapterFactsV5Text;
        file: AdapterFactsV5Text;
        homeFile: AdapterFactsV5Text;
        set: AdapterFactsV5Text;
      };
    };
  };
  sandbox?: {
    readBy: AdapterFactsV5Text;
    conformance: AdapterFactsV5Text;
    versions: { [key: string]: {
      settings?: AdapterFactsV5Text;
      args?: AdapterFactsV5Texts;
      modes?: AdapterFactsV5TextMap;
      walls: {
        writes?: AdapterFactsV5Text;
        credentials?: AdapterFactsV5Text;
        network?: AdapterFactsV5Text;
      };
      wayOut: {
        call: AdapterFactsV5Text;
        setting: AdapterFactsV5Text;
        off: boolean;
      };
    } };
  };
  modelFamily: {
    readBy: AdapterFactsV5Text;
    conformance: AdapterFactsV5Text;
    families: AdapterFactsV5TextMap;
  };
  billing: {
    readBy: AdapterFactsV5Text;
    conformance: AdapterFactsV5Text;
    apiKeyVariables: AdapterFactsV5Texts;
  };
  usage: {
    readBy: AdapterFactsV5Text;
    conformance: AdapterFactsV5Text;
    cost: "reported" | "estimated" | "unpriced";
    costFrom: AdapterFactsV5Text;
    tokens: AdapterFactsV5Text;
  };
  questionTools: {
    readBy: AdapterFactsV5Text;
    conformance: AdapterFactsV5Text;
    tools: AdapterFactsV5Texts;
  };
  transcripts: {
    readBy: AdapterFactsV5Text;
    conformance: AdapterFactsV5Text;
    home: Array<AdapterFactsV5Text>;
    path: AdapterFactsV5Text;
    archived?: AdapterFactsV5Text;
  };
  appLinks: {
    readBy: AdapterFactsV5Text;
    conformance: AdapterFactsV5Text;
    open: AdapterFactsV5Text;
  };
  errorTexts: {
    readBy: AdapterFactsV5Text;
    conformance: AdapterFactsV5Text;
    causes: AdapterFactsV5CauseMap;
  };
  events: {
    readBy: AdapterFactsV5Text;
    conformance: AdapterFactsV5Text;
    versions: { [key: string]: { [key: string]: AdapterFactsV5Payload } };
  };
  mapping: {
    readBy: AdapterFactsV5Text;
    conformance: AdapterFactsV5Text;
    common: AdapterFactsV5DataTemplate;
    SessionStart?: AdapterFactsV5HookRule;
    UserPromptSubmit?: AdapterFactsV5HookRule;
    PreToolUse?: AdapterFactsV5HookRule;
    PermissionRequest?: AdapterFactsV5HookRule;
    PostToolUse?: AdapterFactsV5HookRule;
    PostToolUseFailure?: AdapterFactsV5HookRule;
    Stop?: AdapterFactsV5HookRule;
    StopFailure?: AdapterFactsV5HookRule;
    SessionEnd?: AdapterFactsV5HookRule;
    SubagentStart?: AdapterFactsV5HookRule;
    SubagentStop?: AdapterFactsV5HookRule;
    TaskCreated?: AdapterFactsV5HookRule;
    TaskCompleted?: AdapterFactsV5HookRule;
    Notification?: AdapterFactsV5HookRule;
    Elicitation?: AdapterFactsV5HookRule;
    ElicitationResult?: AdapterFactsV5HookRule;
    TeammateIdle?: AdapterFactsV5HookRule;
    WorktreeCreate?: AdapterFactsV5HookRule;
    WorktreeRemove?: AdapterFactsV5HookRule;
    PreCompact?: AdapterFactsV5HookRule;
    PostCompact?: AdapterFactsV5HookRule;
    Interrupt?: AdapterFactsV5HookRule;
    sessionStart?: AdapterFactsV5HookRule;
    sessionEnd?: AdapterFactsV5HookRule;
    preToolUse?: AdapterFactsV5HookRule;
    postToolUse?: AdapterFactsV5HookRule;
    stop?: AdapterFactsV5HookRule;
  };
  toolKinds: {
    readBy: AdapterFactsV5Text;
    conformance: AdapterFactsV5Text;
    tools: { [key: string]: AdapterFactsV5ToolKind };
    prefixes?: { [key: string]: AdapterFactsV5ToolKind };
    otherwise: AdapterFactsV5ToolKind;
  };
  toolDetail?: {
    readBy: AdapterFactsV5Text;
    conformance: AdapterFactsV5Text;
    command?: AdapterFactsV5TextMap;
    paths?: AdapterFactsV5TextMap;
    mcp?: {
      tool: AdapterFactsV5Text;
    };
  };
  patch?: {
    readBy: AdapterFactsV5Text;
    conformance: AdapterFactsV5Text;
    tools: AdapterFactsV5Texts;
    command: AdapterFactsV5Text;
    shell: AdapterFactsV5Text;
  };
  turnWithoutPrompt?: {
    readBy: AdapterFactsV5Text;
    conformance: AdapterFactsV5Text;
    payloadField: AdapterFactsV5Text;
    startedBy: AdapterFactsV5Texts;
    turnEntry: AdapterFactsV5Text;
    turnField: AdapterFactsV5Text;
    messageRole: {
      path: AdapterFactsV5Text;
      value: AdapterFactsV5Text;
    };
    messageText: AdapterFactsV5Text;
    values: AdapterFactsV5MarkerMap;
    otherwise: AdapterFactsV5Text;
  };
  signIn?: {
    readBy: AdapterFactsV5Text;
    conformance: AdapterFactsV5Text;
    args: AdapterFactsV5Texts;
    signedIn: AdapterFactsV5Text;
  };
  stop?: {
    readBy: AdapterFactsV5Text;
    conformance: AdapterFactsV5Text;
    turn: {
      payload: AdapterFactsV5Text;
      transcript: AdapterFactsV5Text;
      elsewhere?: AdapterFactsV5Text;
    };
    cause: {
      readBy?: AdapterFactsV5Text;
      payload?: {
        field: AdapterFactsV5Text;
        values: AdapterFactsV5CauseMap;
      };
      errors?: {
        match: AdapterFactsV5Match;
        field: AdapterFactsV5Text;
        values: AdapterFactsV5CauseMap;
      };
      rateLimits?: {
        match: AdapterFactsV5Match;
        reached: AdapterFactsV5Text;
        windows: AdapterFactsV5Texts;
        used: AdapterFactsV5Text;
        resetsAt: AdapterFactsV5Text;
        toMs: number;
        spent: AdapterFactsV5StopCause;
        withoutReset: AdapterFactsV5StopCause;
      };
      otherwise: AdapterFactsV5StopCause;
    };
    usage: {
      readBy?: AdapterFactsV5Text;
      covers: "turn" | "session";
      records: {
        match: AdapterFactsV5Match;
        has: AdapterFactsV5Text;
        skip?: AdapterFactsV5Match;
        once?: AdapterFactsV5Text;
      };
      take: "sum" | "last";
      counts: {
        input: AdapterFactsV5Texts;
        cached: AdapterFactsV5Texts;
        output: AdapterFactsV5Texts;
      };
      exact: boolean;
      model: {
        record?: AdapterFactsV5Text;
        payload?: AdapterFactsV5Text;
      };
      contextFill?: {
        used: AdapterFactsV5Texts;
        window: AdapterFactsV5Text;
      };
    };
  };
  readUsage?: AdapterFactsV5Operation;
  taskList?: {
    readBy: AdapterFactsV5Text;
    conformance: AdapterFactsV5Text;
    tool: AdapterFactsV5Text;
    items: AdapterFactsV5Text;
    text: AdapterFactsV5Text;
    status: AdapterFactsV5Text;
    open: AdapterFactsV5Texts;
  };
  tokenizer?: {
    readBy: AdapterFactsV5Text;
    conformance: AdapterFactsV5Text;
    name: AdapterFactsV5Text;
    package: AdapterFactsV5Text;
    version: AdapterFactsV5Version;
  };
  mods?: {
    readBy: AdapterFactsV5Text;
    conformance: AdapterFactsV5Text;
    since: {
      terminal: AdapterFactsV5Version;
      desktop: AdapterFactsV5Version;
    };
    validate: {
      args: AdapterFactsV5Texts;
      hooks: AdapterFactsV5Text;
      calls: AdapterFactsV5Text;
    };
    overrides: {
      event: AdapterFactsV5Text;
      past: AdapterFactsV5Text;
    };
    promptCalls: AdapterFactsV5Texts;
    holdsWhen: Array<{
      case: "managed" | "login" | "plan" | "interactive";
      text: AdapterFactsV5Text;
      subscriptionTypes?: AdapterFactsV5Texts;
      mode?: AdapterFactsV5Text;
      since?: AdapterFactsV5Version;
      tools?: AdapterFactsV5Texts;
    }>;
  };
  contextOutput?: {
    readBy: AdapterFactsV5Text;
    conformance: AdapterFactsV5Text;
    capChars: number;
    previewChars: number;
    versions: Array<AdapterFactsV5Version>;
    source: AdapterFactsV5Text;
    events: { [key: string]: {
      additionalContext: AdapterFactsV5Reach;
      systemMessage: AdapterFactsV5Reach;
      stdout: AdapterFactsV5Reach;
      stderr: AdapterFactsV5Reach;
      stderrOnBlock: AdapterFactsV5Reach;
    } };
  };
  classifyStop?: AdapterFactsV5Operation;
  skills?: AdapterFactsV5Operation;
  entries?: {
    readBy?: string;
    name: string;
    home?: string;
    mcp?: {
      file: string;
      format: "json" | "toml";
      key: string;
      perProject?: string;
      transports: {
        stdio?: {
          type?: string;
          fields: Array<string>;
          names?: { [key: string]: string };
          commandArray?: boolean;
        };
        http?: {
          type?: string;
          fields: Array<string>;
          names?: { [key: string]: string };
          commandArray?: boolean;
        };
      };
      refused: Array<{
        transport: "stdio" | "http";
        field: string;
        reason?: string;
      }>;
      list?: Array<string>;
    };
    skills?: {
      write: string;
      readFrom: Array<string>;
    };
  };
  daemon?: {
    readBy?: string;
    restart: Array<string>;
    picksUp: { [key: string]: {
      "hooks.json": boolean;
      mcp_servers: boolean;
      readBy?: string;
    } };
  };
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

export type AgentStopV4Turn = number;

export type AgentStopV4Usage = {
  covers: "turn" | "session";
  model: string | null;
  input: AgentStopV4Count;
  cached: AgentStopV4Count;
  output: AgentStopV4Count;
  context_fill: number | null;
  cost: AgentStopV4Cost;
} | null;

export type AgentStopV4Count = null | {
  value: number;
  exact: true;
} | {
  value: number;
  exact: false;
};

export type AgentStopV4Cost = {
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

export type AgentStopV4Loop = {
  state: "looping";
  due: number | null;
} | {
  state: "none_left";
};

/** agent.stop@4 */
export interface AgentStopV4 {
  v: 4;
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
    turn: AgentStopV4Turn;
    did_work: boolean;
    claim: boolean;
    cause: "sign_in_required";
    usage: AgentStopV4Usage;
    outcome: "finished" | "failed";
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV4Loop;
  } | {
    turn: AgentStopV4Turn;
    did_work: boolean;
    claim: boolean;
    cause: "token_refresh_failed";
    usage: AgentStopV4Usage;
    outcome: "finished" | "failed";
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV4Loop;
  } | {
    turn: AgentStopV4Turn;
    did_work: boolean;
    claim: boolean;
    cause: "plan_window_spent";
    plan_resets: number;
    usage: AgentStopV4Usage;
    outcome: "finished" | "failed";
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV4Loop;
  } | {
    turn: AgentStopV4Turn;
    did_work: boolean;
    claim: boolean;
    cause: "rate_limited";
    usage: AgentStopV4Usage;
    outcome: "finished" | "failed";
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV4Loop;
  } | {
    turn: AgentStopV4Turn;
    did_work: boolean;
    claim: boolean;
    cause: "refusal";
    usage: AgentStopV4Usage;
    outcome: "finished" | "failed";
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV4Loop;
  } | {
    turn: AgentStopV4Turn;
    did_work: boolean;
    claim: boolean;
    cause: "max_turns";
    usage: AgentStopV4Usage;
    outcome: "finished" | "failed";
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV4Loop;
  } | {
    turn: AgentStopV4Turn;
    did_work: boolean;
    claim: boolean;
    cause: "context_overflow";
    usage: AgentStopV4Usage;
    outcome: "finished" | "failed";
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV4Loop;
  } | {
    turn: AgentStopV4Turn;
    did_work: boolean;
    claim: boolean;
    cause: "tool_schema_rejected";
    usage: AgentStopV4Usage;
    outcome: "finished" | "failed";
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV4Loop;
  } | {
    turn: AgentStopV4Turn;
    did_work: boolean;
    claim: boolean;
    cause: "agent_crashed";
    usage: AgentStopV4Usage;
    outcome: "finished" | "failed";
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV4Loop;
  } | {
    turn: AgentStopV4Turn;
    did_work: boolean;
    claim: boolean;
    cause: "timed_out";
    usage: AgentStopV4Usage;
    outcome: "finished" | "failed";
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV4Loop;
  } | {
    turn: AgentStopV4Turn;
    did_work: boolean;
    claim: boolean;
    cause: "unknown";
    usage: AgentStopV4Usage;
    outcome: "finished" | "failed";
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV4Loop;
  };
  evidence?: Array<string>;
}

export type AgentStopV5Turn = number;

export type AgentStopV5Usage = {
  covers: "turn" | "session";
  model: string | null;
  input: AgentStopV5Count;
  cached: AgentStopV5Count;
  output: AgentStopV5Count;
  context_fill: number | null;
  cost: AgentStopV5Cost;
} | null;

export type AgentStopV5Count = null | {
  value: number;
  exact: true;
} | {
  value: number;
  exact: false;
};

export type AgentStopV5Cost = {
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

export type AgentStopV5Loop = {
  state: "looping";
  due: number | null;
} | {
  state: "none_left";
};

/** agent.stop@5 */
export interface AgentStopV5 {
  v: 5;
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
    turn: AgentStopV5Turn;
    did_work: boolean;
    claim: boolean;
    cause: "sign_in_required";
    usage: AgentStopV5Usage;
    outcome: "finished" | "failed";
    child?: string;
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV5Loop;
  } | {
    turn: AgentStopV5Turn;
    did_work: boolean;
    claim: boolean;
    cause: "token_refresh_failed";
    usage: AgentStopV5Usage;
    outcome: "finished" | "failed";
    child?: string;
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV5Loop;
  } | {
    turn: AgentStopV5Turn;
    did_work: boolean;
    claim: boolean;
    cause: "plan_window_spent";
    plan_resets: number;
    usage: AgentStopV5Usage;
    outcome: "finished" | "failed";
    child?: string;
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV5Loop;
  } | {
    turn: AgentStopV5Turn;
    did_work: boolean;
    claim: boolean;
    cause: "rate_limited";
    usage: AgentStopV5Usage;
    outcome: "finished" | "failed";
    child?: string;
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV5Loop;
  } | {
    turn: AgentStopV5Turn;
    did_work: boolean;
    claim: boolean;
    cause: "refusal";
    usage: AgentStopV5Usage;
    outcome: "finished" | "failed";
    child?: string;
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV5Loop;
  } | {
    turn: AgentStopV5Turn;
    did_work: boolean;
    claim: boolean;
    cause: "max_turns";
    usage: AgentStopV5Usage;
    outcome: "finished" | "failed";
    child?: string;
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV5Loop;
  } | {
    turn: AgentStopV5Turn;
    did_work: boolean;
    claim: boolean;
    cause: "context_overflow";
    usage: AgentStopV5Usage;
    outcome: "finished" | "failed";
    child?: string;
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV5Loop;
  } | {
    turn: AgentStopV5Turn;
    did_work: boolean;
    claim: boolean;
    cause: "tool_schema_rejected";
    usage: AgentStopV5Usage;
    outcome: "finished" | "failed";
    child?: string;
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV5Loop;
  } | {
    turn: AgentStopV5Turn;
    did_work: boolean;
    claim: boolean;
    cause: "agent_crashed";
    usage: AgentStopV5Usage;
    outcome: "finished" | "failed";
    child?: string;
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV5Loop;
  } | {
    turn: AgentStopV5Turn;
    did_work: boolean;
    claim: boolean;
    cause: "timed_out";
    usage: AgentStopV5Usage;
    outcome: "finished" | "failed";
    child?: string;
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV5Loop;
  } | {
    turn: AgentStopV5Turn;
    did_work: boolean;
    claim: boolean;
    cause: "unknown";
    usage: AgentStopV5Usage;
    outcome: "finished" | "failed";
    child?: string;
    signature?: string;
    owner?: "agent" | "you" | "service";
    loop?: AgentStopV5Loop;
  };
  evidence?: Array<string>;
}

/** agents.synced@1 */
export interface AgentsSynced {
  v: 1;
  id: string;
  kind: "agents.synced";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    sync: string;
    item: {
      kind: "server" | "skill";
      server?: {
        name: string;
        transport: "stdio" | "http";
        command?: string;
        args?: Array<string>;
        env?: { [key: string]: string };
        url?: string;
        headers?: { [key: string]: string };
        secrets?: Array<string>;
        scope?: {
          repos: Array<string>;
        };
      };
      skill?: {
        name: string;
        repo: string;
        commit: string;
        path: string;
        digest: string;
        files: Array<{
          rel: string;
          mode: number;
          sha: string;
        }>;
        license: string;
        scripts: Array<string>;
        findings: Array<string>;
      };
    };
    agents: Array<string>;
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

export type AskAnsweredV3PinnedTo = {
  kind: "commit";
  ref: string;
} | {
  kind: "doc_revision";
  ref: string;
} | {
  kind: "evidence";
  ref: string;
};

/** ask.answered@3 */
export interface AskAnsweredV3 {
  v: 3;
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
    on: AskAnsweredV3PinnedTo;
    token: string | null;
    steps?: Array<number>;
  };
  evidence?: Array<string>;
}

export type AskAnsweredV4PinnedTo = {
  kind: "commit";
  ref: string;
} | {
  kind: "doc_revision";
  ref: string;
} | {
  kind: "evidence";
  ref: string;
};

/** ask.answered@4 */
export interface AskAnsweredV4 {
  v: 4;
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
    on: AskAnsweredV4PinnedTo;
    token: string | null;
    steps?: Array<number>;
    words: string | null;
    image: string | null;
  };
  evidence?: Array<string>;
}

export type AskAnsweredV5PinnedTo = {
  kind: "commit";
  ref: string;
} | {
  kind: "doc_revision";
  ref: string;
} | {
  kind: "evidence";
  ref: string;
};

/** ask.answered@5 */
export interface AskAnsweredV5 {
  v: 5;
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
    via: "card" | "inbox" | "session" | "channel";
    verified: boolean;
    on: AskAnsweredV5PinnedTo;
    token: string | null;
    steps?: Array<number>;
    words: string | null;
    image: string | null;
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
    thread?: {
      link: string;
      expect: string;
    };
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

export type AskCreatedV4PinnedTo = {
  kind: "commit";
  ref: string;
} | {
  kind: "doc_revision";
  ref: string;
} | {
  kind: "evidence";
  ref: string;
};

export type AskCreatedV4Options = Array<{
  id: string;
  label: string;
  decision: "allow" | "deny" | "none";
}>;

export type AskCreatedV4SubjectEffect = {
  effect: string;
  target: {
    kind: string;
    ref: string;
    owner: string;
  };
  change: {
    kind: string;
    lines: number;
    paths: Array<string>;
  } | null;
};

export type AskCreatedV4SubjectTaste = {
  screen: string;
  element: string;
};

export type AskCreatedV4SubjectPoint = {
  point: string;
};

/** ask.created@4 */
export interface AskCreatedV4 {
  v: 4;
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
    options: AskCreatedV4Options;
    recommended: string | null;
    deadline: number;
    fallback: string;
    default: string;
    provisional: boolean;
    owner: string;
    key: string;
    pinned_to: AskCreatedV4PinnedTo;
    subject?: AskCreatedV4SubjectEffect;
  } | {
    kind: "unblock";
    question: string;
    options: AskCreatedV4Options;
    recommended: string | null;
    deadline: number;
    fallback: string;
    default: string;
    provisional: boolean;
    owner: string;
    key: string;
    pinned_to: AskCreatedV4PinnedTo;
    steps: Array<string>;
    where: string;
    why: string;
    unblocks: Array<string>;
    proves: string;
    cost_usd?: number;
  } | {
    kind: "taste";
    question: string;
    options: AskCreatedV4Options;
    recommended: string | null;
    deadline: number;
    fallback: string;
    default: string;
    provisional: boolean;
    owner: string;
    key: string;
    pinned_to: AskCreatedV4PinnedTo;
    dropped?: Array<{
      option: string;
      same_as: string;
    }>;
    subject?: AskCreatedV4SubjectTaste;
  } | {
    kind: "exception";
    question: string;
    options: AskCreatedV4Options;
    recommended: string | null;
    deadline: number;
    fallback: string;
    default: string;
    provisional: boolean;
    owner: string;
    key: string;
    pinned_to: AskCreatedV4PinnedTo;
  } | {
    kind: "choice";
    question: string;
    options: AskCreatedV4Options;
    recommended: string | null;
    deadline: number;
    fallback: string;
    default: string;
    provisional: boolean;
    owner: string;
    key: string;
    pinned_to: AskCreatedV4PinnedTo;
    subject?: AskCreatedV4SubjectPoint;
  } | {
    kind: "definition";
    question: string;
    options: AskCreatedV4Options;
    recommended: string | null;
    deadline: number;
    fallback: string;
    default: string;
    provisional: boolean;
    owner: string;
    key: string;
    pinned_to: AskCreatedV4PinnedTo;
    subject?: AskCreatedV4SubjectPoint;
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

/** ask.moot@2 */
export interface AskMootV2 {
  v: 2;
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
  } | {
    because: "window_reset";
    at: number;
  } | {
    because: "thread_replied";
    link: string;
  } | {
    because: "network_reached";
    host: string;
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

/** ask.taken_over@1 */
export interface AskTakenOver {
  v: 1;
  id: string;
  kind: "ask.taken_over";
  subject: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    device: string;
    revision: number;
  };
  evidence?: Array<string>;
}

/** attempt.started@1 */
export interface AttemptStarted {
  v: 1;
  id: string;
  kind: "attempt.started";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    issue: string;
    branch: string;
    commit: string;
    base: string;
  };
  evidence?: Array<string>;
}

/** build.rolled_back@1 */
export interface BuildRolledBack {
  v: 1;
  id: string;
  kind: "build.rolled_back";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    commit: string;
    restored: string;
    why: string;
  };
}

/** call.overrun@1 */
export interface CallOverrun {
  v: 1;
  id: string;
  kind: "call.overrun";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    call: string;
    kind: string;
    command: string | null;
    expected_ms: number;
    ran_ms: number;
    deadline: "attached" | "recorded" | "none";
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

/** card_rule.set@1 */
export interface CardRuleSet {
  v: 1;
  id: string;
  kind: "card_rule.set";
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    seller: string;
    max_usd: number;
    card: string;
    via: "card" | "inbox";
  };
  evidence?: Array<string>;
}

/** channel.answered@1 */
export interface ChannelAnswered {
  v: 1;
  id: string;
  kind: "channel.answered";
  subject: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    channel: string;
    thread_key: string;
    answer: string;
    proof: "device" | "account_link";
  };
  evidence?: Array<string>;
}

/** channel.conflict@1 */
export interface ChannelConflict {
  v: 1;
  id: string;
  kind: "channel.conflict";
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    channel: string;
    conflict: string;
  };
  evidence?: Array<string>;
}

/** channel.delivered@1 */
export interface ChannelDelivered {
  v: 1;
  id: string;
  kind: "channel.delivered";
  subject: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    channel: string;
    thread_key: string;
    item: {
      thread_key: string;
      summary: string;
      link: string;
      answerable: "answer" | "view" | "cancel" | "closed";
      options: Array<{
        id: string;
        label: string;
      }>;
      plan?: {
        hash: string;
        steps: Array<{
          does: string;
          changes: Array<string>;
          undo: string;
          public: boolean;
          cost: number;
        }>;
      };
      revision: number;
      hub: string;
      refused: string | null;
      unpaired?: {
        device: string;
        by: string;
      };
    };
    outcome: "delivered" | "stalled" | "timed_out" | "conflict";
    ack: string | null;
  };
  evidence?: Array<string>;
}

/** channel.refused@1 */
export interface ChannelRefused {
  v: 1;
  id: string;
  kind: "channel.refused";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    channel: string;
    thread_key: string;
    answer: string;
    field?: "device" | "ask" | "revision" | "card_hash" | "plan_hash" | "hub" | "at" | "signature" | "answer" | "account_link_id" | "method" | "once" | "params";
    reason: string;
  };
  evidence?: Array<string>;
}

/** check.code@1 */
export type CheckCode = "exit_masked" | "no_tests_ran" | "crashed_before_first_assertion" | "reported_after_deadline" | "output_dropped" | "type_error_as_assertion";

/** check.held@1 */
export interface CheckHeld {
  v: 1;
  id: string;
  kind: "check.held";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    session: string;
    claim: string;
    check: string;
    snapshot: string;
    held_at: number;
    reason: string;
    started_at: number | null;
    started_by: string | null;
    replaced_by: string | null;
  };
  evidence?: Array<string>;
}

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

/** claim.made@3 */
export interface ClaimMadeV3 {
  v: 3;
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
    hash: string;
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

/** claim.sized@1 */
export interface ClaimSized {
  v: 1;
  id: string;
  kind: "claim.sized";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    claim: string;
    task_ref: string;
    kind: string | null;
    lines: {
      added: number;
      removed: number;
    };
    files: number;
    usual: {
      lines: number;
      files: number;
      n: number;
    } | null;
    over: boolean;
    biggest: Array<{
      path: string;
      lines: number;
    }>;
    dependencies: Array<{
      name: string;
      from: string;
    }>;
    folders: Array<{
      name: string;
      from: string;
    }>;
    resources: Array<{
      name: string;
      from: string;
    }>;
    duplicated: number;
    unreached: Array<string> | null;
    items: Array<{
      doc: string;
      id: string;
      change: "added" | "changed" | "removed";
    }>;
    sent_back: Array<string>;
    asked: Array<string>;
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

/** command.staged@1 */
export interface CommandStaged {
  v: 1;
  id: string;
  kind: "command.staged";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    call: string;
    command: string;
    folders: Array<string>;
    until: number;
  };
  evidence?: Array<string>;
}

/** command.staged@2 */
export interface CommandStagedV2 {
  v: 2;
  id: string;
  kind: "command.staged";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    call: string;
    command: string;
    folders: Array<string>;
    files?: Array<{
      path: string;
      digest: string;
    }>;
    until: number;
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

/** composition.reopened@1 */
export interface CompositionReopened {
  v: 1;
  id: string;
  kind: "composition.reopened";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  evidence?: Array<string>;
  data: {
    piece: string;
    provider: string;
    version: string;
  };
}

/** composition.tested@1 */
export interface CompositionTested {
  v: 1;
  id: string;
  kind: "composition.tested";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  evidence?: Array<string>;
  data: {
    user: string;
    interface: string;
    provider: string;
    version: string;
    passed: boolean;
  };
}

/** composition.used@1 */
export interface CompositionUsed {
  v: 1;
  id: string;
  kind: "composition.used";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  evidence?: Array<string>;
  data: {
    user: string;
    interface: string;
    provider: string;
  };
}

/** credential.loaded@1 */
export interface CredentialLoaded {
  v: 1;
  id: string;
  kind: "credential.loaded";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    run: string;
    env: string;
    by: "value" | "stand-in";
    hosts?: Array<string>;
  };
  evidence?: Array<string>;
}

/** deadline.moved@1 */
export interface DeadlineMoved {
  v: 1;
  id: string;
  kind: "deadline.moved";
  subject: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    span: number;
    deadline: number;
    because: "away" | "notice";
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

/** decision.judged@1 */
export interface DecisionJudged {
  v: 1;
  id: string;
  kind: "decision.judged";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    decision: string;
    state: "active" | "frozen" | "revoked";
    verdict: "widen" | "undecided" | "FAIL";
    rule: {
      cases: number;
      broke: number;
      lower: number;
      upper: number;
    };
    yours: {
      cases: number;
      broke: number;
      upper: number;
    };
    margin: number;
    limit: number;
    more: number | null;
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

/** decision.overruled@2 */
export interface DecisionOverruledV2 {
  v: 2;
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
    at: string;
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

/** definition.checked@1 */
export interface DefinitionChecked {
  v: 1;
  id: string;
  kind: "definition.checked";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    task_ref: string;
    solved: boolean;
    solve: string;
    flags: Array<string>;
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

/** definition.locked@10 */
export interface DefinitionLockedV10 {
  v: 10;
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
      source_line: string;
      refuted_by: string;
      check: string | null;
      check_sha256: string | null;
      on_base: "fails" | "fails_sometimes" | "passes";
      asserts: Array<string>;
      depth: string;
      oracle: "code" | "model" | "person";
      near_misses: Array<string>;
      author: {
        handle: string;
        role: "you" | "owner" | "collaborator" | "outside";
        automated?: boolean;
      };
      expected_ms?: number;
      deadline_ms?: number;
      surface: {
        kind: string;
        routes?: Array<string>;
        format?: string;
        name?: string;
        path?: string;
        exports?: Array<string>;
      } | null;
      references?: Array<{
        path: string;
        sha256: string;
      }>;
      command?: string;
      criterion?: string;
      targets?: Array<string>;
      paid?: "live call" | "hosted browser run" | "model job";
      runs?: number;
      held_out?: Array<{
        files: { [key: string]: string };
      }>;
      timing?: boolean;
      settled_by?: "budget-window";
    }>;
    deliverables: Array<string>;
    hash: string;
    issue_rev: string;
    base_commit: string;
    budget: {
      runs: number;
      cap_usd: number;
    } | null;
  };
  evidence?: Array<string>;
}

/** definition.locked@2 */
export interface DefinitionLockedV2 {
  v: 2;
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
      source_line: string;
      refuted_by: string;
      check: string | null;
      check_sha256: string | null;
      on_base: "fails" | "fails_sometimes" | "passes";
      asserts: Array<string>;
      depth: string;
      oracle: "code" | "model" | "person";
      near_misses: Array<string>;
      author: {
        handle: string;
        role: "you" | "owner" | "collaborator" | "outside";
      };
    }>;
    deliverables: Array<string>;
    hash: string;
    issue_rev: string;
    base_commit: string;
    budget: {
      runs: number;
      cap_usd: number;
    } | null;
  };
  evidence?: Array<string>;
}

/** definition.locked@3 */
export interface DefinitionLockedV3 {
  v: 3;
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
      source_line: string;
      refuted_by: string;
      check: string | null;
      check_sha256: string | null;
      on_base: "fails" | "fails_sometimes" | "passes";
      asserts: Array<string>;
      depth: string;
      oracle: "code" | "model" | "person";
      near_misses: Array<string>;
      author: {
        handle: string;
        role: "you" | "owner" | "collaborator" | "outside";
      };
      expected_ms?: number;
      deadline_ms?: number;
    }>;
    deliverables: Array<string>;
    hash: string;
    issue_rev: string;
    base_commit: string;
    budget: {
      runs: number;
      cap_usd: number;
    } | null;
  };
  evidence?: Array<string>;
}

/** definition.locked@4 */
export interface DefinitionLockedV4 {
  v: 4;
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
      source_line: string;
      refuted_by: string;
      check: string | null;
      check_sha256: string | null;
      on_base: "fails" | "fails_sometimes" | "passes";
      asserts: Array<string>;
      depth: string;
      oracle: "code" | "model" | "person";
      near_misses: Array<string>;
      author: {
        handle: string;
        role: "you" | "owner" | "collaborator" | "outside";
      };
      expected_ms?: number;
      deadline_ms?: number;
      surface: {
        kind: string;
        routes?: Array<string>;
        format?: string;
        name?: string;
        path?: string;
        exports?: Array<string>;
      } | null;
    }>;
    deliverables: Array<string>;
    hash: string;
    issue_rev: string;
    base_commit: string;
    budget: {
      runs: number;
      cap_usd: number;
    } | null;
  };
  evidence?: Array<string>;
}

/** definition.locked@5 */
export interface DefinitionLockedV5 {
  v: 5;
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
      source_line: string;
      refuted_by: string;
      check: string | null;
      check_sha256: string | null;
      on_base: "fails" | "fails_sometimes" | "passes";
      asserts: Array<string>;
      depth: string;
      oracle: "code" | "model" | "person";
      near_misses: Array<string>;
      author: {
        handle: string;
        role: "you" | "owner" | "collaborator" | "outside";
        automated?: boolean;
      };
      expected_ms?: number;
      deadline_ms?: number;
      surface: {
        kind: string;
        routes?: Array<string>;
        format?: string;
        name?: string;
        path?: string;
        exports?: Array<string>;
      } | null;
      references?: Array<{
        path: string;
        sha256: string;
      }>;
      command?: string;
      criterion?: string;
    }>;
    deliverables: Array<string>;
    hash: string;
    issue_rev: string;
    base_commit: string;
    budget: {
      runs: number;
      cap_usd: number;
    } | null;
  };
  evidence?: Array<string>;
}

/** definition.locked@6 */
export interface DefinitionLockedV6 {
  v: 6;
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
      source_line: string;
      refuted_by: string;
      check: string | null;
      check_sha256: string | null;
      on_base: "fails" | "fails_sometimes" | "passes";
      asserts: Array<string>;
      depth: string;
      oracle: "code" | "model" | "person";
      near_misses: Array<string>;
      author: {
        handle: string;
        role: "you" | "owner" | "collaborator" | "outside";
        automated?: boolean;
      };
      expected_ms?: number;
      deadline_ms?: number;
      surface: {
        kind: string;
        routes?: Array<string>;
        format?: string;
        name?: string;
        path?: string;
        exports?: Array<string>;
      } | null;
      references?: Array<{
        path: string;
        sha256: string;
      }>;
      command?: string;
      criterion?: string;
      targets?: Array<string>;
    }>;
    deliverables: Array<string>;
    hash: string;
    issue_rev: string;
    base_commit: string;
    budget: {
      runs: number;
      cap_usd: number;
    } | null;
  };
  evidence?: Array<string>;
}

/** definition.locked@7 */
export interface DefinitionLockedV7 {
  v: 7;
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
      source_line: string;
      refuted_by: string;
      check: string | null;
      check_sha256: string | null;
      on_base: "fails" | "fails_sometimes" | "passes";
      asserts: Array<string>;
      depth: string;
      oracle: "code" | "model" | "person";
      near_misses: Array<string>;
      author: {
        handle: string;
        role: "you" | "owner" | "collaborator" | "outside";
        automated?: boolean;
      };
      expected_ms?: number;
      deadline_ms?: number;
      surface: {
        kind: string;
        routes?: Array<string>;
        format?: string;
        name?: string;
        path?: string;
        exports?: Array<string>;
      } | null;
      references?: Array<{
        path: string;
        sha256: string;
      }>;
      command?: string;
      criterion?: string;
      targets?: Array<string>;
      paid?: "live call" | "hosted browser run" | "model job";
    }>;
    deliverables: Array<string>;
    hash: string;
    issue_rev: string;
    base_commit: string;
    budget: {
      runs: number;
      cap_usd: number;
    } | null;
  };
  evidence?: Array<string>;
}

/** definition.locked@8 */
export interface DefinitionLockedV8 {
  v: 8;
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
      source_line: string;
      refuted_by: string;
      check: string | null;
      check_sha256: string | null;
      on_base: "fails" | "fails_sometimes" | "passes";
      asserts: Array<string>;
      depth: string;
      oracle: "code" | "model" | "person";
      near_misses: Array<string>;
      author: {
        handle: string;
        role: "you" | "owner" | "collaborator" | "outside";
        automated?: boolean;
      };
      expected_ms?: number;
      deadline_ms?: number;
      surface: {
        kind: string;
        routes?: Array<string>;
        format?: string;
        name?: string;
        path?: string;
        exports?: Array<string>;
      } | null;
      references?: Array<{
        path: string;
        sha256: string;
      }>;
      command?: string;
      criterion?: string;
      targets?: Array<string>;
      paid?: "live call" | "hosted browser run" | "model job";
      runs?: number;
      held_out?: Array<{
        files: { [key: string]: string };
      }>;
    }>;
    deliverables: Array<string>;
    hash: string;
    issue_rev: string;
    base_commit: string;
    budget: {
      runs: number;
      cap_usd: number;
    } | null;
  };
  evidence?: Array<string>;
}

/** definition.locked@9 */
export interface DefinitionLockedV9 {
  v: 9;
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
      source_line: string;
      refuted_by: string;
      check: string | null;
      check_sha256: string | null;
      on_base: "fails" | "fails_sometimes" | "passes";
      asserts: Array<string>;
      depth: string;
      oracle: "code" | "model" | "person";
      near_misses: Array<string>;
      author: {
        handle: string;
        role: "you" | "owner" | "collaborator" | "outside";
        automated?: boolean;
      };
      expected_ms?: number;
      deadline_ms?: number;
      surface: {
        kind: string;
        routes?: Array<string>;
        format?: string;
        name?: string;
        path?: string;
        exports?: Array<string>;
      } | null;
      references?: Array<{
        path: string;
        sha256: string;
      }>;
      command?: string;
      criterion?: string;
      targets?: Array<string>;
      paid?: "live call" | "hosted browser run" | "model job";
      runs?: number;
      held_out?: Array<{
        files: { [key: string]: string };
      }>;
      timing?: boolean;
    }>;
    deliverables: Array<string>;
    hash: string;
    issue_rev: string;
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

/** definition.stood_in@1 */
export interface DefinitionStoodIn {
  v: 1;
  id: string;
  kind: "definition.stood_in";
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
      stand_in: {
        surface: {
          kind: string;
          routes?: Array<string>;
          format?: string;
          name?: string;
          path?: string;
          exports?: Array<string>;
        };
        hash: string;
      };
    }>;
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

/** delivery.outcome@2 */
export interface DeliveryOutcomeV2 {
  v: 2;
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
    via: "steer" | "interrupt" | "stop_hold" | "next_prompt" | "on_task";
    outcome: "delivered" | "stalled" | "timed_out" | "replaced" | "waiting";
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

/** doc.patched@2 */
export interface DocPatchedV2 {
  v: 2;
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
    patch: string | null;
    writer: "you" | "shell" | "record" | "agent" | "plugin";
    achieved: {
      created: { [key: string]: number };
      updated: number;
      deleted: { [key: string]: number };
      unchanged: boolean;
    };
    hash: string;
    layer: string;
    thread: string | null;
  };
  evidence?: Array<string>;
}

/** doctor.item@1 */
export interface DoctorItem {
  code: "healthy" | "binary_missing" | "version_uncovered" | "hooks_missing" | "hooks_disabled" | "hooks_untrusted" | "mcp_unregistered" | "statusline_missing" | "signed_out" | "nested_session" | "timing_relation_broken" | "telemetry_unreadable" | "not_checked" | "hub_unreachable" | "disk_low" | "ports_taken" | "billing_api_key" | "binary_differs" | "token_expiring" | "prompt_failed" | "deprecated_used" | "gpu_unsupported" | "render_failed" | "job_failing" | "hook_program_missing" | "notifications_off" | "service_unpromoted" | "statusline_shadowed" | "pack_refused" | "unknown";
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

/** extension.compose@1 */
export interface ExtensionCompose {
  provides?: Array<{
    schema?: unknown;
    digests?: { [key: string]: string };
  }>;
  uses?: Array<{
    schema?: unknown;
    from?: string;
    optional?: boolean;
  }>;
  pieces?: Array<string>;
}

/** extension.contract@1 */
export interface ExtensionContract {
  stability?: "stable" | "preview";
  requires?: {
    preview?: Array<string>;
  };
  calls?: Array<string>;
}

/** extension.edges@1 */
export interface ExtensionEdges {
  conflicts?: Array<string>;
  kernel?: Array<string>;
}

/** extension.host@1 */
export interface ExtensionHost {
  host?: {
    runs: "terminals";
    lives: "past_app";
    owns: Array<"terminals">;
  };
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

/** forge.refused@1 */
export interface ForgeRefused {
  v: 1;
  id: string;
  kind: "forge.refused";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    run: string;
    session: string;
    action: "post-status" | "merge" | "push-default-branch" | "push-approved-tag";
    target: string;
    call: string | null;
  };
  evidence?: Array<string>;
}

/** guard.overridden@1 */
export interface GuardOverridden {
  v: 1;
  id: string;
  kind: "guard.overridden";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    call: string;
    tool: string;
    label: string;
    guard: string;
    send: boolean;
    mods: Array<string>;
    mods_unread: string | null;
  };
  evidence?: Array<string>;
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

/** heavy.command@1 */
export interface HeavyCommand {
  name: string;
  argv_prefix: Array<string>;
  kinds: Array<string>;
  jobs: string;
  jobs_flag?: string;
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
  stage?: { [key: string]: Array<string> };
  heavy?: {
    name: string;
    kinds: Array<string>;
    form: string;
  };
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

/** host.changed@1 */
export interface HostChanged {
  v: 1;
  id: string;
  kind: "host.changed";
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    host: string;
    change: string;
    changes: Array<string>;
    undo: string | null;
    grant: "you" | "root";
    fingerprint: Array<{
      target: string;
      sha256: string | null;
    }>;
    ask: string | null;
    run: string | null;
  };
  evidence?: Array<string>;
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

/** issue.drafted@1 */
export interface IssueDrafted {
  v: 1;
  id: string;
  kind: "issue.drafted";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    task_ref: string;
    issue: string;
    because: "split" | "switch";
    decision: string | null;
    title: string;
    items: Array<{
      id: string;
      text: string;
      needs: string;
    }>;
    follow_up: string;
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
    inputs?: Array<{
      kind: "issue" | "design" | "base" | "criterion";
      ref: string;
      sha256?: string;
    }>;
  };
  evidence?: Array<string>;
}

/** landing.made@1 */
export interface LandingMade {
  v: 1;
  id: string;
  kind: "landing.made";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    step: "judged" | "sent_back" | "held" | "landed" | "stopped" | "joined";
    repo: string;
    pr: number;
    issue: number;
    head: string | null;
    main: string | null;
    commit: string | null;
    tree: string | null;
    claim: string | null;
    outcome: "PASS" | "FAIL" | "INVALID" | "BLOCKED" | "INCONCLUSIVE" | "none";
    files: Array<string>;
    open: Array<string>;
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

/** mcp.tools_listed@1 */
export interface McpToolsListed {
  v: 1;
  id: string;
  kind: "mcp.tools_listed";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    server: string;
    scope: "user" | "local" | "project";
    version: string | null;
    tools: Array<{
      name: string;
      digest: string;
      hints: unknown;
    }>;
    held?: {
      ask: string;
      tools: Array<string>;
    };
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

/** move.refused@1 */
export interface MoveRefused {
  v: 1;
  id: string;
  kind: "move.refused";
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    object: string;
    table: string;
    state: string;
    event: string;
    event_id: string;
    guard?: string;
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

/** notice.delivered@1 */
export interface NoticeDelivered {
  v: 1;
  id: string;
  kind: "notice.delivered";
  subject: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    notice: string;
    type: "interface" | "dependency" | "behavior" | "test" | "configuration";
    source: string | null;
    target: string;
    files: Array<string>;
    pr: number | null;
    key: string;
    version: string;
    via: "SessionStart" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "waiter";
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

/** open_item.closed@2 */
export interface OpenItemClosedV2 {
  v: 2;
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
    item: string;
    by: string;
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

/** open_item.opened@2 */
export interface OpenItemOpenedV2 {
  v: 2;
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
    item: string;
    from: "agent" | "section" | "bug" | "issue" | "limit" | "placeholder" | "task" | "review_thread";
    resolved_by?: string;
  };
  evidence?: Array<string>;
}

/** open_item.opened@3 */
export interface OpenItemOpenedV3 {
  v: 3;
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
    item: string;
    from: "agent" | "section" | "bug" | "issue" | "limit" | "placeholder" | "task" | "review_thread" | "verdict";
    resolved_by?: string;
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

/** plan.proposed@2 */
export interface PlanProposedV2 {
  v: 2;
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
      targets?: Array<{
        kind: "address" | "host" | "remote" | "repo" | "channel" | "payee";
        ref: string;
      }>;
    }>;
    diff: string;
    hash: string;
    targets: Array<{
      step: number;
      kind: "address" | "host" | "remote" | "repo" | "channel" | "payee";
      ref: string;
      origin: "you" | "decision" | "repo" | "read" | "unknown";
      first: string | null;
      warning: string | null;
      rule: string | null;
    }>;
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

/** product.built@1 */
export interface ProductBuilt {
  v: 1;
  id: string;
  kind: "product.built";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    product: string;
    path: string;
    key: string;
    commit: string;
    bytes: number;
    store_bytes: number;
  };
  evidence?: Array<string>;
}

/** promise.blocked@1 */
export interface PromiseBlocked {
  v: 1;
  id: string;
  kind: "promise.blocked";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    promise: string;
    status: "BLOCKED";
    quote: string;
    cause: "set_again" | "past_end";
    owner: "service" | "you";
    ask: string | null;
  };
  evidence?: Array<string>;
}

/** promise.due@1 */
export interface PromiseDue {
  v: 1;
  id: string;
  kind: "promise.due";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    promise: string;
    due: number;
    route: "wake" | "next_hook";
  };
  evidence?: Array<string>;
}

/** promise.set@1 */
export interface PromiseSet {
  v: 1;
  id: string;
  kind: "promise.set";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    promise: string;
    quote: string;
    due: number;
    times_set: number;
    end: number;
  };
  evidence?: Array<string>;
}

/** promise.woken@1 */
export interface PromiseWoken {
  v: 1;
  id: string;
  kind: "promise.woken";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    promise: string;
    via: "waiter" | "next_prompt" | "stop_hold";
  };
  evidence?: Array<string>;
}

/** push.record@1 */
export interface PushRecord {
  commit: string;
  pusher: string | null;
}

/** question.proceeded@1 */
export interface QuestionProceeded {
  v: 1;
  id: string;
  kind: "question.proceeded";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    question: string;
    rule: string;
  };
  evidence?: Array<string>;
}

/** race.started@1 */
export interface RaceStarted {
  v: 1;
  id: string;
  kind: "race.started";
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    issue: number;
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

/** ref.unguarded@1 */
export interface RefUnguarded {
  v: 1;
  id: string;
  kind: "ref.unguarded";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    ref: string;
    commit: string;
    pusher: string | null;
    call: string | null;
    command: string | null;
  };
  evidence?: Array<string>;
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

/** resource.created@1 */
export interface ResourceCreated {
  v: 1;
  id: string;
  kind: "resource.created";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    resource: string;
    kind: string;
    key?: string;
    cost_usd: number;
    check: string;
    cwd: string;
  };
  evidence?: Array<string>;
}

/** row.set@1 */
export interface RowSet {
  v: 1;
  id: string;
  kind: "row.set";
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    id: string;
    listed: boolean;
    order?: string;
    address?: string;
    title?: string;
    project?: string | null;
    session?: string;
    agent?: string | null;
    entry?: "idle" | "running" | "pass" | "fail" | "blocked" | "invalid" | "inconclusive" | "needs_you" | "stale";
    word?: "queued" | "working" | "says done" | "PASS" | "sent back" | "BLOCKED" | "INVALID" | "INCONCLUSIVE" | "needs you" | "stale" | "quiet" | "stuck" | "flagged" | "finished";
    why?: string;
    waits_on?: string | null;
    since?: number | null;
    actions?: Array<{
      answer: string;
      label: string;
    }>;
    unread?: boolean;
    default?: string;
    default_at?: number;
  };
  evidence?: Array<string>;
}

/** row.set@2 */
export interface RowSetV2 {
  v: 2;
  id: string;
  kind: "row.set";
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    id: string;
    listed: boolean;
    order?: string;
    address?: string;
    title?: string;
    project?: string | null;
    session?: string;
    agent?: string | null;
    entry?: "idle" | "running" | "pass" | "fail" | "blocked" | "invalid" | "inconclusive" | "needs_you" | "stale";
    word?: "queued" | "working" | "says done" | "PASS" | "sent back" | "BLOCKED" | "INVALID" | "INCONCLUSIVE" | "needs you" | "stale" | "quiet" | "stuck" | "flagged" | "finished" | "running";
    why?: string;
    waits_on?: string | null;
    since?: number | null;
    actions?: Array<{
      answer: string;
      label: string;
    }>;
    unread?: boolean;
    default?: string;
    default_at?: number;
    progress?: string;
  };
  evidence?: Array<string>;
}

/** row.set@3 */
export interface RowSetV3 {
  v: 3;
  id: string;
  kind: "row.set";
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    id: string;
    listed: boolean;
    order?: string;
    address?: string;
    title?: string;
    project?: string | null;
    session?: string;
    agent?: string | null;
    entry?: "idle" | "running" | "pass" | "fail" | "blocked" | "invalid" | "inconclusive" | "needs_you" | "stale";
    word?: "queued" | "working" | "says done" | "PASS" | "sent back" | "BLOCKED" | "INVALID" | "INCONCLUSIVE" | "needs you" | "stale" | "quiet" | "stuck" | "flagged" | "finished" | "running";
    why?: string;
    waits_on?: string | null;
    since?: number | null;
    actions?: Array<{
      answer: string;
      label: string;
    }>;
    unread?: boolean;
    default?: string;
    default_at?: number;
    progress?: string;
    doing?: {
      words: string;
      at: number;
      ago: boolean;
    };
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

/** run.finished@2 */
export interface RunFinishedV2 {
  v: 2;
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
    key?: {
      id: string;
      stem: string;
      paths: Array<string>;
      claim: string;
      session: string;
      base: boolean;
      withheld: boolean;
      plain: boolean;
    };
  };
  evidence?: Array<string>;
}

/** run.finished@3 */
export interface RunFinishedV3 {
  v: 3;
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
    key?: {
      id: string;
      stem: string;
      paths: Array<string>;
      claim: string;
      session: string;
      base: boolean;
      withheld: boolean;
      plain: boolean;
    };
    exit?: number | null;
  };
  evidence?: Array<string>;
}

/** run.kept@1 */
export interface RunKept {
  v: 1;
  id: string;
  kind: "run.kept";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    run: string;
  };
  evidence?: Array<string>;
}

/** run.stale@1 */
export interface RunStale {
  v: 1;
  id: string;
  kind: "run.stale";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    session: string;
    run: string;
    check: string;
    claim: string;
    newer_claim: string;
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

/** run.started@2 */
export interface RunStartedV2 {
  v: 2;
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
    host: string;
    needs: {
      cores: number;
      memory_mb: number;
      stack_slot: number;
      gpus: number;
      expected_ms: number | null;
    };
    lane: "fast" | "slow";
  };
  evidence?: Array<string>;
}

/** run.started@3 */
export interface RunStartedV3 {
  v: 3;
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
    host: string;
    needs: {
      cores: number;
      memory_mb: number;
      stack_slot: number;
      gpus: number;
      expected_ms: number | null;
    };
    lane: "fast" | "slow";
    argv: Array<string>;
    cwd: string;
    env: { [key: string]: string };
    grant: {
      read?: Array<string>;
      write?: Array<string>;
      hosts?: Array<string>;
      sockets?: Array<string>;
      listen?: Array<string>;
      run_as_you?: boolean;
    };
    deadline_ms: number | null;
    environment?: boolean;
    command?: string;
    stand_ins?: Array<string>;
    withheld: Array<string>;
  };
  evidence?: Array<string>;
}

/** run.started@4 */
export interface RunStartedV4 {
  v: 4;
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
    claim?: string;
    commit?: string;
    host: string;
    needs: {
      cores: number;
      memory_mb: number;
      stack_slot: number;
      gpus: number;
      expected_ms: number | null;
    };
    lane: "fast" | "slow";
    argv: Array<string>;
    cwd: string;
    env: { [key: string]: string };
    grant: {
      read?: Array<string>;
      write?: Array<string>;
      hosts?: Array<string>;
      sockets?: Array<string>;
      listen?: Array<string>;
      run_as_you?: boolean;
    };
    deadline_ms: number | null;
    environment?: boolean;
    command?: string;
    stand_ins?: Array<string>;
    withheld: Array<string>;
    ask?: string;
  };
  evidence?: Array<string>;
}

/** run.stopped_at_limit@1 */
export interface RunStoppedAtLimit {
  v: 1;
  id: string;
  kind: "run.stopped_at_limit";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    run: string;
    limit: "memory_mb" | "file_mb";
    max: number;
    reading?: number;
  };
  evidence?: Array<string>;
}

/** run.under_load@1 */
export interface RunUnderLoad {
  v: 1;
  id: string;
  kind: "run.under_load";
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
    claim: string;
    under_load: true;
    load: number;
    cores: number;
  };
  evidence?: Array<string>;
}

/** runner.answered@1 */
export interface RunnerAnswered {
  v: 1;
  id: string;
  kind: "runner.answered";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    reading: string;
    piece: string;
    job: string;
    value: unknown;
    cites: Array<string>;
    as_of: number;
    stale_at: number | null;
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

/** sandbox.denied@2 */
export interface SandboxDeniedV2 {
  v: 2;
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
    holder?: string;
  };
  evidence?: Array<string>;
}

/** sandbox.refused@1 */
export interface SandboxRefused {
  v: 1;
  id: string;
  kind: "sandbox.refused";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    run: string;
    session: string;
    operation: string;
    target: string;
    call: string | null;
  };
  evidence?: Array<string>;
}

/** schedule.run@1 */
export interface ScheduleRun {
  v: 1;
  id: string;
  kind: "schedule.run";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    run: string;
    schedule: string;
    plugin: string;
    phase: "queued" | "dispatched" | "ended";
    due: number;
    resumed?: boolean;
    verdict?: "PASS" | "FAIL" | "BLOCKED" | "INCONCLUSIVE" | "INVALID";
    cause?: string | null;
    stopped?: boolean;
    noop?: boolean;
    changes?: Array<string>;
  };
  evidence?: Array<string>;
}

/** seed.cloned@1 */
export interface SeedCloned {
  v: 1;
  id: string;
  kind: "seed.cloned";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    run: string;
    stack: string;
    source: string;
    copied_at: string;
    migration: string;
    template: string;
    cloned_at: number;
  };
  evidence?: Array<string>;
}

/** send.made@1 */
export interface SendMade {
  v: 1;
  id: string;
  kind: "send.made";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    key: string;
    piece: string;
    phase: "asked" | "claimed" | "answered" | "refused";
    kind: string;
    to: Array<string>;
    plan: string;
    schedule: string | null;
    run: string | null;
    call: string | null;
    rule: string | null;
    ask: string | null;
    status?: number;
  };
  evidence?: Array<string>;
}

/** session.activity@1 */
export interface SessionActivity {
  v: 1;
  id: string;
  kind: "session.activity";
  subject: string;
  writer: "hook";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    activity: string;
  };
  evidence?: Array<string>;
}

/** session.archived@1 */
export interface SessionArchived {
  v: 1;
  id: string;
  kind: "session.archived";
  subject: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    transcript: string;
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

/** session.context_fit@1 */
export interface SessionContextFit {
  v: 1;
  id: string;
  kind: "session.context_fit";
  subject: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    event: string;
    cap: number;
    chars: number;
    inline: Array<string>;
    inline_ids: Array<string>;
    by_handle: Array<string>;
    handle: string;
  };
  evidence?: Array<string>;
}

/** session.continued@1 */
export interface SessionContinued {
  v: 1;
  id: string;
  kind: "session.continued";
  subject: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    stop: string;
    because: "transient" | "context_overflow" | "task_closed";
    task: string | null;
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

/** session.end@2 */
export interface SessionEndV2 {
  v: 2;
  id: string;
  kind: "session.end";
  subject?: string;
  writer: string;
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

/** session.named@1 */
export interface SessionNamed {
  v: 1;
  id: string;
  kind: "session.named";
  subject: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    name: string;
    by: "you" | "agent";
  };
  evidence?: Array<string>;
}

/** session.never_started@1 */
export interface SessionNeverStarted {
  v: 1;
  id: string;
  kind: "session.never_started";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    run: string;
    after_ms: number;
  };
  evidence?: Array<string>;
}

/** session.paused@1 */
export interface SessionPaused {
  v: 1;
  id: string;
  kind: "session.paused";
  subject: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
  };
  evidence?: Array<string>;
}

/** session.pushed@1 */
export interface SessionPushed {
  v: 1;
  id: string;
  kind: "session.pushed";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    ref: string;
    commit: string;
    pusher: string;
    session: string | null;
    run: string | null;
    approval: string | null;
    approved_by: string | null;
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

/** session.rules_delivered@1 */
export interface SessionRulesDelivered {
  v: 1;
  id: string;
  kind: "session.rules_delivered";
  subject: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    via: "start" | "prompt" | "notice";
    pos: number;
    rules: Array<string>;
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

/** session.start@4 */
export interface SessionStartV4 {
  v: 4;
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
    parent?: string;
  };
  evidence?: Array<string>;
}

/** session.state@1 */
export interface SessionState {
  v: 1;
  id: string;
  kind: "session.state";
  subject: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    state: "needs you" | "stuck" | "flagged" | "working" | "finished" | "quiet";
    cause: "ask" | "gone" | "waiting" | "stuck" | "promised" | "failed" | "quiet" | "interrupted" | "finished" | "working";
  };
  evidence?: Array<string>;
}

/** session.state@2 */
export interface SessionStateV2 {
  v: 2;
  id: string;
  kind: "session.state";
  subject: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    state: "needs you" | "stuck" | "flagged" | "sent back" | "BLOCKED" | "INVALID" | "INCONCLUSIVE" | "stale" | "says done" | "working" | "queued" | "PASS" | "finished" | "quiet";
    cause: "ask" | "gone" | "waiting" | "words" | "stuck" | "promised" | "failed" | "sent_back" | "blocked" | "invalid" | "inconclusive" | "stale" | "says_done" | "working" | "queued" | "pass" | "interrupted" | "finished" | "quiet";
  };
  evidence?: Array<string>;
}

/** source.called@1 */
export interface SourceCalled {
  v: 1;
  id: string;
  kind: "source.called";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    source: string;
    host: string;
    outcome: "answered" | "timeout" | "unreachable";
    status?: number;
    ms: number;
    bytes: number;
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

/** spend.approved@2 */
export interface SpendApprovedV2 {
  v: 2;
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
    runs?: number;
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

/** stack.served@1 */
export interface StackServed {
  v: 1;
  id: string;
  kind: "stack.served";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    run: string;
    stack: string;
    project?: string;
    checkout: string;
    ports: { [key: string]: number };
    ready_ms: number;
    steps: Array<{
      step: "services" | "install" | "migrate" | "seed" | "clone" | "app";
      status: "ran" | "reused";
      key: string | null;
      ms: number;
      product?: {
        name: string;
        key: string;
      };
    }>;
    caches: Array<{
      path: string;
      digest: string;
    }>;
    images: Array<{
      service: string;
      image: string;
      context_digest: string;
      built: boolean;
    }>;
    mounts: Array<{
      service: string;
      source: string;
      target: string;
    }>;
  };
  evidence?: Array<string>;
}

/** stack.waiting@1 */
export interface StackWaiting {
  v: 1;
  id: string;
  kind: "stack.waiting";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    claim: string;
    check: string;
    wait_ms: number;
    expected_ms: number;
  };
  evidence?: Array<string>;
}

/** start.approval@1 */
export interface StartApproval {
  v: 1;
  id: string;
  kind: "start.approval";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    ask: string;
    repo: string;
    issues: Array<number>;
    agents: Array<string>;
    homes: { [key: string]: string };
    modes: { [key: string]: string };
    at_once: number;
    plan_share: number;
    until: number | null;
    hosts: Array<string>;
    sandbox: { [key: string]: {
      sandboxed: boolean;
      walls: {
        writes: boolean;
        credentials: boolean;
        network: boolean;
      };
    } };
  };
  evidence?: Array<string>;
}

/** start.refused@1 */
export interface StartRefused {
  v: 1;
  id: string;
  kind: "start.refused";
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    caller: string;
    bound: "approval" | "set" | "agent" | "mode" | "end" | "at_once" | "plan_share" | "version" | "caller";
    reason: string;
    repo: string | null;
    issue: number | null;
    agent: string | null;
  };
  evidence?: Array<string>;
}

/** start.session@1 */
export interface StartSession {
  v: 1;
  id: string;
  kind: "start.session";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    run: string;
    session: string;
    agent: string;
  };
  evidence?: Array<string>;
}

/** start.started@1 */
export interface StartStarted {
  v: 1;
  id: string;
  kind: "start.started";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    run: string;
    ask: string;
    repo: string;
    issue: number;
    agent: string;
    version: string;
    home: string;
    mode: string;
    worktree: string;
    branch: string;
    base: string;
    sandbox: {
      sandboxed: boolean;
      walls: {
        writes: boolean;
        credentials: boolean;
        network: boolean;
      };
    };
  };
  evidence?: Array<string>;
}

/** state.read@1 */
export interface StateRead {
  v: 1;
  id: string;
  kind: "state.read";
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    workspace: string;
    task_ref: string;
    claim: string | null;
    readings: Array<{
      touch: string;
      source: string;
      digest: string;
    }>;
    reads: Array<{
      req: string;
      check: string | null;
      touches: Array<string>;
    }>;
  };
  evidence?: Array<string>;
}

/** stop.held@1 */
export interface StopHeld {
  v: 1;
  id: string;
  kind: "stop.held";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    session: string;
    stop: string;
    claim: string | null;
    total: number;
    question: number;
    slow: number;
    fast: number;
    snapshot_start: number;
    queue_wait: number;
    code_changing: boolean;
    budget_cost: Array<string>;
  };
  evidence?: Array<string>;
}

/** store.item@1 */
export interface StoreItem {
  v: 1;
  id: string;
  kind: string;
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    key: string;
    generation: number;
    value: unknown;
    call: string | null;
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

/** task.withdrawn@1 */
export interface TaskWithdrawn {
  v: 1;
  id: string;
  kind: "task.withdrawn";
  subject: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
  };
  evidence?: Array<string>;
}

/** terminal.refused@1 */
export interface TerminalRefused {
  v: 1;
  id: string;
  kind: "terminal.refused";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    terminal: string;
    pid: number;
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

/** tool.after@3 */
export interface ToolAfterV3 {
  v: 3;
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
    nested?: {
      complete: boolean;
      calls?: number;
    };
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
    nested?: {
      complete: boolean;
      calls?: number;
    };
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
    nested?: {
      complete: boolean;
      calls?: number;
    };
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
    nested?: {
      complete: boolean;
      calls?: number;
    };
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
    nested?: {
      complete: boolean;
      calls?: number;
    };
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
    nested?: {
      complete: boolean;
      calls?: number;
    };
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
    nested?: {
      complete: boolean;
      calls?: number;
    };
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
    nested?: {
      complete: boolean;
      calls?: number;
    };
  };
  evidence?: Array<string>;
}

/** tool.after@4 */
export interface ToolAfterV4 {
  v: 4;
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
    nested?: {
      complete: boolean;
      calls?: number;
    };
    error?: string;
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
    nested?: {
      complete: boolean;
      calls?: number;
    };
    error?: string;
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
    nested?: {
      complete: boolean;
      calls?: number;
    };
    error?: string;
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
    nested?: {
      complete: boolean;
      calls?: number;
    };
    error?: string;
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
    nested?: {
      complete: boolean;
      calls?: number;
    };
    error?: string;
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
    nested?: {
      complete: boolean;
      calls?: number;
    };
    error?: string;
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
    nested?: {
      complete: boolean;
      calls?: number;
    };
    error?: string;
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
    nested?: {
      complete: boolean;
      calls?: number;
    };
    error?: string;
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

/** tool.before@4 */
export interface ToolBeforeV4 {
  v: 4;
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
    host?: string;
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
    from: "person" | "scheduled" | "subagent" | "session" | "continuation" | "app" | "unknown";
    request?: string;
  };
  evidence?: Array<string>;
}

/** user.ask@2 */
export interface UserAskV2 {
  v: 2;
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
    from: "person" | "scheduled" | "subagent" | "session" | "continuation" | "app" | "unknown";
    request?: string;
    disposition?: "handled";
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

export type VerdictMadeV2Requirements = Array<{
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

export type VerdictMadeV2Key = {
  commit: string;
  doc_revisions: Array<string>;
  check_digests: Array<string>;
  state_digests: Array<string>;
  environment: string;
  tools: Array<string>;
};

/** verdict.made@2 */
export interface VerdictMadeV2 {
  v: 2;
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
    key: VerdictMadeV2Key;
    why?: Array<{
      reason: "untrusted_project" | "target_unresolved" | "threshold_without_unit" | "open_items" | "option_switched" | "denied_call_ran" | "checks_not_started" | "unknown";
      text: string;
    }>;
  } | {
    outcome: "FAIL";
    verdict: string;
    claim: string;
    reasons: Array<string>;
    requirements: VerdictMadeV2Requirements;
    smallest: string | null;
    points_to: string | null;
    commit: string;
    key: VerdictMadeV2Key;
    why?: Array<{
      reason: "untrusted_project" | "target_unresolved" | "threshold_without_unit" | "open_items" | "option_switched" | "denied_call_ran" | "checks_not_started" | "unknown";
      text: string;
    }>;
  } | {
    outcome: "INVALID";
    verdict: string;
    claim: string;
    reasons: Array<string>;
    requirements: VerdictMadeV2Requirements;
    smallest: string | null;
    points_to: string | null;
    commit: string;
    key: VerdictMadeV2Key;
    why?: Array<{
      reason: "untrusted_project" | "target_unresolved" | "threshold_without_unit" | "open_items" | "option_switched" | "denied_call_ran" | "checks_not_started" | "unknown";
      text: string;
    }>;
  } | {
    outcome: "BLOCKED";
    verdict: string;
    claim: string;
    reasons: Array<string>;
    requirements: VerdictMadeV2Requirements;
    smallest: string | null;
    points_to: string | null;
    commit: string;
    key: VerdictMadeV2Key;
    why?: Array<{
      reason: "untrusted_project" | "target_unresolved" | "threshold_without_unit" | "open_items" | "option_switched" | "denied_call_ran" | "checks_not_started" | "unknown";
      text: string;
    }>;
  } | {
    outcome: "INCONCLUSIVE";
    verdict: string;
    claim: string;
    reasons: Array<string>;
    requirements: VerdictMadeV2Requirements;
    smallest: string | null;
    points_to: string | null;
    commit: string;
    key: VerdictMadeV2Key;
    why?: Array<{
      reason: "untrusted_project" | "target_unresolved" | "threshold_without_unit" | "open_items" | "option_switched" | "denied_call_ran" | "checks_not_started" | "unknown";
      text: string;
    }>;
  };
  evidence?: Array<string>;
}

/** verdict.outcome@1 */
export type VerdictOutcome = "PASS" | "FAIL" | "INVALID" | "BLOCKED" | "INCONCLUSIVE";

/** verdict.reason@1 */
export type VerdictReason = "untrusted_project" | "target_unresolved" | "threshold_without_unit" | "open_items" | "option_switched" | "denied_call_ran" | "checks_not_started" | "unknown";

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

/** waiver.ended@1 */
export interface WaiverEnded {
  v: 1;
  id: string;
  kind: "waiver.ended";
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    waiver: string;
    why: "date" | "condition" | "revoked";
  };
  evidence?: Array<string>;
}

/** waiver.granted@1 */
export interface WaiverGranted {
  v: 1;
  id: string;
  kind: "waiver.granted";
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    check: string;
    error: string;
    owner: string;
    approved_by: string;
    until?: number;
    condition?: string;
  };
  evidence?: Array<string>;
}

/** wiki.read@1 */
export interface WikiRead {
  v: 1;
  id: string;
  kind: "wiki.read";
  subject?: string;
  writer: string;
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    source: string;
    count: number;
    last: string | null;
  };
  evidence?: Array<string>;
}

/** work.broke@1 */
export interface WorkBroke {
  v: 1;
  id: string;
  kind: "work.broke";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    ask: string;
    cause: "revert" | "follow_up_fix" | "is_it_done" | "issue";
  };
  evidence?: Array<string>;
}

/** work.delivery@1 */
export interface WorkDelivery {
  v: 1;
  id: string;
  kind: "work.delivery";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    key: string;
    task_ref: string;
    source: string;
    thread: string;
    phase: "recorded" | "asked" | "claimed" | "sent" | "tried" | "gone" | "refused" | "unknown";
    detail: unknown;
  };
  evidence?: Array<string>;
}

/** work.item@1 */
export interface WorkItem {
  source_id: string;
  link: string;
  title: string;
  body: string;
  criteria: Array<string>;
  authors: Array<{
    handle: string;
    role: "owner" | "collaborator" | "outside";
  }>;
  updated: string;
}

/** work.item@2 */
export interface WorkItemV2 {
  source_id: string;
  link: string;
  title: string;
  body: string;
  criteria: Array<string>;
  authors: Array<{
    handle: string;
    role: "owner" | "collaborator" | "outside";
    automated?: boolean;
  }>;
  updated: string;
}

/** work.read@1 */
export interface WorkRead {
  v: 1;
  id: string;
  kind: "work.read";
  subject?: string;
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    source: string;
    position: string | null;
    state: unknown;
  };
  evidence?: Array<string>;
}

/** workspace.created@1 */
export interface WorkspaceCreated {
  v: 1;
  id: string;
  kind: "workspace.created";
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    workspace: string;
    folder: string;
    topic: string;
    task_ref: string | null;
  };
  evidence?: Array<string>;
}

/** workspace.moved@1 */
export interface WorkspaceMoved {
  v: 1;
  id: string;
  kind: "workspace.moved";
  writer: "core";
  actor: string;
  scope: string;
  ts: number;
  seq?: bigint;
  log_pos?: number;
  data: {
    workspace: string;
    folder: string;
    from: string;
  };
  evidence?: Array<string>;
}

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
