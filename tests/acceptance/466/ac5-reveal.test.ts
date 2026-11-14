// AC5 #466.d3ce896d: A typewriter title emits one occurrence per grapheme at its reveal time, and a spawn on that list
// starts each voice on its occurrence's sample.
//
// Through `deep-show run` (`full`). A 480 × 270 film at 60 fps, 3 s, 48 kHz: the title `title` ("Typewriter", ten
// graphemes) with `reveal: {mode: "fade", order: "reading", progress, emits: true}`, its progress keyed linearly from 0
// at 0.5 s to 1 at 2.5 s, and a spawn `blip` on `title.reveal` playing a one-sample click (a 16-bit WAV in the evidence
// store) with no cooldown.
//   - The list: #387's `eval` with `film: true` at every 60 fps frame from 0.4 s to 2.6 s; the film block's
//     `occurrences["title.reveal"]` holds ten rows in reading order, row k naming unit k and its grapheme, at its reveal
//     time: the flick its unit's own reveal reaches half (the design's `#head` rule: a unit "passed 0.5"). So glyph k's
//     opacity in the film block's `glyphs.title` is under 0.5 on the last frame before row k's time and at least 0.5 on
//     the first frame at or after it. The planted `reveal_emits_at_unit_start` puts each row where its unit's reveal
//     starts, and the same judge fails, naming the first row, title.reveal[0].
//   - The voices: `media_mix` (#499's, with #500's `voices`) of the same film over [0, 3 s) with `write: true`: ten
//     voices, voice k on occurrence k, and the mixed samples hold exactly ten clicks, click k on the first sample at or
//     after row k's time, ⌈t ÷ 14,700⌉ (Spawn: "a voice starts at its flick, sample-accurately").
import { describe, expect, it } from 'vitest';
import { asset, pcmOf } from '../500/spawn/helpers.ts';
import {
  AC, DOC, FLICKS_PER_S, FRAME60, FULL, TIMEOUT, arr, camera2d, evalCall, evaluated, failsNaming, film, fl, none, num, obj, present, presented,
  rect, show, show1, sOf, str, useEvidence, useShow, withLook, lookFrom, type JsonObject, type Planted,
} from './helpers.ts';

const shows = useShow([FULL]);
const evidence = useEvidence();
const TITLE = 'Typewriter';
const SAMPLE = FLICKS_PER_S / 48_000;
const FROM = 24;
const TO = 156;

function revealFilm(click: string): JsonObject {
  const title: JsonObject = {
    id: 'title', kind: 'text@1', name: 'Title', order: 'c1', at: { pos: [40, 100, 0] },
    params: { text: TITLE, font: 'body', size: 48, box: { w: 400, h: 70 }, reveal: { mode: 'fade', order: 'reading', progress: 0, emits: true } },
  };
  const doc = film('reveal', [camera2d([480, 270]), rect('back', [0, 0, 480, 270], 'ground'), title], {
    channels: { type_on: { target: 'items/title/params/reveal/progress', type: 'f32', keys: { k0: { t: '0.5s', value: 0, interp: 'linear' }, k1: { t: '2.5s', value: 1, interp: 'linear' } } } },
    spawns: { blip: { on: { list: 'title.reveal' }, play: { src: { asset: click }, in: 0, out: 2400 * SAMPLE }, cooldown: 0 } },
  }, { span: '3s', frame_rate: '60/1', sample_rate: 48_000 });
  return withLook(evidence(), doc, { 'reveal-clean': lookFrom('reveal-clean') }, 'reveal-clean');
}
interface Row { t: number; unit: number; grapheme: string }

