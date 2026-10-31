// #882 AC1's wrong guards: `deep-canvas-render look` played in JavaScript, over the fixture look with chrome roles
// (../fixtures/look-chrome.json as "clean"), each with one fault switched on. `guard({})` is the control.
import { readFileSync } from 'node:fs';
import { FLOORS, contrast, nearestStatus, over, parseColor } from '../common.mjs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/look-chrome.json', import.meta.url), 'utf8'));
const DATA_ROLES = ['ink', 'muted', 'accent'];

/** Each theme's roles as colors: the look's palette and roles with the theme's own over them. */
function resolve(def) {
  const out = {};
  for (const theme of ['light', 'dark']) {
    const palette = { ...def.palette, ...def.themes?.[theme]?.palette };
    const roles = { ...def.roles, ...def.themes?.[theme]?.roles };
    out[theme] = Object.fromEntries(Object.entries(roles).map(([role, name]) => [role, palette[name]]));
  }
  return out;
}

/**
 * A guard with faults: `noRoles` (the base's answer, no roles), `dataOnly` (checks data roles only), `lightOnly`,
 * `noDistance` (a refusal without the distance), `noContrast`, `refuseAll`.
 */
export function guard(faults) {
  const answer = (def) => {
    if (faults.refuseAll) return { ok: false, code: 'status_distance', theme: 'light', role: 'ground', state: 'idle', distance: 0 };
    const roles = resolve(def);
    for (const theme of faults.lightOnly ? ['light'] : ['light', 'dark']) {
      const got = roles[theme];
      const ground = parseColor(got.ground);
      for (const [role, text] of Object.entries(got)) {
        if (role === 'ground' || (faults.dataOnly && !DATA_ROLES.includes(role))) continue;
        const c = parseColor(text);
        if (!c) return { ok: false, code: 'bad_look', path: `roles/${role}` };
        const [state, d] = nearestStatus(over(c, ground.rgb));
        if (d < 0.1) return { ok: false, code: 'status_distance', theme, role, state, ...(faults.noDistance ? {} : { distance: Number(d.toFixed(3)) }) };
      }
      if (faults.noContrast || faults.dataOnly) continue;
      const surfaces = ['ground', 'raised'].map((r) => parseColor(got[r]).rgb);
      surfaces.push(...surfaces.map((s) => over(parseColor(got.hover), s)));
      for (const [tier, floor] of Object.entries(FLOORS)) {
        for (const s of surfaces) {
          if (contrast(over(parseColor(got[tier]), s), s) < floor) return { ok: false, code: 'chrome_contrast', theme, role: tier };
        }
      }
    }
    return faults.noRoles ? { ok: true, look: def } : { ok: true, look: def, roles };
  };
  return (inputs) => inputs.map(({ look }) => answer(look === 'clean' ? fixture : look));
}

