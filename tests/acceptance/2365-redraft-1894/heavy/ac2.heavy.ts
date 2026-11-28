import { constants, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectCopy, openWorld, removeTemps, resolved, scrubbedByLine, scrubText, T0, tempDir } from '../helpers.ts';
import { fixture, mb, MB, measuredPass, needBuild, transcriptPath, type Meta } from '../../2365/heavy/run.ts';

afterAll(removeTemps);

const AC2 = '#2365 AC2';
const ID = '2365a002-0000-4000-a000-000000000600';
let dir = '';
let source = '';
let meta: Meta;

beforeAll(() => {
  needBuild();
  dir = tempDir('ac2');
  source = transcriptPath(join(dir, 'fixture'), ID);
  meta = fixture('write', source, 600 * MB);
  expect(meta.bytes, 'the transcript is 600 MB, past 512 MiB').toBeGreaterThanOrEqual(600 * MB);
}, 3_600_000);

async function copiedWhole(mode: 'pass' | 'session'): Promise<void> {
  const home = join(dir, `home-${mode}`);
  const path = transcriptPath(home, ID);
  mkdirSync(dirname(path), { recursive: true });
  copyFileSync(source, path, constants.COPYFILE_FICLONE);
  const r = await measuredPass(home, mode, T0, mode === 'session' ? { id: ID } : {});
  console.log(`${AC2} ${mode === 'pass' ? 'one pass' : 'the copy on demand'} of a ${mb(meta.bytes)} transcript never archived: ${r.ms.toFixed(0)} ms, longest unserved stretch ${r.maxGapMs.toFixed(0)} ms, peak resident memory ${mb(r.peakRss)} from ${mb(r.rssStart)}, evidence +${mb(r.added)}${r.error ? `, error: ${r.error}` : ''}`);
  expect(r.error, `${AC2} the ${mode === 'pass' ? 'pass' : 'copy on demand'} copies the transcript, leaving nothing undone`).toBeNull();
  const w = await openWorld({ home });
  try {
    await expectCopy(w, ID, () => scrubbedByLine(path), `${AC2} the parts read back in order equal the file scrubbed a line at a time`);
    expect(await resolved(w, ID, meta.last.uuid), `${AC2} session:<id>#${meta.last.uuid}, its last message, resolves`).toBe(scrubText(meta.last.text));
  } finally {
    await w.close();
  }
}

describe(`${AC2} a 600 MB transcript, never archived, is copied in one pass`, () => {
  it(`${AC2} one pass: its parts in order equal the file scrubbed a line at a time, and session:<id>#m<n> resolves for its last message`, async () => {
    await copiedWhole('pass');
  }, 7_200_000);

  it(`${AC2} the copy of one session on demand (archive.session) takes the same path`, async () => {
    await copiedWhole('session');
  }, 7_200_000);
});
