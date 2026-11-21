// Criterion 7: "In the web player the record keeps to the browser's storage, with export and import, and reopens at
// start as in the app", with "as in the app" taken from criterion 1's values: a piece that writes xp 1200 into its
// profile at step 900 starts its next session with 1200 in its read region at step 0.
//
// The piece (below) is exported to the web by deep-show and served from one origin. One test, in order:
//   - in a fresh browser profile the piece starts without a record, reading a u32 0 and zeros at step 0; played, it
//     writes its profile record when play reaches step 900, and probe().profile lists it;
//   - the page reloaded in that profile (the next session) lists the record still and reads a u32 1 and xp 1200 at
//     step 0; "Export profile" gives a file whose bytes hash to the record's hash;
//   - in another, fresh profile the piece reads zeros; "Import profile" with the file keeps the record, and the page
//     reloaded there reads a u32 1 and xp 1200 at step 0.
// And one test for the Scope line "the piece's menu names the profile, with start fresh (this run only) and delete",
// whose menu in the web player is the player's own controls: the "Profile" group names the stored record; "Start
// fresh" runs with zeros and keeps it, and the next session reads it again; "Delete profile" removes it, and the next
// session reads zeros.
// Wrong programs these fail: the base (no `profile` field, record, probe field or control); a record kept in the page
// alone; a player that doesn't reopen the record at start, or fills the read region late or not at all; a record of
// another step's numbers; an export of other bytes than the stored record; an import that isn't kept; a start fresh
// that reads the record or deletes it, or that lasts past its run; a delete that leaves the record.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC7, DIGEST, TIMEOUT, assemble, entry, exportDoc, openPiece, playMs, prebuild, profileOf, regionMap, sha256, stepOf, until, useBrowsers, useTemp, valuesOf,
  type Doc, type JsonObject, type Page, type Program, type Writes,
} from './helpers.ts';

prebuild();
const temp = useTemp();
const web = useBrowsers();

// ---------------------------------------------------------------------------------------------------
// The piece (README: Fixture)

/** The logic item's ID; its arrays are read in probe().values as `game.<name>`. */
const GAME = 'game';
/** 20 s at 60 Hz. */
const STEPS = 1200;
/** The step that writes 1 into the profile's request array, and the xp it leaves: 1200 at step 900 (xp = 300 + k). */
const ASKS_AT = 900;
const XP_AT_ASK = 300 + ASKS_AT;
const WRITES: Writes = { xp: { type: 'i32' }, keep: { type: 'i32' }, got_flag: { type: 'i32' }, got_xp: { type: 'i32' } };
/** The item's profile (the issue's Scope): one array, xp, and its request array keep. */
const PROFILE: JsonObject = { arrays: { xp: { type: 'i32', count: 1 } }, request: 'keep' };
/** The profile entry of the read region: a u32, then xp's one i32. */
const ENTRY_BYTES = 8;
/** The piece's init writes this over the profile entry, so a module that leaves the entry unfilled shows it. */
const GARBAGE = 0xa5a5a5a5 | 0;
/** What step 0 read, as [u32, xp]: with the record of step 900, and without one. */
const WITH = [1, XP_AT_ASK];
const WITHOUT = [0, 0];

const W = 4096;
/** The piece's program, built against the region map deep-logic's `check` gives an item with its fields: its init
 * writes GARBAGE over the profile entry; step 0 copies the entry (the u32 and xp) into its memory, and every step k
 * writes them as got_flag and got_xp, xp = 300 + k, and 1 into keep at step 900 only. It reads nothing else. */
function program(): Program {
  const layoutProbe = assemble('layout_probe', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${W}))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)))`);
  const map = regionMap(layoutProbe, WRITES, { profile: PROFILE }, 'check of a layout probe with profile');
  const from = entry(map, 'reads', 'profile').offset;
  const at = (name: string): number => W + entry(map, 'writes', name).offset;
  return assemble('profile_piece', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${W}))
  (func $init (export "init") (param $seed i64)
    (i32.store (i32.const ${from}) (i32.const ${GARBAGE}))
    (i32.store (i32.const ${from + 4}) (i32.const ${GARBAGE})))
  (func $step (export "step") (param $k i64)
    (if (i64.eqz (local.get $k)) (then (memory.copy (i32.const 8192) (i32.const ${from}) (i32.const ${ENTRY_BYTES}))))
    (i32.store (i32.const ${at('xp')}) (i32.add (i32.wrap_i64 (local.get $k)) (i32.const 300)))
    (i32.store (i32.const ${at('keep')}) (i64.eq (local.get $k) (i64.const ${ASKS_AT})))
    (i32.store (i32.const ${at('got_flag')}) (i32.load (i32.const 8192)))
    (i32.store (i32.const ${at('got_xp')}) (i32.load (i32.const 8196)))))`);
}

