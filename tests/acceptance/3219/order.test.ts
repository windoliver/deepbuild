// AC3 #3219.2c286a34: "A kit asks while an export holds the lease, and a second export asks 1 s later. The kit draws
// before the second export in each of 20 runs. On the merge base, with the waits as they are, the count of runs where it
// does is recorded, and it is under 20. A planted queue that serves whichever asks most often fails, naming the kit"
//
// A test's own hub; three scripted Claude Code sessions, each running `deep-show run` as its shell command: the first
// export (a 100 s film, so it holds the lease for several seconds), the kit (`test.kit.gpu` on the GPU backend) and the
// second export (a 2 s film). In each run the first export starts; once it holds the lease (the table shows its gpu
// lease, or, where deep-show takes the file, the file holds its PID), the kit starts, and the second export starts 1 s
// after the kit, its own shell sleeping the criterion's 1 s before deep-show starts (README: Readings). Which drew
// first is read from the table's grants when both hold table leases (the kit's granted before the second export's), and
// otherwise from the second export's receipt and the kit's end: the kit drew first when it ended before the second
// export released the lease, since the two never draw at once. A run where the second export asked after the first had
// released the lease is void and named. The count of runs where the kit drew first is printed; the criterion's own
// merge-base count is that same line from this file's run on the merge base (BASE-FAILURE.txt). The planted queue, the
// hub's `DEEP_HUB_PLANT=serves-most-asks` (chosen), keeps no order among the gpu lease's waiters: a freed lease goes to
// whichever asks for it first once it is free. Its runs stop at the first where the kit didn't draw first, and the
// judge must fail naming the kit.
import { join } from 'node:path';
import { describe, expect, it, type TestContext } from 'vitest';
import {
  AC, bound, deepShow, ended, exportScenario, gpuRows, kitOf, kitScenario, LeaseFileWatch, loadNow, mustFail, none, receiptLeaseOf, Session, showIn,
  Table, World, type LeaseRow, type ShowEnd,
} from './helpers.ts';

const PLANT = 'serves-most-asks';
const RUNS = 20;
const ATTEMPTS = 30;
const LONG = 2400;
const SHORT = 48;

interface Run { n: number; kitFirst: boolean | undefined; how: string; void?: string; problems: string[]; line: string }
interface Seen { runs: Run[]; kitHolder: string; plant?: string }

async function orders(want: number, plant?: string): Promise<Seen> {
  const bin = await deepShow();
  const w = new World(plant ? { plant } : {});
  await w.startHub();
  const [s1, sk, s2] = ['first-export', 'kit', 'second-export'].map((n) => new Session(w, n)) as [Session, Session, Session];
  const table = new Table(w.hub!);
  const ev = w.folder('evidence');
  const out = w.folder('out');
  const runs: Run[] = [];
  try {
    await Promise.all([s1, sk, s2].map((s) => s.begin()));
    for (let n = 1; n <= ATTEMPTS && runs.filter((r) => !r.void).length < want; n++) {
      const watch = new LeaseFileWatch(w.leaseFile);
      const x1 = showIn(s1, bin, exportScenario(ev, join(out, `run-${n}-first.mp4`), LONG), `run ${n}: the first export`);
      const pid1 = String(await x1.pid);
      // The first export holds the lease: the table event of its gpu lease, or the lease file holding its PID.
      const held = await Promise.race([
        table.until((rows) => gpuRows(rows).some((r) => r.holder === s1.holder && r.released === undefined), 600_000),
        watch.holds(pid1, 600_000),
        x1.done.then(() => false),
        bound(600_000).then(() => false),
      ]);
      watch.stop();
      const kit = showIn(sk, bin, kitScenario(ev), `run ${n}: the kit`);
      // The criterion's 1 s: the second export's own shell sleeps it before deep-show starts (README: Readings).
      const x2 = showIn(s2, bin, exportScenario(ev, join(out, `run-${n}-second.mp4`), SHORT), `run ${n}: the second export`, { delay: 1 });
      const [e1, ek, e2] = await Promise.all([x1, kit, x2].map((r) => ended(r, 1_200_000))) as [ShowEnd, ShowEnd, ShowEnd];
      const mine = (s: Session) => (r: LeaseRow) => r.holder === s.holder && r.at >= e1.t0;
      await table.until((rows) => gpuRows(rows).filter((r) => r.at >= e1.t0).every((r) => r.released !== undefined), 30_000);
      const rows = gpuRows(await table.read());
      const [r1, rk, r2] = [s1, sk, s2].map((s) => rows.filter(mine(s)).sort((a, b) => a.at - b.at)[0]);
      runs.push(judgeRun(n, held, e1, ek, e2, r1, rk, r2));
      console.log(`AC3 ${plant ? `planted ${plant}` : 'as built'} ${runs.at(-1)!.line}`);
      if (plant && runs.at(-1)!.kitFirst === false) break;
    }
    const valid = runs.filter((r) => !r.void);
    console.log(`AC3 ${plant ? `planted ${plant}` : 'as built'} (${loadNow()}): the kit drew before the second export in ${valid.filter((r) => r.kitFirst).length} of ${valid.length} runs${runs.length > valid.length ? ` (${runs.length - valid.length} void)` : ''}`);
    return { runs, kitHolder: sk.holder, ...(plant ? { plant } : {}) };
  } finally {
    table.close();
    for (const s of [s1, sk, s2]) s.stop();
    await w.stopHub();
  }
}

