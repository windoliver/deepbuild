// #2119 acceptance (README.md), the second criterion: setup's own record, <root>/setup.json, is written through a
// temporary file, so a cut write leaves the earlier record. Written first and blind, from the issue, the design and the
// base commit. fixtures/cut-record.mjs saves and reads the record through the hub's built agent-files module in a child
// process, with node:fs's writes stubbed to throw once a file is open while it saves the next record. A failure on a
// wrong program is the expect below; a run that can't set that up throws BLOCKED, and never passes or skips.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { afterAll, expect, test } from 'vitest';
import { cleanup, needs, plain, script, tempFolder } from './helpers.ts';

afterAll(cleanup);

/** setup.json as agent-files.ts reads it: each file's hash before setup's first write and after its last, and the folders setup made. */
interface SetupRecord { files: { [file: string]: { before: string | null; after: string } }; created: string[] }

test("#2119.8f1b0393 setup's own record is written through a temporary file: a write of the next record cut once the file is open leaves the earlier record, and setupRecord reads it", async () => {
  needs();
  const folder = tempFolder();
  const home = join(folder, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true });
  // The earlier record, as a first setup leaves it: your settings' bytes kept, and the skill folder it made. The next
  // one adds ~/.claude.json, as a later step of the same setup would.
  const settings = join(home, '.claude', 'settings.json');
  const earlier: SetupRecord = { files: { [settings]: { before: 'a'.repeat(64), after: 'b'.repeat(64) } }, created: [join(home, '.claude', 'skills', 'deepbuild')] };
  const next: SetupRecord = { ...earlier, files: { ...earlier.files, [join(home, '.claude.json')]: { before: null, after: 'c'.repeat(64) } } };

  const r = await script<{ before: SetupRecord; cut: string[]; threw: string | null; after: SetupRecord }>('cut-record.mjs', [root, JSON.stringify(earlier), JSON.stringify(next)], home);

  // Given: the earlier record is on disk and reads back, and the write of the next one was reached and cut.
  if (!isDeepStrictEqual(r.out.before, earlier)) throw Error(`BLOCKED: the earlier record didn't read back as it was saved, so no earlier record is on disk to keep\n${r.shown}`);
  if (!r.out.cut.length) throw Error(`BLOCKED: saving the next record wrote no file's bytes, so no write of it was cut\n${r.shown}`);
  expect(r.out.after, `setupRecord after the write of the next record was cut once ${r.out.cut.join(', ')} was open (the save threw: ${r.out.threw ?? 'nothing'})\n${plain(r.shown)}\n(end of the run)`).toEqual(earlier);
}, 600_000);
