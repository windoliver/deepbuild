// #1514 AC4 and AC7: Claude Code loads only the top of its memory index, as many lines as its line limit and as many
// bytes as its byte limit allow, whichever comes first. With facts limits of 200 lines and 25,000 bytes: a 307-line
// index loses lines 201 on (AC4); a 150-line index of 300 bytes a line loses lines 84 on, to the byte limit (AC7). The
// rules page marks each lost line as not reaching Claude Code, and `deep doctor` run in the repo names the index and
// its first line lost, with the byte limit where that is what cut it. A doctor that counts lines only reads OK on the
// 150-line index and fails AC7.
//
// The world is #19's all-ok world (../19/doctor/helpers.ts, `world`), with the fixture facts in DEEP_HUB_TEST_FACTS on
// every process it starts: the shipped facts with Claude Code's memory index limits set to 200 lines and 25,000 bytes.
// Each repo's index is MEMORY.md in its memory folder under the world's home (README: The surface under test).
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, deep, doctor, rootOf, startSession, world, type World } from '../19/doctor/helpers.ts';
import {
  AC4, AC7, CLAUDE, COUNTS_LINES_ONLY, INDEX_BYTES, INDEX_LINES, bytesOf, fixtureFacts, index150, index307, indexRepo, itemWords, itemsShownShort, judgeIndexDoctor,
  judgeIndexPage, linesOf, lostFor, readPage,
} from './helpers.ts';

afterAll(cleanup, 60_000);

interface Made { w: World; missing: string[] }
let made: Promise<Made> | undefined;
/** One world for this file, its hub and every process reading the fixture facts. */
const theWorld = (): Promise<Made> => (made ??= (async () => {
  let missing: string[] = [];
  const w = await world({
    before: (_settings, h) => {
      const dir = join(h.tmp, 'facts');
      missing = fixtureFacts(dir, { memoryIndex: { lines: INDEX_LINES, bytes: INDEX_BYTES } });
      h.env.DEEP_HUB_TEST_FACTS = dir;
    },
  });
  return { w, missing };
})());
const factsReady = (missing: string[]): void => {
  expect.soft(missing.join('; ') || 'none', 'the fixture facts: the shipped facts with Claude Code\'s memory index limits set to 200 lines and 25,000 bytes (README); what the shipped facts lack').toBe('none');
};

describe(`${AC4} a 307-line memory index marks lines 201 on as not loaded, naming line 201, with a facts limit of 200 lines`, () => {
  it(`${AC4} deep doctor names MEMORY.md and line 201 for Claude Code; the rules page marks lines 201 to 307 as not reaching Claude Code, past the index limit, and none before`, async () => {
    const { w, missing } = await theWorld();
    factsReady(missing);
    const r = indexRepo(join(w.h.tmp, 'm-lines'), w.h.home, index307('l'));
    expect(linesOf(r.text), 'the memory index has 307 lines').toBe(307);
    expect(bytesOf(r.text), 'the whole index is under the 25,000-byte limit, so the line limit cuts it').toBeLessThan(INDEX_BYTES);
    expect(r.firstLost, 'the first line past 200 lines').toBe(201);
    await startSession(w.h, r.repo);
    judgeIndexDoctor(AC4, await doctor(w.h, ['--prompt'], { cwd: r.repo }), r);
    await deep(w.h, ['rules', 'sync']);
    judgeIndexPage(AC4, readPage(rootOf(w.h.home)), r);
  }, 600_000);
});

describe(`${AC7} a 150-line memory index of 300 bytes a line, with facts limits of 200 lines and 25,000 bytes, marks lines 84 on as not loaded, naming line 84 and the byte limit; a doctor that counts lines only reads OK and fails`, () => {
  it(`${AC7} deep doctor names MEMORY.md, line 84 and the 25,000-byte limit for Claude Code; the rules page marks lines 84 to 150 as not reaching Claude Code, past the index limit, and none before`, async () => {
    const { w, missing } = await theWorld();
    factsReady(missing);
    const r = indexRepo(join(w.h.tmp, 'm-bytes'), w.h.home, index150('b'));
    expect(linesOf(r.text), 'the memory index has 150 lines, under the 200-line limit').toBe(150);
    expect(r.text.split('\n').slice(0, -1).every((l) => bytesOf(`${l}\n`) === 300), 'every line is 300 bytes, its newline included').toBe(true);
    expect(r.firstLost, 'the first line not whole within 25,000 bytes: 83 lines end at byte 24,900, the 84th at 25,200').toBe(84);
    await startSession(w.h, r.repo);
    judgeIndexDoctor(AC7, await doctor(w.h, ['--prompt'], { cwd: r.repo }), r, INDEX_BYTES);
    await deep(w.h, ['rules', 'sync']);
    judgeIndexPage(AC7, readPage(rootOf(w.h.home)), r);
  }, 600_000);

  it(`${AC7} (wrong program) a doctor that counts lines only (${COUNTS_LINES_ONLY}) reads the 150-line index OK and fails this test`, async () => {
    const { w, missing } = await theWorld();
    factsReady(missing);
    const r = indexRepo(join(w.h.tmp, 'm-planted'), w.h.home, index150('p'));
    const d = await doctor(w.h, ['--prompt'], { cwd: r.repo, env: { DEEP_HUB_PLANT: COUNTS_LINES_ONLY } });
    expect(itemsShownShort(lostFor(d, CLAUDE).filter((i) => itemWords(i).includes('MEMORY.md'))), 'the planted doctor reads the memory index OK: no rules.not_loaded item above ok names it').toBe('none');
    expect(() => judgeIndexDoctor(AC7, d, r, INDEX_BYTES)).toThrow(/^AC7 deep doctor run in .* must report rules\.not_loaded for Claude Code naming its memory index/);
  }, 600_000);
});
