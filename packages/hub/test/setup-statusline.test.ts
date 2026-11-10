// A second `deep setup` after deep-hook moved (#19, #41): the forwarder an earlier setup wrote is DeepBuild's own, so
// your status line stays the one that runs behind it.
import { mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { MY_STATUS_LINE, REPO, cleanup, makeHome, onMac, readSettings, rootOf, seedYours, setup } from '../../../tests/acceptance/19/setup/helpers.ts';

afterAll(cleanup, 60_000);

it('a second setup after deep-hook moved keeps your status line as yours', async () => {
  onMac();
  const { home } = makeHome();
  seedYours(home);
  await setup(home);
  const yours = () => (JSON.parse(readFileSync(join(rootOf(home), 'config.json'), 'utf8')) as { statusline?: { yours?: string } }).statusline?.yours;
  expect(yours(), 'the first setup keeps your command').toBe(MY_STATUS_LINE.command);
  // An installed version's programs take the place of the checkout's build.
  const bin = join(rootOf(home), 'versions', 'current', 'bin');
  mkdirSync(bin, { recursive: true });
  symlinkSync(join(REPO, 'target/debug/deep-hook'), join(bin, 'deep-hook'));
  await setup(home);
  expect(String(readSettings(home).statusLine?.command), 'the forwarder runs the moved deep-hook').toContain(join(bin, 'deep-hook'));
  expect(yours(), 'and your command is still the one behind it').toBe(MY_STATUS_LINE.command);
}, 600_000);
