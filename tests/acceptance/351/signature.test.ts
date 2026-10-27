// AC6: a package whose envelope names a publisher key and carries a signature that doesn't verify is refused at
// install, naming the key; an update signed by another key than the one trusted on first use is refused until you
// trust the new key on the trusted path.
//
// The envelope names its key as `publisher_key` (package.envelope@1) and carries `signature`, an Ed25519 signature
// of its envelope fields' RFC 8785 bytes (README, The surface under test: the signed envelope). A signature that
// doesn't verify is one made with another key than the one the envelope names. Trust on first use is per package
// id: the key of the first signed install of an id is trusted for it. You trust a new key with
// `host.trustKey(connection, id, key)`, which counts only on the trusted path (the app, writer `app`); an agent's
// call trusts nothing.
import { describe, expect, it } from 'vitest';
import { AGENT, installedAs, installError, keyHex, newKey, openHost, openWorld, signedPkg, YOU } from './helpers.ts';

describe('AC6 #351.838460c6 a package whose envelope names a publisher key with a signature that doesn\'t verify is refused at install naming the key; an update signed by another key than the one trusted on first use is refused until you trust the new key on the trusted path', () => {
  it('AC6 a package naming a publisher key, signed by another key, is refused at install naming the key it names; signed by that key, it installs', async () => {
    const named = newKey();
    const other = newKey();
    const h = await openHost(await openWorld());
    const forged = await signedPkg('plain', { manifest: { id: 'test/forged' }, key: named.key, signer: other.privateKey });
    const refused = await installError(h, forged);
    expect(refused, 'test/forged, whose signature doesn\'t verify against the key its envelope names, is refused at install').not.toBeNull();
    expect(refused, 'the refusal names the key').toContain(keyHex(named.key));
    expect(await installedAs(h), 'test/forged isn\'t installed').not.toContain('test/forged@1.0.0');

    const sound = await signedPkg('plain', { manifest: { id: 'test/signed' }, key: named.key, signer: named.privateKey });
    expect(await installError(h, sound), 'signed by the key it names, the package installs').toBeNull();
    expect(await installedAs(h)).toContain('test/signed@1.0.0');
  }, 120_000);

  it('AC6 an update signed by another key than the one trusted on first use is refused, an agent\'s call doesn\'t trust the new key, and once you trust it on the trusted path the update installs', async () => {
    const first = newKey();
    const next = newKey();
    const h = await openHost(await openWorld());
    const v1 = await signedPkg('plain', { manifest: { id: 'test/tofu', version: '1.0.0' }, key: first.key, signer: first.privateKey });
    expect(await installError(h, v1), 'the first signed install trusts its key on first use').toBeNull();

    const v2 = await signedPkg('plain', { manifest: { id: 'test/tofu', version: '1.1.0' }, key: next.key, signer: next.privateKey });
    expect(await installError(h, v2), 'the update, signed by another key than the one trusted on first use, is refused').not.toBeNull();
    expect(await installedAs(h), 'the version installed stays').toContain('test/tofu@1.0.0');

    await Promise.resolve().then(() => h.trustKey(AGENT, 'test/tofu', next.key)).catch(() => undefined);   // refused or ignored, either way
    expect(await installError(h, v2), 'an agent\'s call is not the trusted path: the update is still refused').not.toBeNull();
    expect(await installedAs(h)).toContain('test/tofu@1.0.0');

    await h.trustKey(YOU, 'test/tofu', next.key);
    expect(await installError(h, v2), 'once you trust the new key on the trusted path, the update installs').toBeNull();
    expect(await installedAs(h)).toContain('test/tofu@1.1.0');
  }, 120_000);
});
