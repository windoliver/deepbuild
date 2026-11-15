// AC1 #142.44730151: "Each recipe's example renders from its cue list alone, in 2D and in 3D (explain.linear_map in 2D
// only), with no film-specific code"
//
// The examples as data: each of the ten `packs/explain-1.0.0/examples/<recipe>.json` (README: The examples) is a film
// whose one item is an instance of `explain.<recipe>@1` on the 2D stage, beside envelope fields only (no channels,
// shots, markers, transitions, drivers or any other hand-written map), naming deepbuild/explain@1.0.0; its cue list
// (`params.cues`) is under 1.2 KB as compact JSON (the issue's Fields: "each under 1.2 KB"), with distinct cue IDs and
// words. No film-specific code: no Rust source under crates/ outside tests names any of the ten recipes, and the pack's
// folder holds no code or shader file.
//
// Rendered: one `deep-show run` per example presents it on the 2D stage and, for every recipe but linear_map, the same
// document with only `params.stage` set to "3d". Each is presented with no error, its expansion row is the recipe's
// and derives items; the film block at the middle of its span lists at least one camera, every one orthographic on the
// 2D stage (fov 0) and in perspective on the 3D stage (fov > 0) (README: Readings, the stages); and six frames spread
// over its span, drawn by `eval` with `pixels` at 320 px wide, each show something (at least 0.1% of pixels away from
// the frame's most common color) and are not all one picture.
// Wrong programs: the base (no pack, no examples); an example that writes its own shots or channels; a recipe that
// ignores `stage`; one that draws nothing; a recipe named in a canvas module.
import { describe, it } from 'vitest';
import {
  AC, ENVELOPE, EXPLAIN, EXPLAIN_AT, FLICKS, RECIPES, STAGED_3D, TIMEOUT, brief, bytesOf, docId, drawnShare, errors, evalAt, evaluated, exampleOf,
  expansionOf, filesUnder, isObject, kindOf, none, obj, onStage, pictureOf, present, rustNaming, run, scenario, sizeFor, snapshotOf, spanOf,
  useFolders, useShow, type JsonObject,
} from './helpers.ts';

const show = useShow();
const folder = useFolders();
const CODE = /\.(rs|js|mjs|cjs|ts|wasm|wgsl|glsl|metal|hlsl|py|sh|lua)$/;

