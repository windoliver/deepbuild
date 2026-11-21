// Criterion 3: "A write cut short leaves the previous record, which still opens; a record whose hash fails is named,
// and the one before it opens"
//
// Through `deep-logic`, the app, one process per session (README: The surface under test, A write cut short). The
// hero with a stash of 1,024 values (a record of over 4 KiB of numbers that don't compress) writes record A at its
// rest point at step 300 (xp 400). The next session reopens A and rests at step 300 in a process under a file-size
// limit of one block (`ulimit -f 1`), so the write of its record (xp 800) is cut short: the kernel stops the process in the
// write (SIGXFSZ), or the write fails. A start after it reopens A, with xp 400 at step 0 and nothing damaged, and
// rests at step 300 again, writing record B whole (xp 800). B's file is then cut short by its last byte: the next
// start names B as damaged, by its hash, and A, the one before it, opens.
// Wrong programs it fails: the base (no profile); a record written in place or under its own name before it reads back
// whole; a store that drops the previous record before the new one reads back whole; a start that doesn't check a
// record's hash, opens nothing when the newest fails, or doesn't name it.
import { truncateSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, prebuild, useTemp, wroteWhole } from './helpers.ts';
import { BIG, cutShort, defaultLook, piece, readAt, readWith, rest, session, showRead, stepZero } from './hero.ts';

prebuild();
const temp = useTemp();

describe(`${AC[3]} a profile record is written whole or not at all, and a damaged one is named`, () => {
  it(`${AC[3]} a write cut short leaves the previous record, which still opens; a record whose hash fails is named, and the one before it opens`, () => {
    const p = piece(BIG);
    const dir = temp();
    const first = session(p, dir, 300, [rest(300)], 'session 1 (an empty store; a rest point at step 300)');
    expect(first.run.profiles.map((w) => w.step), 'session 1 writes record A at step 300').toEqual([300]);
    const a = first.run.profiles[0]!.hash;
    expect(wroteWhole(dir, first.run.profiles[0]!, 'record A').length, 'record A holds over 1,024 bytes, so the limit cuts the next one short').toBeGreaterThan(1024);

    // The next record's write, cut short past one block of the file-size limit.
    const cut = cutShort(p, dir, [rest(300)], 300, 'session 2, under a file-size limit of one block');
    expect(cut.record, 'session 2 reopened A before its write was cut short').toBe(a);

    // The previous record still opens, and nothing reads as damaged: the cut-short write left no record.
    const third = session(p, dir, 300, [rest(300)], 'session 3 (after the cut-short write; a rest point at step 300)');
    expect(third.opened, 'the previous record, A, opens, and nothing is damaged').toEqual({ record: a, damaged: [], notices: [] });
    expect(showRead(readAt(stepZero(third.run))), 'step 0 reads A: xp 400 and the look').toBe(showRead(readWith(400, defaultLook(BIG.look))));
    expect(third.run.profiles.map((w) => w.step), 'session 3 writes record B at step 300').toEqual([300]);
    const b = third.run.profiles[0]!.hash;
    expect(b, 'B holds other numbers than A').not.toBe(a);
    wroteWhole(dir, third.run.profiles[0]!, 'record B');

    // B cut short by its last byte: named by its hash, and the one before it opens.
    const file = join(dir, `${b}.profile`);
    truncateSync(file, readFileSync(file).length - 1);
    const fourth = session(p, dir, 0, [], 'session 4 (B cut short by a byte)');
    expect(fourth.opened.damaged, 'the record whose hash fails is named, by its hash').toEqual([b]);
    expect(fourth.opened.record, 'and the one before it, A, opens').toBe(a);
    expect(showRead(readAt(stepZero(fourth.run))), 'step 0 reads A: xp 400 and the look').toBe(showRead(readWith(400, defaultLook(BIG.look))));
  }, TIMEOUT);
});