function judgeRun(n: number, held: boolean, e1: ShowEnd, ek: ShowEnd, e2: ShowEnd, r1: LeaseRow | undefined, rk: LeaseRow | undefined, r2: LeaseRow | undefined): Run {
  const problems: string[] = [];
  const kit = kitOf(ek);
  const l1 = receiptLeaseOf(e1);
  const l2 = receiptLeaseOf(e2);
  for (const x of [kit, l1, l2]) if (typeof x === 'string') problems.push(x);
  if (typeof kit !== 'string' && !kit.drew) problems.push(`run ${n}: the kit drew nothing on the GPU: its GPU cases are ${kit.gpu.map((c) => `${c.case} ${c.verdict}`).join(', ') || 'none'}`);
  const released1 = r1?.released ?? (typeof l1 === 'string' ? undefined : l1.released);
  const asked2 = r2?.asked ?? (typeof l2 === 'string' ? undefined : l2.asked);
  let why: string | undefined;
  if (!held) why = `the first export never held the lease before it ended`;
  else if (released1 !== undefined && asked2 !== undefined && asked2 >= released1) why = `the second export asked at ${asked2}, after the first released the lease at ${released1}`;
  else if (released1 !== undefined && ek.t0 >= released1) why = `the kit started at ${ek.t0}, after the first export released the lease at ${released1}`;
  else if (rk?.asked !== undefined && r2?.asked !== undefined && rk.asked >= r2.asked) why = `the kit asked at ${rk.asked}, not before the second export at ${r2.asked}`;
  let kitFirst: boolean | undefined;
  let how: string;
  if (rk && r2) {
    kitFirst = rk.at < r2.at;
    how = `the table: the kit's lease ${rk.id} granted at ${rk.at}, the second export's ${r2.id} at ${r2.at}`;
  } else if (typeof l2 !== 'string' && l2.released !== undefined) {
    kitFirst = ek.t1 < l2.released;
    how = `no table lease for ${rk ? 'the second export' : 'the kit'}: the kit ended at ${ek.t1}, the second export's receipt released the lease at ${l2.released}`;
  } else how = 'neither the table nor the second export\'s receipt tells the order';
  const t0 = e1.t0;
  const at = (x: number | undefined): string => (x === undefined ? '-' : `+${x - t0}`);
  const line = `run ${n}: ${why ? `void (${why}); ` : ''}${kitFirst === undefined ? 'order unknown' : kitFirst ? 'the kit drew first' : 'the second export drew first'}; first export ${at(e1.t0)}..${at(e1.t1)} lease ${r1 ? `${at(r1.at)}..${at(r1.released)}` : typeof l1 === 'string' ? '-' : `${at(l1.acquired)}..${at(l1.released)} (receipt)`}; kit ${at(ek.t0)}..${at(ek.t1)} lease ${rk ? `${at(rk.at)}..${at(rk.released)}` : '-'}; second export ${at(e2.t0)}..${at(e2.t1)} lease ${r2 ? `${at(r2.at)}..${at(r2.released)}` : typeof l2 === 'string' ? '-' : `asked ${at(l2.asked)} ${at(l2.acquired)}..${at(l2.released)} (receipt)`}; read from ${how}`;
  return { n, kitFirst, how, ...(why ? { void: why } : {}), problems, line };
}

function failures({ runs, kitHolder }: Seen, want: number): string[] {
  const f: string[] = [];
  const valid = runs.filter((r) => !r.void);
  for (const r of valid) {
    f.push(...r.problems);
    if (r.kitFirst === undefined) f.push(`run ${r.n}: which of the kit and the second export drew first can't be read: ${r.how}`);
    else if (!r.kitFirst) f.push(`run ${r.n}: the kit (${kitHolder}) asked while the first export held the lease, 1 s before the second export, but the second export drew first (${r.how})`);
  }
  if (valid.length < want && !f.length) f.push(`only ${valid.length} of ${runs.length} runs could be arranged, ${want} wanted: ${runs.filter((r) => r.void).map((r) => `run ${r.n} ${r.void}`).join('; ')}`);
  return f;
}

describe(`${AC[3]} a kit that asks while an export holds the lease draws before an export that asks 1 s later, in each of ${RUNS} runs`, () => {
  it(`${AC[3]} in each of ${RUNS} runs the kit draws before the second export; a planted queue that serves whichever asks most often (DEEP_HUB_PLANT=${PLANT}) fails, naming the kit`, async (ctx: TestContext) => {
    const seen = await orders(RUNS);
    const f = failures(seen, RUNS);
    const valid = seen.runs.filter((r) => !r.void);
    if (f.length === 1 && valid.length < RUNS && f[0]!.startsWith('only ')) ctx.skip(`INCONCLUSIVE: ${f[0]}`);
    none(f, `the kit draws before the second export in each of ${RUNS} runs (it did in ${valid.filter((r) => r.kitFirst).length} of ${valid.length})`);

    const planted = await orders(RUNS, PLANT);
    if (!planted.runs.some((r) => !r.void)) expect.fail(`the planted queue's runs (DEEP_HUB_PLANT=${PLANT}) couldn't be arranged: ${planted.runs.map((r) => r.line).join('; ')}`);
    await mustFail(`DEEP_HUB_PLANT=${PLANT}`, () => none(failures(planted, 1), `the kit draws before the second export in each run (DEEP_HUB_PLANT=${PLANT})`), ['the kit', planted.kitHolder]);
  }, 7_200_000);
});
