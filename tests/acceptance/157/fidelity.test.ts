// AC4 #157.6cdc16ff: "A starved-bitrate encode of a grain look fails export.fidelity naming its worst frames, and the
// raised quality floor passes it"
// AC18 #157.965b3a67: "`video.quality: master` raises the export.fidelity floor to 45 dB, and a starved encode fails it"
// AC20 #157.bc4ae1e7: "export.target@1's video and png entries each pass their fixture film through export.fidelity, the
// registry kit's fidelity part; and a planted video writer that drops one frame fails export.fidelity, naming the frame"
// AC21 #157.e306d0a0: "A 1,440-frame film at 24000/1001 fps with 48 kHz audio decodes from its delivery with frame k at
// exactly k × 1001/24000 s and 2,882,880 sample frames per channel; planted muxers with a 600 or 1,000 video timescale
// fail, naming frame 1"
//
// Through `deep-show run`'s `export` and its receipt's `fidelity` (README: the receipt), #138's `kit` call on
// export.target@1 and #200's `registries` listing, and the decode worker's `media_import` and `media_decode` (#498) on
// the delivered file. Films: the fixture film (helpers.ts `filmDoc`, 160 × 90); AC4's under a look whose finish is
// grain at 25%, beside the same film without grain. Planted: `encoder_starves_bitrate` (the encode tool asked for
// 64 kb/s whatever the film, its quality floor never raised), `video_writer_drops_frame`, `muxer_timescale_600`,
// `muxer_timescale_1000`.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, H264_AAC, TIMEOUT, arr, assetOf, decodedOf, exportCall, failsNaming, fidelityOf, filmDoc, filmRun, framesNamed, isObject, issueLines,
  issuesOf, lookOf, mediaDecode, mediaImport, meetsFloor, none, obj, present, presented, rat, ratEq, receiptOf, runShow, scenario, show, showRat,
  useShow, useTemp, type JsonObject, type Planted,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

/** A floor judge on one export: delivered, every frame at or over its floor, the worst 1% listed. Each failure starts
 * `export.fidelity: <floor> dB floor: worst frames <k, …>`. */
function floorFailures(reply: JsonObject, what: string): string[] {
  if (reply['outcome'] !== 'exported') {
    const issues = issuesOf(reply, 'export.fidelity');
    if (!issues.length) return [`export.fidelity: ${what} wasn't delivered and export.fidelity names nothing: ${issueLines(reply).join(' | ').slice(0, 800)}`];
    return issues.map((i) => {
      const worst = Array.isArray(i['worst_1pct']) ? i['worst_1pct'].filter(isObject).map((w) => Number(w['frame'])) : [];
      const frames = [...new Set([...worst, ...framesNamed(i)])];
      return `export.fidelity: ${String(i['floor'])} dB floor: worst frames ${frames.join(', ')}: ${JSON.stringify(i).slice(0, 600)}`;
    });
  }
  const fid = fidelityOf(receiptOf(reply, what).raw, what);
  const f: string[] = [];
  if (fid.worst.length === 0) f.push(`export.fidelity: ${fid.floor} dB floor: ${what}: the receipt reports no worst 1%`);
  const under = fid.worst.filter((w) => !meetsFloor(w.psnr_y, w.ssim, fid.floor));
  if (under.length || !meetsFloor(fid.psnrY, fid.ssim, fid.floor)) f.push(`export.fidelity: ${fid.floor} dB floor: worst frames ${under.map((w) => w.frame).join(', ')}: ${what} reads PSNR-Y ${String(fid.psnrY)} dB and SSIM ${String(fid.ssim)}, under its floor, and was delivered`);
  return f;
}
/** The encoder's quality floor the export asked the encode tool for (README: `encoder.quality_floor`). */
function qualityFloor(reply: JsonObject, what: string): number {
  const e = obj(receiptOf(reply, what).raw['encoder'], `${what}: receipt.encoder`);
  expect(typeof e['quality_floor'] === 'number', `${what}: receipt.encoder.quality_floor is a number, got ${show(e['quality_floor'] ?? null)}`).toBe(true);
  return e['quality_floor'] as number;
}

const GRAIN = [{ grain: { amount: '25%', size: 1, tone: 'flat', rate: 24 } }];
const grainFilm = (evidence: string): JsonObject => filmDoc(evidence, { frames: 48, look: lookOf('grain-157', {}, GRAIN) });

