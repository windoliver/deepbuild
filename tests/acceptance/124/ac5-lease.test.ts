// Criterion 5, the part that is a count and not a timing: at most two replicas per machine, under a lease. Agents reach
// replicas through the deep_drive tool of `deep mcp`, so this test does too: a real hub in a temporary home, two agent
// stand-ins (#806's, a Claude Code session and a Codex session known to the hub by their hooks) each with their own
// `deep mcp`, each driven as that agent is: a Claude Code call binds by its deep mcp's parent, the session whose hooks came
// from that process, so its deep mcp starts after those hooks; a Codex process may run another thread at any time, so its
// deep mcp binds to nothing and each call binds only by the PreToolUse Codex fires for it (Core.mcpHello, Core.bind; #26's
// binding tests; design: One role per credential), one stamp per call, spent even when the call is refused.
// Two launches hold the machine's two replicas; a third, from the other session, is refused naming the lease while no third
// replica process runs; once one replica is closed, the third launch gets it. The wrong program is a hub planted to launch
// replicas without the lease (DEEP_HUB_PLANT=deep-drive-no-lease), which the same judge fails.
// The timings (launch, round trip, snapshot, memory) are in ac5-budgets.live.test.ts, on the reference Mac; this file
// also checks the perf lane holds the four tasks that compare them with the merge base.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Stand, uuidOf } from '../806/helpers.ts';
import { ID, PANEL, REPLICAS_PER_MACHINE, REPO, buildDrive, cleanup, family, requireMacos, sleep, t26, type Obj } from './helpers.ts';

afterEach(cleanup, 60_000);

/** The perf lane's tasks for the replica (README: Criterion 5): it measures each against the merge base. */
const PERF_TASKS = ['replica-launch', 'replica-action', 'replica-snapshot-2000', 'replica-memory'];

/** The deep-drive processes running under the hub right now. */
function replicasUnder(hubPid: number): number[] {
  const mine = family(hubPid);
  return spawnSync('ps', ['-A', '-o', 'pid=,comm='], { encoding: 'utf8' }).stdout.split('\n')
    .map((l) => l.trim().split(/\s+/, 2)).filter(([pid, comm]) => pid && comm && basename(comm) === 'deep-drive' && mine.has(Number(pid))).map(([pid]) => Number(pid));
}

const launchArgs = { call: 'launch', launch: { from: 'fixture', panel: PANEL.form, clock: 'virtual' } };
const refusedFor = (o: t26.Outcome): string | null => {
  const text = JSON.stringify(o.value ?? o.reply);
  return o.isError || (o.value as Obj | undefined)?.ok === false ? text : null;
};

/** One deep_drive call as its agent makes it: `stamp` is the PreToolUse a Codex call needs, and nothing for Claude Code's. */
async function drive(hub: t26.Hub, agent: Stand, args: Obj): Promise<t26.Outcome> {
  await agent.stamp(hub, 'deep_drive', args);
  return t26.callTool(agent, 'deep_drive', args, 180_000);
}

async function threeLaunches(plant?: string): Promise<{ problems: string[]; most: number }> {
  buildDrive();
  const { tmp, home } = t26.makeHome();
  const wt = t26.makeWorktree(join(tmp, 'work'));
  const hub = await t26.startHub(home, plant ? { plant } : {});
  const a = Stand.start(home, wt.path, 'claude-code', uuidOf(`dd124-lease-a-${plant ?? ''}`));
  const b = Stand.start(home, wt.path, 'codex', uuidOf(`dd124-lease-b-${plant ?? ''}`));
  for (const s of [a, b]) { await s.establish(hub); await t26.initialize(s); }
  const problems: string[] = [];
  let most = 0;
  const count = () => { const n = replicasUnder(hub.pid).length; most = Math.max(most, n); return n; };
  const running = (n: number, when: string) => { const seen = count(); if (seen !== n) problems.push(`${seen} replica processes ran ${when}, not ${n}`); };
  const first = await drive(hub, a, launchArgs);
  const second = await drive(hub, a, launchArgs);
  for (const [o, which] of [[first, 'first'], [second, 'second']] as const) if (refusedFor(o)) problems.push(`the ${which} launch was refused: ${refusedFor(o)!.slice(0, 400)}`);
  running(REPLICAS_PER_MACHINE, 'after the two launches');
  // Sampled from before the call until a second after its answer: a third process that starts and goes again counts too.
  const sampling = setInterval(count, 100);
  let third: t26.Outcome;
  try {
    third = await drive(hub, b, launchArgs);
    await sleep(1000);
  } finally {
    clearInterval(sampling);
  }
  const why = refusedFor(third);
  if (!why) problems.push(`a third replica launched while two ran: ${JSON.stringify(third.value).slice(0, 300)}`);
  else if (!/lease/i.test(why)) problems.push(`the third launch was refused without naming the lease: ${why.slice(0, 400)}`);
  const handle = (first.value as Obj | undefined)?.replica;
  const closed = await drive(hub, a, { call: 'close', replica: handle });
  if (refusedFor(closed)) problems.push(`closing the first replica was refused: ${refusedFor(closed)!.slice(0, 300)}`);
  await sleep(500);
  running(REPLICAS_PER_MACHINE - 1, 'once one replica closed');
  const again = await drive(hub, b, launchArgs);
  if (refusedFor(again)) problems.push(`with one replica closed, the third launch is still refused: ${refusedFor(again)!.slice(0, 300)}`);
  running(REPLICAS_PER_MACHINE, 'once the third launch got the closed one\'s place');
  if (most > REPLICAS_PER_MACHINE) problems.push(`${most} replica processes ran at once under the hub`);
  return { problems, most };
}

describe(`${ID.budgets} the local preflight compares the replica's budgets with the merge base`, () => {
  it(`${ID.budgets} the perf lane's budgets hold a task for each of launch, action round trip, 2,000-node snapshot and memory, each running deep-drive`, () => {
    const tasks = (JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: Obj[] }).tasks;
    for (const id of PERF_TASKS) {
      const task = tasks.find((t) => t.id === id);
      expect(task, `benchmarks/budgets.json has the task ${id}`).toBeDefined();
      const command = (task!.command as string[]).join(' ');
      const script = (task!.command as string[]).find((part) => /\.(mjs|js|ts)$/.test(part));
      const runsDrive = command.includes('deep-drive') || (script !== undefined && readFileSync(join(REPO, script), 'utf8').includes('deep-drive'));
      expect(runsDrive, `${id}'s command runs deep-drive: ${command}`).toBe(true);
    }
  });
});

describe(`${ID.budgets} at most two replicas per machine, under a lease`, () => {
  it(`${ID.budgets} through deep_drive over deep mcp, two launches hold the machine's replicas, a third is refused naming the lease, and gets one once a replica closes`, async () => {
    requireMacos();
    const { problems, most } = await threeLaunches();
    expect(problems).toEqual([]);
    expect(most, 'two replicas ran at once').toBe(REPLICAS_PER_MACHINE);
  }, 900_000);

  it(`${ID.budgets} a hub planted to launch replicas without the lease fails the same judge`, async () => {
    requireMacos();
    const { problems } = await threeLaunches('deep-drive-no-lease');
    expect(problems.join('\n')).toMatch(/a third replica launched while two ran|3 replica processes ran at once/);
  }, 900_000);
});
