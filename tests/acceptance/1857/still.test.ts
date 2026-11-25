// AC7 #1857.5a457b1e: "Every shipped pack, look and drawn-look fixture still checks clean, expands to the same derived
// items and keys, and draws the same pixels"
//
// "Still" is held against the base. What the base expanded to and drew is pinned by the base's own suites and
// goldens, which the work may not edit and which stay with the Proof (README: Criterion 7). These two tests add what
// those don't hold: that the two new refusals leave what the base ships alone.
//
// asserts:
// 1. Every line profile the base ships or draws from still checks and draws. The profiles are found, not listed:
//    each `lines.<name>.profile` of every JSON file under `packs/`, `crates/deep-canvas-marks/looks/` and the
//    fixtures of the base's drawn-look suites (`tests/acceptance/149`, `417` and `1561`, `fixtures/`; five profiles
//    at the base: three in `packs/art-1.0.0/pack.json`, one each in #149's and #1561's). At least one sets `breaks`,
//    `overshoot` and `flick` (the base has one: #149's `families/profiles.json`, `nib`: flick 14, overshoot 6,
//    breaks every 240 and gap 6), so the new ranges are met by a profile that uses them. One `deep-gpu run` child
//    is given a `layers` call per profile: this suite's figure of one stroke, in this suite's look with that profile
//    on the stroke's line. The child runs to its own end inside its limits, and every call is answered with its
//    layers, none refused.
// 2. The castle, `packs/examples/castle.json`, the base's largest shipped expansion, still expands: one
//    `deep-show run` child, `deepbuild/composites@1.0.0` installed from `packs/composites-1.0.0`, is given the
//    castle as committed by the agent's `deep_show`. The child runs to its own end inside its limits; no error is
//    `over_budget`; and every item whose kind is a recipe of the composites pack (found from the two files) has
//    one row in the reply's `expansions` with at least one derived item.
//
// Both pass at the merge base, as a criterion that says "still" must. A wrong program each fails on: a range that
// refuses a shipped profile (a maximum under 14 px, or a floor above 6 px for `gap`); a cap under what the castle's
// instances expand to.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOC, GPU_LIMITS, REPO, WHOLE_LIMITS, figure, layersCall, look, none, requireMetal, runGpu, runShow, stroked, sub, useDir, useGpu, useShow } from './helpers.ts';
import { boundFailures, gpuRepliesOf, isObject, issuesOf, lookAdmittedFailures, repliesOf, shown, type JsonObject, type JsonValue } from './judge.ts';

// Each criterion's tag, a constant of this file, so a test's name reads whole from its source.
const AC7 = 'AC7 #1857.5a457b1e';

const gpu = useGpu();
const showBin = useShow();
const dir = useDir();

// ---------------------------------------------------------------------------------------------------
// 1. Line profiles.

interface Found { file: string; at: string; profile: JsonObject }
/** Every JSON file under `root`, not following a folder named node_modules, target or goldens. */
function jsonFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (folder: string): void => {
    for (const name of readdirSync(folder).sort()) {
      if (name === 'node_modules' || name === 'target' || name === 'goldens') continue;
      const path = join(folder, name);
      const stat = statSync(path, { throwIfNoEntry: false });
      if (stat?.isDirectory()) walk(path);
      else if (stat?.isFile() && name.endsWith('.json') && stat.size < 16 * 1024 * 1024) out.push(path);
    }
  };
  walk(root);
  return out;
}
/** Every `lines.<name>.profile` object anywhere in a JSON value. */
function profilesIn(value: JsonValue, at: string, file: string, out: Found[]): void {
  if (Array.isArray(value)) { value.forEach((v, i) => profilesIn(v, `${at}/${i}`, file, out)); return; }
  if (!isObject(value)) return;
  const lines = value['lines'];
  if (isObject(lines)) {
    for (const [name, line] of Object.entries(lines)) {
      if (isObject(line) && isObject(line['profile'])) out.push({ file, at: `${at}/lines/${name}/profile`, profile: line['profile'] });
    }
  }
  for (const [key, v] of Object.entries(value)) profilesIn(v, `${at}/${key}`, file, out);
}
/** The base's suites whose fixtures are looks or documents in drawn looks (#417: looks as fixtures; #149, #1561: drawn looks). */
const DRAWN_LOOK_SUITES = ['149', '417', '1561'];
/** The line profiles of the shipped packs and looks and of the drawn-look fixtures. */
function shippedProfiles(): Found[] {
  const roots = [
    join(REPO, 'packs'),
    join(REPO, 'crates', 'deep-canvas-marks', 'looks'),
    ...DRAWN_LOOK_SUITES.map((issue) => join(REPO, 'tests', 'acceptance', issue, 'fixtures')),
  ];
  const found: Found[] = [];
  for (const file of roots.flatMap(jsonFiles)) {
    let value: JsonValue;
    try { value = JSON.parse(readFileSync(file, 'utf8')) as JsonValue; } catch { continue; }
    profilesIn(value, '', relative(REPO, file), found);
  }
  return found;
}

