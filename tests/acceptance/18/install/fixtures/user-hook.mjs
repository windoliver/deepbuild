// A hook of yours, or of another tool, as a settings file runs it: `node user-hook.mjs <name> <log>`. It appends
// {name, input} to <log>, one JSON line per run, so a test sees that it ran and with which payload. As your own
// guard it denies a Bash call whose command has `rm -rf`, in Claude Code's PreToolUse output; at SessionStart it
// adds one line of context. Nothing else.
import { appendFileSync, readFileSync } from 'node:fs';

const [, , name, log] = process.argv;
let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { /* no input */ }
appendFileSync(log, `${JSON.stringify({ name, input, pid: process.pid })}\n`);
if (input.hook_event_name === 'PreToolUse' && input.tool_name === 'Bash' && String(input.tool_input?.command ?? '').includes('rm -rf')) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `${name}: no rm -rf here` } }));
} else if (input.hook_event_name === 'SessionStart') {
  process.stdout.write(`${name} says hello to ${input.session_id}`);
}
