// #1003 AC1-AC4: what the look's guard must answer, as judges look.test.mjs runs on the real guard
// (`deep-canvas-render look`) and wrong.test.mjs runs on the wrong guards under wrong/. A guard here is a function
// from input lines (`{look: <id | definition>}` or `{list: "shipped"}`) to answer lines. Each judge answers the
// ways the guard falls short, one line each; an empty list is a pass.
//
// The planted looks are fixtures/look-1003.json (the fixture) with one change each. The fixture keeps every rule the
// README pins, so a refusal of a plant is for the plant alone; each plant breaks exactly the rule its criterion names
// (the ratios are computed in the README's table and checked again by `plantRatios`).
import {
  FLOORS, FOCUS, FOCUS_FLOOR, STATUS_FLOOR, SURFACE_NAMES, TERMINAL_BACKGROUND, TERMINAL_FLOOR, TERMINAL_ROLES,
  contrast, fixture, on, parseColor, surfaces,
} from './common.mjs';

const FIXTURE = 'look-1003';
const show = (answer) => JSON.stringify(answer && answer.look ? { ...answer, look: '(the definition)', roles: answer.roles ? '(roles)' : undefined, oklab: undefined } : answer).slice(0, 400);

/** The fixture with one plant (README: The planted looks). */
export function planted(kind) {
  const def = fixture(FIXTURE);
  switch (kind) {
    case 'none':
      break;
    case 'selected': // AC1: light's selected fill at 0x3c: the secondary ink is 4.40:1 on selected over raised.
      def.palette.planted_selected = '#1b1d223c';
      def.themes.light = { roles: { selected: 'planted_selected' } };
      break;
    case 'blocked': // AC2: blocked at #dc6c00: 3.39:1 on the ground, 2.90:1 on the raised ground.
      def.status.blocked = '#dc6c00';
      break;
    case 'brightBlack': // AC3: dark's bright black at #b7b7b7: 2.01:1 on the terminal background.
      def.palette.planted_bright_black = '#b7b7b7';
      def.themes.dark = { roles: { term_bright_black: 'planted_bright_black' } };
      break;
    case 'noFocus': // AC4: no focus role in either theme.
      delete def.roles.focus;
      delete def.palette.focus;
      break;
    case 'faintFocus': // Scope: light's focus at #8079f2: 2.84:1 on hover over raised, 2.76:1 on selected over raised.
      def.palette.planted_focus = '#8079f2';
      def.themes.light = { roles: { focus: 'planted_focus' } };
      break;
    default:
      throw new Error(`no plant ${kind}`);
  }
  return def;
}

/** Each theme's roles as the README's guard resolves them: palette and roles with the theme's own over them. */
export function resolveRoles(def) {
  const out = {};
  for (const theme of ['light', 'dark']) {
    const palette = { ...def.palette, ...def.themes?.[theme]?.palette };
    const roles = { ...def.roles, ...def.themes?.[theme]?.roles };
    out[theme] = Object.fromEntries(Object.entries(roles).map(([role, name]) => [role, palette[name]]).filter(([, c]) => typeof c === 'string'));
  }
  return out;
}

const one = (guard, def) => {
  try {
    return guard([{ look: def }])[0];
  } catch (e) {
    return { error: e.message };
  }
};

/** The fixture itself must pass: otherwise a plant's refusal could be for something else. */
export function judgeControl(guard) {
  const answer = one(guard, planted('none'));
  if (answer?.ok !== true) return [`the fixture, which keeps every rule the README pins, is refused: ${show(answer)}`];
  const failures = [];
  for (const theme of ['light', 'dark']) {
    const roles = answer.roles?.[theme];
    if (!roles) {
      failures.push(`the fixture's answer has no ${theme} roles: ${show(answer)}`);
      continue;
    }
    for (const role of [...TERMINAL_ROLES, TERMINAL_BACKGROUND, FOCUS]) if (!parseColor(roles[role])) failures.push(`the fixture's answer gives no ${theme} ${role}`);
  }
  return failures;
}

