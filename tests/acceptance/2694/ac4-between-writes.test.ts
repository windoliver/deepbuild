// #2694.685bdd90: "A read answered between two writes sees the first write and not the second. A planted side that
// drops a kept write loses its revision and fails, naming the revision"
//
// The agent's deep_show makes a revision of its document; the hub reads the document's revisions (`revisions`, as
// hub-canvas.ts does for a render-back of the current one); the agent's second deep_show makes the next. The read
// sees the first show's revision, current, and not the second's. The planted side is twins/drops_kept_write.
import { describe, test } from 'vitest';
import { AC, DOC, FIRST, REVISIONS, SECOND, TIMEOUT, brief, isObject, must, openSide, prebuild, replyOf, show, tempDir, world } from './helpers.ts';

prebuild();

describe(`${AC[4]} a read between two writes sees the first and not the second`, () => {
  test(`${AC[4]} the document's revisions read between two deep_shows hold the first show's revision, current, and not the second's`, async () => {
    const side = await openSide(world(tempDir('ac4')));
    const first = replyOf(await side.call(show(FIRST)), 'the first deep_show');
    must(typeof first['rev'] === 'number', `the first deep_show makes a revision: ${brief(first, 600)}`);
    const between = replyOf(await side.call(REVISIONS), 'the revisions read between the two deep_shows');
    const second = replyOf(await side.call(show(SECOND)), 'the second deep_show');
    side.close();
    const rows = Array.isArray(between['revisions']) ? between['revisions'].filter(isObject) : [];
    const firstRow = rows.find((r) => r['rev'] === first['rev']);
    must(firstRow !== undefined, `the read between the two writes doesn't see revision ${String(first['rev'])} of ${DOC}, which the first deep_show made; it reads ${brief(between, 800)}`);
    must(firstRow['state'] === 'current', `the read between the two writes sees revision ${String(first['rev'])} of ${DOC} as ${brief(firstRow['state'])}, not current: ${brief(between, 800)}`);
    must(typeof second['rev'] === 'number' && second['rev'] !== first['rev'], `the second deep_show makes a revision of its own after revision ${String(first['rev'])}: ${brief(second, 600)}`);
    must(!rows.some((r) => r['rev'] === second['rev']), `the read between the two writes sees revision ${String(second['rev'])}, which only the second deep_show made: ${brief(between, 800)}`);
  }, TIMEOUT);
});
