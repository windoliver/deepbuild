// AC3 #226.88f58ce5: "A log z scale refuses a row with z = 0, naming the row"
//
// The axes on `xs` and `ys` (linear, [−4, 4]) and `zs` (log, domain [1, 1000] as written, range `z`), and `pts`, a
// `marks@1` point set parented to them with rows r0 … r4 keyed by `key`, encoding x, y and z through `xs`, `ys` and
// `zs`; row r3 has z = 0 and every other row a z in [1, 1000] (README: Fixtures). The working agent shows it through
// `deep_show` (the full build): the revision is refused with an error issue that names the row (its JSON names r3 and
// the set pts), and no error issue names any other row. The control, the same revision with r3's z = 50, has no error
// issue naming a row of pts or the scale zs.
// Wrong programs: the base (axes3d@1 unknown: skipped with a notice and presented); a log scale that clamps or drops
// the row; a refusal that names the scale's domain but not the row (the base's 2D log rule); one that names every row.
import { describe, expect, it } from 'vitest';
import { AC, ROW_KEYS, TIMEOUT, brief, docId, errors, logRowsDoc, mentions, refusedWith, runShow, show, useBins, useOut } from './helpers.ts';

const ID = AC[3];
const NAME = `AC3 ${ID}`;
const bin = useBins(['deep-show']);
const out = useOut();

describe(`${NAME} a log z scale refuses a row at z = 0`, () => {
  it(`${NAME} a point set on axes with a log z scale is refused for its row at z = 0, naming the row, and the same set without it isn't`, () => {
    const [zero, fifty] = [docId(1), docId(2)];
    const [refused, control] = runShow(bin('deep-show'), out(), [zero, fifty], [show(zero, logRowsDoc(0)), show(fifty, logRowsDoc(50))]);
    const errs = refusedWith(refused!, 'the set with r3 at z = 0 on the log z scale');
    const naming = errs.filter((e) => mentions(e.raw, 'r3') && mentions(e.raw, 'pts'));
    expect(naming.map((e) => brief(e.raw, 600)), `an error issue names the row r3 of pts: ${errs.map((e) => brief(e.raw, 600)).join('; ')}`).not.toEqual([]);
    const namesRow = (raw: Parameters<typeof mentions>[0], k: string): boolean => mentions(raw, `#${k}`) || mentions(raw, `"${k}"`);
    const others = errs.filter((e) => ROW_KEYS.some((k) => k !== 'r3' && namesRow(e.raw, k)));
    expect(others.map((e) => brief(e.raw, 600)), 'no error issue names another row').toEqual([]);
    const blamed = errors(control!, 'the same set with r3 at z = 50').filter((e) => mentions(e.raw, 'zs') || ROW_KEYS.some((k) => namesRow(e.raw, k)));
    expect(blamed.map((e) => brief(e.raw, 600)), 'with every z in the log domain no error issue names a row of pts or the scale zs').toEqual([]);
  }, TIMEOUT);
});
