// AC25 #157.31dd861b: "A 60 s 1080p60 delivery with no held frames writes no raw frame to disk at any point, and its
// readiness gate counts only its PCM, 23,040,000 bytes at 48 kHz stereo; on a test file system reporting 20 MB free it
// is refused with `export_disk_short` before the first frame, naming both sizes, and on one reporting 10 GB free, where
// its 29.9 GB of raw frames would never fit, it delivers and leaves no PCM of it on disk. A planted export without that
// gate starts, fills the disk and fails, naming the file it was writing, and one that stores its raw frames fails,
// naming the folder"
//
// The film: the fixture film (helpers.ts `filmDoc`) at 1920 × 1080 and 60 fps for 60 s, 3,600 frames that each differ
// (the bars move a pixel a frame), its sound 1 s of tone in a 60 s span: its PCM is 60 × 48,000 × 2 × 4 = 23,040,000
// bytes of f32le, its raw frames 3,600 × 8,294,400 = 29,859,840,000 bytes. A test file system is a disk image attached
// with hdiutil (helpers.ts `volume`): the evidence store, the delivery's folder and the run's temporary folder (TMPDIR)
// are all on it, so whatever the export keeps on disk lands there. While the run goes, this suite lists the volume
// every 200 ms for raw frames (helpers.ts `rawFrameFiles`) and reads its used space. The refusal is `{outcome:
// "refused", code: "export_disk_short", needed, free}` (bytes) and the receipt's `disk: {needed, free}`; a stop for a
// full disk names its `path`. Planted: `export_without_disk_gate`, `export_stores_raw_frames`.
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, H264_AAC, TIMEOUT, exportCall, failsNaming, filmDoc, isObject, issueLines, leftIn, none, present, presented, rawFrameFiles, receiptOf,
  runAsync, scenario, show, toneChannels, useShow, volume, watchedReplies, type JsonObject, type Planted, type Volume,
} from './helpers.ts';

const shows = useShow([FULL]);
const PCM = 23_040_000;
const FRAME = 1920 * 1080 * 4;

interface Leg { reply: JsonObject; raw: string[]; peak: number; base: number; vol: Volume; out: string }
/** One export of the 1080p60 film with everything on `vol`, watched. */
async function exportOn(vol: Volume, planted?: Planted, fill?: number): Promise<Leg> {
  const evidence = join(vol.mount, 'evidence'); const tmp = join(vol.mount, 'tmp'); const outDir = join(vol.mount, 'out');
  for (const d of [evidence, tmp, outDir]) mkdirSync(d, { recursive: true });
  const document = filmDoc(evidence, { frames: 3600, size: [1920, 1080], rate: [60, 1], sound: toneChannels(48_000, 48_000) });
  if (fill !== undefined) vol.fillTo(fill);
  const out = join(outDir, 'film.mp4');
  const calls = [present(DOC.a, document), exportCall({ out, ...H264_AAC })];
  const sc = scenario(evidence, calls, planted ? { planted } : {});
  const base = vol.used(); let peak = base; const raw = new Set<string>();
  const w = await runAsync(shows.bin(FULL), sc, {
    env: { TMPDIR: tmp },
    tick: () => { peak = Math.max(peak, vol.used()); for (const p of rawFrameFiles(vol.mount, FRAME)) if (!p.endsWith('filler.bin')) raw.add(p); },
  });
  const [shown, reply] = watchedReplies(w, 2, planted ? `the 1080p60 export (planted ${planted})` : 'the 1080p60 export');
  presented(shown!, 'the 1080p60 film');
  return { reply: reply!, raw: [...raw], peak, base, vol, out };
}
const sizeOf = (p: string): number => (existsSync(p) ? statSync(p).size : 0);
/** Files on the volume as large as the PCM, other than the delivery and the filler. */
function bigFiles(root: string, except: string[]): string[] {
  const out: string[] = [];
  const walk = (d: string): void => { for (const e of readdirSync(d)) { const p = join(d, e); const st = statSync(p); if (st.isDirectory()) walk(p); else if (st.size >= PCM && !except.includes(p) && e !== 'filler.bin') out.push(p); } };
  walk(root);
  return out;
}

/** The 20 MB leg's judge: refused with export_disk_short before the first frame, naming both sizes, nothing left. A
 * run that started instead names the file it stopped writing. */
