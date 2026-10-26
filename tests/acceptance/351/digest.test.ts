// AC5: a package whose envelope digest doesn't match its files is refused at install, naming the package; an
// installer that trusts the envelope's digest without hashing the files installs it and fails this test.
//
// The envelope digest is deepbuild.json's `digest` (package.envelope@1); the files' digest is `packageDigest` of
// the folder (#348). A package is stamped, then one of its files changes, as a package altered after its build
// would be. The planted twin is the host's `plant: 'trusts-envelope-digest'`: it takes the envelope's digest as the
// package's digest without hashing the files, so the package it installs carries the envelope's digest.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import { envelopeDigest, host, installedIds, installError, openHost, openWorld, pkg } from './helpers.ts';

/** A stamped package whose index.ts changed after its digest was written. */
async function altered(id: string): Promise<string> {
  const dir = await pkg('plain', { manifest: { id } });
  appendFileSync(join(dir, 'index.ts'), '\n// changed after its build\n');
  const { packageDigest } = await host();
  expect(packageDigest(dir), 'the files no longer match the envelope').not.toBe(envelopeDigest(dir));
  return dir;
}
/** The criterion's assertion: refused at install, naming the package, and not installed. */
async function refusedNamingThePackage(h: ExtensionHost, dir: string, id: string): Promise<void> {
  const refused = await installError(h, dir);
  expect(refused, `${id}, whose envelope digest doesn't match its files, is refused at install`).not.toBeNull();
  expect(refused, `the refusal names the package ${id}`).toContain(id);
  expect(await installedIds(h), `${id} isn't installed`).not.toContain(id);
}

describe('AC5 #351.86308453 a package whose envelope digest doesn\'t match its files is refused at install, naming the package; an installer trusting the envelope\'s digest without hashing the files installs it and fails this test', () => {
  it('AC5 a package whose files changed after its envelope digest was written is refused at install, naming it; a package whose digest matches installs with that digest', async () => {
    const h = await openHost(await openWorld());
    await refusedNamingThePackage(h, await altered('test/altered'), 'test/altered');

    const sound = await pkg('plain', { manifest: { id: 'test/sound' } });
    const installed = await h.install({ from: sound, builtBy: null });
    expect(installed.digest, 'the package whose envelope digest matches its files installs, with that digest').toBe(envelopeDigest(sound));
  }, 120_000);

  it('AC5 (wrong program) an installer that trusts the envelope\'s digest without hashing the files installs the altered package, carrying the envelope\'s digest, and fails this test', async () => {
    const h = await openHost(await openWorld(), { plant: 'trusts-envelope-digest' });
    const dir = await altered('test/altered-twin');
    await expect(refusedNamingThePackage(h, dir, 'test/altered-twin')).rejects.toThrow('test/altered-twin');
    const row = (await h.installed()).find((p) => p.id === 'test/altered-twin');
    expect(row?.digest, 'the planted installer took the envelope\'s digest as the package\'s, without hashing its files').toBe(envelopeDigest(dir));
  }, 120_000);
});
