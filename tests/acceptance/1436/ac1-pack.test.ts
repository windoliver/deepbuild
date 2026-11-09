// Criterion 1 (README: Criteria to tests): "All 24 operators pass the pack check and render in the gallery in light and
// dark. Each has a fixture and a planted twin that fails it, naming the operator."
// The pack check of the shipped pack (`deep-replica --chrome-fx-check packs/chrome-fx-1.0.0`) passes, listing exactly
// the issue's 24 operators, each with its class, a measured cost, its still pose and its fixture passing. The gallery
// panel, drawn by the replica in light and in dark, lists every operator with its class, cost and still pose, and draws
// each one's tile (not one flat color, and not the same pixels in both appearances). Then, once per operator, the check
// is run with that operator swapped for its planted twin (DEEP_CHROME_PLANT=twin:<operator>): it fails, its one
// refusal naming that operator's failed fixture.
import { describe, expect, it } from 'vitest';
import { AC, APPEARANCES, OPERATORS, flat, gallery, packCheck, region, useBuild, useShipped, type Rect, type Tile } from './helpers.ts';

const bin = useBuild('replica');
const shipped = useShipped(bin);

describe(`#1436 AC1 ${AC[1]} all 24 operators pass the pack check and render in the gallery in light and dark`, () => {
  it('AC1 the shipped pack passes its check, with each of the 24 operators\' class, measured cost, still pose and fixture', () => {
    const check = shipped();
    expect(check.operators.map((o) => o.operator).sort(), 'the pack\'s operators are the issue\'s 24').toEqual([...OPERATORS].sort());
    for (const o of check.operators) {
      expect(['quiet', 'expressive'], `${o.operator}'s class`).toContain(o.class);
      expect(Number.isFinite(o.cost_ms) && o.cost_ms > 0, `${o.operator} has a measured cost: ${String(o.cost_ms)}`).toBe(true);
      expect(o.still, `${o.operator} has an authored still pose`).toBe(true);
      expect(o.fixture, `${o.operator}'s fixture`).toBe('pass');
    }
    expect(check.refusals, 'nothing is refused').toEqual([]);
  }, 3_600_000);

  it('AC1 the gallery lists every operator with its class, cost and still pose, and draws each in light and in dark', () => {
    const classes = new Map(shipped().operators.map((o) => [o.operator, o.class]));
    const drawn = APPEARANCES.map((a) => ({ a, ...gallery(bin(), a) }));
    const tileOf = new Map<string, Tile[]>();
    for (const { a, png, report, tiles } of drawn) {
      expect(report['appearance'], 'gallery.json names its appearance').toBe(a);
      expect(tiles.map((t) => t.operator).sort(), `${a}: the gallery lists the 24 operators`).toEqual([...OPERATORS].sort());
      for (const t of tiles) {
        expect(t.class, `${a}: ${t.operator}'s class is the pack's`).toBe(classes.get(t.operator));
        expect(Number.isFinite(t.cost_ms) && t.cost_ms > 0, `${a}: ${t.operator} shows a cost`).toBe(true);
        expect(t.still, `${a}: ${t.operator} shows its still pose`).toBe(true);
        const [x, y, w, h] = t.rect;
        expect(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= png.width && y + h <= png.height, `${a}: ${t.operator}'s tile ${JSON.stringify(t.rect)} is inside the ${png.width} × ${png.height} gallery`).toBe(true);
        expect(flat(png, t.rect), `${a}: ${t.operator}'s tile draws something`).toBe(false);
        tileOf.set(t.operator, [...(tileOf.get(t.operator) ?? []), t]);
      }
    }
    const [light, dark] = drawn;
    for (const op of OPERATORS) {
      const [l, d] = tileOf.get(op)!;
      const same = (l!.rect as Rect).join() === (d!.rect as Rect).join() && region(light!.png, l!.rect).equals(region(dark!.png, d!.rect));
      expect(same, `${op}'s tile is drawn in each appearance, not the same pixels in both`).toBe(false);
    }
  }, 3_600_000);

  it.each(OPERATORS.map((op) => [op]))('AC1 %s\'s planted twin (DEEP_CHROME_PLANT=twin:<operator>) fails its fixture, and the check names the operator', (op) => {
    const check = packCheck(bin(), undefined, `twin:${op}`);
    expect(check.status, `the check with ${op}'s twin fails: ${JSON.stringify(check.refusals).slice(0, 600)}`).toBe(1);
    const named = check.refusals.filter((r) => r['operator'] === op && r['code'] === 'chrome_fx_fixture_failed');
    expect(named.length, `a refusal names ${op}'s failed fixture: ${JSON.stringify(check.refusals)}`).toBeGreaterThan(0);
    expect(check.refusals.filter((r) => r['operator'] !== op), 'no other operator is refused').toEqual([]);
    expect(check.operators.find((o) => o.operator === op)?.fixture, `${op}'s fixture`).toBe('fail');
  }, 3_600_000);
});
