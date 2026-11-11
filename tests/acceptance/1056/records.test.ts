// #1056.77c08347: "A record written on a second Apple GPU (the other reference Mac, or an M1) for #464's fixture is
// read by its two-GPU criterion. Equal hashes pass. A planted index differing in one pixel of one frame fails, naming
// the frame and pixel. A record for another tree hash is refused, naming both hashes."
//
// `deep-gpu`'s `index_record` call draws a fixture's every frame under its pixel look and writes, into the scenario's
// `out`, `index-record-<fixture>-<family>.json` (#464's file, with `gpu.family`, `gpu.chip` and `indices` as #464's
// two-GPU criteria read them) holding this GPU's fingerprint, this checkout's tree hash and each frame's index hash,
// each frame's index target `<sha256>.u16` beside it. `cross_index` compares records of one fixture from GPUs of
// different families (README: Surfaces this suite picked). The fixtures are #464's own: the stroke and circle (`grid`),
// the tables (`tables`) and the dithered puff (`puff`), the three with a two-GPU clause, plus its keyed flash
// (`flash`), whose frames differ, for the per-frame hashes.
//
// This Mac has one Apple GPU, so the comparison is proven on twins of this Mac's record standing in for another family,
// as #380's and #140's suites prove theirs: the twin with equal hashes passes `cross_index` and #464's own two-GPU test
// (run read-only, its record named in DEEPBUILD_SECOND_GPU_464); the planted twin, one pixel of frame 12 of the puff
// changed, fails naming frame 12 and pixel (61, 50); the twin for another tree hash is refused naming both. The real
// second GPU's records are read from the folder DEEPBUILD_SECOND_GPU_1056 names; without them that test fails BLOCKED
// with its one unblock ask, never passing. At the base `deep-gpu` has no `index_record` or `cross_index` call.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC1, FIXTURES_464, FLASH, FLASH_PALETTE, PUFF, TARGET, arr, blocked, blockedWithOneAsk, checkoutTree, chipModel, criterion464, crossIndex, indexFile, makeRecords,
  none, num, obj, otherFamily, readRecord, recordsDir, requireGpu, shown, str, thisFamily, twin, useGpu, useOut,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();

