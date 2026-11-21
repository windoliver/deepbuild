// Criterion 9: "In headless Chrome with WebGPU, chapter 1's carry record written in the web player is kept in the
// browser's storage, exported to a file and imported into a fresh profile, where it opens chapter 2 with the same
// step-0 arrays as in the app; and the roguelike's ended slot opens only at its end in the player too; a planted
// import that skips the record's hash takes a record with one changed byte and fails, naming the record"
//
// Chapter 1, chapter 2 and the roguelike (fixtures.ts) are exported to the web by deep-show and served from one
// origin; the app's values come from deep-logic (chapter 1's record and chapter 2 opened with it) and from deep-show's
// `logic` call (the roguelike's full-state hashes). One test, in order:
//   - chapter 1 played to its end in a page lists one carry record at step 599 in probe().records; in a new page of
//     the same profile it is still listed, and "Export record" gives it as a file named by its sha256, with the
//     layout, step and arrays of the app's record;
//   - in a fresh profile chapter 2 lists no record and reads a u32 0 and zeros; "Import record" with a copy of the
//     file whose gold has one changed byte, under the record's name, is refused with a `carry_refused` notice naming
//     the record, and chapter 2 takes nothing; "Import record" with the file opens chapter 2 reading at step 0 the
//     arrays the app's chapter 2 reads with the app's record: a u32 1, the 3 units and the gold;
//   - the roguelike played from the start saves slot 1 at step 1,800, then its ended save at 3,000; played on past its
//     later ask at 3,300 the slot keeps the ended save; in a new page the slot lists only it, and "Open save" opens it
//     at step 3,000's full-state hash, the app's.
// And one test for the planted twin `web_carry_import_skips_hash`, chosen by the scenario's `planted` key on the
// export of chapter 2: it takes the copy with one changed byte, and the same check fails, naming the record.
// Wrong programs these fail: the base (no carry record, control or probe field in the player); a record kept in the
// page alone; a record of other arrays or another layout than the app's; an import that skips the hash (the twin);
// a player that writes no ended save, or lets a later save replace it, or opens the slot's save before its end.
import { basename, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AC, CARRY_REFUSED, EXPORT_RECORD, IMPORT_RECORD, OPEN_SAVE, TIMEOUT, arr, bake, carryOpened, checkpointAt, exportDoc, failsNaming, int, none, obj, one, oneByteChanged,
  openCarryCall, openPiece, playMs, prebuild, readRecord, recordsOf, savesOf, sha256, show, sleep, stepOf, str, until, useBrowsers, useTemp, valuesOf, withDoc,
  type JsonObject, type Page, type RecordFile, type StoredSave,
} from './helpers.ts';
import {
  CHAPTER1_STEPS, CHAPTER2, GOT, GOT_WITHOUT, LAST_STEP, ROGUE, ROGUE_ASKS_AFTER, ROGUE_ENDS_AT, ROGUE_SAVED_AT, ROGUE_STEPS, chapter1Doc, chapter1Piece, chapter2Doc, chapter2Piece,
  goldAt, gotWith, programs, rogueDoc, rosterAt, type Programs,
} from './fixtures.ts';

prebuild();
const temp = useTemp();
const web = useBrowsers();

/** The planted import (README: Planted programs). */
const PLANTED = 'web_carry_import_skips_hash';
/** What chapter 2 read at step 0, in GOT's order, as the player's probe() gives it. */
const gotOf = (p: JsonObject, what: string): unknown[] => { const v = valuesOf(p, what); return GOT.map((n) => v[`${CHAPTER2}.${n}`]); };
const flagOf = (p: JsonObject): unknown => (p['values'] as JsonObject | undefined)?.[`${CHAPTER2}.got_flag`];

/** The app's chapter 1 record (deep-logic) and what the app's chapter 2 reads at step 0 opened with it. */
function inTheApp(p: Programs): { record: RecordFile; got: unknown[] } {
  const dir = temp();
  const run1 = bake(chapter1Piece(p, 'v1'), CHAPTER1_STEPS, 'the app\'s chapter 1', { saves_dir: dir });
  expect(run1.carries.map((c) => c.step), 'in the app chapter 1 writes one carry record, at its last step').toEqual([LAST_STEP]);
  const record = readRecord(join(dir, `${run1.carries[0]!.hash}.carry`), 'the app\'s record');
  const opened = carryOpened(one(openCarryCall(chapter2Piece(p), dir, record.hash, 1), 'the app\'s chapter 2 opened with the record'), 'the app\'s chapter 2');
  const step0 = opened.steps.find((s) => s.step === 0);
  return { record, got: GOT.map((n) => step0?.arrays[`${CHAPTER2}.${n}`]?.[0]) };
}

