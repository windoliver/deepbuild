// Criterion 5: "A replica a check runs starts with zeros unless the brief names a fixture record, and a planted check
// that reads the viewer's stored record fails, naming the source"
//
// Through `deep-logic`, the app (README: The surface under test, Checks). The viewer's saves folder holds the hero's
// record of xp 1200 (a rest point at step 900); another folder holds a record of xp 400 (step 300), whose bytes are the
// fixture record. Three runs of 61 steps give the step hashes a replica could start from: a bake with no record
// (zeros), a start in the viewer's folder (the stored record) and a start in the fixture's folder (the fixture). A
// golden, the check's replica that records every step's hash, given the viewer's folder: its step hashes are the
// zeros run's. Given also the fixture record by asset ID, carried in the piece's assets: the fixture run's. The planted
// twin `check_reads_viewer_profile`, run for the golden alone, starts its replica from the viewer's stored record, and
// the same check fails, naming that source.
// Wrong programs it fails: the base (no profile); a check that reads the viewer's store (the twin), ignores the
// fixture the brief names, or leaves the read region unfilled.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, arr, bakeOf, failsNaming, none, obj, one, prebuild, str, useTemp, wroteWhole, type JsonObject, type Planted, type Program, type StepRecord } from './helpers.ts';
import { HERO, SMALL, STAGE_1, defaultLook, hero, heroPiece, readAt, readWith, readWithout, regions, rest, session, showRead } from './hero.ts';

prebuild();
const temp = useTemp();

const STEPS = 61;
/** A run's step hashes for the hero, steps 0 to 60. */
const hashesOf = (steps: StepRecord[]): string[] => steps.filter((s) => s.step < STEPS).map((s) => s.hashes[HERO] ?? '');
/** A golden's step hashes for the hero (#532's `golden` reply). */
function goldenHashes(r: JsonObject, what: string): string[] {
  expect(r['ok'], `${what} records a golden (ok: true): ${JSON.stringify(r).slice(0, 1500)}`).toBe(true);
  const list = arr(obj(obj(r['golden'], `${what}.golden`)['step_hashes'], `${what}.golden.step_hashes`)[HERO], `${what}.golden.step_hashes.${HERO}`);
  return list.map((h, i) => str(h, `${what}: step hash ${i}`));
}

interface Source { name: string; hashes: string[] }
/** The check: which run a replica's step hashes are, by name, against the one it should start from. */
function startsFrom(golden: string[], sources: Source[], expected: string): string[] {
  const from = sources.find((s) => JSON.stringify(s.hashes) === JSON.stringify(golden))?.name ?? 'none of the runs it could start from';
  return from === expected ? [] : [`the check's replica starts from ${from}, not from ${expected} (its first step hashes ${golden.slice(0, 3).join(', ')})`];
}

interface SetUp { viewer: string; record: string; fixture: Buffer; fixtureId: string; program: Program; sources: Source[]; names: { zeros: string; stored: string; fixture: string } }
/** The viewer's record, the fixture record, and the three runs a replica could start from. */
function setUp(): SetUp {
  const program = hero(regions(SMALL), SMALL);
  const p = heroPiece(program, SMALL, [STAGE_1]);
  const viewer = temp();
  const elsewhere = temp();
  const stored = session(p, viewer, 900, [rest(900)], 'the viewer\'s session (a rest point at step 900)').run.profiles;
  expect(stored.map((w) => w.step), 'the viewer\'s store holds a record of step 900').toEqual([900]);
  const record = stored[0]!.hash;
  const made = session(p, elsewhere, 300, [rest(300)], 'the session that makes the fixture record (a rest point at step 300)').run.profiles;
  expect(made.map((w) => w.step), 'a record of step 300').toEqual([300]);
  const fixture = wroteWhole(elsewhere, made[0]!, 'the fixture record');

  const zeros = bakeOf(one({ call: 'bake', piece: p, steps: STEPS, track: [] }, 'a bake with no record'), 'a bake with no record').steps;
  expect(showRead(readAt(zeros.find((s) => s.step === 0))), 'with no record step 0 reads a u32 0 and zeros').toBe(showRead(readWithout(SMALL.look)));
  const fromStore = session(p, viewer, STEPS - 1, [], 'a start in the viewer\'s folder').run.steps;
  expect(showRead(readAt(fromStore.find((s) => s.step === 0))), 'a start in the viewer\'s folder reads its record, xp 1200').toBe(showRead(readWith(1200, defaultLook(SMALL.look))));
  const fromFixture = session(p, elsewhere, STEPS - 1, [], 'a start in the fixture\'s folder').run.steps;
  expect(showRead(readAt(fromFixture.find((s) => s.step === 0))), 'a start in the fixture\'s folder reads it, xp 400').toBe(showRead(readWith(400, defaultLook(SMALL.look))));
  const names = { zeros: 'zeros (no record)', stored: `the viewer's stored record ${record} in its saves folder`, fixture: `the fixture record ${made[0]!.hash} the brief names` };
  const sources = [{ name: names.zeros, hashes: hashesOf(zeros) }, { name: names.stored, hashes: hashesOf(fromStore) }, { name: names.fixture, hashes: hashesOf(fromFixture) }];
  expect(new Set(sources.map((s) => s.hashes[0])).size, 'the three runs differ at step 0').toBe(3);
  return { viewer, record, fixture, fixtureId: made[0]!.hash, program, sources, names };
}

/** The golden of the hero over 61 steps, given the viewer's saves folder, and the fixture record if named. */
function golden(s: SetUp, o: { fixture?: boolean; planted?: Planted } = {}): string[] {
  const p = heroPiece(s.program, SMALL, [STAGE_1], o.fixture ? [s.fixture] : []);
  const what = `the golden${o.fixture ? ' with the fixture record named' : ''}${o.planted ? ` (${o.planted})` : ''}`;
  return goldenHashes(one({ call: 'golden', piece: p, steps: STEPS, track: [], saves_dir: s.viewer, ...(o.fixture ? { profile: s.fixtureId } : {}) }, what, o.planted), what);
}

describe(`${AC[5]} a check's replica starts with zeros unless the brief names a fixture record`, () => {
  it(`${AC[5]} a replica a check runs starts with zeros beside the viewer's stored record, and with the fixture record the brief names`, () => {
    const s = setUp();
    none(startsFrom(golden(s), s.sources, s.names.zeros), 'the golden given the viewer\'s folder');
    none(startsFrom(golden(s, { fixture: true }), s.sources, s.names.fixture), 'the golden with the fixture record named');
  }, TIMEOUT);

  it(`${AC[5]} a planted check that reads the viewer's stored record (check_reads_viewer_profile) fails, naming the source`, () => {
    const s = setUp();
    failsNaming(startsFrom(golden(s, { planted: 'check_reads_viewer_profile' }), s.sources, s.names.zeros), ['the viewer\'s stored record', s.record], 'the planted golden given the viewer\'s folder');
  }, TIMEOUT);
});
