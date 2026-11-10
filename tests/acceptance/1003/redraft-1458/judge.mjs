// The blind redraft of four #1003 look tests for #1458's amended ink floors (README.md here): the redrafted fixture
// and its plants, the amended rules computed from a look's own roles, and the judges look.test.mjs runs on the real
// guard and wrong.test.mjs runs on wrong guards. A guard is a function from input lines to answer lines, as in
// ../look-judge.mjs; each judge answers the ways it falls short, one line each, and an empty list is a pass.
import { readFileSync } from 'node:fs';
import {
  FOCUS, FOCUS_FLOOR, STATUS_FLOOR, TERMINAL_BACKGROUND, TERMINAL_FLOOR, TERMINAL_ROLES, contrast, on, parseColor, surfaces,
} from '../common.mjs';
import { resolveRoles } from '../look-judge.mjs';

/** #1458: every ink role but ink_disabled clears 4.5:1 on every fill #1003 lists; the ink is two tiers and disabled. */
export const INK_FLOOR = 4.5;
const TIERS = ['ink_primary', 'ink_secondary', 'ink_disabled'];

/** The redrafted fixture, freshly parsed. */
export const fixture = () => JSON.parse(readFileSync(new URL('./look-1003-1458.json', import.meta.url), 'utf8'));

/** The redrafted fixture (or `def`) with one plant, the same plants as ../look-judge.mjs's. */
export function planted(kind, def = fixture()) {
  switch (kind) {
    case 'none':
      break;
    case 'brightBlack': // AC3: dark's bright black at #b7b7b7, 2.01:1 on the terminal background (white).
      def.palette.planted_bright_black = '#b7b7b7';
      def.themes.dark = { roles: { term_bright_black: 'planted_bright_black' } };
      break;
    case 'noFocus': // AC4: no focus role in either theme.
      delete def.roles.focus;
      delete def.palette.focus;
      break;
    case 'faintFocus': // Scope: light's focus at #8079f2, under 3:1 on hover and selected over raised.
      def.palette.planted_focus = '#8079f2';
      def.themes.light = { roles: { focus: 'planted_focus' } };
      break;
    default:
      throw new Error(`no plant ${kind}`);
  }
  return def;
}

/**
 * Every rule the four tests rely on, as amended, computed from the look's resolved roles and not taken from a guard:
 * the ink at two tiers and disabled; every ink role but ink_disabled (`ink` and `ink_*`) 4.5:1, each status color
 * 3:1 and focus 3:1 on all six surfaces; the sixteen terminal roles 3:1 on the terminal background. One line a miss.
 */
export function amendedProblems(def) {
  const problems = [];
  const resolved = resolveRoles(def);
  for (const theme of ['light', 'dark']) {
    const roles = resolved[theme];
    const all = surfaces(roles);
    for (const tier of TIERS) if (!parseColor(roles[tier])) problems.push(`${theme}: no ${tier}`);
    if (roles.ink_tertiary !== undefined) problems.push(`${theme}: gives ink_tertiary, but the ink is two tiers and disabled`);
    const held = (role, color, floor) => {
      for (const [name, s] of all) {
        const r = contrast(on(color, s), s);
        if (r < floor) problems.push(`${theme}: ${role} on ${name} is ${r.toFixed(2)}:1, under ${floor}:1`);
      }
    };
    for (const role of Object.keys(roles).filter((r) => /^ink(_|$)/.test(r) && r !== 'ink_disabled')) held(role, parseColor(roles[role]), INK_FLOOR);
    for (const [state, text] of Object.entries(def.status)) held(state, parseColor(text), STATUS_FLOOR);
    const bg = parseColor(roles[TERMINAL_BACKGROUND] ?? roles.ground).rgb;
    for (const role of TERMINAL_ROLES) {
      const c = parseColor(roles[role]);
      if (!c || c.a !== 1) problems.push(`${theme}: no opaque ${role}`);
      else if (contrast(c.rgb, bg) < TERMINAL_FLOOR) problems.push(`${theme}: ${role} on the terminal background is ${contrast(c.rgb, bg).toFixed(2)}:1, under 3:1`);
    }
    const focus = parseColor(roles[FOCUS]);
    if (focus) held(FOCUS, focus, FOCUS_FLOOR);
    else problems.push(`${theme}: no focus`);
  }
  return problems;
}

const show = (answer) => JSON.stringify(answer && answer.look ? { ...answer, look: '(the definition)', roles: answer.roles ? '(roles)' : undefined } : answer).slice(0, 400);
const one = (guard, def) => {
  try {
    return guard([{ look: def }])[0];
  } catch (e) {
    return { error: e.message };
  }
};

/** A refusal that must carry `want` (field → value, or a predicate with a label). */
function refusal(what, answer, want) {
  if (answer?.ok !== false) return [`${what} isn't refused: ${show(answer)}`];
  const off = Object.entries(want).filter(([k, v]) => (typeof v === 'function' ? !v(answer[k]) : answer[k] !== v));
  return off.length ? [`${what} is refused, but not naming ${off.map(([k, v]) => `${k} ${typeof v === 'function' ? v.label : JSON.stringify(v)}`).join(', ')}: ${show(answer)}`] : [];
}
const near = (x, tolerance) => Object.assign((v) => typeof v === 'number' && Math.abs(v - x) <= tolerance, { label: `${x} ± ${tolerance}` });
const oneOf = (list) => Object.assign((v) => list.includes(v), { label: `one of ${list.join(', ')}` });

/** Old test 1: the fixture passes the guard, and its answer resolves the terminal roles and focus in each theme. */
export function judgeControl(guard) {
  const answer = one(guard, planted('none'));
  if (answer?.ok !== true) return [`the redrafted fixture, which keeps every rule as amended, is refused: ${show(answer)}`];
  const failures = [];
  for (const theme of ['light', 'dark']) {
    const roles = answer.roles?.[theme];
    for (const role of [...TERMINAL_ROLES, TERMINAL_BACKGROUND, FOCUS]) if (!parseColor(roles?.[role])) failures.push(`the fixture's answer gives no ${theme} ${role}`);
  }
  return failures;
}

/** Old test 2 (AC3): bright black at 2:1 on the terminal background, named by its role, theme and ratio. */
export const judgeBrightBlack = (guard) => refusal('the look whose dark bright black is 2.01:1 on the terminal background', one(guard, planted('brightBlack')), {
  theme: 'dark', role: 'term_bright_black', ratio: near(2.01, 0.03),
});

/** Old test 3 (AC4): no focus role, refused naming it (as the role, or a path under roles). */
export function judgeNoFocus(guard) {
  const answer = one(guard, planted('noFocus'));
  if (answer?.ok !== false) return [`the look with no focus role isn't refused: ${show(answer)}`];
  const named = answer.role === FOCUS || (typeof answer.path === 'string' && /(^|\/)focus(\b|$)/.test(answer.path));
  return named ? [] : [`the look with no focus role is refused, but not naming the role focus: ${show(answer)}`];
}

/** Old test 4 (AC4, scope): focus under 3:1, refused naming focus and a surface it truly is under 3:1 on. */
export function judgeFaintFocus(guard) {
  const def = planted('faintFocus');
  const roles = resolveRoles(def).light;
  const under = surfaces(roles).filter(([, s]) => contrast(on(parseColor(roles.focus), s), s) < FOCUS_FLOOR).map(([n]) => n);
  return refusal(`the look whose light focus is under 3:1 on ${under.join(' and ')}`, one(guard, def), { theme: 'light', role: FOCUS, on: oneOf(under) });
}
