// Criterion 1 (README: Criteria to tests): two overlapping quads in a 50% layer. Inside the layer the blue quad covers the
// red one, so the group's overlap is opaque blue, and the group composited once at 0.5 over the white window is
// 0.5 × (0, 0, 255) + 0.5 × (255, 255, 255) = (127.5, 127.5, 255) at every pixel of the overlap, within one code value
// for the rounding. The planted renderer multiplies 0.5 into each quad's paint, as GPUI's own opacity does, so the overlap
// reads blue at 0.5 over red at 0.5 over white, about (128, 64, 191): the same check fails, naming the pixel.
import { describe, expect, it } from 'vitest';
import { fixture, pixelsOf, replica, useBuild, within, type Rect } from './helpers.ts';

const bin = useBuild('replica');
const GROUP = fixture('group.json');
// red [60, 60, 180, 140] ∩ blue [160, 100, 180, 120], at scale 1.
const OVERLAP: Rect = [160, 100, 80, 100];
const GROUP_COLOR = [127.5, 127.5, 255];
const check = (png: Parameters<typeof within>[0]): string[] => within(png, pixelsOf(OVERLAP), () => GROUP_COLOR, 1);

describe('#1434 AC1 two overlapping quads in a 50% layer: every pixel of the overlap equals the composite of the group', () => {
  it('AC1 every pixel of the overlap is the group composited once at 0.5 over the window, within one code value', () => {
    const { png } = replica(bin(), GROUP);
    expect(check(png), 'the overlap against the group\'s composite').toEqual([]);
  }, 600_000);

  it('AC1 a planted renderer that multiplies 0.5 per element (DEEP_CHROME_PLANT=multiplies_per_element) fails, naming the pixel', () => {
    const { png } = replica(bin(), GROUP, { plant: 'multiplies_per_element' });
    const findings = check(png);
    expect(findings.length, 'the planted renderer fails the same check').toBeGreaterThan(0);
    expect(findings[0], 'the failure names a pixel of the overlap').toMatch(/^pixel \((1[6-9]\d|2[0-3]\d), (1\d\d)\): got /);
  }, 600_000);
});
