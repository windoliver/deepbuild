import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, LOOK, TEXT_BOX, answered, copyFolder, differingPixels, distinctColors, frameDoc, readRender, requireGpu, run, shown, useBin, useOut, type Image, type JsonObject,
} from './helpers.ts';

const bin = useBin();
const out = useOut();

interface Saved { render: Image; frame: string }
function saveFrame(): Saved {
  const frame = join(out(), 'saved', 'frame');
  const reply = answered(run(bin(), out(), [{ call: 'save_frame', doc: frameDoc(), look: LOOK, frame }])[0]!, 'save_frame');
  const render = readRender(out(), reply, 'save_frame');
  expect([render.width, render.height], 'the render is the document\'s size').toEqual([320, 200]);
  expect(distinctColors(render), 'the render is not blank: it holds at least 4 colors').toBeGreaterThanOrEqual(4);
  const panelOnly = [render.rgba[(10 * 320 + 300) * 4], render.rgba[(10 * 320 + 300) * 4 + 1], render.rgba[(10 * 320 + 300) * 4 + 2]];
  let inked = 0;
  for (let y = TEXT_BOX[1]; y < TEXT_BOX[3]; y++) for (let x = TEXT_BOX[0]; x < TEXT_BOX[2]; x++) {
    const o = (y * 320 + x) * 4;
    if (render.rgba[o] !== panelOnly[0] || render.rgba[o + 1] !== panelOnly[1] || render.rgba[o + 2] !== panelOnly[2]) inked++;
  }
  expect(inked, 'the render draws the text: at least 30 pixels of its box differ from the bare panel').toBeGreaterThanOrEqual(30);
  expect(existsSync(join(frame, 'draws.json')), 'the saved frame holds its draw data, draws.json').toBe(true);
  expect(() => JSON.parse(readFileSync(join(frame, 'draws.json'), 'utf8')) as unknown, 'draws.json is JSON').not.toThrow();
  expect(existsSync(join(frame, 'atlas.bin')), 'the saved frame holds its atlas bytes, atlas.bin').toBe(true);
  expect(statSync(join(frame, 'atlas.bin')).size, 'the atlas holds bytes').toBeGreaterThan(0);
  const moved = join(out(), 'moved', 'frame');
  copyFolder(frame, moved);
  rmSync(join(out(), 'saved'), { recursive: true, force: true });
  return { render, frame: moved };
}
function replay(frame: string): JsonObject {
  return run(bin(), out(), [{ call: 'replay_frame', frame }])[0]!;
}

describe(`${AC[3]} a saved frame replayed on the same machine is byte-equal to the original render`, () => {
  it(`${AC[3]} a frame saved as its draw data and atlas bytes, moved to another folder and replayed in a fresh deep-gpu process, is byte-equal to the original render`, () => {
    requireGpu();
    const saved = saveFrame();
    const replayed = readRender(out(), answered(replay(saved.frame), 'replay_frame'), 'replay_frame');
    expect([replayed.width, replayed.height], 'the replay is the original\'s size').toEqual([saved.render.width, saved.render.height]);
    expect(differingPixels(saved.render, replayed), 'pixels where the replay differs from the original render').toBe(0);
    expect(Buffer.from(replayed.rgba).equals(Buffer.from(saved.render.rgba)), 'the replay\'s RGBA bytes equal the original render\'s').toBe(true);
  }, 7_200_000);

  it(`${AC[3]} the replay draws the text from the saved atlas bytes with no shaping: with the atlas bytes zeroed, the replay's text box differs from the original, or the replay refuses the frame naming its atlas`, () => {
    requireGpu();
    const saved = saveFrame();
    const atlas = join(saved.frame, 'atlas.bin');
    writeFileSync(atlas, Buffer.alloc(statSync(atlas).size));
    const reply = replay(saved.frame);
    if (typeof reply['code'] === 'string') {
      expect(JSON.stringify(reply), `the refusal of a frame with zeroed atlas bytes names its atlas: ${shown(reply)}`).toMatch(/atlas/);
      return;
    }
    const replayed = readRender(out(), reply, 'replay_frame with zeroed atlas bytes');
    expect(differingPixels(saved.render, replayed, TEXT_BOX), 'pixels of the text box the replay with zeroed atlas bytes draws unlike the original').toBeGreaterThan(0);
  }, 7_200_000);
});
