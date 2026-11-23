// AC2 #2316.e3f1d78c: Copying a single active session via `archive.session(id)` with 2,000 unrelated transcript files
// in sibling project/date folders completes well within `ARCHIVE_WAIT_MS` and archives only the target session.
//
// Real files in a temp home, a real record and evidence store (suite 20's world), and the archive opened through
// `openArchive` over the shipped adapters' facts, as the hub opens it. Under the home:
//   - 1,000 Claude Code transcripts of other sessions, 10 in each of 100 sibling project folders
//     (`.claude/projects/<folder>/<session>.jsonl`);
//   - 1,000 Codex rollouts of other sessions, 10 in each of 100 date folders
//     (`.codex/sessions/YYYY/MM/DD/rollout-<time>-<thread>.jsonl`), one folder a day back from the clock's start;
//   - the active session: one Claude Code transcript of five messages, alone in its own project folder.
// Nothing was archived before. The test calls `archive.session(<the active session's ID>)` once and reads the wall
// clock around that call alone (`performance.now()`); opening the archive and writing the files are outside it.
//
// It asserts, in this order:
//   1. the record holds exactly one `transcript.archived` event, and it names the active session, whose copy reads
//      back as its transcript, redacted (suite 20's `expectArchived`);
//   2. the call took under WELL_WITHIN_MS, half of ARCHIVE_WAIT_MS (2,000 ms, packages/hub/src/holds.ts): the reading
//      of "well within" this suite chose (README, Left open).
// The time is read once, at whatever the machine's load is; nothing here skips on load.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import {
  allEvents, claudeTranscript, codexTranscript, dataOf, DAY, expectArchived, handle, numbered, openArchiveOn, openWorld, removeTemps, sessionId, T0, type World,
} from '../20/helpers.ts';

const ID = 'AC2 #2316.e3f1d78c';
/** The hub's wait for a held push's copy, as packages/hub/src/holds.ts states it. */
const ARCHIVE_WAIT_MS = 2000;
/** "Well within" it, as this suite reads it: half. */
const WELL_WITHIN_MS = ARCHIVE_WAIT_MS / 2;
const FOLDERS = 100;
const PER_FOLDER = 10;

const dir = mkdtempSync(join(tmpdir(), 'deep-2316-'));
let world: World | undefined;
afterAll(async () => {
  await world?.close();
  rmSync(dir, { recursive: true, force: true });
  removeTemps();
});

it(`${ID} archive.session(id) beside 2,000 other sessions' transcripts copies the one session, well within ARCHIVE_WAIT_MS`, async () => {
  const w = (world = await openWorld({ home: join(dir, 'home') }));
  const others: string[] = [];
  for (let folder = 0; folder < FOLDERS; folder++) {
    for (let n = 0; n < PER_FOLDER; n++) {
      others.push(claudeTranscript(w.env, numbered(1, 2, `project ${folder}`), { cwd: `/tmp/dh2316-work/project-${String(folder).padStart(3, '0')}` }).id);
      others.push(codexTranscript(w.env, [`day ${folder}, rollout ${n}`], T0 - (folder + 1) * DAY).id);
    }
  }
  expect(others.length, "the fixture: 2,000 other sessions' transcript files in sibling project and date folders").toBe(2000);
  const active = claudeTranscript(w.env, numbered(1, 5, 'active'), { id: sessionId(), cwd: '/tmp/dh2316-work/shop' });
  const archive = await openArchiveOn(w);

  const start = performance.now();
  await archive.session(active.id);
  const took = performance.now() - start;

  const archived = (await allEvents(w.record, ['transcript.archived'])).map((e) => String(dataOf(e).session));
  expect(archived, `archive.session(${active.id}) archives the active session and no other`).toEqual([handle(active.id)]);
  await expectArchived(w, active, 'the active session');
  expect(took, `archive.session(id) took ${took.toFixed(1)} ms beside 2,000 other transcripts; well within ARCHIVE_WAIT_MS (${ARCHIVE_WAIT_MS} ms) is under ${WELL_WITHIN_MS} ms`).toBeLessThan(WELL_WITHIN_MS);
}, 600_000);
