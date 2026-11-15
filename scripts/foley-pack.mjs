// The foley@1 pack written from data (issue #155; canvas primitives: Foley `foley.render@1`, Synth `synth@1`): one
// synth.preset@1 entry per (material, action), 10 materials × 9 actions, keyed `<material>.<action>@1` so a document
// names `foley.<material>.<action>@1`. Every preset is built over synth's closed node list from the two tables here: a
// material sets its noise colour, its tone filter, its body's modes (ratios and t60s) and how much of each it sounds;
// an action sets the envelope that excites it (a short burst for tap, hit, click and pop; sustained filtered noise for
// scrape, slide and whoosh; a torn crackle for tear; a pitched drop for drip). Each declares `vel` (0 to 1, the level
// foley.render plays it at), which scales its output, and holds a `noise` node, so each round robin's noise key
// renders different samples. Each part's gain is measured once here by rendering it with the job's own synth module
// (packages/jobs/foley/tool/synth.wasm), so every preset peaks near PEAK at vel 1, with its parts in the tables'
// proportions. Rerun it after a table or the synth module changes; the pack's version changes with its bytes.
//
// Usage: node scripts/foley-pack.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { note } from '../packages/jobs/foley/tool/synth.mjs';
import { GATES } from '../packages/jobs/foley/tool/variants.mjs';

const OUT = fileURLToPath(new URL('../packs/foley-1.0.0/pack.json', import.meta.url));
const RATE = 48000;
/** The peak every preset is trimmed to at vel 1, below the synth's sweep bound of 4. */
const PEAK = 0.7;
/** The noise keys the gains are measured over. */
const KEYS = [1, 2, 3, 4];

/**
 * A material: its noise colour, its tone filter [type, Hz, Q], its body's modes, a pitched part's wave, and how much of
 * its body and its noise it sounds; `crush` gives it a digital grit.
 */
const MATERIALS = {
  paper: { color: 'white', filter: ['bandpass', 3500, 0.8], modes: { hz: 900, ratios: [1, 2.31, 3.87], t60s: [0.03, 0.02, 0.015] }, body: 0.25, noise: 1 },
  wood: { color: 'pink', filter: ['lowpass', 2200, 0.7], modes: { hz: 320, ratios: [1, 2.76, 5.4], t60s: [0.14, 0.07, 0.035] }, body: 1, noise: 0.35 },
  metal: { color: 'white', filter: ['highpass', 2500, 0.7], modes: { hz: 520, ratios: [1, 2.76, 5.4, 8.93], t60s: [0.9, 0.7, 0.5, 0.35] }, body: 1, noise: 0.25 },
  glass: { color: 'white', filter: ['highpass', 4000, 0.7], modes: { hz: 1450, ratios: [1, 2.32, 4.25, 6.63], t60s: [0.6, 0.45, 0.3, 0.2] }, body: 1, noise: 0.2 },
  plastic: { color: 'white', filter: ['bandpass', 2200, 1], modes: { hz: 640, ratios: [1, 1.83, 3.12], t60s: [0.07, 0.045, 0.03] }, body: 0.7, noise: 0.5 },
  rubber: { color: 'brown', filter: ['lowpass', 700, 0.8], modes: { hz: 170, ratios: [1, 1.59], t60s: [0.05, 0.03] }, body: 0.8, noise: 0.5 },
  ink: { color: 'pink', filter: ['bandpass', 1300, 2], modes: { hz: 720, ratios: [1, 2.08], t60s: [0.03, 0.02] }, body: 0.4, noise: 1 },
  cloth: { color: 'pink', filter: ['lowpass', 1600, 0.6], modes: { hz: 240, ratios: [1, 1.93], t60s: [0.02, 0.015] }, body: 0.2, noise: 1 },
  stone: { color: 'brown', filter: ['lowpass', 3200, 0.7], modes: { hz: 210, ratios: [1, 1.73, 2.91, 4.37], t60s: [0.16, 0.1, 0.06, 0.04] }, body: 0.9, noise: 0.5 },
  electronic: { color: 'white', filter: ['bandpass', 3000, 1.5], modes: { hz: 1000, ratios: [1, 2, 3], t60s: [0.12, 0.08, 0.05] }, body: 0.6, noise: 0.4, wave: 'square', crush: { bits: 6, hold_hz: 11025, mix: 0.7 } },
};

