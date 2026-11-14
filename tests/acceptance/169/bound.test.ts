// AC4 #169.acd10c7d: "A bound value shows as text with its as-of time, and a page whose redaction is incomplete waits
// for your approval before it leaves the machine"
//
// asserts:
//   - the bound reading (a text whose words the bound value `price_now` fills from the agent's reading, value 42 as of
//     2026-11-12T09:30:00Z: #162's world) exports as a page; opened in the browser with networking off, the page shows
//     `price_now` as text holding 42, with a <time> whose datetime is that as-of time and whose text isn't empty
//     (README: The page's DOM), and requests nothing outside its own files. Wrong program: the same page with its
//     as-of time taken out (a DOM change made here after it loads), which fails naming the as-of time.
//   - the photo (an image whose asset's redaction is incomplete) exports as a page whose receipt says `redaction:
//     incomplete` and lists every file the page wrote, each in the evidence store by its hash; the agent's send of
//     those files to a local listener (#105's `send`) is `waiting` and delivers nothing; after your `approve` it is
//     `sent` and the listener got each file once, by its bytes. Each step is its own run replaying the ones before (as
//     #105's suite drives a send). Wrong program: #105's planted `sends_without_approval` (the scenario's `planted`),
//     which fails naming a file's hash.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, AGENT, AS_OF, BOUND, DOC, FULL, Headless, Listener, READING_VALUE, TIMEOUT, arr, boundDoc, failsNaming, filesUnder, hex64, none, obj, pageExport, pageReceiptOf, photoDoc, present, presented, putEvidence, runShow, scenarioOf, sha256, show, solidPng, str, useShow, useTemp,
  type JsonObject, type WebPage,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

/** What is wrong with the bound value as the page shows it. */
async function boundFailures(page: WebPage): Promise<string[]> {
  const b = await page.bound(BOUND);
  if (!b) return [`the page shows no element for the bound value ${BOUND} (data-deep-bound)`];
  const f: string[] = [];
  if (!b.visible) f.push(`the bound value ${BOUND} doesn't show`);
  if (!b.text.includes(String(READING_VALUE))) f.push(`the bound value ${BOUND} shows "${b.text.trim()}", not its value ${READING_VALUE}`);
  const asOf = b.times.find((t) => Date.parse(t.datetime) === AS_OF);
  if (!asOf) f.push(`the bound value ${BOUND} shows no as-of time ${new Date(AS_OF).toISOString()}; its times: ${JSON.stringify(b.times)}`);
  else if (!asOf.text) f.push(`the bound value ${BOUND}'s as-of time ${asOf.datetime} has no text to read`);
  return f;
}

interface Sent { state: string; id: string }
const sendOf = (reply: JsonObject | undefined, what: string): Sent => {
  const s = obj(obj(reply, what)['send'], `${what}: send`);
  return { state: str(s['state'], `${what}: send.state`), id: str(s['id'], `${what}: send.id`) };
};

