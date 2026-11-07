// #1003's wrong guards: the README's guard played in JavaScript over look definitions, each with one fault switched
// on; `guard({})` is the control. `shipped` maps the IDs `{list: "shipped"}` answers to their definitions (by default
// the fixture as `clean`, the app's look).
import {
  FLOORS, FOCUS, FOCUS_FLOOR, STATUS_FLOOR, SURFACE_NAMES, TERMINAL_BACKGROUND, TERMINAL_FLOOR, TERMINAL_ROLES,
  contrast, on, parseColor, surfaces,
} from '../common.mjs';
import { planted, resolveRoles } from '../look-judge.mjs';

/**
 * Faults: `base` (the merge base: no new check, every plant accepted), `refuseAll`, `noSelected` (the selected fill is
 * no surface), `shortName` (names "selected", not "selected over raised"), `groundOnly` (status colors on the ground
 * only), `noTerminal`, `terminalIndex` (names `ansi_8`, not the role), `noRatio`, `focusOptional` (a missing focus
 * passes), `focusFirstSurface` (names the ground whatever surface fails).
 */
export function guard(faults, shipped = { clean: planted('none') }) {
  const answer = (def) => {
    if (typeof def === 'string') def = shipped[def];
    if (!def) return { ok: false, code: 'unknown_look' };
    if (faults.refuseAll) return { ok: false, code: 'ink_contrast', theme: 'light', role: 'ink_primary', on: 'ground', ratio: 1 };
    const roles = resolveRoles(def);
    if (faults.base) return { ok: true, look: def, roles };
    for (const theme of ['light', 'dark']) {
      const got = roles[theme];
      const all = surfaces(got).filter(([n]) => !(faults.noSelected && n.startsWith('selected')));
      const named = (n) => (faults.shortName ? n.split(' ')[0] : n);
      for (const [tier, floor] of Object.entries(FLOORS)) {
        const ink = parseColor(got[tier]);
        if (!ink) continue;
        for (const [n, s] of all) {
          const ratio = contrast(on(ink, s), s);
          if (ratio < floor) return { ok: false, code: 'ink_contrast', theme, role: tier, on: named(n), ratio };
        }
      }
      for (const [n, s] of all.filter(([name]) => !faults.groundOnly || name === 'ground')) {
        for (const [state, text] of Object.entries(def.status)) {
          if (contrast(parseColor(text).rgb, s) < STATUS_FLOOR) return { ok: false, code: 'status_contrast', theme, state, against: named(n) };
        }
      }
      if (!faults.noTerminal) {
        const bg = parseColor(got[TERMINAL_BACKGROUND] ?? got.ground).rgb;
        for (const [i, role] of TERMINAL_ROLES.entries()) {
          const c = parseColor(got[role]);
          if (!c) continue;
          const ratio = contrast(c.rgb, bg);
          if (ratio < TERMINAL_FLOOR) return { ok: false, code: 'terminal_contrast', theme, role: faults.terminalIndex ? `ansi_${i}` : role, ...(faults.noRatio ? {} : { ratio }) };
        }
      }
      const focus = parseColor(got[FOCUS]);
      if (!focus && !faults.focusOptional) return { ok: false, code: 'bad_look', path: `roles/focus (${theme})` };
      if (focus) {
        for (const n of SURFACE_NAMES) {
          const s = all.find(([name]) => name === n)?.[1];
          if (s && contrast(on(focus, s), s) < FOCUS_FLOOR) return { ok: false, code: 'focus_contrast', theme, role: FOCUS, on: faults.focusFirstSurface ? 'ground' : n };
        }
      }
    }
    return { ok: true, look: def, roles };
  };
  return (inputs) => inputs.map((input) => (input.list === 'shipped' ? { ok: true, shipped: Object.keys(shipped) } : answer(input.look)));
}
