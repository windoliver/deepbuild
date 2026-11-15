// #2084: the core's words are added to the settled hook reply, not substituted for the rewrite and notices in it.
import { expect, it } from 'vitest';
import { coreReplyLine } from '../src/hook-replies.js';

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
