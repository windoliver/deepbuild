// #363: an error a plug-in's action raises once its handler started reaches the agent through deep-actions as a
// failed call, never as the hub being unavailable, which says nothing ran. Run against a real hub and the built CLI.
import { expect, it } from 'vitest';
import { pkg, requestId } from '../../../tests/acceptance/363/helpers.ts';
import { hubWorld } from '../../../tests/acceptance/363/hub.ts';

it('a plug-in action that throws reaches the agent as failed, not as the hub unavailable', async () => {
  const w = await hubWorld([await pkg('rules', { probe: { case: 'fixed' } })]);
  await w.agent.initialize('deep-actions');
  const r = await w.agent.callTool('deep-actions', 'call_action', { action: 'ext.rules.boom', request: requestId(), input: JSON.stringify({ symbol: 'NVDA' }) }, 60_000);
  expect(r.isError, JSON.stringify(r.reply).slice(0, 800)).toBe(true);
  expect(r.value, JSON.stringify(r.reply).slice(0, 800)).toMatchObject({ status: 'failed' });
}, 240_000);
