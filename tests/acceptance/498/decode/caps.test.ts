// AC2: every audio, image and video asset the media module decodes goes through the decode worker; an audio file one
// second over its duration cap and an image one pixel over its pixel cap are refused naming the cap; a file that points
// at a URL is refused with no connection made. Scope held here: the worker's caps, no network.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  Listener, assetOf, cfr30, decodedOf, describeWorker, hlsPlaylist, m4a, mediaDecode, mediaImport, movWithUrlDataRef, png,
  refusalOf, runShow, settle, sha256File, useShow, useTemp, wav, workersCall, workersOf,
  type JsonObject, type Planted,
} from './helpers.ts';

const show = useShow();
const temp = useTemp('caps');

/** This run's caps (the Decode worker's `caps: {max_bytes, max_duration: s, max_pixels}`), set small so the files
 * one over them stay small: 10 s, and 10,000 pixels (100 × 100; 73 × 137 is 10,001). */
const CAPS = { max_duration: 10, max_pixels: 10_000 };

interface Files { wav10: string; wav11: string; m4a11: string; png100: string; png10001: string; mp4: string }
function files(dir: string, video: boolean): Files {
  const f: Files = {
    wav10: join(dir, 'tone-10s.wav'), wav11: join(dir, 'tone-11s.wav'), m4a11: join(dir, 'tone-11s.m4a'),
    png100: join(dir, 'square-100x100.png'), png10001: join(dir, 'tall-73x137.png'), mp4: join(dir, 'clip-30fps.mp4'),
  };
  writeFileSync(f.wav10, wav(10));
  writeFileSync(f.wav11, wav(11));
  writeFileSync(f.png100, png(100, 100));
  writeFileSync(f.png10001, png(73, 137));
  m4a(f.m4a11, 11);
  if (video) cfr30(f.mp4);
  return f;
}

describe('AC2 an audio file one second over its duration cap and an image one pixel over its pixel cap are refused naming the cap', () => {
  /** Each call, what it is, and the cap it must be refused naming (or null: admitted at the cap). */
  const plan = (f: Files, out: string): { call: JsonObject; what: string; cap: 'max_duration' | 'max_pixels' | null }[] => [
    { call: mediaImport(f.wav11), what: 'importing an 11 s WAV (cap 10 s)', cap: 'max_duration' },
    { call: mediaDecode(f.wav11, join(out, 'wav11')), what: 'decoding an 11 s WAV (cap 10 s)', cap: 'max_duration' },
    { call: mediaImport(f.m4a11), what: 'importing an 11 s AAC M4A (cap 10 s)', cap: 'max_duration' },
    { call: mediaImport(f.png10001), what: 'importing a 73 × 137 PNG, 10,001 pixels (cap 10,000)', cap: 'max_pixels' },
    { call: mediaDecode(f.png10001, join(out, 'png10001')), what: 'decoding a 73 × 137 PNG, 10,001 pixels (cap 10,000)', cap: 'max_pixels' },
    { call: mediaImport(f.wav10), what: 'importing a 10 s WAV, at the cap', cap: null },
    { call: mediaImport(f.png100), what: 'importing a 100 × 100 PNG, 10,000 pixels, at the cap', cap: null },
  ];

  function problems(replies: JsonObject[], p: ReturnType<typeof plan>, f: Files): string[] {
    const out: string[] = [];
    p.forEach((step, i) => {
      const reply = replies[i]!;
      const refused = refusalOf(reply, step.what);
      if (step.cap === null) {
        if (refused) { out.push(`${step.what}: refused (${JSON.stringify(reply['refused'])}), though it is at the cap, not over it`); return; }
        const a = assetOf(reply, step.what);
        const path = step.call['path'] as string;
        expect(a.sha256, `${step.what}: asset.sha256 is the file's SHA-256`).toBe(sha256File(path));
        expect(a.kind, `${step.what}: asset.kind`).toBe(path === f.wav10 ? 'audio' : 'image');
        return;
      }
      if (!refused) { out.push(`${step.what}: admitted, not refused naming ${step.cap}`); return; }
      if (refused.code !== 'over_cap') { out.push(`${step.what}: refused with code ${refused.code}, not over_cap naming ${step.cap}`); return; }
      if (refused.cap !== step.cap) out.push(`${step.what}: refused naming the cap ${refused.cap}, not ${step.cap}`);
      if (refused.limit !== CAPS[step.cap]) out.push(`${step.what}: refused naming ${step.cap} as ${refused.limit}, not this run's ${CAPS[step.cap]}`);
    });
    return out;
  }

  it('AC2 with caps of 10 s and 10,000 pixels, an 11 s WAV and an 11 s AAC file are refused naming max_duration, a 73 × 137 PNG naming max_pixels, on import and on decode; a 10 s WAV and a 100 × 100 PNG are admitted', () => {
    const dir = temp();
    const f = files(dir, false);
    const out = join(dir, 'out');
    mkdirSync(out);
    const p = plan(f, out);
    const run = (planted?: Planted) => runShow(show(), { evidence: temp(), caps: CAPS, ...(planted ? { planted } : {}) }, p.map((s) => s.call), planted ? `planted ${planted}` : 'the caps');
    expect(problems(run().replies, p, f), 'files over a cap are refused naming it; files at it are admitted').toEqual([]);
    // The wrong program: a worker that checks no cap admits both files over theirs, and this check names each cap.
    const wrong = problems(run('skips_caps').replies, p, f);
    expect(wrong.some((s) => s.includes('max_duration')), `planted skips_caps fails naming max_duration; got ${JSON.stringify(wrong)}`).toBe(true);
    expect(wrong.some((s) => s.includes('max_pixels')), `planted skips_caps fails naming max_pixels; got ${JSON.stringify(wrong)}`).toBe(true);
  }, 900_000);
});

