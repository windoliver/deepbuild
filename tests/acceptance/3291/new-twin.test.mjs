import test from 'node:test';
import { AS_LINES, assertFailsNaming, assertNotNamed, assertPasses, CHECKOUT, folderOf, json, LIST, plantedSuite, runTwinsCommands, sandbox, scratchCheckout, SLOW, WHOLE } from './helpers.mjs';

const TODAYS = folderOf(9100, 'old-x');
const BASE = { ...plantedSuite(9100, { 'old-x': WHOLE }), [LIST]: json([TODAYS]) };

test('#3291.dd8c54d0 a scratch suite that adds a whole-file twin fails the lint lane, naming the twin folder and the file it copies', SLOW, (t) => {
  const box = sandbox(t, 'deep-3291-');
  const cwd = scratchCheckout(box, { base: BASE, change: plantedSuite(9201, { 'whole-a': WHOLE }) });
  const result = runTwinsCommands(box, cwd);
  assertFailsNaming(result, folderOf(9201, 'whole-a'), 'src/a.mjs');
  assertNotNamed(result, TODAYS);
});

test('#3291.dd8c54d0 the same scratch suite with its twin kept as lines.json passes the lint lane', SLOW, (t) => {
  const box = sandbox(t, 'deep-3291-');
  const cwd = scratchCheckout(box, { base: BASE, change: plantedSuite(9201, { 'whole-a': AS_LINES }) });
  assertPasses(runTwinsCommands(box, cwd));
});

test('#3291.dd8c54d0 a scratch suite that adds a whole-file twin and puts it on the list still fails the lint lane, naming its folder and file', SLOW, (t) => {
  const box = sandbox(t, 'deep-3291-');
  const added = folderOf(9201, 'whole-a');
  const cwd = scratchCheckout(box, { base: BASE, change: { ...plantedSuite(9201, { 'whole-a': WHOLE }), [LIST]: json([TODAYS, added]) } });
  assertFailsNaming(runTwinsCommands(box, cwd), added, 'src/a.mjs');
});

test('#3291.dd8c54d0 on this checkout the lint lane passes its twins command: every whole-file twin left is on the list', SLOW, (t) => {
  const box = sandbox(t, 'deep-3291-');
  assertPasses(runTwinsCommands(box, CHECKOUT));
});
