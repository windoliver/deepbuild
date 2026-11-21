// Criterion 6: "Start fresh runs with zeros and keeps the stored record, and the next request replaces it only once
// the new one reads back whole; a profile declared past the cap is refused at check, naming its size"
//
// Through `deep-logic`, the app, one process per session (README: The surface under test, A write cut short). The hero
// with a stash of 1,024 values writes record A at its rest point at step 300 (xp 400). In order:
//   - start fresh (`open` with `fresh: true`) to step 149: nothing reopened, step 0 reads a u32 0 and zeros over its
//     init's garbage, the track holds no record entry, and the store's record files keep their names and bytes; a
//     start after it still reopens A;
//   - start fresh again, resting at step 150 (xp 200), under a file-size limit of one block (`ulimit -f 1`), so the new
//     record's write is cut short: a start after it still reopens A, with nothing damaged;
//   - start fresh, resting at step 150, without the limit: record C is written whole, and a start after it reopens C,
//     xp 200 at step 0.
// Then `check` admits a profile of 65,536 bytes of numbers and refuses one of 65,540, naming that size.
// Wrong programs it fails: the base (no profile); a fresh start that reopens the record, leaves the region unfilled,
// or deletes or rewrites the stored record; a request that drops the stored record before the new one reads back
// whole; a cap that admits 65,540 bytes, refuses 65,536, or names no size.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, arr, isObject, kept, one, prebuild, show, useTemp, wroteWhole, type JsonValue } from './helpers.ts';
import { BIG, CAP, HERO, capPiece, cutShort, defaultLook, piece, readAt, readWith, readWithout, rest, session, showRead, stepZero } from './hero.ts';

prebuild();
const temp = useTemp();

describe(`${AC[6]} start fresh, the next request, and the cap`, () => {
  it(`${AC[6]} start fresh runs with zeros and keeps the stored record; the next request replaces it only once the new one reads back whole; a profile past 64 KiB is refused at check, naming its size`, () => {
    const p = piece(BIG);
    const dir = temp();
    const first = session(p, dir, 300, [rest(300)], 'session 1 (an empty store; a rest point at step 300)');
    expect(first.run.profiles.map((w) => w.step), 'session 1 writes record A at step 300').toEqual([300]);
    const a = first.run.profiles[0]!.hash;
    wroteWhole(dir, first.run.profiles[0]!, 'record A');
    const stored = kept(dir);

    // Start fresh: zeros, and the stored record kept.
    const fresh = session(p, dir, 149, [rest(150)], 'start fresh, to step 149', { fresh: true });
    expect(fresh.opened.record, 'start fresh reopens nothing').toBeNull();
    expect(showRead(readAt(stepZero(fresh.run))), 'start fresh runs with zeros: step 0 reads a u32 0 and zeros, never the record or what was there before').toBe(showRead(readWithout(BIG.look)));
    expect(fresh.run.track.filter((e) => 'profile' in e), 'its track holds no record entry').toEqual([]);
    const afterFresh = kept(dir);
    expect(Object.keys(afterFresh), 'the store keeps the same record files').toEqual(Object.keys(stored));
    expect(Object.entries(afterFresh).every(([f, b]) => b.equals(stored[f]!)), 'with the same bytes').toBe(true);
    const keptA = session(p, dir, 0, [], 'a start after start fresh');
    expect([keptA.opened.record, readAt(stepZero(keptA.run)).xp], 'the stored record is kept: a start after it reopens A, xp 400').toEqual([a, 400]);

    // The next request of a fresh run, cut short: the stored record stays the one that opens.
    const cut = cutShort(p, dir, [rest(150)], 150, 'start fresh under a file-size limit of one block, resting at step 150', true);
    expect(cut.record, 'start fresh reopens nothing').toBeNull();
    const afterCut = session(p, dir, 0, [], 'a start after the cut-short request');
    expect(afterCut.opened, 'a request whose record didn\'t read back whole replaces nothing: A opens, nothing damaged').toEqual({ record: a, damaged: [], notices: [] });
    expect(readAt(stepZero(afterCut.run)).xp, 'xp 400 at step 0').toBe(400);

    // The next request of a fresh run, written whole: it replaces the stored record.
    const whole = session(p, dir, 150, [rest(150)], 'start fresh, resting at step 150', { fresh: true });
    expect(whole.run.profiles.map((w) => w.step), 'the fresh run writes record C at step 150').toEqual([150]);
    const c = whole.run.profiles[0]!.hash;
    expect(c, 'C holds other numbers than A').not.toBe(a);
    wroteWhole(dir, whole.run.profiles[0]!, 'record C');
    const next = session(p, dir, 0, [], 'a start after C reads back whole');
    expect(next.opened.record, 'C replaced A: a start reopens it').toBe(c);
    expect(showRead(readAt(stepZero(next.run))), 'step 0 reads C: xp 200 and the look').toBe(showRead(readWith(200, defaultLook(BIG.look))));

    // The cap: 64 KiB of numbers.
    const at = one({ call: 'check', piece: capPiece((CAP - 4) / 4) }, 'check of a profile of 65,536 bytes of numbers');
    expect(at['ok'], `a profile at the cap, 65,536 bytes, is admitted: ${show(at, 800)}`).toBe(true);
    const past = one({ call: 'check', piece: capPiece(CAP / 4) }, 'check of a profile of 65,540 bytes of numbers');
    expect([past['ok'], past['code'], past['item']], `a profile past the cap is refused at check: ${show(past, 800)}`).toEqual([false, 'logic_refused', HERO]);
    const refusals = arr(past['refusals'], 'the refusals').filter(isObject);
    expect(refusals.filter((r) => r['field'] === 'profile').map((r) => r['size']), `naming its size, 65,540 bytes: ${show(refusals as JsonValue, 800)}`).toEqual([CAP + 4]);
  }, TIMEOUT);
});