/** A refusal that must carry `want` (field → value, or a function of the field's value). */
function refusal(what, answer, want) {
  if (answer?.ok !== false) return [`${what} isn't refused: ${show(answer)}`];
  const off = Object.entries(want).filter(([k, v]) => (typeof v === 'function' ? !v(answer[k]) : answer[k] !== v));
  return off.length ? [`${what} is refused, but not naming ${off.map(([k, v]) => `${k} ${typeof v === 'function' ? v.label : JSON.stringify(v)}`).join(', ')}: ${show(answer)}`] : [];
}
const near = (x, tolerance, label) => Object.assign((v) => typeof v === 'number' && Math.abs(v - x) <= tolerance, { label: label ?? `${x} ± ${tolerance}` });
const oneOf = (list) => Object.assign((v) => list.includes(v), { label: `one of ${list.join(', ')}` });

/** AC1: the selected fill that drops the secondary ink under its floor, named with "selected over raised". */
export function judgeSelected(guard) {
  return refusal('the look whose light selected fill drops ink_secondary to 4.40:1 on selected over raised', one(guard, planted('selected')), {
    code: 'ink_contrast', theme: 'light', role: 'ink_secondary', on: 'selected over raised', ratio: near(4.4, 0.05),
  });
}

/** AC2: blocked at 3:1 on the ground but 2.9:1 on the raised ground, named by state and surface. */
export function judgeBlocked(guard) {
  return refusal('the look whose blocked color is 3.39:1 on the ground and 2.90:1 on the raised ground', one(guard, planted('blocked')), {
    code: 'status_contrast', state: 'blocked', against: 'raised', theme: oneOf(['light', 'dark']),
  });
}

/** AC3: bright black at 2:1 on the terminal background, named by its role. */
export function judgeBrightBlack(guard) {
  return refusal('the look whose dark bright black is 2.01:1 on the terminal background', one(guard, planted('brightBlack')), {
    theme: 'dark', role: 'term_bright_black', ratio: near(2.01, 0.03),
  });
}

/** AC4: a look with no focus role, refused naming it (as the role, or as a path under roles). */
export function judgeNoFocus(guard) {
  const answer = one(guard, planted('noFocus'));
  if (answer?.ok !== false) return [`the look with no focus role isn't refused: ${show(answer)}`];
  const named = answer.role === FOCUS || (typeof answer.path === 'string' && /(^|\/)focus(\b|$)/.test(answer.path));
  return named ? [] : [`the look with no focus role is refused, but not naming the role focus: ${show(answer)}`];
}

/** Scope: a focus under 3:1 on some surface is refused naming focus and a surface it truly is under 3:1 on. */
export function judgeFaintFocus(guard) {
  const def = planted('faintFocus');
  const roles = resolveRoles(def).light;
  const under = surfaces(roles).filter(([, s]) => contrast(on(parseColor(roles.focus), s), s) < FOCUS_FLOOR).map(([n]) => n);
  return refusal(`the look whose light focus is under 3:1 on ${under.join(' and ')}`, one(guard, def), { theme: 'light', role: FOCUS, on: oneOf(under) });
}

/**
 * What a passing look's resolved roles must hold, computed here and not taken from the guard's word, one line per
 * miss: each ink tier its floor, each status color 3:1 (or its outline, as the base allows), and a focus role 3:1,
 * on every surface; each terminal role
 * 3:1 on the terminal background (the role, or the ground where there is none). `app` asks the app's own look to
 * give the sixteen terminal roles and focus, in each theme.
 */
export function lookProblems(id, answer, { app = false } = {}) {
  const problems = [];
  const status = answer?.look?.status ?? {};
  for (const theme of ['light', 'dark']) {
    const roles = answer?.roles?.[theme];
    if (!roles) {
      problems.push(`${id} (${theme}): no roles in its answer`);
      continue;
    }
    const all = surfaces(roles);
    for (const [tier, floor] of Object.entries(FLOORS)) {
      const ink = parseColor(roles[tier]);
      if (!ink) continue;
      for (const [name, s] of all) {
        const r = contrast(on(ink, s), s);
        if (r < floor) problems.push(`${id} (${theme}): ${tier} on ${name} is ${r.toFixed(2)}:1, under ${floor}:1`);
      }
    }
    // A status mark holds by its own color, or by an outline (status_treatment.outline, the base's rule) that keeps
    // 3:1 against the surface and against the color.
    const ring = parseColor(roles[answer?.look?.status_treatment?.outline?.role]);
    for (const [state, text] of Object.entries(status)) {
      const c = parseColor(text);
      for (const [name, s] of all) {
        const r = c ? contrast(c.rgb, s) : 0;
        const held = c && ring && ring.a === 1 && contrast(ring.rgb, s) >= STATUS_FLOOR && contrast(ring.rgb, c.rgb) >= STATUS_FLOOR;
        if (r < STATUS_FLOOR && !held) problems.push(`${id} (${theme}): ${state} on ${name} is ${r.toFixed(2)}:1, under 3:1, with no outline that holds it`);
      }
    }
    const terms = TERMINAL_ROLES.filter((role) => roles[role] !== undefined);
    if (terms.length || app) {
      const bg = parseColor(roles[TERMINAL_BACKGROUND] ?? roles.ground);
      for (const role of TERMINAL_ROLES) {
        const c = parseColor(roles[role]);
        if (!c || c.a !== 1 || !bg) problems.push(`${id} (${theme}): no opaque ${role}`);
        else if (contrast(c.rgb, bg.rgb) < TERMINAL_FLOOR) problems.push(`${id} (${theme}): ${role} is ${contrast(c.rgb, bg.rgb).toFixed(2)}:1 on the terminal background, under 3:1`);
      }
    }
    problems.push(...focusProblems(`${id} (${theme})`, roles, { required: app }));
  }
  return problems;
}

