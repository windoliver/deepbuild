// AC2 #172.33b3fb42: "A planted secret value from the app's store and the hub's socket path never appear in the bundle's
// bytes, and a piece with a status binding, a capture, a video strip, a video background or a video point set the
// bundle can't carry, or a canvas module the player lacks is refused at export, naming each"
//
// This file is the blind redraft of the criterion's refusal half only (README). It asserts, through `deep-show run`
// and the first draft's chosen surfaces (../172/README.md: The surface under test):
//   - each of six pieces, each presented by the base's own document check, is refused by its web export
//     (`video.codec: "web"`): the reply's outcome is `refused`, its `refused: [{item, why}]` holds an entry naming the
//     piece's offending item, names none of the piece's plain items (its camera, backdrop and band), and nothing is
//     written in the export's fresh folder. The pieces: a plate whose fill the status binding `lamp_status` reads
//     (#169's); a figure whose device control `wave` reads `hands@1`, the camera's input use (capture); a film whose
//     strip `clip` plays an H.264 video; a scene whose sky `sky` draws a 360° video background (#503's); a scene whose
//     point set `depth` is drawn from a depth video (#503's); and a figure holding `native`, an item of the test canvas
//     module `test.native`, which no player module set holds (deep-show built with `test-web-lacks`);
//   - one film holding a status binding, a capture control and a video strip at once is refused naming all three, so
//     the export names each and doesn't stop at the first.
// Wrong programs it fails on: the merge base (its `unknown_target` names none of the items); an export that writes a
// bundle, or part of one, for any of these pieces; one that names only the first item it meets; one that refuses
// naming every item of the piece.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { BINDING, VERDICT, statusDoc } from '../169/helpers.ts';
import { cfr30 } from '../499/video/helpers.ts';
import { DEPTH, EQ, backgroundDocument, depthDocument, depthFrame, equirectFrame, grayVideo, stillSky, writeHdr } from '../503/helpers.ts';
import {
  AC, DOC, FULL, LICENSE_OF, TIMEOUT, WEB_LACKS, filesUnder, isObject, none, present, putEvidence, runShow, scenarioOf, show, useShow, useTemp,
  webExport, type JsonObject, type JsonValue,
} from '../172/helpers.ts';

const shows = useShow([FULL, WEB_LACKS]);
const temp = useTemp();

/** The combined film's ID (the first draft's DOC runs to 11). */
const COMBINED = '01JB172D000000000000000012';

/** A document with its layers and each item's layer left out, so it is shown from your shell as yours (#503's
 * documents were written for its agent's layer). */
function unlayered(doc: JsonObject): JsonObject {
  const { layers: _layers, ...rest } = doc;
  const items = isObject(rest['items']) ? rest['items'] : {};
  return { ...rest, items: Object.fromEntries(Object.entries(items).map(([id, item]) => {
    if (!isObject(item)) return [id, item];
    const { layer: _layer, ...kept } = item;
    return [id, kept];
  })) };
}

/** The plain items of every 2D piece here: a camera, a backdrop and an ink band (as #169's pieces have). */
const PLAIN_2D = ['cam', 'back', 'band'];
/** A 2D piece of 320 × 180 over the plain items, with `items` and `extra` laid on. */
function piece2d(id: string, profile: 'figure' | 'film', title: string, items: JsonObject[], extra: JsonObject): JsonObject {
  const base: JsonObject[] = [
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0000cam', params: { projection: 'orthographic', target: [160, 90, 0], view_width: 320 } },
    { id: 'back', kind: 'rect@1', name: 'Backdrop', role: 'decoration', order: 'a0001', params: { box: [0, 0, 320, 180], paint: { fill: { role: 'ground' } } }, at: { pos: [0, 0, 0] } },
    { id: 'band', kind: 'rect@1', name: 'Band', role: 'decoration', order: 'a0002', params: { box: [0, 120, 320, 60], paint: { fill: { role: 'ink' } } }, at: { pos: [0, 0, 0] } },
  ];
  return {
    format: 1, id, profile, title, description: `${title}: a piece the web export must refuse.`, size: [320, 180], camera: 'cam',
    transport: { span: '2s', frame_rate: [30, 1] }, items: Object.fromEntries([...base, ...items].map((i) => [String(i['id']), i])), ...extra,
  };
}

/** Capture (Capture: the camera's one input use, `use: input`, feeds only `hands@1`; Control: device): the device
 * control `wave` of class document reading `hands@1`, with its role, its label naming the device, and its keyboard
 * fallback, the press control `wave_key`. */