describe(`${AC1} a second Apple GPU's index records, read by #464's two-GPU criteria and compared frame by frame`, () => {
  it(`${AC1} index_record writes, for each of #464's pixel fixtures, the file its two-GPU criterion reads, with this GPU's fingerprint, this checkout's tree hash and every frame's index hash beside it; a record of another family with equal hashes passes cross_index and #464's two-GPU test`, () => {
    requireGpu();
    const family = thisFamily(); const model = chipModel();
    const fixtures = [...FIXTURES_464, FLASH];
    const mine = makeRecords(bin(), join(out(), 'mine'), fixtures);
    const tree = checkoutTree();
    fixtures.forEach((f, k) => {
      const rec = mine[k]!; const what = `the ${f.fixture} record`;
      const gpu = obj(rec.raw['gpu'], `${what}: gpu`);
      expect(rec.family, `${what} names this GPU's family`).toBe(family);
      expect(str(gpu['chip'], `${what}: gpu.chip`), `${what}'s gpu.chip names this chip`).toMatch(new RegExp(`\\b${model}\\b`));
      const fingerprint = obj(rec.raw['fingerprint'], `${what}: fingerprint`);
      for (const field of ['os', 'gpu', 'driver', 'wgpu']) expect(str(fingerprint[field], `${what}: fingerprint.${field}`).length, `${what}: fingerprint.${field} is set`).toBeGreaterThan(0);
      expect(fingerprint['gpu'], `${what}'s fingerprint names this GPU`).toMatch(new RegExp(`\\b${model}\\b`));
      expect(rec.tree, `${what} carries this checkout's tree hash`).toBe(tree);
      expect(rec.frames.length, `${what} has an index hash for each of its ${f.frames} frames`).toBe(f.frames);
      rec.frames.forEach((_, n) => indexFile(rec, n));
      expect(obj(rec.raw['indices'], `${what}: indices`)[f.fixture], `${what}: indices.${f.fixture} is frame 0's index hash, as #464's criterion reads it`).toBe(rec.frames[0]);
    });
    // Per frame: the keyed flash draws hero-body through the flash table on frames 100 to 104 only (#464's AC9).
    const flash = mine[fixtures.indexOf(FLASH)]!;
    const problems: string[] = [];
    for (let n = 0; n < FLASH.frames; n++) {
      const want = n >= 100 && n < 105 ? 'flashc' : 'body';
      const got = indexFile(flash, n).readUInt16LE((60 * TARGET[0] + 60) * 2);
      if (got !== FLASH_PALETTE.indexOf(want)) problems.push(`frame ${n}'s index target holds ${got} at hero-body's pixel (60, 60), not ${want}'s ${FLASH_PALETTE.indexOf(want)}`);
    }
    none(problems, `${AC1} the flash record's per-frame index targets`);
    // Equal hashes pass: a twin of each record standing in for another family.
    const other = otherFamily(family);
    FIXTURES_464.forEach((f, k) => {
      const theirs = twin(mine[k]!, join(out(), `equal-${f.fixture}`), { family: other });
      const c = crossIndex(bin(), out(), [mine[k]!.path, theirs], `${f.fixture} on ${family} and ${other.family}, equal hashes`);
      expect(c.result, `${f.fixture}'s equal hashes on ${family} and ${other.family} pass: ${shown(c.raw)}`).toBe('PASS');
      const run = criterion464(f.fixture, theirs);
      expect(run.status, `#464's two-GPU test for ${f.fixture} reads the record and passes: ${run.failure}`).toBe('passed');
    });
  });

  it(`${AC1} a planted index differing in one pixel of one frame fails, naming the frame and the pixel`, () => {
    requireGpu();
    const [mine] = makeRecords(bin(), join(out(), 'mine'), [PUFF]);
    const planted = twin(mine!, join(out(), 'planted'), { family: otherFamily(thisFamily()), pixel: { frame: 12, x: 61, y: 50 } });
    const c = crossIndex(bin(), out(), [mine!.path, planted], 'the planted index');
    expect(c.result, `an index differing in one pixel of one frame fails: ${shown(c.raw)}`).toBe('FAIL');
    expect(c.differs.length, `one frame differs: ${shown(c.raw['differs'])}`).toBe(1);
    expect(num(c.differs[0]!['frame'], 'differs[0].frame'), 'the failure names frame 12').toBe(12);
    expect(arr(c.differs[0]!['pixel'], 'differs[0].pixel'), 'the failure names pixel (61, 50)').toEqual([61, 50]);
  });

  it(`${AC1} a record for another tree hash is refused, naming both hashes`, () => {
    requireGpu();
    const [mine] = makeRecords(bin(), join(out(), 'mine'), [PUFF]);
    const stale = createHash('sha256').update('#1056: a tree this checkout is not').digest('hex').slice(0, mine!.tree.length);
    expect(stale, 'the other tree hash differs from this one').not.toBe(mine!.tree);
    const theirs = twin(mine!, join(out(), 'stale'), { family: otherFamily(thisFamily()), tree: stale });
    const c = crossIndex(bin(), out(), [mine!.path, theirs], 'a record for another tree hash');
    blockedWithOneAsk(c, 'a record for another tree hash');
    const text = JSON.stringify(c.raw);
    expect(text, `the refusal names this checkout's tree hash ${mine!.tree}`).toContain(mine!.tree);
    expect(text, `and the record's ${stale}`).toContain(stale);
  });

  it(`${AC1} on a second Apple GPU: the records a Mac of another GPU family made of #464's fixtures at this tree (DEEPBUILD_SECOND_GPU_1056) have this GPU's index hashes on every frame and pass #464's two-GPU tests; without them this is BLOCKED, never PASS`, () => {
    requireGpu();
    const family = thisFamily();
    // This GPU's records first, so a run on the second Mac leaves the folder this test asks for.
    const dir = recordsDir();
    const mine = makeRecords(bin(), dir, FIXTURES_464);
    console.log(`${AC1}: this GPU's (${family}) records of #464's fixtures: ${dir}`);
    const ask = `one unblock ask: on a Mac whose GPU is another family than ${family} (the other reference Mac, or an M1), at tree ${mine[0]!.tree}, run \`node node_modules/vitest/vitest.mjs run --root tests/acceptance/1056 --no-file-parallelism records.test.ts\`, bring the folder of records it prints (deep-1056-records in its DEEPBUILD_EVIDENCE_DIR, else in its $TMPDIR) to this Mac and name it in DEEPBUILD_SECOND_GPU_1056`;
    const theirsDir = process.env['DEEPBUILD_SECOND_GPU_1056'];
    if (!theirsDir || !existsSync(theirsDir)) blocked(`#464's fixtures need a second GPU's index records and this machine has one GPU (${family}); ${ask}`);
    FIXTURES_464.forEach((f, k) => {
      const found = readdirSync(theirsDir).map((n) => new RegExp(`^index-record-${f.fixture}-(apple\\d+)\\.json$`).exec(n)?.[1]).find((fam) => fam !== undefined && fam !== family);
      if (!found) blocked(`DEEPBUILD_SECOND_GPU_1056 (${theirsDir}) holds no record of ${f.fixture} from another GPU family than ${family}; ${ask}`);
      const theirs = readRecord(theirsDir, f.fixture, found);
      const c = crossIndex(bin(), out(), [mine[k]!.path, theirs.path], `${f.fixture} on ${family} and ${found}`);
      if (c.result === 'BLOCKED') blocked(`cross_index reads ${f.fixture}'s records on ${family} and ${found} as BLOCKED: ${shown(c.raw)}; ${ask}`);
      expect(c.result, `every frame of ${f.fixture} has the same index hash on ${family} and ${found}: ${shown(c.raw)}`).toBe('PASS');
      const run = criterion464(f.fixture, theirs.path);
      expect(run.status, `#464's two-GPU test for ${f.fixture} reads ${found}'s record and passes: ${run.failure}`).toBe('passed');
    });
  });
});
