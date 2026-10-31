// #882 AC3: what a replica's screen in an appearance must show, as judges replica.test.mjs runs on the replica's
// screenshots and wrong.test.mjs runs on made-up screens.
//
// A screen is the replica's PNG at 2x. Its colors are read two ways:
// - Fills: every color that covers at least FILL device px as flat pixels (a pixel whose 8 neighbours are the same
//   color) must be one the appearance's roles give: a role's color, a status color, or an alpha role (an ink tier,
//   hover, selected, any other) over the ground, the raised ground, or hover or selected over either. A fill no role
//   gives fails, naming the view, the appearance and the color, and the role of the other appearance it is, if any.
// - The widest fill is the appearance's ground or raised ground, and some ink tier over one of those bases shows as
//   text: at least INK device px within TOLERANCE of it.
// Colors match within TOLERANCE per channel, blended either in sRGB-encoded values or in linear light.
import { STATUS, hex, over, parseColor } from './common.mjs';

export const FILL = 32;
export const INK = 40;
export const TOLERANCE = 3;

const near = (p, q) => Math.abs(p[0] - q[0]) <= TOLERANCE && Math.abs(p[1] - q[1]) <= TOLERANCE && Math.abs(p[2] - q[2]) <= TOLERANCE;

/** The colors an appearance's roles (role → `#rrggbb[aa]`) can put on screen, each with what it is. */
export function palette(roles) {
  const parsed = Object.entries(roles).map(([role, text]) => [role, parseColor(text)]).filter(([, c]) => c);
  const color = (role) => parsed.find(([r]) => r === role)?.[1];
  const ground = color('ground')?.rgb;
  const raised = color('raised')?.rgb ?? ground;
  if (!ground) return { colors: [], bases: [], inks: [] };
  const blends = (c, base) => [over(c, base), over(c, base, { linear: true })];
  const bases = [['ground', ground], ['raised', raised]];
  for (const role of ['hover', 'selected']) {
    const c = color(role);
    if (c) for (const [name, base] of [['ground', ground], ['raised', raised]]) for (const rgb of blends(c, base)) bases.push([`${role} over ${name}`, rgb]);
  }
  const colors = [];
  for (const [role, c] of parsed) {
    if (c.a === 1) colors.push([role, c.rgb]);
    else for (const [name, base] of bases) for (const rgb of blends(c, base)) colors.push([`${role} over ${name}`, rgb]);
  }
  for (const [name, rgb] of bases) colors.push([name, rgb]);
  for (const [state, text] of Object.entries(STATUS)) colors.push([`status ${state}`, parseColor(text).rgb]);
  const inks = [];
  for (const [role, c] of parsed.filter(([r]) => r.startsWith('ink_'))) {
    for (const [name, base] of bases.slice(0, 2)) for (const rgb of blends(c, base)) inks.push([`${role} over ${name}`, rgb]);
  }
  return { colors, bases: bases.slice(0, 2), inks };
}

/** Flat pixels by color: `Map<"r,g,b", count>`. */
export function fills(image) {
  const { width, height, data } = image;
  const counts = new Map();
  const at = (x, y) => (y * width + x) * 4;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = at(x, y);
      let flat = true;
      for (let dy = -1; dy <= 1 && flat; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = at(x + dx, y + dy);
          if (data[j] !== data[i] || data[j + 1] !== data[i + 1] || data[j + 2] !== data[i + 2]) {
            flat = false;
            break;
          }
        }
      }
      if (flat) {
        const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/** How many pixels of `image` are within TOLERANCE of `rgb`. */
function pixelsNear(image, rgb) {
  let n = 0;
  for (let i = 0; i < image.data.length; i += 4) if (near([image.data[i], image.data[i + 1], image.data[i + 2]], rgb)) n++;
  return n;
}

/**
 * The ways a screen of `view` in `appearance` falls short of drawing from `roles` (that appearance's), one line each,
 * each naming the view. `other` is the other appearance's roles, to name a fill that is one of its colors.
 */
export function judgeScreen({ view, appearance, image, roles, other = {} }) {
  const { colors, bases, inks } = palette(roles);
  if (!colors.length) return [`${view} (${appearance}): no ground role to judge by: ${JSON.stringify(roles).slice(0, 300)}`];
  const theirs = palette(other).colors;
  const failures = [];
  const found = [...fills(image)].filter(([, n]) => n >= FILL).sort((x, y) => y[1] - x[1]);
  for (const [key, n] of found) {
    const rgb = key.split(',').map(Number);
    if (colors.some(([, c]) => near(c, rgb))) continue;
    const named = theirs.find(([, c]) => near(c, rgb));
    failures.push(`${view} (${appearance}): a fill of ${hex(rgb)} over ${n} device px, which no ${appearance} role gives${named ? `; it is the other appearance's ${named[0]}` : ''}`);
  }
  if (!found.length) failures.push(`${view} (${appearance}): no fill at all`);
  else {
    const widest = found[0][0].split(',').map(Number);
    if (!bases.some(([, c]) => near(c, widest))) failures.push(`${view} (${appearance}): its widest fill is ${hex(widest)}, not the ground or the raised ground`);
  }
  const shown = inks.map(([name, rgb]) => [name, pixelsNear(image, rgb)]).filter(([, n]) => n >= INK);
  if (!shown.length) failures.push(`${view} (${appearance}): no text in an ink tier over the ground or the raised ground (${INK} device px of one)`);
  return failures;
}

/** AC3's contrast half: each ink tier's floor on ground, raised and hover (over ground and over raised), from the roles. */
export function inkProblems(appearance, roles, floors, contrast) {
  const color = (role) => parseColor(roles?.[role]);
  const [ground, raised, hover] = ['ground', 'raised', 'hover'].map(color);
  if (!ground || !raised || !hover) return [`${appearance}: no ground, raised or hover role`];
  const surfaces = [['ground', ground.rgb], ['raised', raised.rgb], ['hover over ground', over(hover, ground.rgb)], ['hover over raised', over(hover, raised.rgb)]];
  const problems = [];
  for (const [tier, floor] of Object.entries(floors)) {
    const ink = color(tier);
    if (!ink) {
      problems.push(`${appearance}: no ${tier}`);
      continue;
    }
    for (const [name, rgb] of surfaces) {
      const ratio = contrast(over(ink, rgb), rgb);
      if (ratio < floor) problems.push(`${appearance}: ${tier} on ${name} is ${ratio.toFixed(2)}:1, under ${floor}:1`);
    }
  }
  return problems;
}
