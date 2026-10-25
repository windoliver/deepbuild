// #317 AC7, AC8: ~/.deepbuild/ itself. rules.json can't be removed, truncated, moved over or linked away by a
// shell call with the hub stopped, and the control token's file can't be read, with the hub stopped or up, by the
// Read tool or by cat, cp or base64, directly or through sh -c. Each denial names the command or the file. The
// wrong programs are the defaults with the entries that hold the named call left out. No planted call is run.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildDeepHook, cleanup, defaultRules, expectAllowed, expectDenied, read, rootOf, sh, shForms, without, world,
  type Call, type Mode, type World,
} from './helpers.ts';

beforeAll(async () => { await buildDeepHook(); }, 900_000);
afterEach(cleanup, 60_000);

const RM = 'rm ~/.deepbuild/rules.json';
const REMOVALS = [RM, ': > ~/.deepbuild/rules.json', 'mv rules.new ~/.deepbuild/rules.json', 'ln -sf /dev/null ~/.deepbuild/rules.json'];

describe('AC7 #317.ef09b629 hub stopped: rm, : >, mv over and ln -sf /dev/null onto ~/.deepbuild/rules.json are each denied, naming the command; an Edit/Write-only floor fails', () => {
  it('AC7 each shell write of rules.json is denied, naming the command for you to run', async () => {
    const w = await world({ rules: defaultRules(), mode: 'stopped' });
    await expectDenied(w, REMOVALS.map((c) => sh(c, c)));
  }, 900_000);

  it('AC7 (wrong program) a floor that guards only Edit and Write of the file lets rm through and fails, naming the call', async () => {
    const plant = await without(defaultRules(), sh(RM));
    const w = await world({ rules: plant.rules, mode: 'stopped' });
    await expect(expectDenied(w, REMOVALS.map((c) => sh(c, c)))).rejects.toThrow(`\`${RM}\` with the hub stopped must be denied`);
  }, 900_000);
});

const CAT = 'cat ~/.deepbuild/control.token';
const tokenFile = (home: string) => join(rootOf(home), 'control.token');
/** With the hub stopped, the token's file is still there from the hub's last launch. */
const lastLaunch = (home: string) => {
  mkdirSync(rootOf(home), { recursive: true });
  writeFileSync(tokenFile(home), 'not-a-real-token-317\n', { mode: 0o600 });
  mkdirSync(join(rootOf(home), 'wiki'), { recursive: true });
  writeFileSync(join(rootOf(home), 'wiki', 'index.md'), '# wiki\n');
};
const reads = (first = CAT): Call[] => [
  ...[first, ...[CAT, 'cp ~/.deepbuild/control.token ./t', 'base64 ~/.deepbuild/control.token'].filter((c) => c !== first)]
    .flatMap((c) => shForms(c, ['direct', 'sh -c']))
    .map((c) => ({ ...c, naming: (w: World) => tokenFile(w.home) })),
  { label: 'Read ~/.deepbuild/control.token', body: (w) => read(w.s, tokenFile(w.home)), naming: (w) => tokenFile(w.home) },
];

describe('AC8 #317.632c7ebb hub stopped and up: Read, cat, cp and base64 of ~/.deepbuild/control.token, directly and through sh -c, are each denied, naming the file; a writes-only floor fails', () => {
  it.each(['stopped', 'up'] as Mode[])('AC8 every read of the control token is denied, naming the file, %s; reading the wiki under ~/.deepbuild/ is allowed', async (mode) => {
    const w = await world({ rules: defaultRules(), mode, prep: lastLaunch });
    await expectDenied(w, reads());
    await expectAllowed(w, [
      { label: 'Read ~/.deepbuild/wiki/index.md', body: (x) => read(x.s, join(rootOf(x.home), 'wiki', 'index.md')) },
      sh('cat ~/.deepbuild/wiki/index.md'),
    ]);
  }, 900_000);

  it('AC8 (wrong program) a floor that guards only writes under ~/.deepbuild/ lets the cat through and fails, naming the call', async () => {
    const plant = await without(defaultRules(), sh(CAT), undefined, lastLaunch);
    const w = await world({ rules: plant.rules, mode: 'stopped', prep: lastLaunch });
    await expect(expectDenied(w, reads(CAT))).rejects.toThrow(`\`${CAT}\` with the hub stopped must be denied`);
  }, 900_000);
});
