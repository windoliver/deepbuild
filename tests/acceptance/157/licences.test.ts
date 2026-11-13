// AC6 #157.155f2628: "An export using a CC BY library without its credit fails, and one with a narrator of unknown
// licence is BLOCKED with one ask"
//
// Through `deep-show run`'s `export`. The library film: the fixture film (helpers.ts `filmDoc`) with no tone, whose one
// strip plays `stem`, a job output whose licence is derived from its input, `license: {from: ["piano_lib"]}` (the
// issue's `license.from`), and `piano_lib`, a CC BY 4.0 sample library, with its credit or without. The export's
// credits walk that graph: with the credit it is delivered and the receipt's `licenses` and `credits` name the library
// through the stem; without it the export FAILs, naming the library. The narration film: one line, `hello`, spoken by
// its own recording (a tone, with a words record written here, #502's shapes), under a narrator whose licence names no
// terms and no `shareable`: the export is BLOCKED with exactly one ask, naming the narrator, and writes nothing.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pcmBytes, wavF32 } from '../502/helpers.ts';
import {
  AC, CC0, FLICKS, FULL, H264_AAC, TIMEOUT, arr, exportCall, filmDoc, filmRun, isObject, issueLines, leftIn, putEvidence, receiptOf, sha256, show,
  soundStrip, toneChannels, useShow, useTemp, type JsonObject,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const SR = 48_000;
const CREDIT = 'Piano samples recorded for the #157 acceptance tests, CC BY 4.0';

/** The library film: the stem plays; the library is its input; its CC BY licence carries the credit or not. */
function libraryFilm(evidence: string, credit: boolean): JsonObject {
  const lib = putEvidence(evidence, wavF32(toneChannels(SR, SR)[0]!, SR));
  const stem = soundStrip(evidence, toneChannels(2 * SR, SR), SR, 0, 1);
  return filmDoc(evidence, {
    frames: 48, sound: 'none',
    assets: {
      piano_lib: { sha256: lib, license: { id: 'CC-BY-4.0', terms: 'Creative Commons Attribution 4.0 International.', shareable: true, ...(credit ? { credit: CREDIT } : {}) } },
      stem: { sha256: stem.sha, license: { from: ['piano_lib'] } },
    },
    strips: { stem: stem.strip },
  });
}
function libraryRun(credit: boolean): { reply: JsonObject; dir: string } {
  const evidence = temp(); const dir = temp();
  const [reply] = filmRun(shows.bin(FULL), evidence, libraryFilm(evidence, credit), [exportCall({ out: join(dir, 'film.mp4'), ...H264_AAC })], credit ? 'the film whose library carries its credit' : 'the film whose library lacks its credit');
  return { reply: reply!, dir };
}

/** The narration film: one recorded line under a narrator whose licence is unknown. */
function narratedFilm(evidence: string): JsonObject {
  const x = toneChannels(SR, SR)[0]!;
  const wav = wavF32(x, SR);
  const record = new TextEncoder().encode(JSON.stringify({
    kind: 'bake.words', analyzer: 'charsiu-aligner@1.0.0', weights: [], pcm_sha256: sha256(pcmBytes(x)), frame: FLICKS / 100,
    words: [{ text: 'hello', start: 4_800 * (FLICKS / SR), end: 24_000 * (FLICKS / SR), phonemes: [] }],
  }));
  const voice = putEvidence(evidence, wav);
  const words = putEvidence(evidence, record);
  return filmDoc(evidence, {
    frames: 48, locale: 'en',
    assets: { voice_hello: { sha256: voice, license: CC0, attached: [words] } },
    script: {
      narrator: { name: 'An unnamed voice', license: { id: 'LicenseRef-unknown' }, synthetic: false },
      lines: { hello: { t: '0.5s', text: 'Hello', recording: { asset: 'voice_hello' } } },
      captions: { profile: 'netflix-en-adult' },
    },
  });
}

describe(`${AC[6]} credits walk the licences through jobs, and an unknown narrator licence asks once`, () => {
  it(`${AC[6]} with the CC BY library's credit the export is delivered, its receipt's licences and credits naming the library through the stem; without it the export FAILs, naming the library, and writes nothing`, () => {
    const credited = libraryRun(true);
    const r = receiptOf(credited.reply, 'the credited film').raw;
    const licenses = arr(r['licenses'], 'receipt.licenses').filter(isObject);
    expect(licenses.some((l) => l['asset'] === 'piano_lib' && l['id'] === 'CC-BY-4.0'), `receipt.licenses lists piano_lib's CC BY 4.0, reached through the stem: ${show(r['licenses'] ?? null)}`).toBe(true);
    const credits = arr(r['credits'], 'receipt.credits').filter(isObject);
    expect(credits.some((c) => c['asset'] === 'piano_lib' && c['credit'] === CREDIT), `receipt.credits carries the library's credit: ${show(r['credits'] ?? null)}`).toBe(true);

    const bare = libraryRun(false);
    expect(bare.reply['outcome'], `the export FAILs: ${issueLines(bare.reply).join(' | ').slice(0, 800)}`).toBe('failed');
    expect(issueLines(bare.reply).some((l) => l.includes('"piano_lib"')), `an issue names the library piano_lib: ${issueLines(bare.reply).join(' | ').slice(0, 800)}`).toBe(true);
    expect(leftIn(bare.dir), 'the FAILed export wrote nothing').toEqual([]);
  }, TIMEOUT);

  it(`${AC[6]} an export narrated by a voice of unknown licence is BLOCKED with exactly one ask, naming the narrator, and writes nothing`, () => {
    const evidence = temp(); const dir = temp();
    const [reply] = filmRun(shows.bin(FULL), evidence, narratedFilm(evidence), [exportCall({ out: join(dir, 'film.mp4'), ...H264_AAC })], 'the film narrated by an unknown licence');
    expect(reply!['outcome'], `the export is BLOCKED: ${show(reply!, 800)}`).toBe('blocked');
    const asks = arr(reply!['asks'], 'the BLOCKED reply: asks');
    expect(asks.length, `exactly one ask: ${show(asks)}`).toBe(1);
    expect(JSON.stringify(asks[0]).includes('An unnamed voice'), `the ask names the narrator: ${show(asks[0] ?? null)}`).toBe(true);
    expect(leftIn(dir), 'the BLOCKED export wrote nothing').toEqual([]);
  }, TIMEOUT);
});
