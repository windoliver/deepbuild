// AC7 #1431.c01cc90e: in one `deep-show` process, 200 render-backs of a document whose `extrude@1` depth changes each
// revision leave the renderer's mesh entries within their declared entry bound and its mesh bytes within its byte
// bound, read from their gauges. On the merge base the entries count 200 or more and the test fails, naming `meshes`.
//
// One `deep-show run` scenario (one process, one hub, so one 3D renderer for every revision, Hub::gpu3): the process's
// reading (`{"call": "footprint"}`), then 200 revisions of one document, each the agent's deep_show with its block's
// depth 1 cm deeper than the last, each followed by its render_back, then the reading again (README: deep-show run).
// The renderer's meshes are the cache `Renderer::meshes`, whose gauge row carries its entries, its bytes and its
// declared bounds. The wrong program is the merge base, whose renderer frees no mesh: its entries count 200 or more,
// past any entry bound under 200, so the declared entry bound must be under 200 too. On the merge base the scenario's
// `footprint` call doesn't exist, so deep-show refuses the scenario and the test fails at the meshes check.
import { describe, expect, it } from 'vitest';
import { DOC, ID, SESSION, isObject, mb, none, obj, readingOf, requireMacos, runShow, scratch, short, showScenario, useBuild, SHOW_BUILD, type JsonObject, type Reading } from './helpers.ts';

const show = useBuild(SHOW_BUILD);
const RENDER_BACKS = 200;
const SIZE: [number, number] = [320, 240];
const MESHES = 'Renderer::meshes';

/** Revision k's depth, in m: 1 cm deeper each revision. */
const depth = (k: number): number => Number((0.1 + 0.01 * k).toFixed(2));

/** The agent's payload (no `id`, no `layers`): a block extruded from a square outline to `d` m, under a sky and a sun. */
function documentAt(d: number): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [2.5, 2, 5], target: [0, 0, 1], fov: 40 } },
    sky: { kind: 'sky@1', params: { top: [0.3, 0.3, 0.3, 1], low: [0.3, 0.3, 0.3, 1], ambient_top: [0.4, 0.4, 0.4], ambient_low: [0.2, 0.2, 0.2] } },
    sun: { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1] }, at: { rot: [-40, 25, 0] } },
    wood: { kind: 'material@1', params: { base_color: [0.6, 0.4, 0.2], roughness: 0.6 } },
    block: { kind: 'extrude@1', params: { outline: [[-0.4, -0.4], [0.4, -0.4], [0.4, 0.4], [-0.4, 0.4]], depth: d }, at: { pos: [0, 0, 0] }, material: 'wood' },
  };
  const ordered: JsonObject = {};
  Object.entries(items).forEach(([id, item], k) => { ordered[id] = { id, name: id, order: `a${String(k).padStart(3, '0')}`, ...item }; });
  return {
    format: 1, profile: 'scene', title: 'A block in depth', description: 'A block whose depth changes each revision, for the renderer\'s mesh bounds.',
    size: SIZE, camera: 'cam', transport: { span: '2s' }, requires: { modules: { scene3d: '^1' } }, items: ordered,
  };
}

/** The criterion's judge on the reading after the render-backs: `Renderer::meshes`, within both declared bounds. */
function meshesProblems(after: Reading | null, answered: string): string[] {
  if (after === null) return [`${MESHES}: no reading of the renderer's meshes gauge after ${RENDER_BACKS} render-backs: ${answered}`];
  const g = after.gauges.find((x) => x.name === MESHES);
  if (!g) return [`${MESHES}: the reading has no gauge for the renderer's meshes; its gauges are ${short(after.gauges.map((x) => x.name))}`];
  const problems: string[] = [];
  const { entries, bytes, bound } = g;
  if (typeof entries !== 'number' || bytes === null || !bound || bound.entries === null || bound.bytes === null) return [`${MESHES}: its gauge row lacks entries, bytes or a declared bound: ${short(g)}`];
  if (bound.entries >= RENDER_BACKS) problems.push(`${MESHES}: its declared entry bound is ${bound.entries}, at or past the ${RENDER_BACKS} entries the merge base holds after these render-backs`);
  if (entries > bound.entries) problems.push(`${MESHES}: ${entries} entries, past their declared entry bound of ${bound.entries}`);
  if (bytes > bound.bytes) problems.push(`${MESHES}: ${bytes} B (${mb(bytes)}), past its declared byte bound of ${bound.bytes} B`);
  if (entries < 1 || bytes < 1) problems.push(`${MESHES}: ${entries} entries and ${bytes} B, though the last revision's block is drawn from one`);
  return problems;
}

