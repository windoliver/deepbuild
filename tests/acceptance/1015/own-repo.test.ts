// #1015 AC7: in DeepBuild's own repo, `scripts/lease` calls `deep lease`, so a preflight and two `scripts/affected.mjs`
// runs started together all run leased, each of their blocks under its session. Scaled for a shared machine (README,
// AC7): the three run from three scripted Claude Code sessions in this checkout (a worktree session may not add
// worktrees to the repo), the preflight as its lane runner (`runLanes` of scripts/lanes.mjs, which the preflight runs
// every lane through) given one lane whose block is the stand-in `build-block`, and each affected.mjs run given one
// change, the probe test file, so its node --test block is the probe (fixtures/probe.test.mjs). Each block marks its
// start and holds until the test has read the record's leases.
import { describe, expect, it } from 'vitest';
import { AC7, claudeCall, heldNow, leaseRows, mustFail, REPO, Session, shownLeases, sleep, slotsOf, until, World, type LeaseRow } from './helpers.ts';

const PROBE = 'tests/acceptance/1015/fixtures/probe.test.mjs';
const PREFLIGHT = `node --input-type=module -e 'import { runLanes } from "./scripts/lanes.mjs"; process.exitCode = runLanes([{ name: "probe", commands: [["build-block"]], fix: "none" }]);'`;
const AFFECTED = `node scripts/affected.mjs ${PROBE}`;

interface Run { label: string; block: string; command: string }
const RUNS: Run[] = [
  { label: 'preflight', block: "the preflight's lane block `build-block`", command: PREFLIGHT },
  { label: 'affected-1', block: `affected run 1's node --test block \`${PROBE}\``, command: AFFECTED },
  { label: 'affected-2', block: `affected run 2's node --test block \`${PROBE}\``, command: AFFECTED },
];
interface Seen { runs: { run: Run; s: Session; started: boolean; held: LeaseRow[] }[] }

async function ownRepo(runs: readonly Run[], plant?: string): Promise<Seen> {
  const w = new World(plant ? { plant } : {});
  await w.startHub();
  const sessions = runs.map((r) => new Session(w, 'claude', REPO, { DH1015_DIR: w.runs, DH1015_LABEL: r.label }));
  try {
    await Promise.all(sessions.map((s) => s.begin('Run the preflight and the affected tests.')));
    const calls = await Promise.all(runs.map((r, i) => claudeCall(sessions[i]!, r.command)));
    // Each block, once it runs: the record's leases read, then the block let end.
    const held = new Map<string, LeaseRow[]>();
    await until(async () => {
      for (const r of runs) {
        if (held.has(r.label) || !w.started(r.label)) continue;
        held.set(r.label, heldNow(await leaseRows(w.hub!)));
        w.go(r.label);
      }
      return held.size === runs.length || calls.every((c) => c.bash?.finished() ?? true);
    }, 1_500_000, 1000);
    w.go('all');
    // The rest of each run (affected.mjs's lint jobs) proves nothing here: what is still running after 2 min is stopped with its group.
    const results = await Promise.all(calls.map((c) => Promise.race([c.after, sleep(120_000).then(() => undefined)])));
    const seen: Seen = { runs: runs.map((run, i) => ({ run, s: sessions[i]!, started: Boolean(w.started(run.label)), held: held.get(run.label) ?? [] })) };
    for (const [i, x] of seen.runs.entries()) console.log(`AC7 ${plant ?? 'as built'}: ${x.run.block} (session ${x.s.id.slice(0, 8)}) ${x.started ? `ran; cpu.slot leases of its session then: ${shownLeases(slotsOf(x.held, x.s))}` : 'never ran'}; exit ${results[i]?.code}; output tail ${JSON.stringify((results[i]?.output ?? '').slice(-400))}`);
    return seen;
  } finally {
    for (const s of sessions) s.stop();
    await w.stopHub();
  }
}

function judged({ runs }: Seen): void {
  for (const { run, s, started, held } of runs) {
    expect(started, `${run.block} must run (session ${s.id})`).toBe(true);
    expect(slotsOf(held, s).length, `${run.block} ran with no cpu.slot lease held by its session (session:${s.id}): through scripts/lease, \`deep lease\` holds one for it; the table held ${shownLeases(held)}`).toBeGreaterThanOrEqual(1);
  }
}

describe(`${AC7} DeepBuild's own preflight and affected.mjs runs lease each block through scripts/lease`, () => {
  it(`${AC7} a preflight and two affected.mjs runs started together all run leased, each block under its session`, async () => {
    judged(await ownRepo(RUNS));
  }, 2_400_000);
  it(`${AC7} (wrong program) a scripts/lease that runs the command directly (DEEP_HUB_PLANT=lease-script-runs-directly) fails this test, naming the block`, async () => {
    const seen = await ownRepo(RUNS.slice(0, 2), 'lease-script-runs-directly');
    await mustFail('lease-script-runs-directly', () => judged(seen), ['block', 'ran with no cpu.slot lease']);
  }, 2_400_000);
});
