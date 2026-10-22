import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DEFICIENCIES, STATES, arr, box, clean, contrast, deltaEOk, drawn, fixture, glyphs, gpu, inside, mode, obj, pixel, pixelsIn,
  readPng, rgb, ring, same, sharedGlyphLook, simulate, str, useRenderBinary, type Box, type Image, type JsonObject, type Rgb, type State,
} from './helpers.ts';

useRenderBinary();

const scratch = mkdtempSync(join(tmpdir(), 'deep-392-status-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const LINE = fixture('ask-line.json');
/** Each status binding of the ask line, its record handle and the state the run gives that handle. */
const BINDINGS = Object.entries(obj(LINE['status_bindings'], 'status_bindings')).map(([id, b]) => {
  const binding = obj(b, `status_bindings.${id}`);
  const state = id.slice(2) as State;
  return { id, item: String(binding['target']).split('/')[1]!, source: String(binding['source']), state };
});
const STATE_OF: JsonObject = Object.fromEntries(BINDINGS.map((b) => [b.source, b.state]));

type Theme = 'light' | 'dark';
interface Mark { item: string; binding: string; state: State; color: Rgb; bounds: Box; glyph: string | null; word: string | null; label: Box }
interface Entry { state: State; glyph: string; word: string; color: Rgb; swatch: Box }
interface Shot { image: Image; marks: Mark[]; legend: Entry[] }

const shots = new Map<string, Shot>();
/** The ask line drawn in `theme` through `look`, with its text snapshot: its status marks and its legend. */
function shoot(name: string, look: JsonObject | string, theme: Theme): Shot {
  const key = `${name}-${theme}`;
  const cached = shots.get(key);
  if (cached) return cached;
  const out = join(scratch, `${key}.png`);
  const report = drawn('render', { out, doc: LINE, look, view: { zoom: 1, theme }, states: STATE_OF });
  expect([report['width'], report['height']], 'the render reports the document\'s size at scale 1').toEqual([640, 376]);
  const image = readPng(out);
  const marks = arr(report['marks'], 'render: marks').map((v, i): Mark => {
    const m = obj(v, `marks[${i}]`);
    const named = (k: string): string | null => (m[k] === undefined || m[k] === null ? null : str(m[k], `marks[${i}].${k}`));
    return {
      item: str(m['item'], `marks[${i}].item`), binding: str(m['binding'], `marks[${i}].binding`), state: str(m['state'], `marks[${i}].state`) as State,
      color: rgb(m['color'], `marks[${i}].color`), bounds: box(m['bounds'], `marks[${i}].bounds`), glyph: named('glyph'), word: named('word'),
      label: box(m['label'], `marks[${i}].label`),
    };
  });
  const legend = arr(report['legend'], 'render: legend').map((v, i): Entry => {
    const e = obj(v, `legend[${i}]`);
    return {
      state: str(e['state'], `legend[${i}].state`) as State, glyph: str(e['glyph'], `legend[${i}].glyph`), word: str(e['word'], `legend[${i}].word`),
      color: rgb(e['color'], `legend[${i}].color`), swatch: box(e['swatch'], `legend[${i}].swatch`),
    };
  });
  const shot = { image, marks, legend };
  shots.set(key, shot);
  return shot;
}

/** Every binding of the fixture is one mark in the snapshot, with the state its source has. */
function coverage(shot: Shot): string[] {
  const failures: string[] = [];
  for (const b of BINDINGS) {
    const found = shot.marks.filter((m) => m.binding === b.id);
    if (found.length !== 1) { failures.push(`status binding ${b.id}: ${found.length} marks in the snapshot, not 1`); continue; }
    const m = found[0]!;
    if (m.item !== b.item || m.state !== b.state) failures.push(`status binding ${b.id}: mark ${m.item} in state ${m.state}, not ${b.item} in ${b.state}`);
  }
  return failures;
}

/** The glyph or word the snapshot names for a mark, checked against the look's glyph for its state. */
function naming(m: Mark, look: Record<State, string>): string | null {
  if (m.glyph === null && (m.word === null || m.word === '')) return `mark ${m.item} (${m.state}) names no glyph and no word`;
  if (m.glyph !== null && m.glyph !== look[m.state]) return `mark ${m.item} (${m.state}) names glyph ${JSON.stringify(m.glyph)}, not the look's ${JSON.stringify(look[m.state])}`;
  return null;
}

interface Measured { fill: Rgb; background: Rgb; behind: Rgb; ink: Rgb; inkPixels: [number, number][]; failures: string[] }

/**
 * What a status mark's pixels show: its fill (the most common color inside it, its label left out), what is
 * behind it (the most common color 2–4 px outside it), and its glyph or word: the label pixel with the most
 * contrast against what is behind the label (the mark's fill when the label sits inside the mark, else the
 * color around the label). A mark whose label is not drawn has no pixel unlike what is behind it.
 */
function measure(image: Image, m: Mark): Measured {
  const failures: string[] = [];
  const fillPixels = pixelsIn(image, m.bounds, 1).filter(([x, y]) => !inside(m.label, x, y, 1));
  const fill = mode(image, fillPixels.length > 0 ? fillPixels : pixelsIn(image, m.bounds));
  const background = mode(image, ring(image, m.bounds, 2, 4));
  const within = m.label[0] >= m.bounds[0] - 0.5 && m.label[1] >= m.bounds[1] - 0.5
    && m.label[0] + m.label[2] <= m.bounds[0] + m.bounds[2] + 0.5 && m.label[1] + m.label[3] <= m.bounds[1] + m.bounds[3] + 0.5;
  const apart = m.label[0] >= m.bounds[0] + m.bounds[2] || m.label[0] + m.label[2] <= m.bounds[0]
    || m.label[1] >= m.bounds[1] + m.bounds[3] || m.label[1] + m.label[3] <= m.bounds[1];
  if (!within && !apart) failures.push(`mark ${m.item}: its label ${JSON.stringify(m.label)} straddles the mark's edge ${JSON.stringify(m.bounds)}`);
  const behind = within ? fill : mode(image, ring(image, m.label, 1, 2));
  const candidates = pixelsIn(image, m.label).filter(([x, y]) => (within ? inside(m.bounds, x, y, -1) : !inside(m.bounds, x, y, 1)));
  let ink = behind; let best = 1;
  for (const [x, y] of candidates) {
    const c = pixel(image, x, y);
    const r = contrast(c, behind);
    if (r > best) { best = r; ink = c; }
  }
  const inkPixels = candidates.filter(([x, y]) => contrast(pixel(image, x, y), behind) >= 1.5)
    .map(([x, y]): [number, number] => [x - Math.round(m.label[0]), y - Math.round(m.label[1])]);
  return { fill, background, behind, ink, inkPixels, failures };
}

/** The criterion's contrast check of every status mark in one shot, as failures naming the mark. */
function contrastFailures(shot: Shot, theme: Theme): string[] {
  const failures = coverage(shot);
  for (const m of shot.marks) {
    const p = measure(shot.image, m);
    failures.push(...p.failures);
    // Status colors draw exact: the pixels inside the mark are the color the snapshot names.
    if (!same(p.fill, m.color)) failures.push(`${theme}: mark ${m.item} (${m.state}) draws ${JSON.stringify(p.fill)}, not its status color ${JSON.stringify(m.color)}`);
    const markRatio = contrast(p.fill, p.background);
    if (markRatio < 3) failures.push(`${theme}: mark ${m.item} (${m.state}) ${JSON.stringify(p.fill)} on ${JSON.stringify(p.background)} is ${markRatio.toFixed(2)}:1, under 3:1`);
    const labelRatio = contrast(p.ink, p.behind);
    if (labelRatio < 4.5) failures.push(`${theme}: the glyph or word of mark ${m.item} (${m.state}) ${JSON.stringify(p.ink)} on ${JSON.stringify(p.behind)} is ${labelRatio.toFixed(2)}:1, under 4.5:1`);
  }
  return failures;
}

/** The legend: one entry per state on screen, with the look's glyph, a word and the color its marks draw, its swatch drawn in that color. */
function legendFailures(shot: Shot, look: Record<State, string>, what: string): string[] {
  const failures: string[] = [];
  const onScreen = new Map<State, Rgb>();
  for (const m of shot.marks) onScreen.set(m.state, m.color);
  if (onScreen.size === 0) failures.push(`${what}: no status mark on screen`);
  for (const [state, color] of onScreen) {
    const entries = shot.legend.filter((e) => e.state === state);
    if (entries.length !== 1) { failures.push(`${what}: the legend has ${entries.length} entries for ${state}, not 1`); continue; }
    const e = entries[0]!;
    if (e.glyph !== look[state]) failures.push(`${what}: the legend shows glyph ${JSON.stringify(e.glyph)} for ${state}, not the look's ${JSON.stringify(look[state])}`);
    if (e.word === '') failures.push(`${what}: the legend shows no word for ${state}`);
    if (!same(e.color, color)) failures.push(`${what}: the legend shows ${JSON.stringify(e.color)} for ${state}, but its marks draw ${JSON.stringify(color)}`);
    const swatch = mode(shot.image, pixelsIn(shot.image, e.swatch, 1).length > 0 ? pixelsIn(shot.image, e.swatch, 1) : pixelsIn(shot.image, e.swatch));
    if (!same(swatch, e.color)) failures.push(`${what}: the legend's swatch for ${state} draws ${JSON.stringify(swatch)}, not ${JSON.stringify(e.color)}`);
  }
  return failures;
}

describe('AC2 status marks: glyphs or words under simulated color-vision deficiency, the status guard, and contrast in both themes', () => {
  it('AC2 in the light and dark themes every status mark keeps 3:1 contrast with its background, and its glyph or word 4.5:1', () => {
    const failures = (['light', 'dark'] as Theme[]).flatMap((theme) => contrastFailures(shoot('clean', 'clean', theme), theme));
    // A look whose idle grey sits on its ground, or whose glyph is drawn in the mark's own color, fails here;
    // so does a render that draws the status color off by a code or draws no glyph at all.
    expect(failures, `${failures.length} contrast failures in the clean look`).toEqual([]);
  }, 900_000);

  it('AC2 rendered under simulated protanopia, deuteranopia and tritanopia, the ask line\'s text snapshot names a glyph or word for every status mark', () => {
    const look = glyphs(clean());
    const failures: string[] = [];
    for (const theme of ['light', 'dark'] as Theme[]) {
      const shot = shoot('clean', 'clean', theme);
      failures.push(...coverage(shot));
      const measured = new Map(shot.marks.map((m) => [m.item, measure(shot.image, m)]));
      for (const deficiency of DEFICIENCIES) {
        for (const m of shot.marks) {
          const n = naming(m, look);
          if (n !== null) failures.push(`${theme}, ${deficiency}: ${n}`);
        }
        // Where the simulation (computed here from the drawn pixels) leaves two states' colors closer than
        // the look's 0.10 OKLab, only the glyph or word tells them apart: the snapshot names different ones
        // and the pixels draw different shapes.
        for (let i = 0; i < shot.marks.length; i++) {
          for (let j = i + 1; j < shot.marks.length; j++) {
            const a = shot.marks[i]!; const b = shot.marks[j]!;
            if (a.state === b.state) continue;
            const pa = measured.get(a.item)!; const pb = measured.get(b.item)!;
            if (deltaEOk(simulate(pa.fill, deficiency), simulate(pb.fill, deficiency)) >= 0.1) continue;
            if ((a.glyph ?? a.word) === (b.glyph ?? b.word)) failures.push(`${theme}, ${deficiency}: ${a.state} and ${b.state} look alike and name the same ${JSON.stringify(a.glyph ?? a.word)}`);
            const shape = (p: Measured): string => p.inkPixels.map(([x, y]) => `${x},${y}`).sort().join(' ');
            if (shape(pa) === shape(pb)) failures.push(`${theme}, ${deficiency}: ${a.state} and ${b.state} look alike and their labels draw the same pixels`);
          }
        }
      }
    }
    // A line that shows status by color alone, or names a glyph the look doesn't give that state, fails here.
    expect(failures, `${failures.length} status marks not named by glyph or word`).toEqual([]);
  }, 900_000);

  it('AC2 drawn with a planted look that gives pass and fail one glyph, the ask line fails the status guard, naming the pair', () => {
    const out = gpu('render', { out: join(scratch, 'planted.png'), doc: LINE, look: sharedGlyphLook('pass', 'fail'), view: { zoom: 1, theme: 'light' }, states: STATE_OF });
    expect(out['ok'], `the planted look is refused, not drawn: ${JSON.stringify(out).slice(0, 600)}`).toBe(false);
    expect(out['code'], 'by the status guard').toBe('status_glyph_shared');
    expect(Array.isArray(out['pair']) ? (out['pair'] as string[]).slice().sort() : out['pair'], 'naming the pair').toEqual(['fail', 'pass']);
  }, 900_000);
});

describe('AC1 a look that recolors status shows a legend', () => {
  it('AC1 the clean look\'s legend shows every state on screen with its glyph, color and word, in both themes', () => {
    const look = glyphs(clean());
    const failures = (['light', 'dark'] as Theme[]).flatMap((theme) => legendFailures(shoot('clean', 'clean', theme), look, `clean, ${theme}`));
    expect(failures, `${failures.length} legend failures`).toEqual([]);
  }, 900_000);

  it('AC1 a look that swaps the pass and running colors draws them swapped and its legend shows the new colors', () => {
    const base = shoot('clean', 'clean', 'light');
    const colorOf = (shot: Shot, state: State): Rgb => shot.marks.find((m) => m.state === state)?.color ?? [-1, -1, -1];
    const pass = colorOf(base, 'pass'); const running = colorOf(base, 'running');
    expect(same(pass, running), `the clean look gives pass and running different colors: ${JSON.stringify([pass, running])}`).toBe(false);
    const recolored = clean();
    const status = obj(recolored['status'], 'look.status');
    [status['pass'], status['running']] = [status['running']!, status['pass']!];
    const shot = shoot('swapped', recolored, 'light');
    expect([colorOf(shot, 'pass'), colorOf(shot, 'running')], 'the recolored look draws pass in running\'s color and running in pass\'s').toEqual([running, pass]);
    // A legend fixed to the default map, or none at all, fails here.
    const failures = legendFailures(shot, glyphs(recolored), 'recolored, light');
    expect(failures, `${failures.length} legend failures`).toEqual([]);
    expect(shot.legend.find((e) => e.state === 'pass')?.color, 'the legend shows pass in its new color').toEqual(running);
    for (const s of STATES) expect(shot.marks.some((m) => m.state === s), `the recolored line still shows ${s}`).toBe(true);
  }, 900_000);
});