/**
 * An action: its envelope [attack, hold, decay, sustain, release] in seconds, how much body, noise and pitched part it
 * sounds (times the material's), its filter's frequency factor, and its texture: `rough` (a slow random level on the
 * noise: [lowpass Hz, depth]), `crackle` (the noise gated on and off at random: [lowpass Hz, depth, hold Hz]) or
 * `pitch` (a sine that falls or rises: [its Hz × the body's, its sweep × that, the sweep's envelope]).
 */
const ACTIONS = {
  tap: { env: [0.0005, 0, 0.012, 0, 0.005], body: 1, noise: 0.5, freq: 1 },
  hit: { env: [0.001, 0.004, 0.05, 0, 0.02], body: 1.2, noise: 0.7, freq: 0.75 },
  click: { env: [0.0002, 0, 0.003, 0, 0.002], body: 0.4, noise: 1, freq: 1.6, bodyHz: 2 },
  pop: { env: [0.001, 0, 0.07, 0, 0.02], body: 0.2, noise: 0.3, freq: 1, pitch: [0.6, 1.5, [0, 0, 0.03, 0, 0.01]] },
  drip: { env: [0.001, 0, 0.09, 0, 0.02], body: 0.15, noise: 0.15, freq: 1, pitch: [0.9, 1.2, [0.05, 0, 0, 1, 0.01]] },
  scrape: { env: [0.02, 0, 0.12, 0.7, 0.08], body: 0.35, noise: 1, freq: 1, rough: [30, 6] },
  slide: { env: [0.06, 0, 0.15, 0.8, 0.12], body: 0.15, noise: 1, freq: 0.6, rough: [8, 2] },
  whoosh: { env: [0.3, 0, 0.3, 0.15, 0.2], body: 0, noise: 1, freq: 0.5, band: true },
  tear: { env: [0.01, 0, 0.3, 0.5, 0.08], body: 0.25, noise: 1, freq: 1.2, crackle: [60, 3, 90] },
};

const env = ([attack, hold, decay, sustain, release]) => ({ kind: 'env', attack, hold, decay, sustain, release });
const round = (x) => Number(x.toPrecision(4));
/** Multiply-adds per sample of a node with `ins` inputs (Synth: As built; deep-canvas-media's `Kind::cost`). */
function costOf(node, ins) {
  const noise = { white: 2, pink: 8, brown: 3 };
  const each = { osc: 4, env: 2, biquad: 5, shaper: 10, crush: 2, delay: 3, gain: 1, string: 6 };
  if (node.kind === 'noise') return noise[node.color];
  if (node.kind === 'modes') return 3 * node.ratios.length;
  if (node.kind === 'mix') return ins;
  return each[node.kind];
}