/** AC4: the focus ring at 3:1 on every surface, so a focused row reads beside a selected one (selected over raised). */
export function focusProblems(label, roles, { required = true } = {}) {
  const focus = parseColor(roles?.[FOCUS]);
  if (!focus) return required ? [`${label}: no focus role`] : [];
  const all = surfaces(roles);
  const problems = [];
  for (const name of SURFACE_NAMES) {
    const s = all.find(([n]) => n === name)?.[1];
    if (!s) {
      if (required) problems.push(`${label}: no ${name} surface to hold the focus ring against`);
      continue;
    }
    const r = contrast(on(focus, s), s);
    if (r < FOCUS_FLOOR) problems.push(`${label}: focus on ${name} is ${r.toFixed(2)}:1, under 3:1`);
  }
  return problems;
}

/** AC3: every shipped look passes the guard in light and dark and holds what `lookProblems` computes; `app` is the app's look. */
export function judgeShipped(guard, { app = 'clean' } = {}) {
  let list;
  try {
    list = guard([{ list: 'shipped' }])[0];
  } catch (e) {
    return [e.message];
  }
  const ids = list?.shipped;
  if (!Array.isArray(ids) || !ids.includes(app)) return [`the guard lists no shipped looks with ${app}: ${show(list)}`];
  const answers = guard(ids.map((look) => ({ look })));
  const failures = [];
  ids.forEach((id, i) => {
    const answer = answers[i];
    if (answer?.ok !== true) failures.push(`the shipped look ${id} fails the guard: ${show(answer)}`);
    else failures.push(...lookProblems(id, answer, { app: id === app }));
  });
  return failures;
}

/** The plants' own ratios, as the README's table gives them, so a change to the fixture can't quietly void a plant. */
export function plantRatios() {
  const problems = [];
  const at = (roles, role, name) => {
    const s = surfaces(roles).find(([n]) => n === name)[1];
    return contrast(on(parseColor(roles[role]), s), s);
  };
  const sel = resolveRoles(planted('selected')).light;
  for (const [name, lo, hi] of [['selected over ground', 4.5, 99], ['selected over raised', 4.39, 4.41]]) {
    const r = at(sel, 'ink_secondary', name);
    if (r < lo || r > hi) problems.push(`selected plant: ink_secondary on ${name} is ${r.toFixed(3)}`);
  }
  const fx = resolveRoles(planted('none')).light;
  const blocked = parseColor(planted('blocked').status.blocked).rgb;
  const ground = surfaces(fx).find(([n]) => n === 'ground')[1];
  const raised = surfaces(fx).find(([n]) => n === 'raised')[1];
  if (contrast(blocked, ground) < 3) problems.push('blocked plant: under 3:1 on the ground');
  if (Math.abs(contrast(blocked, raised) - 2.9) > 0.005) problems.push(`blocked plant: ${contrast(blocked, raised).toFixed(3)}:1 on raised, not 2.90`);
  const dark = resolveRoles(planted('brightBlack')).dark;
  const bb = contrast(parseColor(dark.term_bright_black).rgb, parseColor(dark.term_background).rgb);
  if (Math.abs(bb - 2) > 0.02) problems.push(`bright black plant: ${bb.toFixed(3)}:1, not 2:1`);
  return problems;
}
