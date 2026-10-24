// #377.84a84b5e, blind redraft of plugin.test.ts (A6-REDRAFT.md): no plug-in or agent code path reaches the
// GPU or the window's drawing surface, checked by a plug-in fixture that tries
// (fixtures/plugin/gpu-probe-redraft). The `plugin` call is the README's: it loads the fixture as a plug-in
// beside a live GPU-layer view; its panel's probe (main.js) searches every global and every export of the
// modules a panel script can import for a GPU or drawing-surface entry, and draws what it found as text; its
// documents (documents.json, the first draft's byte for byte) try to hand the canvas pixels, a surface item,
// a surface field and a shader. Two things change from the first draft:
// - the probe names gpui-shell's own runtime bridge (`__gpui`, `__gpui_components`) instead of reporting it
//   for holding the letters "gpu", and searches the bridge's members with the same words;
// - the three item-level tries (raw pixels on an image, a `gpu.surface@1` item, a WGSL param on a rect) are
//   held to what the criterion needs of them, never drawn: refused with an error issue, or presented with the
//   item skipped as `unknown_kind` (canvas-primitives: Kind and version), or its added field skipped as
//   `unknown_field`. At the base no sealed build registers `gpu.surface@1`, `image@1` or `rect@1`, so all
//   three are skipped kinds, not refusals. The `surface` envelope field stays refused with an error issue.
// An agent's code path is the same document route (deep_show), held by #393's suite; it has no panel. At the
// base there is no `deep-gpu` binary.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SCENES, arr, num, obj, run, scenario, scenePath, str, strs, useBuilds, useOut, type JsonObject } from './helpers.ts';

const builds = useBuilds(['default']);
const out = useOut();
const DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'plugin', 'gpu-probe-redraft');
const FIXTURE = JSON.parse(readFileSync(join(DIR, 'documents.json'), 'utf8')) as { documents: { name: string }[] };
const MODULES = ['gpui-kit', 'gpui-base', 'gpui-component', 'deepbuild'];
const BRIDGE = ['__gpui', '__gpui_components'];
const PLUGIN: JsonObject = { call: 'plugin', dir: DIR, scene: scenePath(SCENES.handoff) };

/** Each item-level try: the item carrying it, and the param it adds (null when the kind itself is the try). */
const TRIES: Record<string, { item: string; field: string | null }> = {
  'raw-pixels': { item: 'shot', field: 'pixels' },
  'surface-kind': { item: 'surface', field: null },
  'raw-shader': { item: 'back', field: 'wgsl' },
};

interface Issue { code: string; severity: string; ids: string[]; path: string }
interface Doc { outcome: string; issues: Issue[]; errors: number }
interface Tried { text: string[]; documents: Doc[]; devices: number; frames: number }
function tried(reply: JsonObject): Tried {
  const panel = obj(reply['panel'], 'plugin: panel');
  expect(panel['loaded'], `the fixture's panel loaded as a plug-in panel: ${JSON.stringify(panel).slice(0, 800)}`).toBe(true);
  const gpu = obj(reply['gpu'], 'plugin: gpu');
  return {
    text: strs(panel['text'], 'plugin: panel.text'),
    documents: arr(reply['documents'], 'plugin: documents').map((d, i) => {
      const o = obj(d, `plugin: documents[${i}]`);
      const issues = arr(o['issues'] ?? [], `plugin: documents[${i}].issues`).map((x, j) => {
        const issue = obj(x, `plugin: documents[${i}].issues[${j}]`);
        return {
          code: typeof issue['code'] === 'string' ? issue['code'] : '',
          severity: typeof issue['severity'] === 'string' ? issue['severity'] : '',
          ids: Array.isArray(issue['ids']) ? issue['ids'].filter((id): id is string => typeof id === 'string') : [],
          path: typeof issue['path'] === 'string' ? issue['path'] : '',
        };
      });
      return { outcome: str(o['outcome'], `plugin: documents[${i}].outcome`), issues, errors: issues.filter((x) => x.severity === 'error').length };
    }),
    devices: num(gpu['devices'], 'plugin: gpu.devices'), frames: num(gpu['frames'], 'plugin: gpu.frames'),
  };
}
/** What the probe reached, each named: an empty list is a pass. */
const reached = (text: string[]): string[] => text.filter((line) => line.startsWith('found:'));
const shown = (d: Doc): string => JSON.stringify(d).slice(0, 1500);

