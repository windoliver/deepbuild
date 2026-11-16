// #2084: the core's words are added to the settled hook reply, not substituted for the rewrite and notices in it.
import { expect, it } from 'vitest';
import { agentReply, allowReply, coreReplyLine } from '../src/hook-replies.js';

it('keeps the lease rewrite, deadline, scoped rule and wait line beside the core notice and message', () => {
  const updatedInput = { command: 'deep lease -- cargo test --workspace', timeout: 60_000, description: 'Run the tests' };
  const ruled = JSON.stringify({ v: 1, exit: 0, stdout: JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput, additionalContext: 'Use the scoped rule.' },
    systemMessage: 'DeepBuild: waiting on the command.',
  }), stderr: 'existing diagnostic\n' }) + '\n';
  const reply = JSON.parse(coreReplyLine('claude-code', 'PreToolUse', {
    context: 'The sibling changed README.md.', message: 'DeepBuild: acknowledged your prompt.',
  }, ruled));
  expect(reply).toMatchObject({ v: 1, exit: 0, stderr: 'existing diagnostic\n' });
  expect(JSON.parse(reply.stdout)).toEqual({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse', updatedInput,
      additionalContext: 'Use the scoped rule.\nThe sibling changed README.md.',
    },
    systemMessage: 'DeepBuild: waiting on the command.\nDeepBuild: acknowledged your prompt.',
  });
});

// #2118: a standing rule's allow goes out with the extensions' context after its words, never in its place.
it("keeps a warn entry's words and each extension's block beside a standing rule's allow", () => {
  const ruled = JSON.stringify({ v: 1, exit: 0, stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'Mind the lockfile.' } }), stderr: '' }) + '\n';
  const allow = 'DeepBuild allowed this by your standing rule decision:01K.';
  const reply = { denies: [], context: [{ extension: 'acme/open-notes', text: '3 notes are open' }] };
  const output = (text: string) => JSON.parse(JSON.parse(text).stdout).hookSpecificOutput;
  const additionalContext = `Mind the lockfile.\n${allow}\n[acme/open-notes] 3 notes are open`;
  expect(output(allowReply(allow, true, ruled, reply))).toEqual({ hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: allow, additionalContext });
  // A permission mode that denies the call gets the words and no decision.
  expect(output(allowReply(allow, false, ruled, reply))).toEqual({ hookEventName: 'PreToolUse', additionalContext });
});

// #2118: a settled reply that holds a wait line alone has no hook output to read a warning from; the allow still goes
// out, and what the settled reply held stays beside an allow or an extension's context.
it("keeps the settled reply's wait line and rewrite beside a standing rule's allow and an extension's context", () => {
  const settled = (stdout: object) => JSON.stringify({ v: 1, exit: 0, stdout: JSON.stringify(stdout), stderr: '' }) + '\n';
  const read = (text: string) => JSON.parse(JSON.parse(text).stdout);
  const allow = 'DeepBuild allowed this by your standing rule decision:01K.';
  const systemMessage = 'DeepBuild: waiting on the command.';
  expect(read(allowReply(allow, true, settled({ systemMessage })))).toEqual({ systemMessage, hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: allow, additionalContext: allow } });
  const updatedInput = { command: 'deep lease -- cargo test --workspace' };
  const ruled = settled({ systemMessage, hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput } });
  const reply = { denies: [], context: [{ extension: 'acme/open-notes', text: '3 notes are open' }] };
  expect(read(agentReply('claude-code', reply, ruled))).toEqual({ systemMessage, hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput, additionalContext: '[acme/open-notes] 3 notes are open' } });
});
