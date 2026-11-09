// AC5 #1338.4e201b52: "A credential copied to a machine without its key is refused, naming the proof."
//
// bob's machine and carol's both join acme/shop, each with a key of its own under ~/.deepbuild/keys/. bob reads the
// project (the control). Then carol's machine is given everything bob's ~/.deepbuild holds except his keys, and
// nothing of her own but her key: bob's credential on a machine without bob's key. Its read must be refused (a
// nonzero exit, none of the project's data), and what it says must name the proof.
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, copyWithoutKeys, joined, mayaWorks, readOn, shown, SURFACE, world } from './helpers.ts';

afterAll(cleanup, 60_000);

describe('AC5 #1338.4e201b52 a credential copied to a machine without its key is refused, naming the proof', () => {
  it('AC5 #1338.4e201b52 bob\'s credential copied to carol\'s machine, without bob\'s key, is refused there, naming the proof', async () => {
    const w = await world();
    const bob = await joined(w, 'bob');
    const carol = await joined(w, 'carol');
    const { session } = await mayaWorks(w);
    const prefix = session.id.slice(0, 8);

    const own = await readOn(bob);
    expect(own.code, `bob's machine reads the project: ${shown(own)}`).toBe(0);
    expect(own.stdout, `bob's read lists maya's session ${prefix}: ${shown(own)}`).toContain(prefix);

    copyWithoutKeys(bob, carol);
    const copied = await readOn(carol);
    expect(copied.stdout.includes(prefix), `bob's credential, copied without his key, read the project: ${shown(copied)}`).toBe(false);
    expect(copied.code, `bob's credential, copied without his key, must be refused (a nonzero exit): ${shown(copied)}`).not.toBe(0);
    expect(SURFACE.proof.test(`${copied.stdout}\n${copied.stderr}`), `the refusal must name the proof: ${shown(copied)}`).toBe(true);
  }, 600_000);
});
