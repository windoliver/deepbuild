import { afterAll, describe, expect, it } from 'vitest';
import {
  AC4, TELEMETRY, allEvents, answers, cargoBuild, checkout, cleanup, deep, doctorMissingProblems, fastSession, hasDeepEntry, hubUp, itemsOf, makeHome,
  missingItems, proof, removeByHand, shared, shown, socketOf, stopHubByPid, terminal, waitFor, type Home, type Item, type Ran, type Repo,
} from '../668/helpers.ts';

afterAll(cleanup, 120_000);

const FOLDER = 'redraft-1713';
const HEALTHY_PLANTS = ['not-checked-exits-0'] as const;
const REMOVED_PLANTS = ['doctor-not-checked-first', 'doctor-misses-hooks'] as const;

const itemShown = (i: Item) => `${i.item} ${i.level} (${i.code}): ${i.evidence}`;
const notChecked = (r: Ran) => itemsOf(r).filter((i) => i.code === 'not_checked');

function healthyProblems(r: Ran): string[] {
  const items = itemsOf(r);
  if (!items.length) return [`${AC4} deep doctor --json must list its items: ${shown(r)}`];
  const out = items.filter((i) => i.level === 'fail').map((i) => `${AC4} after setup and the session no item of deep doctor may be failed: ${itemShown(i)}; fix: ${i.fix}`);
  if (r.code !== 0 && r.code !== 3) out.push(`${AC4} after setup and the session deep doctor must exit 0 or 3: ${shown(r)}`);
  const unchecked = notChecked(r);
  const want = out.length ? undefined : unchecked.length ? 3 : 0;
  if (want !== undefined && r.code !== want) {
    out.push(want === 3
      ? `${AC4} with no item failed and ${unchecked.map((i) => i.item).join(', ')} not checked, deep doctor must exit 3 by the exit-code table, never 0: ${shown(r)}`
      : `${AC4} with every item checked and none failed, deep doctor must exit 0: ${shown(r)}`);
  }
  return out;
}

function removedProblems(r: Ran, h: Home): string[] {
  const out = doctorMissingProblems(r, h, 'PreToolUse');
  if (r.code !== 1) out.push(`${AC4} with DeepBuild's PreToolUse entry removed by hand an item fails, so deep doctor must exit 1 by the exit-code table, even with an item not checked: ${shown(r)}`);
  return out;
}

interface World {
  h: Home; repo: Repo;
  doctor: Ran; healthyPlanted: Record<string, Ran>;
  missing: Ran; removedPlanted: Record<string, Ran>;
  fix: Ran; back: boolean; fixed: Ran;
}

const world = shared(async (): Promise<World> => {
  const h = makeHome({ fast: true });
  const repo = checkout(h);
  const terminals: string[] = [];
  const keep = (label: string, r: Ran) => { terminals.push(`${label}${terminal(r)}`); proof(FOLDER, 'terminal.txt', terminals.join('\n')); return r; };
  await cargoBuild();
  const setup = keep('', await deep(h, ['setup'], { cwd: repo.dir }));
  if (setup.code !== 0) throw Error(`${AC4} BLOCKED: deep setup must exit 0 before the doctor can be read: ${shown(setup)}`);
  await hubUp(h);
  const { s } = await fastSession(h, repo, async () => undefined);
  const stopped = await waitFor(async () => (await allEvents(h)).some((e) => e.session === s.id && e.kind === 'agent.stop'), 60_000);
  if (!stopped) throw Error(`${AC4} BLOCKED: the session ${s.id} never reached the record's stop, so there is no "after the session" to read the doctor in`);
  const doctor = keep('', await deep(h, ['doctor', '--json'], { cwd: repo.dir, env: TELEMETRY }));
  const healthyPlanted: Record<string, Ran> = {};
  for (const p of HEALTHY_PLANTS) healthyPlanted[p] = keep(`DEEP_HUB_PLANT=${p} `, await deep(h, ['doctor', '--json'], { cwd: repo.dir, env: { ...TELEMETRY, DEEP_HUB_PLANT: p } }));
  if (!hasDeepEntry(h, 'PreToolUse')) throw Error(`${AC4} BLOCKED: deep setup wrote no PreToolUse entry of DeepBuild's to remove by hand`);
  await stopHubByPid(h);
  removeByHand(h, 'PreToolUse');
  const missing = keep(`(DeepBuild's PreToolUse entry removed by hand, the hub stopped) `, await deep(h, ['doctor', '--json'], { cwd: repo.dir, env: TELEMETRY }));
  const removedPlanted: Record<string, Ran> = {};
  for (const p of REMOVED_PLANTS) removedPlanted[p] = keep(`DEEP_HUB_PLANT=${p} `, await deep(h, ['doctor', '--json'], { cwd: repo.dir, env: { ...TELEMETRY, DEEP_HUB_PLANT: p } }));
  const fix = keep('', await deep(h, ['setup'], { cwd: repo.dir }));
  await waitFor(() => answers(socketOf(h)), 30_000);
  const back = hasDeepEntry(h, 'PreToolUse');
  const fixed = keep('', await deep(h, ['doctor', '--json'], { cwd: repo.dir, env: TELEMETRY }));
  return { h, repo, doctor, healthyPlanted, missing, removedPlanted, fix, back, fixed };
});

