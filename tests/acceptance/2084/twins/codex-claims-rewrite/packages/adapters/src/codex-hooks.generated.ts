// Generated from Codex's published hook schemas, openai/codex rust-v0.160.0, codex-rs/hooks/schema/generated,
// by scripts/codex-hook-types.mjs from the copies in adapters/codex-schemas. Do not edit by hand.
// Copyright OpenAI, Apache License 2.0 (adapters/codex-schemas/NOTICE).

export type InterruptInput = {
  cwd: string;
  hook_event_name: "Interrupt";
  model: string;
  permission_mode: "default" | "acceptEdits" | "plan" | "dontAsk" | "bypassPermissions";
  session_id: string;
  transcript_path: string | null;
  turn_id: string;
};
export type InterruptOutput = {
  systemMessage?: string;
};
export type PermissionRequestInput = {
  agent_id?: string;
  agent_type?: string;
  cwd: string;
  hook_event_name: "PermissionRequest";
  model: string;
  permission_mode: "default" | "acceptEdits" | "plan" | "dontAsk" | "bypassPermissions";
  session_id: string;
  tool_input: unknown;
  tool_name: string;
  transcript_path: string | null;
  turn_id: string;
};
export type PermissionRequestOutput = {
  continue?: boolean;
  hookSpecificOutput?: {
    decision?: {
      behavior: "allow" | "deny";
      interrupt?: boolean;
      message?: string;
      updatedInput?: unknown;
      updatedPermissions?: unknown;
    };
    hookEventName: "PermissionRequest";
  };
  stopReason?: string;
  suppressOutput?: boolean;
  systemMessage?: string;
};
export type PostCompactInput = {
  agent_id?: string;
  agent_type?: string;
  cwd: string;
  hook_event_name: "PostCompact";
  model: string;
  session_id: string;
  transcript_path: string | null;
  trigger: "manual" | "auto";
  turn_id: string;
};
export type PostCompactOutput = {
  continue?: boolean;
  stopReason?: string;
  suppressOutput?: boolean;
  systemMessage?: string;
};
export type PostToolUseInput = {
  agent_id?: string;
  agent_type?: string;
  cwd: string;
  hook_event_name: "PostToolUse";
  model: string;
  permission_mode: "default" | "acceptEdits" | "plan" | "dontAsk" | "bypassPermissions";
  session_id: string;
  tool_input: unknown;
  tool_name: string;
  tool_response: unknown;
  tool_use_id: string;
  transcript_path: string | null;
  turn_id: string;
};
export type PostToolUseOutput = {
  continue?: boolean;
  decision?: "block";
  hookSpecificOutput?: {
    additionalContext?: string;
    hookEventName: "PostToolUse";
    updatedMCPToolOutput?: unknown;
  };
  reason?: string;
  stopReason?: string;
  suppressOutput?: boolean;
  systemMessage?: string;
};
export type PreCompactInput = {
  agent_id?: string;
  agent_type?: string;
  cwd: string;
  hook_event_name: "PreCompact";
  model: string;
  session_id: string;
  transcript_path: string | null;
  trigger: "manual" | "auto";
  turn_id: string;
};
export type PreCompactOutput = {
  continue?: boolean;
  stopReason?: string;
  suppressOutput?: boolean;
  systemMessage?: string;
};
export type PreToolUseInput = {
  agent_id?: string;
  agent_type?: string;
  cwd: string;
  hook_event_name: "PreToolUse";
  model: string;
  permission_mode: "default" | "acceptEdits" | "plan" | "dontAsk" | "bypassPermissions";
  session_id: string;
  tool_input: unknown;
  tool_name: string;
  tool_use_id: string;
  transcript_path: string | null;
  turn_id: string;
};
export type PreToolUseOutput = {
  continue?: boolean;
  decision?: "approve" | "block";
  hookSpecificOutput?: {
    additionalContext?: string;
    hookEventName: "PreToolUse";
    permissionDecision?: "allow" | "deny" | "ask";
    permissionDecisionReason?: string;
    updatedInput?: unknown;
  };
  reason?: string;
  stopReason?: string;
  suppressOutput?: boolean;
  systemMessage?: string;
};
export type SessionEndInput = {
  cwd: string;
  hook_event_name: "SessionEnd";
  reason: "other";
  session_id: string;
  transcript_path: string | null;
};
export type SessionStartInput = {
  cwd: string;
  hook_event_name: "SessionStart";
  model: string;
  permission_mode: "default" | "acceptEdits" | "plan" | "dontAsk" | "bypassPermissions";
  session_id: string;
  source: "startup" | "resume" | "clear" | "compact" | "fork";
  transcript_path: string | null;
};
export type SessionStartOutput = {
  continue?: boolean;
  hookSpecificOutput?: {
    additionalContext?: string;
    hookEventName: "SessionStart";
  };
  stopReason?: string;
  suppressOutput?: boolean;
  systemMessage?: string;
};
export type StopInput = {
  cwd: string;
  hook_event_name: "Stop";
  last_assistant_message: string | null;
  model: string;
  permission_mode: "default" | "acceptEdits" | "plan" | "dontAsk" | "bypassPermissions";
  session_id: string;
  stop_hook_active: boolean;
  transcript_path: string | null;
  turn_id: string;
};
export type StopOutput = {
  continue?: boolean;
  decision?: "block";
  reason?: string;
  stopReason?: string;
  suppressOutput?: boolean;
  systemMessage?: string;
};
export type SubagentStartInput = {
  agent_id: string;
  agent_type: string;
  cwd: string;
  hook_event_name: "SubagentStart";
  model: string;
  permission_mode: "default" | "acceptEdits" | "plan" | "dontAsk" | "bypassPermissions";
  session_id: string;
  transcript_path: string | null;
  turn_id: string;
};
export type SubagentStartOutput = {
  continue?: boolean;
  hookSpecificOutput?: {
    additionalContext?: string;
    hookEventName: "SubagentStart";
  };
  stopReason?: string;
  suppressOutput?: boolean;
  systemMessage?: string;
};
export type SubagentStopInput = {
  agent_id: string;
  agent_transcript_path: string | null;
  agent_type: string;
  cwd: string;
  hook_event_name: "SubagentStop";
  last_assistant_message: string | null;
  model: string;
  permission_mode: "default" | "acceptEdits" | "plan" | "dontAsk" | "bypassPermissions";
  session_id: string;
  stop_hook_active: boolean;
  transcript_path: string | null;
  turn_id: string;
};
export type SubagentStopOutput = {
  continue?: boolean;
  decision?: "block";
  reason?: string;
  stopReason?: string;
  suppressOutput?: boolean;
  systemMessage?: string;
};
export type UserPromptSubmitInput = {
  agent_id?: string;
  agent_type?: string;
  cwd: string;
  hook_event_name: "UserPromptSubmit";
  model: string;
  permission_mode: "default" | "acceptEdits" | "plan" | "dontAsk" | "bypassPermissions";
  prompt: string;
  session_id: string;
  transcript_path: string | null;
  turn_id: string;
};
export type UserPromptSubmitOutput = {
  continue?: boolean;
  decision?: "block";
  hookSpecificOutput?: {
    additionalContext?: string;
    hookEventName: "UserPromptSubmit";
  };
  reason?: string;
  stopReason?: string;
  suppressOutput?: boolean;
  systemMessage?: string;
};
