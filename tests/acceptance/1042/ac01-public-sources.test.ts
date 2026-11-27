// AC1 #1042.c144d9ce: "Over a 10-minute scripted session that logs every request, the player requests only its own
// files and the piece's declared public sources, with no cookie or credential; each value a source gives arrives as
// one input entry at the first step not yet run and shows its source and age; and a source that answers only with a
// key is refused at export, naming it"
//
// The gauge (helpers.ts: The pieces) binds a reading and declares one public source for it, a stand-in this test
// serves over https on this machine, asked every 60 s. One test a run:
//   - the session: the gauge, 10 minutes long, is exported to the web and played in headless Chrome on WebGPU from
//     its start to its `ended` event, with no seek. The source is held, so each of its values is given at a moment
//     the test chose: the first while the piece plays; the second, the same number again, while the player is held
//     paused; then none for 150 s of play; then a new number for each further request. Each value given must be one
//     more reading entry in probe()'s `readings`, stamped at the first step not yet run (exactly, while paused), with
//     an as-of time between the ask and the page showing it, and the page must show it with the source's host and its
//     age, whose words change while the value ages. Then every request of the session is judged, from the browser's
//     own record, the page-side log and both servers' records: only the bundle's own files and the declared source's
//     URL, and no cookie or credential on any request the player made, though one was planted for each host.
//   - the refusal: the same piece, bound to a second reading too, is exported with its public source alone, and then
//     with a second source that answers 401 without the made-up key: that export is refused, naming the keyed source
//     and not the public one, and writes nothing.
// Wrong programs these fail: the merge base (its player asks no source and its export reads no `web` setting); a
// player that keeps only the last value, or drops a value equal to the last; one that stamps a value at the time it
// was fetched for or at step 0; one that shows a time and no age; one that sends the browser's cookies along or a
// key; one that asks any other host; an export that admits a source it could only read with the app's key.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, EVERY, KEYED, OUTSIDE, OUTSIDE_NOW, SESSION_SECONDS, TIMEOUT, exportWeb, filesUnder, gaugeDoc, none, receiptOf, useShow, useTemp, useWeb,
  type Declared,
} from './helpers.ts';
import { keyedRefusalFailures } from './judges.ts';
import { MADE_UP_KEY, playSession, statusOf } from './web.ts';

const show = useShow();
const temp = useTemp();
const web = useWeb();

/** What the public source answers while a piece is exported, before any session. */
const AT_EXPORT = 19.5;
/** The values the held source gives over the session, in order: the second repeats the first. */
const VALUES = [20.5, 20.5, ...Array.from({ length: 14 }, (_, i) => 31.5 + i)];
/** The seconds of play with no value, over which the value shown must age. */
const OUTAGE = 150;
/** The cookies planted before the page opens, one for the bundle's host and one for the source's. Both are made up
 * here and open nothing. */
const SITE_COOKIE = { name: 'deep1042_site', value: 'made-up-cookie-for-the-bundles-host' };
const SOURCE_COOKIE = { name: 'deep1042_source', value: 'made-up-cookie-for-the-sources-host' };

describe(`${AC[1]} the player asks only for its own files and the piece's declared public sources, records each value as an input entry and shows it with its source and age; a source behind a key is refused at export`, () => {
  it(`${AC[1]} over a 10-minute scripted session whose every request is logged, the player asks only for its own files and the declared source, with no cookie or credential, and each value the source gives is one input entry at the first step not yet run, shown with its source and age`, async () => {
    const { source, certs } = await web.source();
    await source.mode('open', AT_EXPORT);
    const root = temp();
    const out = join(root, 'gauge');
    const declared: Declared[] = [{ reading: OUTSIDE, url: source.outside, every: EVERY, path: 'value' }];
    const reply = exportWeb(show(), temp(), gaugeDoc(SESSION_SECONDS), out, 'the gauge exported to the web', { sources: declared, agent: true, world: { source_ca: certs.ca } });
    receiptOf(reply, out, 'the gauge exported to the web');
    const bundle = await web.serve(root);
    const browser = await web.browser([certs.pin]);

    const read = await playSession(browser, bundle, source, {
      url: `${bundle.origin}/gauge/index.html`, base: `${bundle.origin}/gauge/`, files: filesUnder(out),
      reading: OUTSIDE, bound: OUTSIDE_NOW, duration: SESSION_SECONDS, every: EVERY, outage: OUTAGE, least: 3, values: VALUES,
      site: { ...SITE_COOKIE, url: `${bundle.origin}/`, secure: false }, third: { ...SOURCE_COOKIE, url: `${source.origin}/`, secure: true },
    });
    none(read.failures, `over the ${SESSION_SECONDS} s session (the source was asked ${read.asked} times and gave ${JSON.stringify(read.given)}${read.left.length ? `; left out of the page's record as the browser's own: ${read.left.join(', ')}` : ''}) the player asks only for its own files and its declared source, with no cookie or credential, and each value is one input entry at the first step not yet run, shown with its source and age`);
    expect(read.given.length, 'the source gave values over the session').toBeGreaterThanOrEqual(3);
  }, TIMEOUT);

  it(`${AC[1]} a source that answers only with a key is refused at export, naming it and not the source that needs none`, async () => {
    const { source, certs } = await web.source();
    await source.mode('open', AT_EXPORT);
    // The stand-ins are what the criterion names: one answers anyone, the other only with the key.
    expect(await statusOf(source.outside, certs), 'the public stand-in answers with no key').toBe(200);
    expect(await statusOf(source.keyed, certs), 'the keyed stand-in refuses a request with no key').toBe(401);
    expect(await statusOf(source.keyed, certs, MADE_UP_KEY), 'the keyed stand-in answers with the key').toBe(200);

    const world = { source_ca: certs.ca, secrets: { keyed_source: MADE_UP_KEY } };
    const open: Declared = { reading: OUTSIDE, url: source.outside, every: EVERY, path: 'value' };
    const keyed: Declared = { reading: KEYED, url: source.keyed, every: EVERY, path: 'value' };
    const evidence = temp();
    const root = temp();
    // The piece with its public source alone is exported, so the refusal below is for the key and nothing else.
    const alone = exportWeb(show(), evidence, gaugeDoc(4, true), join(root, 'alone'), 'the gauge with its public source alone', { sources: [open], agent: true, world });
    receiptOf(alone, join(root, 'alone'), 'the gauge with its public source alone');

    const out = join(root, 'keyed');
    const reply = exportWeb(show(), evidence, gaugeDoc(4, true), out, 'the gauge with a source behind a key', { sources: [open, keyed], agent: true, world });
    none(keyedRefusalFailures(reply, KEYED, OUTSIDE), 'the export of a piece with a source that answers only with a key is refused, naming that source');
    expect(filesUnder(root).filter((f) => !f.startsWith('alone/')), 'a refused export writes nothing: its folder holds the bundle exported before it and no other file').toEqual([]);
  }, TIMEOUT);
});
