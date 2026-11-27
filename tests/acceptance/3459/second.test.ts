// #3459 criterion 5 (README, The second restore): there is one kept folder, and a later restore replaces it. Before the
// OS asks, the second restore says that it replaces the folder kept from the first, by its day: the sentence the OS
// shows names that day once more than the same restore's sentence does with the kept folder taken out of the root.
// A second restore that replaces it unsaid fails, naming the folder. The OS stand-in cancels both asks, so the kept
// folder is still there, whole, at the end.
import { renameSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { LACKING, askedBy, cleanup, dayCount, dayOf, keptNamedBy, keptProblems, makeScene, named, restore, shown } from './helpers.ts';

afterAll(cleanup, 120_000);

test('#3459.e4e3976d a second restore says, before the OS asks, that it replaces the folder kept from the first, by its day', async () => {
  const s = await makeScene();
  const { h } = s;
  const before = new Date();
  const first = await restore(h, s.folder);
  const after = new Date();
  expect(first.code, `the first \`deep restore ${s.folder}\` must exit 0: ${shown(first)}`).toBe(0);
  const kept = keptNamedBy(first, h, s.folder);
  expect(kept, `the first restore's last line names no kept folder under ${h.root}, so a second restore has nothing to say it replaces: the first kept nothing of the ${LACKING} events the backup lacks, the first ${named(s.lacking[0]!)}. The last line: ${JSON.stringify(first.stdout.trim().split('\n').pop())}`).toBeDefined();

  // The second restore, of the same backup, with the kept folder there: the sentence the OS is shown before it answers.
  const withKept = await askedBy(h, s.folder);
  expect(withKept.asks, `the second \`deep restore ${s.folder}\` asks the OS to confirm you once: ${shown(withKept.ran)}`).toBe(1);
  // The same restore with the kept folder taken out of the root (removing it is yours), then put back as it was.
  const away = join(h.tmp, 'kept-taken-out');
  renameSync(kept!, away);
  let without: Awaited<ReturnType<typeof askedBy>>;
  try {
    without = await askedBy(h, s.folder);
  } finally {
    renameSync(away, kept!);
  }
  expect(without.asks, `\`deep restore ${s.folder}\` with no kept folder asks the OS to confirm you once: ${shown(without.ran)}`).toBe(1);

  // The kept folder was made between `before` and `after`: its day is either's (they differ only across midnight UTC).
  const days = [...new Set([dayOf(before), dayOf(after)])];
  const more = [before, after].some((day) => dayCount(withKept.sentence!, day) > dayCount(without.sentence!, day));
  expect(withKept.sentence === without.sentence ? `the second restore would replace the kept folder ${kept} unsaid: its sentence is the one shown when no folder is kept, ${JSON.stringify(withKept.sentence)}` : undefined, `the second restore's sentence says it replaces the kept folder ${kept}`).toBeUndefined();
  expect(more, `the second restore's sentence says it replaces the kept folder ${kept} by its day (${days.join(' or ')}): it names that day no more often than the sentence shown when no folder is kept. With the kept folder: ${JSON.stringify(withKept.sentence)}; without: ${JSON.stringify(without.sentence)}`).toBe(true);
  expect(keptProblems(kept!, s.files), `both prompts were cancelled, so the kept folder ${kept} is as the first restore left it`).toEqual([]);
}, 900_000);
