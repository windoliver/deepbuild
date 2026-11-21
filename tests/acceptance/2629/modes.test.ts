// AC1: packageDigest hashes a file's mode as git records it (755 when the owner execute bit is set, 644 otherwise), so
// one package checked out under umask 002 (664/775) and under umask 022 (644/755) gives the same digest.
// AC2: setting or clearing a file's execute bit still changes the digest.
//
// The issue's own packages (packages/jobs/score: all 644; packages/jobs/import: one 755 file) are taken from HEAD
// with git archive and chmod-ed as each umask's checkout gives them; their stamped digest is the expected value.
import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, checkout, DIGEST, packageDigest, setModes, smallPackage, stamped, UMASK_002, UMASK_022, type Entry, type Umask } from './helpers.ts';

const ISSUE_PACKAGES = ['packages/jobs/score', 'packages/jobs/import'];

describe(`${AC[1]} packageDigest hashes a file's mode as git records it, so umask 002 and umask 022 checkouts give one digest`, () => {
  it(`${AC[1]} packages/jobs/score and packages/jobs/import checked out under umask 002 (664/775) give the digest stamped in their deepbuild.json, as under umask 022 (644/755)`, async () => {
    const at022 = checkout(ISSUE_PACKAGES, UMASK_022);
    const at002 = checkout(ISSUE_PACKAGES, UMASK_002);
    expect(at002.entries.get('packages/jobs/import')!.some((e) => e.executable), 'packages/jobs/import holds a file git records 755 (the 775 case)').toBe(true);
    for (const dir of ISSUE_PACKAGES) {
      const want = stamped(join(at022.root, dir));
      expect(want, `${dir}'s deepbuild.json carries a stamped digest`).toMatch(DIGEST);
      expect(await packageDigest(join(at022.root, dir)), `${dir} under umask 022 (644/755) gives its stamped digest`).toBe(want);
      expect(await packageDigest(join(at002.root, dir)), `${dir} under umask 002 (664/775) gives the same digest as under umask 022, its stamped ${String(want)}`).toBe(want);
    }
  }, 60_000);

  it(`${AC[1]} any mode with the owner execute bit set hashes as 755, any without it as 644: the digest is the 644/755 one`, async () => {
    const { folder, entries } = smallPackage('small');
    const at022 = await packageDigest(folder);
    expect(at022, 'a digest of the 644/755 package').toMatch(DIGEST);
    // Plain files and the executable `main` under other umasks and chmods; every pair is git's 644/755.
    const umasks: [string, Umask][] = [
      ['umask 002 (664/775)', UMASK_002],
      ['umask 077 (600/700)', { plain: 0o600, executable: 0o700 }],
      ['umask 000 (666/777)', { plain: 0o666, executable: 0o777 }],
      ['umask 027 (640/750)', { plain: 0o640, executable: 0o750 }],
      ['read-only (444/555)', { plain: 0o444, executable: 0o555 }],
      ['owner x only (644/744)', { plain: 0o644, executable: 0o744 }],
      ['group and other x without owner x (654 / 711)', { plain: 0o654, executable: 0o711 }],
    ];
    for (const [name, umask] of umasks) {
      setModes(folder, entries, umask);
      expect(await packageDigest(folder), `the package with its files ${name} gives the 644/755 digest`).toBe(at022);
    }
    setModes(folder, entries, UMASK_022);
    expect(await packageDigest(folder), 'back at 644/755, the same digest').toBe(at022);
  }, 60_000);
});

describe(`${AC[2]} setting or clearing a file's execute bit still changes the digest`, () => {
  /** The digest with one file's mode changed, then the mode put back. */
  async function digestWith(folder: string, entry: Entry, mode: number, back: number): Promise<string> {
    chmodSync(join(folder, entry.path), mode);
    const digest = await packageDigest(folder);
    chmodSync(join(folder, entry.path), back);
    return digest;
  }

  it(`${AC[2]} setting a plain file's execute bit, or clearing the executable's, changes the digest, under umask 022 and under umask 002`, async () => {
    const { folder, entries } = smallPackage('xbit');
    const plain = entries.find((e) => e.path === 'index.ts')!;
    const main = entries.find((e) => e.path === 'main')!;
    for (const [name, umask] of [['umask 022', UMASK_022], ['umask 002', UMASK_002]] as const) {
      setModes(folder, entries, umask);
      const base = await packageDigest(folder);
      expect(base, `a digest of the package under ${name}`).toMatch(DIGEST);
      const set = await digestWith(folder, plain, umask.executable, umask.plain);
      expect(set, `under ${name}, index.ts made executable (${umask.executable.toString(8)})`).toMatch(DIGEST);
      expect(set, `under ${name}, setting index.ts's execute bit changes the digest`).not.toBe(base);
      const cleared = await digestWith(folder, main, umask.plain, umask.executable);
      expect(cleared, `under ${name}, main made plain (${umask.plain.toString(8)})`).toMatch(DIGEST);
      expect(cleared, `under ${name}, clearing main's execute bit changes the digest`).not.toBe(base);
      expect(cleared, `under ${name}, the two changes give different digests`).not.toBe(set);
      expect(await packageDigest(folder), `under ${name}, with the bits put back, the digest is the package's again`).toBe(base);
    }
  }, 60_000);

  it(`${AC[2]} clearing the execute bit of packages/jobs/import's 755 file changes its digest away from the stamped one`, async () => {
    const { root, entries } = checkout(['packages/jobs/import'], UMASK_022);
    const folder = join(root, 'packages/jobs/import');
    const exec = entries.get('packages/jobs/import')!.find((e) => e.executable)!;
    const want = stamped(folder);
    expect(await packageDigest(folder), 'packages/jobs/import at 644/755 gives its stamped digest').toBe(want);
    chmodSync(join(folder, exec.path), 0o644);
    const cleared = await packageDigest(folder);
    expect(cleared, `with ${exec.path} at 644`).toMatch(DIGEST);
    expect(cleared, `clearing ${exec.path}'s execute bit changes the digest from the stamped ${String(want)}`).not.toBe(want);
  }, 60_000);
});