describe(`AC4 ${AC4} after setup and the session no item of \`deep doctor\` is failed and it exits 0 or 3, and the entry removed by hand is still named with its fix`, () => {
  it(`AC4 ${AC4} after setup and the session, deep doctor shows no failed item and exits 0 or 3 as the exit-code table sets it; with DeepBuild's PreToolUse entry removed by hand (the hub stopped) it names the missing installation with the fix \`deep setup\` and exits 1, and that fix puts the entry back`, async () => {
    const w = await world();
    const problems = [...healthyProblems(w.doctor), ...removedProblems(w.missing, w.h)];
    if (w.fix.code !== 0 || !w.back) problems.push(`${AC4} the fix the doctor names, \`deep setup\`, must put DeepBuild's PreToolUse entry back in ${w.h.settings}: ${shown(w.fix)}`);
    if (missingItems(w.fixed, w.h, 'PreToolUse').length) problems.push(`${AC4} after the fix, deep doctor must no longer name DeepBuild's PreToolUse entry missing: ${shown(w.fixed)}`);
    expect(problems, `${AC4} the doctor after setup and the session, then with DeepBuild's entry removed by hand`).toEqual([]);
  }, 900_000);

  it(`AC4 ${AC4} (planted doctors) a doctor that exits 0 with an item not checked, one that exits 3 over a failed item, and one that trusts setup's record of its hooks each fail the same check, naming the criterion`, async () => {
    const w = await world();
    const first = w.removedPlanted['doctor-not-checked-first']!;
    if (!notChecked(first).length) throw Error(`${AC4} INCONCLUSIVE: the planted doctor doctor-not-checked-first differs from the right one only when an item reads not checked beside a failed one, and none read not checked here, so it plants nothing: ${shown(first)}`);
    expect(removedProblems(first, w.h).some((p) => p.startsWith(AC4) && p.includes('must exit 1')), `${AC4} the check must fail on DEEP_HUB_PLANT=doctor-not-checked-first, naming the criterion: ${shown(first)}`).toBe(true);
    const misses = w.removedPlanted['doctor-misses-hooks']!;
    expect(removedProblems(misses, w.h).some((p) => p.startsWith(AC4) && p.includes('must name the missing installation')), `${AC4} the check must fail on DEEP_HUB_PLANT=doctor-misses-hooks, naming the criterion: ${shown(misses)}`).toBe(true);
    const healthy = w.healthyPlanted['not-checked-exits-0']!;
    const failedThere = itemsOf(healthy).filter((i) => i.level === 'fail');
    if (failedThere.length) throw Error(`${AC4} INCONCLUSIVE: the planted doctor not-checked-exits-0 differs from the right one only when no item fails and one reads not checked, and here ${failedThere.map((i) => i.item).join(', ')} failed, so it plants nothing: ${shown(healthy)}`);
    if (!notChecked(healthy).length) throw Error(`${AC4} INCONCLUSIVE: the planted doctor not-checked-exits-0 differs from the right one only when an item reads not checked, and none did here, so it plants nothing: ${shown(healthy)}`);
    expect(healthyProblems(healthy).some((p) => p.startsWith(AC4) && p.includes('must exit 3')), `${AC4} the check must fail on DEEP_HUB_PLANT=not-checked-exits-0, naming the criterion: ${shown(healthy)}`).toBe(true);
  }, 900_000);
});
