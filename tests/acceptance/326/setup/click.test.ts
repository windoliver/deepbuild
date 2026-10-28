// #326 setup: "After the one Set up click, the hooks are in place in watch-only mode, and no stop is held and no
// verdict blocks until a repo's checks are approved; the fast safety rules apply from the start", and from Scope "one
// click adds the hooks in watch-only mode and starts the hub, and says so in one line".
//
// The click is `deep-app --set-up` (README: The surface), run in a fresh home where nothing is set up. It must exit 0
// and print one line; the hooks are then in place, the hub answers, and the watch-only scenario (scenario.ts) holds in
// a repo with drafted, unapproved checks. The wrong-program tests run the same checks on planted twins of the click
// (twins/) and require each to fail with its own message.

import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { TWINS, cleanup, click, draftedRepo, makeHome, onMac, oneLine, shown } from './helpers.ts';
import { watchOnlyFromTheStart } from './scenario.ts';

afterAll(cleanup, 60_000);

/** The whole criterion for one click: `app` is the built app, or a planted twin of it. */
async function setUpClick(app?: string): Promise<void> {
  onMac();
  const { home } = makeHome();
  const { repo, commit } = draftedRepo(home);
  const who = 'the Set up click (deep-app --set-up)';
  const clicked = await click(home, { app });
  if (clicked.code !== 0) expect.fail(`#326 ${who} must exit 0 once it set DeepBuild up: ${shown(clicked)}`);
  oneLine(`#326 ${who}`, clicked.stdout);
  await watchOnlyFromTheStart(home, repo, commit, who);
}

/** The failure message of the criterion's checks on a planted twin; '' when the twin passed them. */
async function failureOn(twin: string): Promise<string> {
  try {
    await setUpClick(join(TWINS, twin));
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith('BLOCKED')) throw error;
    return message;
  }
  return '';
}

describe('#326 setup: after the one Set up click the hooks are watch-only, nothing is held or blocked before approval, and the fast safety rules apply', () => {
  it('#326.523de34e the Set up click says one line; then a session that claims done and fails the drafted check stops unheld and unblocked, its next calls go through, and its pkill -f vite is denied with the hub up and down', async () => {
    await setUpClick();
  }, 600_000);

  it('#326 (control right-set-up) a right click built from merged code passes these checks', async () => {
    await setUpClick(join(TWINS, 'right-set-up'));
  }, 600_000);

  describe('wrong programs: each planted twin of the click fails these checks, with its own message', () => {
    it('#326 (wrong program chatty-set-up) a click that shows all of deep setup\'s output fails, naming the line count', async () => {
      expect(await failureOn('chatty-set-up')).toMatch(/^#326 the Set up click \(deep-app --set-up\) must say what it did in one line; it said \d+ lines/);
    }, 600_000);
    it('#326 (wrong program no-hub-set-up) a click that adds the hooks but leaves no hub running fails, naming the hub', async () => {
      expect(await failureOn('no-hub-set-up')).toMatch(/^#326 the Set up click \(deep-app --set-up\) must start the hub through its login service/);
    }, 600_000);
    it('#326 (wrong program gating-set-up) a click whose hub gates unapproved checks fails, naming the stop', async () => {
      expect(await failureOn('gating-set-up')).toMatch(/^#326 after the Set up click \(deep-app --set-up\) (the hub held|a verdict blocked) the Stop of session /);
    }, 600_000);
    it('#326 (wrong program watch-rules-set-up) a click that leaves the fast safety rules in watch mode fails, naming pkill -f vite', async () => {
      expect(await failureOn('watch-rules-set-up')).toMatch(/^#326 after the Set up click \(deep-app --set-up\) the fast safety rules must apply from the start: with the hub up DeepBuild let the agent's pkill -f vite through/);
    }, 600_000);
  });
});
