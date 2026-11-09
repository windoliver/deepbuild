// #1556, the lint (README): a planted `Command::output` in deep-app's UI code, in a scratch copy of the checkout, must
// fail the lint lane naming its line. The lane's commands are read from the copy's scripts/lanes.mjs and run there,
// clippy narrowed to deep-app (README: How the lint lane runs). Runs on macOS and Linux.

import { afterAll, describe, it } from 'vitest';
import { cleanup, judgeLint, lintCommands, narrowed, plant, plantIsFormatted, PLANT_FILE, runLint, scratchCopy } from './helpers.ts';

afterAll(cleanup, 60_000);

describe('#1556 a lint bans blocking process calls in deep-app\'s UI code', () => {
  it('#1556.3f28018e a planted Command::output in deep-app\'s UI code fails the lint lane, naming the line', async () => {
    const dest = scratchCopy();
    const line = plant(dest);
    plantIsFormatted(dest);
    judgeLint(await runLint(dest, narrowed(lintCommands(dest)), PLANT_FILE, line), PLANT_FILE, line);
  }, 3_600_000);
});
