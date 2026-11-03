// The wrong programs and the positive controls (README: Wrong programs). Each runs the same scenario or judge a tagged
// test runs, on a planted program built from merged code (twins/), and requires the wrong ones to fail with their own
// message and the controls to pass. They carry no criterion tag, so the proof lanes don't count them; they pass at the
// base on purpose, showing each check is not vacuous before the implementation lands. Runs wherever the CLI runs.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  atReferenceWindow, breakSettings, cleanup, deep, deepVersion, firstScreen, fixSettings, makeHome, offeredAgain, offersSetUp,
  recordFile, rootOf, settingsFile, sha, shown, tasteCall, tempDir,
} from './helpers.ts';
import { brokenSettingsOfferedAgain, fixedFinishesOnce, hubDidntStartOfferedAgain } from './scenario.ts';

afterAll(cleanup, 60_000);

async function failsWith(f: () => unknown, pattern: RegExp): Promise<void> {
  let failure = '';
  try {
    await f();
  } catch (error) {
    failure = (error as Error).message;
    if (failure.startsWith('BLOCKED')) throw error;
  }
  expect(failure).toMatch(pattern);
}

describe('#1002 the CLI half on planted programs', () => {
  it('#1002 (control finishes-once) a first command that sets up until its record is written passes the settings and the hub scenarios', async () => {
    await fixedFinishesOnce('finishes-once');
    await hubDidntStartOfferedAgain('finishes-once');
  }, 600_000);

  it('#1002 (wrong program record-first) a setup that writes its record before planning any file fails, naming the record a stopped setup left', async () => {
    await failsWith(() => brokenSettingsOfferedAgain('record-first'), /^#1002 the first deep command \(deep status\)'s setup stopped, so it must leave no record that it finished/);
  }, 600_000);

  it('#1002 (wrong program folder-check) a first command that checks only that ~/.deepbuild exists fails, naming the next command that offered no Set up, after the settings file and after the hub', async () => {
    await failsWith(() => brokenSettingsOfferedAgain('folder-check'), /^#1002 while setup hasn't finished, the next deep command \(deep status\) must offer Set up again/);
    await failsWith(() => hubDidntStartOfferedAgain('folder-check'), /^#1002 after a setup whose hub didn't start, the next deep command \(deep status\) must offer Set up again/);
  }, 600_000);

  it('#1002 (wrong program no-version) a finished record without its version fails, naming the version', async () => {
    await failsWith(() => fixedFinishesOnce('no-version'), /record must name its version/);
  }, 600_000);
});

/** A home whose setup stopped on its settings file, through the merged `deep setup`, with ~/.deepbuild in place. */
async function stoppedOnSettings() {
  const h = makeHome();
  breakSettings(h.home);
  const r = await deep(h.home, ['setup']);
  if (r.code === 0) throw Error(`BLOCKED: the merged deep setup didn't refuse an unparseable settings file: ${shown(r)}`);
  mkdirSync(rootOf(h.home), { recursive: true });
  return h;
}

describe('#1002 the first screen\'s judges on planted first screens', () => {
  it('#1002 (control right) a first screen with Set up, the reason and its fix, and the count reading setup didn\'t finish passes; once the record exists it offers no Set up', async () => {
    const a = await stoppedOnSettings();
    const s = await firstScreen(a.home, join(a.tmp, 'out'), { twin: 'right' });
    atReferenceWindow(s);
    offeredAgain(s, { file: settingsFile(a.home) });
    const b = makeHome();
    fixSettings(b.home);
    mkdirSync(rootOf(b.home), { recursive: true });
    offeredAgain(await firstScreen(b.home, join(b.tmp, 'out'), { twin: 'right' }), 'hub');
    writeFileSync(recordFile(b.home), JSON.stringify({ version: await deepVersion(b.home) }));
    expect(offersSetUp(await firstScreen(b.home, join(b.tmp, 'out2'), { twin: 'right' }))).toBe(false);
  }, 600_000);

  it('#1002 (wrong program folder-check) the merge base\'s first screen, which keys on the folder, fails naming the count "0 asks need you"', async () => {
    const h = await stoppedOnSettings();
    const s = await firstScreen(h.home, join(h.tmp, 'out'), { twin: 'folder-check' });
    await failsWith(() => offeredAgain(s, { file: settingsFile(h.home) }), /^#1002 the count must read setup didn't finish, never 0: the first screen reads "0 asks need you"/);
  }, 600_000);

  it('#1002 (wrong program count-reads-zero) a first screen that offers Set up but whose count reads 0 fails, naming the count', async () => {
    const h = await stoppedOnSettings();
    const s = await firstScreen(h.home, join(h.tmp, 'out'), { twin: 'count-reads-zero' });
    await failsWith(() => offeredAgain(s, { file: settingsFile(h.home) }), /^#1002 the count must read setup didn't finish, never 0: the first screen reads "0 asks need you"/);
  }, 600_000);

  it('#1002 (wrong program no-reason) a first screen that offers Set up without the reason fails, naming the settings file', async () => {
    const h = await stoppedOnSettings();
    const s = await firstScreen(h.home, join(h.tmp, 'out'), { twin: 'no-reason' });
    await failsWith(() => offeredAgain(s, { file: settingsFile(h.home) }), /^#1002 reopening the app must show why setup stopped, naming /);
  }, 600_000);

  it('#1002 (control and wrong programs, taste call) the screenshots pass only with a person\'s recorded call on exactly them; none, or one on other screenshots, is INCONCLUSIVE; a call that they look wrong fails', async () => {
    const h = await stoppedOnSettings();
    const s = await firstScreen(h.home, join(h.tmp, 'out'), { twin: 'right' });
    const screens = { 'first-screen-settings.png': sha(readFileSync(s.png)) };
    const file = join(tempDir(), 'taste.json');
    const record = (o: object) => writeFileSync(file, JSON.stringify({ criterion: '#1002.1f6f1740', by: 'a person', at: '2026-11-03', screens, ...o }));
    expect(existsSync(file)).toBe(false);
    await failsWith(() => tasteCall(screens, 'out', file), /^INCONCLUSIVE: no taste call is recorded/);
    record({ call: 'looks right', screens: { 'first-screen-settings.png': sha('other bytes') } });
    await failsWith(() => tasteCall(screens, 'out', file), /^INCONCLUSIVE: the taste call .* is on other screenshots/);
    record({ call: 'looks right', by: '' });
    await failsWith(() => tasteCall(screens, 'out', file), /^INCONCLUSIVE: the taste call .* names no person/);
    record({ call: 'looks wrong', note: 'the reason is cut off' });
    await failsWith(() => tasteCall(screens, 'out', file), /^#1002 the recorded taste call says the screenshots don't look right/);
    record({ call: 'looks right' });
    tasteCall(screens, 'out', file);
  }, 600_000);
});
