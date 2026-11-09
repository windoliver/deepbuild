// Criterion 3 (README: Criteria to tests): a slot between two elements draws in order, its rounded corners within one code
// value of the reference, and translucent pixels aren't multiplied twice. Nodes paint `under` (opaque 32 grey), then the
// slot (frost@1 over a uniform backdrop, so its output S is exactly the tint over the grey, opaque), then `above` (opaque
// green). The reference at each pixel of the slot is S × c + 32 × (1 − c), c being GPUI's rounded-rect coverage of the
// pixel (README: Rounded corners); where `above` covers the slot, `above`'s green exactly; around the slot, the grey. The
// planted straight-alpha path blends the slot's premultiplied output by its alpha again, S × c² + 32 × (1 − c), about 52
// code values off where c is near one half: it fails the same check at a translucent pixel.
import { describe, expect, it } from 'vitest';
import { coverage, fixture, pixelsOf, replica, useBuild, within, type Image, type Rect } from './helpers.ts';

const bin = useBuild('replica');
const SLOT_FIXTURE = fixture('slot.json');
const UNDER: Rect = [20, 20, 360, 260];
const SLOT: Rect = [60, 60, 200, 160];
const RADIUS = 24;
const ABOVE: Rect = [200, 100, 160, 80];
const GREY = 32;
const S = 200 + GREY * (1 - 200 / 255);
const inside = (r: Rect, x: number, y: number): boolean => x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3];

function expected(x: number, y: number): number[] {
  if (inside(ABOVE, x, y)) return [0, 160, 0];
  const c = coverage(x, y, SLOT, RADIUS);
  return [0, 1, 2].map(() => S * c + GREY * (1 - c));
}
const translucent = (x: number, y: number): boolean => { const c = coverage(x, y, SLOT, RADIUS); return c > 0 && c < 1 && !inside(ABOVE, x, y); };
const check = (png: Image): string[] => within(png, pixelsOf(UNDER), expected, 1);

describe('#1434 AC3 a slot between two elements draws in order, with rounded corners within one code value of the reference', () => {
  it('AC3 under the slot the grey, the slot over it with its rounded corners, and the green over the slot: every pixel of `under` within one code value', () => {
    let corners = 0;
    for (const [x, y] of pixelsOf(SLOT)) if (translucent(x, y)) corners++;
    expect(corners, 'the slot\'s four corners have translucent pixels to check').toBeGreaterThan(40);
    expect(check(replica(bin(), SLOT_FIXTURE).png), 'the window against the reference').toEqual([]);
  }, 600_000);

  it('AC3 a planted straight-alpha path (DEEP_CHROME_PLANT=straight_alpha_slot) multiplies translucent pixels twice and fails, naming one', () => {
    const findings = check(replica(bin(), SLOT_FIXTURE, { plant: 'straight_alpha_slot' }).png);
    expect(findings.length, 'the planted path fails the same check').toBeGreaterThan(0);
    const named = findings.map((f) => /^pixel \((\d+), (\d+)\)/.exec(f)).filter((m) => m !== null).map((m) => [Number(m[1]), Number(m[2])] as const);
    expect(named.some(([x, y]) => translucent(x, y)), `a finding names a translucent pixel of the slot's edge: ${findings.join('; ')}`).toBe(true);
  }, 600_000);
});
