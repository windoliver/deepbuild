// Criterion 3 (#140.8f5be3c4): the same document shapes to identical glyph runs in the app and headless, and no
// system font library is reachable from the canvas, checked from the dependency tree of the canvas's text and
// marks crates, which never depend on gpui.
//
// The app's side is `deep-canvas-render render`, the app's GPUI frame path (#391), at zoom 1 and at zoom 2 (the
// reference Mac's backing scale), which this suite gives #381's `texts`; the headless side is `raster`, the
// Vello CPU render-back draws with (#373, #381). Each runs in its own process. The tree half reads `cargo tree`
// for each crate, as a build of that crate alone resolves it, for every target; its twins (a throwaway
// workspace whose members each add one forbidden library) are its wrong programs.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  FIGURE, FILM, FLICKS, LOCALE_DOC, LOOK_2D, REPO, RENDER, answers, arr, isObject, obj, ok, str, useBuilds, useDir,
  type JsonObject, type JsonValue,
} from './helpers.ts';

const builds = useBuilds([RENDER]);
const dir = useDir();

const READING = 'reading:01JB1400000000000000000001';
const DOCS: { name: string; doc: () => JsonObject; t: number; readings?: JsonObject }[] = [
  { name: 'figure', doc: FIGURE, t: 0 },
  { name: 'film at 1.25 s', doc: FILM, t: Math.round(1.25 * FLICKS) },
  { name: 'locale figure', doc: LOCALE_DOC, t: 0, readings: { [READING]: 1234.5 } },
];

/** Each text item's shown string and glyphs (#381's `texts`), by item ID. */
function textsOf(answer: JsonObject, what: string): Map<string, { shown: string; glyphs: JsonValue[] }> {
  const t = obj(ok(answer, what)['texts'], `${what}: texts`);
  return new Map(Object.entries(t).map(([id, v]) => {
    const e = obj(v, `${what}: texts.${id}`);
    return [id, { shown: str(e['shown'], `${what}: texts.${id}.shown`), glyphs: arr(e['glyphs'], `${what}: texts.${id}.glyphs`) }];
  }));
}

describe('#140.8f5be3c4 (C3) fonts: identical glyph runs in the app and headless; no system font library reachable from the canvas', () => {
  it('#140.8f5be3c4 (C3) each fixture document shapes to the same glyph runs, glyph for glyph, in the app\'s GPUI frame (zoom 1 and 2) as in the headless Vello CPU raster', () => {
    const bin = builds.bin(RENDER);
    const problems: string[] = [];
    for (const d of DOCS) {
      const doc = d.doc();
      const textItems = Object.entries(obj(doc['items'], 'items')).filter(([, v]) => isObject(v) && v['kind'] === 'text@1').map(([id]) => id);
      const line = (zoom: number, n: string): JsonObject => ({
        out: join(dir(), `${n}.png`), doc, look: LOOK_2D(), view: { zoom, theme: 'light' }, t: d.t, ...(d.readings ? { readings: d.readings } : {}),
      });
      // Each side in its own process.
      const [headless] = answers(bin, ['raster'], [line(1, 'raster')]);
      const [app1] = answers(bin, ['render'], [line(1, 'app1')]);
      const [app2] = answers(bin, ['render'], [line(2, 'app2')]);
      const base = textsOf(headless!, `${d.name}: raster (headless)`);
      for (const id of textItems) {
        const run = base.get(id);
        if (!run) { problems.push(`${d.name}: the headless raster reports no glyph run for ${id}`); continue; }
        if (run.shown === '' || run.glyphs.length === 0) problems.push(`${d.name}: ${id}'s headless run is empty (shown ${JSON.stringify(run.shown)}, ${run.glyphs.length} glyphs)`);
      }
      for (const [side, answer] of [['the app at zoom 1', app1!], ['the app at zoom 2', app2!]] as const) {
        const app = textsOf(answer, `${d.name}: render (${side})`);
        for (const id of textItems) {
          const a = app.get(id); const h = base.get(id);
          if (!a) { problems.push(`${d.name}: ${side} reports no glyph run for ${id}`); continue; }
          if (!h) continue;
          if (a.shown !== h.shown) problems.push(`${d.name}: ${id} shows ${JSON.stringify(a.shown)} in ${side} and ${JSON.stringify(h.shown)} headless`);
          if (a.glyphs.length !== h.glyphs.length) { problems.push(`${d.name}: ${id} has ${a.glyphs.length} glyphs in ${side} and ${h.glyphs.length} headless`); continue; }
          const k = a.glyphs.findIndex((g, i) => JSON.stringify(g) !== JSON.stringify(h.glyphs[i]));
          if (k >= 0) problems.push(`${d.name}: ${id}'s glyph ${k} is ${JSON.stringify(a.glyphs[k])} in ${side} and ${JSON.stringify(h.glyphs[k])} headless`);
        }
      }
    }
    expect(problems, 'glyph runs, app against headless').toEqual([]);
  }, 1_800_000);
});

// ---------------------------------------------------------------------------------------------------
// The dependency-tree half

