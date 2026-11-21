// Criterion 2: "A new stage asset keeps the record; a changed count on one array refuses it with one notice naming
// that array, the piece starts with zeros and the old record stays; a planted record bound to the piece's content is
// refused after the stage change and fails, naming the asset"
//
// Through `deep-logic`, the app, one process per session (README: The surface under test). The hero with stage 1
// writes its record at step 900 (xp 1200). In order:
//   - the hero with a new stage asset beside stage 1 (another content, the same program) starts: it reopens the
//     record, with no notice, and step 0 reads xp 1200 and the look;
//   - the hero whose look has 6 values (a changed count on one array) starts: one notice, `profile_refused`, naming
//     look; step 0 reads a u32 0 and zeros over the garbage its init left; the store's record files keep their names
//     and bytes, and the hero with stage 1 then reopens the record again.
// The planted twin `profile_bound_to_content` binds a record to the item's data assets too; run for every process of
// its test, the start after the stage change refuses the record and the same check fails, naming the new asset.
// Wrong programs it fails: the base (no profile); a record bound to the content or the program; a shape change that
// opens the record, gives no notice or another array, starts with the old values or garbage, or drops the record.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, failsNaming, kept, none, prebuild, sha256, show, useTemp, type JsonValue, type Planted } from './helpers.ts';
import { SMALL, STAGE_1, STAGE_2, WIDER, defaultLook, piece, readAt, readWith, readWithout, rest, session, showRead, stepZero, type Session } from './hero.ts';

prebuild();
const temp = useTemp();

/** The record written by the hero with stage 1, and the start of the hero with the new stage asset beside it. */
function recordThenStage(dir: string, planted?: Planted): { record: string; staged: Session } {
  const first = session(piece(SMALL, [STAGE_1]), dir, 900, [rest(900)], 'the hero with stage 1, resting at step 900', { planted });
  expect(first.run.profiles.map((w) => w.step), 'the hero with stage 1 writes its record at step 900').toEqual([900]);
  const staged = session(piece(SMALL, [STAGE_1, STAGE_2]), dir, 0, [], 'the hero with a new stage asset', { planted });
  return { record: first.run.profiles[0]!.hash, staged };
}

/** The check: the start after the new stage asset reopens the record whole (README: Criteria to tests). */
function keeps(staged: Session, record: string, asset: string): string[] {
  const at = `after the new stage asset ${asset}`;
  const out: string[] = [];
  if (staged.opened.record !== record) out.push(`${at} the start reopens ${String(staged.opened.record)}, not the record ${record}`);
  if (staged.opened.notices.length) out.push(`${at} the start gives the notices ${show(staged.opened.notices as unknown as JsonValue, 600)}`);
  const read = showRead(readAt(stepZero(staged.run)));
  if (read !== showRead(readWith(1200, defaultLook(SMALL.look)))) out.push(`${at} step 0 reads ${read}, not the record's xp 1200 and look`);
  return out;
}

describe(`${AC[2]} the record is bound by its arrays' shape alone`, () => {
  it(`${AC[2]} a new stage asset keeps the record; a changed count on look refuses it with one notice naming look, the piece starts with zeros and the old record stays`, () => {
    const dir = temp();
    const { record, staged } = recordThenStage(dir);
    none(keeps(staged, record, sha256(STAGE_2)), 'the record after the new stage asset');

    const before = kept(dir);
    expect(Object.keys(before), 'the store holds the record').toContain(`${record}.profile`);
    const wider = session(piece(WIDER, [STAGE_1]), dir, 0, [], 'the hero whose look has 6 values');
    expect(wider.opened.record, 'the record is refused: nothing is reopened').toBeNull();
    expect(wider.opened.notices.map((n) => [n['code'], n['array']]), `one notice, naming look: ${show(wider.opened.notices as unknown as JsonValue, 600)}`).toEqual([['profile_refused', 'look']]);
    expect(showRead(readAt(stepZero(wider.run))), 'the piece starts with zeros: step 0 reads a u32 0 and zeros, never the old values or what was there before').toBe(showRead(readWithout(WIDER.look)));
    const after = kept(dir);
    expect(Object.keys(after), 'the old record stays: the store keeps the same record files').toEqual(Object.keys(before));
    expect(Object.entries(after).every(([f, b]) => b.equals(before[f]!)), 'and their bytes').toBe(true);
    const again = session(piece(SMALL, [STAGE_1]), dir, 0, [], 'the hero with stage 1, started again');
    expect([again.opened.record, readAt(stepZero(again.run)).xp], 'the old record still opens where its shape matches').toEqual([record, 1200]);
  }, TIMEOUT);

  it(`${AC[2]} a planted record bound to the piece's content (profile_bound_to_content) is refused after the stage change and fails, naming the asset`, () => {
    const { record, staged } = recordThenStage(temp(), 'profile_bound_to_content');
    failsNaming(keeps(staged, record, sha256(STAGE_2)), [sha256(STAGE_2)], 'the record after the new stage asset');
  }, TIMEOUT);
});
