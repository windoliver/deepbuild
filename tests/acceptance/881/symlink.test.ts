// AC3: two projects whose folders are one real path through a symlink share one trust answer; trusting one trusts
// the other. The two projects are a repo's folder and a symlink to it in another folder. You trust through the link;
// the reader then answers for both, and an extension that comes with each loads and denies. Revoking through the
// real path revokes both. The criterion names no wrong program and the base already keys trust by the real path, so
// this test is regression protection; its planted twin trust-by-given-path (twins.json) keeps a list keyed by the
// folder as given.
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ExtensionHost, Load } from '../../../packages/extension-host/src/index.ts';
import { denier, hookCall, openHost, openWorld, tempDir, YOU, type World } from './helpers.ts';
import { judgeShared, type SharedSeen } from './judges.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });

/** Install, check and load, each refusal kept as what was seen rather than thrown, so a twin's scenario runs through. */
async function tryLoad(h: ExtensionHost, id: string, project: string): Promise<Load | string> {
  try {
    const p = await h.install({ from: denier(id), builtBy: null, grant: { record: ['tool.before'] }, project });
    const checked = await h.check(p);
    if (!checked.passed) return `conformance: ${checked.reasons.join('; ')}`;
    return await h.load(p);
  } catch (e) {
    return (e as Error).message;
  }
}

let scenarios = 0;
async function shareScenario(): Promise<SharedSeen> {
  const { trust } = world;
  const n = ++scenarios;
  const real = tempDir('repo');
  const link = join(tempDir('links'), 'repo');
  symlinkSync(real, link);
  const ids = { real: `acme/real-${n}`, link: `acme/link-${n}` };
  await trust.answer(YOU, link, true);
  const trusted = { real: await trust.trusted(real), link: await trust.trusted(link) };
  const h = await openHost(world);
  const loads = { real: await tryLoad(h, ids.real, real), link: await tryLoad(h, ids.link, link) };
  const trustedCall = (await hookCall(h)).reply;
  await trust.answer(YOU, real, false);
  const revoked = { real: await trust.trusted(real), link: await trust.trusted(link) };
  const revokedCall = (await hookCall(h)).reply;
  return { real, link, trusted, loads, ids, trustedCall, revoked, revokedCall };
}

describe('AC3 #881.23ca93e8 Two projects whose folders are one real path through a symlink share one trust answer; trusting one trusts the other', () => {
  it('AC3 trusting a repo through a symlink trusts its real folder too: both readers\' answers and both projects\' extensions; revoking the real folder revokes both', async () => {
    expect(judgeShared(await shareScenario())).toEqual([]);
  }, 120_000);
});
