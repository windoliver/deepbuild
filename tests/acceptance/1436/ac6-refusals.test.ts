// Criterion 6 (README: Criteria to tests): "An `expressive` effect in a working view with no look or panel that asked is
// refused, naming the effect and the view. One on a status mark, the card or a prompt is refused, naming the role."
// Both planted cases are input. In the session page (a working view), the pack's first expressive operator three times,
// once asked for by nobody, once by a look you picked and once by a panel you picked, and its first quiet operator once:
// only the unasked one is refused, naming the effect and the view, and it draws nowhere (its rect is byte-equal to the
// window drawn without it), while the one a look asked for draws. Then the quiet operator set on a status mark, the
// question card and a prompt, and on the raised ground: the first three are refused, each naming its role, and draw
// nowhere; the one on the raised ground isn't refused.
import { describe, expect, it } from 'vitest';
import { AC, FIXED_ROLES, firstOfClass, inView, onRoles, region, replica, useBuild, useShipped, type Obj, type Rect } from './helpers.ts';

const bin = useBuild('replica');
const shipped = useShipped(bin);
const rectOf = (fx: Obj, id: string): Rect => (fx['nodes'] as Obj[]).find((n) => n['id'] === id)!['rect'] as Rect;
const refusalsOf = (refusals: Obj[], id: string): Obj[] => refusals.filter((r) => r['effect'] === id);

describe(`#1436 AC6 ${AC[6]} expressive effects run only where asked, and nothing sits on a status mark, the card or a prompt`, () => {
  it('AC6 an expressive effect in the session page that no look or panel asked for is refused, naming the effect and the view', () => {
    const check = shipped();
    const expressive = firstOfClass(check, 'expressive');
    const fx = inView(expressive, firstOfClass(check, 'quiet'));
    const drawn = replica(bin(), fx, { at: [1] });
    const refused = refusalsOf(drawn.refusals, 'unasked');
    expect(refused.length, `the unasked effect is refused: ${JSON.stringify(drawn.refusals)}`).toBe(1);
    expect(refused[0], 'naming the effect and the view').toMatchObject({ effect: 'unasked', operator: expressive, view: 'session', code: 'chrome_fx_expressive_unasked' });
    for (const id of ['by-look', 'by-panel', 'quiet']) expect(refusalsOf(drawn.refusals, id), `${id} is not refused`).toEqual([]);
    const without = replica(bin(), fx, { at: [1], omitEffect: ['unasked', 'by-look'] });
    expect(region(drawn.pngs[0]!, rectOf(fx, 'unasked')).equals(region(without.pngs[0]!, rectOf(fx, 'unasked'))), 'the refused effect draws nowhere').toBe(true);
    expect(region(drawn.pngs[0]!, rectOf(fx, 'by-look')).equals(region(without.pngs[0]!, rectOf(fx, 'by-look'))), 'the effect a look asked for draws').toBe(false);
  }, 3_600_000);

  it('AC6 an effect on a status mark, the question card or a prompt is refused, naming the role', () => {
    const fx = onRoles(firstOfClass(shipped(), 'quiet'));
    const drawn = replica(bin(), fx, { at: [1] });
    const ids = FIXED_ROLES.map((r) => `on-${r}`);
    const without = replica(bin(), fx, { at: [1], omitEffect: ids });
    for (const role of FIXED_ROLES) {
      const id = `on-${role}`;
      const refused = refusalsOf(drawn.refusals, id);
      expect(refused.length, `the effect on ${role} is refused: ${JSON.stringify(drawn.refusals)}`).toBe(1);
      expect(refused[0], 'naming the role').toMatchObject({ effect: id, role, code: 'chrome_fx_fixed_role' });
      expect(region(drawn.pngs[0]!, rectOf(fx, id)).equals(region(without.pngs[0]!, rectOf(fx, id))), `the effect on ${role} draws nowhere`).toBe(true);
    }
    expect(refusalsOf(drawn.refusals, 'on-raised'), 'an effect on the raised ground is not refused').toEqual([]);
  }, 3_600_000);
});
