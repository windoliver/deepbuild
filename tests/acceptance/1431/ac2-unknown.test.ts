// AC2 #1431.aa066358: with the footprint read failing, the report says unknown and names the read. A planted reader that
// returns 0 fails, naming the field.
//
// Three replica processes (`deep-drive`, the env-plants build), each launched on its fixture and asked for its reading
// (`{"call": "footprint"}`): the replica as it ships, whose footprint is read; `DEEP_DRIVE_PLANT=footprint-read-fails`,
// where the read fails as the system call does when it returns an error, so the report must say unknown (null, never
// 0) and name the read in `unknown`; and `footprint-reads-zero`, the planted reader, whose read fails the same way and
// which returns 0 for it. The same judge must pass the second and fail the third, naming the field `footprint`.
import { describe, expect, it } from 'vitest';
import { DRIVE_BUILD, DRIVE_PLANT, ID, Replica, arithmeticProblems, none, requireMacos, short, useBuild, type Reading } from './helpers.ts';

const drive = useBuild(DRIVE_BUILD);

/** The reading of a fresh replica process, planted when `plant` names it. */
async function readFrom(plant?: string): Promise<Reading> {
  const r = await Replica.start(drive(), { from: 'fixture' }, plant);
  try {
    return await r.reading(plant ? `with ${plant}` : 'as it ships');
  } finally {
    await r.stop();
  }
}

/**
 * The criterion's judge on a reading whose footprint read failed: the report says unknown (null, never 0), names the
 * read in `unknown`, and `unaccounted`, which needs the footprint, is unknown too. Each problem names its field.
 */
function failedReadProblems(r: Reading): string[] {
  const problems: string[] = [];
  if (r.footprint !== null) problems.push(`footprint: reads ${r.footprint} B though its read failed; a value that can't be read is unknown (null), never ${r.footprint === 0 ? '0' : 'a number'}`);
  const row = r.unknown.find((u) => u.field === 'footprint');
  if (!row) problems.push(`footprint: the report's unknown list doesn't name the read that failed: ${short(r.unknown)}`);
  else if (!/footprint/i.test(row.read)) problems.push(`footprint: the unknown row names "${row.read}", not the footprint's read`);
  if (r.unaccounted !== null) problems.push(`unaccounted: reads ${r.unaccounted} B though the footprint it is taken from couldn't be read`);
  return problems;
}

describe(`${ID.ac2} a footprint that can't be read is unknown, never 0`, () => {
  it(`${ID.ac2} with the footprint read failing the report says unknown and names the read; a planted reader that returns 0 fails, naming the field`, async () => {
    requireMacos('the replica');
    const shipped = await readFrom();
    console.log(`PROOF ${ID.ac2} as it ships: ${short(shipped, 4000)}`);
    expect(shipped.footprint, `as it ships the replica reads its footprint (no fault): ${short(shipped.unknown)}`).not.toBeNull();
    expect(shipped.footprint!, 'a read footprint is a real size, above 0').toBeGreaterThan(0);
    expect(shipped.unknown.map((u) => u.field), 'and names no unknown footprint').not.toContain('footprint');
    none(arithmeticProblems(shipped, 'as it ships'), 'unaccounted is footprint less heap less the gauges');

    const failing = await readFrom(DRIVE_PLANT.readFails);
    console.log(`PROOF ${ID.ac2} ${DRIVE_PLANT.readFails}: ${short(failing, 4000)}`);
    none(failedReadProblems(failing), `with the footprint read failing (${DRIVE_PLANT.readFails}) the report says unknown and names the read`);

    const zero = await readFrom(DRIVE_PLANT.readsZero);
    console.log(`PROOF ${ID.ac2} ${DRIVE_PLANT.readsZero}: ${short(zero, 4000)}`);
    const caught = failedReadProblems(zero);
    console.log(`PROOF ${ID.ac2} the judge on ${DRIVE_PLANT.readsZero}: ${caught.join('; ')}`);
    expect(caught.length, `the planted reader that returns 0 (${DRIVE_PLANT.readsZero}) fails the same judge: ${short(zero)}`).toBeGreaterThan(0);
    expect(caught.some((p) => p.startsWith('footprint:') && /\b0\b/.test(p)), `and its failure names the field footprint and its 0: ${caught.join('; ')}`).toBe(true);
  }, 3_600_000);
});
