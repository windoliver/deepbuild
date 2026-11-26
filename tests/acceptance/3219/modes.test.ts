// AC2 #3219.150005e0: "Two kits hold the lease together. An export that asks while they draw waits for both, and a third
// kit that asks after the export starts only once the export has ended. A planted lease that lets the later kit start
// beside the first two fails, naming the kit"
//
// A test's own hub; four scripted Claude Code sessions, each running one `deep-show run` as its shell command: kit 1
// and kit 2 (the test module `test.kit.gpu` on the GPU backend), the export (a 2 s film to H.264) and kit 3. Kits 1 and
// 2 start together; each is stopped (SIGSTOP to its process group) as soon as the table shows it holding a gpu lease,
// so both hold it while they draw for as long as the test needs (README: How a draw is held). The export starts while
// they are stopped; once it has asked (its wait line on stderr, or 45 s), kit 3 starts; once kit 3 has asked, kits 1
// and 2 go on (SIGCONT). The order is read from the table's grants: kits 1 and 2 overlap, the export is granted only
// after both are released, and kit 3 only after the export is released. The planted lease, the hub's
// `DEEP_HUB_PLANT=shared-passes-waiting-exclusive` (chosen), grants a later shared request beside the shared holders
// though an exclusive one waits ahead of it; the same judge must fail naming the third kit. At the base, deep-show
// never calls the hub, so no kit holds a table lease.
import { describe, expect, it, type TestContext } from 'vitest';
import { join } from 'node:path';
import {
  AC, bound, continueGroup, deepShow, ended, exportScenario, gpuRows, kitOf, kitScenario, loadNow, mustFail, none, receiptLeaseOf, Session, showIn,
  shownRows, stopGroup, Table, World, type LeaseRow, type ShowEnd, type ShowRun,
} from './helpers.ts';

const PLANT = 'shared-passes-waiting-exclusive';
const NAMES = ['kit 1', 'kit 2', 'the export', 'the third kit'] as const;
type Name = (typeof NAMES)[number];

interface Seen { holders: Record<Name, string>; ends: Record<Name, ShowEnd>; rows: LeaseRow[]; unheld: string[]; arrangement: string[]; plant?: string }

/** Waits until `run` says it waits (a line naming a wait on its stderr) or has ended, 45 s at most. */
const asked = (run: ShowRun): Promise<boolean> => run.said(/wait/i, 45_000);