/** The roguelike shown, replayed by the app (deep-show's `logic` call) and exported to the web into `out`: its full-state
 * hash at each checkpoint, by step. The fixture is held to what the test leans on: slot 1 asked for at the ends of
 * steps 1,799 and 3,299, and written into `ends` at the end of step 2,999 only. */
function rogueExported(evidence: string, p: Programs, out: string): Map<number, string> {
  const d = rogueDoc(p);
  const [lg, ex] = withDoc(evidence, d, [{ call: 'logic', doc: d.id, steps: ROGUE_STEPS, track: [] }, { call: 'export', doc: d.id, out, video: { codec: 'web' }, track: [] }], 'the roguelike');
  expect(ex!['outcome'], `the roguelike is exported: ${show(ex, 3000)}`).toBe('exported');
  expect(lg!['code'], `the app replays the roguelike: ${show(lg)}`).toBeUndefined();
  const rows = arr(lg!['steps'], 'the roguelike\'s steps').map((r, i) => obj(r, `step row ${i}`));
  const where = (name: string): number[] => rows.filter((r) => arr(obj(r['arrays'], 'arrays')[`${ROGUE}.${name}`], `${ROGUE}.${name}`)[0] === 1).map((r) => int(r['step'], 'step'));
  expect([where('request'), where('ends')], 'the roguelike asks for slot 1 at the ends of steps 1,799 and 3,299, and ends it at the end of step 2,999').toEqual([[ROGUE_SAVED_AT - 1, ROGUE_ASKS_AFTER - 1], [ROGUE_ENDS_AT - 1]]);
  const cps = new Map(arr(obj(lg!['checkpoints'], 'checkpoints')[ROGUE], `checkpoints.${ROGUE}`).map((c, i) => {
    const o = obj(c, `checkpoint ${i}`);
    return [int(o['step'], 'step'), str(o['deep_hash'], 'deep_hash')] as const;
  }));
  expect([cps.has(ROGUE_SAVED_AT), cps.has(ROGUE_ENDS_AT)], 'the app takes checkpoints at steps 1,800 and 3,000').toEqual([true, true]);
  return cps;
}

/** Waits while the page plays until slot 1 lists the save at `step` with the full-state hash `hash`; that save. */
async function savedAt(page: Page, step: number, hash: string, what: string, ms: number): Promise<StoredSave> {
  const want: StoredSave = { slot: 1, step, hash };
  const p = await until(page, (q) => JSON.stringify(savesOf(q, ROGUE, what)) === JSON.stringify([want]), ms, what);
  expect(savesOf(p, ROGUE, what), `${what}: slot 1 holds the save at step ${step}, recording the app's full-state hash there; the player is at step ${stepOf(p, what)}, notices ${JSON.stringify(await page.notices())}`).toEqual([want]);
  return want;
}

/** "Import record" with a copy of `file` whose one byte of gold differs, under the record's own name: the failures of
 * "it is refused, naming the record, and chapter 2 takes nothing", each naming the record. */
async function changedCopyRefused(page: Page, file: string, dir: string, what: string): Promise<string[]> {
  const rec = readRecord(file, `${what}: the exported record`);
  const copy = join(dir, basename(file));
  writeFileSync(copy, oneByteChanged(rec.bytes, `${what}: the copy`));
  const name = `the record ${rec.hash}`;
  const refusals = async (): Promise<{ kind: string; text: string }[]> => (await page.notices()).filter((n) => n.kind === CARRY_REFUSED);
  const before = (await refusals()).length;
  await page.importFile(IMPORT_RECORD, copy, `${what}: ${name} with one changed byte`);
  const end = Date.now() + 60_000;
  let p = await page.probe(what);
  while (Date.now() < end && (await refusals()).length === before && flagOf(p) !== 1) { await sleep(250); p = await page.probe(what); }
  await sleep(5_000);
  p = await page.probe(what);
  const said = (await refusals()).slice(before);
  const failures: string[] = [];
  if (flagOf(p) !== 0) failures.push(`${what}: the import took ${name} with one changed byte: chapter 2 reads ${JSON.stringify(gotOf(p, what))} at step 0`);
  const kept = recordsOf(p, what);
  if (kept.length) failures.push(`${what}: the import kept ${name} with one changed byte in the browser's storage: ${JSON.stringify(kept)}`);
  if (!said.length) failures.push(`${what}: the import of ${name} with one changed byte shows no ${CARRY_REFUSED} notice; the page's notices: ${JSON.stringify(await page.notices())}`);
  else if (!said.some((n) => n.text.includes(rec.hash))) failures.push(`${what}: the ${CARRY_REFUSED} notice doesn't name ${name}: ${JSON.stringify(said)}`);
  return failures;
}

