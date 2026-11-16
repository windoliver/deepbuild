// AC2 #172.33b3fb42: "A planted secret value from the app's store and the hub's socket path never appear in the bundle's
// bytes, and a piece with a status binding, a capture, a video strip, a video background or a video point set the
// bundle can't carry, or a canvas module the player lacks is refused at export, naming each"
//
// asserts, through `deep-show run` (README: The surface under test):
//   - with a secret value in the app's store (the scenario's `secrets`, chosen) and the hub's socket path (the
//     scenario's `hub.socket`, chosen), the lab exports, and no file of its bundle holds the secret, its base64 or the
//     socket path, each failure naming the file;
//   - each of six pieces is refused at export, its reply naming the item that can't go, with nothing written: the plate
//     whose fill the status binding `lamp_status` reads (#169's, shown from the agent's tree whose record holds the
//     verdict); a figure whose control `wave` reads the camera through hands@1 (capture, the camera's input use); a
//     film whose strip `clip` plays an H.264 video; #503's scene whose sky draws a 360° video background (`sky`); #503's
//     depth video drawn as the point set `depth`; and a figure holding `native`, an item of the test canvas module
//     `test.native`, which no player module set holds (built with `test-web-lacks`).
// Wrong programs: the merge base, whose refusal (`unknown_target`) names none of these; an export that leaks the store
// or the hub's address into the index page or the player (the file is named).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BINDING, statusDoc } from '../169/helpers.ts';
import { cfr30 } from '../499/video/helpers.ts';
import { DEPTH, EQ, backgroundDocument, depthDocument, depthFrame, equirectFrame, grayVideo, stillSky, writeHdr } from '../503/helpers.ts';
import {
  AC, DOC, FULL, LICENSE_OF, TIMEOUT, WEB_LACKS, exportOnce, filesUnder, isObject, labDoc, labTrack, mentions, none, present, putEvidence, runShow,
  scenarioOf, show, useShow, useTemp, webExport, webReceiptOf, type JsonObject,
} from './helpers.ts';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

/** A document with its layers and each item's layer left out, so it is shown as yours. */
function unlayered(doc: JsonObject): JsonObject {
  const { layers: _layers, ...rest } = doc;
  const items = isObject(rest['items']) ? rest['items'] : {};
  return { ...rest, items: Object.fromEntries(Object.entries(items).map(([id, item]) => {
    if (!isObject(item)) return [id, item];
    const { layer: _layer, ...kept } = item;
    return [id, kept];
  })) };
}

const shows = useShow([FULL, WEB_LACKS]);
const temp = useTemp();

/** A 2D figure of 320 × 180 with a camera, a ground and an ink band, and `items` over them. */
function figure(id: string, title: string, items: JsonObject[], extra: JsonObject): JsonObject {
  const base: JsonObject[] = [
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0000cam', params: { projection: 'orthographic', target: [160, 90, 0], view_width: 320 } },
    { id: 'back', kind: 'rect@1', name: 'Backdrop', role: 'decoration', order: 'a0001', params: { box: [0, 0, 320, 180], paint: { fill: { role: 'ground' } } }, at: { pos: [0, 0, 0] } },
    { id: 'band', kind: 'rect@1', name: 'Band', role: 'decoration', order: 'a0002', params: { box: [0, 120, 320, 60], paint: { fill: { role: 'ink' } } }, at: { pos: [0, 0, 0] } },
  ];
  return {
    format: 1, id, profile: 'figure', title, description: `${title}: a piece the web export must refuse.`, size: [320, 180], camera: 'cam',
    transport: { span: '2s', frame_rate: [30, 1] }, items: Object.fromEntries([...base, ...items].map((i) => [String(i['id']), i])), ...extra,
  };
}

