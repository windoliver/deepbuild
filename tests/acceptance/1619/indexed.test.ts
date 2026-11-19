// #1619.f0d0fbcf: "`convergence_angle` on an indexed look is refused at check, naming the field"
//
// An indexed look (#464: `basis: {indexed: …}`, an 80 × 45 target at scale 4, palette ground, body, trim) whose finish
// is a CRT screen with `convergence: 2, convergence_angle: 90`, over a 320 × 180 document of two blocks: `film2d`
// refuses it before any frame is drawn. The refusal has a `code`, no `frames`, and its `reason` is the field's path
// in the look, `look/finish/0/screen/convergence_angle`, as the base's print refusals name theirs (README: The surface
// under test). The same look with the angle left out is answered with its frame, so the refusal is the field's and
// not the indexed look's or the screen's. Wrong programs: the angle drawn on an indexed basis, leaving the palette; a
// refusal that names the screen, the basis or `convergence`; every indexed look with a screen refused.
import { describe, expect, it } from 'vitest';
import { AC, type JsonObject, doc2d, film2d, frameAt, inconclusive, look2d, pixelHash, rect, requireGpu, runGpu, shown, useGpu, useOut } from './helpers.ts';

const gpu = useGpu();
const out = useOut();
const TARGET: [number, number] = [80, 45];
const SCALE = 4;
const DOC = doc2d('pixel-1619', [TARGET[0] * SCALE, TARGET[1] * SCALE], [rect('body', 'a0', [40, 40, 120, 80], 'body'), rect('trim', 'a1', [200, 60, 80, 80], 'trim')]);
const indexed = (id: string, screen: JsonObject): JsonObject => look2d(id, { body: '#2c3e7b', trim: '#ffd9a0' }, {
  basis: { indexed: { size: TARGET, scale: SCALE, palette: ['ground', 'body', 'trim'], tables: {}, protected: [], snap: 'integer' } },
  finish: [{ screen: { kind: 'crt', ...screen } }],
});
const FIELD = 'look/finish/0/screen/convergence_angle';

describe(`${AC[4]} a convergence angle would leave the palette, so an indexed look can't take it`, () => {
  it(`${AC[4]} convergence_angle on an indexed look is refused at check, naming the field; the same look without it draws`, () => {
    requireGpu();
    const [angled, straight] = runGpu(gpu(), out(), [
      film2d(DOC, indexed('pixel-angled-1619', { convergence: 2, convergence_angle: 90 }), { frames: 1, hash: true }),
      film2d(DOC, indexed('pixel-straight-1619', { convergence: 2 }), { frames: 1, hash: true }),
    ]);
    if (angled!['code'] === 'unsupported_platform') inconclusive('film2d reports unsupported_platform');
    expect(typeof angled!['code'], `the look is refused at check, before any frame is drawn: ${shown(angled)}`).toBe('string');
    expect(angled!['frames'], `no frame is drawn: ${shown(angled)}`).toBeUndefined();
    expect(angled!['reason'], `the refusal names the field by its path in the look: ${shown(angled)}`).toBe(FIELD);
    pixelHash(frameAt(straight!, 0, 'the indexed look without convergence_angle'), 'the indexed look without convergence_angle');
  });
});
