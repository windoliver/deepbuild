// AC6: the decode worker probes, decodes and makes proxies and never encodes: an export's record names the encode
// tool's own process as its encoder, and a planted export that encodes inside the decode worker fails this test,
// naming that process.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assetOf, bool, cfr30, decodedOf, describeWorker, int, mediaDecode, mediaExport, mediaImport, mediaProxy, obj, runShow, sha256,
  sha256File, str, topBoxes, useShow, useTemp, workerPid, workersCall, workersOf,
  type JsonObject, type Planted,
} from './helpers.ts';

const show = useShow();
const temp = useTemp('encode');

describe('AC6 the decode worker probes, decodes and makes proxies and never encodes; an export\'s record names the encode tool\'s own process', () => {
  it('AC6 a clip is probed, decoded and proxied in decode workers and exported to H.264: the receipt\'s encoder is an encode tool process, apart from every decode worker and deep-show, that ran the encode; no decode worker ran an encode; the delivery is a whole MP4 by its hash', () => {
    const dir = temp();
    const clip = join(dir, 'clip-30fps.mp4');
    cfr30(clip);
    const clipSha = sha256File(clip);
    const calls: JsonObject[] = [
      mediaImport(clip),
      mediaDecode(clip, join(dir, 'decoded'), { video_frames: 2 }),
      mediaProxy(clip, 1, 0.5),
      mediaExport(clip, join(dir, 'delivery.mp4')),
      workersCall(),
    ];
    const check = (planted?: Planted): string[] => {
      const out = join(dir, planted ?? 'clean');
      const cs = calls.map((c) => (c['call'] === 'media_export' ? { ...c, out: `${out}-delivery.mp4` } : c));
      const { replies, pid } = runShow(show(), { evidence: temp(), ...(planted ? { planted } : {}) }, cs, planted ? `planted ${planted}` : 'probe, decode, proxy and export');
      const f: string[] = [];
      const workers = workersOf(replies[4]!, 'workers');
      const decodeWorkers = workers.filter((w) => w.role === 'decode_worker');
      if (workers.some((w) => w.pid === pid)) f.push(`workers lists deep-show's own process ${pid}`);

      // Probe, decode and proxy each ran in a decode worker, on the clip.
      const ran: [string, number][] = [
        ['probe', assetOf(replies[0]!, 'media_import').worker],
        ['decode', decodedOf(replies[1]!, join(dir, 'decoded'), 'media_decode').worker],
        ['proxy', workerPid(replies[2]!, 'media_proxy')],
      ];
      const proxy = obj(replies[2]!['proxy'], 'media_proxy: proxy');
      str(proxy['sha256'], 'media_proxy: proxy.sha256');
      expect(int(proxy['gop'], 'media_proxy: proxy.gop'), 'media_proxy: proxy.gop').toBe(1);
      for (const [op, p] of ran) {
        const w = decodeWorkers.find((x) => x.pid === p);
        if (!w) f.push(`the clip's ${op} ran in process ${p}, which is not a decode_worker workers lists`);
        else if (!w.jobs.some((j) => j.op === op && j.file === clipSha)) f.push(`the clip's ${op} names ${describeWorker(w)}, which has no ${op} job on the clip`);
      }
      // No decode worker encodes: its jobs are probes, decodes and proxies only.
      for (const w of decodeWorkers) {
        const other = w.jobs.filter((j) => !['probe', 'decode', 'proxy'].includes(j.op));
        if (other.length > 0) f.push(`${describeWorker(w)} ran ${other.map((j) => j.op).join(', ')}, which a decode worker never does`);
      }

      // The export's record names its encoder's own process, the encode tool's.
      const ex = obj(replies[3]!['export'], 'media_export: export');
      const file = obj(ex['file'], 'media_export: export.file');
      const fileSha = str(file['sha256'], 'media_export: export.file.sha256');
      const enc = obj(obj(ex['receipt'], 'media_export: export.receipt')['encoder'], 'media_export: export.receipt.encoder');
      str(enc['name'], 'media_export: receipt.encoder.name');
      str(enc['version'], 'media_export: receipt.encoder.version');
      bool(enc['hardware'], 'media_export: receipt.encoder.hardware');
      const proc = obj(enc['process'], 'media_export: receipt.encoder.process');
      const encPid = int(proc['pid'], 'media_export: receipt.encoder.process.pid');
      const encRole = str(proc['role'], 'media_export: receipt.encoder.process.role');
      const asDecoder = decodeWorkers.find((w) => w.pid === encPid);
      const listed = workers.find((w) => w.pid === encPid);
      if (encPid === pid) f.push(`the export's encoder is deep-show's own process ${pid}, not the encode tool's own process`);
      else if (asDecoder) f.push(`the export's encoder is ${describeWorker(asDecoder)}, a decode worker, not the encode tool's own process`);
      else if (!listed) f.push(`the export's encoder names process ${encPid}, which workers doesn't list`);
      else if (listed.role !== 'encode_tool' || encRole !== 'encode_tool') f.push(`the export's encoder is ${describeWorker(listed)} (receipt role ${encRole}), not an encode_tool`);
      else if (!listed.jobs.some((j) => j.op === 'encode' && j.file === fileSha)) f.push(`the export's encoder ${describeWorker(listed)} has no encode job writing ${fileSha}`);
      for (const w of workers.filter((x) => x.role !== 'encode_tool')) {
        if (w.jobs.some((j) => j.op === 'encode')) f.push(`${describeWorker(w)} ran an encode, but only the encode tool's process encodes`);
      }

      // The delivery is there, by its hash, a whole MP4.
      const path = `${out}-delivery.mp4`;
      if (!existsSync(path)) f.push(`the export wrote nothing at ${path}`);
      else {
        const bytes = readFileSync(path);
        if (sha256(bytes) !== fileSha) f.push(`the delivery hashes to ${sha256(bytes)}, not the receipt's ${fileSha}`);
        const top = topBoxes(bytes);
        const types = top.boxes.map((b) => b.type);
        if (!top.whole || types[0] !== 'ftyp' || !types.includes('moov') || !types.includes('mdat')) f.push(`the delivery is not a whole MP4 (top-level boxes ${types.join(', ')}, adding up: ${top.whole})`);
      }
      return f;
    };
    expect(check(), 'probes, decodes and proxies in decode workers; the export encoded by the encode tool\'s own process').toEqual([]);
    // The wrong program: the export encodes inside the decode worker, and this check names that process.
    const wrong = check('encodes_in_decode_worker');
    expect(wrong.some((s) => /^the export's encoder is process \d+ \(decode_worker;/.test(s)), `planted encodes_in_decode_worker fails naming the decode worker's process; got ${JSON.stringify(wrong)}`).toBe(true);
  }, 1_800_000);
});
