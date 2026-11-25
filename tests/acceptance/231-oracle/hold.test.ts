// AC1 #231.ceba88e3: "A film holding still for 30 s, with no time reader in view, counts exactly 1 draw and 1 hash for
// the hold in the export and 1 more of each in export.fidelity's redraw, with no frame read back, the same as a 1 s
// hold, and its delivery still decodes to 1,800 frames at 60 fps and passes export.fidelity"
//
// The Oracle lane's part: an upstream renderer's own law that holding still costs the same however long, pinned at
// commit cfd33af5aa7cc0d6aa7dfe13919744e2124629dc, `tests/benchmarks/test_laws.py` lines 536 to 555, with the work
// counters of `tests/benchmarks/work.py` (README: Sources). Use: port. Its cases and expected values, with none of
// its code: a scene that adds one object with nothing updating it and waits, told at 10 frames a second, for 1 s and
// for a whole number of seconds from 2 to 30; every count of work the longer run does is at most 1.1 times the 1 s
// run's, a count both leave at 0 not having grown, and the failure names the length, the count and both readings. Run
// against our output (#136): each scene is a film this suite makes (helpers.ts `holdFilm`), delivered through
// `deep-show run`'s `export`, and the counts are our export's own work counters, the reply's `work`, every one of
// them. Where the upstream draws 25 lengths at random, every length from 2 to 30 runs here, the held thing taking
// turns between three kinds. Wrong program: the merge base, whose export draws and hashes every frame and counts no
// work.
import { describe, expect, it } from 'vitest';
import { AC1, FPS, SLACK, SUBJECTS, exported, flat, growthFailures, useShow, useTemp, type Subject } from './helpers.ts';

const show = useShow();
const temp = useTemp();

describe(`${AC1} the upstream law, on our export's work counters: holding still costs the same however long`, () => {
  it(`${AC1} a film that holds one still thing for 2 s to 30 s does at most ${1 + SLACK} times each count of work of the same film held for 1 s`, () => {
    const bin = show(); const dir = temp();
    const short = new Map<Subject, [string, number][]>();
    for (const which of SUBJECTS) {
      const one = exported(bin, dir, which, 1);
      expect(one.frames, `a ${which} held for 1 s is ${FPS} frames`).toBe(FPS);
      // The upstream's own guard, where it has one: a run that counted no work proves nothing.
      expect(one.work.draws, `a ${which} held for 1 s: the export drew a frame, so the law has work to compare`).toBeGreaterThan(0);
      expect(one.work.hashes, `a ${which} held for 1 s: the export hashed a frame`).toBeGreaterThan(0);
      short.set(which, flat(one.work));
    }
    const failures: string[] = [];
    for (let seconds = 2; seconds <= 30; seconds++) {
      const which = SUBJECTS[(seconds - 2) % SUBJECTS.length]!;
      const long = exported(bin, dir, which, seconds);
      if (long.frames !== seconds * FPS) failures.push(`a ${which} held ${seconds} s: its delivery counts ${long.frames} frames, not ${seconds * FPS}`);
      failures.push(...growthFailures(1, short.get(which)!, seconds, flat(long.work)).map((f) => `a ${which} ${f}`));
    }
    expect(failures, `holds of 2 s to 30 s against the 1 s hold: ${failures.slice(0, 6).join(' | ')}`).toEqual([]);
  });
});
