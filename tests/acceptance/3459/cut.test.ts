// #3459 criterion 4 (README, The staged cut): a cut staged between the move aside and the put leaves the marker; no
// hub starts on it; and a rerun ends with the restored record in place and the kept folder whole. The cut is the test
// VFS's (DEEP_HUB_TEST_VFS's `cutAt`, as #148's suite cuts a sync): `deep restore` ends as by kill -9 right after its
// durable point `restore_aside`, made once the replaced ledger, evidence and wiki are in the kept folder and before
// anything of the backup is put in their place. A swap that deletes before it moves loses the kept ledger, and fails
// naming it.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { cleanup, eventsIn, foldersWithLedger, keptNamedBy, keptProblems, makeScene, named, recordFiles, restore, shown, stopHub, tryHub } from './helpers.ts';

afterAll(cleanup, 120_000);

test('#3459.a9ca2cbc a cut staged between the move aside and the put leaves the marker, no hub starts on it, and a rerun ends with the restored record in place and the kept folder whole', async () => {
  const s = await makeScene();
  const { h } = s;
  const marker = join(h.root, 'restore.pending');
  const points = join(h.tmp, 'points.jsonl');
  const replacedLedger = s.files.get('ledger.db')!;

  const cut = await restore(h, s.folder, { DEEP_HUB_TEST_VFS: JSON.stringify({ points, cutAt: { kind: 'restore_aside', nth: 1 } }) });
  expect(cut.signal, `\`deep restore ${s.folder}\` under DEEP_HUB_TEST_VFS's cutAt { kind: 'restore_aside', nth: 1 } is cut as by kill -9 right after the replaced record is moved aside and before the backup's is put in its place; it wasn't cut: ${shown(cut)}`).toBe('SIGKILL');
  const made = existsSync(points) ? readFileSync(points, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { kind: string }) : [];
  expect(made.map((p) => p.kind).filter((k) => k === 'restore_aside'), 'the points file names the one durable point restore_aside the cut came after').toEqual(['restore_aside']);

  // The cut leaves the marker, and the replaced record whole in the kept folder: nothing was deleted before it moved.
  expect(existsSync(marker), `the cut leaves the marker ${marker}`).toBe(true);
  const folders = foldersWithLedger(h);
  const kept = folders.find((dir) => recordFiles(dir).get('ledger.db')?.inode === replacedLedger.inode) ?? folders[0];
  expect(kept, `after the cut, the kept ledger is in no folder under ${h.root}: the replaced ledger.db (inode ${replacedLedger.inode}, ${s.events.length} events, the newest ${named(s.events[s.events.length - 1]!)}) was deleted, not moved aside`).toBeDefined();
  expect(keptProblems(kept!, s.files), `after the cut, the kept folder ${kept} holds the replaced ledger, evidence and wiki whole`).toEqual([]);

  // No hub starts on it.
  const started = await tryHub(h);
  if (started.ready) await stopHub(started.hub);
  expect(started.ready, `no hub starts on a root whose restore was cut (the marker ${marker} is there); one started: ${started.hub.output().slice(0, 800)}`).toBe(false);
  expect(started.code, `\`deep hub run\` on the cut restore exits with a failure: ${started.hub.output().slice(0, 800)}`).not.toBe(0);
  expect(started.hub.output(), 'the hub that didn\'t start says a restore didn\'t finish and names the command to run again').toContain(`deep restore ${s.folder}`);
  expect(keptProblems(kept!, s.files), `the hub that didn't start left the kept folder ${kept} whole`).toEqual([]);

  // A rerun finishes: the restored record in place, the marker gone, the kept folder whole, and a hub starts.
  const rerun = await restore(h, s.folder);
  expect(rerun.code, `the rerun of \`deep restore ${s.folder}\` after the cut must exit 0: ${shown(rerun)}`).toBe(0);
  expect(existsSync(marker), 'the rerun removes the marker').toBe(false);
  const inBackup = eventsIn(s.folder);
  const inPlace = new Set(eventsIn(h.root).map((e) => e.id));
  const missing = inBackup.find((e) => !inPlace.has(e.id));
  expect(missing && `the record in place lacks the backup's ${named(missing)}`, 'after the rerun the record in place holds every event of the backup').toBeUndefined();
  expect(s.lacking.filter((e) => inPlace.has(e.id)).map(named), 'after the rerun the record in place holds none of the 40 events the backup lacks').toEqual([]);
  const inPlaceFiles = recordFiles(h.root);
  const backupFiles = recordFiles(s.folder);
  expect([...backupFiles].filter(([path, was]) => path !== 'ledger.db' && inPlaceFiles.get(path)?.hash !== was.hash).map(([path]) => path), 'after the rerun the evidence and wiki in place are the backup\'s').toEqual([]);
  expect(keptNamedBy(rerun, h, s.folder), `the rerun's last line names the kept folder the cut left, ${kept}, and the command that puts it back: ${JSON.stringify(rerun.stdout.trim().split('\n').pop())}`).toBe(kept);
  expect(keptProblems(kept!, s.files), `after the rerun, the kept folder ${kept} holds the replaced ledger, evidence and wiki whole`).toEqual([]);
  const hub = await tryHub(h);
  if (hub.ready) await stopHub(hub.hub);
  expect(hub.ready, `a hub starts on the finished restore: ${hub.hub.output().slice(0, 800)}`).toBe(true);
}, 900_000);
