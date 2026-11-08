// AC7 #427.f8669ef0, blind redraft of paths-picks.test.ts's second test (PATHS-PICKS-REDRAFT.md): None of the new
// modes draws a status color, changes the revision or the live view's frame count, or can be cited as evidence.
//
// The disputed draft ran helpers.ts `quietProblems` on 'Every new mode', whose channel moves `mover` over a 2 s span, so
// the shown window played that motion (#140's frame clock arms a frame whenever the frame's `valid_until` comes) and
// its `presented` and `wakeups` moved with or without any mode. This redraft keeps every mode and every check of
// `quietProblems`, split over two documents:
//
// - 'Every new mode', the moving scene, unchanged: `deep-show run` draws the seven modes (motion paths reads the keyed
//   channel), each reply at rev 1 with no snapshot pixel within 2 per channel of the clean look's pass, fail, invalid
//   or running color; and a claim whose requirements each cite one of those snapshots gets verdict rows that are not
//   PASS and each carry `display_only` with the snapshot's hash.
// - Its still twin, the same document without `channels` (nothing in it changes after any time, so the window idles
//   once its first frame is up, as AC3's still scene does): `deep-show run` draws the seven modes again for their
//   snapshots, then `deep-show live` shows it at revision 1 and draws them between two `presented` reads; the revision
//   the window shows, its frames presented, its frame callbacks and its meter rung are the same after as before, each
//   reply at rev 1 with the run's snapshot. Two reads before the modes, 150 ms apart, check the window is idle; a window
//   that still draws then can't measure the modes, and that is INCONCLUSIVE, never PASS.
import { describe, it } from 'vitest';
import {
  AC, type BinName, type JsonObject, PANEL, SESSION, DOC, box, camera, channel, decodePng, drew, evidenceBytes, gltf, inconclusive, meshAsset,
  mode, none, obj, objs, plate, requireMetal, runLive, runShow, scenario, scene, seed, show, statusColorsIn, sun, useBuilds, useDir,
} from './helpers.ts';

const ID = AC[7];
const bin = useBuilds(['deep-show']);
const dir = useDir();
const X: [number, number][] = [[0, 0], [0.5, 1], [2, 0]];
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
const name = (c: JsonObject): string => String(c['mode']);

/** `deep-show run` of the calls on `document`: each mode's snapshot hash, with rev and status-color problems. */
function runModes(binary: string, evidence: string, document: JsonObject, calls: JsonObject[], what: string, p: string[]): string[] {
  const replies = runShow(binary, scenario(evidence, [show(document), ...calls]));
  return calls.map((c, i) => {
    const d = drew(replies[i + 1]!, `${name(c)} in deep-show run on ${what}`);
    if (d.rev !== 1) p.push(`${name(c)} on ${what}: the reply names rev ${d.rev}, not the document's revision 1`);
    const found = statusColorsIn(decodePng(evidenceBytes(evidence, d.sha, `${name(c)}'s snapshot on ${what}`)));
    if (found.length) p.push(`${name(c)} on ${what}: its snapshot ${d.sha} draws the status color${found.length > 1 ? 's' : ''} ${found.join(', ')}`);
    return d.sha;
  });
}

