// #3459 criteria 1 and 3 (README): `deep restore` of a backup onto a record that holds 40 events the backup lacks
// keeps the replaced ledger, evidence and wiki in one kept folder, each file equal by hash to what was there and each
// with the inode it had before; `deep restore` of the kept folder gives a record with those 40 events. The merge base
// keeps nothing, and fails naming the first event lost.
import { afterAll, expect, test } from 'vitest';
import { LACKING, cleanup, eventsIn, keptNamedBy, keptProblems, makeScene, named, recordFiles, restore, shown, type FileAt, type Ran, type Scene } from './helpers.ts';

afterAll(cleanup, 120_000);

interface First { s: Scene; ran: Ran; kept: string | undefined; keptFiles: Map<string, FileAt>; keptEvents: Set<string> }
/** The scene and the first restore, made once by the test that needs it first; what the kept folder held as it ended. */
let made: Promise<First> | undefined;
const first = () => (made ??= (async (): Promise<First> => {
  const s = await makeScene();
  const ran = await restore(s.h, s.folder);
  const kept = keptNamedBy(ran, s.h, s.folder);
  return { s, ran, kept, keptFiles: kept ? recordFiles(kept) : new Map(), keptEvents: new Set(kept ? eventsIn(kept).map((e) => e.id) : []) };
})());

/** The restore ran, and what its last line says of a kept folder; fails naming the first event lost when it kept none. */
function keptOf(f: First): string {
  expect(f.ran.code, `\`deep restore ${f.s.folder}\`, with the hub stopped and the OS confirming you, must exit 0: ${shown(f.ran)}`).toBe(0);
  const lost = f.s.lacking[0]!;
  expect(f.kept, `the restore replaced a record that held ${LACKING} events the backup lacks and its last line names no kept folder under ${f.s.h.root} with the command that puts it back: nothing was kept, and the first event lost is ${named(lost)}. The last line: ${JSON.stringify(f.ran.stdout.trim().split('\n').pop())}`).toBeDefined();
  return f.kept!;
}

test('#3459.6fc3983f after deep restore of a backup onto a record that holds 40 events the backup lacks, the kept folder holds the replaced ledger, evidence and wiki, each file equal by hash to what was there, and deep restore of the kept folder gives a record with those 40 events', async () => {
  const f = await first();
  const { s } = f;
  const kept = keptOf(f);

  // The restore took effect: the record in place is the backup's, with none of the 40.
  const inPlace = new Set(eventsIn(s.h.root).map((e) => e.id));
  expect(s.lacking.filter((e) => inPlace.has(e.id)).map(named), 'the restored record holds none of the 40 events the backup lacks').toEqual([]);

  // The kept folder has a backup's layout and holds what was replaced, file for file.
  expect(keptProblems(kept, s.files), `the kept folder ${kept} holds the replaced ledger, evidence and wiki, each file equal by hash to what was there`).toEqual([]);
  const lostFromKept = s.lacking.find((e) => !f.keptEvents.has(e.id));
  expect(lostFromKept && `the kept ledger ${kept}/ledger.db lacks ${named(lostFromKept)}, the first event lost`, 'the kept ledger holds each of the 40 events the backup lacks').toBeUndefined();

  // `deep restore` of the kept folder puts the replaced record back.
  const back = await restore(s.h, kept);
  expect(back.code, `\`deep restore ${kept}\`, the command the first restore's last line named, must exit 0: ${shown(back)}`).toBe(0);
  const now = new Set(eventsIn(s.h.root).map((e) => e.id));
  const lost = s.lacking.find((e) => !now.has(e.id));
  expect(lost && `after \`deep restore ${kept}\` the record lacks ${named(lost)}, the first event lost of ${s.lacking.filter((e) => !now.has(e.id)).length}`, `the record after \`deep restore ${kept}\` holds the ${LACKING} events the backup lacks`).toBeUndefined();
  const gone = s.events.find((e) => !now.has(e.id));
  expect(gone && `after \`deep restore ${kept}\` the record lacks ${named(gone)}, which the replaced record held`, 'the record put back holds every event of the record the first restore replaced').toBeUndefined();
  const files = recordFiles(s.h.root);
  const unlike = [...s.files].filter(([path, was]) => path !== 'ledger.db' && files.get(path)?.hash !== was.hash).map(([path]) => path);
  expect(unlike, 'the evidence and wiki put back are, file for file, what the first restore replaced').toEqual([]);
}, 900_000);

test('#3459.cd3c8ee1 each kept file has the inode it had before the restore', async () => {
  const f = await first();
  const { s } = f;
  const kept = keptOf(f);
  const copied: string[] = [];
  for (const [path, was] of s.files) {
    const got = f.keptFiles.get(path);
    if (!got) copied.push(`${kept}/${path} is missing`);
    else if (got.inode !== was.inode || got.device !== was.device) copied.push(`${kept}/${path} has inode ${got.inode}; before the restore the file had inode ${was.inode}: it was copied, not moved`);
  }
  expect(copied, `each file the restore keeps in ${kept} is the file that was there, moved by rename, with the inode it had before`).toEqual([]);
}, 900_000);
