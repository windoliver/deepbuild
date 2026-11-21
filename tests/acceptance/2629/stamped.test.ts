// AC3: digests already stamped in the repo still match their packages on a umask 022 checkout.
//
// The packages: every committed deepbuild.json carrying a real digest (not the all-zero placeholder test fixtures
// carry until a test stamps them, and not the partial overlays under tests/acceptance/*/twins/) whose digest matched
// its files at the base, eb027b613 (README: Readings). Each is taken from HEAD with git archive and chmod-ed 644/755
// as git records it, as a umask 022 checkout gives it.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, checkout, DIGEST, packageDigest, stamped, UMASK_022 } from './helpers.ts';

const STAMPED = [
  'contracts/fixtures/R1',
  'docs/evidence/366/stocks/claude-code/package',
  'docs/evidence/366/stocks/codex/package',
  'docs/extension-guide/json-rpc',
  'docs/extension-guide/typescript',
  'packages/channels/chat',
  'packages/channels/email',
  'packages/channels/paseo',
  'packages/channels/text',
  'packages/checks/playtest',
  'packages/jobs/bakes',
  'packages/jobs/encode',
  'packages/jobs/foley',
  'packages/jobs/import',
  'packages/jobs/score',
  'packages/jobs/speech',
  'packages/jobs/typeset',
  'packages/sources/gmail',
  'packages/sources/linear',
];

describe(`${AC[3]} digests already stamped in the repo still match their packages on a umask 022 checkout`, () => {
  it(`${AC[3]} each stamped package, its files at 644/755 as git records them, gives the digest its deepbuild.json carries`, async () => {
    const { root, entries } = checkout(STAMPED, UMASK_022);
    expect([...entries.values()].flat().some((e) => e.executable), 'some stamped package holds a file git records 755').toBe(true);
    const wrong: string[] = [];
    for (const dir of STAMPED) {
      const want = stamped(join(root, dir));
      expect(want, `${dir}'s deepbuild.json carries a stamped digest`).toMatch(DIGEST);
      const got = await packageDigest(join(root, dir));
      if (got !== want) wrong.push(`${dir}: stamped ${String(want)}, its files' digest ${String(got)}`);
    }
    expect(wrong, 'every stamped digest matches its package').toEqual([]);
  }, 120_000);
});