/** The document, as #1041's and #189's pieces are: a 2D film at 60 frames a second, a figure a driver walks along x
 * with time, and the logic item at 60 Hz with its program by hash, its writes, checkpoints and profile. */
function pieceDoc(p: Program): Doc {
  const id = '01JB0276W00000000000000001';
  const rect = (rid: string, box: number[], role: string, n: number, part: string): JsonObject =>
    ({ id: rid, kind: 'rect@1', name: rid, order: `a${String(n).padStart(4, '0')}`, role: part, params: { box, paint: { fill: { role } } }, at: { pos: [0, 0, 0] } });
  const items: JsonObject[] = [
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0000cam', params: { projection: 'orthographic', target: [160, 90, 0], view_width: 320 } },
    rect('back', [0, 0, 320, 180], 'ground', 1, 'decoration'),
    rect('wall', [0, 120, 320, 60], 'ink', 2, 'decoration'),
    rect('hero', [0, 100, 12, 12], 'accent', 3, 'part'),
    { id: GAME, kind: 'logic@1', name: 'The rules', order: 'a0004', params: { program: p.sha, step_rate: 60, writes: WRITES as unknown as JsonObject, checkpoint: { every: 60 }, profile: PROFILE } },
  ];
  const document: JsonObject = {
    format: 1, id, profile: 'film', title: 'The profile piece', description: 'The profile piece: a piece for the #276 web acceptance test.', size: [320, 180], camera: 'cam', seed: 27607,
    transport: { span: `${STEPS / 60}s`, frame_rate: [60, 1] }, requires: { modules: { logic: '^1' } },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
    drivers: { walk: { target: 'items/hero/at/pos/0', expr: '10 + 7 * t', vars: { t: 'time' } } },
    assets: { rules: { sha256: p.sha, license: { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Made by the #276 web acceptance test at test time.' } } },
  };
  return { id, title: 'The profile piece', document, programs: [p] };
}

// ---------------------------------------------------------------------------------------------------
// The player's own controls (README: The player's own controls)

const EXPORT_PROFILE = 'Export profile';
const IMPORT_PROFILE = 'Import profile';
const START_FRESH = 'Start fresh';
const DELETE_PROFILE = 'Delete profile';
const PROFILE_GROUP = 'Profile';

/** What step 0 read, [u32, xp], as probe().values gives got_flag and got_xp. */
const readAt0 = (p: JsonObject, what: string): unknown[] => { const v = valuesOf(p, what); return [v[`${GAME}.got_flag`], v[`${GAME}.got_xp`]]; };
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The piece exported to the web and served: its page's URL. */
async function served(): Promise<string> {
  const root = temp();
  exportDoc(temp(), pieceDoc(program()), join(root, 'piece'));
  return `${await web.serve(root)}/piece/index.html`;
}

/** The page once ready, at its start: a probe whose step 0 has run. */
async function started(page: Page, what: string): Promise<JsonObject> {
  const p = await until(page, (q) => typeof valuesOf(q, what)[`${GAME}.got_flag`] === 'number', 30_000, what);
  expect(typeof valuesOf(p, what)[`${GAME}.got_flag`], `${what}: probe().values holds ${GAME}.got_flag once the player is ready; probe ${JSON.stringify(p).slice(0, 600)}`).toBe('number');
  return p;
}

/** A session in a profile that holds no record: zeros at step 0, then played until probe().profile lists the record
 * step 900 wrote; paused. The record's hash. */
async function playToRecord(page: Page, what: string): Promise<string> {
  const s = await started(page, what);
  expect(profileOf(s, what), `${what}: a fresh browser profile holds no profile record`).toBeNull();
  expect(readAt0(s, what), `${what}: without a record the piece reads a u32 0 and zeros at step 0`).toEqual(WITHOUT);
  await page.play();
  const p = await until(page, (q) => profileOf(q, what) !== null, playMs(ASKS_AT), what);
  await page.pause();
  const kept = profileOf(p, what);
  expect(kept, `${what}: the record step ${ASKS_AT} asks for is kept in the browser's storage; the player is at step ${stepOf(p, what)}, notices ${JSON.stringify(await page.notices())}`).not.toBeNull();
  expect(stepOf(p, what), `${what}: the record is written when play reaches step ${ASKS_AT}, not before`).toBeGreaterThanOrEqual(ASKS_AT);
  return kept!.hash;
}

/** The page reloaded (the next session): what step 0 read and the stored record. */
async function nextSession(page: Page, what: string): Promise<JsonObject> {
  await page.reload(what);
  return started(page, what);
}

describe(`${AC7} a profile record in the web player`, () => {
  it(`${AC7} the record step 900 writes keeps to the browser's storage and reopens at the next start with xp 1200 at step 0; exported and imported into a fresh profile, it reopens there the same way`, async () => {
    const url = await served();

    // Written in the player and kept in the browser's storage: the next session reopens it at start.
    const a = await web.browser();
    const page = await openPiece(a, url, 'the first session');
    const hash = await playToRecord(page, 'the first session');
    const two = await nextSession(page, 'the next session, the page reloaded');
    expect(profileOf(two, 'the next session'), 'the record is kept in the browser\'s storage across the reload').toEqual({ hash });
    expect(readAt0(two, 'the next session'), `the next session starts with a u32 1 and xp ${XP_AT_ASK} in its read region at step 0; notices ${JSON.stringify(await page.notices())}`).toEqual(WITH);

    // Exported to a file.
    const file = await page.exportFile(EXPORT_PROFILE, temp(), 'the next session');
    const bytes = readFileSync(file);
    expect(sha256(bytes), 'the exported file holds the record the storage keeps, its bytes hashing to the record\'s hash').toBe(hash);

    // Imported into a fresh profile, where the next start reopens it.
    const b = await web.browser();
    const other = await openPiece(b, url, 'a fresh browser profile');
    const fresh = await started(other, 'a fresh browser profile');
    expect(profileOf(fresh, 'a fresh browser profile'), 'a fresh browser profile holds no profile record').toBeNull();
    expect(readAt0(fresh, 'a fresh browser profile'), 'without a record the piece reads a u32 0 and zeros at step 0').toEqual(WITHOUT);
    await other.importFile(IMPORT_PROFILE, file, 'a fresh browser profile');
    const taken = await until(other, (q) => profileOf(q, 'the import')?.hash === hash, 60_000, 'the import');
    expect(profileOf(taken, 'the import'), `"${IMPORT_PROFILE}" keeps the record in the fresh profile's storage; notices ${JSON.stringify(await other.notices())}`).toEqual({ hash });
    const after = await nextSession(other, 'the fresh profile\'s next session');
    expect(profileOf(after, 'the fresh profile\'s next session'), 'the imported record is kept across the reload').toEqual({ hash });
    expect(readAt0(after, 'the fresh profile\'s next session'), `the imported record reopens at start: a u32 1 and xp ${XP_AT_ASK} at step 0; notices ${JSON.stringify(await other.notices())}`).toEqual(WITH);
  }, TIMEOUT);
});

describe('Scope #276 the piece\'s menu in the web player', () => {
  it('Scope #276 the piece\'s menu, the player\'s own controls, names the profile, with start fresh (this run only) and delete', async () => {
    const url = await served();
    const a = await web.browser();
    const page = await openPiece(a, url, 'the first session');
    const hash = await playToRecord(page, 'the first session');
    expect(hash, 'the record\'s hash').toMatch(DIGEST);
    const two = await nextSession(page, 'the next session');
    expect(readAt0(two, 'the next session'), `the next session reads a u32 1 and xp ${XP_AT_ASK} at step 0`).toEqual(WITH);
    expect(await page.groupNames(PROFILE_GROUP, hash), `the player's own "${PROFILE_GROUP}" group names the stored record, ${hash}`).toBe('named');

    // Start fresh: this run reads zeros and the stored record stays; the next start reopens it.
    await page.click(START_FRESH, 'the next session');
    const fresh = await until(page, (q) => same(readAt0(q, START_FRESH), WITHOUT), 60_000, START_FRESH);
    expect(readAt0(fresh, START_FRESH), `"${START_FRESH}" runs the piece from its start with a u32 0 and zeros at step 0; notices ${JSON.stringify(await page.notices())}`).toEqual(WITHOUT);
    expect(profileOf(fresh, START_FRESH), `"${START_FRESH}" keeps the stored record`).toEqual({ hash });
    const back = await nextSession(page, `the session after "${START_FRESH}"`);
    expect(readAt0(back, 'the session after start fresh'), `"${START_FRESH}" lasts this run only: the next session reads a u32 1 and xp ${XP_AT_ASK} at step 0`).toEqual(WITH);

    // Delete: the stored record goes, and the next start reads zeros.
    await page.click(DELETE_PROFILE, 'the session after start fresh');
    const gone = await until(page, (q) => profileOf(q, DELETE_PROFILE) === null, 60_000, DELETE_PROFILE);
    expect(profileOf(gone, DELETE_PROFILE), `"${DELETE_PROFILE}" removes the record from the browser's storage; notices ${JSON.stringify(await page.notices())}`).toBeNull();
    const after = await nextSession(page, `the session after "${DELETE_PROFILE}"`);
    expect(profileOf(after, 'the session after delete'), 'the deleted record stays gone after a reload').toBeNull();
    expect(readAt0(after, 'the session after delete'), 'the next session reads a u32 0 and zeros at step 0').toEqual(WITHOUT);
    expect(await page.groupNames(PROFILE_GROUP, hash), `the "${PROFILE_GROUP}" group no longer names the deleted record`).not.toBe('named');
  }, TIMEOUT);
});
