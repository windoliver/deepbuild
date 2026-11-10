// Criterion 1 (no upstream test): "A logic golden recorded on the reference Mac replays in the lane and logic.determinism
// `cross_machine` reads PASS; the lane's record names the recording machine (macos, aarch64), the lane's architecture
// x86_64, the host's architecture arm64, `emulated: true`, the image digest and the tree hash; a planted record missing
// any of those fields is refused, naming the field"
//
// tally's golden is recorded by deep-logic on this Mac, the lane (scripts/lane-x86.mjs) replays it from its record's
// tree in the pinned linux/amd64 image, and `deep-logic determinism` with compare cross_machine reads the lane's record
// (README: The lane, The record, cross_machine). docker-shim.mjs logs the lane's docker command lines, so the replay's
// platform and image are read from what ran, not from the record alone. Then the record goes back with each named field
// taken out in turn, and cross_machine must refuse each, naming that field.
import { hostname } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  AC, HOST_ARCH, LANE, LANE_ARCH, NAMED_FIELDS, RECORDING, TIMEOUT, cross, flagOf, logicBin, macGolden, needImage, onReferenceMac,
  pin, plantRecord, prebuild, recordOf, replays, runLane, sandbox, show, tallyPiece, treeOf, verifyCall, type JsonObject, type JsonValue,
} from './helpers.ts';

prebuild(() => { logicBin(); });

describe(`${AC[1]} a golden recorded on the reference Mac replays in the x86_64 lane, and cross_machine reads its record`, () => {
  it(`${AC[1]} the lane's replay passes, its record names the recording machine, x86_64, arm64, emulated: true, the image digest and the tree, cross_machine reads PASS, and a record missing any of those is refused naming the field`, () => {
    onReferenceMac();
    const p = pin();
    needImage(p, 'linux/amd64');
    const box = sandbox();
    const tree = treeOf(box);
    const piece = tallyPiece(1983_01);
    const golden = macGolden(piece);

    const run = runLane(box, [verifyCall(piece, golden)], { shim: {} });
    const record = recordOf(box, tree, run);
    const named = {
      lane: record['lane'], state: record['state'], host: record['host'], tree: record['tree'], recording_machine: record['recording_machine'],
      lane_arch: record['lane_arch'], host_arch: record['host_arch'], emulated: record['emulated'], image_digest: record['image_digest'],
    };
    expect(named, `the lane's record for its replay of the golden: ${show(record)}`).toMatchObject({
      lane: LANE, state: 'PASS', host: hostname(), tree, recording_machine: RECORDING,
      lane_arch: LANE_ARCH, host_arch: HOST_ARCH, emulated: true, image_digest: p.digest,
    });
    const ran = replays(run, p);
    expect(ran.length, `the lane ran the replay in a container (docker run naming deep-logic): ${show(run.docker as unknown as JsonValue)}`).toBeGreaterThan(0);
    for (const r of ran) {
      expect(flagOf(r.rest, '--platform'), `the replay ran on linux/amd64: ${r.rest.join(' ')}`).toBe('linux/amd64');
      expect(r.rest.some((a) => a.includes(p.digest)), `the replay ran the image of the pinned digest ${p.digest}: ${r.rest.join(' ')}`).toBe(true);
    }

    const passed = cross(box, piece, tree, 'cross_machine on the lane\'s record');
    expect([passed.verdict, passed.machines], `cross_machine reads PASS on another machine: ${show(passed.raw)}`).toEqual(['PASS', 'different']);
    expect([passed.failures, passed.refusals], 'nothing failed or was refused').toEqual([[], []]);

    const missed: string[] = [];
    for (const field of NAMED_FIELDS) {
      const planted: JsonObject = { ...record };
      delete planted[field];
      plantRecord(box, tree, planted);
      const c = cross(box, piece, tree, `cross_machine on a record without ${field}`);
      if (c.verdict === 'PASS' || !c.refusals.some((r) => r['field'] === field)) missed.push(`without ${field}: ${c.verdict}, refusals ${show(c.refusals)}`);
    }
    expect(missed, 'a record missing a named field is refused, naming the field, never PASS').toEqual([]);
  }, TIMEOUT);
});
