// The wrong programs the criteria name, each a plant of the asks core (`AsksPlant`, the `plant` option of openAsks,
// as #318's and #23's suites plant the core). Under each, the criterion's own scenario must fail at its criterion's
// check, naming the address, the URL or the option the criterion says. A run that fails any other way (a refusal, a
// missing surface) or passes doesn't count: the plant test fails.

import { expect, test } from 'vitest';
import type { AsksPlant } from '../../../packages/asks/src/index.ts';
import { CriterionFailed, inWorld, type World } from './helpers.ts';
import { AUDIT, BOSS, EVIL, fetchedPageCc, noWiderScope, readmeRemote, standingRule } from './scenarios.ts';

const LONG = 600_000;

async function failsNaming(plant: AsksPlant, scenario: (w: World) => Promise<unknown>, named: RegExp): Promise<void> {
  let error: unknown;
  try {
    await inWorld(scenario, plant);
  } catch (e) {
    error = e;
  }
  expect(error, `under the plant ${plant} the criterion's test must fail`).toBeInstanceOf(CriterionFailed);
  expect((error as CriterionFailed).target, `under the plant ${plant} the failure names ${named} (${(error as Error).message})`).toMatch(named);
}

const esc = (s: string): RegExp => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

test('AC1 #1098.23c3f8ea (wrong program `origin-from-agent-message`) a card that takes a target\'s origin from the agent\'s message fails, naming audit@evil.example', async () => {
  await failsNaming('origin-from-agent-message', fetchedPageCc, esc(AUDIT));
}, LONG);

test('AC1 #1098.23c3f8ea (wrong program `first-recipient-origin`) a card that gives every recipient of one send the first recipient\'s origin fails, naming audit@evil.example', async () => {
  await failsNaming('first-recipient-origin', fetchedPageCc, esc(AUDIT));
}, LONG);

test('AC2 #1098.cfbd489a (wrong program `rule-by-recipient-kind`) a rule matched by recipient kind alone lets the send to boss@corp.example through, and fails, naming it', async () => {
  await failsNaming('rule-by-recipient-kind', standingRule, esc(BOSS));
}, LONG);

test('AC3 #1098.7e22fb1f (wrong program `push-target-as-repo`) a matcher that reads every push target as `repo` fails, naming https://git.evil.example/x.git', async () => {
  await failsNaming('push-target-as-repo', readmeRemote, esc(EVIL));
}, LONG);

test('AC4 #1098.c09c4e38 (wrong program `wider-scope-offered`) a card with a `read` target that offers a wider scope fails, naming the option', async () => {
  await failsNaming('wider-scope-offered', noWiderScope, /for this repo|always/i);
}, LONG);
