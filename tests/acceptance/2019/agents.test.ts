// AC5 #2019.524707a3: right after Set up with no session, the Agents page lists Claude Code, Codex and pi as waiting
// for a first session, and the list has no row for them; with Codex's hooks untrusted its row there says so with the
// fix; a planted Agents page that shows only its title fails.
//
// Two homes (helpers.ts, `setUpHome`): Claude Code, Codex and pi installed as stand-ins, a real hub, then `deep setup`.
// In one, Codex's own hook list reports DeepBuild's entries trusted; in the other, untrusted. The replica, over a copy
// of each home's record, opens the Agents page (`page/agents`) and reads each agent's row, `agent:<id>` (README, Pinned
// 5), and the list.
import { afterAll, describe, expect, test } from 'vitest';
import { AGENTS, agentsFailures, agentsPage, cleanup, ID, MIN, none, PLANT, setUpHome, type SetUp } from './helpers.ts';

afterAll(cleanup, 120_000);
let trustedHome: Promise<SetUp> | undefined;
const trusted = (): Promise<SetUp> => (trustedHome ??= setUpHome('trusted'));
const ALL = [AGENTS.claude, AGENTS.codex, AGENTS.pi];

describe(ID.agents, () => {
  test(`${ID.agents}: right after Set up with no session, the Agents page lists Claude Code, Codex and pi as waiting for a first session, and the list has no row for them; with Codex's hooks untrusted its row there says so with the fix`, async () => {
    const out = agentsFailures(await agentsPage(await trusted()), { waiting: ALL }).map((f) => `with Codex's hooks trusted: ${f}`);
    const untrusted = await setUpHome('untrusted');
    out.push(...agentsFailures(await agentsPage(untrusted), { waiting: [AGENTS.claude, AGENTS.pi], untrusted: AGENTS.codex }).map((f) => `with Codex's hooks untrusted: ${f}`));
    none(out, 'the Agents page right after Set up');
  }, 30 * MIN);

  test(`${ID.agents}: a planted Agents page that shows only its title fails`, async () => {
    const home = await trusted();
    // The replica's env-plants build with no plant chosen draws the page as the plain build does.
    none(agentsFailures(await agentsPage(home, { build: 'plants' }), { waiting: ALL }).map((f) => `the env-plants build with no plant chosen: ${f}`), 'the replica\'s env-plants build, with no plant chosen, draws the Agents page as the app does');
    const failures = agentsFailures(await agentsPage(home, { plant: PLANT.agentsTitleOnly }), { waiting: ALL });
    expect(ALL.filter((a) => failures.some((f) => f.includes(`has no row agent:${a.id}`))).map((a) => a.id), `DEEP_HUB_PLANT=${PLANT.agentsTitleOnly} must fail naming each agent's missing row: ${JSON.stringify(failures)}`).toEqual(ALL.map((a) => a.id));
  }, 30 * MIN);
});
