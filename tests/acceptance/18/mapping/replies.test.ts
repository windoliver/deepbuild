// AC4: every reply is watch-only. A session fires each of the nine hooks the adapter maps through deep-hook into
// `deep hub run`, with no guard entry installed (guards and their modes are #316's and #304's); every reply deep-hook
// prints for Claude Code must carry no decision field, and each hook is still recorded (watching is what it does).
import { afterAll, describe, expect, it } from 'vitest';
import { AC4, cleanup, failureOf, makeHome, ofSession, parseObject, repo, said, Session, settle, shown, startHub, type HookCall, type Hub } from './helpers.ts';

afterAll(cleanup, 60_000);

const NINE = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'SessionEnd'];

/**
 * The decision fields of Claude Code's hook output, any of which changes what the agent does: exit 2 (a block), and
 * in the JSON on stdout `decision`, `continue: false`, `stopReason`, and under hookSpecificOutput `permissionDecision`,
 * `decision` (a PermissionRequest's behavior), `updatedInput` and `updatedPermissions`. Context (additionalContext,
 * systemMessage) decides nothing.
 */
function decisionFields(h: HookCall): string[] {
  const found: string[] = [];
  if (h.ran.code === 2) found.push('exit 2');
  else if (h.ran.code !== 0) found.push(`exit ${h.ran.code}`);
  const text = h.ran.stdout.trim();
  if (!text) return found;
  const out = parseObject(text);
  if (!out) return [...found, 'stdout that is not one JSON object'];
  for (const key of ['decision', 'stopReason']) if (key in out) found.push(key);
  if (out.continue === false) found.push('continue: false');
  const specific = out.hookSpecificOutput ?? {};
  for (const key of ['permissionDecision', 'decision', 'updatedInput', 'updatedPermissions']) if (key in specific) found.push(`hookSpecificOutput.${key}`);
  return found;
}
/** The assertion the test and its wrong program share: each hook's reply is watch-only, naming the hook that isn't. */
function everyReplyWatchOnly(hooks: readonly HookCall[]): void {
  for (const h of hooks) expect(decisionFields(h), `the ${h.event} reply carries decision fields: ${said(h)}`).toEqual([]);
}

/** One session through all nine hooks: a push that asks permission, a failing test run, a stop, and a turn that ends on a rate limit. */
async function nineHooks(hub: Hub): Promise<Session> {
  const s = new Session(hub.home, { cwd: repo(hub.home) });
  await s.start();
  await s.prompt('Push the branch.');
  await s.call('Bash', { command: 'git push origin main', description: 'Push' }, {
    during: async (input) => {
      await s.hook('PermissionRequest', { tool_name: 'Bash', tool_input: input, permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'git push:*' }], behavior: 'allow', destination: 'localSettings' }] });
      return { stdout: '', stderr: 'Everything up-to-date', interrupted: false, isImage: false };
    },
  });
  await s.call('Bash', { command: 'npm test', description: 'Run the tests' }, { error: 'Exit code 1\nnpm ERR! missing script: test' });
  await s.stop('Pushed; the tests have no script.');
  await s.prompt('Try again.');
  await s.stopFailure('rate_limit', 'API Error: Rate limit reached');
  await s.end();
  return s;
}

describe(`${AC4} every reply is watch-only: no decision fields`, () => {
  it(`${AC4} each of the nine hooks gets a reply with no decision field, and each is recorded`, async () => {
    const hub = await startHub(makeHome());
    const s = await nineHooks(hub);
    expect(s.hooks.map((h) => h.event).filter((e, i, all) => all.indexOf(e) === i).sort(), 'the session fired all nine hooks').toEqual([...NINE].sort());
    everyReplyWatchOnly(s.hooks);
    const events = await settle(hub, (all) => ofSession(all, s.id).some((e) => e.kind === 'session.end'));
    const kinds = ofSession(events, s.id).map((e) => e.kind);
    for (const kind of ['session.start', 'user.ask', 'tool.before', 'permission.request', 'tool.after', 'agent.stop', 'session.end']) {
      expect(kinds, `watched: the session's hooks are recorded (${kind}); the session's events: ${ofSession(events, s.id).map(shown).join('; ')}`).toContain(kind);
    }
  }, 180_000);

  it(`${AC4} (wrong program) a hub whose adapter answers the permission request (DEEP_HUB_PLANT=adapter-decides) fails this test, naming the hook`, async () => {
    const hub = await startHub(makeHome(), 'adapter-decides');
    const s = await nineHooks(hub);
    const failure = await failureOf(() => everyReplyWatchOnly(s.hooks));
    expect(failure, `the planted adapter's replies must fail the watch-only assertion: ${s.hooks.map((h) => `${h.event}: ${said(h)}`).join('; ')}`).not.toBeNull();
    expect(failure, 'the failure names the hook').toContain('PermissionRequest');
  }, 180_000);
});
