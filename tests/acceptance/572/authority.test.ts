// #572 AC3 (README): an agent's `deep restore`, directly and through `sh -c`, is denied by deep-hook's floor with the
// hub up and down, naming the command for you to run; your own `deep restore` changes nothing until the OS confirms
// you. The OS confirmation is DEEP_HUB_TEST_CONFIRM's stub (#24's seam): a file reading `confirmed` or `cancelled`, or
// a program standing for the prompt that logs each ask. No agent call is ever run: deep-hook only decides.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SECOND, appendLoad, asked, backup, backupFolder, bashCall, buildDeepHook, cleanup, confirmByProgram, confirmWith, decision, deep,
  filesOf, hook, idsIn, installDefaultRules, makeHome, names, newSession, pasteEvidence, projectionsIn, shown, startHub, stopHub,
  waitFor, type Home,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const FOLDER = '~/backups/deep-2026-10-28';
const RESTORE = `deep restore ${FOLDER}`;

describe('AC3 #572.5cfb15dd an agent\'s deep restore, directly and through sh -c, is denied with the hub up and down, naming the command for you to run, and yours changes nothing until the OS confirms you', () => {
  it.each(['stopped', 'up'] as const)('AC3 the agent\'s `deep restore <folder>` is denied directly and through sh -c with the hub %s, naming the command for you to run', async (mode) => {
    await buildDeepHook();
    const h = makeHome();
    installDefaultRules(h);
    const hub = mode === 'up' ? await startHub(h) : undefined;
    try {
      const s = newSession(h);
      for (const command of [RESTORE, `sh -c '${RESTORE}'`]) {
        const r = await hook(h, s, bashCall(s, command));
        expect(decision(r), `\`${command}\` from an agent with the hub ${mode} must be denied: ${shown(r)}`).toBe('deny');
        expect(names(r, RESTORE, h.home), `the denial of \`${command}\` with the hub ${mode} names \`${RESTORE}\` for you to run: ${shown(r)}`).toBe(true);
      }
    } finally {
      if (hub) await stopHub(hub);
    }
  }, 900_000);

  it('AC3 your `deep restore <folder>` with the hub stopped asks the OS, and changes nothing while the OS hasn\'t confirmed you (prompt cancelled, stub cancelled); once it does, the backup is back', async () => {
    const h = makeHome();
    mkdirSync(join(h.root, 'wiki'), { recursive: true });
    writeFileSync(join(h.root, 'wiki', 'page.md'), 'as at the backup\n');
    const hub = await startHub(h);
    await pasteEvidence(hub, 2);
    const load = appendLoad(h, hub, 3);
    await waitFor(() => load.acked() >= 30, 60 * SECOND, '30 acknowledged hook requests');
    await load.stop();
    const folder = backupFolder(h, 'yours');
    await backup(h, folder);
    // The record moves on after the backup, so a restore that took effect would show.
    const more = appendLoad(h, hub, 3);
    await waitFor(() => more.acked() >= 30, 60 * SECOND, '30 more hook requests');
    await more.stop();
    writeFileSync(join(h.root, 'wiki', 'page.md'), 'edited after the backup\n');
    await stopHub(hub);

    /** What a restore would change: the record's events and projections, the evidence store and the wiki. */
    const state = (h: Home) => JSON.stringify({
      events: [...idsIn(h.root)].sort(),
      projections: [...projectionsIn(h.root)],
      evidence: [...filesOf(join(h.root, 'evidence'))].sort(),
      wiki: [...filesOf(join(h.root, 'wiki'))].sort(),
    });
    const before = state(h);
    const atBackup = idsIn(folder);
    const afterBackup = [...idsIn(h.root)].filter((id) => !atBackup.has(id));
    expect(afterBackup.length, 'the record holds events the backup doesn\'t').toBeGreaterThan(0);

    // The prompt cancelled: the OS was asked, and nothing changed.
    confirmByProgram(h, 1);
    const cancelled = await deep(h, ['restore', folder]);
    expect(asked(h).length, `\`deep restore\` asked the OS to confirm you once before doing anything: ${shown(cancelled)}`).toBe(1);
    expect(cancelled.code, `\`deep restore\` with the prompt cancelled must not succeed: ${shown(cancelled)}`).not.toBe(0);
    expect(state(h), 'with the prompt cancelled, the restore changed nothing').toBe(before);

    // The stub's file saying cancelled: nothing changed.
    confirmWith(h, 'cancelled');
    const refused = await deep(h, ['restore', folder]);
    expect(refused.code, `\`deep restore\` unconfirmed must not succeed: ${shown(refused)}`).not.toBe(0);
    expect(state(h), 'unconfirmed, the restore changed nothing').toBe(before);

    // Once the OS confirms you, it takes effect.
    confirmByProgram(h, 0);
    const done = await deep(h, ['restore', folder]);
    expect(done.code, `\`deep restore\` once the OS confirmed you must exit 0: ${shown(done)}`).toBe(0);
    expect(asked(h).length, 'the confirmed restore asked the OS too').toBe(2);
    const now = idsIn(h.root);
    expect([...atBackup].filter((id) => !now.has(id)), 'the confirmed restore put back every event of the backup').toEqual([]);
    expect(afterBackup.filter((id) => now.has(id)), 'the confirmed restore replaced the record').toEqual([]);
    expect(readFileSync(join(h.root, 'wiki', 'page.md'), 'utf8'), 'the confirmed restore put the wiki back').toBe('as at the backup\n');
  }, 900_000);
});
