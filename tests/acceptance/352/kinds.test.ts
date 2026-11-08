// AC3: every notice names its kind of change: an interface, a dependency, a behavior, a test or a configuration. Two
// Claude Code sessions change the same two files, package.json (a dependency) and tests/cart.test.js (a test); every
// notice either hears (at start, before an edit, after the sibling's PR merges) must carry one of the five kinds and
// say it in its own words, and the merge's notices must call package.json's change a dependency and the test file's a
// test.
import { afterAll, describe, it } from 'vitest';
import {
  AC3, ClaudeSession, MERGE_SETTLE_MS, TYPES, aboutFile, allEvents, allNotices, cleanup, commitAll, fromSession, lastPos,
  listed, makeWorld, mergePr, must, noticeText, noticesTo, settle, sleep, startHub, trust, typesNamed, worktree, type Ev,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const CART_TEST = "const test = require('node:test');\nconst assert = require('node:assert');\nconst cart = require('../src/cart.js');\ntest('an empty cart totals 0', () => {\n  assert.strictEqual(cart.total([]), 0);\n});\n";
const DEPS = '"dependencies": {}';
/** A notice's own words: its text with every path-like token (anything holding a / or a .) taken out, so a file name never names a kind for it. */
const ownWords = (n: Ev): string => noticeText(n).replace(/\S*[/.]\S*/g, ' ');

describe(`${AC3} every notice names its kind of change`, () => {
  it(`${AC3} every notice carries one of the five kinds and says it; after #45 merges, package.json's notice is a dependency change and tests/cart.test.js's a test change`, async () => {
    const w = makeWorld({ files: { 'tests/cart.test.js': CART_TEST } });
    const wa = worktree(w, 'wa', 'a/deps');
    const wb = worktree(w, 'wb', 'b/deps');
    await trust(w, [wa, wb]);
    const hub = await startHub(w);

    const a = ClaudeSession.open(w, wa);
    await a.start();
    await a.typed('Add dayjs and a test for an empty cart.');
    await a.edit('package.json', DEPS, '"dependencies": { "dayjs": "1.11.13" }');
    await a.edit('tests/cart.test.js', "test('an empty cart totals 0'", "test('an empty cart totals zero'");

    const b = ClaudeSession.open(w, wb);
    await b.start();
    await b.typed('Add left-pad and a test for one line.');
    await b.edit('package.json', DEPS, '"dependencies": { "left-pad": "1.3.0" }');
    await b.edit('tests/cart.test.js', '});\n', "});\ntest('one line totals itself', () => {\n  assert.strictEqual(cart.total([2]), 2);\n});\n");
    await b.bash('git commit -am "Add left-pad"', { effect: () => commitAll(wb, 'Add left-pad') });
    await b.stop('Done.');

    mergePr(w, 'b/deps', 45, 'Add left-pad');
    await sleep(MERGE_SETTLE_MS);
    const pos = await lastPos(hub);
    await a.read('package.json');
    const events = await settle(hub, (all) => noticesTo(all, a.id, pos).filter((n) => fromSession(n, b.id)).length >= 2, 15_000);

    const merged = noticesTo(events, a.id, pos).filter((n) => fromSession(n, b.id));
    const dep = merged.find((n) => aboutFile(n, 'package.json') && n.data.type === 'dependency');
    must(dep !== undefined, `${AC3} after #45 merged over package.json, session ${a.id} must get a notice from ${b.id} about package.json whose kind is dependency: it got ${listed(merged)}`);
    const test = merged.find((n) => aboutFile(n, 'tests/cart.test.js') && n.data.type === 'test');
    must(test !== undefined, `${AC3} after #45 merged over tests/cart.test.js, session ${a.id} must get a notice from ${b.id} about tests/cart.test.js whose kind is test: it got ${listed(merged)}`);

    const all = allNotices(await allEvents(hub));
    must(all.length >= 2, `${AC3} the record must hold the notices the sessions heard: ${listed(all)}`);
    for (const n of all) {
      must((TYPES as readonly string[]).includes(String(n.data?.type)), `${AC3} notice ${n.data?.notice ?? n.id} must carry its kind, one of ${TYPES.join(', ')}: its type is ${JSON.stringify(n.data?.type)} (${JSON.stringify(n.data).slice(0, 400)})`);
      must(typesNamed(ownWords(n)).includes(String(n.data.type)), `${AC3} notice ${n.data?.notice ?? n.id} must say its kind (${String(n.data.type)}) in its words, not only in a file name: ${JSON.stringify(noticeText(n))}`);
    }
  }, 600_000);
});