/** The preset for (material, action), its parts' gains `g = {body, noise, pitch}`; a part whose gain is 0 is left out. */
function build(m, a, g) {
  const nodes = { src: { kind: 'noise', color: m.color }, env: env(a.env), burst: { kind: 'gain', gain: 0 }, out: { kind: 'gain', gain: 'vel' }, sum: { kind: 'mix' } };
  const edges = [['env', 'burst', 'gain']];
  // The noise's texture, between the source and the burst.
  if (a.rough || a.crackle) {
    const [hz, depth] = a.rough ?? a.crackle;
    nodes.slow = { kind: 'noise', color: 'brown' };
    nodes.slowlp = { kind: 'biquad', type: 'lowpass', freq: hz, q: 0.7, gain: 0 };
    nodes.slowamt = { kind: 'gain', gain: depth };
    nodes.grit = { kind: 'gain', gain: a.rough ? 1 : 0 };
    edges.push(['slow', 'slowlp', 'in'], ['slowlp', 'slowamt', 'in'], ['src', 'grit', 'in'], ['grit', 'burst', 'in']);
    if (a.crackle) {
      nodes.gate = { kind: 'crush', bits: 1, hold_hz: a.crackle[2], mix: 1 };
      edges.push(['slowamt', 'gate', 'in'], ['gate', 'grit', 'gain']);
    } else edges.push(['slowamt', 'grit', 'gain']);
  } else edges.push(['src', 'burst', 'in']);
  if (g.body) {
    const ratios = m.modes.ratios.map((r) => r * (a.bodyHz ?? 1));
    nodes.body = { kind: 'modes', ratios, t60s: m.modes.t60s, hz: m.modes.hz };
    nodes.bodyamp = { kind: 'gain', gain: g.body };
    edges.push(['burst', 'body', 'in'], ['body', 'bodyamp', 'in'], ['bodyamp', 'sum', 'body']);
  }
  if (g.noise) {
    const [type, hz, q] = a.band ? ['bandpass', m.filter[1], 0.7] : m.filter;
    nodes.tone = { kind: 'biquad', type, freq: round(hz * a.freq), q, gain: 0 };
    nodes.toneamp = { kind: 'gain', gain: g.noise };
    edges.push(['burst', 'tone', 'in'], ['tone', 'toneamp', 'in'], ['toneamp', 'sum', 'noise']);
  }
  if (g.pitch) {
    const [ratio, sweep, shape] = a.pitch;
    const hz = round(m.modes.hz * ratio);
    nodes.penv = env(shape);
    nodes.sweep = { kind: 'gain', gain: round(hz * sweep) };
    nodes.osc = { kind: 'osc', wave: m.wave ?? 'sine', hz };
    nodes.oscenv = { kind: 'gain', gain: 0 };
    nodes.oscamp = { kind: 'gain', gain: g.pitch };
    edges.push(['penv', 'sweep', 'in'], ['sweep', 'osc', 'hz'], ['osc', 'oscenv', 'in'], ['env', 'oscenv', 'gain'], ['oscenv', 'oscamp', 'in'], ['oscamp', 'sum', 'pitch']);
  }
  if (m.crush) {
    nodes.grain = { kind: 'crush', ...m.crush };
    edges.push(['sum', 'grain', 'in'], ['grain', 'out', 'in']);
  } else edges.push(['sum', 'out', 'in']);
  const ins = (id) => edges.filter((e) => e[1] === id && e[2] !== 'gain' && e[2] !== 'hz').length;
  const cost = Object.entries(nodes).reduce((s, [id, n]) => s + costOf(n, ins(id)), 0);
  const sorted = Object.fromEntries(Object.keys(nodes).sort().map((id) => [id, nodes[id]]));
  return { nodes: sorted, edges, out: 'out', params: { vel: { unit: 'level', range: [0, 1], default: 1 } }, cost };
}

/** The preset's peak at vel 1 over the measuring keys, at the action's gate. */
function peak(preset, action) {
  const gate = Math.round(GATES[action] * RATE);
  let p = 0;
  for (const key of KEYS) for (const x of note({ preset, rate: RATE, gate, length: gate + RATE / 4, vel: 1, key })) p = Math.max(p, Math.abs(x));
  return p;
}

const presets = {};
for (const [mName, m] of Object.entries(MATERIALS)) {
  for (const [aName, a] of Object.entries(ACTIONS)) {
    const want = { body: m.body * a.body, noise: m.noise * a.noise, pitch: a.pitch ? 1 : 0 };
    // Each part alone at gain 1, then each scaled to its share, then the whole trimmed to PEAK.
    const g = {};
    for (const part of Object.keys(want)) {
      if (!want[part]) continue;
      const alone = { body: 0, noise: 0, pitch: 0, [part]: 1 };
      g[part] = want[part] / peak(build(m, a, alone), aName);
    }
    const trim = PEAK / peak(build(m, a, g), aName);
    for (const part of Object.keys(g)) g[part] = round(g[part] * trim);
    presets[`${mName}.${aName}@1`] = build(m, a, g);
  }
}

const manifest = {
  name: 'foley',
  version: '1.0.0',
  license: 'Apache-2.0',
  description: 'foley@1, the first-party pack of foley presets (canvas primitives: Foley `foley.render@1`): one synth.preset@1 entry per (material, action), named foley.<material>.<action>@1, over synth\'s closed node list, each with a `vel` param that scales it and a noise node that each round robin hashes. foley.render renders each into 3 levels × 4 round robins. Written by scripts/foley-pack.mjs.',
  requires: { core: '>=0.0.0', modules: { media: '>=0.0.0' } },
  presets,
};
// One preset a line.
const lines = Object.entries(presets).map(([k, p]) => `    ${JSON.stringify(k)}: ${JSON.stringify(p)}`);
writeFileSync(OUT, `${JSON.stringify({ ...manifest, presets: {} }, null, 2).replace('"presets": {}', `"presets": {\n${lines.join(',\n')}\n  }`)}\n`);
console.log(`${OUT}: ${Object.keys(presets).length} presets`);
