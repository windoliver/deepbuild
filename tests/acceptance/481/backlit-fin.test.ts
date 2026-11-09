// AC3 #481.9afd6b06: A fin backlit by the key light lets light through by exp(−d ÷ radius) within 5% at 2 mm and at
// 6 mm of thickness.
//
// The fin (helpers.ts: finDoc): a 20 cm square slab facing the camera 1 m in front, white, no specular, `subsurface:
// {weight: 1, radius: [12, 8, 5] mm, thin: true}`, under a black sky with no ambient; the key light is the one sun,
// shadowed, π lx, shining along +Z through the fin toward the camera, so the face the camera sees gets no light of its
// own and every pixel of it shows only the light through the fin. The fin fills the 256 × 256 frame; judged: the
// central 128 × 128 pixels, all the fin's in the ID target, averaged per channel.
//
// Transmission is isolated by a ratio against the same fin at 0.1 mm, the unoccluded reference: the light through a fin
// of thickness d ÷ the light through the 0.1 mm fin, per channel, against exp(−(d − 0.1 mm) ÷ radius) (README:
// Readings). Every factor but the thickness (the light, the lobe's color and cosine, its weight) is the same in both and
// cancels, and so does an offset the shadow map's bias adds to every measured thickness alike. Each of the three
// channels, each at its own radius, at 2 mm and at 6 mm, within 5% of the expected ratio (0.854, 0.789, 0.684 at
// 2 mm; 0.612, 0.478, 0.307 at 6 mm). The 0.1 mm fin must let through at least 0.01 in every channel, or the ratios
// mean nothing.
import { describe, expect, it } from 'vitest';
import { AC, FIN_RADIUS, FIN_SIZE, draw, finDoc, none, requireMetal, useDir, useGpu, type Drawn, type Rgb } from './helpers.ts';

const ID = AC[3];
const bin = useGpu();
const dir = useDir();
const REF = 0.0001;
const CHANNELS = ['red', 'green', 'blue'] as const;

function centre(d: Drawn): Rgb {
  const s: Rgb = [0, 0, 0]; let n = 0;
  const [w, h] = FIN_SIZE;
  for (let y = h / 4; y < (3 * h) / 4; y++) for (let x = w / 4; x < (3 * w) / 4; x++) {
    expect(d.ids.at(x, y), `${d.name}: the fin covers (${x}, ${y})`).toBe('fin');
    const c = d.linear.at(x, y); for (let k = 0; k < 3; k++) s[k] = s[k]! + c[k]!; n++;
  }
  return s.map((v) => v / n) as Rgb;
}

describe(`${ID} light through a thin fin by its thickness`, () => {
  it(`${ID} a fin backlit by the key light lets light through by exp(−d ÷ radius) within 5% at 2 mm and 6 mm, in each channel at its own radius`, () => {
    requireMetal();
    const [ref, two, six] = draw(bin(), dir(), [
      { name: 'fin-0.1mm', doc: finDoc('ref', REF) }, { name: 'fin-2mm', doc: finDoc('2mm', 0.002) }, { name: 'fin-6mm', doc: finDoc('6mm', 0.006) },
    ]).map((d) => ({ d, mean: centre(d) }));
    console.log(`${ID}: light through the fins at 0.1, 2 and 6 mm: ${[ref!, two!, six!].map((f) => `[${f.mean.map((v) => v.toFixed(5)).join(', ')}]`).join(', ')}`);
    const failures: string[] = [];
    CHANNELS.forEach((c, k) => { if (!(ref!.mean[k]! >= 0.01)) failures.push(`fin-0.1mm: lets through ${ref!.mean[k]!.toFixed(5)} in ${c}, under 0.01: no light through the fin to compare`); });
    for (const [f, d] of [[two!, 0.002], [six!, 0.006]] as const) {
      CHANNELS.forEach((c, k) => {
        const want = Math.exp(-(d - REF) / FIN_RADIUS[k]!);
        const got = f.mean[k]! / ref!.mean[k]!;
        if (!(Math.abs(got / want - 1) <= 0.05)) failures.push(`${f.d.name}: ${c} lets through ${got.toFixed(4)} of the 0.1 mm fin's, not exp(−${((d - REF) * 1000).toFixed(1)} mm ÷ ${(FIN_RADIUS[k]! * 1000).toFixed(0)} mm) = ${want.toFixed(4)} within 5%`);
      });
    }
    none(failures, 'the light through the fins against exp(−d ÷ radius)');
  }, 3_600_000);
});
