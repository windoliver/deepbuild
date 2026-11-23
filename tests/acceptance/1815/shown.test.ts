// AC5: Shown to you. Screenshots of the field with a match marked in the lane, in light and dark, taken by the check run
// from the app at the reference window. Whether they look right is one taste call, recorded; without it the run stays
// INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it.
//
// The app's own views as the replica draws them headless at the reference window (1512 × 982 points at 2×), as #3234's:
// AC1's page with "backoff" walked to its third match. A picture is taken once its state is on the window's tree: the
// field open with the word in it, "3 of 3", and the line inside the lane; whether the mark is there is the picture's to
// show and a person's to judge. Pictures go to $DA1815_SCREENS (a temp folder without it) with run.json, the replica
// binary's SHA-256. Then TASTE.json: no call, or one on other files, is INCONCLUSIVE; `looks_wrong` fails, quoting its
// note; `looks_right` on exactly these files passes. A kept folder holding exactly a recorded call's files, from the
// same binary, stands. "Attached to the PR and shown to you" is the implementing agent's; no test can see it.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  cleanup, driveBin, field, find, ID, inconclusive, inLane, MIN, NO_FIELD, on, openPage, placeOf, said, sha256, SHORT, step, SUITE, tempDir, type, WORD,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const THEMES = ['light', 'dark'] as const;
const FILE = (theme: string): string => `find-${theme}-1512x982.png`;
const expected = (): string[] => [...THEMES.map(FILE), 'run.json'].sort();

/** The picture of `theme`, or what isn't on the tree yet. */
async function picture(theme: 'light' | 'dark', to: string): Promise<string[]> {
  return on([SHORT], { theme, every: true }, async (r) => {
    const [first, second, third] = SHORT.match as [string, string, string];
    await openPage(r, SHORT);
    if (!field(await find(r))) return [`${theme}: ${NO_FIELD(SHORT)}`];
    await type(r, WORD, '1 of 3', first);
    await step(r, 'enter', '2 of 3', second);
    const x = await step(r, 'enter', '3 of 3', third);
    if (field(x)?.value !== WORD || placeOf(x) !== '3 of 3' || !inLane(x.s, third)) return [`${theme}: the field holds ${said(field(x)?.value ?? null)} and reads ${said(placeOf(x))}, and "${third}" ${inLane(x.s, third) ? 'is' : 'isn\'t'} in the lane`];
    const taken = await r.must(`a screenshot for ${to}`, { call: 'screenshot', screenshot: { target: 'window' } });
    copyFileSync(String(taken.path), to);
    return [];
  });
}

interface Taste { verdict?: string | null; who?: string | null; when?: string | null; files?: Record<string, string>; note?: string }
const sorted = (files: Record<string, string>): string => JSON.stringify(Object.fromEntries(Object.entries(files).sort()));
const fileHash = (path: string): string => sha256(readFileSync(path));

describe(`AC5 ${ID.shown} shown to you`, () => {
  it(`AC5 ${ID.shown}: the check run takes the field with a match marked in the lane, in light and dark, from the app at the reference window, and reads INCONCLUSIVE unless a recorded taste call on exactly these files says they look right`, async () => {
    const out = process.env.DA1815_SCREENS ?? tempDir();
    mkdirSync(out, { recursive: true });
    const binary = fileHash(await driveBin(true));
    const taste = JSON.parse(readFileSync(join(SUITE, 'TASTE.json'), 'utf8')) as Taste;
    const files = (): Record<string, string> => Object.fromEntries(expected().filter((f) => existsSync(join(out, f))).map((f) => [f, fileHash(join(out, f))]));
    const runFile = join(out, 'run.json');
    const kept = existsSync(runFile) && (JSON.parse(readFileSync(runFile, 'utf8')) as { app?: string }).app === binary && sorted(files()) === sorted(taste.files ?? {});
    if (!kept) {
      const failures: string[] = [];
      for (const theme of THEMES) failures.push(...await picture(theme, join(out, FILE(theme))));
      expect(failures, 'each state is on the window\'s tree before its picture is taken').toEqual([]);
      writeFileSync(runFile, `${JSON.stringify({ issue: 1815, criterion: 'AC5', app: binary, window: '1512x982@2x' })}\n`);
    }
    const got = files();
    expect(Object.keys(got), `the run wrote every picture to ${out} (there: ${readdirSync(out).join(', ')})`).toEqual(expected());
    console.log(`AC5: pictures from this run in ${out}:\n${Object.entries(got).map(([f, h]) => `  ${f}  ${h}`).join('\n')}`);
    if (taste.verdict === null || taste.verdict === undefined) inconclusive('AC5: no taste call is recorded for these pictures (TASTE.json holds none)');
    if (!taste.who || !taste.when) inconclusive('AC5: the taste call names no one or no time');
    if (sorted(taste.files ?? {}) !== sorted(got)) inconclusive('AC5: the recorded taste call was made on other pictures than this run\'s');
    expect(taste.verdict, `the recorded taste call says they don't look right: ${taste.note ?? ''}`).toBe('looks_right');
  }, 480 * MIN);
});
