// #378.6ab4aece (blind redraft of both tests of figure.test.ts; C1-REDRAFT.md): a skill's figure (an
// isometric machine with labeled parts and motion) renders natively through `deep_show`, with no web view.
// The first draft sent the figure with no `requires`. A document declares the canvas modules its kinds
// need (technical design: Document; canvas primitives: Document envelope, `requires.modules`), and #305's
// check refuses a kind of a module the document doesn't name, so a skill's agent sends the figure with
// `requires: {modules: {scene3d: "^1"}}`. fixtures/machine-figure-requires.json is the first draft's figure
// with that one field added; the first test below checks that it is. Every other assertion is the first
// draft's, unchanged. At the base deep_show refuses the figure: the build lacks the scene3d module.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import {
  DYLD_ENV, REPO, SHOW_BIN, decodePng, fixture, loadedLibraries, requireGpu, showRun, showScreen, str, useBins, useOut, webEngineProblems,
  type Image, type JsonObject, type JsonValue,
} from './helpers.ts';

const bins = useBins([SHOW_BIN]);
const out = useOut();
const FIGURE = fixture('machine-figure-requires.json');
const SIZE = FIGURE['size'] as [number, number];
const DOC_ID = '01JB7F00000000000000000378';
const PARTS = ['base', 'housing', 'piston', 'flywheel', 'crank'];
const LABELS = ['label-piston', 'label-housing', 'label-flywheel'];
const WINDOW: [number, number] = [800, 600];

/** The figure is the first draft's, declaring the canvas module its kinds need and nothing else. */
function sameFigurePlusRequires(): void {
  expect(FIGURE, 'the redraft\'s figure is the first draft\'s with requires.modules naming scene3d, and no other change')
    .toEqual({ ...fixture('machine-figure.json'), requires: { modules: { scene3d: '^1' } } });
}

function scenario(evidence: string, times: string[]): JsonObject {
  return {
    evidence,
    sessions: { 'sess-alpha': { thread: 'thread-alpha', name: 'Claude Code: pump figure', process: { pid: 4100, start: 1_000 } } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }],
    panels: { main: { rect: [0, 0, WINDOW[0], WINDOW[1]] } },
    docs: { [DOC_ID]: { panel: 'main' } },
    window: WINDOW,
    calls: times.map((t) => ({ call: 'deep_show', session: 'sess-alpha', doc: DOC_ID, document: FIGURE, t, size: SIZE, include: ['issues', 'pixels'] })),
  };
}

