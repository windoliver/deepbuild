// AC6 #210.e496d38b: "The web player export of the port fixture lists its port in refused and plays without it; a planted
// export that keeps the port fails the bundle's read-back, naming the port"
//
// The blind redraft after #2892 (README) of the first test in ../210/ac6-web-export.test.ts. Only its assertion that no
// bundle file holds the port's plug-in ID is redrafted: each file is searched as stored and, where its stored bytes are
// gzip, as the page reads it, inflated (../172-redraft-2892/helpers.ts), since #2892 stores the bundle's document and
// most other files gzip. Everything else it asserts is the first draft's, through #172's web export, receipt, bundle
// and browser harness and #210's fixture (../210/helpers.ts), imported read-only: the drum pad with its port `synth` to
// `test.gear`, exported with a track of three notes, answers `exported`; its receipt's `refused` holds one
// `{item: "synth", why}`; the bundle matches its receipt; no file holds `test.gear`; the bundle is ready in headless
// Chrome on WebGPU and plays to its end. The leak twin, made in test code: a copy of that bundle with `test.gear`
// planted inside one file stored gzip fails the same search, naming the file.
// Wrong programs it fails on: an export that writes the port, or its plug-in's ID, into any file of the bundle, stored
// as it is or stored gzip, and still answers `exported` (the twin is that bundle); a search over stored bytes alone,
// which finds nothing inside a file stored gzip (#2892's wrong reading; the twin). The first draft's second test, the
// planted `web_export_keeps_port` that fails the read-back naming synth, stands.
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { bundleFailures, exportOnce, play, trackEntry, useBrowsers, webReceiptOf } from '../172/helpers.ts';
import { AC, GEAR, NOTES, SYNTH_OUT, TIMEOUT, deepShow, failsNaming, isObject, none, obj, pieceDoc, prebuild, show, useTemp, type JsonObject } from '../210/helpers.ts';
import { bundleAsRead, leakFailures, leakTwin } from '../172-redraft-2892/helpers.ts';

const ID = AC[6];
prebuild(() => { deepShow(['full']); });
const temp = useTemp();
const browsers = useBrowsers();

const TRACK = [trackEntry(30, NOTES, 64), trackEntry(90, NOTES, 67), trackEntry(150, NOTES, 71)];
const fixture = (evidence: string): JsonObject => pieceDoc(evidence, { synth: { plugin: GEAR.id, out: SYNTH_OUT } });
const NEEDLE: [string, Buffer] = [`the port's plug-in ${GEAR.id}`, Buffer.from(GEAR.id)];

describe(`AC6 ${ID} the web player's bundle carries no port, read as the page reads it`, () => {
  it(`AC6 ${ID} the export lists synth in refused, writes no port into the bundle, stored or inflated, and the bundle plays to its end in the browser`, async () => {
    const evidence = temp();
    const out = join(temp(), 'bundle');
    const receipt = webReceiptOf(exportOnce(deepShow(['full']), evidence, fixture(evidence), out, 'AC6: the web export', { track: TRACK }), 'AC6: the web export');
    const f: string[] = [];
    const named = receipt.refused.filter((r) => isObject(r) && r['item'] === 'synth');
    if (named.length !== 1 || typeof obj(named[0], 'AC6: refused synth')['why'] !== 'string' || String(obj(named[0], 'AC6: refused synth')['why']).trim() === '') {
      f.push(`the receipt's refused is ${show(receipt.refused, 600)}, not one {item: "synth", why} for the port`);
    }
    f.push(...bundleFailures(out, receipt, 'AC6'));
    f.push(...leakFailures(bundleAsRead(out), [NEEDLE]).map((x) => `the bundle's ${x}`));
    none(f, `AC6 ${ID}`);

    // The leak twin: the plug-in's ID inside a file stored gzip, as #2892 stores the document.
    const twin = join(temp(), 'leak');
    const planted = leakTwin(out, twin, [NEEDLE[1]]);
    failsNaming(leakFailures(bundleAsRead(twin), [NEEDLE]), planted, `AC6: the bundle with ${GEAR.id} inside its gzip-stored ${planted}`);

    const p = browsers(await play(out));
    await p.tab.mustBeReady('AC6: the drum pad\'s bundle');
    await p.tab.playToEnd('AC6: the drum pad\'s bundle');
  }, TIMEOUT);
});
