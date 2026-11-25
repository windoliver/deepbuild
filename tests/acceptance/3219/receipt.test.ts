// AC6 #3219.b9bc7bce: "An export's receipt names a lease ID the table recorded for that export, and its three times
// equal the table's. A planted receipt that writes a record of its own fails, naming the ID"
//
// A test's own hub; one scripted Claude Code session runs `deep-show run` that presents a 2 s film and exports it as
// H.264 (#157's export call), as its shell command. The receipt's `lease` record (#157: `resource`, `holder`, `asked`,
// `acquired`, `waited_ms`, `released`) must name the table's lease by its ID, `lease.id` (chosen): the `lease.acquired`
// event's subject, `lease:<ULID>`. That lease must be a gpu lease under the export's session, and the receipt's three
// times must equal the table's: `asked` the time the table records the lease was asked for (`asked` in its
// `lease.acquired` event's data, chosen), `acquired` that event's `ts`, `released` its `lease.released` event's `ts`
// (README: The surface under test). The planted receipt (`planted: "receipt_writes_own_lease"`, chosen) writes a lease
// record of its own, and the same judge must fail naming the ID it wrote. At the base the receipt's record is
// deep-show's own, with no ID, and the table holds no gpu lease.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, deepShow, ended, exportScenario, gpuRows, loadNow, mustFail, none, receiptLeaseOf, Session, show, showIn, shownRows, Table, World,
  type LeaseRow, type ReceiptLease,
} from './helpers.ts';

const PLANT = 'receipt_writes_own_lease';

interface Seen { holder: string; lease: ReceiptLease | string; rows: LeaseRow[]; plant?: string }

async function exported(planted?: string): Promise<Seen> {
  const bin = await deepShow();
  const w = new World();
  await w.startHub();
  const s = new Session(w, 'export');
  const table = new Table(w.hub!);
  try {
    await s.begin();
    const end = await ended(showIn(s, bin, exportScenario(w.folder('evidence'), join(w.folder('out'), 'film.mp4'), 48, planted), planted ? `the export (planted ${planted})` : 'the export'), 1_200_000);
    await table.until((rows) => gpuRows(rows).filter((r) => r.holder === s.holder).every((r) => r.released !== undefined), 30_000);
    const rows = await table.read();
    const lease = receiptLeaseOf(end);
    console.log(`AC6 ${planted ? `planted ${planted}` : 'as built'} (${loadNow()}): the export ran ${end.t0}..${end.t1}; the receipt's lease ${typeof lease === 'string' ? lease.slice(0, 400) : show(lease.raw)}; the table's gpu leases: ${shownRows(gpuRows(rows))}`);
    return { holder: s.holder, lease, rows, ...(planted ? { plant: planted } : {}) };
  } finally {
    table.close();
    s.stop();
    await w.stopHub();
  }
}

function failures({ holder, lease, rows }: Seen): string[] {
  if (typeof lease === 'string') return [lease];
  if (lease.id === undefined) return [`the receipt's lease record names no lease ID (lease.id): ${show(lease.raw)}; the table's gpu leases: ${shownRows(gpuRows(rows))}`];
  const id = lease.id;
  const row = rows.find((r) => r.id === id);
  if (!row) return [`the receipt names the lease ${id}, which the table never recorded; the table's leases: ${shownRows(rows)}`];
  const f: string[] = [];
  if (row.kind !== 'gpu' || row.holder !== holder) f.push(`the table's lease ${id} is a ${row.kind} lease held by ${row.holder}, not the export's gpu lease under its session ${holder}`);
  const times: [string, number | undefined, number | undefined][] = [['asked', lease.asked, row.asked], ['acquired', lease.acquired, row.at], ['released', lease.released, row.released]];
  for (const [name, mine, table] of times) {
    if (table === undefined) f.push(`the table records no ${name} time for the lease ${id}, so the receipt's ${name} (${mine}) can't be the table's`);
    else if (mine !== table) f.push(`the receipt's ${name} for the lease ${id} is ${mine}, the table's is ${table}`);
  }
  return f;
}

describe(`${AC[6]} an export's receipt names the table's lease by its ID, with the table's three times`, () => {
  it(`${AC[6]} the receipt's lease is a gpu lease the table recorded for the export, its asked, acquired and released times the table's; a planted receipt that writes a record of its own (planted: ${PLANT}) fails, naming the ID`, async () => {
    none(failures(await exported()), 'the export\'s receipt and the lease table');

    const planted = await exported(PLANT);
    if (typeof planted.lease === 'string') expect.fail(`the planted deep-show (planted: ${PLANT}) must export the film: ${planted.lease}`);
    const id = (planted.lease as ReceiptLease).id;
    if (id === undefined) expect.fail(`the planted receipt (planted: ${PLANT}) must write a lease record of its own with an ID, so its failure can name it: ${show((planted.lease as ReceiptLease).raw)}`);
    await mustFail(`planted ${PLANT}`, () => none(failures(planted), `the export's receipt and the lease table (planted ${PLANT})`), [id!]);
  }, 2_400_000);
});
