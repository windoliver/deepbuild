// #572 AC1 and AC2 (README): `deep backup` while 30 scripted sessions append gives a copy that passes PRAGMA
// integrity_check and holds every event committed before the backup began; a plain copy of ledger.db taken while a
// commit lands, staged by the test VFS, fails that check, naming the commit; `deep restore` of the copy rebuilds every
// projection equal to the backup's, and each claim open at the copy is INVALID, cause events lost.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  SECOND, SESSIONS, allEvents, appendLoad, backupFolder, bare, cleanup, control, copyProblems, deep, filesOf, idsIn, makeHome,
  missingFiles, pasteEvidence, projectionDifferences, projectionsIn, restore, seedClaims, shown, sleep, startHub, stopHub,
  tempDir, waitFor, type Ev, type Home, type Hub, type Ran, type Seeded,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const WIKI_PAGE = 'backups-572.md';
const WIKI_AT_BACKUP = '# Backups\n\nThe page as it was when the backup was taken.\n';
const WIKI_AFTER = '# Backups\n\nThe page as edited after the backup: a restore puts the backup\'s version back.\n';
/** How many acknowledged hook requests the load makes before the backup begins. */
const WARM = 300;

interface Scene {
  h: Home;
  hub: Hub;
  seeded: Seeded;
  /** Every event events.read served just before `deep backup` was started: committed before the backup began. */
  before: Ev[];
  folder: string;
  ran: Ran;
  /** Hook requests the hub acknowledged while `deep backup` ran. */
  ackedDuring: number;
  failures: string[];
  evidenceAtBackup: Map<string, string>;
  wikiAtBackup: Map<string, string>;
}

/** AC1's scenario, which AC2 restores: made once, by the first test that needs it. */
let made: Promise<Scene> | undefined;
const scene = () => (made ??= (async (): Promise<Scene> => {
  const h = makeHome();
  const seeded = await seedClaims(h);
  mkdirSync(join(h.root, 'wiki'), { recursive: true });
  writeFileSync(join(h.root, 'wiki', WIKI_PAGE), WIKI_AT_BACKUP);
  const hub = await startHub(h);
  await pasteEvidence(hub, 1);
  const cli = await control(hub);
  const load = appendLoad(h, hub);
  try {
    await waitFor(() => load.acked() >= WARM, 120 * SECOND, `${WARM} acknowledged hook requests from ${SESSIONS} sessions`);
    // Read back until the warm-up's events are committed, then take what is committed as the backup's floor.
    const before = await allEvents(cli);
    const evidenceAtBackup = filesOf(join(h.root, 'evidence'));
    const wikiAtBackup = filesOf(join(h.root, 'wiki'));
    const folder = backupFolder(h, 'under-load');
    const ackedAtStart = load.acked();
    const ran = await deep(h, ['backup', folder]);
    const ackedDuring = load.acked() - ackedAtStart;
    return { h, hub, seeded, before, folder, ran, ackedDuring, failures: load.failures(), evidenceAtBackup, wikiAtBackup };
  } finally {
    await load.stop();
    cli.close();
  }
})());

describe('AC1 #572.f4b300d0 deep backup while 30 scripted sessions append: the copy passes PRAGMA integrity_check and holds every event committed before the backup began; a plain copy of ledger.db taken mid-commit fails, naming the commit', () => {
  it('AC1 `deep backup <folder>` under the load of 30 appending sessions exits 0; its ledger.db passes PRAGMA integrity_check and holds every event committed before it began, with the evidence and wiki folders', async () => {
    const s = await scene();
    expect(s.ran.code, `\`deep backup ${s.folder}\` must exit 0 with the hub up: ${shown(s.ran)}`).toBe(0);
    expect(s.failures, 'every scripted session\'s hook request was acknowledged').toEqual([]);
    expect(s.ackedDuring, `the ${SESSIONS} sessions kept appending while the backup ran`).toBeGreaterThan(0);
    expect(s.before.length, 'the record held the warm-up\'s events before the backup began').toBeGreaterThan(WARM / 2);
    const problems = copyProblems(s.folder, [{ name: 'the events committed before the backup began', ids: s.before.map((e) => e.id) }]);
    expect(problems, `the backup in ${s.folder}`).toEqual([]);
    expect(missingFiles(s.evidenceAtBackup, filesOf(join(s.folder, 'evidence')), 'the backup\'s evidence/'), 'the backup holds the evidence store as it was').toEqual([]);
    expect(s.evidenceAtBackup.size, 'the pasted image was in the evidence store').toBeGreaterThan(0);
    expect(missingFiles(s.wikiAtBackup, filesOf(join(s.folder, 'wiki')), 'the backup\'s wiki/'), 'the backup holds the wiki').toEqual([]);
  }, 900_000);

  it('AC1 (wrong program) a backup that copies ledger.db while a commit lands, staged by the test VFS, fails the check, naming the commit', async () => {
    // The test VFS keeps the ledger in memory and writes ledger.db only when a FULL commit is made durable
    // (`cutAfter` set, never reached); `syncDelayMs` holds each FULL commit at its sync, so a commit is landing then.
    const h = makeHome();
    const dir = tempDir();
    const points = join(dir, 'points.jsonl');
    const hub = await startHub(h, { vfs: { points, syncDelayMs: 2000, cutAfter: 1_000_000_000 } });
    const cli = await control(hub);
    try {
      const load = appendLoad(h, hub, 3);
      await waitFor(() => load.acked() >= 30, 120 * SECOND, '30 acknowledged hook requests');
      await load.stop();
      const before = await allEvents(cli);
      // A FULL commit (one verdict, test.load), held at its sync; the plain copy is taken while it lands.
      const landing = cli.call('test.load', { verdicts: 1, checkpoint: false }, 60 * SECOND);
      await sleep(600);
      const plain = join(dir, 'plain-copy');
      mkdirSync(plain);
      for (const name of ['ledger.db', 'ledger.db-wal']) if (existsSync(join(h.root, name))) copyFileSync(join(h.root, name), join(plain, name));
      await landing;
      const verdict = (await allEvents(cli)).find((e) => e.kind === 'verdict.made' && !before.some((b) => b.id === e.id));
      expect(verdict, 'test.load committed one verdict').toBeDefined();
      const point = readFileSync(points, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { n: number; kind: string; mode?: string; ids?: string[] })
        .find((p) => p.kind === 'commit' && p.ids?.includes(verdict!.id));
      expect(point, `the points file names the commit of verdict ${verdict!.id}`).toBeDefined();
      const commit = `the commit that landed during the copy (point ${point!.n}, ${point!.mode}, verdict.made ${verdict!.id})`;
      const problems = copyProblems(plain, [
        { name: 'the events committed before the copy began', ids: before.map((e) => e.id) },
        { name: commit, ids: point!.ids! },
      ]);
      expect(problems.length, 'the plain file copy must fail the backup check').toBeGreaterThan(0);
      expect(problems.join('\n'), 'the failure names the commit that landed during the copy').toContain(verdict!.id);
    } finally {
      cli.close();
      await stopHub(hub);
    }
  }, 300_000);
});

