// #26.c1ac84d7 A `deep_run` naming the check `unti` is refused naming `check`, with `actual` set to `"unti"`; a
// refused field that holds a scrub-list value comes back scrubbed and cut at 8,192 characters; and
// `deep://codes/<code>` for the refusal's code returns, with no tool call, its meaning, the planted entry that raises
// it alone, the clean twin and its fix; a server whose errors leave out `actual`, or return the value unscrubbed,
// fails this test, naming the tool.
// #26.8a0223bc Every tool error matches the shared error shape, and each tool's description says what its result
// does not prove.
// The scrub-list value is the hub's own control token, a value it holds (design, Privacy: "its own tokens").

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  agentWorld, callTool, cleanup, errorOf, forms, initialize, listTools, McpProcess, REQUIRED_TOOLS, rootOf, type Line,
} from './helpers.ts';

afterEach(cleanup, 30_000);

async function refusals(plant?: string): Promise<void> {
  const w = await agentWorld({ plant });
  const typo = errorOf(await callTool(w.agent, 'deep_run', { check: 'unti' }), 'deep_run naming the check unti');
  expect(typo.path, `deep_run: the refusal of the check unti names check: ${JSON.stringify(typo)}`).toMatch(/(^|\/)check$/);
  expect(typo.actual, 'deep_run: the refusal of the check unti carries actual "unti"').toBe('unti');

  const token = readFileSync(join(rootOf(w.home), 'control.token'), 'utf8').trim();
  expect(token.length, 'BLOCKED unless the hub wrote its control token').toBeGreaterThanOrEqual(16);
  const head = 'a'.repeat(8180);
  for (const [how, check] of [['short', `zz${token}zz`], ['across the 8,192-character cut', `${head}${token}${'b'.repeat(2000)}`]] as const) {
    const o = await callTool(w.agent, 'deep_run', { check });
    const refused = errorOf(o, `deep_run naming a check that holds a scrub-list value (${how})`);
    const whole = JSON.stringify(o.reply);
    expect(forms(token).filter((f) => whole.includes(f)), `deep_run returned the scrub-list value unscrubbed (${how}) in its error`).toEqual([]);
    expect(whole.includes(token.slice(0, 12)), `deep_run returned part of the scrub-list value (${how}): it must be scrubbed whole before it is cut`).toBe(false);
    expect(typeof refused.actual === 'string' && refused.actual.length > 0, `deep_run: the refusal (${how}) carries the scrubbed value in actual`).toBe(true);
    expect(refused.actual.length, `deep_run: actual is cut at 8,192 characters (${how})`).toBeLessThanOrEqual(8192);
    if (how !== 'short') expect(refused.actual.startsWith(head), 'deep_run: actual keeps the scrubbed value\'s first 8,180 characters').toBe(true);
  }

  // The refusal's code, read as a resource by a deep mcp that has made no tool call.
  const reader = McpProcess.start(w.home, w.wt.path, plant ? { DEEP_HUB_PLANT: plant } : {});
  await initialize(reader);
  const uri = `deep://codes/${typo.code}`;
  const { reply } = await reader.request('resources/read', { uri });
  const content = (reply.result?.contents ?? [])[0] as Line | undefined;
  expect(content?.uri, `${uri} reads with no tool call: ${JSON.stringify(reply).slice(0, 1500)}`).toBe(uri);
  let page: Line = {};
  try { page = JSON.parse(String(content?.text)) as Line; } catch { /* checked below */ }
  expect(page.code, `${uri} is the page of the code deep_run's refusal carries`).toBe(typo.code);
  for (const field of ['meaning', 'fix'] as const) expect(typeof page[field] === 'string' && page[field].length > 0, `${uri} says its ${field}`).toBe(true);
  expect(page.planted !== undefined && page.planted !== null, `${uri} holds the planted entry that raises ${typo.code} alone`).toBe(true);
  expect(page.clean !== undefined && page.clean !== null, `${uri} holds the clean twin`).toBe(true);
  expect(JSON.stringify(page.clean), `${uri}: the clean twin differs from the planted entry`).not.toBe(JSON.stringify(page.planted));
}

test('#26.c1ac84d7 deep_run naming unti is refused naming check with actual "unti"; a scrub-list value comes back scrubbed and cut; deep://codes/<code> explains the code', async () => {
  await refusals();
}, 120_000);

test('#26.c1ac84d7 (wrong program) a server whose errors leave out actual fails, naming the tool', async () => {
  await expect(refusals('errors-without-actual')).rejects.toThrow(/deep_run/);
}, 120_000);

test('#26.c1ac84d7 (wrong program) a server that returns the refused value unscrubbed fails, naming the tool', async () => {
  await expect(refusals('errors-unscrubbed')).rejects.toThrow(/deep_run returned (the scrub-list value unscrubbed|part of the scrub-list value)/);
}, 120_000);

test('#26.8a0223bc every tool\'s error matches error@2, and every tool\'s description says what its result does not prove', async () => {
  const w = await agentWorld();
  const tools = await listTools(w.agent);
  expect(tools.map((t) => t.name), 'the tool list holds the issue\'s tools').toEqual(expect.arrayContaining(REQUIRED_TOOLS));
  for (const t of tools) {
    // A field no tool lists: the hub stays strict, so every tool refuses it (design: Version skew).
    errorOf(await callTool(w.agent, t.name, { deep26_unlisted: true }), `${t.name} called with a field it doesn't list`);
    expect(t.description ?? '', `${t.name}'s description says what its result does not prove`).toMatch(/\b(does not|doesn't|do not|don't|never) prove/i);
  }
  // Without the hub's binding too: a deep mcp no session's hooks came from.
  const hand = McpProcess.start(w.home, w.wt.path);
  await initialize(hand);
  for (const name of ['deep_claim', 'deep_ask', 'deep_evidence', 'deep_open_item']) {
    if (tools.some((t) => t.name === name)) errorOf(await callTool(hand, name, { deep26_unlisted: true }), `${name} from a deep mcp bound to no session, with a field it doesn't list`);
  }
}, 120_000);
