// #3459 criterion 6 (README, Authority): an agent's `deep restore` of the kept folder is denied as any restore is, by
// deep-hook's floor, directly and through `sh -c`, naming the command for you to run; and your own `deep restore` of
// the kept folder changes nothing until the OS confirms you. The OS is DEEP_HUB_TEST_CONFIRM's stand-in as a program.
// No agent call is ever run: deep-hook only decides.
import { existsSync } from 'node:fs';
import { afterAll, expect, test } from 'vitest';
import {
  DEEP_HOOK, LACKING, asked, cleanup, decision, deep, eventsIn, hookOnBash, installDefaultRules, keptNamedBy, makeScene, named, names, newSession,
  osAnswers, recordFiles, restore, shown, type Home,
} from './helpers.ts';

afterAll(cleanup, 120_000);

test('#3459.b8f5554f an agent\'s deep restore of the kept folder is denied as any restore is, and yours changes nothing until the OS confirms you', async () => {
  if (!existsSync(DEEP_HOOK)) throw Error('BLOCKED: no deep-hook binary (cargo build -p deep-hook, or DEEP_BIN_DIR)');
  const s = await makeScene();
  const { h } = s;
  installDefaultRules(h);
  const first = await restore(h, s.folder);
  expect(first.code, `the first \`deep restore ${s.folder}\` must exit 0: ${shown(first)}`).toBe(0);
  const kept = keptNamedBy(first, h, s.folder);
  expect(kept, `the restore's last line names no kept folder under ${h.root} and no command that puts it back, so there is no kept folder for an agent or for you to restore: nothing was kept of the ${LACKING} events the backup lacks, the first ${named(s.lacking[0]!)}. The last line: ${JSON.stringify(first.stdout.trim().split('\n').pop())}`).toBeDefined();
  const command = `deep restore ${kept}`;

  // The agent's call, directly and through sh -c, with the hub stopped: denied, naming the command for you to run.
  const session = newSession(h);
  for (const call of [command, `sh -c '${command}'`]) {
    const r = await hookOnBash(h, session, call);
    expect(decision(r), `\`${call}\` from an agent must be denied: ${shown(r)}`).toBe('deny');
    expect(names(r, command), `the denial of \`${call}\` names \`${command}\` for you to run: ${shown(r)}`).toBe(true);
  }

  /** What a restore of the kept folder would change: the record's events, its files and the kept folder's, by hash and inode. */
  const state = (at: Home) => JSON.stringify({ events: eventsIn(at.root).map((e) => e.id), record: [...recordFiles(at.root)].sort(), kept: [...recordFiles(kept!)].sort() });
  const before = state(h);

  // Yours, with the prompt cancelled: the OS was asked once, and nothing changed.
  osAnswers(h, 'cancels');
  const asks = asked(h).length;
  const cancelled = await deep(h, ['restore', kept!]);
  expect(asked(h).length - asks, `\`${command}\` asked the OS to confirm you once before doing anything: ${shown(cancelled)}`).toBe(1);
  expect(cancelled.code, `\`${command}\` with the prompt cancelled must not succeed: ${shown(cancelled)}`).not.toBe(0);
  expect(state(h), `with the prompt cancelled, \`${command}\` changed nothing: the record, its evidence and wiki and the kept folder are as they were`).toBe(before);

  // Once the OS confirms you, it takes effect: the replaced record is back.
  const done = await restore(h, kept!);
  expect(done.code, `\`${command}\` once the OS confirmed you must exit 0: ${shown(done)}`).toBe(0);
  expect(asked(h).length - asks, 'the confirmed restore asked the OS too').toBe(2);
  const now = new Set(eventsIn(h.root).map((e) => e.id));
  const lost = s.lacking.find((e) => !now.has(e.id));
  expect(lost && `after the confirmed \`${command}\` the record lacks ${named(lost)}`, `the confirmed restore of the kept folder put back the ${LACKING} events`).toBeUndefined();
}, 900_000);
