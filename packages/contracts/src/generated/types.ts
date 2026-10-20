// Generated from packages/contracts/schemas by generateTypeScript. Do not edit.

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

/** check@1 */
export interface Check {
  kind: "validity" | "command" | "journey" | "review" | "numbers" | "docs" | "draft" | "narrowing" | "document" | "physics_golden" | "media";
  runner: string;
  inputs: Array<string>;
  depth: string;
  oracle: "code" | "model" | "person";
  contract: string | null;
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

/** error@1 */
export interface Error {
  code: "unknown_schema" | "not_json" | "type" | "required" | "unlisted_field" | "enum" | "const" | "pattern" | "format" | "length" | "range" | "union" | "uncatalogued_kind" | "handle_syntax" | "handle_scheme" | "digest_algorithm";
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