const CAPTURE_CONTROLS: JsonObject = {
  wave: { kind: 'device', class: 'document', label: 'Wave at the camera', role: 'button', device: { class: 'hands@1' }, fallback: 'wave_key' },
  wave_key: { kind: 'press', class: 'document', label: 'Wave (key)', role: 'button' },
};
/** A video strip (Strip and track): `clip` plays the whole 60-frame H.264 file from 0 s on track 1, over the frame. */
const clipStrip = (asset: string): JsonObject => ({ clip: { track: 1, src: { asset }, start: '0s', in: 0, out: 2 * 705_600_000, rect: [0, 0, 320, 180] } });
/** #169's status binding, which reads the agent's verdict, on a plate item of this piece. */
const PLATE: JsonObject = { id: 'plate', kind: 'rect@1', name: 'Plate', role: 'part', order: 'a0003', params: { box: [20, 20, 120, 40], paint: { fill: { role: 'accent' } } }, at: { pos: [0, 0, 0] } };

interface Piece {
  what: string;
  /** The build that shows it. */
  set: string;
  evidence: string;
  document: JsonObject;
  /** Shown from the agent's tree (its record holds the verdict a status binding reads). */
  agent?: boolean;
  /** The items the refusal must name, each by one of the names listed (an ID, or a module's name). */
  named: Record<string, string[]>;
  /** The items it must not name. */
  plain: string[];
}

/** Whether a refused entry's `item` names `id`: the ID itself, a path one of whose segments is the ID, or the ID with
 * a version (`test.native@1`). */
function names(item: string, id: string): boolean {
  return item === id || item.split('/').includes(id) || item.startsWith(`${id}@`);
}

/** One run: the piece shown by `deep show`, then its web export into a fresh folder. Each miss is a failure naming the
 * piece. */
function refusalFailures(p: Piece): string[] {
  let bin: string;
  try { bin = shows(p.set); } catch (e) { return [`${p.what}: no deep-show built with features ${p.set}: ${(e as Error).message.slice(0, 1500)}`]; }
  const doc = String(p.document['id']);
  const folder = temp();
  const out = join(folder, 'bundle');
  const [shown, reply] = runShow(bin, scenarioOf({ evidence: p.evidence, docs: [doc], calls: [present(doc, p.document, { agent: p.agent ?? false }), webExport(doc, out)] }), p.what);
  if (shown?.['outcome'] !== 'presented') return [`${p.what}: the piece isn't presented, so its export can't refuse it by name: ${show(shown, 800)}`];
  const f: string[] = [];
  if (reply?.['outcome'] !== 'refused') f.push(`${p.what}: the web export isn't refused: ${show(reply, 800)}`);
  const written = [...filesUnder(folder).keys()];
  if (written.length) f.push(`${p.what}: the refused export wrote ${written.length} file(s) in out's folder, the first ${written.slice(0, 5).join(', ')}`);
  const list: JsonValue | undefined = reply?.['refused'];
  if (!Array.isArray(list)) return [...f, `${p.what}: the reply holds no refused: [{item, why}]: ${show(reply, 800)}`];
  const entries: { item: string; why: string }[] = [];
  for (const e of list) {
    if (!isObject(e) || typeof e['item'] !== 'string' || typeof e['why'] !== 'string' || !e['why']) f.push(`${p.what}: a refused entry isn't {item, why} with a reason: ${show(e, 300)}`);
    else entries.push({ item: e['item'], why: e['why'] });
  }
  for (const [id, accepted] of Object.entries(p.named)) {
    if (!entries.some((e) => accepted.some((n) => names(e.item, n)))) f.push(`${p.what}: the refusal doesn't name ${id}; it names ${show(entries.map((e) => e.item), 400)}`);
  }
  for (const id of p.plain) {
    const hit = entries.find((e) => names(e.item, id));
    if (hit) f.push(`${p.what}: the refusal names ${id}, which the bundle can carry (item ${hit.item}: ${hit.why})`);
  }
  return f;
}

