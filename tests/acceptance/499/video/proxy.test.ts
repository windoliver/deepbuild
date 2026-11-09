// AC8 #499.a9397111: On a fixture with a gop-10 proxy, a canonical seek to frame 90 gives the source frame's decoded
// hash; a planted seek that reads the proxy differs and fails, naming the frame.
//
// Through `deep-show run`: the recording (key frames every 60 frames, so frame 90 lies mid-GOP) gets a gop-10 proxy at
// half scale from #498's `media_proxy`, made in the decode worker and kept in the evidence store; the board's asset
// names it in `proxies`. The canonical seek is #488's `determinism` seek side: a fresh session evaluated at 4 s, then
// at 3 s. Its `video` planes hash must be ffmpeg's decode of the source's frame 90. The wrong program is
// `planted: "seek_reads_proxy"`: the seek decodes the frame from the proxy.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, REC, TIMEOUT, asset, compared, determinismCall, documentOf, existsEvidence, fl, int, keyFrames, mediaProxy, nameFrame, obj, present,
  presented, putEvidence, recordingMp4, referenceFrames, runShow, scenario, sha256, str, useBinary, useTemp, videoItem,
} from './helpers.ts';

const showBin = useBinary('deep-show');
const temp = useTemp('proxy');

describe(`${AC[8]} canonical renders decode only the source asset, never its proxy`, () => {
  it(`${AC[8]} with a gop-10 proxy on record, a canonical seek to frame 90 gives the source frame's decoded hash; a seek that reads the proxy differs and fails, naming frame 90`, () => {
    const dir = temp();
    const path = join(dir, 'recording.mp4');
    recordingMp4(path);
    const evidence = temp();
    const sha = putEvidence(evidence, readFileSync(path));
    const hashes = referenceFrames(path, REC.w, REC.h, REC.count).map((b) => sha256(b));
    expect(keyFrames(path).includes(90), 'fixture: frame 90 is not a key frame of the source, so a seek decodes into its GOP').toBe(false);

    // The proxy, made in the decode worker and kept by its hash in the evidence store.
    const [made] = runShow(showBin(), scenario(evidence, [mediaProxy(path, 10, 0.5)]), 'the proxy');
    const proxy = obj(made!['proxy'], 'media_proxy: proxy');
    const proxySha = str(proxy['sha256'], 'media_proxy: proxy.sha256');
    expect(int(proxy['gop'], 'media_proxy: proxy.gop'), 'the proxy is gop 10').toBe(10);
    const proxyFile = existsEvidence(evidence, proxySha);
    expect(proxyFile, `the proxy ${proxySha} is in the evidence store`).not.toBeNull();
    expect(keyFrames(proxyFile!).filter((k) => k <= 120), 'fixture: the proxy has a key frame every 10 frames').toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);

    const doc = documentOf('proxy', 'board', [REC.w, REC.h], [videoItem('rec', sha, [0, 0, REC.w, REC.h])], { rec: asset(sha, { proxies: [{ sha256: proxySha, gop: 10, scale: 0.5 }] }) }, {}, { span: '10s' });
    const seekTo90 = (planted?: string): string[] => {
      const replies = runShow(showBin(), scenario(evidence, [present(DOC.a, doc), determinismCall(DOC.a, [fl(3)])], planted), planted ? `planted ${planted}` : 'the canonical seek');
      presented(replies[0]!, 'the board with the recording and its proxy');
      const [at] = compared(replies[1]!, 'rec', 'determinism at 3 s');
      expect(at!.t, 'determinism answers 3 s').toBe(fl(3));
      return at!.seek.planes === hashes[90] ? [] : [`the canonical seek to 3 s shows ${nameFrame(hashes, at!.seek.planes)}, not source frame 90 as the source asset decodes it`];
    };
    expect(seekTo90(), 'the canonical seek decodes the source').toEqual([]);
    const wrong = seekTo90('seek_reads_proxy');
    expect(wrong, 'the seek that reads the proxy differs and fails, naming frame 90').toEqual([expect.stringMatching(/not source frame 90 /)]);
  }, TIMEOUT);
});
