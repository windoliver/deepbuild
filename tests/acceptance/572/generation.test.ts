// #572 AC5 (README, The generation): after `deep restore` of a backup taken at generation 3 onto a record at
// generation 5, the hub reports generation 6 on every connection: to deep-hook (a hook connection), the app and the
// CLI. The record reaches 3 and 5 only through the public surfaces: from a fresh record, each restore of a backup of
// the record itself raises the generation by one, so restores of the record's own backups bring it to 3, a backup is
// taken there, and restores of that backup bring the record to 5.
import { describe, expect, it, afterEach } from 'vitest';
import { backup, backupFolder, cleanup, generationEverywhere, makeHome, restore, startHub, stopHub, type Home, type Hub } from './helpers.ts';

afterEach(cleanup, 60_000);

/**
 * Why a reported generation is wrong after restoring a backup taken at `backupGen` onto a record at `replacedGen`:
 * `deep restore` raises the generation above both, to the larger plus one, so a client that has seen the replaced
 * record's generation can refuse a hub left behind with it.
 */
function expectRaised(got: number, backupGen: number, replacedGen: number): void {
  const want = Math.max(backupGen, replacedGen) + 1;
  const both = backupGen === replacedGen;
  if (got === backupGen && !both) throw Error(`after restoring a backup taken at generation ${backupGen} onto a record at ${replacedGen}, the hub reports ${got}: the restore kept the backup's generation; it must be raised above both, to ${want}, or a client that has seen ${replacedGen} can't tell this hub from one left behind`);
  if (got === replacedGen && !both) throw Error(`after restoring a backup taken at generation ${backupGen} onto a record at ${replacedGen}, the hub reports ${got}: the restore kept the replaced record's generation; it must be raised above both, to ${want}, or a client can't tell this hub from the one the record was replaced on`);
  if (got === backupGen) throw Error(`after restoring a backup taken at generation ${backupGen} onto a record at the same generation, the hub reports ${got}: the restore kept the generation; it must be raised to ${want}`);
  expect(got, `after restoring a backup taken at generation ${backupGen} onto a record at ${replacedGen}, the hub reports the larger plus one on every connection`).toBe(want);
}

describe('AC5 #572.b961a7af after deep restore of a backup taken at generation 3 onto a record at generation 5, the hub reports generation 6 on every connection, to deep-hook, the app and the CLI', () => {
  it('AC5 a generation-3 backup restored onto a generation-5 record: generation 6 on a hook, an app and a cli connection; 3 (the backup\'s kept) and 5 (the replaced record\'s kept) each fail', async () => {
    const h: Home = makeHome();
    let hub: Hub = await startHub(h);
    /** Stops the hub, restores `folder` with the OS confirming you, starts the hub again; the generation it reports. */
    const restoreOnto = async (folder: string): Promise<number> => {
      await stopHub(hub);
      await restore(h, folder);
      hub = await startHub(h);
      return generationEverywhere(hub, h);
    };
    try {
      let gen = await generationEverywhere(hub, h);
      if (gen > 3) throw Error(`a fresh record reports generation ${gen}; the scenario needs a record at or below 3 to take a backup at 3 (README, The generation)`);

      // Restores of the record's own backups, each raising the generation by one, up to 3.
      while (gen < 3) {
        const folder = backupFolder(h, `self-at-${gen}`);
        await backup(h, folder);
        const next = await restoreOnto(folder);
        expectRaised(next, gen, gen);
        gen = next;
      }
      expect(gen, 'the record is at generation 3').toBe(3);
      const atThree = backupFolder(h, 'taken-at-3');
      await backup(h, atThree);

      // Restores of that backup onto the record, up to 5.
      while (gen < 5) {
        const next = await restoreOnto(atThree);
        expectRaised(next, 3, gen);
        gen = next;
      }
      expect(gen, 'the record is at generation 5').toBe(5);

      // The criterion: the generation-3 backup onto the generation-5 record. Reporting 3 means the restore kept the
      // backup's generation; reporting 5 means it kept the replaced record's: expectRaised fails each, saying which.
      const final = await restoreOnto(atThree);
      expectRaised(final, 3, 5);
      expect(final, 'the hub reports generation 6 to deep-hook, the app and the CLI').toBe(6);
    } finally {
      await stopHub(hub);
    }
  }, 900_000);
});
