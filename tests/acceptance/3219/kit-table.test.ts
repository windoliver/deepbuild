// AC1 #3219.6dfa18b9: "With a hub running, a kit on the GPU backend holds the table's `gpu` lease shared while it draws.
// The table shows it under the calling session, and the lease file doesn't exist. A planted deep-show that takes the
// file beside a live hub fails, naming the file"
//
// A test's own hub in a temp HOME; one scripted Claude Code session runs `deep-show run` with one kit call, the test
// module `test.kit.gpu`'s fixtures on the GPU backend alone, as its shell command (README: The surface under test). The
// table is read from the hub's record; the lease file `~/.cache/deepbuild-gpu/lease` of that HOME is watched for the
// whole run. The kit must draw (its GPU cases PASS or FAIL, never BLOCKED), the table must hold a `gpu` lease, shared,
// under the session's holder, granted while the kit ran, and the file must never be seen. The planted deep-show
// (`planted: "kit_takes_file_beside_hub"`, chosen) takes the file though a hub answers, and the same judge must fail
// naming the file. At the base, deep-show never calls the hub: the table holds no gpu lease and the kit takes the file.
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AC, deepShow, ended, gpuRows, kitOf, kitScenario, LeaseFileWatch, loadNow, mustFail, none, Session, showIn, shownRows, Table, World,
  type KitSeen, type LeaseRow, type ShowEnd, type Sighting,
} from './helpers.ts';

const PLANT = 'kit_takes_file_beside_hub';
const FILE = '~/.cache/deepbuild-gpu/lease';

interface Seen { holder: string; kit: KitSeen | string; end: ShowEnd; rows: LeaseRow[]; seen: Sighting[]; after: boolean; planted?: string }

async function kitBesideHub(planted?: string): Promise<Seen> {
  const bin = await deepShow();
  const w = new World();
  await w.startHub();
  const s = new Session(w, 'kit');
  const table = new Table(w.hub!);
  const watch = new LeaseFileWatch(w.leaseFile);
  try {
    await s.begin();
    const end = await ended(showIn(s, bin, kitScenario(w.folder('evidence'), planted), planted ? `the kit (planted ${planted})` : 'the kit'), 900_000);
    // The lease's release may follow the kit's end: the hub ends a lease on proof that its holder's process is gone.
    await table.until((rows) => gpuRows(rows).filter((r) => r.holder === s.holder).every((r) => r.released !== undefined), 30_000);
    watch.stop();
    const rows = await table.read();
    const kit = kitOf(end);
    console.log(`AC1 ${planted ? `planted ${planted}` : 'as built'} (${loadNow()}): the kit ran ${end.t0}..${end.t1}; reply lease ${typeof kit === 'string' ? kit.slice(0, 300) : JSON.stringify(kit.lease)}; GPU cases ${typeof kit === 'string' ? '-' : kit.gpu.map((c) => `${c.case} ${c.verdict}`).join(', ')}; the table's gpu leases: ${shownRows(gpuRows(rows))}; the lease file seen ${watch.seen.length} times (PIDs ${watch.pids().join(', ') || 'none'})`);
    return { holder: s.holder, kit, end, rows, seen: watch.seen, after: existsSync(w.leaseFile), ...(planted ? { planted } : {}) };
  } finally {
    watch.stop();
    table.close();
    s.stop();
    await w.stopHub();
  }
}

function failures({ holder, kit, end, rows, seen, after }: Seen): string[] {
  const f: string[] = [];
  if (typeof kit === 'string') f.push(kit);
  else if (!kit.drew) f.push(`the kit drew nothing on the GPU: its GPU cases are ${kit.gpu.map((c) => `${c.case} ${c.verdict}`).join(', ') || 'none'}`);
  const mine = gpuRows(rows).filter((r) => r.holder === holder);
  if (!mine.length) f.push(`with a hub running, the table shows no gpu lease under the calling session ${holder}; its gpu leases: ${shownRows(gpuRows(rows))}`);
  for (const r of mine) {
    if (r.mode !== 'shared') f.push(`the kit's gpu lease ${r.id} is ${r.mode}, not shared`);
    if (r.at < end.t0 || r.at > end.t1) f.push(`the kit's gpu lease ${r.id} was granted at ${r.at}, outside the kit's run ${end.t0}..${end.t1}`);
  }
  if (seen.length) f.push(`the lease file ${FILE} existed while the kit ran beside a live hub: seen ${seen.length} times from ${seen[0]!.at}, holding PID ${[...new Set(seen.map((x) => x.pid ?? '?'))].join(', ')}`);
  if (after) f.push(`the lease file ${FILE} is still there after the kit`);
  return f;
}

describe(`${AC[1]} with a hub running, a kit on the GPU backend holds the table's gpu lease shared, under the calling session, and no lease file`, () => {
  it(`${AC[1]} the kit's gpu lease is the table's, shared, under its session, with no lease file; a planted deep-show that takes the file beside the hub (planted: ${PLANT}) fails, naming the file`, async () => {
    none(failures(await kitBesideHub()), 'a kit on the GPU backend with a hub running');

    const planted = await kitBesideHub(PLANT);
    if (typeof planted.kit === 'string') expect.fail(`the planted deep-show (planted: ${PLANT}) must run the kit, taking the lease file beside the hub: ${planted.kit}`);
    await mustFail(`planted ${PLANT}`, () => none(failures(planted), `a kit on the GPU backend with a hub running (planted ${PLANT})`), [FILE]);
  }, 2_400_000);
});
