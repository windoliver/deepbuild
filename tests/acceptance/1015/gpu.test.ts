// #1015 AC6: the `gpu` lease's two modes. Two conformance-kit runs hold it shared at the same time; an export asking for
// it exclusive waits for both to end; while the export runs, a third kit run waits. Each run is a session's
// `deep lease gpu:<mode> -- <command>` (README, Surfaces), the command a stand-in (`kit-run`, `gpu-export`) that runs
// until the test lets it end.
import { describe, expect, it } from 'vitest';
import { AC6, claudeCall, folder, heldBy, heldNow, leaseRows, mustFail, Session, shownLeases, sleep, until, waitLines, World, type LeaseRow, type Stamp } from './helpers.ts';

const KIT = 'deep lease gpu:shared -- kit-run';
const EXPORT = 'deep lease gpu:exclusive -- gpu-export';

interface Seen { stamps: Stamp[]; k1: Session; k2: Session; x: Session; k3: Session; whileKits: LeaseRow[]; whileExport: LeaseRow[] }

async function gpuModes(plant?: string): Promise<Seen> {
  const w = new World(plant ? { plant } : {});
  await w.startHub();
  const [k1, k2, x, k3] = ['kit-1', 'kit-2', 'export', 'kit-3'].map((name) => new Session(w, 'claude', folder(w, name))) as [Session, Session, Session, Session];
  const waitsOrRuns = (s: Session, bash: { output(): string; finished(): boolean } | undefined) => () => waitLines(bash?.output() ?? '').length > 0 || Boolean(w.started(s.label)) || Boolean(bash?.finished());
  try {
    await Promise.all([k1, k2, x, k3].map((s) => s.begin()));
    const kits = await Promise.all([k1, k2].map((s) => claudeCall(s, KIT)));
    await until(() => Boolean(w.started(k1.label) && w.started(k2.label)), 120_000);
    const whileKits = heldNow(await leaseRows(w.hub!));
    const exp = await claudeCall(x, EXPORT);
    await until(waitsOrRuns(x, exp.bash), 90_000);
    await sleep(3000);
    w.go(k1.label);
    await until(() => Boolean(w.ended(k1.label)), 30_000);
    await sleep(3000);
    w.go(k2.label);
    await until(() => Boolean(w.started(x.label)), 120_000);
    const whileExport = heldNow(await leaseRows(w.hub!));
    const third = await claudeCall(k3, KIT);
    await until(waitsOrRuns(k3, third.bash), 90_000);
    await sleep(3000);
    w.go(x.label);
    await until(() => Boolean(w.started(k3.label)), 120_000);
    w.go('all');
    await Promise.race([Promise.all([...kits, exp, third].map((c) => c.after)), sleep(120_000)]);
    const stamps = w.stamps();
    // The Proof's reading: the two GPU modes.
    const t0 = Math.min(...stamps.filter((s) => s.kind === 'S').map((s) => s.ms));
    console.log(`AC6 ${plant ?? 'as built'}: ${[k1, k2, x, k3].map((s) => `${s.label} ${stamps.find((m) => m.kind === 'S' && m.label === s.label) ? `+${stamps.find((m) => m.kind === 'S' && m.label === s.label)!.ms - t0}` : '-'}..${stamps.find((m) => m.kind === 'E' && m.label === s.label) ? `+${stamps.find((m) => m.kind === 'E' && m.label === s.label)!.ms - t0}` : '-'} ms`).join('; ')}; gpu leases while the kits ran: ${shownLeases(whileKits.filter((r) => r.kind === 'gpu'))}; while the export ran: ${shownLeases(whileExport.filter((r) => r.kind === 'gpu'))}`);
    return { stamps, k1, k2, x, k3, whileKits, whileExport };
  } finally {
    for (const s of [k1, k2, x, k3]) s.stop();
    await w.stopHub();
  }
}

function judged({ stamps, k1, k2, x, k3, whileKits, whileExport }: Seen): void {
  const at = (s: Session, kind: 'S' | 'E') => stamps.find((m) => m.kind === kind && m.label === s.label)?.ms;
  const kits = [k1, k2];
  for (const [i, k] of kits.entries()) expect(at(k, 'S'), `kit run ${i + 1} (\`${KIT}\`) runs`).toBeDefined();
  expect(at(k1, 'S')! < (at(k2, 'E') ?? Infinity) && at(k2, 'S')! < (at(k1, 'E') ?? Infinity), 'the two kit runs run at the same time').toBe(true);
  for (const [i, k] of kits.entries()) {
    expect(whileKits.some((r) => r.kind === 'gpu' && r.mode === 'shared' && heldBy(r, k)), `kit run ${i + 1} (session ${k.id}) holds the gpu lease shared while it runs: ${shownLeases(whileKits)}`).toBe(true);
  }
  const xs = at(x, 'S');
  expect(xs, `the export (\`${EXPORT}\`) runs once the kit runs end`).toBeDefined();
  for (const [i, k] of kits.entries()) {
    expect(xs! >= (at(k, 'E') ?? Infinity), `the export asked for the gpu lease exclusive, so it waits for both kit runs to end; it started while kit run ${i + 1} (session ${k.id}) still held the GPU shared`).toBe(true);
  }
  expect(whileExport.some((r) => r.kind === 'gpu' && r.mode === 'exclusive' && heldBy(r, x)), `the export (session ${x.id}) holds the gpu lease exclusive while it runs: ${shownLeases(whileExport)}`).toBe(true);
  const k3s = at(k3, 'S');
  expect(k3s, 'kit run 3 runs once the export ends').toBeDefined();
  expect(k3s! >= (at(x, 'E') ?? Infinity), `kit run 3 (session ${k3.id}) asked for the gpu lease shared while the export held it exclusive, so it waits for the export to end; it started while the export ran`).toBe(true);
}

describe(`${AC6} the gpu lease is shared by functional GPU work and exclusive for an export`, () => {
  it(`${AC6} two kit runs hold the gpu lease shared at once; the export waits for both to end; a third kit run waits while the export runs`, async () => {
    judged(await gpuModes());
  }, 900_000);
  it(`${AC6} (wrong program) a lease that grants the export alongside the kits (DEEP_HUB_PLANT=exclusive-beside-shared) fails this test, naming the kit run`, async () => {
    const seen = await gpuModes('exclusive-beside-shared');
    await mustFail('exclusive-beside-shared', () => judged(seen), ['kit run', 'still held the GPU shared']);
  }, 900_000);
});
