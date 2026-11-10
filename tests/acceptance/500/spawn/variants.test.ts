// AC1: "A spawn with variants picks the same templates whether the film is played or seeked, and no_repeat never
// repeats the previous pick over 1,000 occurrences"
//
// Through `media_mix` (README: The surface under test). A 2D document: one baked list of 1,000 hits, 40 ms apart (past
// the 30 ms cooldown, so every occurrence starts a voice), and two spawns over it, each playing one of three 20 ms
// tones: `weighted` (weights 1, 2, 1, pick weighted) and `fresh` (pick no_repeat). The picks are read from the reply's
// `voices`; "played or seeked" is read from the samples: ten seeded 50 ms windows played straight through, then seeked
// to in a seeded order in the same run, and seeked to cold in a second run whose first segment is already a seek; every
// window hashes as played, and the second run's voices pick what the first run's did.
import { describe, expect, it } from 'vitest';
import {
  AC, MS, RATE, SAMPLE, TIMEOUT, asset, atSample, mix, playThenSeek, sOf, secs, seeded, tone, useEvidence, useShow,
  type MediaDoc, type Row, type Template, type Voice,
} from './helpers.ts';

const show = useShow();
const evidenceDir = useEvidence();

const N = 1000;
const LIST = 'board.occurrences';

const picks = (voices: Voice[]): string[] => voices.map((v) => `${v.spawn} occurrence ${v.occurrence} → template ${v.template}`).sort();

describe('AC1 spawn variants pick the same whether played or seeked, and no_repeat never repeats', () => {
  it(`${AC[1]} two spawns with three variants over 1,000 baked hits, weighted and no_repeat, give the same samples in ten seeded windows played, seeked and seeked cold, with the same picks; no_repeat's pick differs from the previous one at every occurrence`, () => {
    const evidence = evidenceDir();
    const len = Math.round(0.02 * RATE);
    const templates: Template[] = [330, 550, 770].map((hz) => ({ asset: asset(evidence, [tone(hz, len, 0.1)]).sha, in: 0, out: atSample(len) }));
    const rows: Row[] = Array.from({ length: N }, (_, k) => ({ t: secs(0.25) + k * 40 * MS, kind: 'hit', a: 1, b: 2 }));
    const span = secs(40.75);
    const on = { list: LIST, kinds: ['hit'] };
    const doc: MediaDoc = {
      transport: { sample_rate: RATE, span },
      occurrences: { [LIST]: rows },
      spawns: {
        weighted: { on, play: templates.map((template, i) => ({ template, weight: i === 1 ? 2 : 1 })), pick: 'weighted', seed: 500 },
        fresh: { on, play: templates.map((template) => ({ template })), pick: 'no_repeat', seed: 501 },
      },
    };

    // Ten 50 ms windows, one in each 4 s bin from 0.5 s, each starting on a seeded sample that isn't a block's first.
    const r = seeded(500_001);
    const W = 2400;
    const windows: [number, number][] = Array.from({ length: 10 }, (_, i) => {
      let n = 24_000 + i * 192_000 + Math.floor(r() * 180_000);
      if (n % 128 === 0) n += 37;
      return [n * SAMPLE, (n + W) * SAMPLE];
    });
    const f: string[] = [];

    const { segments, played } = playThenSeek(windows, span, r);
    const m = mix(show(), evidence, doc, segments, 'two spawns over 1,000 hits, played and then seeked');
    const heard = new Map(m.segments.slice(0, played).map((s) => [s.from, s.sha256]));
    const playedWindows = windows.map(([from]) => heard.get(from)!);
    expect(new Set(playedWindows).size > 1, 'the voices are heard: the ten played windows do not all hash alike').toBe(true);
    for (const s of m.segments.slice(played)) {
      if (s.sha256 !== heard.get(s.from)) f.push(`the seek to ${sOf(s.from)} renders other samples than playing, by hash`);
    }

    // The picks: one voice per occurrence per spawn, a template of the three, no_repeat never the previous one.
    for (const id of ['weighted', 'fresh']) {
      const vs = m.voices.filter((v) => v.spawn === id).sort((p, q) => p.occurrence - q.occurrence);
      const occ = vs.map((v) => v.occurrence);
      if (occ.length !== N || occ.some((o, k) => o !== k)) f.push(`spawn \`${id}\`: ${vs.length} voices over occurrences ${JSON.stringify(occ.slice(0, 5))}…, not one for each of the ${N} occurrences`);
      const bad = vs.find((v) => !(v.template >= 0 && v.template < 3));
      if (bad) f.push(`spawn \`${id}\`: occurrence ${bad.occurrence} picks template ${bad.template}, not one of its 3`);
      if (id === 'fresh') {
        const k = vs.findIndex((v, i) => i > 0 && v.template === vs[i - 1]!.template);
        if (k > 0) f.push(`spawn \`fresh\` (no_repeat): occurrence ${vs[k]!.occurrence} repeats the previous pick, template ${vs[k]!.template}`);
      } else if (new Set(vs.map((v) => v.template)).size < 2) {
        f.push('spawn `weighted`: every occurrence picks the same template, so nothing varies');
      }
    }

    // Seeked cold: a second run whose every segment is a seek, in another seeded order.
    const cold = windows.map((w) => ({ w, k: r() })).sort((p, q) => p.k - q.k).map(({ w: [from, to] }) => ({ from, to }));
    expect(cold[0]!.from > 0, 'the cold run starts with a seek').toBe(true);
    const c = mix(show(), evidence, doc, cold, 'the same spawns, seeked cold');
    for (const s of c.segments) {
      if (s.sha256 !== heard.get(s.from)) f.push(`the cold seek to ${sOf(s.from)} renders other samples than playing, by hash`);
    }
    const a = picks(m.voices);
    const b = picks(c.voices);
    const diff = a.findIndex((x, i) => x !== b[i]);
    if (a.length !== b.length || diff >= 0) f.push(`seeked cold, the spawns pick otherwise than played: played "${a[diff] ?? '(none)'}", seeked "${b[diff] ?? '(none)'}" (${a.length} and ${b.length} voices)`);

    expect(f, 'the picks are the same played or seeked, and no_repeat never repeats').toEqual([]);
  }, TIMEOUT);
});
