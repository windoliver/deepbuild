// #111.AC3 An agent starting work on a screen gets your past taste decisions for it, with their screenshots, at session
// start. Your taste calls are made as the product makes them: an agent's deep_ask of kind taste on a screen and element,
// its screenshot through deep_evidence, and your answer with that screenshot (ask.answer's `image`, #327). What the new
// session is given is read from its SessionStart and first prompt's hook replies (README, Invented here: which screen).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { callTool, cleanup, compile, control, filedWhileWaiting, hubOf, memoryHome, onBranch, pending, png, sha, startAgent, type Line, type Mem } from './helpers.ts';

afterAll(cleanup, 60_000);
const AC3 = '#111.536dfc0e';

interface Call { screen: string; element: string; chosen: string; passed: string; image: string }
/** One taste call answered by you, with its screenshot, in `repo`. */
async function tasteCall(m: Mem, repo: string, screen: string, element: string, chosen: string, passed: string): Promise<Call> {
  const hub = hubOf(m);
  const { agent } = await startAgent(m, repo, `work on the ${screen} screen`);
  const file = join(repo, `${screen}-${element}.png`);
  const bytes = png(`${repo}/${screen}/${element}`);
  writeFileSync(file, bytes);
  const stored = await callTool(agent, 'deep_evidence', { path: file, kind: 'screenshot', origin: null });
  expect(stored.isError, `the screenshot is stored: ${JSON.stringify(stored.reply).slice(0, 500)}`).toBe(false);
  const image = /[0-9a-f]{64}/.exec(JSON.stringify(stored.value))?.[0] ?? sha(bytes);
  const question = `Which ${element} on ${screen} in ${repo}?`;
  const asked = pending(callTool(agent, 'deep_ask', {
    kind: 'taste', question, options: [{ id: 'chosen', label: chosen }, { id: 'passed', label: passed }], recommended: 'passed',
    subject: { point: null, screen, element },
  }));
  const created = await filedWhileWaiting(asked, hub, (e: { kind: string; data: Line }) => e.kind === 'ask.created' && e.data?.question === question, question);
  await control(m.h.home, (c) => c.call('ask.answer', { ask: `ask:${created.id}`, option: 'chosen', image }));
  await asked;
  return { screen, element, chosen, passed, image };
}

async function world(): Promise<{ m: Mem; checkout: Call; settings: Call; other: Call }> {
  const m = memoryHome({ agents: ['claude'] });
  await compile(m);
  const checkout = await tasteCall(m, m.api, 'checkout', 'paybutton', 'Keep the pay button in view, marker amberline', 'Let the pay button scroll, marker bluffline');
  const settings = await tasteCall(m, m.api, 'settings', 'savebar', 'Pin the save bar, marker cedarline', 'Float the save bar, marker duneline');
  const other = await tasteCall(m, m.web, 'checkout', 'paybutton', 'A web pay button, marker emberline', 'Another web pay button, marker fernline');
  return { m, checkout, settings, other };
}

describe(`${AC3} your past taste decisions at session start`, () => {
  it(`${AC3} an agent starting on checkout gets checkout's decision with its screenshot, and nothing of another screen or another repo`, async () => {
    const { m, checkout, settings, other } = await world();
    onBranch(m, m.api, 'checkout');
    const { delivered } = await startAgent(m, m.api, 'Fix the spacing on the checkout screen');
    expect(delivered, 'what you chose on this screen').toContain('marker amberline');
    expect(delivered, 'with its screenshot, by hash').toContain(checkout.image);
    expect(delivered, 'not what you passed over').not.toContain('marker bluffline');
    expect(delivered, 'not another screen\'s decision').not.toContain('marker cedarline');
    expect(delivered, 'not another screen\'s screenshot').not.toContain(settings.image);
    expect(delivered, 'not another repo\'s decision on a screen of the same name').not.toContain('marker emberline');
    expect(delivered, 'not another repo\'s screenshot').not.toContain(other.image);
  }, 900_000);

  it(`${AC3} an agent starting on settings gets settings', and one starting on a screen you never called gets none`, async () => {
    const { m, checkout, settings } = await world();
    onBranch(m, m.api, 'settings');
    const on = await startAgent(m, m.api, 'Fix the spacing on the settings screen');
    expect(on.delivered, 'settings\' decision').toContain('marker cedarline');
    expect(on.delivered, 'and its screenshot').toContain(settings.image);
    expect(on.delivered, 'not checkout\'s').not.toContain('marker amberline');
    expect(on.delivered, 'nor checkout\'s screenshot').not.toContain(checkout.image);
    onBranch(m, m.api, 'billing');
    const none = await startAgent(m, m.api, 'Fix the spacing on the billing screen');
    for (const mark of ['marker amberline', 'marker cedarline', checkout.image, settings.image]) expect(none.delivered, `billing gets no ${mark}`).not.toContain(mark);
  }, 900_000);
});
