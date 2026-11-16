// #968.dc555b94: "Shown to you: screenshots of the straight 40 m channel and the river with rapids, showing the surface
// flow and foam, taken by the check run from the renderer's own output, with a recording of the water running
// downstream, are attached to the PR and shown to you in the session. Whether they look right is one taste call,
// recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// Three files, from this run's `view3d` frames under a filmic look: `channel.png`, the straight 40 m channel (helpers.ts
// `channelDoc`) in a light breeze with ripples at 0.5 and `flow: {along: "c", speed: 1.5, cycle: 2}`, seen low from
// upstream, at 1.5 s, 1280 × 720, the renderer's final PNG byte for byte; `river.png`, the river with rapids
// (`riverDoc`) with the same breeze and ripples, its flow rising from 0.5 to 3 m/s and `foam: {speed: 2}`, seen from
// above its head looking downstream, at 1.5 s; and `channel-running.apng`, the channel running downstream, 120 frames
// from 1 s at 30 fps (two phase cycles) and 640 × 360, the renderer's final frames as an animated PNG. They are kept
// in DEEPBUILD_EVIDENCE_DIR (else a folder under $TMPDIR), their paths printed for the PR and the session. The taste
// call is a file you record, named by DEEPBUILD_TASTE_968: {"criterion": "#968.dc555b94", "by": "you", "screenshots":
// [sha256 × 3], "call": "looks_right" | "looks_wrong"}. With no record, or one made on other files, the test fails as
// INCONCLUSIVE; looks_wrong fails it. No other test in this suite reads a picture to judge it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, CHANNEL_FLOW, FILMIC, type JsonObject, RIVER_FLOW, type Water, camera, channelDoc, decodePng, encodeApng, evidenceDir, frameAt, framesOf,
  inconclusive, readNamed, requireGpu, riverDoc, runGpu, sha256, useGpu, useOut, view3d, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SHOT: [number, number] = [1280, 720];
const REC: [number, number] = [640, 360];
const AT = 45;
const BREEZE: Water = { waves: { wind: { speed: 1.5, direction: 90 } }, ripples: { strength: 0.5 } };
const CHANNEL_CAM = (): JsonObject => camera([-17, 3.5, 5], [6, 0, -1], 50);

describe(`${AC[4]} one taste call on the renderer's own screenshots and recording`, () => {
  it(`${AC[4]} the straight 40 m channel and the river with rapids, with the recording of the water running downstream, from the renderer's own frames, and the recorded taste call says they look right`, () => {
    requireGpu();
    const dir = out();
    const shot = (name: string, doc: JsonObject) => view3d({ doc: writeJson(dir, name, doc), look: FILMIC, size: SHOT, from: AT, frames: 1, fps: 30, capture: [AT], targets: ['final'] });
    const [channelShot, riverShot, rec] = runGpu(bin(), dir, [
      shot('channel', channelDoc('channel-taste', SHOT, CHANNEL_CAM(), { ...BREEZE, flow: CHANNEL_FLOW })),
      shot('river', riverDoc('river-taste', SHOT, camera([-24, 7, 8], [8, 0, 0], 50), { ...BREEZE, foam: { speed: 2 }, flow: RIVER_FLOW })),
      view3d({
        doc: writeJson(dir, 'rec', channelDoc('channel-running', REC, CHANNEL_CAM(), { ...BREEZE, flow: CHANNEL_FLOW })),
        look: FILMIC, size: REC, from: 30, frames: 120, fps: 30, capture: 'every', targets: ['final'],
      }),
    ]);
    const keep = evidenceDir();
    const kept = (name: string, bytes: Buffer): string => {
      const hash = sha256(bytes); const [base, ext] = name.split('.') as [string, string];
      const file = join(keep, `${base}-${hash}.${ext}`);
      writeFileSync(file, bytes);
      console.log(`for the taste call: ${file}`);
      return hash;
    };
    const final = (r: typeof channelShot, what: string) => readNamed(dir, frameAt(framesOf(r!, what), AT, what).raw['final'], 'png', `${what}'s final PNG`);
    const frames = framesOf(rec!, 'the recording');
    expect(frames.length, 'the recording holds 120 frames').toBe(120);
    const screenshots = [
      kept('channel.png', final(channelShot, 'the straight channel')),
      kept('river.png', final(riverShot, 'the river with rapids')),
      kept('channel-running.apng', encodeApng(frames.map((f) => decodePng(readNamed(dir, f.raw['final'], 'png', `the recording's frame ${f.frame}`))), 30)),
    ];
    const path = process.env['DEEPBUILD_TASTE_968'];
    if (!path || !existsSync(path)) inconclusive(`no taste call is recorded on these screenshots (${screenshots.join(', ')}); record yours in a file named by DEEPBUILD_TASTE_968`);
    const record = JSON.parse(readFileSync(path, 'utf8')) as { criterion?: string; by?: string; screenshots?: string[]; call?: string };
    const same = JSON.stringify([...(record.screenshots ?? [])].sort()) === JSON.stringify([...screenshots].sort());
    if (record.criterion !== AC[4] || record.by !== 'you' || !same) inconclusive(`the recorded taste call at ${path} isn't yours on these screenshots (${screenshots.join(', ')})`);
    expect(record.call, 'your taste call').toBe('looks_right');
  });
});
