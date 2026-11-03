// AC1: the same scene renders in every shipped look with no change to its description, checked by a fixture
// per look. AC3: each shipped look keeps every data role at least its status distance from every status
// color; wherever status can show, a look whose accent role sits 0.02 OKLab from the fail color is refused,
// naming the role and the status color; an art film played on its own keeps that palette unchanged.
//
// `deep-canvas-render look` lists the shipped looks and answers each one's definition and resolved roles;
// `raster` draws fixtures/scene.json in each, light and dark, from the very same document bytes; `check`
// and `raster` judge the status distance where the document binds status and draw the palette as given
// where it doesn't. At the base only `clean` ships, `look` has no `list`, a text in the `math` font role is
// refused and the guard refuses a look near a status color whatever the document.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FIRST_LOOKS, RENDER_BIN, THEMES, accepted, arr, batch, check, clone, colorAtDistance, deltaE, distance, distanceClash, errorsOf, fixture,
  fontFileOf, glyphsOf, issuesOf, isObject, medianLab, obj, oklabOf, over, pixel, pixelsDiffering, rasterAll, rasterInput, scratch,
  sha256, shippedIds, shippedLook, shown, statusOf, str, useBinaries, withRoleColor, type JsonObject, type Rgb, type Rgba, type Theme,
} from './helpers.ts';

useBinaries('deep-canvas-render');
const dir = scratch('looks');
const HERE = join(import.meta.dirname, 'fixtures', 'looks');

/** The verdict a status-showing copy of the scene binds, pinned to fail. */
const GATE = 'verdict:01JB4170000000000000000001';
/** The scene with a status mark bound to a verdict: a document where status can show (The status-color rule). */
function withStatus(doc: JsonObject): JsonObject {
  const out = clone(doc);
  obj(out['items'], 'items')['gate'] = {
    id: 'gate', kind: 'rect@1', layer: 'main', name: 'Status of the release', order: 'a9',
    params: { box: [16, 40, 96, 24] },
  };
  out['status_bindings'] = { 'gate-state': { target: 'items/gate/params/paint/fill', source: GATE } };
  return out;
}
const STATES: JsonObject = { [GATE]: 'fail' };

/** Every color role of a theme that is data: each but the ground, a role at an alpha taken over the ground. */
function dataColors(roles: Record<string, Rgba>): Record<string, Rgb> {
  const ground = roles['ground'];
  const out: Record<string, Rgb> = {};
  for (const [role, c] of Object.entries(roles)) {
    if (role === 'ground') continue;
    out[role] = c[3] === 255 || !ground ? [c[0], c[1], c[2]] : over(c, ground);
  }
  return out;
}
/** Every data role nearer a status color than the distance, named with the color it clashes with. */
function clashes(colors: Record<string, Rgb>, status: Record<string, Rgb>, min: number): string[] {
  const out: string[] = [];
  for (const [role, c] of Object.entries(colors)) {
    for (const [state, s] of Object.entries(status)) {
      const d = distance(c, s);
      if (d < min) out.push(`${role} is ${d.toFixed(4)} from ${state}`);
    }
  }
  return out;
}

describe('#417 AC1 the same scene renders in every shipped look with no change to its description, checked by a fixture per look', () => {
  it('AC1 the four first looks ship, and every shipped look has its fixture naming the scene and the film', () => {
    const ids = shippedIds();
    for (const id of FIRST_LOOKS) expect(ids, `the shipped looks include ${id}`).toContain(id);
    expect(new Set(ids).size, 'each look is listed once').toBe(ids.length);
    for (const id of ids) {
      expect(existsSync(join(HERE, `${id}.json`)), `the look ${id} has its fixture fixtures/looks/${id}.json`).toBe(true);
      const f = fixture(`looks/${id}.json`);
      expect([f['look'], f['scene'], f['film']], `fixtures/looks/${id}.json names its look, the scene and the film`).toEqual([id, 'scene.json', 'film.json']);
    }
    for (const name of readdirSync(HERE)) expect(ids, `fixtures/looks/${name} is a shipped look's`).toContain(name.replace(/\.json$/, ''));
  });

  it('AC1 each shipped look draws the one scene, light and dark: its own ground, its body and math faces, and a picture of its own, from the same document bytes', () => {
    const ids = shippedIds();
    const scene = fixture('scene.json');
    const bytes = JSON.stringify(scene);
    const before = sha256(bytes);
    const inputs: JsonObject[] = [];
    const what: string[] = [];
    for (const id of ids) {
      const f = fixture(`looks/${id}.json`);
      for (const theme of arr(f['themes'], `looks/${id}.json: themes`).map((t) => str(t, 'theme'))) {
        inputs.push(rasterInput(dir, JSON.parse(bytes) as JsonObject, id, { view: { theme } }));
        what.push(`${id} ${theme}`);
      }
    }
    const checks = batch(RENDER_BIN, ['check'], ids.map((id) => ({ doc: JSON.parse(bytes) as JsonObject, look: id })));
    checks.forEach((c, i) => {
      const out = obj(c, `check in ${ids[i]}`);
      expect(errorsOf(issuesOf(out, `check in ${ids[i]}`)).map((e) => `${e.code} ${e.ids.join(',')} ${e.path}`), `the scene passes the check in ${ids[i]}`).toEqual([]);
      expect(out['ok'], `the scene passes the check in ${ids[i]}`).toBe(true);
    });
    const drawn = rasterAll(inputs, what);
    expect(sha256(JSON.stringify(scene)), 'the scene document is the same bytes after every look drew it').toBe(before);
    for (const input of inputs) expect(sha256(JSON.stringify(input['doc'])), 'each look was handed the same document').toBe(before);

    const lightOf = new Map<string, (typeof drawn)[number]>();
    drawn.forEach((d, i) => {
      const [id, theme] = what[i]!.split(' ') as [string, Theme];
      const look = shippedLook(id);
      const ground = look.roles[theme]['ground'];
      expect(ground, `${id} has a ground role in ${theme}`).toBeDefined();
      const median = medianLab(d.image);
      expect(deltaE(median, oklabOf(ground!)), `${id} ${theme}: most of the frame is the look's ground ${shown(ground)} (median OKLab ${median.map((v) => v.toFixed(3)).join(', ')})`).toBeLessThan(0.05);
      for (const [item, role] of [['title', 'body'], ['theta', 'math']] as const) {
        const want = fontFileOf(look, role, theme).file;
        const glyphs = glyphsOf(d.report, item);
        expect(glyphs.length, `${id} ${theme}: ${item} draws glyphs`).toBeGreaterThan(0);
        for (const g of glyphs) {
          expect(g.font.split('/').at(-1), `${id} ${theme}: ${item} is set in the look's ${role} face ${want}`).toBe(want);
          expect(g.id, `${id} ${theme}: ${item}'s glyph is a real glyph, not .notdef`).not.toBe(0);
        }
      }
      if (theme === 'light') lightOf.set(id, d);
    });
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const n = pixelsDiffering(lightOf.get(ids[i]!)!.image, lightOf.get(ids[j]!)!.image);
        expect(n, `the scene in ${ids[i]} and in ${ids[j]} are pictures of their own (${n} pixels differ)`).toBeGreaterThanOrEqual(100);
      }
    }
  }, 900_000);
});

