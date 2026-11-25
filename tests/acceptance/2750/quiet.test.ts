// AC5 #2750.099939a8: "The reading posts no status, raises no ask and sends no notification, read from the recorded
// calls. A planted reader that posts a status on an unjudged commit fails this test, naming the call"
//
// The run is one in which the reading was made and a status could have been posted: the repo's delivery rule is on
// (#46's `github.delivery`), the hub holds a token, and the forge takes a status on any commit it holds, which the
// test's own POST shows at the end. The recorded calls are the forge's (`forge.calls`: every call it received) and the
// record's events since the hub started (`events.read`): a status is a POST of one, an ask an `ask.created`, a
// notification a `notice.sent` or `notice.delivered`. Nothing but a GET may have reached the forge.
//
// Wrong programs: the merge base, which makes no such reading, so the run it is shown on doesn't exist there; the twin
// status-on-unjudged, on which the failure names the POST and the unjudged commit (twins/README.md).
import { afterAll, describe, expect, it } from 'vitest';
import { REPO_NAME, Shop } from './fixture.ts';
import { AC5, cleanup, eventsRead, numbersRead, TIMEOUT, TOKEN, World } from './helpers.ts';
import { judgeLanded, judgeQuiet } from './judges.ts';

afterAll(cleanup, 120_000);

describe(`${AC5} it is a reading: it posts nothing to GitHub, raises no ask and sends no notification`, () => {
  it(`${AC5} making and listing the reading posts no status, raises no ask and sends no notification, read from the forge's recorded calls and the record`, async () => {
    const w = await World.make((dir) => Shop.build(dir));
    const { expected, forge, unjudged } = w.fixture;
    const hub = await w.start();
    const before = (await eventsRead(hub)).at(-1)?.log_pos ?? 0;
    const made = judgeLanded((await w.read()).reading, REPO_NAME, expected);
    expect(made, `the reading must have been made in this run, three of its commits unjudged, or posting nothing shows nothing:\n${made.join('\n')}\n`).toEqual([]);
    // Listed once more, then made and listed again: a post made after a reply is still this reading's, and it left the
    // hub before the hub's next reads of the same forge, which the forge has answered by then (README: Readings, 17).
    await numbersRead(hub);
    await w.read();

    const failures = judgeQuiet(forge.calls, (await eventsRead(hub)).filter((e) => e.log_pos > before), unjudged);
    expect(failures, `nothing but GETs may reach the forge, and the record may take no ask and no notification, while the reading is made and listed:\n${failures.join('\n')}\n`).toEqual([]);
    expect(forge.calls.some((c) => c.method === 'GET' && c.status === 200), 'the forge was read in this run').toBe(true);
    // The forge could have been posted to: the same POST, made here with the hub's token on an unjudged commit, lands.
    const posted = await fetch(`${forge.url}/repos/${REPO_NAME}/statuses/${unjudged[0]!}`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ state: 'pending', context: 'deepbuild/verdict', description: 'the test\'s own' }) });
    expect(posted.status, 'the forge takes a status on an unjudged commit from the hub\'s token').toBe(201);
  }, TIMEOUT);
});
