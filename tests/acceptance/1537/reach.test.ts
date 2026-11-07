// AC6: a shipped kind planted with no route into a gate run fails the reach test, naming the kind (issue Scope: "A hub
// that holds a kind with no route into a gate run is caught: a test lists the shipped kinds and fails on any that no
// gate run can reach"; "The hub loads the review, numbers and work check kinds as check.kind@1 fills … and a gate run
// can name any of them").
//
// The reach test (helpers.ts, `reachTest`) lists the check kinds the workspace ships, each read from its package's
// own check.kind@1 fills (command; review; numbers; service, data, document and message), and asks the real hub, over
// its socket (`checks.kinds`), which kinds it holds and the routes by which a gate run names each. It fails naming
// every shipped kind the hub doesn't hold and every held kind with no route. On the real hub it passes; on the hub
// with the planted wrong program `DEEP_HUB_PLANT=kind-without-route`, which holds the shipped `message` kind but drops
// its route, it fails naming `message`.
import { afterEach, describe, it } from 'vitest';
import { AC6, cleanup, failureOf, must, reachTest, reviewWorld, startHub, stopHub } from './helpers.ts';

afterEach(cleanup, 60_000);

const PLANT = 'kind-without-route';
const PLANTED_KIND = 'message';

describe(`${AC6} a shipped kind with no route into a gate run fails the reach test, naming the kind`, () => {
  it(`${AC6} the reach test passes on the real hub, and fails naming ${PLANTED_KIND} on the hub planted with ${PLANT}`, async () => {
    const w = reviewWorld();
    const hub = await startHub(w);
    const real = await failureOf(() => reachTest(hub));
    await stopHub(hub);
    must(real === null, `${AC6} on the real hub every shipped kind is held with a route into a gate run, and every held kind has one: ${real}`);

    const planted = await startHub(w, { plant: PLANT });
    const caught = await failureOf(() => reachTest(planted));
    await stopHub(planted);
    must(caught !== null, `${AC6} the hub planted with ${PLANT} holds ${PLANTED_KIND} with no route into a gate run, so the reach test must fail: it passed`);
    must(new RegExp(`\\bkind ${PLANTED_KIND}\\b`).test(caught), `${AC6} the reach test's failure names the kind with no route, ${PLANTED_KIND}: ${caught}`);
  }, 600_000);
});
