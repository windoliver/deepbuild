// Generated from packages/contracts/schemas by generateTypeScript. Do not edit.

/** check@1 */
export interface Check {
  kind: "validity" | "command" | "journey" | "review" | "numbers" | "docs" | "draft" | "narrowing" | "document" | "physics_golden" | "media";
  runner: string;
  inputs: Array<string>;
  depth: string;
  oracle: "code" | "model" | "person";
  contract: string | null;
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

/** verdict@1 */
export interface Verdict {
  verdict: string;
  claim: string;
  outcome: "PASS" | "FAIL" | "INVALID" | "BLOCKED" | "INCONCLUSIVE";
  reasons: Array<string>;
  requirements: Array<{
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
  smallest: string | null;
  points_to: string | null;
  commit: string;
  key: {
    commit: string;
    doc_revisions: Array<string>;
    check_digests: Array<string>;
    state_digests: Array<string>;
    environment: string;
    tools: Array<string>;
  };
  checkout: string;
}
