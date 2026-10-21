import { describe, expect, it } from 'vitest';
import { blob, fixture, isColor, pixel, render, rowIs, rows, sha256, useBinary } from './helpers.ts';
import type { JsonObject } from './helpers.ts';

const FILM = fixture('film.json');
const SCENE = fixture('scene.json');

/** The look's ground, as the render surface takes it: a color no fixture item uses. */
const GROUND: [number, number, number] = [17, 34, 51];

useBinary();

function fillOf(doc: JsonObject, id: string): number[] {
  const items = doc['items'] as { [id: string]: { params: { fill: number[] } } };
  return items[id]!.params.fill;
}

describe('AC3 a document\'s fixed frame in a panel of another shape: films letterbox, 3D documents with extend widen the view', () => {
  it('AC3 a 1920x1080 film in a 1200x1200 panel draws a 1200x675 picture centred between bars in the look\'s ground, equal by pixel hash to a 1200x675 snapshot', () => {
    const panel = render(FILM, [1200, 1200], GROUND);
    const snap = render(FILM, [1200, 675], GROUND);

    // The bars: whole rows in the look's ground above and below. A letterbox that stretches the film to the
    // panel, or crops it to fill, leaves no such rows.
    let top = 0;
    while (top < panel.height && rowIs(panel, top, GROUND)) top++;
    let bottom = 0;
    while (bottom < panel.height && rowIs(panel, panel.height - 1 - bottom, GROUND)) bottom++;
    expect([262, 263], `the top bar is 262 or 263 rows of the look's ground, found ${top}; first pixel below it ${JSON.stringify(pixel(panel, 0, Math.min(top, panel.height - 1)))}`).toContain(top);
    expect(top + bottom, `the picture between the bars is 675 rows tall (bars ${top} + ${bottom})`).toBe(1200 - 675);

    // The picture is the film scaled by 0.625, with nothing cropped: its corner markers, both blocks and the backdrop.
    const picture = rows(panel, top, 675);
    const samples: [string, number, number, number[]][] = [
      ['top left marker', 20, 20, fillOf(FILM, 'tl')],
      ['top right marker', 1180, 20, fillOf(FILM, 'tr')],
      ['bottom left marker', 20, 655, fillOf(FILM, 'bl')],
      ['bottom right marker', 1180, 655, fillOf(FILM, 'br')],
      ['red block', 500, 282, fillOf(FILM, 'red')],
      ['green block', 900, 475, fillOf(FILM, 'green')],
      ['backdrop', 600, 100, fillOf(FILM, 'backdrop')],
      ['backdrop', 100, 337, fillOf(FILM, 'backdrop')],
    ];
    for (const [what, x, y, rgb] of samples) {
      expect(isColor(picture, x, y, rgb), `panel picture (${x}, ${y}) shows the ${what} ${JSON.stringify(rgb)}, found ${JSON.stringify(pixel(picture, x, y))}`).toBe(true);
      expect(isColor(snap, x, y, rgb), `1200x675 snapshot (${x}, ${y}) shows the ${what} ${JSON.stringify(rgb)}, found ${JSON.stringify(pixel(snap, x, y))}`).toBe(true);
    }

    // Equal by pixel hash to the 1200x675 render of the same frame, on this machine.
    expect(sha256(picture.rgba), 'the panel\'s picture between the bars equals the 1200x675 snapshot by pixel hash').toBe(sha256(snap.rgba));
  });

  it('AC3 a 3D document with extend in a 1200x1200 panel keeps its kept items where they are at 16:9 within 0.5 px, shows more above and below, and crops nothing', () => {
    const wide = render(SCENE, [1920, 1080], GROUND);
    const square = render(SCENE, [1200, 1200], GROUND);
    const scale = 1200 / 1920;

    // The kept items: the dots the 16:9 frame shows, its four corners among them.
    for (const id of ['a', 'b', 'c', 'tl', 'tr', 'bl', 'br']) {
      const rgb = fillOf(SCENE, id);
      const at16 = blob(wide, rgb);
      const at11 = blob(square, rgb);
      expect(at16.count, `${id}: drawn in the 16:9 frame`).toBeGreaterThan(100);
      // Projected centres: the frame's centre sits at the panel's centre and the frame scales by 1200/1920.
      const wantX = 600 + (at16.cx - 960) * scale;
      const wantY = 600 + (at16.cy - 540) * scale;
      const off = Math.hypot(at11.cx - wantX, at11.cy - wantY);
      // A view that crops to fill the panel, stretches, or narrows the horizontal view lands elsewhere.
      expect(off <= 0.5, `${id}: projected centre in the panel (${at11.cx}, ${at11.cy}) is ${off} px from its 16:9 place scaled (${wantX}, ${wantY})`).toBe(true);
      // Nothing of the frame cropped: the whole dot shows, at the scaled size.
      const ratio = at11.count / (at16.count * scale * scale);
      expect(ratio > 0.85 && ratio < 1.15, `${id}: ${at11.count} px in the panel against ${at16.count} px at 16:9 scaled by ${scale}² (ratio ${ratio}); the dot is not at the frame's scale: part of the frame is cropped, or the view is scaled to fill`).toBe(true);
    }

    // More view above and below: the sky and floor dots lie outside the 16:9 view and show in the panel,
    // in the bands a letterbox would fill with bars.
    const band = (1200 - 1080 * scale) / 2;
    for (const [id, above] of [['sky', true], ['floor', false]] as const) {
      const rgb = fillOf(SCENE, id);
      expect(blob(wide, rgb).count, `${id}: outside the 16:9 view`).toBe(0);
      const at11 = blob(square, rgb);
      expect(at11.count, `${id}: the panel shows more view ${above ? 'above' : 'below'} the 16:9 frame (a letterboxed or cropped 3D frame doesn't draw it)`).toBeGreaterThan(100);
      if (above) expect(at11.cy, `${id}: drawn above the 16:9 frame's top edge in the panel (y < ${band})`).toBeLessThan(band);
      else expect(at11.cy, `${id}: drawn below the 16:9 frame's bottom edge in the panel (y > ${1200 - band})`).toBeGreaterThan(1200 - band);
    }
  });
});

