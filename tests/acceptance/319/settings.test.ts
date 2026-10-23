// #319.49a0402f and #319.d452dc28: the values the rules leave open, drafted at setup into your
// ~/.deepbuild/config.json, and a repo's done.yaml overriding them key by key.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  ask, AT_DEADLINE, CLOSING, core, createdData, DEADLINE_MS, DRAFTED_DEADLINES, DRAFTED_DEFAULTS, DRAFTED_FOLD, KINDS, openWorld,
  sourceOf, T0, type World,
} from './helpers.ts';
import { choiceFromYourSettings } from './scenarios.ts';

let world: World | undefined;
afterEach(async () => { await world?.close(); world = undefined; });

test('#319.49a0402f setup drafts each kind\'s deadline and default, and at its deadline each ask takes what setup drafted', async () => {
  const w = (world = await openWorld({ settings: 'setup' }));
  const drafted = JSON.parse(readFileSync(join(w.home, 'config.json'), 'utf8')) as { asks?: { deadline?: unknown; default?: unknown; fold?: unknown } };
  expect(drafted.asks?.deadline, 'setup drafts taste 3 days, authority 1 day, unblock, exception and choice 2 days, definition 4 hours').toEqual(DRAFTED_DEADLINES);
  expect(drafted.asks?.default, 'setup drafts each kind\'s default').toEqual(DRAFTED_DEFAULTS);
  expect(drafted.asks?.fold, 'setup drafts the fold at five open asks').toBe(DRAFTED_FOLD);

  const raised = new Map<string, (typeof KINDS)[number]>();
  for (const [i, kind] of KINDS.entries()) {
    await w.start(`S${i}`, `T${i}`);
    raised.set(await w.asks.raise(core(`S${i}`), sourceOf(kind), ask(kind, `subject ${i}`)), kind);
  }
  for (const [h, kind] of raised) {
    const data = await createdData(w, h);
    expect(data.deadline, `ask ${h} (${kind}) takes the deadline setup drafted`).toBe(T0 + DEADLINE_MS[kind]);
    if (kind === 'taste' || kind === 'choice') expect(data.default, `ask ${h} (${kind}) defaults to its recommended option`).toBe(AT_DEADLINE[kind].answer);
  }
  await w.shown();
  for (const at of [...new Set(KINDS.map((k) => T0 + DEADLINE_MS[k]))].sort((a, b) => a - b)) {
    await w.at(at);
    await w.shown();
  }
  for (const [h, kind] of raised) {
    const closing = (await w.about(h)).filter((e) => CLOSING.includes(e.kind));
    expect(closing.map((e) => [e.kind, e.ts, (e.data as { answer: string }).answer, (e.data as { decision: string }).decision]), `ask ${h} (${kind}) takes its drafted default at its drafted deadline`)
      .toEqual([['ask.defaulted', T0 + DEADLINE_MS[kind], AT_DEADLINE[kind].answer, AT_DEADLINE[kind].decision]]);
  }
  // The early question locks the definition without its requirement: the agent hears "leave it out".
  const early = [...raised].find(([, k]) => k === 'definition')![0];
  expect(w.deliveries.filter((d) => d.ask === early).map((d) => [d.option, d.decision]), `the early question ${early} hands the agent "leave it out"`).toEqual([['drop', 'none']]);
});

test('#319.d452dc28 in a repo whose done.yaml sets deadlines only for taste and authority, a choice ask takes the choice deadline and default from your own settings', async () => {
  await choiceFromYourSettings();
});