async function modes(plant?: string): Promise<Seen> {
  const bin = await deepShow();
  const w = new World(plant ? { plant } : {});
  await w.startHub();
  const sessions = Object.fromEntries(NAMES.map((n) => [n, new Session(w, n.replace(/\W+/g, '-'))])) as Record<Name, Session>;
  const table = new Table(w.hub!);
  const ev = w.folder('evidence');
  const runs: Partial<Record<Name, ShowRun>> = {};
  const unheld: string[] = [];
  const arrangement: string[] = [];
  try {
    await Promise.all(Object.values(sessions).map((s) => s.begin()));
    // Kits 1 and 2 start together; each is held where it draws once the table shows its lease.
    runs['kit 1'] = showIn(sessions['kit 1'], bin, kitScenario(ev), 'kit 1');
    runs['kit 2'] = showIn(sessions['kit 2'], bin, kitScenario(ev), 'kit 2');
    const kits = (['kit 1', 'kit 2'] as const).map((n) => ({ n, run: runs[n]!, s: sessions[n] }));
    const groups = await Promise.all(kits.map((k) => k.run.pid));
    // Each kit is stopped on the table event that grants it its lease; the wait ends once each is stopped or has ended.
    const stopped = new Set<Name>();
    const stops = new Map<Name, () => void>();
    const held = kits.map((k) => new Promise<void>((done) => stops.set(k.n, done)));
    void table.until((rows) => {
      kits.forEach((k, i) => {
        if (stopped.has(k.n) || k.run.finished()) return;
        if (gpuRows(rows).some((r) => r.holder === k.s.holder && r.released === undefined)) { stopGroup(groups[i]!); stopped.add(k.n); stops.get(k.n)!(); }
      });
      return stopped.size === kits.length;
    }, 600_000);
    await Promise.race([Promise.all(kits.map((k, i) => Promise.race([k.run.done, held[i]]))), bound(600_000)]);
    for (const k of kits) {
      if (stopped.has(k.n)) continue;
      const rows = gpuRows(await table.read()).filter((r) => r.holder === k.s.holder);
      if (rows.length) arrangement.push(`${k.n} (session ${k.s.id}) ended before the table event of its grant reached the test (${shownRows(rows)}), before the test could hold it where it draws`);
      else unheld.push(`${k.n} (session ${k.s.id}) drew with no gpu lease in the table: its run ended at ${(await ended(k.run, 1)).t1} and the table's gpu leases are ${shownRows(gpuRows(await table.read()))}`);
    }
    if (stopped.size === 2) {
      // The export asks while both kits hold the lease where they draw; kit 3 asks after it.
      runs['the export'] = showIn(sessions['the export'], bin, exportScenario(ev, join(w.folder('out'), 'film.mp4'), 48), 'the export');
      await asked(runs['the export']);
      runs['the third kit'] = showIn(sessions['the third kit'], bin, kitScenario(ev), 'the third kit');
      await asked(runs['the third kit']);
    }
    groups.forEach(continueGroup);
    const ends = Object.fromEntries(await Promise.all(NAMES.map(async (n) => [n, runs[n] ? await ended(runs[n]!, 900_000) : undefined]))) as Record<Name, ShowEnd>;
    const holders = Object.fromEntries(NAMES.map((n) => [n, sessions[n].holder])) as Record<Name, string>;
    await table.until((rows) => gpuRows(rows).filter((r) => Object.values(holders).includes(r.holder)).every((r) => r.released !== undefined), 30_000);
    const rows = gpuRows(await table.read());
    const t0 = Math.min(...Object.values(ends).filter(Boolean).map((e) => e.t0));
    console.log(`AC2 ${plant ? `planted ${plant}` : 'as built'} (${loadNow()}): the grants on the fixture, ms from the first run's start: ${rows.filter((r) => Object.values(holders).includes(r.holder)).sort((a, b) => a.at - b.at).map((r) => `${NAMES.find((n) => holders[n] === r.holder)} ${r.mode} asked ${r.asked !== undefined ? `+${r.asked - t0}` : '-'} granted +${r.at - t0} released ${r.released !== undefined ? `+${r.released - t0}` : '-'}`).join('; ') || 'none'}; runs ${NAMES.map((n) => (ends[n] ? `${n} +${ends[n].t0 - t0}..+${ends[n].t1 - t0}` : `${n} not started`)).join(', ')}`);
    return { holders, ends, rows, unheld, arrangement, ...(plant ? { plant } : {}) };
  } finally {
    for (const r of Object.values(runs)) if (r) continueGroup(await r.pid);
    table.close();
    for (const s of Object.values(sessions)) s.stop();
    await w.stopHub();
  }
}