describe(`${AC[4]} a grain look raises the encoder's quality floor, and a starved encode of it fails export.fidelity`, () => {
  it(`${AC[4]} the grain film is delivered with every frame at or over the 40 dB floor, its encoder's quality floor raised above the same film's without grain`, () => {
    const evidence = temp(); const dir = temp();
    const [shown, grain, bare] = filmRun(shows.bin(FULL), evidence, grainFilm(evidence), [
      present(DOC.b, filmDoc(evidence, { frames: 48 })),
      exportCall({ out: join(dir, 'grain.mp4'), ...H264_AAC }),
      exportCall({ doc: DOC.b, out: join(dir, 'bare.mp4'), ...H264_AAC }),
    ], 'the grain film and the same film without grain');
    presented(shown!, 'the film without grain');
    none(floorFailures(grain!, 'the grain film'), 'export.fidelity on the grain film at the raised floor');
    expect(fidelityOf(receiptOf(grain!, 'the grain film').raw, 'the grain film').floor, 'the grain film is held to the standard floor, 40 dB').toBe(40);
    const [g, b] = [qualityFloor(grain!, 'the grain film'), qualityFloor(bare!, 'the film without grain')];
    expect(g > b, `the grain look raises the encoder's quality floor: ${g} with grain, ${b} without`).toBe(true);
  }, TIMEOUT);

  it(`${AC[4]} a planted starved-bitrate encode of the grain film fails export.fidelity, naming its worst frames`, () => {
    const evidence = temp(); const dir = temp();
    const [reply] = filmRun(shows.bin(FULL), evidence, grainFilm(evidence), [exportCall({ out: join(dir, 'grain.mp4'), ...H264_AAC })], 'the grain film', 'encoder_starves_bitrate');
    failsNaming(floorFailures(reply!, 'the starved grain film'), /^export\.fidelity: \S+ dB floor: worst frames \d+/, 'the planted encode (encoder_starves_bitrate)');
  }, TIMEOUT);
});

describe(`${AC[18]} video.quality sets the export.fidelity floor, master at 45 dB`, () => {
  it(`${AC[18]} the film at video.quality draft, standard and master is held to 35, 40 and 45 dB, and each meets its floor`, () => {
    const evidence = temp(); const dir = temp();
    const levels = [['draft', 35], ['standard', 40], ['master', 45]] as const;
    const replies = filmRun(shows.bin(FULL), evidence, filmDoc(evidence, { frames: 48 }),
      levels.map(([q]) => exportCall({ out: join(dir, `${q}.mp4`), video: { codec: 'h264', quality: q }, audio: { codec: 'aac' } })), 'the film at three qualities');
    const f: string[] = [];
    levels.forEach(([q, floor], i) => {
      const fid = fidelityOf(receiptOf(replies[i]!, `video.quality ${q}`).raw, `video.quality ${q}`);
      if (fid.floor !== floor) f.push(`export.fidelity: video.quality ${q} holds the floor at ${fid.floor} dB, not ${floor}`);
      f.push(...floorFailures(replies[i]!, `video.quality ${q}`));
    });
    none(f, 'the floors by video.quality');
  }, TIMEOUT);

  it(`${AC[18]} a planted starved encode at video.quality master fails the 45 dB floor`, () => {
    const evidence = temp(); const dir = temp();
    const [reply] = filmRun(shows.bin(FULL), evidence, filmDoc(evidence, { frames: 48 }),
      [exportCall({ out: join(dir, 'master.mp4'), video: { codec: 'h264', quality: 'master' }, audio: { codec: 'aac' } })], 'the film at master', 'encoder_starves_bitrate');
    failsNaming(floorFailures(reply!, 'the starved film at master'), /^export\.fidelity: 45 dB floor/, 'the planted encode (encoder_starves_bitrate) at master');
  }, TIMEOUT);
});

/** The kit's report of export.target@1 and the listing's entries: video and png each declare export.fidelity, and the
 * kit's fidelity part of each PASSes. Each failure starts `<target>: export.fidelity:`. */
function kitFailures(listing: JsonObject, kit: JsonObject): string[] {
  const f: string[] = [];
  const reg = arr(listing['registries'], 'registries').filter(isObject).find((r) => r['name'] === 'export.target@1');
  const report = arr(kit['registries'], 'kit: registries').filter(isObject).find((r) => r['registry'] === 'export.target@1');
  if (!reg || !report) return [`export.target@1: the listing or the kit has no export.target@1: ${show(listing, 400)} ${show(kit, 400)}`];
  for (const name of ['video', 'png']) {
    const entry = arr(reg['entries'], 'export.target@1 entries').filter(isObject).find((e) => e['name'] === name);
    if (!entry || !Array.isArray(entry['fidelity']) || !entry['fidelity'].includes('export.fidelity')) f.push(`${name}: export.fidelity: the listing's entry doesn't name export.fidelity as its fidelity check: ${show(entry ?? null, 400)}`);
    const k = arr(report['entries'], 'kit entries').filter(isObject).find((e) => e['name'] === name);
    const part = k && Array.isArray(k['parts']) ? k['parts'].filter(isObject).find((p) => p['part'] === 'fidelity') : undefined;
    if (!part) { f.push(`${name}: export.fidelity: the kit's entry has no fidelity part: ${show(k ?? null, 400)}`); continue; }
    if (part['check'] !== 'export.fidelity') f.push(`${name}: export.fidelity: the kit's fidelity part runs ${String(part['check'])}`);
    if (part['verdict'] !== 'PASS') f.push(`${name}: export.fidelity: the kit's fidelity part is ${String(part['verdict'])}: ${JSON.stringify(part['failures'] ?? []).slice(0, 600)}`);
  }
  return f;
}
function kitRun(planted?: Planted): string[] {
  const calls: JsonObject[] = [{ call: 'registries' }, { call: 'kit', registries: ['export.target@1'] }];
  const [listing, kit] = runShow(shows.bin(FULL), scenario(temp(), calls, planted ? { planted } : {}), planted ? `the kit (planted ${planted})` : 'the kit');
  return kitFailures(listing!, kit!);
}