/** The list, the glyphs' opacities and the clicks, each failure naming its row. */
function revealFailures(planted?: Planted): string[] {
  const click = new Float32Array(2400); click[0] = 0.9;
  const { sha } = asset(evidence(), [click]);
  const doc = revealFilm(sha);
  const frames = Array.from({ length: TO - FROM + 1 }, (_, i) => (FROM + i) * FRAME60);
  const mixCall: JsonObject = { call: 'media_mix', doc: present(DOC.a, doc)['document'] as JsonObject, segments: [{ from: 0, to: fl(3), write: true }] };
  const replies = show1(shows.bin(FULL), evidence(), [present(DOC.a, doc), ...frames.map((t) => evalCall(DOC.a, t, { film: true })), mixCall], planted);
  presented(replies[0]!, 'the typewriter film');
  const blocks = frames.map((t, i) => obj(evaluated(replies[1 + i]!, `eval at ${sOf(t)}`)['film'], `eval at ${sOf(t)}: film`));
  const list = arr(obj(blocks[0]!['occurrences'], 'film.occurrences')['title.reveal'], 'film.occurrences["title.reveal"]').map((v, k): Row => {
    const o = obj(v, `title.reveal[${k}]`);
    return { t: num(o['t'], `title.reveal[${k}].t`), unit: num(o['unit'], `title.reveal[${k}].unit`), grapheme: str(o['grapheme'], `title.reveal[${k}].grapheme`) };
  });
  const opacity = (i: number, k: number): number => num(obj(arr(obj(blocks[i]!['glyphs'], 'film.glyphs')['title'], 'film.glyphs.title')[k], `film.glyphs.title[${k}]`)['opacity'], `film.glyphs.title[${k}].opacity`);
  const failures: string[] = [];
  const graphemes = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(TITLE)].map((s) => s.segment);
  if (list.length !== graphemes.length) failures.push(`title.reveal holds ${list.length} rows, not one per grapheme (${graphemes.length})`);
  list.forEach((row, k) => {
    const at = `title.reveal[${k}] (${JSON.stringify(graphemes[k])})`;
    if (row.unit !== k || row.grapheme !== graphemes[k]) failures.push(`${at}: names unit ${row.unit}, ${JSON.stringify(row.grapheme)}, not unit ${k}, ${JSON.stringify(graphemes[k])}`);
    if (k > 0 && !(row.t > list[k - 1]!.t)) failures.push(`${at}: at ${sOf(row.t)}, not after the row before it (${sOf(list[k - 1]!.t)})`);
    const after = Math.ceil(row.t / FRAME60) - FROM;
    if (after < 1 || after >= frames.length) { failures.push(`${at}: at ${sOf(row.t)}, outside the reveal`); return; }
    const [before, then] = [opacity(after - 1, k), opacity(after, k)];
    if (!(before < 0.5 && then >= 0.5)) failures.push(`${at}: at ${sOf(row.t)}, but its glyph's opacity is ${before.toFixed(3)} on the frame before and ${then.toFixed(3)} on the frame at or after, so it isn't the time its reveal reaches half`);
  });
  const mix = obj(obj(replies[replies.length - 1], 'media_mix')['mix'], 'media_mix: mix');
  const voices = arr(mix['voices'], 'mix.voices').map((v, i) => obj(v, `mix.voices[${i}]`));
  if (voices.length !== list.length) failures.push(`the spawn starts ${voices.length} voices on ${list.length} rows`);
  voices.forEach((v, i) => { if (v['occurrence'] !== i) failures.push(`voice ${i} plays occurrence ${show(v['occurrence'])}, not ${i}`); });
  const seg = obj(arr(mix['segments'], 'mix.segments')[0], 'mix.segments[0]');
  const pcm = pcmOf(evidence(), {
    from: 0, to: fl(3), first: num(seg['first'], 'first'), frames: num(seg['frames'], 'frames'), channels: num(seg['channels'], 'channels'),
    sha256: str(seg['sha256'], 'sha256'), wav: str(seg['wav'], 'wav'),
  }, 'the typewriter film\'s sound');
  const x = pcm.channels[0]!;
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const clicks: number[] = [];
  for (let n = 0; n < x.length; n++) if (Math.abs(x[n]!) > 0.3 * peak && (n === 0 || Math.abs(x[n - 1]!) <= 0.3 * peak)) clicks.push(pcm.first + n);
  if (clicks.length !== list.length) failures.push(`the sound holds ${clicks.length} clicks, not one per row (${list.length})`);
  list.forEach((row, k) => {
    const want = Math.ceil(row.t / SAMPLE);
    if (clicks[k] !== want) failures.push(`title.reveal[${k}] (${JSON.stringify(graphemes[k])}): its click starts on sample ${String(clicks[k])}, not ${want}, the first at or after its ${sOf(row.t)}`);
  });
  return failures;
}

describe(`${AC[5]} a typewriter title's reveal times, and a voice per letter on them`, () => {
  it(`${AC[5]} the title emits one row per grapheme at the time its reveal reaches half, and the spawn starts each click on its row's sample`, () => {
    none(revealFailures(), 'the typewriter title');
  }, TIMEOUT);

  it(`${AC[5]} (planted) rows at each unit's reveal start fail, naming the first row`, () => {
    const failures = revealFailures('reveal_emits_at_unit_start');
    failsNaming(failures, ['title.reveal[0]'], 'the planted reveal_emits_at_unit_start');
    expect(failures.some((f) => f.includes('reaches half')), 'the failure is the reveal time, not a missing field').toBe(true);
  }, TIMEOUT);
});
