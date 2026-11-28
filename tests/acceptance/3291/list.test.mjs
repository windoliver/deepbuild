import test from 'node:test';
import { AS_LINES, assertFailsNaming, assertNotNamed, assertPasses, folderOf, json, LIST, plantedSuite, removed, runTwinsCommands, sandbox, scratchCheckout, SLOW, WHOLE } from './helpers.mjs';

const OLD_X = folderOf(9100, 'old-x');
const OLD_Y = folderOf(9100, 'old-y');
const BASE = { ...plantedSuite(9100, { 'old-x': WHOLE, 'old-y': WHOLE }), [LIST]: json([OLD_X, OLD_Y]) };

test('#3291.fefc1230 taking a twin off the list while its folder still holds a whole file fails the lint lane, naming the twin', SLOW, (t) => {
  const box = sandbox(t, 'deep-3291-');
  const cwd = scratchCheckout(box, { base: BASE, change: { [LIST]: json([OLD_Y]) } });
  const result = runTwinsCommands(box, cwd);
  assertFailsNaming(result, OLD_X);
  assertNotNamed(result, OLD_Y);
});

test('#3291.fefc1230 converting a listed twin to lines.json and leaving it on the list fails the lint lane, naming the stale entry', SLOW, (t) => {
  const box = sandbox(t, 'deep-3291-');
  const cwd = scratchCheckout(box, { base: BASE, change: { [`${OLD_X}/lines.json`]: AS_LINES['lines.json'] } });
  removed(cwd, [`${OLD_X}/src/a.mjs`]);
  const result = runTwinsCommands(box, cwd);
  assertFailsNaming(result, OLD_X);
  assertNotNamed(result, OLD_Y);
});

test('#3291.fefc1230 converting a listed twin to lines.json and taking it off the list passes the lint lane', SLOW, (t) => {
  const box = sandbox(t, 'deep-3291-');
  const cwd = scratchCheckout(box, { base: BASE, change: { [`${OLD_X}/lines.json`]: AS_LINES['lines.json'], [LIST]: json([OLD_Y]) } });
  removed(cwd, [`${OLD_X}/src/a.mjs`]);
  assertPasses(runTwinsCommands(box, cwd));
});
