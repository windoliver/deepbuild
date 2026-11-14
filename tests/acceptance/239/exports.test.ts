// AC1 #239.72f4af59: "Both films render from their documents, seek equals play by pixel hash at 20 sampled times on the
// reference Mac, and each exports to H.264 with AAC whose delivery passes film.blank, frames.finite, export.color and
// export.fidelity, sound included"
//
// This file: "each exports to H.264 with AAC whose delivery passes film.blank, frames.finite, export.color and
// export.fidelity, sound included". Through `deep-show run`'s `export` (#501's call, #157's guards and receipt): the
// whole film as an MP4 with `video: {codec: "h264"}` and `audio: {codec: "aac"}` at the default quality (standard,
// whose export.fidelity floor is PSNR-Y 40 dB). A guard that fails stops the export with an issue naming its check, so
// a delivery is film.blank's pass; the receipt carries the others': `nonfinite: []` (frames.finite), `color_probe`
// with tags nclx 1-1-1 and range tv within ±2 code values (export.color), and `fidelity` holding every frame and
// every sample frame a channel at its floor (export.fidelity), the sound's included: AAC at the film's sample rate,
// one PCM hash a frame and `av_offset` 0. This suite's own reader of the MP4 (#157's) reads an H.264 track of the
// film's frames tagged nclx 1-1-1 limited range, and an AAC track. Wrong programs: the base (no film: BLOCKED); a
// delivery any guard fails; one without its sound, or whose sound or frames the decoded file doesn't hold.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import {
  AC, FILMS, H264_AAC, LABEL, SHELL_DOC, TIMEOUT, fidelityOf, film, isObject, issuesIn, meetsFloor, none, presentFromShell, presentedClean, readMovie,
  receiptOf, runShow, samplesOf, shellScenario, show, stock, trackOf, useBuilds, useTemp, type Film, type JsonObject,
} from './helpers.ts';

const bin = useBuilds();
const temp = useTemp();

