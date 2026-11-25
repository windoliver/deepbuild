// #3065 AC1, AC2 (the record's half) and AC4: what one recording run of the unit lane writes to
// ~/.deepbuild/reach/<tree>.json. Written blind from issue #3065 at base c7dc0edc3 (README). One fixture and one
// recording serve every test of this file.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { BINARIES, binariesOf, binaryIn, cleanup, CLI, filesOf, HOOK_HELPER, HUB, isRepoPath, recorded, rowsOf, show, strings, T, TEST, theRecord } from './helpers.mjs';

after(cleanup);

test('#3065.AC1 a test that imports a helper naming deep-hook and never starts it has no binary in the record, and its twin that starts it has deep-hook', TEST, async () => {
  const shared = await recorded();
  const { json, path } = theRecord(shared);
  const { fx } = shared;
  // The twin first: a record that lists no binary for anyone proves nothing about the first test.
  assert.ok(rowsOf(fx, json, T.hookStarted).length >= 1, `${T.hookStarted} ran and has no row in ${path}:\n${show(json)}`);
  assert.deepEqual(binariesOf(fx, json, T.hookStarted), ['deep-hook'], `${T.hookStarted} started deep-hook from DEEP_BIN_DIR, and the record lists ${show(binariesOf(fx, json, T.hookStarted))} for it: ${show(rowsOf(fx, json, T.hookStarted))}`);
  // The first test ran, and loaded the helper that names deep-hook.
  assert.ok(rowsOf(fx, json, T.hookNamed).length >= 1, `${T.hookNamed} ran and has no row in ${path}:\n${show(json)}`);
  assert.ok(filesOf(fx, json, T.hookNamed).includes(HOOK_HELPER), `${T.hookNamed} loaded ${HOOK_HELPER}, and the record lists these files for it: ${show(filesOf(fx, json, T.hookNamed))}`);
  assert.deepEqual(binariesOf(fx, json, T.hookNamed), [], `${T.hookNamed} imports the helper that names deep-hook and never starts it, and the record lists ${binariesOf(fx, json, T.hookNamed).join(', ')} for it: ${show(rowsOf(fx, json, T.hookNamed))}`);
});

test('#3065.AC1 a test that starts deep-hook by its path under target/ has deep-hook in the record', TEST, async () => {
  const shared = await recorded();
  const { json, path } = theRecord(shared);
  const { fx } = shared;
  assert.ok(rowsOf(fx, json, T.hookTarget).length >= 1, `${T.hookTarget} ran and has no row in ${path}:\n${show(json)}`);
  assert.deepEqual(binariesOf(fx, json, T.hookTarget), ['deep-hook'], `${T.hookTarget} started target/debug/deep-hook, and the record lists ${show(binariesOf(fx, json, T.hookTarget))} for it: ${show(rowsOf(fx, json, T.hookTarget))}`);
});

for (const [which, title, why] of [['unrun', "didn't run", "didn't run (the unit lane never reads its folder)"], ['skipped', 'was skipped', 'was skipped (its only test is)'], ['killed', 'had its process killed', 'had its process killed']]) {
  test(`#3065.AC2 a test file that ${title} has no row in the record`, TEST, async () => {
    const shared = await recorded();
    const { json, path } = theRecord(shared);
    const { fx } = shared;
    // A file that ran has a row, so an empty record is not what passes here.
    assert.ok(rowsOf(fx, json, T.hubLoaded).length >= 1, `${T.hubLoaded} ran and has no row in ${path}:\n${show(json)}`);
    assert.deepEqual(rowsOf(fx, json, T[which]), [], `${T[which]} ${why}, and the record has a row for it`);
  });
}

test('#3065.AC4 the record holds no file content, argument or environment value: paths and binary names only', TEST, async () => {
  const shared = await recorded();
  const { json, text, path } = theRecord(shared);
  const { fx, tokens } = shared;
  // The processes that carried the planted values are in the record, so their absence below is not an empty record's.
  assert.deepEqual(binariesOf(fx, json, T.hookStarted), ['deep-hook'], `${T.hookStarted} started deep-hook with a planted argument and environment value, and the record lists ${show(binariesOf(fx, json, T.hookStarted))} for it`);
  for (const file of [HUB, CLI]) assert.ok(filesOf(fx, json, T.hubChild).includes(file), `${T.hubChild} started a node process that loaded ${file}, with a planted argument and environment value, and the record lists these files for it: ${show(filesOf(fx, json, T.hubChild))}`);
  assert.ok(filesOf(fx, json, T.hubLoaded).includes(HUB), `${T.hubLoaded} loaded ${HUB}, whose source holds the planted content, and the record lists these files for it: ${show(filesOf(fx, json, T.hubLoaded))}`);
  for (const [kind, what] of [['content', 'file content: a line of the sources the tests loaded'], ['argument', 'an argument: one the tests gave deep-hook and a node process'], ['environment', 'an environment value: one of the recording run and of the processes the tests started']]) {
    assert.ok(!text.includes(tokens[kind]), `${path} holds ${what} (${tokens[kind]})`);
  }
  // Paths and binary names only: every string of a test's row is a workspace binary or a file of the checkout.
  for (const file of [T.hookNamed, T.hookStarted, T.hookTarget, T.hubLoaded, T.hubChild, T.hubNamed, T.canvasStarted, T.canvasNamed]) {
    const rows = rowsOf(fx, json, file);
    assert.ok(rows.length >= 1, `${file} ran and has no row in ${path}`);
    const other = rows.flatMap(strings).filter((value) => !binaryIn(value) && !isRepoPath(fx, value));
    assert.deepEqual(other, [], `the row of ${file} holds what is neither a workspace binary (${BINARIES.join(', ')}) nor a path of the checkout: ${show(rows)}`);
  }
});
