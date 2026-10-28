// AC9 #19.dfcae9ef An item that didn't run reads "not checked", never OK, and `deep doctor` exits non-zero when
// any item failed.
//
// The item that didn't run is Claude Code's test prompt: `deep doctor` without `--prompt` never sends it, since it
// spends plan usage, so its item must read not checked (`not_checked`, level `skip`), in the JSON and in words, and
// never ok (README: AC9 and AC10, The test-prompt item). The failed item is the `claude` binary's version against
// its facts: the stand-in reports a version Claude Code's facts don't cover, so the binary item fails
// (`version_uncovered`), naming the version, and the doctor exits non-zero.

import { afterAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, doctor, itemText, itemsShown, promptItem, shown, world } from './helpers.ts';

afterAll(cleanup, 60_000);

/** Without --prompt, the prompt item didn't run: it must read not checked, never ok. Throws naming the item otherwise. */
async function notCheckedReads(plant?: string): Promise<void> {
  const w = await world(plant ? { plant } : {});
  const d = await doctor(w.h);
  const item = promptItem(d.items);
  if (!item) expect.fail(`AC9 deep doctor must list Claude Code's test prompt as an item even when it doesn't run it: ${shown(d.ran)}`);
  if (item.code !== 'not_checked' || item.level !== 'skip') {
    expect.fail(`AC9 the item ${item.item} didn't run (no --prompt) and must read not checked (not_checked, skip), never ${item.level} ${item.code}: ${JSON.stringify(item)}`);
  }
  const unrun = d.items.filter((i) => i.code === 'not_checked');
  const wrong = unrun.filter((i) => i.level !== 'skip');
  if (wrong.length) expect.fail(`AC9 an item not checked must never read ${wrong.map((i) => `${i.item}: ${i.level}`).join(', ')}: ${itemsShown(wrong)}`);
  const words = await doctor(w.h, [], { json: false });
  const said = (words.ran.stdout.match(/not checked/gi) ?? []).length;
  if (said < unrun.length) expect.fail(`AC9 deep doctor (for a person) must say "not checked" for each of the ${unrun.length} items not checked (${unrun.map((i) => i.item).join(', ')}); it says it ${said} times: ${shown(words.ran)}`);
}

describe('AC9 #19.dfcae9ef An item that didn\'t run reads "not checked", never OK, and `deep doctor` exits non-zero when any item failed', () => {
  it('AC9 #19.dfcae9ef without --prompt, Claude Code\'s test-prompt item reads not checked (not_checked, skip) in JSON and "not checked" in words, never ok', async () => {
    await notCheckedReads();
  }, 600_000);

  it('AC9 #19.dfcae9ef with the `claude` binary at a version its facts don\'t cover, an item fails naming the version, and deep doctor exits non-zero (1)', async () => {
    const uncovered = '2.0.1';
    const w = await world({ after: (h) => writeFileSync(join(h.bin, 'claude.version'), `${uncovered}\n`) });
    const d = await doctor(w.h);
    const failed = d.items.filter((i) => i.level === 'fail');
    expect(failed.some((i) => itemText(i).includes(uncovered)), `AC9 an item must fail naming the uncovered version ${uncovered}: ${shown(d.ran)}`).toBe(true);
    expect(d.ran.code, `AC9 deep doctor must exit non-zero, 1, with a failed item: ${shown(d.ran)}`).toBe(1);
  }, 600_000);

  it('AC9 #19.dfcae9ef (wrong program) a doctor that shows the test prompt it didn\'t run as ok (skipped-reads-ok) fails the not-checked test, naming the item', async () => {
    await expect(notCheckedReads('skipped-reads-ok')).rejects.toThrow(/AC9 the item \S*prompt\S* didn't run \(no --prompt\) and must read not checked/i);
  }, 600_000);
});
