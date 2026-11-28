import { afterAll, describe, expect, it } from 'vitest';
import { CHECKOUT, DESIGN, ID, PLANTED_WORD, SECOND, cleanup, designRow, help, helpWords, lint, plantInDesignRow, scratchCheckout, shown } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

describe(`${ID.designRow} the design's command row and the usage table`, () => {
  it(`${ID.designRow} the design's command row names the commands of deep --help's first two groups, and no other`, async () => {
    const r = await help();
    expect(r.code, `deep --help exits 0: ${shown(r)}`).toBe(0);
    const listed = helpWords(r.stdout, 2);
    expect(listed.length, `deep --help's first two groups list commands: ${shown(r)}`).toBeGreaterThan(0);
    const row = designRow(CHECKOUT);
    expect(row.line, `${DESIGN} holds the command row, a table row starting "| CLI |"`).toBeGreaterThan(0);
    const extra = row.words.filter((word) => !listed.includes(word));
    const missing = listed.filter((word) => !row.words.includes(word));
    expect({ extra, missing }, `${DESIGN}:${row.line} must name exactly the commands of the first two groups; extra are in the row only, missing in the usage table only`).toEqual({ extra: [], missing: [] });
  }, 120 * SECOND);

  it(`${ID.designRow} a row that names a command that doesn't exist fails, naming it`, () => {
    const at = scratchCheckout();
    const control = lint(at);
    expect(control.status, `the check passes on the unplanted copy before it is held to the plant:\n${control.output}`).toBe(0);
    plantInDesignRow(at, PLANTED_WORD);
    if (!designRow(at).words.includes(PLANTED_WORD)) throw Error(`BLOCKED: the planted ${PLANTED_WORD} isn't in the copy's command row`);
    const { status, output, fails } = lint(at);
    expect(fails.some((fail) => new RegExp(`\\b${PLANTED_WORD}\\b`).test(fail)), `the lint must fail the command row naming ${PLANTED_WORD}, a command that doesn't exist, on a FAIL line:\n${output}`).toBe(true);
    expect(status, `the lint exits 1 on the planted row:\n${output}`).toBe(1);
  }, 900 * SECOND);
});