// ---------------------------------------------------------------------------------------------------
// 2. The castle.

const CASTLE = join(REPO, 'packs', 'examples', 'castle.json');
const COMPOSITES = join(REPO, 'packs', 'composites-1.0.0');
const json = (path: string): JsonObject => JSON.parse(readFileSync(path, 'utf8')) as JsonObject;

describe(`${AC7} every shipped pack, look and drawn-look fixture still checks clean, expands and draws`, () => {
  it(`${AC7} every line profile of the shipped packs and looks and of the suites' drawn-look fixtures is still admitted and drawn, one that sets breaks, overshoot and flick among them`, (ctx) => {
    requireMetal(ctx);
    const found = shippedProfiles();
    const full = found.filter((f) => isObject(f.profile['breaks']) && typeof f.profile['overshoot'] === 'number' && typeof f.profile['flick'] === 'number');
    expect(full.length, `a shipped pack, look or drawn-look fixture holds a line profile that sets breaks, overshoot and flick; found ${found.map((f) => `${f.file}#${f.at}`).join(', ') || 'no profile at all'}`).toBeGreaterThan(0);
    const drawing = figure('still-1857', [320, 96], { stroke: stroked('stroke', 'M 20 48.5 L 300 48.5', 'nib') });
    const calls = found.map((f) => layersCall(drawing, look({ lines: { line: { kind: 'exact', width: 2 }, nib: { kind: 'exact', width: 4, profile: f.profile } } })));
    const what = `the child given ${found.length} shipped line profiles`;
    const run = runGpu(dir(), gpu(), calls);
    none(boundFailures(run, what, GPU_LIMITS), what);
    const { replies, failures } = gpuRepliesOf(run.answers[0]?.text ?? null, calls.length, what);
    none(failures, what);
    none(found.flatMap((f, i) => lookAdmittedFailures(replies[i]!, `the profile of ${f.file} at ${f.at}, ${shown(f.profile, 300)}`)), 'a shipped line profile is no longer admitted and drawn');
  });

  it(`${AC7} the castle still expands: no over_budget, and every instance of a composites recipe has its expansion`, () => {
    const castle = json(CASTLE);
    const recipes = Object.keys(json(join(COMPOSITES, 'pack.json'))['recipes'] as JsonObject);
    const items = castle['items'] as JsonObject;
    const instances = Object.keys(items).filter((id) => recipes.includes(String((items[id] as JsonObject)['kind']))).sort();
    expect(instances.length, 'the castle holds instances of the composites pack\'s recipes').toBeGreaterThan(0);
    const scenario: JsonObject = {
      evidence: sub(dir(), 'evidence'),
      sessions: { 'sess-alpha': { thread: 'thread-alpha', name: 'Claude Code: the castle', process: { pid: 4100, start: 1_000 } } },
      panels: { p1: { rect: [0, 0, 1280, 800] } },
      docs: { [DOC]: { panel: 'p1' } },
      packs: [{ id: 'deepbuild/composites', dir: COMPOSITES }],
      calls: [{ call: 'deep_show', session: 'sess-alpha', doc: DOC, document: castle, include: ['issues'] }],
    };
    const what = 'the castle';
    const run = runShow(dir(), showBin(), scenario, WHOLE_LIMITS);
    none(boundFailures(run, what, WHOLE_LIMITS), what);
    const { replies, failures } = repliesOf(run.answers[0]?.text ?? null, 1, what);
    none(failures, what);
    const reply = replies[0]!;
    expect(issuesOf(reply).filter((i) => i.code === 'over_budget' && i.severity === 'error').map((i) => shown(i.raw, 400)), 'no error of the castle is over_budget').toEqual([]);
    const rows = (Array.isArray(reply['expansions']) ? reply['expansions'] : []).filter(isObject);
    const expanded = new Set(rows.filter((r) => isObject(r['derived']) && Object.keys(r['derived']).length > 0).map((r) => String(r['instance'])));
    expect(instances.filter((id) => !expanded.has(id)), `every instance of a composites recipe expands; the castle's errors: ${shown(issuesOf(reply).filter((i) => i.severity === 'error').map((i) => i.raw), 800)}`).toEqual([]);
  });
});
