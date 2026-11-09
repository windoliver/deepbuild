// AC6 #41.1811c1ac: "A download with a bad signature is refused, a failure injected mid-switch leaves the previous
// version running, and the last three versions stay for rollback." (Added Oct 9: each version installs into its own
// folder; the download is checked against a manifest signed with an offline key; it's switched in atomically; the last
// three versions stay for rollback; tests inject a failure in the middle of the switch. Design: Installs and updates.)
//
// Surface assumed (the issue and design name no code surface, so this is the one the tests pin):
//   packages/hub/src/installer.ts exports
//     installVersion({ home, archive, manifest, signature, publicKey, failAt? }): Promise<{ version }>
//   - `home` is DeepBuild's own folder (~/.deepbuild in a real install; a temp folder here).
//   - `archive` is the download's bytes (Buffer): a gzip'd tar whose entries are relative to the version folder.
//   - `manifest` is the manifest's bytes (Buffer): JSON with at least `version` (the version's name) and `sha256` (the
//     archive's sha256, lower-case hex).
//   - `signature` is the Ed25519 signature over exactly the manifest's bytes (Buffer, 64 bytes); `publicKey` is the
//     public half (here an SPKI PEM string).
//   - It verifies the signature, checks the archive's sha256 against the manifest, unpacks into
//     `<home>/versions/<version>/`, then switches `<home>/versions/current` atomically (a symlink renamed over the old
//     one) and keeps only the newest three version folders, never removing current's. It resolves to `{ version }`.
//   - A bad signature or a wrong sha256 rejects with an Error naming which (the word "signature", or "sha256"), and
//     changes nothing on disk under `home`.
//   - `failAt` ('after-unpack' | 'before-switch' | 'during-switch') injects a failure there: the call rejects, and
//     `<home>/versions/current` is still a link to the previous version, which still runs.
// The test releases' programs are scripts that print their version (helpers.ts); the keys are made here with
// node:crypto. Nothing here reaches the network.

import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { archiveOf, cleanup, current, installer, keys, probe, release, runningVersion, tempDir, tree, versionFolders, type Keys } from './helpers.js';

afterAll(async () => { await cleanup([]); });

const AC = 'AC6 #41.1811c1ac';
const installed = async (home: string, k: Keys, version: string) => {
  const install = await installer();
  const r = release(version, k.privateKey);
  const got = await install({ home, ...r, publicKey: k.publicKey });
  expect(got, `installVersion must resolve to { version } for ${version}`).toEqual({ version });
};
const rejection = async (p: Promise<unknown>): Promise<string> => {
  try { await p; } catch (e) { return e instanceof Error ? e.message : String(e); }
  return '<it resolved: nothing was refused>';
};