describe(`${ID.ac7} one deep-show process keeps its renderer's meshes within their bounds`, () => {
  it(`${ID.ac7} in one deep-show process, 200 render-backs of a document whose extrude@1 depth changes each revision leave the renderer's mesh entries within their declared entry bound and its mesh bytes within its byte bound, read from their gauges; on the merge base the entries count 200 or more and the test fails, naming meshes`, () => {
    requireMacos('3D render-back');
    const evidence = scratch();
    const calls: JsonObject[] = [{ call: 'footprint' }];
    for (let k = 1; k <= RENDER_BACKS; k++) {
      calls.push({ call: 'deep_show', session: SESSION, doc: DOC, document: documentAt(depth(k)), include: ['issues'], size: SIZE });
      calls.push({ call: 'render_back', session: SESSION, doc: DOC, t: 0, rev: k, size: SIZE });
    }
    calls.push({ call: 'footprint' });
    const answer = runShow(show(), showScenario(evidence, calls), `${RENDER_BACKS} render-backs in one deep-show process`);
    const replies = answer['ok'] === true && Array.isArray(answer['replies']) ? answer['replies'] : null;
    const last = replies?.[replies.length - 1];
    const after = replies && isObject(last) && 'reading' in last ? readingOf(last['reading'], 'deep-show after the render-backs') : null;
    if (after) console.log(`PROOF ${ID.ac7} after ${RENDER_BACKS} render-backs: ${short(after.gauges.find((g) => g.name === MESHES) ?? after.gauges, 2000)}`);
    none(meshesProblems(after, short(replies ? last : answer)), `the renderer's meshes (${MESHES}) after ${RENDER_BACKS} render-backs, read from their gauges, within their declared entry and byte bounds`);

    expect(replies!.length, 'one reply per call').toBe(calls.length);
    const before = readingOf(obj(replies![0], 'the first reply')['reading'], 'deep-show before the render-backs');
    console.log(`PROOF ${ID.ac7} before: ${short(before.gauges.find((g) => g.name === MESHES) ?? before.gauges, 2000)}`);
    const problems: string[] = [];
    let previous = '';
    for (let k = 1; k <= RENDER_BACKS; k++) {
      const shown = obj(replies![2 * k - 1], `deep_show of revision ${k}`);
      if (shown['rev'] !== k) problems.push(`deep_show of depth ${depth(k)} m made revision ${short(shown['rev'])}, not ${k}: ${short(shown)}`);
      const back = obj(replies![2 * k], `render_back of revision ${k}`);
      const snaps = Array.isArray(back['snapshots']) ? back['snapshots'] : [];
      const sha = isObject(snaps[0]) ? String(snaps[0]['sha256']) : '';
      if (back['outcome'] !== 'presented' || !/^[0-9a-f]{64}$/.test(sha)) problems.push(`render_back of revision ${k} isn't presented with a snapshot: ${short(back)}`);
      else if (sha === previous) problems.push(`render_back of revision ${k} draws the same snapshot as revision ${k - 1}, though its block is 1 cm deeper`);
      previous = sha;
    }
    none(problems.slice(0, 20), `each of the ${RENDER_BACKS} revisions is a new depth and each render-back draws it`);
  }, 3_600_000);
});