/** quietProblems' checks, the live half on `still` (README: Readings, "draws 0 frames" read on a still window). */
function quietOnStill(b: (n: BinName) => string, evidence: string, moving: JsonObject, still: JsonObject, calls: JsonObject[]): string[] {
  const p: string[] = [];
  const shas = runModes(b('deep-show'), evidence, moving, calls, 'the moving scene', p);
  const stillShas = runModes(b('deep-show'), evidence, still, calls, 'the still scene', p);

  const presented = { call: 'presented', panel: PANEL };
  const after = runLive(b('deep-show'), scenario(evidence, [show(still)]), [
    { after_ms: 1_000, call: presented },
    { after_ms: 1_150, call: presented },
    ...calls.map((c, i) => ({ after_ms: 1_300 + 200 * i, call: c })),
    { after_ms: 1_500 + 200 * calls.length, call: presented },
  ]);
  const [idle, before, ...rest] = after;
  const end = rest.at(-1)!;
  if (before!.showing !== 1 || before!.presented < 1) p.push(`the window wasn't showing revision 1 before the modes (showing ${before!.showing}, ${before!.presented} frames presented)`);
  if (idle!.presented !== before!.presented || idle!.wakeups !== before!.wakeups) {
    inconclusive(`the window showing the still scene drew ${before!.presented - idle!.presented} frames and got ${before!.wakeups - idle!.wakeups} frame callbacks in 150 ms with no call, so it can't measure the modes`);
  }
  if (end.showing !== before!.showing) p.push(`the document's revision went from ${before!.showing} to ${end.showing} across the modes`);
  if (end.presented !== before!.presented) p.push(`the live view drew ${end.presented - before!.presented} frames across the modes`);
  if (end.wakeups !== before!.wakeups) p.push(`the live view got ${end.wakeups - before!.wakeups} frame callbacks across the modes`);
  if (end.rung !== before!.rung) p.push(`the live view's meter moved from ${before!.rung} to ${end.rung} across the modes`);
  calls.forEach((c, i) => {
    const d = drew(rest[i]!.reply, `${name(c)} with the app showing`);
    if (d.rev !== 1) p.push(`${name(c)} with the app showing: the reply names rev ${d.rev}, not 1`);
    if (d.sha !== stillShas[i]) p.push(`${name(c)}: the snapshot with the app showing (${d.sha}) isn't the run's on the same scene (${stillShas[i]})`);
  });

  const claim = `claim:${ulid('01JB0427C', 1)}`;
  const reqs = calls.map((_, i) => `req:${ulid('01JB0427Q', i + 1)}`);
  const claims: JsonObject = { [claim]: { session: SESSION, deliverables: [DOC], requirements: reqs.map((id, i) => ({ id, check: { kind: 'render.contrast', snapshot: shas[i]! } })) } };
  const cited = runShow(b('deep-show'), scenario(evidence, [show(moving), ...calls, { call: 'verdict', claim }], { claims }));
  const rows = objs(obj(cited.at(-1), 'verdict')['requirements'], 'verdict: requirements');
  calls.forEach((c, i) => {
    const row = rows.find((r) => r['id'] === reqs[i]);
    const text = JSON.stringify(row ?? null);
    if (!row) p.push(`${name(c)}: the verdict has no row for the requirement citing its snapshot ${shas[i]}`);
    else if (row['result'] === 'PASS' || !text.includes('"display_only"') || !text.includes(shas[i]!)) p.push(`${name(c)}: a claim citing its snapshot ${shas[i]} as evidence wasn't refused naming it: ${text.slice(0, 600)}`);
  });
  return p;
}

describe(`${ID} every new mode is display only (redraft)`, () => {
  it(`${ID} deviation, normals, tangents, probes, sound sources, motion paths and the pick hierarchy draw no status color, touch neither the revision nor the live view, and can't be cited`, () => {
    requireMetal();
    const evidence = dir();
    const flat = seed(evidence, gltf(plate(2, 2, 4, 4)));
    const bulge = seed(evidence, gltf(plate(2, 2, 4, 4, (i, j) => (i === 1 && j === 1 ? 0.1 : 0))));
    const items: Record<string, JsonObject> = {
      cam: camera([0, 0.5, 0], 10),
      mover: box([0, 0, 0], [0.3, 0.3, 0.3]),
      ball: { kind: 'ball@1', params: { tessellation: 'uv', radius: 0.5, segments: 16 }, at: { pos: [-2, 0.5, 0] } },
      bulge: meshAsset(bulge, [2, 0.5, 0]),
      'probe.irr': { kind: 'light.probe@1', params: { type: 'irradiance', size: [4, 3, 4] }, at: { pos: [0, 1.5, -2] } },
      bell: box([0, 1, 2], [0.3, 0.3, 0.3]),
      ground: box([0, -0.25, 0], [10, 0.5, 8]),
      key: sun(),
    };
    const rest: JsonObject = {
      requires: { modules: { scene3d: '^1', media: '^1' } },
      transport: { span: '2s' },
      strips: { chime: { synth: 'sine', freq: 440, span: '2s' } },
      emitters: { 'voice.bell': { item: 'bell', src: 'chime', distance: { model: 'inverse', ref: 1, max: 12, rolloff: 1 }, cone: { inner: 40, outer: 100, outer_gain: 0.25 } } },
    };
    const moving = scene('Every new mode', items, { ...rest, channels: { x: channel('items/mover/at/pos/0', X) } });
    const still = scene('Every new mode', items, rest);
    none(quietOnStill(bin, evidence, moving, still, [
      mode('deviation', { item: 'bulge', reference: flat }), mode('normals'), mode('tangents'), mode('probes'), mode('sound_sources'),
      mode('motion_paths', { select: ['mover'], span: ['0s', '2s'] }), mode('pick_hierarchy', { depth: 3 }),
    ]), 'the new modes');
  }, 2_400_000);
});