describe(`${AC[4]} a bound value as text with its as-of time; a page whose redaction is incomplete waits for your approval`, () => {
  it(`${AC[4]} the bound reading's page shows its value as text with its as-of time, read in a browser with networking off`, async () => {
    const out = join(temp(), 'page');
    const r = runShow(shows(FULL), scenarioOf({ evidence: temp(), docs: [DOC.bound], calls: [present(DOC.bound, boundDoc(), { agent: true }), pageExport(DOC.bound, out)] }), 'the bound reading\'s page');
    presented(r[0], 'the bound reading');
    pageReceiptOf(r[1], 'the bound reading\'s page');
    const h = await Headless.open();
    try {
      const page = await h.load(out, 'the bound reading\'s page');
      const failures = await boundFailures(page);
      failures.push(...page.outside().map((u) => `the page requested ${u}, outside its own files`));
      none(failures, 'the bound value as text with its as-of time');
      // Wrong program: the same page without its as-of time.
      await page.evaluate(`document.querySelectorAll('[data-deep-bound="${BOUND}"] time, time[data-deep-bound="${BOUND}"]').forEach((t) => t.remove())`);
      failsNaming(await boundFailures(page), new Date(AS_OF).toISOString(), 'the page with its as-of time taken out');
    } finally { await h.close(); }
  }, TIMEOUT);

  it(`${AC[4]} the photo's page, its redaction incomplete, waits for your approval before its files leave, then leaves once`, async () => {
    const failures = async (planted?: string): Promise<string[]> => {
      const what = planted ? `the photo's page (planted ${planted})` : 'the photo\'s page';
      const evidence = temp();
      const photo = putEvidence(evidence, solidPng(96, 64, [180, 60, 40]));
      const listener = new Listener();
      const to = `http://127.0.0.1:${await listener.start()}/pages`;
      try {
        // Each run exports the page afresh into a folder of its own; the evidence store is the runs' one store.
        let out = '';
        const run = (calls: JsonObject[], step: string): JsonObject[] => {
          out = join(temp(), 'page');
          const head: JsonObject[] = [present(DOC.photo, photoDoc(photo), { agent: true }), pageExport(DOC.photo, out)];
          const r = runShow(shows(FULL), scenarioOf({ evidence, docs: [DOC.photo], calls: [...head, ...calls], ...(planted ? { planted } : {}) }), `${what}: ${step}`);
          presented(r[0], `${what}: the photo`);
          return r;
        };
        // The export, and the agent's send of its files.
        const r1 = run([], 'the export');
        const receipt = pageReceiptOf(r1[1], `${what}: the export`).raw;
        expect(receipt['redaction'], `${what}: the receipt says the page's redaction is incomplete: ${show(receipt)}`).toBe('incomplete');
        const files = arr(receipt['files'], `${what}: receipt.files`).map((v, i) => {
          const o = obj(v, `${what}: receipt.files[${i}]`);
          return { path: str(o['path'], `${what}: receipt.files[${i}].path`), sha: hex64(o['sha256'], `${what}: receipt.files[${i}].sha256`) };
        });
        const written = filesUnder(out);
        expect(files.map((x) => x.path).sort(), `${what}: receipt.files lists every file the page wrote`).toEqual([...written.keys()].sort());
        for (const x of files) {
          expect(sha256(written.get(x.path)!), `${what}: ${x.path} hashes to its receipt entry`).toBe(x.sha);
          expect(filesUnder(evidence).get(`${x.sha.slice(0, 2)}/${x.sha.slice(2)}`) !== undefined, `${what}: the evidence store holds ${x.path} by its hash`).toBe(true);
        }
        const send: JsonObject = { call: 'send', session: AGENT.id, to, files: files.map((x) => x.sha) };
        listener.clear();
        const f: string[] = [];
        const r2 = run([send], 'the send');
        const s = sendOf(r2[2], `${what}: the send`);
        if (s.state !== 'waiting') f.push(`the send of the page is ${s.state} before your approval, not waiting`);
        for (const g of listener.requests()) f.push(`the send delivered ${g.sha} to ${g.path} before your approval`);
        // Your approval: then each file goes once, by its bytes.
        listener.clear();
        const r3 = run([send, { call: 'approve', send: s.id }], 'your approval');
        const after = sendOf(r3[3], `${what}: the approved send`);
        if (after.state !== 'sent') f.push(`after your approval the send is ${after.state}, not sent`);
        const got = listener.requests().map((g) => g.sha).sort();
        if (got.join(',') !== files.map((x) => x.sha).sort().join(',')) f.push(`after your approval the listener got [${got.join(', ')}], not each of the page's ${files.length} files once`);
        return f;
      } finally { await listener.stop(); }
    };
    none(await failures(), 'the page waits for your approval, then leaves once');
    const twin = await failures('sends_without_approval');
    expect(twin.some((m) => /^the send delivered [0-9a-f]{64} /.test(m)), `the planted sends_without_approval fails, naming a file's hash: ${JSON.stringify(twin.slice(0, 4))}`).toBe(true);
  }, TIMEOUT);
});
