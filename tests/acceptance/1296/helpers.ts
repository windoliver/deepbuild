// What #1296's tests share (README): the criterion tags and Claude Code's two limits as the issue states them. Each
// test file reaches DeepBuild through an earlier suite's helpers (19/doctor's world and doctor run, 340/flow's world,
// hub and session), imported, never copied.

// ---- Criterion tags: `#1296.<first 8 hex of the SHA-256 of the criterion's text>`, trimmed with white space collapsed,
// as scripts/proof-change.mjs's readIssue computes them (README, Criteria to tests).
export const AC1 = 'AC1 #1296.f8f2af0a';
export const AC2 = 'AC2 #1296.51fd7de6';
export const AC3 = 'AC3 #1296.f9371fe0';
export const AC4 = 'AC4 #1296.edc2bba0';
export const AC5 = 'AC5 #1296.8af9a270';

// ---- Claude Code's limits on a hook's injected output, as the issue states them.
/** Each hook's injected output is capped at this many characters. */
export const CAP = 10_000;
/** Past the cap, Claude sees a file path and a preview of this many characters, and isn't asked to read the file. */
export const PREVIEW = 2_000;

/** What the model sees of one injected text: all of it inside the cap, else only the preview. */
export const seenByModel = (text: string): string => (text.length > CAP ? text.slice(0, PREVIEW) : text);

/** Claude Code's hook events by name, for a message that must name one. */
export const HOOK_EVENTS = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Stop',
  'StopFailure', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact', 'Notification', 'TaskCreated', 'TaskCompleted',
] as const;
export const namesEvent = (text: string, event: string): boolean => new RegExp(`(?<![A-Za-z])${event}(?![A-Za-z])`).test(text);