/** The canvas's text and marks crates: they shape and draw the canvas's text and marks, and never depend on gpui. */
const TEXT_AND_MARKS = ['deep-text', 'deep-canvas-marks', 'deep-marks-vello', 'deep-canvas-scene3d', 'deep-scene3d-render'];
/** Libraries that find, load or rasterize the system's fonts, on any platform. */
const SYSTEM_FONT_LIBS = [
  'core-text', 'objc2-core-text', 'font-kit', 'fontdb', 'fontconfig', 'fontconfig-sys', 'yeslogic-fontconfig-sys', 'servo-fontconfig',
  'servo-fontconfig-sys', 'fontconfig-cache-parser', 'fontconfig-parser', 'dwrote', 'freetype', 'freetype-sys', 'freetype-rs', 'font-loader',
];
/** Features that reach the system's fonts through a crate that is otherwise allowed (parley's system feature among them). */
const SYSTEM_FONT_FEATURES: [string, string][] = [
  ['parley', 'system'], ['fontique', 'system'], ['windows', 'Win32_Graphics_DirectWrite'], ['windows-sys', 'Win32_Graphics_DirectWrite'],
  ['objc2-core-graphics', 'CGFont'], ['objc2-app-kit', 'NSFont'],
];

interface Pkg { versions: Set<string>; features: Set<string> }
function cargoTree(crate: string, cwd: string, locked: boolean): Map<string, Pkg> {
  const args = ['tree', locked ? '--locked' : '--offline', '-p', crate, '-e', 'normal', '--target', 'all', '--prefix', 'none', '-f', '{p}|{f}'];
  const run = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (run.error) throw Error(`cargo ${args.join(' ')}: ${run.error.message}`);
  expect(run.status, `cargo ${args.join(' ')} in ${cwd}: ${run.stderr.slice(-2000)}`).toBe(0);
  const pkgs = new Map<string, Pkg>();
  for (const raw of run.stdout.split('\n')) {
    const line = raw.replace(/ \(\*\)$/, '').trim();
    if (line === '') continue;
    const bar = line.lastIndexOf('|');
    const [name, version] = line.slice(0, bar).split(' ');
    if (!name || !version) continue;
    const pkg = pkgs.get(name) ?? { versions: new Set<string>(), features: new Set<string>() };
    pkg.versions.add(version);
    for (const f of line.slice(bar + 1).split(',')) if (f !== '') pkg.features.add(f);
    pkgs.set(name, pkg);
  }
  return pkgs;
}
function treeProblems(crate: string, tree: Map<string, Pkg>): string[] {
  const p: string[] = [];
  for (const name of tree.keys()) if (/^gpui/.test(name)) p.push(`${crate} depends on ${name} (gpui)`);
  for (const name of SYSTEM_FONT_LIBS) if (tree.has(name)) p.push(`${crate} reaches ${name}, a system font library`);
  for (const [name, feature] of SYSTEM_FONT_FEATURES) if (tree.get(name)?.features.has(feature)) p.push(`${crate} enables ${name}/${feature}, which reaches the system's fonts`);
  return p;
}

const scratch: string[] = [];
afterAll(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

describe('#140.8f5be3c4 (C3) the canvas\'s text and marks crates never depend on gpui and reach no system font library', () => {
  it(`#140.8f5be3c4 (C3) the dependency tree of each of ${TEXT_AND_MARKS.join(', ')}, for every target, holds no gpui crate, no system font library and no system-font feature`, () => {
    const problems = TEXT_AND_MARKS.flatMap((c) => treeProblems(c, cargoTree(c, REPO, true)));
    expect(problems, 'the text and marks crates\' dependency trees').toEqual([]);
  }, 900_000);

  it('#140.8f5be3c4 (C3) the tree check\'s twins: a member that adds a system font library, a system-font feature or gpui fails, named; the clean member passes', () => {
    const root = mkdtempSync(join(tmpdir(), 'deep-140-tree-'));
    scratch.push(root);
    const crate = (where: string, name: string, extra: string): void => {
      mkdirSync(join(root, where, 'src'), { recursive: true });
      writeFileSync(join(root, where, 'Cargo.toml'), `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n${extra}`);
      writeFileSync(join(root, where, 'src', 'lib.rs'), '');
    };
    const dep = (name: string, features: string[] = []): string => `${name} = { path = "../stubs/${name}"${features.length ? `, features = [${features.map((f) => `"${f}"`).join(', ')}]` : ''} }\n`;
    const twins: { member: string; deps: string; names: RegExp | null }[] = [
      { member: 'twin-clean', deps: '', names: null },
      { member: 'twin-gpui', deps: dep('gpui-kit'), names: /depends on gpui-kit \(gpui\)/ },
      ...['core-text', 'fontconfig', 'dwrote', 'font-kit'].map((n) => ({ member: `twin-${n}`, deps: dep(n), names: new RegExp(`reaches ${n}, a system font library`) })),
      { member: 'twin-parley-system', deps: dep('parley', ['system']), names: /enables parley\/system/ },
    ];
    writeFileSync(join(root, 'Cargo.toml'), `[workspace]\nmembers = [${twins.map((t) => `"${t.member}"`).join(', ')}]\nexclude = ["stubs"]\nresolver = "2"\n`);
    for (const t of twins) crate(t.member, t.member, `\n[dependencies]\n${t.deps}`);
    for (const n of ['gpui-kit', 'core-text', 'fontconfig', 'dwrote', 'font-kit']) crate(`stubs/${n}`, n, '');
    crate('stubs/parley', 'parley', '\n[features]\nsystem = []\n');
    for (const t of twins) {
      const problems = treeProblems(t.member, cargoTree(t.member, root, false));
      if (!t.names) expect(problems, 'the clean twin passes').toEqual([]);
      else expect(problems.join('\n'), `${t.member} fails, naming what it adds`).toMatch(t.names);
    }
  }, 600_000);
});
