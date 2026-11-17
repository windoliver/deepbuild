// AC6 #210.e496d38b: "The web player export of the port fixture lists its port in refused and plays without it; a planted
// export that keeps the port fails the bundle's read-back, naming the port"
//
// #172's web export (`export` with `video.codec: web`, its receipt and bundle, its browser harness), read only. The drum
// pad with its port `synth` to `test.gear` (README: The fixture), exported with a track of three notes: the export
// answers `exported`, its receipt's `refused` holds `{item: "synth", why}`, the bundle matches its receipt, no file of
// it holds the plug-in's ID, and the bundle is ready in headless Chrome on WebGPU and plays to its end. The planted
// `web_export_keeps_port` writes the port into the bundle: the export's read-back fails (`failed`), its reply names
// synth, and nothing is left in the folder.
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundleFailures, exportOnce, play, trackEntry, useBrowsers, webReceiptOf } from '../172/helpers.ts';
import {
  AC, GEAR, NOTES, SYNTH_OUT, TIMEOUT, deepShow, filesUnder, isObject, none, obj, pieceDoc, prebuild, show, useTemp, type JsonObject,
} from './helpers.ts';

const ID = AC[6];
prebuild(() => { deepShow(['full']); });
const temp = useTemp();
const browsers = useBrowsers();

const TRACK = [trackEntry(30, NOTES, 64), trackEntry(90, NOTES, 67), trackEntry(150, NOTES, 71)];
const fixture = (evidence: string): JsonObject => pieceDoc(evidence, { synth: { plugin: GEAR.id, out: SYNTH_OUT } });

describe(`AC6 ${ID} the web player's bundle carries no port`, () => {
  it(`AC6 ${ID} the export lists synth in refused, writes no port into the bundle, and the bundle plays to its end in the browser`, async () => {
    const evidence = temp();
    const out = join(temp(), 'bundle');
    const receipt = webReceiptOf(exportOnce(deepShow(['full']), evidence, fixture(evidence), out, 'AC6: the web export', { track: TRACK }), 'AC6: the web export');
    const f: string[] = [];
    const named = receipt.refused.filter((r) => isObject(r) && r['item'] === 'synth');
    if (named.length !== 1 || typeof obj(named[0], 'AC6: refused synth')['why'] !== 'string' || String(obj(named[0], 'AC6: refused synth')['why']).trim() === '') {
      f.push(`the receipt's refused is ${show(receipt.refused, 600)}, not one {item: "synth", why} for the port`);
    }
    f.push(...bundleFailures(out, receipt, 'AC6'));
    for (const [path, bytes] of filesUnder(out)) if (bytes.includes(Buffer.from(GEAR.id))) f.push(`the bundle's ${path} holds the port's plug-in ${GEAR.id}`);
    none(f, `AC6 ${ID}`);
    const p = browsers(await play(out));
    await p.tab.mustBeReady('AC6: the drum pad\'s bundle');
    await p.tab.playToEnd('AC6: the drum pad\'s bundle');
  }, TIMEOUT);

  it(`AC6 ${ID} the planted web_export_keeps_port fails the bundle's read-back, naming synth`, () => {
    const evidence = temp();
    const out = join(temp(), 'bundle');
    const reply = exportOnce(deepShow(['full']), evidence, fixture(evidence), out, 'AC6 planted: the web export', { track: TRACK, planted: 'web_export_keeps_port' });
    expect(reply['outcome'], `AC6 planted: the export's read-back fails: ${show(reply, 1500)}`).toBe('failed');
    expect(/\bsynth\b/.test(JSON.stringify(reply)), `AC6 planted: the failure names the port synth: ${show(reply, 1500)}`).toBe(true);
    expect([...filesUnder(dirname(out)).keys()], 'AC6 planted: nothing is left in the export\'s folder').toEqual([]);
  }, TIMEOUT);
});
