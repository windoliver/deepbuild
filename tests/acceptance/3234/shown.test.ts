// AC11: Shown to you. Screenshots of the taste card with its count of pictures left, the same card armed, and a verdict
// line reading "answered unseen", taken by the check run from the app at the reference window, attached to the PR and
// shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays
// INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it.
//
// The app's views as the replica draws them headless at the reference window (1512 × 982 points at 2×), over a real
// hub's record: AC1's four-picture taste ask, and a second session whose claim's verdict waits on a call answered with
// `deep inbox answer`. Each picture is taken once its state is on the window's tree: the count `2 of 4 not shown yet`,
// the accepting option armed, and the session's page reading "answered unseen" (its return card holds the verdict
// line, design: view). Pictures go to $DA3234_SCREENS (a temp folder without it) with run.json, the replica binary's
// SHA-256. Then TASTE.json: no call, or one on other files, is INCONCLUSIVE; `looks_wrong` fails, quoting its note;
// `looks_right` on exactly these files passes. A kept folder holding exactly a recorded call's files, from the same
// binary, stands. "Attached to the PR and shown to you" is the implementing agent's; no test can see it.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { driveBin } from '../1101/helpers.ts';
import {
  ACCEPT, ARM_AFTER_MS, askOf, cleanup, deep, ID, inconclusive, isArmed, leftOf, look, makeWorld, MIN, openOn, optionOf, replicaOf, said,
  scrollPictures, sessionOf, sha256, SUITE, tempDir, Trace, UNSEEN, waitFor, windowWords, type Replica,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const FOUR: [number, number][] = [[800, 700], [800, 700], [800, 700], [800, 700]];
const FILES = ['count-1512x982.png', 'armed-1512x982.png', 'unseen-1512x982.png'] as const;
const expected = (): string[] => [...FILES, 'run.json'].sort();

async function shot(r: Replica, to: string): Promise<void> {
  const taken = await r.must(`a screenshot for ${to}`, { call: 'screenshot', screenshot: { target: 'window' } });
  copyFileSync(String(taken.path), to);
}

async function pictures(out: string): Promise<string[]> {
  const w = await makeWorld([
    { key: 'look', title: 'Header layout', asks: [{ key: 'four', question: 'Does the new header look right on all four pages?', pictures: FOUR }] },
    { key: 'call', title: 'Footer spacing', claim: true, asks: [{ key: 'answered', question: 'Does the footer look right on all four pages?', pictures: FOUR }] },
  ]);
  const failures: string[] = [];
  const ask = askOf(w, 'four');
  let r = await replicaOf(w);
  try {
    const trace = new Trace(ask.pictures);
    await openOn(r, ask.handle, trace);
    await r.wait(ARM_AFTER_MS + 200);
    const x = await look(r);
    trace.add(x.t, x.s);
    const left = leftOf(x.s, optionOf(x.s, ACCEPT));
    if (left?.[0] !== 2 || left[1] !== 4) failures.push(`count: the accepting option doesn't read 2 of 4 not shown yet (${said(left ?? null)})`);
    else await shot(r, join(out, FILES[0]));
    await scrollPictures(r, trace, () => ask.pictures.every((p) => trace.shown(p.sha)));
    const armed = await waitFor(r, (s) => isArmed(optionOf(s, ACCEPT)));
    if (!isArmed(optionOf(armed.s, ACCEPT))) failures.push('armed: the accepting option never armed');
    else await shot(r, join(out, FILES[1]));
  } finally {
    await r.stop();
  }
  const answered = askOf(w, 'answered');
  const said3 = await deep(w.home, ['inbox', 'answer', answered.handle, ACCEPT]);
  if (said3.code !== 0) return [...failures, `unseen: deep inbox answer was refused: ${said3.stderr.slice(-300)}`];
  r = await replicaOf(w);
  try {
    await r.open(`session/${sessionOf(w, 'call')}`);
    const page = await waitFor(r, (s) => windowWords(s).includes(UNSEEN), 3000);
    if (!windowWords(page.s).includes(UNSEEN)) failures.push(`unseen: the session's page doesn't read "${UNSEEN}"`);
    else await shot(r, join(out, FILES[2]));
  } finally {
    await r.stop();
  }
  return failures;
}

interface Taste { verdict?: string | null; who?: string | null; when?: string | null; files?: Record<string, string>; note?: string }
const sorted = (files: Record<string, string>): string => JSON.stringify(Object.fromEntries(Object.entries(files).sort()));
const fileHash = (path: string): string => sha256(readFileSync(path));

describe(`AC11 ${ID.shown} shown to you`, () => {
  it(`AC11 ${ID.shown}: the check run takes the taste card with its count of pictures left, the same card armed and a verdict line reading "answered unseen" from the app at the reference window, and reads INCONCLUSIVE unless a recorded taste call on exactly these files says they look right`, async () => {
    const out = process.env.DA3234_SCREENS ?? tempDir();
    mkdirSync(out, { recursive: true });
    const binary = fileHash(await driveBin(false));
    const taste = JSON.parse(readFileSync(join(SUITE, 'TASTE.json'), 'utf8')) as Taste;
    const files = (): Record<string, string> => Object.fromEntries(expected().filter((f) => existsSync(join(out, f))).map((f) => [f, fileHash(join(out, f))]));
    const runFile = join(out, 'run.json');
    const kept = existsSync(runFile) && (JSON.parse(readFileSync(runFile, 'utf8')) as { app?: string }).app === binary && sorted(files()) === sorted(taste.files ?? {});
    if (!kept) {
      expect(await pictures(out), 'each state is on the window\'s tree before its picture is taken').toEqual([]);
      writeFileSync(runFile, `${JSON.stringify({ issue: 3234, criterion: 'AC11', app: binary, window: '1512x982@2x' })}\n`);
    }
    const got = files();
    expect(Object.keys(got), `the run wrote every picture to ${out} (there: ${readdirSync(out).join(', ')})`).toEqual(expected());
    console.log(`AC11: pictures from this run in ${out}:\n${Object.entries(got).map(([f, h]) => `  ${f}  ${h}`).join('\n')}`);
    if (taste.verdict === null || taste.verdict === undefined) inconclusive('AC11: no taste call is recorded for these pictures (TASTE.json holds none)');
    if (!taste.who || !taste.when) inconclusive('AC11: the taste call names no one or no time');
    if (sorted(taste.files ?? {}) !== sorted(got)) inconclusive('AC11: the recorded taste call was made on other pictures than this run\'s');
    expect(taste.verdict, `the recorded taste call says they don't look right: ${taste.note ?? ''}`).toBe('looks_right');
  }, 120 * MIN);
});
