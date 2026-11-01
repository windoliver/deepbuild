// #882 AC1, and the guard's half of the scope: what the look's guard must do, as judges that look.test.mjs runs on
// `deep-canvas-render look` and wrong.test.mjs runs on the wrong guards under wrong/.
//
// A guard is asked through `ask(inputs)`: each input is a `deep-canvas-render look` line's object, `{ look }` with a
// shipped look's ID or a look@1 definition, and the answers come back in order. README.md, The surface, pins the
// answer: `{ ok: true, look, roles: { light: {role: color}, dark: {...} } }` for a look the guard passes, each color
// `#rrggbb` or `#rrggbbaa`; a refusal `{ ok: false, code, theme, role, ... }`, and for a role too near a status color
// `code: "status_distance"` with its `state` and its OKLab `distance`.
import {
  CHROME_ROLES, INK_TIERS, LOW_ALPHA, MIN_DISTANCE, distance, nearestStatus, parseColor,
} from './common.mjs';

/** The AC's planted color for the session readout, and what it must be refused for. */
export const PLANT = '#b45309';
export const PLANT_STATE = 'blocked';
export const PLANT_DISTANCE = 0.044;
const THEMES = ['light', 'dark'];

/** An answer as text, its look definition left out. */
const shown = (value) => JSON.stringify(value?.look ? { ...value, look: '(the definition)' } : value)?.slice(0, 600);
const clone = (value) => JSON.parse(JSON.stringify(value));

/** The palette name a theme's role resolves through: the theme's own `roles` over the look's. */
const roleName = (def, theme, role) => def.themes?.[theme]?.roles?.[role] ?? def.roles?.[role];

/**
 * `def` with `role` set per theme: `colors.light` / `colors.dark` is either a `#rrggbb` color (added to the palette
 * as `planted_882_<theme>`) or `{ like: <role> }`, the palette name that role resolves to in that theme.
 */
export function withRole(def, role, colors) {
  const out = clone(def);
  out.palette ??= {};
  out.themes ??= {};
  for (const theme of THEMES) {
    const want = colors[theme];
    let name;
    if (typeof want === 'string') {
      name = `planted_882_${theme}`;
      out.palette[name] = want;
    } else name = roleName(def, theme, want.like);
    out.themes[theme] ??= {};
    out.themes[theme].roles ??= {};
    out.themes[theme].roles[role] = name;
    if (theme === 'light') {
      out.roles ??= {};
      out.roles[role] = name;
    }
  }
  return out;
}

/** What is wrong with a passing answer's resolved roles, one line each. */
export function rolesProblems(answer) {
  const problems = [];
  const roles = answer?.roles;
  if (!roles || typeof roles !== 'object') return [`the shipped look's answer carries no roles: ${shown(answer)}`];
  for (const theme of THEMES) {
    const got = roles[theme];
    if (!got || typeof got !== 'object') {
      problems.push(`no ${theme} roles: ${shown(roles)}`);
      continue;
    }
    const color = (role) => parseColor(got[role]);
    const missing = [...CHROME_ROLES, 'ink'].filter((role) => !color(role));
    if (missing.length) {
      problems.push(`${theme}: no color for ${missing.join(', ')} (want #rrggbb or #rrggbbaa): ${shown(got)}`);
      continue;
    }
    for (const role of ['ground', 'raised', 'ink']) if (color(role).a !== 1) problems.push(`${theme}: ${role} isn't opaque: ${got[role]}`);
    const ink = color('ink').rgb.join();
    const tiers = INK_TIERS.map((role) => color(role));
    INK_TIERS.forEach((role, i) => {
      if (tiers[i].rgb.join() !== ink) problems.push(`${theme}: ${role} ${got[role]} isn't the one ink ${got.ink} at an alpha`);
      if (i > 0 && !(tiers[i].a < tiers[i - 1].a)) problems.push(`${theme}: ${role}'s alpha isn't below ${INK_TIERS[i - 1]}'s`);
    });
    for (const role of ['hover', 'selected']) {
      if (color(role).rgb.join() !== ink) problems.push(`${theme}: ${role} ${got[role]} isn't the one ink ${got.ink} at an alpha`);
      if (!(color(role).a > 0 && color(role).a <= LOW_ALPHA)) problems.push(`${theme}: ${role}'s alpha ${color(role).a.toFixed(3)} isn't low (0 < alpha <= ${LOW_ALPHA})`);
    }
    // The opaque chrome roles keep the status distance (how an alpha role's is measured is the guard's own).
    for (const role of CHROME_ROLES.filter((r) => color(r).a === 1)) {
      const [state, d] = nearestStatus(color(role).rgb);
      if (d < MIN_DISTANCE) problems.push(`${theme}: ${role} ${got[role]} is ${d.toFixed(3)} from ${state}, under ${MIN_DISTANCE}`);
    }
  }
  return problems;
}

