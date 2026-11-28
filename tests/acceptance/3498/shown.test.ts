import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ALL_SEVEN, blocked, cleanup, fixtureRecord, ID, inconclusive, linesOf, MIN, none, SESSIONS, SEVEN, sha256, SHOWN_ENV, shownDir, shownText, SUITE, tasteReading, type Taste } from './helpers.ts';

afterAll(cleanup);
const BEFORE = join(SUITE, 'shown', 'before.txt');
const TASTE = join(SUITE, 'TASTE.json');
const lineFor = (text: string, shownAs: string): string | undefined => text.split('\n').find((line) => line.startsWith(`${shownAs}  `));

describe(`AC5 ${ID.shown} shown to you`, () => {
  it(`AC5 ${ID.shown}: the run writes the seven sentences as deep prints them, before and after, each one reworded, and reads INCONCLUSIVE unless a recorded taste call on exactly these two files says they read right`, async () => {
    if (!existsSync(BEFORE)) blocked('tests/acceptance/3498/shown/before.txt is not there: the seven sentences as the merge base prints them');
    if (!existsSync(TASTE)) blocked('tests/acceptance/3498/TASTE.json is not there: the file a person records the call in');
    const before = readFileSync(BEFORE, 'utf8');
    none(SEVEN.flatMap((s) => s.said.filter((said) => !lineFor(before, s.reads)?.includes(said)).map((said) => `shown/before.txt has no ${s.reads} line holding ${JSON.stringify(said)}`)), 'shown/before.txt holds each of the seven sentences as the issue gives it');

    const w = await fixtureRecord(ALL_SEVEN);
    const print = w.print();
    const lines = linesOf(print, w.rows, ALL_SEVEN);
    none(lines.filter((l) => l.line === undefined || !l.own).map((l) => `row ${l.id} (${l.title}) has no sentence of its own in what deep prints`), 'each of the seven sessions has its own sentence in what deep prints');
    const after = shownText(lines);
    const out = shownDir();
    writeFileSync(join(out, 'before.txt'), before);
    writeFileSync(join(out, 'after.txt'), after);
    const got = { 'before.txt': sha256(before), 'after.txt': sha256(after) };
    console.log([
      `AC5: the seven sentences as deep prints them, in ${out} (set ${SHOWN_ENV} to keep the folder):`,
      'before.txt, the merge base:', before, 'after.txt, this checkout:', after,
      'what deep prints with no arguments on this checkout:', print,
      ...Object.entries(got).map(([file, hash]) => `  ${file}  ${hash}`),
    ].join('\n'));

    none(SEVEN.flatMap((s) => s.said.filter((said) => lineFor(after, s.reads)?.includes(said)).map((said) => `the ${s.reads} row (${SESSIONS[ALL_SEVEN[SEVEN.indexOf(s)]!].title}) still prints the merge base's ${JSON.stringify(said)}`)), 'each of the seven sentences is reworded, so there is an after to show');

    const reading = tasteReading(JSON.parse(readFileSync(TASTE, 'utf8')) as Taste, got);
    if (reading?.inconclusive) inconclusive(`AC5: ${reading.inconclusive}`);
    expect(reading?.fails, reading?.fails).toBeUndefined();
  }, 10 * MIN);
});