describe('#377.84a84b5e no plug-in or agent code path reaches the GPU or the window\'s drawing surface, checked by a plug-in fixture that tries (redraft)', () => {
  it('#377.84a84b5e the plug-in fixture\'s panel searches every global and module it can name and reaches no GPU or surface, while the GPU layer draws beside it', () => {
    const [reply] = run(builds.bin(), scenario(out(), [PLUGIN]));
    const t = tried(reply!);
    expect(t.text, 'the probe ran to its end').toContain('probe:done');
    expect(t.text, 'the probe searched the globals').toContain('global:checked');
    for (const b of BRIDGE) expect(t.text, `the probe searched the members of gpui-shell's runtime bridge ${b}`).toContain(`bridge:${b}:checked`);
    for (const m of MODULES) expect(t.text, `the probe searched ${m}'s exports`).toContain(`module:${m}:checked`);
    expect(t.text, 'WebGPU\'s entry point is absent').toContain('navigator.gpu:absent');
    expect(reached(t.text), 'what the plug-in\'s panel reached of the GPU or the drawing surface').toEqual([]);
    expect(t.devices, 'the app still has its one device').toBe(1);
    expect(t.frames, 'the GPU layer drew beside the plug-in, so there was a GPU and a surface to reach').toBeGreaterThan(0);
  }, 1_800_000);

  it('#377.84a84b5e the plug-in\'s documents that try to hand the canvas pixels, a surface or a shader are refused or never drawn, and its plain description is drawn', () => {
    const [reply] = run(builds.bin(), scenario(out(), [PLUGIN]));
    const t = tried(reply!);
    expect(t.documents.length, 'one reply per document the fixture hands the canvas').toBe(FIXTURE.documents.length);
    expect(FIXTURE.documents.map((d) => d.name).sort(), 'the fixture\'s documents').toEqual(['control', 'surface-field', ...Object.keys(TRIES)].sort());
    FIXTURE.documents.forEach((d, i) => {
      const got = t.documents[i]!;
      const tries = TRIES[d.name];
      if (d.name === 'control') expect(got.outcome, `the plain description is presented: ${shown(got)}`).toBe('presented');
      else if (tries) {
        expect(['presented', 'refused'], `the ${d.name} document has an outcome: ${shown(got)}`).toContain(got.outcome);
        if (got.outcome === 'refused') expect(got.errors, `the ${d.name} refusal carries an error issue: ${shown(got)}`).toBeGreaterThan(0);
        else {
          const skipped = got.issues.filter((x) => (x.code === 'unknown_kind' && x.ids.includes(tries.item))
            || (tries.field !== null && x.code === 'unknown_field' && x.path.split('/').includes(tries.field)));
          expect(skipped.length, `the ${d.name} try is never drawn: its item ${tries.item} skipped as unknown_kind${tries.field ? `, or its field ${tries.field} skipped as unknown_field` : ''}: ${shown(got)}`).toBeGreaterThan(0);
        }
      } else {
        expect(got.outcome, `the ${d.name} document is refused: ${shown(got)}`).toBe('refused');
        expect(got.errors, `the ${d.name} refusal carries an error issue: ${shown(got)}`).toBeGreaterThan(0);
      }
    });
  }, 1_800_000);

  it('#377.84a84b5e a planted panel runtime that hands scripts the GPU layer (--planted exposes_gpu_to_panels) is caught by the fixture, naming the route', () => {
    const [reply] = run(builds.bin(), scenario(out(), [PLUGIN]), { planted: 'exposes_gpu_to_panels' });
    const t = tried(reply!);
    expect(reached(t.text).join('\n'), 'the probe reaches the planted global and names it').toMatch(/found:global:deepGpu/);
  }, 1_800_000);
});
