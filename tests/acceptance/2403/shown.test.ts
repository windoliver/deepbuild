// AC7: Shown to you: screenshots of Needs you with a question card, a session's page and the empty state, in both
// languages, taken by the check run from the app at the reference window, are attached to the PR and shown to you in the
// session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no
// criterion above reads a picture to judge it.
//
// The real `deep-app` as shipped, over a real hub's record (helpers.ts RICH: Needs you opens on the approval's card; and
// a world with no session, for the empty state), started with the system's preferred languages set for its one process
// (`-AppleLanguages "(zh-Hans-CN, en-US)"`, and "(en-US)"; README, Surface 6), driven from outside its process (#1808's
// RealApp and probe), its window set to the reference window, 1512 × 982. Each picture is taken only once its state is on
// the window's tree: the card (`question-card`), the session's page (its address), the empty state's line (`empty`), and in
// zh-Hans a word of the zh-Hans table. Pictures go to $DA2403_SCREENS (a temp folder without it) with run.json, the app's
// SHA-256. Then TASTE.json is read: no call, or one on other files, is INCONCLUSIVE; `looks_wrong` fails, quoting its
// note; `looks_right` on exactly these files passes. A kept folder holding exactly a recorded call's files, from this same
// app binary, stands, so the run doesn't take them again. "Attached to the PR and shown to you" is the implementing
// agent's; no test can see it. Nothing here judges a picture.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { stopHub } from '../16/helpers.ts';
import { inconclusive, RealApp, realAppAccess, screens, settled, sha256File } from '../1808/helpers.ts';
import { appPlain, blocked, cleanup, HAN, ID, makeWorld, MIN, REFERENCE, RICH, sessionOf, strings, SUITE, tables, tempDir, withLanguages } from './helpers.ts';

afterAll(cleanup, 60_000);
const LANGUAGES = { 'en-US': ['en-US'], 'zh-Hans': ['zh-Hans-CN', 'en-US'] } as const;
const STATES = ['needs-you-card', 'session-page', 'empty-state'] as const;
const FILES = Object.keys(LANGUAGES).flatMap((locale) => STATES.map((state) => `${state}-${locale}.png`));
const expected = (): string[] => [...FILES, 'run.json'].sort();

async function pictures(binary: string, out: string): Promise<string[]> {
  const failures: string[] = [];
  const t = tables();
  const zhWords = typeof t === 'string' ? [] : Object.values(t.zh).flatMap((e) => strings(e.text)).filter((s) => HAN.test(s) && !/\{\d\}/.test(s));
  const asks = await makeWorld(RICH, 'live');
  const empty = await makeWorld([], 'live');
  const session = sessionOf(asks, 'tidy');
  for (const [locale, languages] of Object.entries(LANGUAGES)) {
    for (const [state, world] of [['needs-you-card', asks], ['session-page', asks], ['empty-state', empty]] as const) {
      const name = `${state}-${locale}.png`;
      const app = await RealApp.launch(world.home, withLanguages(binary, languages));
      try {
        const display = (await screens())[0] ?? blocked('no display to draw the window on');
        await app.place(display[0]! + 32, display[1]! + 64, REFERENCE.width, REFERENCE.height);
        if (state === 'session-page') await app.pressId(`session:${session.id}`);
        const missing = await settled(async () => {
          const nodes = await app.nodes();
          const problems: string[] = [];
          if (state === 'needs-you-card' && !nodes.some((n) => n.identifier === 'question-card')) problems.push('the question card (question-card) isn\'t on the tree');
          if (state === 'session-page' && (await app.address()) !== `session/${session.id}`) problems.push(`the window doesn't show session/${session.id}`);
          if (state === 'empty-state' && !nodes.some((n) => n.identifier === 'empty')) problems.push('the empty state\'s line (empty) isn\'t on the tree');
          if (locale === 'zh-Hans' && !nodes.some((n) => [n.title, n.description, n.value].some((x) => !!x && zhWords.some((z) => x.includes(z))))) problems.push('the tree holds no word of the zh-Hans table');
          return problems;
        }, 30_000);
        if (missing.length) {
          failures.push(`${name}: ${missing[0]}`);
          continue;
        }
        await app.front();
        await new Promise((resolve) => setTimeout(resolve, 800));
        await app.capture(join(out, name));
      } finally {
        await app.stop();
      }
    }
  }
  await stopHub(asks.hub);
  await stopHub(empty.hub);
  return failures;
}

interface Taste { verdict?: string | null; who?: string | null; when?: string | null; files?: Record<string, string>; note?: string }
const sorted = (files: Record<string, string>): string => JSON.stringify(Object.fromEntries(Object.entries(files).sort()));

describe(`AC7 ${ID.shown} shown to you`, () => {
  it(`AC7 ${ID.shown}: the check run takes Needs you with a question card, a session's page and the empty state, in en-US and in zh-Hans, from the real app at the reference window, and reads INCONCLUSIVE unless a recorded taste call on exactly these files says they look right`, async () => {
    await realAppAccess({ pictures: true });
    const out = process.env.DA2403_SCREENS ?? tempDir();
    mkdirSync(out, { recursive: true });
    const binary = await appPlain();
    const app = sha256File(binary);
    const taste = JSON.parse(readFileSync(join(SUITE, 'TASTE.json'), 'utf8')) as Taste;
    const files = (): Record<string, string> => Object.fromEntries(expected().filter((f) => existsSync(join(out, f))).map((f) => [f, sha256File(join(out, f))]));
    const runFile = join(out, 'run.json');
    const kept = existsSync(runFile) && (JSON.parse(readFileSync(runFile, 'utf8')) as { app?: string }).app === app && sorted(files()) === sorted(taste.files ?? {});
    if (!kept) {
      expect(await pictures(binary, out), 'each state is on the real window\'s tree before its picture is taken').toEqual([]);
      writeFileSync(runFile, `${JSON.stringify({ issue: 2403, criterion: 'AC7', app })}\n`);
    }
    const got = files();
    expect(Object.keys(got), `the run wrote every picture to ${out} (there: ${readdirSync(out).join(', ')})`).toEqual(expected());
    console.log(`AC7: pictures from this run in ${out}:\n${Object.entries(got).map(([f, h]) => `  ${f}  ${h}`).join('\n')}`);
    if (taste.verdict === null || taste.verdict === undefined) inconclusive('AC7: no taste call is recorded for these pictures (TASTE.json holds none)');
    if (!taste.who || !taste.when) inconclusive('AC7: the taste call names no one or no time');
    if (sorted(taste.files ?? {}) !== sorted(got)) inconclusive('AC7: the recorded taste call was made on other pictures than this run\'s');
    expect(taste.verdict, `the recorded taste call says they don't look right: ${taste.note ?? ''}`).toBe('looks_right');
  }, 120 * MIN);
});