/** The order the criterion sets, read from the table's grants. */
function failures({ holders, ends, rows, unheld }: Seen): string[] {
  const f: string[] = [...unheld];
  const row = (n: Name): LeaseRow | undefined => rows.filter((r) => r.holder === holders[n]).sort((a, b) => a.at - b.at)[0];
  const who = (n: Name): string => `${n} (${holders[n]})`;
  for (const n of ['kit 1', 'kit 2', 'the third kit'] as const) {
    const e = ends[n];
    if (!e) continue;
    const kit = kitOf(e);
    if (typeof kit === 'string') f.push(kit);
    else if (!kit.drew) f.push(`${who(n)} drew nothing on the GPU: its GPU cases are ${kit.gpu.map((c) => `${c.case} ${c.verdict}`).join(', ') || 'none'}`);
    if (!row(n)) f.push(`${who(n)} holds no gpu lease in the table; its gpu leases: ${shownRows(rows)}`);
    else if (row(n)!.mode !== 'shared') f.push(`${who(n)} holds the gpu lease ${row(n)!.mode}, not shared`);
  }
  if (ends['the export']) {
    const r = receiptLeaseOf(ends['the export']);
    if (typeof r === 'string') f.push(r);
    if (!row('the export')) f.push(`${who('the export')} holds no gpu lease in the table; its gpu leases: ${shownRows(rows)}`);
  }
  const [k1, k2, x, k3] = NAMES.map(row) as [LeaseRow | undefined, LeaseRow | undefined, LeaseRow | undefined, LeaseRow | undefined];
  if (k1 && k2 && !(k1.at < (k2.released ?? Infinity) && k2.at < (k1.released ?? Infinity))) f.push(`kit 1 and kit 2 don't hold the lease together: kit 1 ${k1.at}..${k1.released}, kit 2 ${k2.at}..${k2.released}`);
  if (x) {
    for (const [n, k] of [['kit 1', k1], ['kit 2', k2]] as const) {
      if (k && x.at < (k.released ?? Infinity)) f.push(`the export (${holders['the export']}) asked while the kits drew and must wait for both, but it was granted at ${x.at} while ${who(n)} still held the lease (released at ${k.released ?? 'never'})`);
    }
  }
  if (k3 && x && k3.at < (x.released ?? Infinity)) {
    const beside = (['kit 1', 'kit 2'] as const).filter((n) => { const k = n === 'kit 1' ? k1 : k2; return k && k.at <= k3.at && k3.at < (k.released ?? Infinity); });
    f.push(`the third kit (${holders['the third kit']}) asked after the export and must start only once the export has ended (released at ${x.released ?? 'never'}), but it was granted at ${k3.at}${beside.length ? `, beside ${beside.join(' and ')}` : ''}${k3.at < x.at ? `, before the export was granted at ${x.at}` : ''}`);
  }
  return f;
}
/** What the fixture couldn't arrange: then the run is INCONCLUSIVE, never PASS. */
function unarranged({ holders, rows, arrangement }: Seen): string[] {
  const out = [...arrangement];
  const row = (n: Name): LeaseRow | undefined => rows.filter((r) => r.holder === holders[n]).sort((a, b) => a.at - b.at)[0];
  const [k1, k2, x, k3] = NAMES.map(row);
  if (x?.asked !== undefined && k1 && k2 && !(x.asked >= Math.max(k1.at, k2.at) && x.asked < Math.min(k1.released ?? Infinity, k2.released ?? Infinity))) out.push(`the export asked at ${x.asked}, not while both kits held the lease`);
  if (x?.asked !== undefined && k3?.asked !== undefined && k3.asked < x.asked) out.push(`the third kit asked at ${k3.asked}, before the export asked at ${x.asked}`);
  return out;
}

describe(`${AC[2]} two kits share the gpu lease; an export that asks while they draw waits for both; a kit that asks after the export waits for its end`, () => {
  it(`${AC[2]} the grants on the fixture: kits 1 and 2 together, then the export, then the third kit; a planted lease that lets the later kit start beside the first two (DEEP_HUB_PLANT=${PLANT}) fails, naming the kit`, async (ctx: TestContext) => {
    const seen = await modes();
    none(failures(seen), 'the order of the gpu lease\'s grants');
    const fixture = unarranged(seen);
    if (fixture.length) ctx.skip(`INCONCLUSIVE: the fixture couldn't arrange the order the criterion names: ${fixture.join('; ')}`);

    const planted = await modes(PLANT);
    const plantFixture = [...unarranged(planted), ...planted.unheld];
    if (plantFixture.length) expect.fail(`the planted lease's run couldn't be arranged as the criterion's (DEEP_HUB_PLANT=${PLANT}): ${plantFixture.join('; ')}`);
    await mustFail(`DEEP_HUB_PLANT=${PLANT}`, () => none(failures(planted), `the order of the gpu lease's grants (DEEP_HUB_PLANT=${PLANT})`), ['the third kit']);
  }, 3_600_000);
});