/** Chapter 1 played in a page of `browser` until probe().records lists its record, then paused: what it lists. */
async function playChapter1(page: Page, what: string): Promise<{ hash: string; step: number }[]> {
  expect(recordsOf(await page.probe(what), what), `${what}: a fresh profile holds no carry record`).toEqual([]);
  await page.play();
  const p = await until(page, (q) => recordsOf(q, what).length > 0, playMs(CHAPTER1_STEPS), what);
  await page.pause();
  const listed = recordsOf(p, what);
  expect(listed.map((r) => r.step), `${what}: chapter 1 writes one carry record in the player, at its last step; the player is at step ${stepOf(p, what)}, notices ${JSON.stringify(await page.notices())}`).toEqual([LAST_STEP]);
  return listed;
}

describe(`${AC[9]} carry records and ended slots in the web player`, () => {
  it(`${AC[9]} chapter 1's record written in the player is kept, exported and imported into a fresh profile, where it opens chapter 2 with the app's step-0 arrays; a copy with one changed byte is refused, naming the record; and the roguelike's ended slot opens only at its end`, async () => {
    const p = programs();
    const app = inTheApp(p);
    const evidence = temp();
    const root = temp();
    exportDoc(evidence, chapter1Doc(p), join(root, 'chapter1'));
    exportDoc(evidence, chapter2Doc(p), join(root, 'chapter2'));
    const rogueApp = rogueExported(evidence, p, join(root, 'rogue'));
    const origin = await web.serve(root);

    // Chapter 1's record, written in the player and kept in the browser's storage.
    const a = await web.browser();
    const first = await openPiece(a, `${origin}/chapter1/index.html`, 'chapter 1');
    const listed = await playChapter1(first, 'chapter 1');
    await first.close();
    const again = await openPiece(a, `${origin}/chapter1/index.html`, 'chapter 1, its page opened again');
    expect(recordsOf(await again.probe('chapter 1, opened again'), 'chapter 1, opened again'), 'the record is kept in the browser\'s storage once its page has closed').toEqual(listed);
    const file = await again.exportFile(EXPORT_RECORD, temp(), 'chapter 1, opened again');
    const rec = readRecord(file, 'the exported record');
    expect([rec.hash, sha256(rec.bytes)], 'the file holds the record the storage keeps, named by its sha256').toEqual([listed[0]!.hash, listed[0]!.hash]);
    expect([rec.from['layout'], rec.step, rec.arrays], 'it is the record the app\'s chapter 1 writes: its layout, its step and its arrays').toEqual([app.record.from['layout'], app.record.step, app.record.arrays]);
    await again.close();

    // Imported into a fresh profile, where it opens chapter 2.
    const b = await web.browser();
    const two = await openPiece(b, `${origin}/chapter2/index.html`, 'chapter 2 in a fresh profile');
    const start = await until(two, (q) => flagOf(q) !== undefined && flagOf(q) !== null, 30_000, 'chapter 2 in a fresh profile');
    expect(recordsOf(start, 'chapter 2'), 'a fresh profile holds no carry record').toEqual([]);
    expect(gotOf(start, 'chapter 2'), 'chapter 2 without a record reads a u32 0 and zeros at step 0').toEqual(GOT_WITHOUT);
    none(await changedCopyRefused(two, file, temp(), 'chapter 2'), 'a copy of the record with one changed byte is refused, naming the record, and chapter 2 takes nothing');
    await two.importFile(IMPORT_RECORD, file, 'chapter 2');
    const opened = await until(two, (q) => flagOf(q) === 1, 120_000, 'chapter 2 opened with the record');
    expect(app.got, 'the app\'s chapter 2 reads a u32 1, the 3 units and the gold at step 0').toEqual(gotWith(rosterAt(LAST_STEP), goldAt(LAST_STEP)));
    expect(gotOf(opened, 'chapter 2 opened with the record'), `the imported record opens chapter 2 with the app's step-0 arrays; notices ${JSON.stringify(await two.notices())}`).toEqual(app.got);
    await b.close();

    // The roguelike's ended slot.
    const rogue = await openPiece(a, `${origin}/rogue/index.html`, 'the roguelike');
    expect(savesOf(await rogue.probe('the roguelike'), ROGUE, 'the roguelike'), 'the profile holds no save of the roguelike yet').toEqual([]);
    await rogue.play();
    await savedAt(rogue, ROGUE_SAVED_AT, rogueApp.get(ROGUE_SAVED_AT)!, 'the roguelike saved at step 1,800', playMs(ROGUE_SAVED_AT));
    const end = await savedAt(rogue, ROGUE_ENDS_AT, rogueApp.get(ROGUE_ENDS_AT)!, 'the roguelike ended at step 3,000', playMs(ROGUE_ENDS_AT - ROGUE_SAVED_AT));
    const last = await until(rogue, (q) => stepOf(q, 'the roguelike') >= ROGUE_STEPS - 1, playMs(ROGUE_STEPS - ROGUE_ENDS_AT), 'the roguelike played on');
    expect(stepOf(last, 'the roguelike'), 'the roguelike plays on past its later ask at step 3,300 to its last step').toBeGreaterThanOrEqual(ROGUE_STEPS - 1);
    await sleep(10_000);
    expect(savesOf(await rogue.probe('the roguelike'), ROGUE, 'the roguelike'), 'the ended slot takes no later save: slot 1 still holds the save at its end').toEqual([end]);
    await rogue.pause();
    await rogue.close();
    const back = await openPiece(a, `${origin}/rogue/index.html`, 'the roguelike, its page opened again');
    expect(savesOf(await back.probe('the roguelike, opened again'), ROGUE, 'the roguelike, opened again'), 'slot 1 opens only at its end: the save at step 3,000, never the one at 1,800').toEqual([end]);
    await back.click(OPEN_SAVE, 'the roguelike, opened again');
    const before: number[] = [];
    const at = await until(back, (q) => { const k = stepOf(q, 'the roguelike'); if (k > 0 && k < ROGUE_ENDS_AT) before.push(k); return k >= ROGUE_ENDS_AT; }, 120_000, 'the roguelike\'s slot opened');
    expect(before.slice(0, 3), 'the slot never opens before its end: no step between the start and 3,000 is shown after "Open save"').toEqual([]);
    expect(checkpointAt(at, ROGUE, ROGUE_ENDS_AT), `the slot opens at step 3,000's state, the app's full-state hash there; the player is at step ${stepOf(at, 'the roguelike')}, notices ${JSON.stringify(await back.notices())}`).toBe(rogueApp.get(ROGUE_ENDS_AT));
  }, TIMEOUT);

  it(`${AC[9]} a planted import that skips the record's hash (${PLANTED}) takes a record with one changed byte and fails, naming the record`, async () => {
    const p = programs();
    const evidence = temp();
    const root = temp();
    exportDoc(evidence, chapter1Doc(p), join(root, 'chapter1'));
    exportDoc(evidence, chapter2Doc(p), join(root, 'chapter2'), PLANTED);
    const origin = await web.serve(root);
    const a = await web.browser();
    const first = await openPiece(a, `${origin}/chapter1/index.html`, 'chapter 1');
    const [listed] = await playChapter1(first, 'chapter 1');
    const file = await first.exportFile(EXPORT_RECORD, temp(), 'chapter 1');
    expect(readRecord(file, 'the exported record').hash, 'the file holds the record the storage keeps').toBe(listed!.hash);
    const b = await web.browser();
    const two = await openPiece(b, `${origin}/chapter2/index.html`, `chapter 2 under the planted import ${PLANTED}`);
    failsNaming(await changedCopyRefused(two, file, temp(), `chapter 2 under ${PLANTED}`), listed!.hash, `the planted import ${PLANTED}`);
  }, TIMEOUT);
});
