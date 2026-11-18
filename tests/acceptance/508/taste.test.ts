// AC5: "Shown to you: screenshots of the plume with haze in front of a checkerboard, the turbofan fixture and the
// image-layer explainer fixture, taken by the check run from the canvas's own frames, with a recording of the plume
// haze, are attached to the PR and shown to you in the session. Whether they look right is one taste call, recorded;
// without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// One `deep-gpu run` draws, keeping each frame's final PNG byte for byte: the plume with haze in front of the
// checkerboard over frames 0 to 90 at 30 fps (helpers.ts: hazeDoc), the turbofan fixture and the image-layer explainer
// fixture each at 2 s (frame 60 at 30 fps), in their own looks. It writes `plume-haze.png` (frame 45), `turbofan.png`,
// `image-layers.png` and `plume-haze.apng` (the plume's 91 frames at 30 fps put into one animated PNG unchanged, #449's
// apng) to `docs/evidence/508/`, each with its SHA-256 printed. Then it reads `tests/acceptance/508/TASTE.json`: with
// none, or one made on other bytes, it is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these passes.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, HAZE, PLAIN_LOOK, REPO, SHA, TIMEOUT, ac, apng, asSession, assetPaths, drawnOf, fixture, hazeDoc, inconclusive, lookOf, readNamed,
  requireGpu, runGpu, sha256, show, useBins, useDir, view3d, writeJson, type Frame, type JsonValue,
} from './helpers.ts';

const bin = useBins();
const dir = useDir();
const SHOTS = join(REPO, 'docs', 'evidence', '508');
const TASTE = join(REPO, 'tests', 'acceptance', '508', 'TASTE.json');
const SCREENSHOTS = ['plume-haze.png', 'turbofan.png', 'image-layers.png'] as const;
const RECORDINGS = ['plume-haze.apng'] as const;

describe(`${ac(5)} the screenshots and the recording, and the one taste call on them`, () => {
  it(`${ac(5)} the run writes the plume with haze in front of a checkerboard, the turbofan and the image-layer explainer, and a recording of the plume haze, from the canvas's own frames, and the recorded call on exactly those says they look right`, () => {
    requireGpu();
    const out = dir();
    const fan = fixture('turbofan'); const layers = fixture('image-layers');
    const at2s = { fps: 30, from: 60, frames: 1, capture: [60] };
    const replies = runGpu(bin('deep-gpu'), out, [
      view3d({ doc: writeJson(out, 'plume', hazeDoc('haze')), look: PLAIN_LOOK, size: HAZE.size, fps: HAZE.fps, frames: HAZE.last + 1, capture: 'every' }),
      view3d({ doc: writeJson(out, 'turbofan', asSession(fan.document)), look: lookOf(fan), size: fan.size, assets: assetPaths(fan), ...at2s }),
      view3d({ doc: writeJson(out, 'layers', asSession(layers.document)), look: lookOf(layers), size: layers.size, assets: assetPaths(layers), ...at2s }),
    ]);
    const png = (f: Frame | undefined, what: string): Buffer => {
      expect(f?.final, `${what}: the renderer's final PNG, named by its SHA-256`).toMatch(SHA);
      return readNamed(out, f!.final, 'png', what);
    };
    const plume = drawnOf(replies[0]!, 'the plume with haze').frames;
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    const keep = (name: string, bytes: Buffer): void => { writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes); };
    keep('plume-haze.png', png(plume.find((f) => f.frame === HAZE.still), 'plume-haze.png'));
    keep('turbofan.png', png(drawnOf(replies[1]!, 'turbofan.png').frames[0], 'turbofan.png'));
    keep('image-layers.png', png(drawnOf(replies[2]!, 'image-layers.png').frames[0], 'image-layers.png'));
    keep('plume-haze.apng', apng(plume.map((f) => png(f, `plume-haze.apng: frame ${f.frame}`)), HAZE.fps, 'plume-haze.apng'));
    const listed = [...SCREENSHOTS, ...RECORDINGS].map((n) => `  ${join('docs', 'evidence', '508', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ac(5)}: written from this run's frames:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/508/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(508);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(CRITERIA[5]);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = { ...(c['screenshots'] as Record<string, JsonValue> | undefined ?? {}), ...(c['recordings'] as Record<string, JsonValue> | undefined ?? {}) };
    expect(Object.keys(recorded).sort(), `TASTE.json names the three screenshots and the recording: ${show(recorded)}`).toEqual([...SCREENSHOTS, ...RECORDINGS].sort());
    const other = Object.keys(hashes).filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other bytes than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
  }, TIMEOUT);
});