/** Whether `answer` refuses `role` in `theme` for its distance from `state`, about `d`; the reasons it doesn't. */
function distanceRefusal(answer, { theme, role, state, d }) {
  if (answer?.ok !== false) return [`passes the guard: ${shown(answer)}`];
  const problems = [];
  if (answer.code !== 'status_distance') problems.push(`is refused with ${answer.code}, not status_distance`);
  if (answer.role !== role) problems.push(`names role ${answer.role}, not ${role}`);
  if (answer.state !== state) problems.push(`names state ${answer.state}, not ${state}`);
  if (theme && answer.theme !== theme) problems.push(`names theme ${answer.theme}, not ${theme}`);
  if (typeof answer.distance !== 'number' || Math.abs(answer.distance - d) > 0.0005) problems.push(`names distance ${answer.distance}, not ${d}`);
  return problems.length ? [`${problems.join('; ')}: ${shown(answer)}`] : [];
}

/**
 * AC1: the shipped look passes with the chrome roles in light and dark, and with the session readout's role at
 * #b45309 it fails, naming the role, blocked and 0.044. Also: the same look with the readout in the one ink passes
 * (so the refusal is the color's), and the readout planted in dark alone fails naming dark (so dark is checked).
 */
export function judgeLook(ask) {
  const [shipped] = ask([{ look: 'clean' }]);
  if (shipped?.ok !== true) return [`the shipped look fails the guard: ${shown(shipped)}`];
  const failures = rolesProblems(shipped).map((p) => `the shipped look's roles: ${p}`);
  const def = shipped.look;
  if (!def || typeof def !== 'object') return [...failures, `the answer carries no look definition: ${shown(shipped)}`];
  const [planted, control, dark] = ask([
    { look: withRole(def, 'session_readout', { light: PLANT, dark: { like: 'ink' } }) },
    { look: withRole(def, 'session_readout', { light: { like: 'ink' }, dark: { like: 'ink' } }) },
    { look: withRole(def, 'session_readout', { light: { like: 'ink' }, dark: PLANT }) },
  ]);
  failures.push(...distanceRefusal(planted, { theme: 'light', role: 'session_readout', state: PLANT_STATE, d: PLANT_DISTANCE })
    .map((p) => `the session readout at ${PLANT} ${p}`));
  if (control?.ok !== true) failures.push(`the session readout in the one ink fails the guard: ${shown(control)}`);
  if (dark?.ok !== false || dark.theme !== 'dark' || dark.role !== 'session_readout') {
    failures.push(`the session readout at ${PLANT} in dark alone isn't refused naming dark and session_readout: ${shown(dark)}`);
  }
  return failures;
}

/**
 * The guard's contrast half (scope: each ink tier keeps its floor): the shipped look with the light theme's tertiary
 * ink drawn in the ground's own color is refused, naming ink_tertiary and light.
 */
export function judgeInkGuard(ask) {
  const [shipped] = ask([{ look: 'clean' }]);
  if (shipped?.ok !== true || !shipped.look) return [`the shipped look fails the guard: ${shown(shipped)}`];
  const [answer] = ask([{ look: withRole(shipped.look, 'ink_tertiary', { light: { like: 'ground' }, dark: { like: 'ink_tertiary' } }) }]);
  if (answer?.ok !== false || answer.role !== 'ink_tertiary' || answer.theme !== 'light') {
    return [`a light tertiary ink in the ground's color (1:1) isn't refused naming ink_tertiary and light: ${shown(answer)}`];
  }
  return [];
}