function presented(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is presented: ${JSON.stringify(reply).slice(0, 1500)}`).toBe('presented');
  const errors = ((reply['issues'] ?? []) as JsonObject[]).filter((i) => i['severity'] === 'error');
  expect(errors, `${what} carries no error issue`).toEqual([]);
}

/** The share of pixels that differ from the image's most common color, within a rect. */
function drawnShare(image: Image, [x, y, w, h]: [number, number, number, number]): { share: number; dark: number } {
  const x0 = Math.max(0, Math.floor(x)); const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(image.width, Math.ceil(x + w)); const y1 = Math.min(image.height, Math.ceil(y + h));
  let dark = 0; let n = 0;
  const ground = mostCommon(image);
  let off = 0;
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
    const o = (yy * image.width + xx) * 4;
    const key = (image.rgba[o]! << 16) | (image.rgba[o + 1]! << 8) | image.rgba[o + 2]!;
    n++;
    if (key !== ground) off++;
    const luma = (0.2126 * image.rgba[o]! + 0.7152 * image.rgba[o + 1]! + 0.0722 * image.rgba[o + 2]!) / 255;
    if (luma < 0.35) dark++;
  }
  return { share: n ? off / n : 0, dark: n ? dark / n : 0 };
}
function mostCommon(image: Image): number {
  const counts = new Map<number, number>();
  for (let i = 0; i < image.rgba.length; i += 4) {
    const key = (image.rgba[i]! << 16) | (image.rgba[i + 1]! << 8) | image.rgba[i + 2]!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}
/** The blank guard's measure (#377): luma at most 0.06 over at least 98% of the pixels. */
function blank(image: Image): boolean {
  let darkPx = 0;
  for (let i = 0; i < image.rgba.length; i += 4) if ((0.2126 * image.rgba[i]! + 0.7152 * image.rgba[i + 1]! + 0.0722 * image.rgba[i + 2]!) / 255 <= 0.06) darkPx++;
  return darkPx / (image.width * image.height) >= 0.98;
}

interface Dep { name: string; kind: string | null }
interface Package { id: string; name: string; source: string | null; dependencies: Dep[]; targets: { name: string; kind: string[] }[] }
interface Node { id: string; deps: { pkg: string; dep_kinds: { kind: string | null }[] }[] }
interface Metadata { packages: Package[]; workspace_members: string[]; resolve: { nodes: Node[] } }
/** Crates that embed a web view or a browser engine. */
const WEB_VIEWS = /^(wry|tauri|tauri-runtime(-.+)?|webkit2gtk(-.+)?|webkit6(-.+)?|javascriptcore-rs(-.+)?|webview2-com(-.+)?|objc2-web-kit|cef|cef-dll-sys|servo|libservo|ultralight(-.+)?|web-view|webview|dioxus-desktop|blitz(-.+)?|cocoa-webkit)$/;
function webViewProblems(meta: Metadata): string[] {
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const members = meta.workspace_members.map((id) => byId.get(id)).filter((p): p is Package => p !== undefined);
  const roots = [members.find((p) => p.targets.some((t) => t.name === SHOW_BIN && t.kind.includes('bin'))), members.find((p) => p.name === 'deep-app')];
  const problems: string[] = [];
  if (roots.some((r) => r === undefined)) problems.push('the workspace lacks the deep-show binary\'s crate or deep-app');
  for (const root of roots.filter((r): r is Package => r !== undefined)) {
    const seen = new Set<string>();
    const walk = (id: string): void => {
      if (seen.has(id)) return;
      seen.add(id);
      for (const d of nodes.get(id)?.deps ?? []) if (d.dep_kinds.some((k) => k.kind === null)) walk(d.pkg);
    };
    walk(root.id);
    for (const id of seen) { const p = byId.get(id); if (p && WEB_VIEWS.test(p.name)) problems.push(`${root.name} depends on the web view ${p.name}`); }
  }
  return problems;
}

describe('#378.6ab4aece a skill\'s figure (an isometric machine with labeled parts and motion) renders natively through deep_show, with no web view (redraft)', () => {
  it('#378.6ab4aece deep_show presents the figure, declaring the scene3d module its kinds need, with no error, and its render-back snapshots are drawn, show the motion and repeat exactly, from a process that loads no web engine (redraft)', async () => {
    sameFigurePlusRequires();
    requireGpu();
    const evidence = out();
    const { replies, stderr } = showRun(bins.bin(SHOW_BIN), scenario(evidence, ['0s', '0.5s', '0s']), DYLD_ENV);
    const store = await openEvidenceStore({ root: evidence });
    const shots: { sha: string; image: Image }[] = [];
    for (const [i, reply] of replies.entries()) {
      presented(reply, `deep_show call ${i + 1}`);
      const snaps = (reply['snapshots'] ?? []) as JsonValue[];
      expect(snaps.length, `deep_show call ${i + 1} returns one snapshot`).toBe(1);
      const snap = snaps[0] as JsonObject;
      expect([snap['w'], snap['h']], 'the snapshot is the figure\'s size').toEqual(SIZE);
      const sha = str(snap['sha256'], 'the snapshot\'s hash');
      const image = decodePng(Buffer.from(await store.read(sha)));
      expect(blank(image), `the snapshot at call ${i + 1} isn't blank (luma ≤ 0.06 over 98% of it)`).toBe(false);
      expect(drawnShare(image, [0, 0, image.width, image.height]).share, `the snapshot at call ${i + 1} draws the figure: at least 5% of it isn't the ground`).toBeGreaterThan(0.05);
      shots.push({ sha, image });
    }
    expect(shots[1]!.sha, 'the figure moves: its snapshot at 0.5 s differs from the one at 0 s').not.toBe(shots[0]!.sha);
    expect(shots[2]!.sha, 'its frame at 0 s is the same frame each time').toBe(shots[0]!.sha);
    const libraries = loadedLibraries(stderr);
    expect(webEngineProblems(libraries, 'deep-show run'), 'the deep_show process loads no web engine').toEqual([]);
    expect(webEngineProblems([...libraries, '/System/Library/Frameworks/WebKit.framework/Versions/A/WebKit'], 'twin').join('\n'), 'the twin: a WebKit load fails the check, naming it').toMatch(/loaded the web engine .*WebKit\.framework/);
  }, 900_000);

  it('#378.6ab4aece drawn in the window, every part and every label of the figure, declaring the scene3d module its kinds need, is on screen at its box, each label\'s box holding type, from a process that loads no web engine and a build with no web-view crate (redraft)', () => {
    sameFigurePlusRequires();
    // No web-view crate is in deep-show's or the app's dependency tree; a wry dependency planted under
    // deep-show fails the check, naming it.
    bins.bin(SHOW_BIN);
    const r = spawnSync('cargo', ['metadata', '--locked', '--format-version', '1'], { cwd: REPO, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
    expect(r.status, `cargo metadata --locked runs: ${r.stderr?.slice(-2000)}`).toBe(0);
    const meta = JSON.parse(r.stdout) as Metadata;
    expect(webViewProblems(meta), 'the dependency trees of deep-show and the app').toEqual([]);
    const show = meta.packages.find((p) => p.targets.some((t) => t.name === SHOW_BIN && t.kind.includes('bin')))!;
    const wry: Package = { id: 'registry+https://github.com/rust-lang/crates.io-index#wry@0.53.0', name: 'wry', source: 'registry+https://github.com/rust-lang/crates.io-index', dependencies: [], targets: [] };
    const planted: Metadata = {
      ...meta,
      packages: [...meta.packages, wry],
      resolve: { nodes: [...meta.resolve.nodes.map((n) => (n.id === show.id ? { ...n, deps: [...n.deps, { pkg: wry.id, dep_kinds: [{ kind: null }] }] } : n)), { id: wry.id, deps: [] }] },
    };
    expect(webViewProblems(planted).join('\n'), 'a web view under deep-show fails the check, naming it').toMatch(/deep-show depends on the web view wry/);
    requireGpu();
    const evidence = out();
    const shown = showScreen(bins.bin(SHOW_BIN), scenario(evidence, ['0s']), join(evidence, 'window.png'), DYLD_ENV);
    presented(shown.replies[0]!, 'the deep_show call');
    expect([shown.image.width, shown.image.height], 'the window is drawn at its size').toEqual(WINDOW);
    expect(blank(shown.image), 'the window isn\'t blank').toBe(false);
    const boxes = new Map(shown.items.map((i) => [i.id, i.box]));
    for (const id of [...PARTS, ...LABELS]) {
      const box = boxes.get(id);
      expect(box, `${id} is drawn on screen, with its box`).toBeDefined();
      const [x, y, w, h] = box!;
      expect(w > 2 && h > 2 && x + w > 0 && y + h > 0 && x < WINDOW[0] && y < WINDOW[1], `${id}'s box ${box} is inside the window`).toBe(true);
      const { share, dark } = drawnShare(shown.image, box!);
      if (LABELS.includes(id)) expect(dark > 0.02 && dark < 0.8, `${id}'s box holds type: ${(dark * 100).toFixed(1)}% of it is dark ink`).toBe(true);
      else expect(share, `${id}'s box isn't the bare ground`).toBeGreaterThan(0.1);
    }
    expect(webEngineProblems(loadedLibraries(shown.stderr), 'deep-show screen'), 'the window\'s process loads no web engine').toEqual([]);
  }, 900_000);
});