describe(`${AC[20]} export.target@1's kit runs each entry's fixture film through export.fidelity`, () => {
  it(`${AC[20]} the video and png entries name export.fidelity and each passes the kit's fidelity part`, () => {
    none(kitRun(), 'the kit of export.target@1');
  }, TIMEOUT);

  it(`${AC[20]} a planted video writer that drops one frame fails export.fidelity in the kit, naming the frame`, () => {
    failsNaming(kitRun('video_writer_drops_frame'), /^video: export\.fidelity: .*frame 2\b/, 'the planted writer (video_writer_drops_frame)');
  }, TIMEOUT);
});

const NTSC: [number, number] = [24000, 1001];
/** AC21's judge: delivered; the decode worker presents 1,440 frames, frame k at exactly k × 1001/24000 s, and decodes
 * 2,882,880 sample frames on each channel. Each failure starts `export.fidelity: frame <k>` or `samples:`. */
function timeFailures(replies: JsonObject[], dir: string): string[] {
  const [exported, imported, decoded] = replies;
  if (exported!['outcome'] !== 'exported') {
    const issues = issuesOf(exported!, 'export.fidelity');
    if (!issues.length) return [`export.fidelity: the export wasn't delivered and export.fidelity names nothing: ${issueLines(exported!).join(' | ').slice(0, 800)}`];
    return issues.map((i) => `export.fidelity: frame ${Math.min(...framesNamed(i))}: ${JSON.stringify(i).slice(0, 600)}`);
  }
  const f: string[] = [];
  const v = assetOf(imported!, 'the delivery\'s probe').streams.filter((s) => s.type === 'video');
  expect(v.length, 'the delivery holds one video stream').toBe(1);
  const pts = v[0]!.pts!.map((p, k) => rat(p, `frame ${k}'s presentation time`));
  if (pts.length !== 1440) f.push(`export.fidelity: frame ${Math.min(pts.length, 1440)}: the decode worker presents ${pts.length} frames, not 1,440`);
  const k = pts.findIndex((p, i) => !ratEq(p, { n: BigInt(i) * 1001n, d: 24000n }));
  if (k >= 0) f.push(`export.fidelity: frame ${k}: the decode worker presents it at ${showRat(pts[k]!)} s, not ${k} × 1001/24000 s`);
  const a = decodedOf(decoded!, join(dir, 'decoded'), 'the delivery\'s sound').audio;
  expect(a.length, 'the delivery holds one audio stream').toBe(1);
  if (a[0]!.samples !== 2_882_880) f.push(`samples: the decode worker decodes ${a[0]!.samples} sample frames per channel, not 2,882,880`);
  return f;
}
function ntscRun(planted?: Planted): string[] {
  const evidence = temp(); const dir = temp(); const out = join(dir, 'ntsc.mp4');
  const replies = filmRun(shows.bin(FULL), evidence, filmDoc(evidence, { frames: 1440, rate: NTSC }), [
    exportCall({ out, ...H264_AAC }), mediaImport(out), mediaDecode(out, join(dir, 'decoded'), { video_frames: 0 }),
  ], 'the 1,440-frame film at 24000/1001', planted);
  return timeFailures(replies, dir);
}

describe(`${AC[21]} every frame of a 24000/1001 delivery is presented at its exact time`, () => {
  it(`${AC[21]} the 1,440-frame film at 24000/1001 with 48 kHz audio decodes with frame k at exactly k × 1001/24000 s and 2,882,880 sample frames per channel`, () => {
    expect(1440 * 2002, '1,440 frames of 1001/24000 s hold 2,882,880 samples at 48 kHz').toBe(2_882_880);
    none(ntscRun(), 'the 24000/1001 delivery read by the decode worker');
  }, TIMEOUT);

  it(`${AC[21]} planted muxers with a 600 and with a 1,000 video timescale each fail, naming frame 1`, () => {
    failsNaming(ntscRun('muxer_timescale_600'), /^export\.fidelity: frame 1\b/, 'the planted muxer (muxer_timescale_600)');
    failsNaming(ntscRun('muxer_timescale_1000'), /^export\.fidelity: frame 1\b/, 'the planted muxer (muxer_timescale_1000)');
  }, TIMEOUT);
});
