// #509.d30b5b10 (Oracle lane, run on our code and port): whisper.cpp at d1be6fde11ac6e0407606b4e42fe72d34add8037,
// tests/run-tests.sh with tests/en-0-ref.txt, en-1-ref.txt and en-2-ref.txt, scored as tests/librispeech/eval.py scores
// a transcript: a normalizer on both sides, then word errors over the reference's words (WER). run-tests.sh fetches
// three English recordings (its `urls_en`, in order), converts each with `ffmpeg -ar 16000 -ac 1`, transcribes it with
// the model under test and diffs the text against `en-<i>-ref.txt`; for an `.en` model it runs no other language. Here
// the model under test is ours: each recording, converted the same way to 16 kHz mono (as f32, the PCM our job takes),
// is put in a real hub's store as yours and transcribed by deep_job narration.transcript on whisper-cpp@1.9.5
// (deepbuild/speech, its host on 8720; English reads with base.en); the record's `text` is compared with the reference
// by our comparison, `media_heard` (normalizer@1 on both sides, as eval.py runs its normalizer on both). run-tests.sh
// judges by eye and eval.py prints a number, so the bound is this lane's (README: Readings): each recording's WER at most
// 0.2, which a transcriber, normalizer or comparison that is broken misses by far.
// No upstream file is copied: the recordings and the three reference texts are read from a cache folder, and a lane that
// can't read them, or has no ffmpeg, fails BLOCKED with one unblock line.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, FULL, SPEECH, TIMEOUT, TRANSCRIBER, blocked, hear, openWorld, proof, readJson, sha256, transcribe, useShow, useTemp, withPlugin } from '../509/helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const PIN = 'd1be6fde11ac6e0407606b4e42fe72d34add8037';
/** run-tests.sh's urls_en, in its order; each is saved as en-<i>.<its extension>. */
const URLS = [
  'https://upload.wikimedia.org/wikipedia/commons/1/1f/George_W_Bush_Columbia_FINAL.ogg',
  'https://upload.wikimedia.org/wikipedia/en/d/d4/En.henryfphillips.ogg',
  'https://cdn.openai.com/whisper/draft-20220913a/micro-machines.wav',
];
const FILES = URLS.map((u, i) => `en-${i}.${u.slice(u.lastIndexOf('.') + 1)}`);
const MAX_WER = 0.2;
const CACHE = process.env['DEEP_WHISPER_TESTS'] ?? join(homedir(), 'Library', 'Caches', 'deepbuild', 'whisper-cpp-tests');
const UNBLOCK = `Unblock: mkdir -p "${CACHE}" && cd "${CACHE}" && ${URLS.map((u, i) => `curl -fL -o ${FILES[i]} ${u}`).join(' && ')} && for i in 0 1 2; do gh api "repos/DeepBuildAI/deepbuild/contents/doneright/oracles/vendor/whisper-cpp-d1be6fde11/tests/en-$i-ref.txt?ref=doneright" -H "Accept: application/vnd.github.raw" > en-$i-ref.txt; done (or name another folder in DEEP_WHISPER_TESTS), and brew install ffmpeg`;

function ffmpeg(): string | null {
  for (const c of [process.env['DEEP_FFMPEG'], 'ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']) {
    if (!c) continue;
    const r = spawnSync(c, ['-hide_banner', '-version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return c;
  }
  return null;
}

describe(`${AC[1]} run-tests.sh's English recordings (whisper.cpp ${PIN.slice(0, 10)}) transcribed by our narration.transcript job and scored as eval.py scores them`, () => {
  it(`${AC[1]} each of en-0, en-1 and en-2, transcribed by ${TRANSCRIBER} through deep_job, reads within WER ${MAX_WER} of its ref.txt through normalizer@1 on both sides`, async () => {
    const tool = ffmpeg();
    if (!tool) blocked(`run-tests.sh converts each recording with ffmpeg, and none was found on PATH, in /opt/homebrew/bin or /usr/local/bin. ${UNBLOCK}`);
    const missing = [...FILES, 'en-0-ref.txt', 'en-1-ref.txt', 'en-2-ref.txt'].filter((f) => !existsSync(join(CACHE, f)));
    if (missing.length) blocked(`the upstream test data isn't in ${CACHE}: ${missing.join(', ')}. ${UNBLOCK}`);
    const pcm = FILES.map((f) => new Uint8Array(execFileSync(tool!, ['-hide_banner', '-loglevel', 'error', '-i', join(CACHE, f), '-ar', '16000', '-ac', '1', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 })));
    const refs = FILES.map((_, i) => readFileSync(join(CACHE, `en-${i}-ref.txt`), 'utf8').trim());
    const w = await openWorld(pcm);
    await withPlugin(w, SPEECH);
    const texts: string[] = [];
    for (const [i, p] of pcm.entries()) {
      const { record } = await transcribe(w, { line: `en-${i}`, scope: 'line', pcm: sha256(p), sample_rate: 16_000, channels: 1, locale: 'en', raw: {} }, []);
      const t = readJson(w.evidence, record, `en-${i}'s transcript`)['text'];
      expect(typeof t, `en-${i}'s transcript record holds its text`).toBe('string');
      texts.push(t as string);
    }
    const scored = hear(shows.bin(FULL), temp(), refs.map((r, i) => ({ expected: r, heard: texts[i]!, locale: 'en' })), 'the reference texts against our transcripts');
    const wer = scored.map((h) => (h.missing.length + h.extra.length + h.wrong.length) / Math.max(1, h.expected.length));
    proof('oracle-run-tests.json', FILES.map((f, i) => ({ file: f, transcript: texts[i], wer: wer[i], missing: scored[i]!.missing, extra: scored[i]!.extra, wrong: scored[i]!.wrong })));
    const failures = wer.flatMap((x, i) => (x <= MAX_WER ? [] : [`${FILES[i]}: WER ${x.toFixed(3)} against en-${i}-ref.txt, over ${MAX_WER}`]));
    expect(failures, failures.join('\n')).toEqual([]);
  }, TIMEOUT);
});
