// #788: a Claude Code call that a warn-mode guard entry matches is still put to the extensions' tool.before
// handlers (#350). Their deny still denies it; their context reaches the agent after the warn's words; a handler that
// adds nothing, runs late or fails leaves the warning as the reply.
//
// Each test: a real hub on a temp home, the extension installed and loaded, rules.json holding one warn-mode entry,
// and a PreToolUse sent through the hub's socket as deep-hook sends it, naming the entry as matched.
import { describe, expect, it } from 'vitest';
import { CONTEXT_WORDS, DENY_WORDS, EXT, WARN, contextOf, decisionOf, withWorld } from './helpers.ts';

const rules = { [WARN.name]: WARN.entry };

/** The warning as the agent must still read it: the entry's reason, its next step and its name. */
function expectWarning(context: string, why: string): void {
  expect(context, `${why}: the warn entry's reason reaches the agent`).toContain(WARN.entry.reason);
  expect(context, `${why}: the warn entry's next step reaches the agent`).toContain(WARN.entry.next_step);
  expect(context, `${why}: the warning names its entry`).toContain(WARN.name);
}

describe('#788 a warn-mode guard entry and an extension on the same call', () => {
  it('#788.214d45c6 with a warn-mode guard entry matching a call, an extension that denies it still denies it', async () => {
    await withWorld(rules, async (w) => {
      const denied = await w.call('echo deny-me', [WARN.name]);
      expect(denied.reply.exit, 'the extension\'s deny ends the call (exit 2), warn entry or not').toBe(2);
      expect(denied.reply.stderr, 'the agent reads the deny\'s reason').toContain(DENY_WORDS);
      expect(denied.reply.stderr, 'the reason is labelled with the extension').toContain(EXT);
      expect(decisionOf(denied.reply), 'no hook output lets the call through').not.toBe('allow');
    });
  }, 300_000);

  it('#788.232478cf an extension\'s context for that call reaches the agent after the warn\'s words', async () => {
    await withWorld(rules, async (w) => {
      const told = await w.call('echo tell-me', [WARN.name]);
      expect(told.reply.exit, 'a warn and context let the call run').toBe(0);
      const context = contextOf(told.reply);
      expectWarning(context, 'a warn with an extension\'s context');
      expect(context, 'the extension\'s context reaches the agent').toContain(CONTEXT_WORDS);
      expect(context, 'its block is labelled with the extension').toContain(EXT);
      const warnAt = context.indexOf(WARN.entry.reason);
      const extAt = Math.min(...[context.indexOf(CONTEXT_WORDS), context.indexOf(EXT)].filter((i) => i >= 0));
      expect(warnAt, `the warn's words come before the extension's context in: ${JSON.stringify(context)}`).toBeLessThan(extAt);
      expect(context.indexOf(WARN.entry.next_step), 'the warn\'s next step also comes before the extension\'s context').toBeLessThan(extAt);
    });
  }, 300_000);

  it('#788.7e7bdede a handler that adds nothing leaves the warning as the reply', async () => {
    await withWorld(rules, async (w) => {
      const quiet = await w.call('echo quiet-me', [WARN.name]);
      expect(quiet.reply.exit, 'the call runs').toBe(0);
      expect(quiet.reply.stderr).toBe('');
      expect(decisionOf(quiet.reply), 'nothing denies it').not.toBe('deny');
      const context = contextOf(quiet.reply);
      expectWarning(context, 'a handler that adds nothing');
      expect(context, 'nothing from the extension is added').not.toContain(EXT);
    });
  }, 300_000);

  it('#788.7e7bdede a handler that runs late leaves the warning as the reply, before the hold', async () => {
    await withWorld(rules, async (w) => {
      const late = await w.call('echo late-me', [WARN.name]);
      expect(late.reply.exit, 'the call runs').toBe(0);
      expect(late.reply.stderr).toBe('');
      expect(decisionOf(late.reply), 'nothing denies it').not.toBe('deny');
      const context = contextOf(late.reply);
      expectWarning(context, 'a handler that runs late');
      expect(context, 'the late handler\'s context never arrives').not.toContain(EXT);
      expect(context).not.toContain('9 notes are open');
      if (typeof late.ack.hold_until_ms === 'number') expect(late.replied, 'the reply came before the hold deep-hook was given').toBeLessThan(late.ack.hold_until_ms);
    });
  }, 300_000);

  it('#788.7e7bdede a handler that fails leaves the warning as the reply', async () => {
    await withWorld(rules, async (w) => {
      const failed = await w.call('echo throw-me', [WARN.name]);
      expect(failed.reply.exit, 'the call runs').toBe(0);
      expect(failed.reply.stderr).toBe('');
      expect(decisionOf(failed.reply), 'nothing denies it').not.toBe('deny');
      const context = contextOf(failed.reply);
      expectWarning(context, 'a handler that fails');
      expect(context, 'nothing from the failed handler is added').not.toContain(EXT);
      expect(context).not.toContain('the handler broke');
    });
  }, 300_000);
});
