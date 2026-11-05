// AC6: twenty edits by session B to a file session A changed, made during one tool call of A, reach A at its next
// tool call as one notice naming B and the latest state; a notice delivered before a hub restart is not delivered
// again after it. A hub that queues one notice per edit fails this test, naming the count.
import { afterAll, describe, it } from 'vitest';
import {
  AC6, ClaudeSession, aboutFile, decision, shown, allEvents, cleanup, fromSession, lastPos, listed, makeWorld, must, names, noticeText,
  noticesTo, settle, startHub, stopHub, toldMust, trust, worktree, type Ev,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const MARK = '  // end of cart';
/** B's edits each add one line above the marker: after the 20th, B's change is lines 3 to 22 of src/cart.js. */
const LATEST = /\b3\s*(?:-|–|—|to|\.\.|through)\s*L?22\b/i;
const FIRST_ONLY = /\b3\s*(?:-|–|—|to|\.\.|through)\s*L?3\b|\bline 3\b(?!\s*(?:-|–|—|to|\.\.|through))/i;

describe(`${AC6} twenty edits during one tool call reach the session as one notice, once`, () => {
  it(`${AC6} B's 20 edits of src/cart.js during A's \`node --test\` reach A by its next tool call as one notice naming B and lines 3-22; after a hub restart A never gets it again`, async () => {
    const w = makeWorld();
    const wa = worktree(w, 'wa', 'a/cart');
    const wb = worktree(w, 'wb', 'b/cart');
    await trust(w, [wa, wb]);
    let hub = await startHub(w);

    const a = ClaudeSession.open(w, wa);
    await a.start();
    await a.typed('Round each cart line to cents.');
    await a.edit('src/cart.js', MARK, `  rounded: true,\n${MARK}`);
    const b = ClaudeSession.open(w, wb);
    await b.start();
    await b.typed('Add the twenty cart steps.');

    // One tool call of A's, running while B makes its 20 edits.
    const since = await lastPos(hub);
    const long = await a.begin('Bash', { command: 'node --test tests/unit.test.js', description: 'run the tests' });
    must(decision(long.before) === 'allow', `BLOCKED: ${AC6} A's \`node --test tests/unit.test.js\` must be allowed: ${shown(long.before)}`);
    const during = a.fired.length;
    for (let k = 1; k <= 20; k++) await b.edit('src/cart.js', MARK, `  step${k}: ${k},\n${MARK}`);
    await a.finish(long, { stdout: 'ok', stderr: '', interrupted: false, isImage: false });
    await a.read('src/cart.js');
    const told = a.toldSince(during);

    const ofB = (events: readonly Ev[]) => noticesTo(events, a.id, since).filter((n) => fromSession(n, b.id) && aboutFile(n, 'src/cart.js'));
    let events = await settle(hub, (all) => ofB(all).length > 0, 15_000);
    const got = ofB(events);
    must(got.length === 1, `${AC6} B's 20 edits of src/cart.js during one tool call of A must reach A as one notice: A got ${got.length} notices from ${b.id} about src/cart.js: ${listed(got)}`);
    const text = noticeText(got[0]!);
    toldMust(a, during, told.includes(text), `${AC6} the notice must reach A (session ${a.id}) by its next tool call, in that call's replies: it was told ${JSON.stringify(told.slice(0, 800))}, the notice is ${JSON.stringify(text)}`);
    must(names(text, b.id), `${AC6} the notice must name session ${b.id}: ${JSON.stringify(text)}`);
    must(LATEST.test(text) && !FIRST_ONLY.test(text), `${AC6} the notice must give the latest state of B's change, lines 3 to 22 of src/cart.js after its 20th edit: ${JSON.stringify(text)}`);
    const shownToA = told.split(text).length - 1;
    must(shownToA <= 1, `${AC6} A must be told that notice once by its next tool call: it was told ${shownToA} times`);

    // A hub restart: nothing delivered before it is delivered again.
    await stopHub(hub);
    hub = await startHub(w);
    const after = a.fired.length;
    await a.read('package.json');
    await a.bash('node --test tests/unit.test.js', { stdout: 'ok' });
    await a.stop('Done.');
    await a.typed('Is the rounding right?');
    await a.read('src/cart.js');
    events = await allEvents(hub);
    const again = ofB(events);
    must(again.length === 1, `${AC6} the notice delivered before the hub restart must not be delivered again after it: A has ${again.length} notices from ${b.id} about src/cart.js: ${listed(again)}`);
    const toldAfter = a.toldSince(after);
    must(!toldAfter.includes(text) && !LATEST.test(toldAfter), `${AC6} after the restart A must not be told B's 20 edits again: it was told ${JSON.stringify(toldAfter.slice(0, 800))}`);
  }, 600_000);
});
