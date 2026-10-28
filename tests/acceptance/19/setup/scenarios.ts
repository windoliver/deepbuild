// Scenarios shared by more than one test file: AC5's setup-then-undo, which AC14's wrong program must pass.

import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { expect } from 'vitest';
import {
  deepEntries, firstDifference, forwarderInstalled, installedHub, makeHome, onMac, readSettings, seedYours, settingsFile, setup, shown, undo, type Ran,
} from './helpers.ts';

/** Your files, setup, then a confirmed undo; throws naming the first file that isn't as it was. */
export async function setupThenUndo(env: Record<string, string | undefined> = {}): Promise<{ home: string; undone: Ran }> {
  onMac();
  const { home } = makeHome();
  const yours = seedYours(home);
  await setup(home, { env });
  await installedHub(home);
  // The control: setup did write your settings, so putting them back is something to test.
  const installed = readSettings(home);
  if (!deepEntries(installed).length || !forwarderInstalled(installed)) {
    expect.fail(`deep setup must add DeepBuild's hook entries and its status line forwarder to ${settingsFile(home)} (the control): ${JSON.stringify(installed).slice(0, 1500)}`);
  }
  const undone = await undo(home, { env });
  expect(undone.code, `AC5 deep setup --undo, confirmed, must exit 0: ${shown(undone)}`).toBe(0);
  for (const [path, was] of yours) {
    if (!existsSync(path)) expect.fail(`AC5 deep setup --undo must leave ${path} byte-for-byte as it was before setup; it is gone`);
    if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) expect.fail(`AC5 deep setup --undo must leave ${path} the plain file it was`);
    const now = readFileSync(path);
    if (!now.equals(was)) expect.fail(`AC5 deep setup --undo must leave ${path} byte-for-byte as it was before setup: ${firstDifference(was, now)}`);
  }
  return { home, undone };
}
