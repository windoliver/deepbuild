// #326 setup, Scope: "one click adds the hooks in watch-only mode and starts the hub ...; the first `deep` command does
// the same without a click". Design (the DeepBuild app row): "one click runs the same steps as `deep setup`".
//
// Three fresh homes: one set up by the click, one by the first `deep` command, one by `deep setup` (#19's merged
// surface, the reference). Each leaves the hub answering and the same installed state (helpers.ts installedState: the
// drafted settings, the hook entries, the status line, the MCP server, the guard entries, the login service and the
// skill, with each home's temp folder written `<tmp>`). After the click, the first `deep` command sets nothing up
// again: the click already did.

import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  TWINS, cleanup, click, deepSetup, firstCommand, installedHub, installedState, makeHome, onMac, setsNothingUpAgain, shown, written, type Line,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const CLICK = 'the Set up click (deep-app --set-up)';
const FIRST = 'the first deep command (deep status)';

/** Fails naming `who` and each part of the state that differs from `deep setup`'s. */
function sameAs(who: string, got: Line, want: Line): void {
  const differ = Object.keys(want).filter((k) => JSON.stringify(got[k]) !== JSON.stringify(want[k]));
  if (differ.length) {
    expect.fail(`#326 ${who} must leave the same state as deep setup: ${differ.map((k) => `${k} differs (${who}: ${JSON.stringify(got[k]).slice(0, 400)}; deep setup: ${JSON.stringify(want[k]).slice(0, 400)})`).join('; ')}`);
  }
}

async function threeWaysIn(app?: string, deepBin?: string): Promise<void> {
  onMac();
  const byClick = makeHome();
  const clicked = await click(byClick.home, { app });
  if (clicked.code !== 0) expect.fail(`#326 ${CLICK} must exit 0 once it set DeepBuild up: ${shown(clicked)}`);
  await installedHub(byClick.home, `#326 ${CLICK}`);

  const reference = makeHome();
  const set = await deepSetup(reference.home);
  if (set.code !== 0) throw Error(`BLOCKED: deep setup, the reference, didn't set up: ${shown(set)}`);
  await installedHub(reference.home, 'deep setup (the reference)');
  const want = installedState(reference.home);
  if (!(want.hooks as unknown[]).length) throw Error(`BLOCKED: deep setup, the reference, installed no hook entries: ${JSON.stringify(want).slice(0, 1000)}`);

  sameAs(CLICK, installedState(byClick.home), want);

  const byFirst = makeHome();
  const first = await firstCommand(byFirst.home, { deepBin });
  if (first.code !== 0) expect.fail(`#326 ${FIRST} must set DeepBuild up and then do its own job, exit 0: ${shown(first)}`);
  await installedHub(byFirst.home, `#326 ${FIRST}`);
  sameAs(FIRST, installedState(byFirst.home), want);

  // The click already set up, so the first deep command after it sets nothing up again.
  const before = written(byClick.home);
  const after = await firstCommand(byClick.home, { deepBin });
  if (after.code !== 0) expect.fail(`#326 the first deep command after the click (deep status) must do its own job, exit 0: ${shown(after)}`);
  setsNothingUpAgain('the first deep command after the click (deep status)', after, before, written(byClick.home));
}

describe('#326 setup: the click, the first deep command and deep setup leave the same state', () => {
  it('#326.523de34e the Set up click and the first deep command each leave what deep setup leaves, and a deep command after the click sets nothing up again', async () => {
    await threeWaysIn();
  }, 600_000);

  it('#326 (control right-set-up, deep-sets-up-once) right programs built from merged code pass these checks', async () => {
    await threeWaysIn(join(TWINS, 'right-set-up'), join(TWINS, 'deep-sets-up-once'));
  }, 600_000);

  it('#326 (wrong program partial-set-up) a click that leaves out a step of deep setup (the status line forwarder) fails, naming the part', async () => {
    let failure = '';
    try {
      await threeWaysIn(join(TWINS, 'partial-set-up'));
    } catch (error) {
      failure = (error as Error).message;
      if (failure.startsWith('BLOCKED')) throw error;
    }
    expect(failure).toMatch(/^#326 the Set up click \(deep-app --set-up\) must leave the same state as deep setup: statusLine differs/);
  }, 600_000);
});
