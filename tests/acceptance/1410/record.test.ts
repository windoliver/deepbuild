// #1410 AC1 and AC2, and the scope's second line (README): the record and the evidence store, through their public
// entries, run once under the sync shim (scenario.mjs). Judged from the shim's log of real syscalls: which files and
// folders were synced, in what order against the record's own WAL sync of each FULL commit, and what a power cut right
// after each FULL commit would leave of the evidence it names.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { buildShim, cleanup, fileOf, fullCommit, idOf, imageAtCut, markerAt, runScenario, syncs, syncsSeen, type Entry, type Scenario, type SyncEntry } from './helpers.ts';

let s: Scenario;
let setup: unknown;
beforeAll(async () => {
  try {
    s = await runScenario(buildShim());
  } catch (error) {
    setup = error;
  }
}, 300_000);
afterAll(cleanup);
const scenario = (): Scenario => {
  if (setup) throw setup;
  return s;
};

/** The FULL commits the scenario makes, each with the evidence it names, read back from the record. */
function commits(sc: Scenario): { name: string; wal: SyncEntry; named: string[] }[] {
  // The scenario stands only if each commit names what it was given: else nothing below means anything.
  if (JSON.stringify(sc.out.verdictEvidence) !== JSON.stringify([sc.out.cited])) throw Error(`BLOCKED: the verdict reads back citing ${JSON.stringify(sc.out.verdictEvidence)}, not the run output ${sc.out.cited}`);
  if (JSON.stringify(sc.out.askEvidence) !== JSON.stringify([sc.out.expected.prompt])) throw Error(`BLOCKED: the resuming prompt reads back citing ${JSON.stringify(sc.out.askEvidence)}, not its whole text ${sc.out.expected.prompt}`);
  return [
    { name: 'the verdict (verdict.made, citing a run output the caller stored)', wal: fullCommit(sc, 'before-verdict', 'after-verdict'), named: sc.out.verdictEvidence },
    { name: "the resuming prompt (user.ask after the session's stop, citing the whole text the record stored)", wal: fullCommit(sc, 'before-resume', 'after-resume'), named: sc.out.askEvidence },
  ];
}

describe('#1410: evidence a FULL commit names is synced, with its folder, before that commit', () => {
  it('AC1: the shim sees each named evidence file and its folder synced before the WAL sync of the FULL commit that names it', () => {
    const sc = scenario();
    // The shim proves itself on the record's own syncs: every FULL commit's WAL sync is in its log.
    const problems: string[] = [];
    for (const commit of commits(sc)) {
      for (const sha of commit.named) {
        const file = fileOf(sc.root, sha);
        const f = idOf(file);
        const d = idOf(dirname(file));
        const lastWrite = sc.log.filter((e) => e.kind === 'W' && e.dev === f.dev && e.ino === f.ino).pop();
        const placed = sc.log.filter((e) => (e.kind === 'R' || e.kind === 'C') && e.path === file).pop();
        if (!lastWrite || !placed) throw Error(`BLOCKED: the shim saw no write or no rename of ${file}, so it doesn't watch the evidence store's writes`);
        // Before: the sync returned before the commit's WAL sync began.
        const before = (e: Entry) => e.i < commit.wal.i && e.kind === 'S' && e.end <= commit.wal.start;
        const fileSynced = sc.log.some((e) => e.i > lastWrite.i && before(e) && syncs(e, f.dev, f.ino));
        const folderSynced = sc.log.some((e) => e.i > placed.i && before(e) && syncs(e, d.dev, d.ino));
        const seen = (dev: string, ino: string) => JSON.stringify(syncsSeen(sc.log, dev, ino).map((e) => e.kind === 'S' && `${e.op} at entry ${e.i}`));
        if (!fileSynced) problems.push(`${commit.name}: its evidence file ${sha} was not synced after its last write and before the commit's WAL sync (entry ${commit.wal.i}); syncs of it seen: ${seen(f.dev, f.ino)}`);
        if (!folderSynced) problems.push(`${commit.name}: the folder of ${sha} (${dirname(file)}) was not synced after the file was named there and before the commit's WAL sync (entry ${commit.wal.i}); syncs of it seen: ${seen(d.dev, d.ino)}`);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('AC2: with a power cut right after each FULL commit, every evidence hash that commit names reads back whole', async () => {
    const sc = scenario();
    const problems: string[] = [];
    for (const [n, commit] of commits(sc).entries()) {
      // The cut: right after the commit's WAL sync returned, so the commit itself is durable and nothing later is.
      const image = join(sc.tmp, `after-cut-${n}`, 'evidence');
      mkdirSync(dirname(image), { recursive: true });
      imageAtCut(sc.log, commit.wal.i + 1, sc.root, image);
      const store = await openEvidenceStore({ root: image, readOnly: true });
      for (const sha of commit.named) {
        try {
          const bytes = await store.read(sha);
          if (!bytes.length) problems.push(`${commit.name}: ${sha} read back empty after the cut`);
        } catch (error) {
          problems.push(`${commit.name}: ${sha} doesn't read back after a cut right after the commit: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('Scope: an evidence write no FULL commit names is not synced, nor its folder (one cited by no event, one cited only by a stream event)', () => {
    const sc = scenario();
    commits(sc);
    if (JSON.stringify(sc.out.toolEvidence) !== JSON.stringify([sc.out.expected.command])) throw Error(`BLOCKED: the long command reads back citing ${JSON.stringify(sc.out.toolEvidence)}, not its whole text`);
    // Everything the run did before the record's clean stop, whose own FULL commit names nothing.
    const end = markerAt(sc, 'before-close');
    const problems: string[] = [];
    for (const [what, sha] of [['the file no event cites', sc.out.uncited], ["the long command's whole text, cited only by its tool.before (NORMAL)", sc.out.toolEvidence[0]!]] as const) {
      const file = fileOf(sc.root, sha);
      const f = idOf(file);
      const d = idOf(dirname(file));
      const fileSyncs = sc.log.filter((e) => e.i < end && syncs(e, f.dev, f.ino));
      const folderSyncs = sc.log.filter((e) => e.i < end && syncs(e, d.dev, d.ino));
      if (fileSyncs.length) problems.push(`${what} (${sha}) was synced ${fileSyncs.length} time(s), at entries ${fileSyncs.map((e) => e.i).join(', ')}`);
      if (folderSyncs.length) problems.push(`the folder of ${what} (${dirname(file)}) was synced ${folderSyncs.length} time(s), at entries ${folderSyncs.map((e) => e.i).join(', ')}`);
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
