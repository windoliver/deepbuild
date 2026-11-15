// AC15 #162.eabe9bb9: "A loading button at 60 fps with section markers shrink at 0.85 s, wait at 1.15 s and done at
// 2.25 s, ending at 2.8 s, exports three markers: shrink at frame 51 lasting 18 frames, wait at 69 lasting 66 and done
// at 135 lasting 33; imported back, they are the same three markers at the same flicks; and a planted writer that drops
// the markers fails, naming wait"
//
// The button: 240 × 80 at 60 fps for 2.8 s (168 frames), its width keyed so it shrinks after 0.85 s and grows back after
// 2.25 s, with three section markers of span 0 whose IDs are their names. Lottie's markers are `{cm, tm, dr}`: the name,
// the time and the span in frames. Imported back (the import job, on a real hub), the document's markers are matched by
// name and their `t` read as flicks: 599,760,000, 811,440,000 and 1,587,600,000.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, FLICKS, TIMEOUT, channel, exportedOf, failsNaming, film, importLottie, importWorld, isObject, item, lottieExport, none, readLottie, showRun,
  useShow, useTemp, type JsonObject, type JsonValue, type Planted,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const RATE: [number, number] = [60, 1];
const EXPECTED = [
  { name: 'shrink', tm: 51, dr: 18, t: 599_760_000 },
  { name: 'wait', tm: 69, dr: 66, t: 811_440_000 },
  { name: 'done', tm: 135, dr: 33, t: 1_587_600_000 },
];

function buttonDoc(evidence: string): JsonObject {
  return film(evidence, {
    id: 'button', size: [240, 80], rate: RATE, frames: 168,
    items: [item('button', 'rect@1', 'Button', 'a02', { box: [20, 20, 200, 40], paint: { fill: { role: 'accent' } } })],
    channels: { width: channel('items/button/params/box/2', [[0, 200], [0.85, 200], [1.15, 40], [2.25, 40], [2.8, 200]]) },
    markers: Object.fromEntries(EXPECTED.map((m) => [m.name, { kind: 'section', t: `${m.t / FLICKS}s`, name: m.name }])),
  });
}
/** The judge: the file's markers, one per expected name, at its frame and for its span (each failure names its marker). */
function judgeMarkers(anim: JsonObject): string[] {
  const markers = (Array.isArray(anim['markers']) ? anim['markers'] : []).filter(isObject) as JsonObject[];
  return EXPECTED.flatMap((m) => {
    const found = markers.filter((x) => x['cm'] === m.name);
    if (found.length !== 1) return [`${m.name}: ${found.length} markers named ${m.name}, not one (markers: ${JSON.stringify(markers)})`];
    const x = found[0]!;
    return x['tm'] === m.tm && x['dr'] === m.dr ? [] : [`${m.name}: at frame ${String(x['tm'])} lasting ${String(x['dr'])}, not at ${m.tm} lasting ${m.dr}`];
  });
}
/** A time as flicks: a whole number, or a literal in s, ms or frames at the document's rate. */
function flicksOf(t: JsonValue | undefined, rate: [number, number]): number | null {
  if (typeof t === 'number' && Number.isInteger(t)) return t;
  if (typeof t !== 'string') return null;
  const m = /^(-?\d+(?:\.\d+)?)(s|ms|f)$/.exec(t.trim());
  if (!m) return null;
  const v = Number(m[1]);
  const f = m[2] === 's' ? v * FLICKS : m[2] === 'ms' ? (v * FLICKS) / 1000 : (v * FLICKS * rate[1]) / rate[0];
  return Math.abs(f - Math.round(f)) < 1e-6 ? Math.round(f) : null;
}
function exportButton(planted?: Planted): { out: string; bytes: Buffer } {
  const evidence = temp(); const dir = temp(); const out = join(dir, 'button.json');
  const [reply] = showRun(shows.bin(FULL), evidence, [buttonDoc(evidence)], [lottieExport(0, out)], 'the loading button', planted);
  exportedOf(reply!, planted ? `the loading button (planted ${planted})` : 'the loading button');
  return { out, bytes: readFileSync(out) };
}

describe(`${AC[15]} section markers export as Lottie markers with their spans and import back at the same flicks`, () => {
  it(`${AC[15]} shrink at frame 51 lasting 18, wait at 69 lasting 66, done at 135 lasting 33; imported back, the same three at the same flicks`, async () => {
    const { out, bytes } = exportButton();
    none(judgeMarkers(readLottie(out, 'the loading button')), 'the loading button\'s markers');
    const iw = await importWorld();
    const { document } = await importLottie(iw, bytes, 'button.json');
    const markers = isObject(document['markers']) ? (document['markers'] as JsonObject) : {};
    const rate = (isObject(document['transport']) && Array.isArray(document['transport']['frame_rate']) ? document['transport']['frame_rate'] : [60, 1]) as [number, number];
    const named = Object.values(markers).filter(isObject) as JsonObject[];
    expect(named.length, `the imported document holds three markers: ${JSON.stringify(markers).slice(0, 800)}`).toBe(3);
    none(EXPECTED.flatMap((m) => {
      const found = named.filter((x) => x['name'] === m.name);
      if (found.length !== 1) return [`${m.name}: ${found.length} imported markers of that name`];
      const t = flicksOf(found[0]!['t'], rate);
      return t === m.t ? [] : [`${m.name}: imported at ${JSON.stringify(found[0]!['t'])} (${String(t)} flicks), not ${m.t}`];
    }), 'the imported markers are the same three at the same flicks');
  }, TIMEOUT);

  it(`${AC[15]} a planted writer that drops the markers fails, naming wait`, () => {
    const { out } = exportButton('lottie_writer_drops_markers');
    failsNaming(judgeMarkers(readLottie(out, 'the loading button (planted lottie_writer_drops_markers)')), /^wait:/, 'the writer that drops the markers');
  }, TIMEOUT);
});