describe(`${AC[2]} each piece the bundle can't carry is refused at export, naming each, with nothing written`, () => {
  it(`${AC[2]} a status binding, a capture, a video strip, a video background, a video point set and a canvas module the player lacks are each refused by the web export, naming it, with nothing written; a piece with three of them names all three`, () => {
    const dir = temp();
    // The status binding: #169's plate, shown from the agent's tree, whose record holds the verdict it reads.
    const pieces: Piece[] = [{
      what: 'the plate with a status binding', set: FULL, evidence: temp(), document: statusDoc(true), agent: true,
      named: { [BINDING]: [BINDING] }, plain: PLAIN_2D,
    }];
    // Capture: the camera's input use, a device control reading hands@1.
    pieces.push({
      what: 'the figure whose control reads the camera', set: FULL, evidence: temp(),
      document: piece2d(DOC.capture, 'figure', 'A wave at the camera', [], { controls: CAPTURE_CONTROLS }),
      named: { wave: ['wave'] }, plain: [...PLAIN_2D, 'wave_key'],
    });
    // A video strip: the 60-frame H.264 file of #499's suite, played on a strip of a film.
    const mp4 = join(dir, 'clip.mp4');
    cfr30(mp4);
    const clipBytes = readFileSync(mp4);
    const stripStore = temp();
    const clip = putEvidence(stripStore, clipBytes);
    pieces.push({
      what: 'the film with a video strip', set: FULL, evidence: stripStore,
      document: piece2d(DOC.strip, 'film', 'A video on a strip', [], { assets: { clip_video: { sha256: clip, license: LICENSE_OF('A test video made by ffmpeg') } }, strips: clipStrip(clip) }),
      named: { clip: ['clip'] }, plain: PLAIN_2D,
    });
    // A 360° video background: #503's scene, its sky's background an equirectangular H.264 video.
    const eq = join(dir, 'eq.mp4');
    grayVideo(eq, [EQ.w, EQ.h], 30, equirectFrame);
    const skyStore = temp();
    const video = putEvidence(skyStore, readFileSync(eq));
    const hdr = writeHdr(dir, [128, 64], stillSky);
    putEvidence(skyStore, readFileSync(hdr.path));
    pieces.push({
      what: 'the scene with a 360° video background', set: FULL, evidence: skyStore,
      document: {
        ...unlayered(backgroundDocument(hdr.sha, video)), id: DOC.background,
        assets: { sky_video: { sha256: video, license: LICENSE_OF('A test video made by ffmpeg') }, sky_hdr: { sha256: hdr.sha, license: LICENSE_OF('A test sky') } },
      },
      named: { sky: ['sky'] }, plain: ['cam', 'white_metal', 'sphere'],
    });
    // A video point set: #503's depth video drawn as the points `depth`.
    const depth = join(dir, 'depth.mp4');
    grayVideo(depth, [DEPTH.w, DEPTH.h], 30, (k) => depthFrame(k));
    const depthStore = temp();
    pieces.push({
      what: 'the scene with a depth video as a point set', set: FULL, evidence: depthStore,
      document: { ...unlayered(depthDocument(putEvidence(depthStore, readFileSync(depth)))), id: DOC.points },
      named: { depth: ['depth'] }, plain: ['cam'],
    });
    // A canvas module the player lacks: test.native, in the build test-web-lacks and in no player module set.
    pieces.push({
      what: 'the figure with an item of test.native', set: WEB_LACKS, evidence: temp(),
      document: piece2d(DOC.native, 'figure', 'A part only the app draws', [
        { id: 'native', kind: 'test.native@1', name: 'Native part', role: 'part', order: 'a0003', params: { box: [40, 40, 60, 40] }, at: { pos: [0, 0, 0] } },
      ], { requires: { modules: { 'test.native': '^1' } } }),
      named: { native: ['native', 'test.native'] }, plain: PLAIN_2D,
    });
    // Three at once: the status binding, the capture control and the video strip in one film, each to be named.
    const combinedStore = temp();
    const combinedClip = putEvidence(combinedStore, clipBytes);
    pieces.push({
      what: 'the film with a status binding, a capture control and a video strip', set: FULL, evidence: combinedStore, agent: true,
      document: piece2d(COMBINED, 'film', 'Three things a bundle cannot carry', [PLATE], {
        status_bindings: { [BINDING]: { target: 'items/plate/params/paint/fill', source: VERDICT } },
        controls: CAPTURE_CONTROLS,
        assets: { clip_video: { sha256: combinedClip, license: LICENSE_OF('A test video made by ffmpeg') } }, strips: clipStrip(combinedClip),
      }),
      named: { [BINDING]: [BINDING], wave: ['wave'], clip: ['clip'] }, plain: [...PLAIN_2D, 'wave_key'],
    });
    none(pieces.flatMap(refusalFailures), 'each piece the bundle can\'t carry is refused by its web export, naming each item, with nothing written');
  }, TIMEOUT);
});