describe('AC2 #572.98ee1d86 deep restore of that copy rebuilds every projection equal to the backup\'s, and each claim open at the copy is INVALID with the cause events lost', () => {
  it('AC2 with the hub stopped and the OS confirming you, `deep restore <folder>` puts the backup\'s record, evidence and wiki back with every projection equal to the backup\'s; at the next start each claim open at the copy reads INVALID, cause events lost, and a settled verdict is kept', async () => {
    const s = await scene();
    expect(s.ran.code, `AC1's \`deep backup ${s.folder}\` must exit 0 before its copy can be restored: ${shown(s.ran)}`).toBe(0);
    const { h, seeded } = s;
    const backupProjections = projectionsIn(s.folder);
    const claimsAtCopy = backupProjections.get('claims') ?? [];
    for (const { claim } of seeded.open) {
      const row = claimsAtCopy.map((t) => JSON.parse(t) as Record<string, unknown>).find((r) => bare(r.id) === claim);
      expect(row, `claim ${claim} is in the backup's claims projection`).toBeDefined();
      expect(row!.verdict_id ?? null, `claim ${claim} is open at the copy`).toBeNull();
    }

    // The record the restore replaces moves on: more events, and the wiki page edited.
    const more = appendLoad(h, s.hub, 3);
    await waitFor(() => more.acked() >= 30, 60 * SECOND, '30 more hook requests after the backup');
    await more.stop();
    writeFileSync(join(h.root, 'wiki', WIKI_PAGE), WIKI_AFTER);
    await stopHub(s.hub);
    const atBackup = idsIn(s.folder);
    const afterBackup = [...idsIn(h.root)].filter((id) => !atBackup.has(id));
    expect(afterBackup.length, 'the replaced record holds events the backup doesn\'t').toBeGreaterThan(0);

    await restore(h, s.folder);
    const restored = projectionsIn(h.root);
    expect(projectionDifferences(backupProjections, restored), 'every projection of the restored record equals the backup\'s').toEqual([]);
    const restoredIds = idsIn(h.root);
    expect([...atBackup].filter((id) => !restoredIds.has(id)), 'the restored record holds every event of the backup').toEqual([]);
    expect(afterBackup.filter((id) => restoredIds.has(id)), 'the restored record holds none of the events the replaced record added after the backup').toEqual([]);
    expect(missingFiles(filesOf(join(s.folder, 'evidence')), filesOf(join(h.root, 'evidence')), 'the restored evidence/'), 'the evidence store is back').toEqual([]);
    expect(readFileSync(join(h.root, 'wiki', WIKI_PAGE), 'utf8'), 'the wiki page is the backup\'s').toBe(WIKI_AT_BACKUP);

    // The restored record counts as one after a power cut: at the hub's next start, every claim open at the copy is INVALID.
    const hub = await startHub(h);
    const cli = await control(hub);
    try {
      const verdictsFor = (events: Ev[], claim: string) => events.filter((e) => e.kind === 'verdict.made' && bare(e.data.claim) === claim);
      let events: Ev[] = [];
      const deadline = Date.now() + 30 * SECOND;
      while (Date.now() < deadline) {
        events = await allEvents(cli);
        if (seeded.open.every(({ claim }) => verdictsFor(events, claim).length)) break;
        await sleep(200);
      }
      for (const { claim } of seeded.open) {
        const found = verdictsFor(events, claim);
        expect(found.length, `claim ${claim}, open at the copy, is still open after the restore and the hub's start: a restored record counts as one after a power cut, so it must read INVALID, cause events lost`).toBeGreaterThan(0);
        const newest = found[found.length - 1]!;
        expect(newest.data.outcome, `claim ${claim}, open at the copy, reads INVALID, never PASS`).toBe('INVALID');
        expect(JSON.stringify(newest.data.reasons), `claim ${claim}: the cause is events lost`).toContain('events lost');
      }
      const settled = verdictsFor(events, seeded.settled.claim);
      expect(settled.map((e) => [e.id, e.data.outcome]), `claim ${seeded.settled.claim}'s PASS verdict, made before the copy, is kept and nothing judges it again`).toEqual([[seeded.settled.verdict, 'PASS']]);
    } finally {
      cli.close();
      await stopHub(hub);
    }
  }, 900_000);
});
