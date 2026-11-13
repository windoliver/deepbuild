// AC3: every ink role of the clean look but `ink_disabled` clears 4.5:1 on every fill a row can be drawn on, in light and
// dark, computed here from the roles the look's guard resolves (`deep-canvas-render look`, as #1003's suite asks it);
// and the guard refuses the clean look with `ink_tertiary` planted at 3.5:1, naming the role and the fill (README,
// Pinned 6). The contrast table for every pair is printed: the issue's Proof.
import { afterAll, describe, expect, it } from 'vitest';
import { AC, INK_FLOOR, MINUTES, SURFACES, cleanup, contrast, lookGuard, onSurface, parseColor, surfaces } from './helpers.ts';

afterAll(cleanup, 60_000);

describe('#1458 every ink clears 4.5:1', () => {
  it(`${AC.contrast}: every ink role but ink_disabled clears 4.5:1 on every fill in light and dark, and a planted ink_tertiary at 3.5:1 fails, naming the pair`, async () => {
    const [clean] = await lookGuard([{ look: 'clean' }]);
    expect(clean?.ok, `the look's guard passes the clean look: ${JSON.stringify(clean).slice(0, 400)}`).toBe(true);
    const PLANTED = { light: '#1b1d2285', dark: String(clean!.roles?.dark?.ink_secondary) } as const;
    const table: string[] = [];
    const failures: string[] = [];
    for (const theme of ['light', 'dark'] as const) {
      const roles = clean!.roles?.[theme] as Record<string, string> | undefined;
      const fills = surfaces(roles ?? {});
      expect(fills.map(([name]) => name), `the clean look's ${theme} theme gives every fill a row can be drawn on`).toEqual([...SURFACES]);
      for (const role of Object.keys(roles!).filter((r) => /^ink(_|$)/.test(r) && r !== 'ink_disabled').sort()) {
        const color = parseColor(roles![role]);
        if (!color) { failures.push(`${theme} ${role} isn't a color: ${roles![role]}`); continue; }
        for (const [fill, rgb] of fills) {
          const ratio = contrast(onSurface(color, rgb), rgb);
          table.push(`${theme.padEnd(5)}  ${role.padEnd(14)}  ${fill.padEnd(20)}  ${ratio.toFixed(2)}:1`);
          if (ratio < INK_FLOOR) failures.push(`${theme} ${role} on ${fill}: ${ratio.toFixed(2)}:1, under ${INK_FLOOR}:1`);
        }
      }
    }
    console.log(`AC3: the contrast table\n${table.join('\n')}`);
    expect.soft(failures, 'every ink role but ink_disabled on every fill, light and dark').toEqual([]);

    // The plant: the clean look with ink_tertiary at 3.5:1 in light, as the base ships it, and in dark the color the clean
    // look resolves for its dark secondary ink, which passes every rule, so the one refusal left is the light pair's.
    const look = structuredClone(clean!.look) as Record<string, any>;
    look.palette = { ...look.palette, planted_tertiary_light: PLANTED.light, planted_tertiary_dark: PLANTED.dark };
    look.roles = { ...look.roles, ink_tertiary: 'planted_tertiary_light' };
    look.themes = { ...look.themes, dark: { ...look.themes?.dark, roles: { ...look.themes?.dark?.roles, ink_tertiary: 'planted_tertiary_dark' } } };
    const [refused] = await lookGuard([{ look }]);
    const pair = `${String(refused?.role)} on ${String(refused?.on)}`;
    expect(refused?.ok, `the look's guard refuses ink_tertiary at 3.5:1: ${JSON.stringify(refused).slice(0, 400)}`).toBe(false);
    expect(refused?.code, `the refusal is the ink floor's: ${JSON.stringify(refused).slice(0, 400)}`).toBe('ink_contrast');
    expect(refused?.role, `the refusal names the role: ${pair}`).toBe('ink_tertiary');
    expect(SURFACES as readonly string[], `the refusal names a fill: ${pair}`).toContain(refused?.on);
    expect(Number(refused?.ratio), `the refusal's ratio: ${JSON.stringify(refused)}`).toBeLessThan(INK_FLOOR);
  }, 30 * MINUTES);
});