describe(`${AC} installVersion`, () => {
  it(`${AC} a signed download installs into its own folder, switched in through the current link, and runs`, async () => {
    const home = join(tempDir(), 'deepbuild');
    const k = keys();
    await installed(home, k, '1.0.0');
    expect(versionFolders(home)).toEqual(['1.0.0']);
    const c = current(home);
    expect(c.link, `${home}/versions/current must be a link`).toBe(true);
    expect(c.reaches).toBe(join(home, 'versions', '1.0.0'));
    expect(runningVersion(home)).toBe('1.0.0');
    await installed(home, k, '1.1.0');
    expect(current(home)).toEqual({ link: true, reaches: join(home, 'versions', '1.1.0') });
    expect(runningVersion(home)).toBe('1.1.0');
  }, 60_000);

  it(`${AC} a download signed by another key is refused, naming the signature, and nothing on disk changes`, async () => {
    const home = join(tempDir(), 'deepbuild');
    const k = keys();
    await installed(home, k, '1.0.0');
    const before = tree(home);
    const other = keys();
    const r = release('2.0.0', other.privateKey);
    const why = await rejection((await installer())({ home, ...r, publicKey: k.publicKey }));
    expect(why).toMatch(/signature/i);
    expect(why).not.toMatch(/sha-?256/i);
    expect(tree(home)).toEqual(before);
    expect(runningVersion(home)).toBe('1.0.0');
  }, 60_000);

  it(`${AC} a manifest changed after it was signed is refused, naming the signature, and nothing on disk changes`, async () => {
    const home = join(tempDir(), 'deepbuild');
    const k = keys();
    await installed(home, k, '1.0.0');
    const before = tree(home);
    const r = release('2.0.0', k.privateKey);
    // The same archive and sha256, with the version renamed after signing: the signed bytes are not these.
    const manifest = Buffer.from(JSON.stringify({ ...JSON.parse(r.manifest.toString('utf8')), version: '2.0.1' }));
    const why = await rejection((await installer())({ home, ...r, manifest, publicKey: k.publicKey }));
    expect(why).toMatch(/signature/i);
    expect(tree(home)).toEqual(before);
    expect(runningVersion(home)).toBe('1.0.0');
  }, 60_000);

  it(`${AC} a signature that is one byte off is refused, naming the signature, and nothing on disk changes`, async () => {
    const home = join(tempDir(), 'deepbuild');
    const k = keys();
    await installed(home, k, '1.0.0');
    const before = tree(home);
    const r = release('2.0.0', k.privateKey);
    const signature = Buffer.from(r.signature);
    signature[10] = signature[10]! ^ 0x01;
    const why = await rejection((await installer())({ home, ...r, signature, publicKey: k.publicKey }));
    expect(why).toMatch(/signature/i);
    expect(tree(home)).toEqual(before);
    expect(runningVersion(home)).toBe('1.0.0');
  }, 60_000);

  it(`${AC} an archive whose sha256 isn't the signed manifest's is refused, naming the sha256, and nothing on disk changes`, async () => {
    const home = join(tempDir(), 'deepbuild');
    const k = keys();
    await installed(home, k, '1.0.0');
    const before = tree(home);
    // A correctly signed manifest for 2.0.0's archive, delivered with other bytes.
    const r = release('2.0.0', k.privateKey);
    const archive = archiveOf('6.6.6');
    const why = await rejection((await installer())({ home, ...r, archive, publicKey: k.publicKey }));
    expect(why).toMatch(/sha-?256/i);
    expect(why).not.toMatch(/\bsignature\b/i);
    expect(tree(home)).toEqual(before);
    expect(runningVersion(home)).toBe('1.0.0');
  }, 60_000);

  it(`${AC} a first download with a bad signature, into a home with no version yet, installs nothing`, async () => {
    const home = join(tempDir(), 'deepbuild');
    const k = keys();
    const r = release('1.0.0', keys().privateKey);
    const why = await rejection((await installer())({ home, ...r, publicKey: k.publicKey }));
    expect(why).toMatch(/signature/i);
    expect(versionFolders(home)).toEqual([]);
    expect(current(home)).toEqual({ link: false, reaches: undefined });
  }, 60_000);

  for (const failAt of ['after-unpack', 'before-switch', 'during-switch'] as const) {
    it(`${AC} a failure injected ${failAt} leaves current a link to the previous version, which still runs`, async () => {
      const home = join(tempDir(), 'deepbuild');
      const k = keys();
      await installed(home, k, '1.0.0');
      const r = release('2.0.0', k.privateKey);
      const why = await rejection((await installer())({ home, ...r, publicKey: k.publicKey, failAt }));
      expect(why, `installVersion with failAt ${failAt} must reject`).not.toBe('<it resolved: nothing was refused>');
      expect(current(home), `after a failure ${failAt}, ${home}/versions/current must still be a link to 1.0.0`).toEqual({ link: true, reaches: join(home, 'versions', '1.0.0') });
      expect(runningVersion(home)).toBe('1.0.0');
      expect(versionFolders(home)).toContain('1.0.0');
    }, 60_000);
  }

  it(`${AC} a failure injected during the switch, with three versions kept, still leaves the newest of them running and all three kept`, async () => {
    const home = join(tempDir(), 'deepbuild');
    const k = keys();
    for (const v of ['1.0.0', '2.0.0', '3.0.0']) await installed(home, k, v);
    const r = release('4.0.0', k.privateKey);
    const why = await rejection((await installer())({ home, ...r, publicKey: k.publicKey, failAt: 'during-switch' }));
    expect(why).not.toBe('<it resolved: nothing was refused>');
    expect(current(home)).toEqual({ link: true, reaches: join(home, 'versions', '3.0.0') });
    expect(runningVersion(home)).toBe('3.0.0');
    for (const v of ['1.0.0', '2.0.0', '3.0.0']) expect(versionFolders(home), `a failed switch must not cost ${v}, one of the three kept for rollback`).toContain(v);
  }, 120_000);

  it(`${AC} the last three versions stay for rollback, each runnable, and older ones go`, async () => {
    const home = join(tempDir(), 'deepbuild');
    const k = keys();
    const versions = ['1.0.0', '2.0.0', '3.0.0', '4.0.0', '5.0.0'];
    for (const [i, v] of versions.entries()) {
      await installed(home, k, v);
      expect(versionFolders(home), `after installing ${v}`).toEqual(versions.slice(Math.max(0, i - 2), i + 1));
      expect(current(home)).toEqual({ link: true, reaches: join(home, 'versions', v) });
    }
    expect(runningVersion(home)).toBe('5.0.0');
    for (const v of ['3.0.0', '4.0.0', '5.0.0']) {
      const r = probe([join(home, 'versions', v, 'bin', 'deep')]);
      expect(r.stdout.trim(), `${v}, kept for rollback, must still run`).toBe(v);
    }
  }, 180_000);
});