describe('#417 AC3 each shipped look keeps every data role at least its status distance from every status color; a look whose accent sits 0.02 OKLab from fail is refused where status can show, naming the role and the status color; an art film on its own keeps that palette unchanged', () => {
  it('AC3 every shipped look, in both themes, keeps each data role at least its status distance from each status color', () => {
    for (const id of shippedIds()) {
      const look = shippedLook(id);
      const { colors, min } = statusOf(look.def, id);
      expect(min, `${id}: its status distance is at least the default 0.10`).toBeGreaterThanOrEqual(0.1);
      for (const theme of THEMES) {
        const data = dataColors(look.roles[theme]);
        expect(Object.keys(data).length, `${id} ${theme}: the look has data roles`).toBeGreaterThan(0);
        expect(clashes(data, colors, min), `${id} ${theme}: no data role within ${min} of a status color`).toEqual([]);
      }
    }
    // The oracle sees a clash: the fail color itself as a role is 0 from fail.
    const clean = shippedLook('clean');
    const { colors, min } = statusOf(clean.def, 'clean');
    expect(clashes({ accent: colors['fail']! }, colors, min).join('; '), 'a role on the fail color is a clash the check above would name').toMatch(/accent.*fail/);
  });

  it('AC3 where status can show, the clean look with its accent 0.02 OKLab from fail is refused by check and raster, naming accent and fail; the scene played on its own draws that palette unchanged', () => {
    const clean = shippedLook('clean');
    const { colors } = statusOf(clean.def, 'clean');
    const fail = colors['fail']!;
    const others = Object.entries(colors).filter(([s]) => s !== 'fail').map(([, c]) => c);
    const near = colorAtDistance(fail, 0.02, others, 0.06);
    expect(Math.abs(near.at - 0.02), `the planted accent ${shown(near.color)} sits 0.02 OKLab from fail (${near.at.toFixed(5)})`).toBeLessThan(0.0005);
    const look = withRoleColor(clean.def, 'accent', near.color, 'clean-accent-near-fail');
    const scene = fixture('scene.json');

    // Status can show: a check and a draw are refused, naming the role and the state.
    const shows = withStatus(scene);
    const checked = check(shows, look, { states: STATES });
    expect(checked['ok'], `the status-showing scene in the planted look is refused: ${shown(checked)}`).toBe(false);
    expect(distanceClash(checked), `the refusal names accent and fail: ${shown(checked)}`).toEqual({ role: 'accent', state: 'fail' });
    const [drawn] = batch(RENDER_BIN, ['raster'], [rasterInput(dir, shows, look, { states: STATES })]);
    const refused = obj(drawn, 'raster of the status-showing scene');
    expect(refused['ok'], `raster refuses the status-showing scene in the planted look: ${shown(refused)}`).toBe(false);
    expect(distanceClash(refused), `raster's refusal names accent and fail: ${shown(refused)}`).toEqual({ role: 'accent', state: 'fail' });

    // On its own (no status binding, a figure played alone): accepted, and the accent drawn as given.
    const alone = clone(scene);
    expect(isObject(alone['status_bindings']), 'the art film binds no status').toBe(false);
    const fine = check(alone, look);
    expect(errorsOf(issuesOf(fine, 'check alone')).map((e) => `${e.code} ${e.ids.join(',')}`), 'the scene on its own passes in the planted look').toEqual([]);
    const [light, dark] = rasterAll(
      [rasterInput(dir, alone, look, { view: { theme: 'light' } }), rasterInput(dir, alone, look, { view: { theme: 'dark' } })],
      ['alone light', 'alone dark'],
    );
    for (const [d, theme] of [[light!, 'light'], [dark!, 'dark']] as const) {
      expect(pixel(d.image, 380, 180), `${theme}: the bar draws the planted accent exactly, unchanged`).toEqual(near.color);
    }
    accepted(fine, 'check of the scene on its own');
  }, 600_000);
});
