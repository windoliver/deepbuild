// The wrong programs each criterion names, run as planted hubs (DEEP_HUB_PLANT, README: Wrong programs): each
// scenario must fail on its plant, naming the ask, the command or the call. A plant the hub doesn't know makes it
// exit at start, and the scenario fails BLOCKED, which these tests don't accept as the plant's failure.

import { afterEach, expect, it } from 'vitest';
import { ON_MACOS, cleanup } from './helpers.ts';
import { agentAnswerRefused, authorityCommandsWaitForYou, doubleForkedAnswer, hubUseWaitsForYou, offKeepsTheGuards } from './scenarios.ts';

afterEach(cleanup, 60_000);

async function failure(scenario: () => Promise<void>): Promise<string> {
  try {
    await scenario();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return '';
}
const notBlocked = (message: string) => expect(message, 'the plant must start and run; a BLOCKED or INCONCLUSIVE run is not its failure').not.toMatch(/^(BLOCKED|INCONCLUSIVE)/);

it('AC2 #19.2c46147f (wrong program) a hub that lets a deep command inside an agent\'s process tree answer as you (answer-inside-session) fails, naming the ask', async () => {
  const message = await failure(() => agentAnswerRefused('answer-inside-session'));
  notBlocked(message);
  expect(message).toMatch(/ask ask:[0-9A-Za-z]+ \(answered decline by deep inbox answer, run inside agent session/);
}, 600_000);

it('AC19 #19.1a7ba6d9 (wrong program) a hub that counts the answer because the peer check found no agent above it (answer-on-peer-check) fails, naming the ask', async (ctx) => {
  if (!ON_MACOS) ctx.skip(`INCONCLUSIVE: macOS only; this is ${process.platform}`);
  const message = await failure(() => doubleForkedAnswer('answer-on-peer-check'));
  notBlocked(message);
  expect(message).toMatch(/ask ask:[0-9A-Za-z]+ \(answered decline by deep inbox answer, typed by a process agent session/);
}, 600_000);

it('AC21 #19.0694d419 (wrong program) a deep that acts on `deep off`, `deep on`, `deep hub stop` and `deep setup --undo` because the peer check found no agent (acts-on-peer-check) fails, naming the command', async (ctx) => {
  if (!ON_MACOS) ctx.skip(`INCONCLUSIVE: macOS only; this is ${process.platform}`);
  const message = await failure(() => authorityCommandsWaitForYou('acts-on-peer-check'));
  notBlocked(message);
  expect(message).toMatch(/^AC21 `deep off`, run by a process agent session \S+ double-forked so launchd adopted it, turned the next hook reply watch-only with the OS confirmation cancelled/);
}, 900_000);

it('AC22 #19.a4f7c68a (wrong program) a deep that opts the worktree in to the dev hub because the peer check found no agent (acts-on-peer-check) fails, naming the command', async (ctx) => {
  if (!ON_MACOS) ctx.skip(`INCONCLUSIVE: macOS only; this is ${process.platform}`);
  const message = await failure(() => hubUseWaitsForYou('acts-on-peer-check'));
  notBlocked(message);
  expect(message).toMatch(/^AC22 `deep hub use --root \S+`, run in \S+ by a process agent session \S+ double-forked so launchd adopted it, sent the worktree's next session \S+ to the dev hub with the OS confirmation cancelled/);
}, 600_000);

it('AC24 #19.44419f7e (wrong program) a `deep off` that turns the fail-closed guards watch-only too (off-guards-watch-only) lets all three calls through and fails, naming each call', async () => {
  const message = await failure(() => offKeepsTheGuards('off-guards-watch-only'));
  notBlocked(message);
  expect(message).toMatch(/^AC24 after a confirmed deep off, the fail-closed guards must still deny each call/);
  for (const call of ['`pkill -f vite`', '.deepbuild/done.yaml', '`hooks = false`']) expect(message, `the failure names ${call} as let through`).toMatch(new RegExp(`${call.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^;]*was let through`));
}, 600_000);
