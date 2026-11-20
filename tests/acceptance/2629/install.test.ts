// AC1, as a user meets it: a package stamped on a umask 022 checkout (644) and installed from a umask 002 copy (664)
// isn't refused with "envelope digest … isn't its files' digest". The installer is the extension host's
// (`ExtensionHost.install`, what `deep install <folder>` runs), on a world of a real record, asks core and supervisor,
// reached through #351's suite's helpers; the package is that suite's `plain` fixture, stamped by `packageDigest`.
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { envelopeDigest, installError, installedIds, openHost, openWorld, pkg, stamp } from '../351/helpers.ts';
import { AC, setModes, UMASK_002, UMASK_022, type Entry } from './helpers.ts';

describe(`${AC[1]} a package stamped at 644 installs from a 664 copy`, () => {
  it(`${AC[1]} the installer takes a package stamped under umask 022 when its files are 664, as a umask 002 checkout leaves them, with the stamped digest`, async () => {
    const id = 'test/umask-install';
    const dir = await pkg('plain', { manifest: { id } });
    const entries: Entry[] = readdirSync(dir).map((path) => ({ path, executable: false }));
    setModes(dir, entries, UMASK_022);
    const digest = await stamp(dir);
    setModes(dir, entries, UMASK_002);

    const h = await openHost(await openWorld());
    const refused = await installError(h, dir);
    expect(refused, `${id}, stamped at 644 and installed from 664 files, isn't refused at install`).toBeNull();
    expect(await installedIds(h), `${id} is installed`).toContain(id);
    const row = (await h.installed()).find((p) => p.id === id);
    expect(row?.digest, 'it is installed with the digest stamped at 644').toBe(digest);
    expect(envelopeDigest(dir), 'its envelope still carries that digest').toBe(digest);
  }, 120_000);
});