describe('AC2 a file that points at a URL is refused with no connection made', () => {
  it('AC2 an HLS playlist and a QuickTime movie whose data reference is a URL, both pointing at a local listener, are refused naming the URL on import and on decode, and the listener sees no connection', async () => {
    const dir = temp();
    const listener = new Listener(join(dir, 'listener.log'));
    const port = await listener.start();
    try {
      const host = `127.0.0.1:${port}`;
      const hls = join(dir, 'stream.m3u8');
      writeFileSync(hls, hlsPlaylist(`http://${host}/hls/seg0.ts`));
      const mov = join(dir, 'reference.mov');
      movWithUrlDataRef(mov, `http://${host}/dref/media.mov`);
      const steps = [
        { call: mediaImport(hls), what: 'importing an HLS playlist whose segment is on the listener' },
        { call: mediaDecode(hls, join(dir, 'out-hls')), what: 'decoding an HLS playlist whose segment is on the listener' },
        { call: mediaImport(mov), what: 'importing a movie whose data reference is a URL on the listener' },
        { call: mediaDecode(mov, join(dir, 'out-mov')), what: 'decoding a movie whose data reference is a URL on the listener' },
      ];
      const check = async (planted?: Planted): Promise<string[]> => {
        listener.clear();
        const { replies } = runShow(show(), { evidence: temp(), ...(planted ? { planted } : {}) }, steps.map((s) => s.call), planted ? `planted ${planted}` : 'files that point at a URL');
        await settle(500); // a connection the run started reaches the listener's log before this reads it
        const out: string[] = [];
        steps.forEach((s, i) => {
          const r = refusalOf(replies[i]!, s.what);
          if (!r) out.push(`${s.what}: not refused`);
          else if (r.code !== 'external_reference') out.push(`${s.what}: refused with code ${r.code}, not external_reference`);
          else if (!r.url!.includes(host)) out.push(`${s.what}: refused naming ${r.url}, not the URL it points at on ${host}`);
        });
        const seen = listener.lines();
        if (seen.length > 0) out.push(`the listener at ${host} saw a connection: ${seen.join('; ')}`);
        return out;
      };
      expect(await check(), 'refused naming the URL, with no connection made').toEqual([]);
      // The wrong program: a worker that opens what a file points at makes a connection, and this check names it.
      const wrong = await check('follows_urls');
      expect(wrong.some((s) => s.includes('saw a connection')), `planted follows_urls fails naming the connection; got ${JSON.stringify(wrong)}`).toBe(true);
    } finally {
      listener.stop();
    }
  }, 900_000);
});

describe('AC2 every audio, image and video asset the media module decodes goes through the decode worker', () => {
  it('AC2 a WAV, a PNG and an MP4 are each probed on import and decoded in a decode worker, a process apart from deep-show\'s own, which ran that job on that file', () => {
    const dir = temp();
    const f = files(dir, true);
    const kinds = [{ kind: 'audio', path: f.wav10 }, { kind: 'image', path: f.png100 }, { kind: 'video', path: f.mp4 }];
    const calls: JsonObject[] = [
      ...kinds.map((k) => mediaImport(k.path)),
      ...kinds.map((k) => mediaDecode(k.path, join(dir, `out-${k.kind}`), { video_frames: 1 })),
      workersCall(),
    ];
    const check = (planted?: Planted): string[] => {
      const { replies, pid } = runShow(show(), { evidence: temp(), ...(planted ? { planted } : {}) }, calls, planted ? `planted ${planted}` : 'one asset of each kind');
      const workers = workersOf(replies[calls.length - 1]!, 'workers');
      const out: string[] = [];
      if (workers.some((w) => w.pid === pid)) out.push(`workers lists deep-show's own process ${pid}`);
      kinds.forEach((k, i) => {
        const sha = sha256File(k.path);
        const imported = assetOf(replies[i]!, `importing the ${k.kind} file`);
        expect(imported.kind, `the ${k.kind} file's asset.kind`).toBe(k.kind);
        const decoded = decodedOf(replies[kinds.length + i]!, join(dir, `out-${k.kind}`), `decoding the ${k.kind} file`);
        for (const [op, ranIn] of [['probe', imported.worker], ['decode', decoded.worker]] as const) {
          if (ranIn === pid) { out.push(`the ${k.kind} file's ${op} ran in deep-show's own process ${pid}, not in the decode worker`); continue; }
          const w = workers.find((x) => x.pid === ranIn);
          if (!w) { out.push(`the ${k.kind} file's ${op} names process ${ranIn}, which workers doesn't list`); continue; }
          if (w.role !== 'decode_worker') out.push(`the ${k.kind} file's ${op} ran in ${describeWorker(w)}, not a decode_worker`);
          else if (!w.jobs.some((j) => j.op === op && j.file === sha)) out.push(`the ${k.kind} file's ${op} names ${describeWorker(w)}, which has no ${op} job on ${sha}`);
        }
      });
      return out;
    };
    expect(check(), 'each kind is probed and decoded in a decode worker').toEqual([]);
    // The wrong program: the media module decodes in deep-show's own process, and this check names each kind.
    const wrong = check('decodes_in_app');
    for (const kind of ['audio', 'image', 'video']) {
      expect(wrong.some((s) => s.includes(`the ${kind} file's`) && s.includes('deep-show\'s own process')), `planted decodes_in_app fails naming the ${kind} file; got ${JSON.stringify(wrong)}`).toBe(true);
    }
  }, 900_000);
});
