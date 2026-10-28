// AC2: installing a package that conflicts with an installed one is refused, naming the conflict.
//
// A manifest declares what it conflicts with as `conflicts`, a list of package ids (owner/name). `test/beta`
// declares it conflicts with `test/alpha`: installed beside an installed alpha it is refused, the refusal naming
// alpha, and alpha stays installed. On a host where alpha isn't installed the same beta installs, so the refusal is
// the conflict's and not the field's (README, Readings: conflicts).
import { describe, expect, it } from 'vitest';
import { installedIds, installError, openHost, openWorld, pkg } from './helpers.ts';

const ALPHA = 'test/alpha';
const BETA = 'test/beta';
const beta = () => pkg('plain', { manifest: { id: BETA, conflicts: [ALPHA] } });

describe('AC2 #351.83b84661 installing a package that conflicts with an installed one is refused, naming the conflict', () => {
  it('AC2 a package declaring it conflicts with an installed one is refused at install, naming that one, which stays installed; with nothing it conflicts with installed, it installs', async () => {
    const alone = await openHost(await openWorld());
    expect(await installError(alone, await beta()), `${BETA} conflicts with nothing installed on this host, so it installs`).toBeNull();
    expect(await installedIds(alone)).toContain(BETA);

    const h = await openHost(await openWorld());
    await h.install({ from: await pkg('plain', { manifest: { id: ALPHA } }), builtBy: null });
    const refused = await installError(h, await beta());
    expect(refused, `${BETA}, which conflicts with the installed ${ALPHA}, is refused at install`).not.toBeNull();
    expect(refused, `the refusal names the conflict, ${ALPHA}`).toContain(ALPHA);
    const ids = await installedIds(h);
    expect(ids, `${BETA} isn't installed`).not.toContain(BETA);
    expect(ids, `${ALPHA} stays installed`).toContain(ALPHA);
  }, 120_000);
});