/** Every way the delivery misses the four guards or its sound, one sentence each. */
function deliveryFailures(f: Film, reply: JsonObject, out: string): string[] {
  const what = `${f.label}: the H.264 export with AAC`;
  if (reply['outcome'] !== 'exported') {
    const named = issuesIn(reply).map((i) => `${String(i['check'] ?? i['code'] ?? 'issue')}: ${JSON.stringify(i).slice(0, 500)}`);
    return [`${what} isn't delivered (${String(reply['outcome'])}${reply['code'] === undefined ? '' : ` ${String(reply['code'])}`}): ${named.join(' | ') || show(reply, 800)}`];
  }
  const fails: string[] = [];
  const r = receiptOf(reply, what);
  const raw = r.raw;
  if (JSON.stringify(r.size) !== JSON.stringify(f.size)) fails.push(`the receipt's size is ${show(r.size)}, not the film's ${show(f.size)}`);
  if (JSON.stringify(r.frame_rate) !== JSON.stringify(f.rate)) fails.push(`the receipt's frame rate is ${show(r.frame_rate)}, not the film's ${show(f.rate)}`);
  if (r.frame_hashes.length !== f.frames) fails.push(`the receipt hashes ${r.frame_hashes.length} frames, not the film's ${f.frames}`);
  // frames.finite
  if (!Array.isArray(raw['nonfinite']) || raw['nonfinite'].length !== 0) fails.push(`frames.finite: the receipt's nonfinite is ${show(raw['nonfinite'] ?? null)}, not []`);
  // export.color
  const probe = raw['color_probe'];
  if (!isObject(probe)) fails.push(`export.color: the receipt has no color_probe: ${show(probe ?? null)}`);
  else {
    const tags = probe['tags'];
    if (!isObject(tags) || JSON.stringify(tags['nclx']) !== '[1,1,1]' || tags['range'] !== 'tv') fails.push(`export.color: the probe reads tags ${show(tags ?? null)}, not nclx [1, 1, 1] and range tv`);
    const err = probe['max_error'];
    if (typeof err !== 'number' || !(err <= 2)) fails.push(`export.color: the probe decodes ${show(err ?? null)} code values off its bars and ramp, not within ±2`);
  }
  // export.fidelity, sound included
  const fid = fidelityOf(raw, what);
  const samples = samplesOf(f.frames, f.rate, f.sampleRate);
  if (fid.frames !== f.frames) fails.push(`export.fidelity: the delivery holds ${fid.frames} frames, not ${f.frames}`);
  if (fid.samples !== samples) fails.push(`export.fidelity: the delivery holds ${show(fid.samples)} sample frames a channel, not the ${samples} of ${f.frames} frames at ${f.sampleRate} Hz`);
  if (fid.floor !== 40) fails.push(`export.fidelity: its floor is ${fid.floor} dB, not standard quality's 40`);
  if (!meetsFloor(fid.psnrY, fid.ssim, fid.floor)) fails.push(`export.fidelity: its lowest frame reads PSNR-Y ${show(fid.psnrY)} dB and SSIM ${show(fid.ssim)}, under the ${fid.floor} dB floor`);
  for (const w of fid.worst) if (!meetsFloor(w.psnr_y, w.ssim, fid.floor)) fails.push(`export.fidelity: frame ${w.frame} reads PSNR-Y ${show(w.psnr_y)} dB, under the floor`);
  if (raw['audio'] !== 'aac') fails.push(`the receipt's audio is ${show(raw['audio'] ?? null)}, not aac`);
  if (raw['sample_rate'] !== f.sampleRate) fails.push(`the receipt's sample rate is ${show(raw['sample_rate'] ?? null)}, not the film's ${f.sampleRate}`);
  if (r.pcm_hashes.length !== f.frames) fails.push(`the receipt hashes the sound of ${r.pcm_hashes.length} frames, not ${f.frames}`);
  const av = raw['av_offset'];
  if (!isObject(av) || av['samples'] !== 0) fails.push(`export.fidelity: av_offset is ${show(av ?? null)}, not 0 samples`);
  // The delivered file, read here.
  const movie = readMovie(readFileSync(out), `${what}: the MP4`);
  const video = trackOf(movie, 'vide', `${what}: the MP4`);
  if (!/^avc[13]$/.test(video.entry)) fails.push(`the MP4's video track is ${video.entry}, not H.264 (avc1)`);
  if (video.samples !== f.frames) fails.push(`the MP4's video track holds ${video.samples} samples, not ${f.frames}`);
  const c = video.colr;
  if (!c || c.kind !== 'nclx' || c.primaries !== 1 || c.transfer !== 1 || c.matrix !== 1 || c.fullRange !== false) fails.push(`export.color: the MP4's colr box reads ${show(c as unknown as JsonObject ?? null)}, not nclx 1-1-1 limited range`);
  const sound = trackOf(movie, 'soun', `${what}: the MP4`);
  if (sound.entry !== 'mp4a') fails.push(`the MP4's sound track is ${sound.entry}, not AAC (mp4a)`);
  return fails;
}

describe(`${AC[1]} each film exports to H.264 with AAC whose delivery passes the export guards, sound included`, () => {
  for (const name of FILMS) {
    it(`${AC[1]} ${LABEL[name]} exports whole to H.264 with AAC, delivered past film.blank, frames.finite, export.color and export.fidelity, its sound included`, () => {
      const f = film(name);
      const evidence = temp(); const dir = temp();
      stock(evidence, f);
      const out = join(dir, `${f.name}.mp4`);
      const [shown, reply] = runShow(bin('deep-show full'), shellScenario(evidence, [
        presentFromShell(SHELL_DOC.a, f.document),
        { call: 'export', doc: SHELL_DOC.a, out, ...H264_AAC },
      ]), `${f.label}: the export`);
      presentedClean(shown!, `${f.label}: deep show`);
      none(deliveryFailures(f, reply!, out), `${f.label}: the delivery`);
    }, TIMEOUT);
  }
});