describe(`${AC[1]} each example renders from its cue list alone, in 2D and in 3D, with no film-specific code`, () => {
  it(`${AC[1]} the ten examples are one recipe instance each and a cue list under 1.2 KB, and no canvas module names a recipe`, () => {
    const failures: string[] = [];
    for (const recipe of RECIPES) {
      const ex = exampleOf(recipe);
      if (Array.isArray(ex)) { failures.push(...ex); continue; }
      const extra = Object.keys(ex.doc).filter((k) => !(ENVELOPE as readonly string[]).includes(k));
      if (extra.length) failures.push(`${recipe}: the example writes ${extra.join(', ')} beside its recipe instance`);
      if (!Array.isArray(ex.doc['packs']) || !ex.doc['packs'].includes(EXPLAIN_AT)) failures.push(`${recipe}: the example doesn't name ${EXPLAIN_AT}`);
      if (ex.item['kind'] !== kindOf(recipe)) failures.push(`${recipe}: its one item is of kind ${brief(ex.item['kind'] ?? null)}, not ${kindOf(recipe)}`);
      const params = isObject(ex.item['params']) ? ex.item['params'] : {};
      if (params['stage'] !== '2d') failures.push(`${recipe}: its instance sets stage ${brief(params['stage'] ?? null)}, not "2d"`);
      if (ex.cues.length === 0) failures.push(`${recipe}: its instance holds no cue list`);
      const size = bytesOf(params['cues'] ?? []);
      if (size >= 1200) failures.push(`${recipe}: its cue list is ${size} bytes as compact JSON, not under 1.2 KB`);
      const ids = ex.cues.map((c) => c['id']);
      if (new Set(ids).size !== ids.length) failures.push(`${recipe}: two cues share an ID`);
      const words = ex.cues.flatMap((c) => [c['text'], c['sub']].filter((w) => typeof w === 'string'));
      if (new Set(words).size !== words.length) failures.push(`${recipe}: two cues draw the same word`);
    }
    for (const f of filesUnder(EXPLAIN.dir)) if (CODE.test(f)) failures.push(`the explain pack carries a code or shader file, ${f}`);
    failures.push(...rustNaming(RECIPES.map((r) => `explain.${r}`)).map((f) => `film-specific code: ${f}`));
    none(failures, 'the examples are data, and no canvas module names a recipe');
  }, TIMEOUT);

  it(`${AC[1]} each example presents and draws on the 2D stage and, but for explain.linear_map, on the 3D stage`, () => {
    const failures: string[] = [];
    for (const recipe of RECIPES) {
      const ex = exampleOf(recipe);
      if (Array.isArray(ex)) { failures.push(...ex); continue; }
      const stages = (STAGED_3D as readonly string[]).includes(recipe) ? (['2d', '3d'] as const) : (['2d'] as const);
      const docs = stages.map((s) => onStage(ex.doc, s));
      const span = spanOf(ex.doc, recipe);
      const times = Array.from({ length: 6 }, (_, k) => Math.floor(((k + 1) * span) / 7));
      const size = sizeFor(ex.doc, 320);
      const evidence = folder();
      const calls: JsonObject[] = [
        ...docs.map((d, i) => present(docId(i + 1), d)),
        ...docs.map((_, i) => evalAt(docId(i + 1), Math.floor(span / 2), { film: true })),
        ...docs.flatMap((_, i) => times.map((t) => evalAt(docId(i + 1), t, { pixels: true, size }))),
      ];
      const replies = run(show(), scenario(evidence, calls));
      stages.forEach((stage, i) => {
        const what = `${recipe} on the ${stage} stage`;
        const shown = replies[i]!;
        if (shown['outcome'] !== 'presented' || errors(shown).length) {
          failures.push(`${what}: not presented with no error: ${brief(shown, 1500)}`);
          return;
        }
        const e = expansionOf(shown, ex.instance, what);
        const row = e.rows.find((r) => r['instance'] === ex.instance)!;
        if (row['kind'] !== kindOf(recipe)) failures.push(`${what}: its expansion row is of kind ${brief(row['kind'] ?? null)}`);
        if (Object.keys(e.derived).length === 0) failures.push(`${what}: its expansion derives no item`);
        const film = obj(evaluated(replies[docs.length + i]!, `${what}: the film block`)['film'], `${what}: film`);
        const cams = Object.entries(isObject(film['cameras']) ? film['cameras'] : {});
        if (!cams.length) failures.push(`${what}: the film block lists no camera at ${(span / 2 / FLICKS).toFixed(2)} s`);
        for (const [id, c] of cams) {
          const fov = isObject(c) && typeof c['fov'] === 'number' ? c['fov'] : NaN;
          if (stage === '2d' ? fov !== 0 : !(fov > 0)) failures.push(`${what}: camera ${id} has fov ${fov}, so it isn't ${stage === '2d' ? 'orthographic' : 'in perspective'}`);
        }
        const shas: string[] = [];
        times.forEach((t, k) => {
          const reply = replies[2 * docs.length + i * times.length + k]!;
          const sha = snapshotOf(reply, `${what} at ${t} flicks`);
          shas.push(sha);
          const share = drawnShare(pictureOf(evidence, sha, `${what} at ${t} flicks`));
          if (share < 0.001) failures.push(`${what}: the frame at ${(t / FLICKS).toFixed(2)} s shows nothing (${(share * 100).toFixed(3)}% of pixels off its ground)`);
        });
        if (new Set(shas).size < 2) failures.push(`${what}: its six frames are one picture; nothing plays`);
      });
    }
    none(failures, 'each example renders from its cue list alone');
  }, 4 * 3_600_000);
});