describe(`${AC[2]} no secret or hub address in the bundle, and the pieces a bundle can't carry refused, naming each`, () => {
  it(`${AC[2]} a secret in the app's store and the hub's socket path appear in no file of the lab's bundle`, () => {
    const evidence = temp();
    const secret = `deep172-secret-${randomBytes(16).toString('hex')}`;
    const socket = join(temp(), `hub-${randomBytes(6).toString('hex')}.sock`);
    const out = join(temp(), 'bundle');
    const reply = exportOnce(shows(FULL), evidence, labDoc(evidence), out, 'the lab with a secret in the store', {
      track: labTrack(), scenario: { secrets: { weather_key: secret }, hub: { socket } },
    });
    webReceiptOf(reply, 'the lab with a secret in the store');
    const needles: [string, Buffer][] = [
      ['the secret', Buffer.from(secret, 'utf8')], ['the secret in base64', Buffer.from(Buffer.from(secret, 'utf8').toString('base64'), 'utf8')],
      ['the hub\'s socket path', Buffer.from(socket, 'utf8')],
    ];
    const failures: string[] = [];
    const files = filesUnder(out);
    expect(files.size, 'the bundle holds files').toBeGreaterThan(0);
    for (const [path, bytes] of files) for (const [what, needle] of needles) if (bytes.includes(needle)) failures.push(`${path} holds ${what} at byte ${bytes.indexOf(needle)}`);
    none(failures, 'no file of the bundle holds the secret or the hub\'s socket path');
  }, TIMEOUT);

  it(`${AC[2]} a status binding, a capture, a video strip, a video background, a video point set and a module the player lacks are each refused, naming it, with nothing written`, () => {
    const failures: string[] = [];
    /** One run: the piece shown, then its web export into a fresh folder; it must be presented, refused naming
     * `named`, and leave nothing in the folder. Each miss is a failure naming the piece. */
    const refuse = (bin: string, evidence: string, document: JsonObject, named: string, what: string, agent = false): void => {
      const doc = String(document['id']);
      const out = join(temp(), 'bundle');
      const [shown, reply] = runShow(bin, scenarioOf({ evidence, docs: [doc], calls: [present(doc, document, { agent }), webExport(doc, out)] }), what);
      if (shown?.['outcome'] !== 'presented') failures.push(`${what}: the piece isn't presented, so its export can't refuse it by name: ${show(shown, 600)}`);
      if (reply?.['outcome'] !== 'refused') failures.push(`${what}: the export isn't refused: ${show(reply, 600)}`);
      const written = [...filesUnder(join(out, '..')).keys()];
      if (written.length) failures.push(`${what}: the refused export wrote ${written.slice(0, 5).join(', ')}`);
      if (!mentions(reply, named)) failures.push(`${what}: the refusal doesn't name ${named}: ${show(reply, 800)}`);
    };
    // The status binding: #169's plate, from the agent's tree whose record holds the verdict.
    refuse(shows(FULL), temp(), statusDoc(true), BINDING, 'the plate with a status binding', true);
    // Capture: the camera's input use, a device control reading hands@1 (Capture; Control: device).
    refuse(shows(FULL), temp(), figure(DOC.capture, 'A wave at the camera', [], {
      controls: { wave: { kind: 'device', class: 'document', label: 'Wave', device: { class: 'hands@1' } } },
    }), 'wave', 'the figure whose control reads the camera');
    // A video strip: an H.264 file played on a strip (Strip and track).
    const dir = temp();
    const mp4 = join(dir, 'clip.mp4');
    cfr30(mp4);
    const stripStore = temp();
    const clip = putEvidence(stripStore, readFileSync(mp4));
    refuse(shows(FULL), stripStore, {
      ...figure(DOC.strip, 'A clip on a strip', [], {}), profile: 'film', assets: { clip_video: { sha256: clip, license: LICENSE_OF('A test video made by ffmpeg') } },
      strips: { clip: { track: 1, src: { asset: clip }, start: '0s', in: 0, out: 705_600_000, rect: [0, 0, 320, 180] } },
    }, 'clip', 'the film with a video strip');
    // A 360° video background (#503's scene) and a depth video drawn as points (#503's showpiece), shown from your
    // shell (their layers, written for #503's agent, left out).
    const eq = join(dir, 'eq.mp4');
    grayVideo(eq, [EQ.w, EQ.h], 30, equirectFrame);
    const skyStore = temp();
    const video = putEvidence(skyStore, readFileSync(eq));
    const hdr = writeHdr(dir, [128, 64], stillSky);
    putEvidence(skyStore, readFileSync(hdr.path));
    refuse(shows(FULL), skyStore, {
      ...unlayered(backgroundDocument(hdr.sha, video)), id: DOC.background,
      assets: { sky_video: { sha256: video, license: LICENSE_OF('A test video made by ffmpeg') }, sky_hdr: { sha256: hdr.sha, license: LICENSE_OF('A test sky') } },
    }, 'sky', 'the scene with a 360° video background');
    const depth = join(dir, 'depth.mp4');
    grayVideo(depth, [DEPTH.w, DEPTH.h], 30, (k) => depthFrame(k));
    const depthStore = temp();
    refuse(shows(FULL), depthStore, { ...unlayered(depthDocument(putEvidence(depthStore, readFileSync(depth)))), id: DOC.points }, 'depth', 'the depth video as a point set');
    none(failures, 'each piece the bundle can\'t carry is refused, naming it');
    // A canvas module the player lacks: the test module test.native, in the build test-web-lacks only.
    refuse(shows(WEB_LACKS), temp(), figure(DOC.native, 'A native-only part', [
      { id: 'native', kind: 'test.native@1', name: 'Native part', role: 'part', order: 'a0003', params: { box: [40, 40, 60, 40] }, at: { pos: [0, 0, 0] } },
    ], { requires: { modules: { 'test.native': '^1' } } }), 'native', 'the figure with a test.native item');
    none(failures, 'a piece with a canvas module the player lacks is refused, naming it');
  }, TIMEOUT);
});
