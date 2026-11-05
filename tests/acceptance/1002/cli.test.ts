// #1002, the CLI half (README): "Setup writes a record that it finished, with its version, as its last step; the app
// and the first `deep` command offer Set up while that record is missing, whatever else exists." Runs wherever the
// CLI and the hub run (macOS and Linux): the login service is the stand-in setup reaches through DEEP_HUB_LAUNCHER.

import { afterAll, describe, it } from 'vitest';
import { cleanup } from './helpers.ts';
import { brokenSettingsOfferedAgain, fixedFinishesOnce, hubDidntStartOfferedAgain } from './scenario.ts';

afterAll(cleanup, 60_000);

describe('#1002 the first deep command offers Set up again until setup finished', () => {
  it('#1002.4273b842 with Claude Code\'s settings file unparseable, the first deep command\'s setup fails naming the file and writes no finished record, and the next deep command, ~/.deepbuild in place, offers Set up again and fails on the same file', async () => {
    await brokenSettingsOfferedAgain();
  }, 600_000);

  it('#1002.8e3f037e after the file is fixed, the next deep command sets up, finishes and writes its record with its version, and the deep command after that runs no setup', async () => {
    await fixedFinishesOnce();
  }, 600_000);

  it('#1002.8e3f037e a setup whose hub doesn\'t start writes no finished record and is offered again by the next deep command, which finishes it and writes its record; the one after runs no setup', async () => {
    await hubDidntStartOfferedAgain();
  }, 600_000);
});
