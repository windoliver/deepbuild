// #882's two redrafted judges under #1458's amendment: the chrome's ink is at two tiers and disabled (ink_primary,
// ink_secondary, ink_disabled; no ink_tertiary), and every ink role but ink_disabled keeps 4.5:1 on every fill a row
// is drawn on. Everything else the old judges assert is theirs, imported from ../look-judge.mjs and ../common.mjs.
import { spawnSync } from 'node:child_process';
import { LOW_ALPHA, MIN_DISTANCE, buildBin, contrast, nearestStatus, over, parseColor, repoRoot } from '../common.mjs';
import { judgeLook as judgeLookOld } from '../look-judge.mjs';

/** The ink tiers after #1458, primary to disabled. */
export const INK_TIERS = ['ink_primary', 'ink_secondary', 'ink_disabled'];
/** The old twelve chrome roles less ink_tertiary. */
export const CHROME_ROLES = ['ground', 'raised', 'divider', ...INK_TIERS, 'hover', 'selected', 'accent', 'session_readout', 'session_line'];
/** Every ink role but ink_disabled keeps this on every fill. */
export const INK_FLOOR = 4.5;
const THEMES = ['light', 'dark'];

const shown = (value) => JSON.stringify(value?.look ? { ...value, look: '(the definition)' } : value)?.slice(0, 600);

/** `deep-canvas-render look`, one JSON line per input, the answers in order (as ../look.test.mjs asks it). */
export function ask(inputs) {
  const bin = buildBin('deep-marks-render', 'deep-canvas-render');
  if (bin.error) return inputs.map(() => ({ ok: false, code: 'not_built', error: bin.error }));
  const run = spawnSync(bin.path, ['look'], {
    cwd: repoRoot, input: `${inputs.map((i) => JSON.stringify(i)).join('\n')}\n`, encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024,
  });
  const lines = `${run.stdout ?? ''}`.split('\n').filter(Boolean);
  return inputs.map((_, i) => {
    try {
      return JSON.parse(lines[i]);
    } catch {
      return { ok: false, code: 'no_answer', status: run.status, stderr: `${run.stderr ?? ''}`.slice(0, 400) };
    }
  });
}

/** What is wrong with a passing answer's resolved roles under the amended shape, one line each. */
export function rolesProblems(answer) {
  const roles = answer?.roles;
  if (!roles || typeof roles !== 'object') return [`the shipped look's answer carries no roles: ${shown(answer)}`];
  const problems = [];
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
    // Two tiers and disabled: any other role named ink_* is a third tier, ink_tertiary or under another name.
    for (const role of Object.keys(got).filter((r) => r.startsWith('ink_') && !INK_TIERS.includes(r))) {
      problems.push(`${theme}: ${role} ${got[role]} is a third ink tier; the ink is ${INK_TIERS.join(', ')}`);
    }
    for (const role of ['ground', 'raised', 'ink']) if (color(role).a !== 1) problems.push(`${theme}: ${role} isn't opaque: ${got[role]}`);
    const ink = color('ink').rgb.join();
    INK_TIERS.forEach((role, i) => {
      if (color(role).rgb.join() !== ink) problems.push(`${theme}: ${role} ${got[role]} isn't the one ink ${got.ink} at an alpha`);
      if (i > 0 && !(color(role).a < color(INK_TIERS[i - 1]).a)) problems.push(`${theme}: ${role}'s alpha isn't below ${INK_TIERS[i - 1]}'s`);
    });
    for (const role of ['hover', 'selected']) {
      if (color(role).rgb.join() !== ink) problems.push(`${theme}: ${role} ${got[role]} isn't the one ink ${got.ink} at an alpha`);
      if (!(color(role).a > 0 && color(role).a <= LOW_ALPHA)) problems.push(`${theme}: ${role}'s alpha ${color(role).a.toFixed(3)} isn't low (0 < alpha <= ${LOW_ALPHA})`);
    }
    for (const role of CHROME_ROLES.filter((r) => color(r).a === 1)) {
      const [state, d] = nearestStatus(color(role).rgb);
      if (d < MIN_DISTANCE) problems.push(`${theme}: ${role} ${got[role]} is ${d.toFixed(3)} from ${state}, under ${MIN_DISTANCE}`);
    }
  }
  return problems;
}

/**
 * AC1 as amended: the old judge (the shipped look passes; the readout at #b45309 is refused naming light,
 * session_readout, blocked and 0.044; the one-ink control passes; the dark-only plant is refused naming dark), with
 * its roles-shape lines swapped for the amended shape's.
 */
export function judgeLook(askFn) {
  const old = judgeLookOld(askFn).filter((line) => !line.startsWith("the shipped look's roles: "));
  const [shipped] = askFn([{ look: 'clean' }]);
  if (shipped?.ok !== true) return old;
  return [...rolesProblems(shipped).map((p) => `the shipped look's roles: ${p}`), ...old];
}

/**
 * AC3's ink half as amended: every ink role (`ink` and each `ink_*`) but ink_disabled keeps 4.5:1 on every fill a row
 * is drawn on: ground, raised, and hover and selected over each, an alpha blended in sRGB-encoded values.
 */
export function inkProblems(appearance, roles) {
  const color = (role) => parseColor(roles?.[role]);
  const need = ['ground', 'raised', 'hover', 'selected', 'ink_primary', 'ink_secondary'].filter((r) => !color(r));
  if (need.length) return [`${appearance}: no ${need.join(', ')} role`];
  const [ground, raised] = [color('ground').rgb, color('raised').rgb];
  const fills = [['ground', ground], ['raised', raised]];
  for (const role of ['hover', 'selected']) for (const [name, base] of [['ground', ground], ['raised', raised]]) fills.push([`${role} over ${name}`, over(color(role), base)]);
  const inks = Object.keys(roles).filter((r) => (r === 'ink' || r.startsWith('ink_')) && r !== 'ink_disabled' && color(r));
  const problems = [];
  for (const role of inks) {
    for (const [name, rgb] of fills) {
      const ratio = contrast(over(color(role), rgb), rgb);
      if (ratio < INK_FLOOR) problems.push(`${appearance}: ${role} ${roles[role]} on ${name} is ${ratio.toFixed(2)}:1, under ${INK_FLOOR}:1`);
    }
  }
  return problems;
}
