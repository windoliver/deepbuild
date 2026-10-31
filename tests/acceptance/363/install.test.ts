// AC6: at install a test plug-in is refused, naming the rule, when a change action changes a store kind no action or
// reading lets an agent read, when one field name has two types across its schemas, or when an action's output is only
// a success flag and a message; with each fixed it installs, and an error the action raises reaches the agent as an
// error.
//
// "At install" is the install a person runs: install, conformance, load (README, Readings). Each refused twin differs
// from the fixed plug-in in the one thing its rule names (fixtures/rules). The error is read through a real hub's
// deep-actions, as the agent sees it.
import { describe, expect, it } from 'vitest';
import { hubWorld } from './hub.ts';
import { call, done, openHost, openWorld, pkg, requestId, tryInstall } from './helpers.ts';

const RULES = 'test/rules';
const FIXED = { probe: { case: 'fixed' } };
const CASES = [
  {
    case: 'unread-change',
    what: 'a change action changes a store kind no action or reading lets an agent read',
    // Its manifest declares only the actions it registers: no list-alerts.
    manifest: { actions: ['ext.rules.set_alert', 'ext.rules.boom'] },
    names: ['ext.rules.alert', 'ext.rules.set_alert'],
    rule: /\bread/i,
  },
  {
    case: 'two-types',
    what: 'one field name has two types across its schemas',
    manifest: {},
    // The field and both its types name this rule.
    names: ['above', 'number', 'string'],
    rule: /\babove\b/,
  },
  {
    case: 'flag-message',
    what: 'an action\'s output is only a success flag and a message',
    manifest: {},
    names: ['ext.rules.set_alert'],
    rule: /\b(flag|message|success)\b/i,
  },
] as const;

describe('AC6 #363.18d8b91c At install a test plug-in is refused, naming the rule, when a change action changes a store kind no action or reading lets an agent read, when one field name has two types across its schemas, or when an action\'s output is only a success flag and a message; with each fixed it installs, and an error the action raises reaches the agent as an error', () => {
  for (const c of CASES) {
    it(`AC6 refused when ${c.what}, naming the rule; fixed, it installs and its actions run`, async () => {
      const w = await openWorld();
      const h = await openHost(w);
      const refused = await tryInstall(h, await pkg('rules', { manifest: c.manifest, probe: { case: c.case } }));
      expect(refused.ok, `the plug-in where ${c.what} is refused at install`).toBe(false);
      const reason = refused.ok ? '' : refused.reason;
      for (const name of c.names) expect(reason, `the refusal names ${name}`).toContain(name);
      expect(reason, `the refusal names the rule: ${c.what}`).toMatch(c.rule);
      expect((await h.loaded()).some((l) => l.id === RULES), 'nothing of the refused plug-in runs').toBe(false);

      const fixed = await tryInstall(h, await pkg('rules', FIXED));
      expect(fixed.ok, `fixed, it installs: ${fixed.ok ? '' : `${fixed.step}: ${fixed.reason}`}`).toBe(true);
      await done(call(h, 'ext.rules.set_alert', { symbol: 'NVDA', above: 200 }, { id: RULES }), 'the fixed plug-in\'s set-alert');
      const listed = await done(call(h, 'ext.rules.list_alerts', {}, { id: RULES }), 'the fixed plug-in\'s list-alerts');
      expect(listed, 'the fixed plug-in reads back what it changed').toEqual({ alerts: [{ symbol: 'NVDA', above: 200 }] });
    }, 120_000);
  }

  it('AC6 an error the fixed plug-in\'s action raises reaches the agent through deep-actions as an error', async () => {
    const w = await hubWorld([await pkg('rules', FIXED)]);
    await w.agent.initialize('deep-actions');
    const r = await w.agent.callTool('deep-actions', 'call_action', { action: 'ext.rules.boom', request: requestId(), input: JSON.stringify({ symbol: 'NVDA' }) }, 60_000);
    expect(r.protocolError, `the error is a tool result, not a JSON-RPC error: ${JSON.stringify(r.reply).slice(0, 800)}`).toBe(false);
    expect(r.isError, `the action's error reaches the agent as an error: ${JSON.stringify(r.reply).slice(0, 800)}`).toBe(true);
    expect(r.value?.status, 'an error is never a done result').not.toBe('done');
  }, 240_000);
});
