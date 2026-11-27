// #3459 criterion 7 (README, The generation): after a restore of the kept folder, the hub reports a generation above
// the backup's (the kept folder's own: that of the record the first restore replaced) and above that of the record the
// second restore replaced, on every connection: to deep-hook (a hook connection), the app and the CLI.
import { afterAll, expect, test } from 'vitest';
import { LACKING, cleanup, generationEverywhere, generations, keptNamedBy, makeScene, named, restore, shown, startHub, stopHub } from './helpers.ts';

afterAll(cleanup, 120_000);

test('#3459.4a7ca7c9 after a restore of the kept folder, the hub reports a generation above the backup\'s and above that of the record it replaced, on every connection', async () => {
  const s = await makeScene();
  const { h } = s;
  // The kept folder will hold the record as it was before the first restore, at the generation its hub reported.
  const keptGeneration = s.generationAtBackup;
  const first = await restore(h, s.folder);
  expect(first.code, `the first \`deep restore ${s.folder}\` must exit 0: ${shown(first)}`).toBe(0);
  const kept = keptNamedBy(first, h, s.folder);
  expect(kept, `the restore's last line names no kept folder under ${h.root} and no command that puts it back, so no restore of a kept folder can raise the generation: nothing was kept of the ${LACKING} events the backup lacks, the first ${named(s.lacking[0]!)}. The last line: ${JSON.stringify(first.stdout.trim().split('\n').pop())}`).toBeDefined();

  // The record the restore of the kept folder replaces: the restored backup, at the generation its hub reports.
  let hub = await startHub(h);
  let replacedGeneration: number;
  try {
    replacedGeneration = await generationEverywhere(hub, h);
  } finally {
    await stopHub(hub);
  }
  expect(replacedGeneration, `the first restore raised the generation above the record's ${keptGeneration} (#572)`).toBeGreaterThan(keptGeneration);

  const back = await restore(h, kept!);
  expect(back.code, `\`deep restore ${kept}\` must exit 0: ${shown(back)}`).toBe(0);
  hub = await startHub(h);
  try {
    const seen = await generations(hub, h);
    for (const [role, generation] of Object.entries(seen)) {
      const told = `after \`deep restore ${kept}\`, a kept folder at generation ${keptGeneration}, onto a record at generation ${replacedGeneration}, the hub reports ${JSON.stringify(generation)} on a ${role} connection`;
      expect(Number.isSafeInteger(generation), `${told}: an integer generation`).toBe(true);
      expect(generation as number, `${told}: above the kept folder's ${keptGeneration}`).toBeGreaterThan(keptGeneration);
      expect(generation as number, `${told}: above ${replacedGeneration}, that of the record it replaced, or a client that has seen ${replacedGeneration} can't tell this hub from one left behind`).toBeGreaterThan(replacedGeneration);
    }
    expect(new Set(Object.values(seen)).size, `the hub reports one generation on every connection: ${JSON.stringify(seen)}`).toBe(1);
  } finally {
    await stopHub(hub);
  }
}, 900_000);
