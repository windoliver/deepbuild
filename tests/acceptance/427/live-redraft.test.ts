// AC1 #427.eec6bc2e: With the app showing a still test scene at revision 12, 20 deep_show calls in the overdraw and
// lights-per-cluster modes each reply with rev 12 and their snapshots, while the live view draws 0 frames, gets no frame
// callback and its meter moves no rung; a test agent's next revision then replaces one cube with another at the same
// place, keeping the item count, and the next render-back names rev 13 and lists the new cube's ID in its visible table,
// not the old one. A planted render-back that draws on the live surface fails on the frame callbacks, and one that
// refreshes its ID table only when the item count changes fails, naming the new ID.
//
// `deep-show live` (#140's real, shown window): the agent shows the still scene 12 times (each revision's description
// names its number), so the window shows revision 12 and settles. Then, as calls into the hub the window shows: a
// `presented` read, 20 mode calls alternating overdraw and lights_per_cluster, another `presented` read, the agent's
// revision 13 (cube.b replaced by cube.d at the same place), and one more overdraw call. Between the two reads the
// window's presented frames, frame callbacks (`wakeups`) and meter rung must not move (README: Assumed surfaces 2).
//
// Blind redraft (LIVE-REDRAFT.md): revision 13 is a whole revision, so it names the ID it leaves out on purpose in
// `removes` (docs/canvas-primitives.md: Revision; an unnamed one is refused `unintended_removal` and 12 stays current).
import { describe, it } from 'vitest';
import {
  AC, type After, type JsonObject, PANEL, box, camera, drew, failsNaming, mode, none, objs, point, requireMetal, runLive,
  scenario, scene, show, sun, useBuilds, useDir,
} from './helpers.ts';

const ID = AC[1];
const bin = useBuilds(['deep-show']);
const dir = useDir();
const OLD = 'cube.b';
const NEW = 'cube.d';

function still(rev: number, swap = false): JsonObject {
  const doc = scene('Still cubes', {
    cam: camera(),
    'cube.a': box([-2, 0, 0]),
    [swap ? NEW : OLD]: box([0, 0, 0]),
    'cube.c': box([2, 0, 0]),
    ground: box([0, -0.75, 0], [8, 0.5, 6]),
    key: sun(),
    'lamp.1': point([-1.5, 1.5, 1]),
    'lamp.2': point([1.5, 1.5, 1]),
  });
  doc['description'] = `Three still cubes on a ground slab, revision ${rev} of the agent's scene.`;
  return doc;
}

const MODES = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 'overdraw' : 'lights_per_cluster'));

function live(planted?: string): After[] {
  const sc = scenario(dir(), Array.from({ length: 12 }, (_, i) => show(still(i + 1))));
  return runLive(bin('deep-show'), sc, [
    { after_ms: 1_000, call: { call: 'presented', panel: PANEL } },
    ...MODES.map((m, i) => ({ after_ms: 1_200 + 50 * i, call: mode(m) })),
    { after_ms: 2_500, call: { call: 'presented', panel: PANEL } },
    { after_ms: 3_000, call: { ...show(still(13, true)), removes: [OLD] } },
    { after_ms: 3_500, call: mode('overdraw') },
  ], planted);
}

/** The failures of one live run against the criterion, each naming what failed. */
function problems(a: After[]): string[] {
  const p: string[] = [];
  const before = a[0]!; const end = a[21]!;
  if (before.showing !== 12 || before.presented < 1) p.push(`the window should show revision 12 before the modes; it shows ${before.showing} with ${before.presented} frames presented`);
  MODES.forEach((m, i) => {
    const r = a[1 + i]!.reply;
    if (r['outcome'] !== 'presented' || r['mode'] !== m) { p.push(`call ${i + 1} (${m}) didn't draw: ${JSON.stringify(r).slice(0, 400)}`); return; }
    const d = drew(r, `call ${i + 1} (${m})`);
    if (d.rev !== 12) p.push(`call ${i + 1} (${m}) replied with rev ${d.rev}, not 12`);
  });
  if (end.showing !== 12) p.push(`the modes changed the revision the window shows: 12 → ${end.showing}`);
  if (end.presented !== before.presented) p.push(`the live view drew ${end.presented - before.presented} frames during the 20 render-backs`);
  if (end.wakeups !== before.wakeups) p.push(`the live view got ${end.wakeups - before.wakeups} frame callbacks during the 20 render-backs`);
  if (end.rung !== before.rung) p.push(`the live view's meter moved a rung during the 20 render-backs: ${before.rung} → ${end.rung}`);
  const revised = a[22]!.reply;
  if (revised['rev'] !== 13) p.push(`the agent's next revision should be 13; its reply names ${JSON.stringify(revised['rev'])}: ${JSON.stringify(revised).slice(0, 400)}`);
  const next = a[23]!.reply;
  const d = drew(next, 'the render-back after revision 13');
  if (d.rev !== 13) p.push(`the render-back after the replacement names rev ${d.rev}, not 13`);
  const ids = objs(next['visible'], 'its visible table').map((r) => r['id']);
  if (!ids.includes(NEW)) p.push(`the render-back at rev 13 doesn't list the new cube ${NEW} in its visible table: ${JSON.stringify(ids)}`);
  if (ids.includes(OLD)) p.push(`the render-back at rev 13 still lists the old cube ${OLD}, replaced by ${NEW}`);
  return p;
}

describe(`${ID} render-backs in a mode leave the live view alone and name the revision they drew`, () => {
  it(`${ID} 20 overdraw and lights-per-cluster render-backs at rev 12 draw no live frame, take no frame callback and move no rung; the next render-back names rev 13 and the new cube`, () => {
    requireMetal();
    none(problems(live()), 'the still scene in the app');
  }, 900_000);

  it(`${ID} a render-back that draws on the live surface fails on the frame callbacks, and an ID table refreshed only on a count change fails naming ${NEW}`, () => {
    requireMetal();
    failsNaming(problems(live('mode_draws_live_surface')), ['frame callbacks'], 'planted mode_draws_live_surface');
    failsNaming(problems(live('mode_ids_by_count')), [NEW], 'planted mode_ids_by_count');
  }, 1_800_000);
});
