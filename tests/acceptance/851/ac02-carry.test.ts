// AC2 #851.d9bf3012: "Entering level 2 carries the player's score and inventory from level 1's carry record, and a
// planted level 2 that reads level 1's arrays directly is refused at check, naming the array"
//
// The fixture shell's carry journey with keys at the reference window passes. Level 1 collects at its steps 600, 1,800
// and 3,000 and finishes at 3,700 (the journeys' level presses), so its carry record, written at the step `done` turns
// true, holds score [60] and inventory [1, 2, 3, 0] (shell.ts: afterCollects(3)); the replica's reply lists that record
// under `carry` for level 1 (index 0) by sha256, and level 2 (index 1) under `entered` with that record's hash and the
// same arrays, while level 1 itself entered with none. The twin whose level 2 logic reads `l1.score` (level 1's array)
// in place of its carry_in is refused at check: the replica's play answers `refused` with shell.reads naming l1.score
// and plays no level step, and the carry journey fails shell.reads, naming l1.score.
// The wrong programs: the base, a shell that enters level 2 with no record or with one taken at another step, and a
// check that lets a level read another level's arrays.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, HASH, REFERENCE, TIMEOUT, devicePlays, failuresOf, hubOnce, journeysInput, macOnly, passed, playsOf, putShell, rest, runJourneys, shellReply, shown, word,
} from './helpers.ts';
import { LEVEL1_RECORD, allPrograms, programs, shellDocument } from './shell.ts';

const hub = hubOnce();
const keysAtReference = { journeys: ['carry' as const], devices: ['keys' as const], sizes: [REFERENCE] };

describe(`${AC[2]} level 2 starts from level 1's carry record, and a level 2 that reads level 1's arrays is refused`, () => {
  it(`${AC[2]} entering level 2 carries score ${LEVEL1_RECORD.score[0]} and inventory [${LEVEL1_RECORD.inventory.join(', ')}] from level 1's carry record`, async () => {
    macOnly();
    const h = await hub();
    const p = programs();
    const piece = putShell(DOC.shell, shellDocument(p), allPrograms(p));
    const result = await runJourneys(h, journeysInput(piece, keysAtReference));
    passed(result, 'the fixture shell\'s carry journey with keys');
    const r = devicePlays(h.pool, piece, 'carry', ['keys'], REFERENCE).get('keys')![0]!;
    const record = r.carry.find((c) => c.level === 0);
    expect(record, `level 1 wrote a carry record when it was completed: ${JSON.stringify(r.carry).slice(0, 600)}`).toBeDefined();
    expect(record!.sha256, 'the record is named by its sha256').toMatch(HASH);
    expect(record!.arrays, 'level 1\'s record holds its score and inventory at the step it was completed').toEqual(LEVEL1_RECORD);
    const into2 = r.entered.find((e) => e.level === 1);
    expect(into2, `level 2 was entered: ${JSON.stringify(r.entered).slice(0, 600)}`).toBeDefined();
    expect(into2!.carry, 'level 2 entered from level 1\'s record, by its hash').toBe(record!.sha256);
    expect(into2!.arrays, 'level 2 read the record\'s score and inventory at its step 0').toEqual(LEVEL1_RECORD);
    expect(r.entered.find((e) => e.level === 0)?.carry ?? null, 'level 1 entered with no record').toBeNull();
  }, TIMEOUT);

  it(`${AC[2]} a planted level 2 that reads level 1's arrays directly is refused at check with shell.reads, naming l1.score`, async () => {
    macOnly();
    const h = await hub();
    const p = programs();
    const piece = putShell(DOC.readsLevel1, shellDocument(p, { readsLevel1: true }), allPrograms(p));
    const result = await runJourneys(h, journeysInput(piece, keysAtReference));
    const plays = playsOf(h.pool, piece, 'carry');
    expect(plays.length, 'the twin\'s carry journey asked the replica to play it').toBeGreaterThan(0);
    const r = shellReply(plays[0]!.reply, 'the twin\'s carry play');
    expect(r.refused?.code, `the replica refused the twin at check: ${JSON.stringify(r.refused)}`).toBe('shell.reads');
    expect(word('l1.score').test(r.refused!.message), `the refusal names l1.score: ${r.refused!.message}`).toBe(true);
    expect(r.rows.filter((x) => x.level >= 0).map((x) => x.step), 'no level step was played').toEqual([]);
    expect(result.outcome, `the twin's carry journey fails: ${shown(result)}`).toBe('failed');
    const f = failuresOf(result, 'shell.reads');
    expect(f.some((x) => word('l1.score').test(rest(x.message, 'shell.reads'))), `a shell.reads failure names l1.score: ${shown(result)}`).toBe(true);
  }, TIMEOUT);
});