function shortFailures(l: Leg, freeBefore: number): string[] {
  const r = l.reply;
  if (r['outcome'] === 'refused' && r['code'] === 'export_disk_short') {
    const f: string[] = [];
    if (r['needed'] !== PCM) f.push(`export_disk_short: it names ${show(r['needed'] ?? null)} bytes needed, not the PCM's ${PCM}`);
    if (typeof r['free'] !== 'number' || Math.abs(r['free'] - freeBefore) > 1_000_000) f.push(`export_disk_short: it names ${show(r['free'] ?? null)} bytes free; the file system reports ${freeBefore}`);
    if (r['frames_drawn'] !== undefined && r['frames_drawn'] !== 0) f.push(`export_disk_short: it drew ${show(r['frames_drawn'])} frames first`);
    if (leftIn(join(l.vol.mount, 'out')).length) f.push(`export_disk_short: the refused export left ${leftIn(join(l.vol.mount, 'out')).join(', ')}`);
    return f;
  }
  const paths = (Array.isArray(r['issues']) ? r['issues'] : []).filter(isObject).map((i) => i['path']).filter((p): p is string => typeof p === 'string');
  const files = paths.filter((p) => !p.endsWith('/'));
  return files.length
    ? files.map((p) => `export_disk_short: the export started instead of refusing, filled the disk and stopped, naming the file ${p}`)
    : [`export_disk_short: the export wasn't refused before its first frame: ${issueLines(r).join(' | ').slice(0, 800)}`];
}
/** The 10 GB leg's judge: delivered, the gate counting only the PCM, no raw frame ever on disk, no PCM left after.
 * A run that stored raw frames names their folder. */
function roomyFailures(l: Leg): string[] {
  const f: string[] = [];
  const folders = [...new Set(l.raw.map((p) => p.slice(0, p.lastIndexOf('/'))))];
  for (const d of folders) f.push(`raw frames: the export wrote raw frames into the folder ${d}`);
  if (l.reply['outcome'] !== 'exported') {
    for (const i of (Array.isArray(l.reply['issues']) ? l.reply['issues'] : []).filter(isObject)) if (typeof i['path'] === 'string') f.push(`the export stopped, naming the folder ${i['path']}`);
    return f.length ? f : [`the export wasn't delivered: ${issueLines(l.reply).join(' | ').slice(0, 800)}`];
  }
  const disk = receiptOf(l.reply, 'the 1080p60 delivery').raw['disk'];
  if (!isObject(disk) || disk['needed'] !== PCM) f.push(`readiness: the gate counted ${show(isObject(disk) ? disk['needed'] ?? null : null)} bytes, not the PCM's ${PCM}`);
  const grew = l.peak - l.base; const allowed = PCM + sizeOf(l.out) + 64 * 2 ** 20;
  if (grew > allowed) f.push(`raw frames: the volume's use grew by ${grew} bytes during the run, more than the PCM, the delivery and 64 MiB (${allowed})`);
  const left = bigFiles(l.vol.mount, [l.out]);
  if (left.length) f.push(`PCM: the export left ${left.join(', ')} on disk`);
  return f;
}

describe(`${AC[25]} an export keeps only its PCM on disk, and its readiness gate counts it`, () => {
  it(`${AC[25]} on a file system reporting 20 MB free the 60 s 1080p60 export is refused with export_disk_short before its first frame, naming 23,040,000 bytes and the free space`, async () => {
    const vol = volume('small');
    const leg = await exportOn(vol, undefined, 20_000_000);
    none(shortFailures(leg, 20_000_000), 'the readiness gate on 20 MB');
  }, TIMEOUT);

  it(`${AC[25]} on a file system reporting 10 GB free it delivers, its gate counting 23,040,000 bytes, with no raw frame written at any point and no PCM left`, async () => {
    const vol = volume('large');
    expect(vol.free() > 9e9 && vol.free() < 29_859_840_000, `the volume reports about 10 GB free, under the 29.9 GB of raw frames: ${vol.free()}`).toBe(true);
    none(roomyFailures(await exportOn(vol)), 'the 1080p60 delivery on 10 GB');
  }, TIMEOUT);

  it(`${AC[25]} a planted export without the gate starts, fills the 20 MB disk and fails, naming the file it was writing`, async () => {
    const vol = volume('small');
    const leg = await exportOn(vol, 'export_without_disk_gate', 20_000_000);
    failsNaming(shortFailures(leg, 20_000_000), /naming the file \S+/, 'the planted export (export_without_disk_gate)');
  }, TIMEOUT);

  it(`${AC[25]} a planted export that stores its raw frames fails on the 10 GB disk, naming the folder`, async () => {
    const vol = volume('large');
    failsNaming(roomyFailures(await exportOn(vol, 'export_stores_raw_frames')), /folder \S+/, 'the planted export (export_stores_raw_frames)');
  }, TIMEOUT);
});
