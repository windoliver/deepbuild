// The planted wrong programs that need a Set up, each in a world of its own on the fixture machine: a runtime folder
// with no shipped git (AC2), a hub that closes the sign-in row when the agent's page comes back (AC6), and a setup that
// installs another agent than the one the first screen named (AC8). Each meets the same judgement as the right program
// in journey.test.ts, and must fail it, naming what its criterion says.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  agentCalls, approve, cards, closedEarly, closeWorlds, CRITERION, events, firstLaunch, hubAnswers, installEventFailures, installOnScreen, MIN,
  mustName, named, openWorld, PLANT, pressSetUp, pressSignIn, refusedCalls, runtime, send, signIn, signInTasks, sleep, TRIP, tripAnswer, waitFor,
} from './helpers.ts';

afterEach(closeWorlds, 5 * MIN);

/** The git subcommand of a logged call, `git -C <dir> init -q …` → `init`. */
function subcommand(call: string): string | undefined {
  const words = call.split(/\s+/).slice(1);
  for (let i = 0; i < words.length; i++) {
    if (['-C', '-c', '--git-dir', '--work-tree', '--namespace'].includes(words[i]!)) { i++; continue; }
    if (!words[i]!.startsWith('-')) return words[i];
  }
  return undefined;
}

describe(`${named(2)} ${CRITERION[2]} (the build that needs a system git)`, () => {
  it(`${named(2)} (wrong program) a runtime folder with no shipped git, node scripts/app-runtime.mjs --plant ${PLANT.systemGit}, fails at its first git call, naming the call`, async () => {
    const w = await openWorld({ runtime: await runtime('system-git') });
    const shown: string[] = [];
    const { d } = await firstLaunch(w);
    const setup = await pressSetUp(d, 4 * MIN);
    shown.push(...setup.screen.texts);
    await d.stop();
    if (existsSync(join(w.root, 'setup-stopped.json'))) shown.push(readFileSync(join(w.root, 'setup-stopped.json'), 'utf8'));
    // Setup went through: the topic, the sign-in, the card and its approval, until a git call is made or a workspace is.
    if (!refusedCalls(w).length && setup.ready && await hubAnswers(w)) {
      w.model.answer(TRIP, tripAnswer(TRIP));
      const sent = await send(w, TRIP);
      shown.push(JSON.stringify(sent.reply));
      await waitFor(async () => signInTasks(await events(w), sent.since)[0], 2 * MIN);
      signIn(w);
      const card = await waitFor(async () => cards(await events(w), sent.since)[0] ?? (refusedCalls(w).length ? 'git' : undefined), 5 * MIN);
      if (card && card !== 'git') {
        const answered = await approve(w, card);
        shown.push(answered.stdout, answered.stderr);
        await waitFor(async () => refusedCalls(w).length > 0 || (await events(w)).some((e) => e.kind === 'workspace.created' && e.log_pos > sent.since), 3 * MIN);
      }
      await sleep(10_000);
    }
    if (existsSync(join(w.root, 'control.token'))) shown.push(...(await events(w).catch(() => [])).map((e) => JSON.stringify(e.data)));
    const calls = refusedCalls(w).filter((c) => c.startsWith('git '));
    expect(calls.length, `with no shipped git, the work's first git call must reach the system's git and fail (the refusing stand-ins logged ${JSON.stringify(refusedCalls(w))})`).toBeGreaterThan(0);
    const sub = subcommand(calls[0]!);
    const naming = new RegExp(`\\bgit\\b[^\\n]{0,120}\\b${sub ?? 'git'}\\b`);
    expect(shown.some((t) => naming.test(t)), `what DeepBuild showed (the screen, setup's stop, the box's and the answer's replies, the record) names the failed call, git ${sub}: ${JSON.stringify(shown.join(' | ').slice(-1500))}`).toBe(true);
  }, 180 * MIN);
});

describe(`${named(6)} ${CRITERION[6]} (the planted hub)`, () => {
  it(`${named(6)} (wrong program) a hub that closes the sign-in row when the agent's page comes back, DEEP_HUB_PLANT=${PLANT.closesOnReturn}, fails, naming the check`, async () => {
    const w = await openWorld({ runtime: await runtime('plain'), plant: PLANT.closesOnReturn });
    const { d } = await firstLaunch(w);
    const setup = await pressSetUp(d);
    await d.stop();
    if (!setup.ready || !(await hubAnswers(w))) throw Error(`BLOCKED: the planted world never reached the box after Set up: ${setup.failures.join('; ')}`);
    w.model.answer(TRIP, tripAnswer(TRIP));
    const sent = await send(w, TRIP);
    const task = await waitFor(async () => signInTasks(await events(w), sent.since)[0], 2 * MIN);
    if (!task) throw Error('BLOCKED: the planted hub raised no sign-in task to close');
    await pressSignIn(w, `ask:${task.id}`);
    await waitFor(() => agentCalls(w).includes('auth login'), 15_000, 250);
    await sleep(12_000);
    mustName(PLANT.closesOnReturn, closedEarly(await events(w), task, undefined), [`ask:${task.id}`, 'claude auth status', 'not signed in']);
  }, 180 * MIN);
});

describe(`${named(8)} ${CRITERION[8]} (the planted setup)`, () => {
  it(`${named(8)} (wrong program) a setup that installs another agent, DEEP_HUB_PLANT=${PLANT.otherAgent}, fails, naming both`, async () => {
    const w = await openWorld({ runtime: await runtime('plain'), plant: PLANT.otherAgent });
    const { d, screen } = await firstLaunch(w);
    const { agent } = installOnScreen(screen);
    await pressSetUp(d, 3 * MIN);
    await d.stop();
    if (!(await hubAnswers(w))) throw Error('BLOCKED: no hub answers after the planted Set up, so its events can\'t be read');
    const all = await waitFor(async () => { const e = await events(w); return e.some((x) => x.kind === 'setup.step' && x.data?.step === 'install') ? e : undefined; }, 2 * MIN) ?? await events(w);
    mustName(PLANT.otherAgent, installEventFailures(agent, all), ['Claude Code', 'Codex']);
  }, 180 * MIN);
});
