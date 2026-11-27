// #3459 criterion 2 (README, The sentence): the sentence the OS shows before a restore names what the restore would
// take away. For a backup that is an earlier copy of the record there: 40 events past the backup's last, and the
// newest one's time. For a backup taken from another record: that it was not taken from this one, with this record's
// event count. A sentence that names only the two folders fails, naming what it left out. The OS is
// DEEP_HUB_TEST_CONFIRM's stand-in as a program, which keeps the sentence it is shown and cancels, so nothing changes.
import { afterAll, expect, test } from 'vitest';
import { LACKING, askedBy, backup, backupFolder, cleanup, dayOf, dayPattern, eventsIn, makeHome, makeScene, named, pasteEvidence, shown, startHub, stopHub, timePattern, withoutPaths, type Scene } from './helpers.ts';

afterAll(cleanup, 120_000);

let made: Promise<Scene> | undefined;
const scene = () => (made ??= makeScene());

test('#3459.28771dde the sentence the OS shows names 40 events past the backup\'s last and the newest one\'s time', async () => {
  const s = await scene();
  const { sentence, ran, asks } = await askedBy(s.h, s.folder);
  expect(asks, `\`deep restore ${s.folder}\` asks the OS to confirm you once: ${shown(ran)}`).toBe(1);
  const said = withoutPaths(sentence!, s.folder, s.h.root, s.h.home);
  const newest = s.lacking[s.lacking.length - 1]!;
  const at = new Date(newest.ts);
  const leftOut: string[] = [];
  if (!new RegExp(`(?<![\\d.,])${LACKING}(?![\\d.,]\\d)[^.]{0,60}\\bevents?\\b`, 'i').test(said)) leftOut.push(`the ${LACKING} events the record holds past the backup's last`);
  if (!timePattern(at).test(said) || !dayPattern(at).test(said)) leftOut.push(`the newest one's time (${named(newest)}: ${dayOf(at)} at ${at.toISOString().slice(11, 16)} UTC, the process's time zone)`);
  expect(leftOut, `the sentence the OS showed for a backup that is an earlier copy of the record there, ${JSON.stringify(sentence)}, left out`).toEqual([]);
  expect(/\bnot\b[^.]*\btaken from\b|n['’]t\b[^.]*\btaken from\b/i.test(said), `the backup is an earlier copy of this record, so the sentence must not read as not taken from it: ${JSON.stringify(sentence)}`).toBe(false);
}, 900_000);

test('#3459.28771dde a backup taken from another record reads as not taken from this one, with this record\'s event count', async () => {
  const s = await scene();
  // Another record, under a home of its own, and a backup of it.
  const other = makeHome();
  const hub = await startHub(other);
  const foreign = backupFolder(other, 'another-record');
  try {
    await pasteEvidence(hub, 3);
    await backup(other, foreign);
  } finally {
    await stopHub(hub);
  }
  const here = eventsIn(s.h.root).length;
  const { sentence, ran, asks } = await askedBy(s.h, foreign);
  expect(asks, `\`deep restore ${foreign}\` asks the OS to confirm you once: ${shown(ran)}`).toBe(1);
  const said = withoutPaths(sentence!, foreign, s.h.root, s.h.home, other.tmp);
  const leftOut: string[] = [];
  if (!/\bnot\b[^.]*\btaken from\b|n['’]t\b[^.]*\btaken from\b/i.test(said)) leftOut.push('that this record is not the one the backup was taken from');
  if (!new RegExp(`(?<![\\d.,])${here}(?![\\d.,]\\d)[^.]{0,60}\\bevents?\\b`, 'i').test(said)) leftOut.push(`how many events this record holds (${here})`);
  expect(leftOut, `the sentence the OS showed for a backup taken from another record, ${JSON.stringify(sentence)}, left out`).toEqual([]);
  expect(eventsIn(s.h.root).length, 'the cancelled prompt changed nothing').toBe(here);
}, 900_000);
