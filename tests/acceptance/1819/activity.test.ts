// AC3: "On a fixture of three speech spans between 1 s silences under music, the activity bake gives three spans whose
// edges lie within 50 ms of the fixture's; a planted bake that thresholds level instead marks the music as speech and
// fails, naming the span"
//
// The fixture (fixtures/synth.ts speechUnderMusic): three phrases spoken by macOS `say`, each cut where it rises above
// and falls below −40 dBFS, laid from 1 s with 1 s between them, over a chord pad at −35 dBFS RMS for the whole length,
// 16 kHz; the spans' edges are the cuts' first and last samples. Through the design's surfaces (README: The surface):
// media_bake {kind: activity, analyzer: silero-vad@6.2.3, threshold: 0.5} with no record is BLOCKED and keeps the PCM;
// deep_job runs bake.activity on silero-vad@6.2.3 with that PCM by hash; media_bake with the record answers `spans`,
// three, each edge within 50 ms of its phrase's. The planted bake `activity_level_threshold` (a deep-show scenario
// plant: speech wherever a frame's RMS is at least −50 dBFS, README: Planted programs) marks the music as speech and
// fails, its first failure naming a span.
import { describe, expect, it } from 'vitest';
import { pcmBytes, sha256, speechUnderMusic, wavF32 } from './fixtures/synth.ts';
import { AC, FLICKS, JOB, MS, TIMEOUT, VAD, bakes, mustBlockForPcm, mustRecord, openWorld, proof, readings, sec, useShow, withBakes, type Bake, type Line, type ShowPlant } from './helpers.ts';

const show = useShow();
const TOLERANCE = 50 * MS;
type Span = { start: number; end: number };
const ms = (f: number): string => `${(f / MS).toFixed(0)} ms`;

/** The bake's spans against the fixture's, in order; each failure names the span it is about. */
function judgeSpans(got: Line[] | undefined, truth: Span[]): string[] {
  if (!Array.isArray(got)) return [`the activity bake answers no \`spans\` list: ${JSON.stringify(got)}`];
  const f: string[] = [];
  const spans = got.map((s) => ({ start: Number(s?.start), end: Number(s?.end) }));
  spans.forEach((s, i) => {
    const name = `span ${i + 1} of ${spans.length} (${sec(s.start)} to ${sec(s.end)})`;
    const t = truth[i];
    if (!Number.isSafeInteger(s.start) || !Number.isSafeInteger(s.end)) f.push(`${name}: its edges are not whole numbers of flicks: ${JSON.stringify(got[i])}`);
    else if (!t) f.push(`${name}: the fixture has only ${truth.length} speech spans, so this one marks music as speech`);
    else if (Math.abs(s.start - t.start) > TOLERANCE || Math.abs(s.end - t.end) > TOLERANCE) f.push(`${name}: speech span ${i + 1} of the fixture runs ${sec(t.start)} to ${sec(t.end)}; this one's start is ${ms(s.start - t.start)} and its end ${ms(s.end - t.end)} from it (50 ms allowed)`);
  });
  for (let i = spans.length; i < truth.length; i++) f.push(`speech span ${i + 1} of the fixture (${sec(truth[i]!.start)} to ${sec(truth[i]!.end)}) has no span in the bake`);
  return f;
}

/** How much of the spans lies where the fixture has only music. */
function musicMarked(spans: Line[], truth: Span[]): number {
  let speech = 0;
  let marked = 0;
  for (const s of spans) {
    marked += Number(s.end) - Number(s.start);
    for (const t of truth) speech += Math.max(0, Math.min(Number(s.end), t.end) - Math.max(Number(s.start), t.start));
  }
  return marked - speech;
}

describe('AC3 the activity bake finds three speech spans under music within 50 ms', () => {
  it(`${AC[3]} three phrases between 1 s silences over music give three spans, each edge within 50 ms; the planted bake activity_level_threshold marks the music as speech and fails, naming the span`, async () => {
    const fx = speechUnderMusic();
    const wav = wavF32(fx.samples, fx.rate);
    const asset = sha256(wav);
    const truth = fx.spans.map((s) => ({ start: Math.round((s.start * FLICKS) / fx.rate), end: Math.round((s.end * FLICKS) / fx.rate) }));
    const w = await openWorld([wav]);
    const ask: Bake = { asset, kind: 'activity', analyzer: VAD, threshold: 0.5 };
    const pcm = mustBlockForPcm(show(), w, ask, pcmBytes(fx.samples), 'the phrases under music, with no record');

    await withBakes(w);
    const { record } = await mustRecord(w, JOB.activity, VAD, [{ name: 'pcm', sha256: pcm }], fx.rate);
    const asked = { ...ask, record };
    const spans = readings(bakes(show(), w, [asked], 'the phrases under music')[0]!, ask, 'the activity bake').spans as Line[] | undefined;
    const failures = judgeSpans(spans, truth);
    proof('ac3-spans.json', { asset, pcm, record, truth: truth.map((t) => [sec(t.start), sec(t.end)]), spans, failures });
    expect(failures, 'three spans, each edge within 50 ms of its phrase\'s').toEqual([]);

    const plant: ShowPlant = 'activity_level_threshold';
    const levelled = readings(bakes(show(), w, [asked], 'the phrases under music', plant)[0]!, ask, `the activity bake (planted ${plant})`).spans as Line[] | undefined;
    const wrong = judgeSpans(levelled, truth);
    proof('ac3-planted.json', { plant, spans: levelled, failures: wrong });
    expect(Array.isArray(levelled) && musicMarked(levelled, truth) >= FLICKS, `the planted bake ${plant} marks the music as speech (at least 1 s of its spans lies where there is only music): ${JSON.stringify(levelled)}`).toBe(true);
    expect(wrong[0] ?? '', `the planted bake ${plant} fails, its first failure naming a span: ${JSON.stringify(wrong)}`).toMatch(/^span \d+ of \d+ \(/);
  }, TIMEOUT);
});
