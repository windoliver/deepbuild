// AC2: an untrusted project's extension never loads. AC3: revoking trust in a repo with one answer stops its
// extensions loading, and two test pieces standing in for the done gate and spec drafting, each reading the one
// trust decision, stop running the repo's commands; a planted piece that keeps its own trust list still runs them
// and fails this test, naming the piece.
//
// Project trust is one decision the core holds in the record (README, The surface under test: `openTrust`). Your
// answer comes through the trusted path (the app's card, connection writer `app`). The host and every piece read it
// through readers of their own, opened on the same record, so what one answer sets, every reader sees: there is one
// decision, not a list per reader. A project's extension is the probe package installed with `project` naming the
// repo's folder.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openTrust, type ExtensionHost, type Installed } from '../../../packages/extension-host/src/index.ts';
import { copyFixture, openHost, openWorld, pkg, YOU, type World } from './helpers.ts';
import { ownTrustList, standIn, type Piece } from './wrong.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

/** The repo's extension: the probe under an owner of its own per repo, so no two repos share an installed package. */
let owners = 0;
async function projectExtension(h: ExtensionHost, repo: string): Promise<Installed> {
  return h.install({ from: await pkg('probe', { manifest: { id: `repo${++owners}/probe` } }), builtBy: null, project: repo });
}
/** Its checks, where the host runs them for a project you haven't trusted; a refusal there is the host's choice. */
async function checkIfAllowed(h: ExtensionHost, p: Installed): Promise<void> {
  try { await h.check(p); } catch { /* a host may refuse to run an untrusted project's code at all */ }
}

describe('AC2 #348.fee14bf1 an untrusted project\'s extension never loads', () => {
  it('AC2 a project with no trust decision: its extension is refused, naming trust, and nothing of it is in use', async () => {
    const h = await openHost(world);
    await h.ready();
    const repo = copyFixture('repo');
    expect(await world.trust.trusted(repo), 'no decision means not trusted').toBe(false);
    const p = await projectExtension(h, repo);
    await checkIfAllowed(h, p);
    const load = await h.load(p);
    expect(load.status, `an untrusted project's extension loaded: ${JSON.stringify(load)}`).toBe('refused');
    expect(load.status === 'refused' ? load.reason : '').toMatch(/trust/i);
    expect((await h.loaded()).map((l) => l.id)).not.toContain(p.id);
    expect(await h.checks()).toEqual([]);
    await h.close();
  }, 60_000);

  it('AC2 a project you answered "don\'t trust": its extension is refused; the same package loads once you trust the project', async () => {
    const h = await openHost(world);
    await h.ready();
    const repo = copyFixture('repo');
    await world.trust.answer(YOU, repo, false);
    const p = await projectExtension(h, repo);
    await checkIfAllowed(h, p);
    const load = await h.load(p);
    expect(load.status, JSON.stringify(load)).toBe('refused');
    expect(load.status === 'refused' ? load.reason : '').toMatch(/trust/i);
    // Control: the refusal was the project's trust, not the package.
    await world.trust.answer(YOU, repo, true);
    expect((await h.check(p)).passed).toBe(true);
    const trusted = await h.load(p);
    expect(trusted.status, JSON.stringify(trusted)).toBe('loaded');
    await h.close();
  }, 60_000);
});

/** The criterion's assertion on a piece after the revoke: it doesn't run the repo's commands, or the failure names it. */
async function stopsRunning(piece: Piece, repo: string): Promise<void> {
  const ran = await piece.run(repo);
  expect(ran, `${piece.name} still ran the repo's commands after trust in the repo was revoked`).toBe(false);
}

describe('AC3 #348.96fd10c8 revoking trust with one answer stops the repo\'s extensions loading and stops the stand-ins for the done gate and spec drafting running its commands; a piece with its own trust list fails, named', () => {
  /** A trusted repo with its extension loaded and every piece having run its command once. */
  async function trustedRepo(): Promise<{ repo: string; p: Installed; pieces: Piece[]; planted: Piece }> {
    const repo = copyFixture('repo');
    await world.trust.answer(YOU, repo, true);
    const h = await openHost(world);
    await h.ready();
    const p = await projectExtension(h, repo);
    expect((await h.check(p)).passed).toBe(true);
    expect((await h.load(p)).status, 'the trusted repo\'s extension loads').toBe('loaded');
    await h.close();
    // Each piece reads the decision through a reader of its own on the same record.
    const pieces = [standIn('done-gate', await openTrust({ record: world.record, now: Date.now })), standIn('spec-draft', await openTrust({ record: world.record, now: Date.now }))];
    const planted = ownTrustList('own-trust-list', await openTrust({ record: world.record, now: Date.now }));
    for (const piece of [...pieces, planted]) expect(await piece.run(repo), `${piece.name} runs the trusted repo's command`).toBe(true);
    return { repo, p, pieces, planted };
  }

  it('AC3 one answer revoking trust: the repo\'s extension no longer loads, and the done-gate and spec-draft stand-ins stop running its commands', async () => {
    const { repo, p, pieces } = await trustedRepo();
    await world.trust.answer(YOU, repo, false);
    const h = await openHost(world);
    await h.ready();
    const load = await h.load(p);
    expect(load.status, `the repo's extension loaded after trust was revoked: ${JSON.stringify(load)}`).toBe('refused');
    expect(load.status === 'refused' ? load.reason : '').toMatch(/trust/i);
    await h.close();
    for (const piece of pieces) await stopsRunning(piece, repo);
  }, 120_000);

  it('AC3 the decision is the core\'s, one per repo: a reader opened afterwards sees the revoke, and another repo\'s trust is untouched', async () => {
    const { repo } = await trustedRepo();
    const other = copyFixture('repo');
    await world.trust.answer(YOU, other, true);
    await world.trust.answer(YOU, repo, false);
    const later = await openTrust({ record: world.record, now: Date.now });
    expect(await later.trusted(repo)).toBe(false);
    expect(await later.trusted(other)).toBe(true);
  }, 120_000);

  it('AC3 (wrong program) a planted piece that keeps its own trust list still runs the repo\'s commands after the revoke and fails this test, naming the piece', async () => {
    const { repo, planted } = await trustedRepo();
    await world.trust.answer(YOU, repo, false);
    await expect(stopsRunning(planted, repo)).rejects.toThrow(/own-trust-list/);
  }, 120_000);
});
