#!/usr/bin/env node
// Generates skills/deepbuild-canvas/SKILL.md (#508), the one skill an outside agent learns our documents from
// (technical design: For an outside agent), from the kinds' schemas: the canvas core's own listing as
// `deep-show kinds --dump` writes it (kinds.dump@1), the document keys the core reads, craft@1's table
// (crates/deep-canvas/src/craft.json) and the gallery's figure (crates/deep-show/gallery/figure.json). Never edit the
// skill by hand. --check exits 1 when the skill on disk isn't what this writes, naming the first differing line, or
// when it names a name@major the listing doesn't hold.
//   node scripts/canvas-skill.mjs [--check]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'skills/deepbuild-canvas/SKILL.md';
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

/** The canvas core's listing: this checkout's deep-show, built with the full set as the hub runs it, dumped now. */
function dumpKinds() {
  const env = { ...process.env, CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0' };
  try {
    execFileSync('cargo', ['build', '--locked', '--quiet', '--bin', 'deep-show', '--no-default-features', '--features', 'full'], { cwd: ROOT, env, stdio: 'pipe', maxBuffer: 256 << 20 });
  } catch (e) {
    throw Error(`deep-show doesn't build, so the kinds can't be listed: ${String(e.stderr ?? e.message).slice(-4000)}`);
  }
  const show = join(process.env.CARGO_TARGET_DIR ?? join(ROOT, 'target'), 'debug', 'deep-show');
  const dir = mkdtempSync(join(tmpdir(), 'deep-kinds-'));
  try {
    execFileSync(show, ['kinds', '--dump', dir], { stdio: ['ignore', 'ignore', 'inherit'] });
    const [file, ...more] = readdirSync(dir).filter((f) => f.endsWith('.json'));
    if (!file || more.length) throw Error(`deep-show kinds --dump wrote ${more.length + Number(Boolean(file))} dumps, not one`);
    return JSON.parse(readFileSync(join(dir, file), 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A `const NAME: &[&str] = &[…];` list from a canvas core source file, comments left out. */
function rustList(file, name) {
  const block = new RegExp(`const ${name}: &\\[&str\\] = &\\[([\\s\\S]*?)\\];`).exec(read(file));
  if (!block) throw Error(`${file} has no ${name}`);
  return [...block[1].replace(/\/\/.*$/gm, '').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** What each envelope key an agent writes first is for; every other key the core reads is listed by name. */
const ENVELOPE = {
  format: 'always 1.',
  profile: '"figure" for a figure you can play with; the profiles are listed below.',
  title: 'a short name.',
  description: 'one sentence on what it shows; it is the accessible description.',
  size: '[width, height] in px, such as [1280, 720].',
  camera: 'the ID of the camera@1 item the view looks through.',
  requires: '{"modules": {"scene3d": "^1", "motion": "^1", "input": "^1"}} for a 3D figure with controls.',
  transport: '{"span": "6s", "frame_rate": [60, 1]}: its length, at least a few seconds, and its frame rate.',
  items: 'every item by its ID; each item repeats its ID and has a kind, a name and an order (below).',
  assemblies: 'parts that move together: {"parent": null | assembly ID, "at": {"pos": [x, y, z]}, "motion": {"kind": "slide", "axis": [x, y, z], "range": [min, max]}, "value": 0, "apart": [x, y, z], "order": n}. A part joins an assembly by naming it as its parent.',
  controls: 'what a viewer sets. A slider: {"kind": "slider", "class": "document", "label": "Throttle", "role": "slider", "range": [0, 1], "default": 0, "increment": 0.01}. Stages: {"kind": "stages", "class": "document", "label": "View", "role": "group", "default": "<stage>", "stages": {"<stage>": {"label": "…", "shot": "<shot ID>"}}}.',
  drivers: 'a value computed from others every frame: {"target": "<path>", "expr": "numeric expression", "vars": {"s": "controls/<control ID>/value"}}. A target is "items/<ID>/params/<field>[/<field>…]", "assemblies/<ID>/value" or "data/<name>". Expressions are numeric and loop-free.',
  channels: 'keyed values over time at a target path.',
  shots: 'camera framings a stage names: {"camera": "<camera ID>", "move": "hold", "target": [x, y, z], "orbit": {"azimuth": deg, "elevation": deg, "distance": m}}.',
  card: 'the figure card: {"fig": "Fig. 1", "title": "…", "hint": "…", "readout": "…"}; a readout is a template whose {path} slots read values, such as "Throttle {controls/throttle/value}".',
  variants: 'named sets of patches a choice control picks between.',
  packs: 'the packs it names, such as the pack of a piece recipe.',
  audit: '{"support": {"floating": ["<item ID>"]}}: the items the geometry audit takes as held in place, such as a floor.',
};
/** The craft@1 checks, as the checks themselves read them (#409). */
const CRAFT = JSON.parse(read('crates/deep-canvas/src/craft.json'));
/** A field in brief: its name, then its type (unless free JSON), unit, [min, max] and = default (unless none). */
const fieldLine = (f) => {
  const type = f.type === 'json' ? '' : f.list ? `[${f.type}]` : f.type;
  const what = [type, f.unit ?? '', Array.isArray(f.range) ? `[${f.range.map((n) => (n === null ? '…' : n)).join(', ')}]` : ''].filter(Boolean).join(' ');
  return `${f.name}${what ? `: ${what}` : ''}${f.default !== undefined && f.default !== null ? ` = ${JSON.stringify(f.default)}` : ''}`;
};
/** Every `name@major` a text names. */
const namedKinds = (text) => [...new Set(text.match(/\b[a-z][a-z0-9_.]*[a-z0-9_]@\d+\b/g) ?? [])];

/** The skill, from a kinds.dump@1 value. */
export function canvasSkill(dump) {
  if (dump?.format !== 'kinds.dump@1') throw Error('the kinds listing is not a kinds.dump@1 dump');
  const { version } = JSON.parse(read('packages/hub/package.json'));
  const keys = rustList('crates/deep-canvas/src/document/mod.rs', 'ENVELOPE_KEYS');
  for (const key of Object.keys(ENVELOPE)) if (!keys.includes(key)) throw Error(`the skill explains the envelope key ${key}, which the canvas core no longer reads`);
  const itemKeys = rustList('crates/deep-canvas/src/document/mod.rs', 'ITEM_KEYS').filter((k) => k !== 'layer');
  const profiles = rustList('crates/deep-canvas/src/document/check.rs', 'PROFILES');
  const roles = rustList('crates/deep-canvas/src/document/check.rs', 'ROLES');
  const figure = read('crates/deep-show/gallery/figure.json').trim();
  // Recipes first (technical design: piece recipes first), then each registry in the listing's order.
  const registries = [...dump.registries].sort((a, b) => Number(!/recipe/.test(a.name)) - Number(!/recipe/.test(b.name)));
  return [
    '---',
    'name: deepbuild-canvas',
    `description: Teaches writing DeepBuild canvas documents (figures, films, boards and pieces) as JSON, and the craft rules their checks hold them to. Use it to draw in DeepBuild. Generated from DeepBuild ${version}'s kinds' schemas, module set ${dump.module_set}; never edit by hand.`,
    `version: ${version}`,
    '---',
    '',
    '# Drawing in DeepBuild',
    '',
    'You draw in DeepBuild by writing a document: JSON data that names kinds and their fields, never code that runs per frame. Every frame is a function of the time and the controls, so seeking equals playing. A figure explains and never proves: only check results are evidence, never a picture. Write only the kinds and fields this skill lists. When none does what you need, say what is missing instead of approximating it.',
    '',
    '## The working order',
    '',
    '1. Start from a piece recipe or a gallery example. The figure below is one; `deep kinds --dump <folder>` writes this core\'s whole listing.',
    '2. Write the document to a file and check it: `deep show --doc <doc ID> --document <file> --check --snap --json`, or the deep_show tool. It answers with the document\'s issues and snapshots by hash. Fix every error first.',
    '3. Fix by patch: change one item at a time, check again, and judge by the numbers and the issues, never by eye.',
    '4. Export: `deep export --document <file> --still <frame | marker> --out <file.png>`.',
    '5. Open the file you exported.',
    '',
    'With no tool that checks, copy the example below and change only what the task needs, keeping every key it writes.',
    '',
    '## The document',
    '',
    'A document is one JSON object. The keys to write first:',
    '',
    ...Object.entries(ENVELOPE).map(([k, what]) => `- ${k}: ${what}`),
    '',
    `Every key the core reads: ${keys.filter((k) => k !== 'layers').join(', ')}. Leave out layers and each item's layer: the hub stamps them from your connection.`,
    '',
    `An item is {"id": "<its key in items>", "kind": "name@major", "name": "a readable name", "order": "a0", "params": {…}, "at": {"pos": [x, y, z]}}. id, kind, name and order are required; order is a sort key, "a0", "a1" and so on, unique in the document. parent names an item or an assembly. Its keys: ${itemKeys.join(', ')}. Its role is one of ${roles.join(', ')}.`,
    '',
    `Profiles: ${profiles.join(', ')}. In 3D, units are metres with +Y up and at.pos is the item's centre; in 2D, px with y down. Times are strings such as "1.5s". A paint is {"fill": {"role": "accent"}}, a look role and never a raw color: accent, ink, muted, raised.`,
    '',
    '## Stills, formulas, simulations and web pages',
    '',
    '- A still comes in as SVG through a vector@1 item: the file goes in by its sha256 hash (src), and every SVG color maps to a look role in colors. The import runs no script and loads nothing from the network. A <text> element is refused (convert it to outlines), and filters and embedded rasters come back as issues naming the element.',
    '- A formula comes from the typeset job (deep_job): LaTeX or Typst in, an SVG with one id per term out, which a vector@1 item imports. Never set a formula as text.',
    '- An offline simulation comes in as an agent bake: per-frame rows or meshes you computed yourself, played by time. Its values count as your word, never as a reading. Reach for a bake before logic.',
    '- A web page opens in your browser, never in the canvas.',
    '',
    '## Explainer effects',
    '',
    'An effect@1 item draws an explainer effect at its anchor: {"kind": "effect@1", "params": {"kind": "<effect kind>", "anchor": "<item ID>", "axis": [x, y, z], "<effect kind>": {…its own params}}}. Each kind\'s params sit under its own name; the kinds and their params are under effect@1 in the kinds below. A driver can set one of them from a control, such as "items/plume/params/plume/reach". An effect never feeds a check.',
    '',
    `## Craft checks (${CRAFT.pack})`,
    '',
    'A film\'s brief names the checks it wants; each runs only when named and never passes a film on its own.',
    '',
    ...CRAFT.checks.map((c) => `- ${c.name}. ${c.description} Threshold: ${c.threshold}. Fix: ${c.fix}`),
    '',
    '## Example: a figure that passes the checks',
    '',
    '```json',
    figure,
    '```',
    '',
    `## Kinds (module set ${dump.module_set})`,
    '',
    'Each entry as name@major, with its origin when not first party and its stability when not stable; then its fields as name: type, unit, [min, max] and = default, each left out when it has none. Entries with no fields share one line.',
    '',
    ...registries.flatMap((r) => {
      const tag = (e) => { const notes = [e.origin === 'first_party' ? '' : e.origin, e.stability === 'stable' ? '' : e.stability].filter(Boolean); return notes.length ? `${e.name} (${notes.join(', ')})` : e.name; };
      const bare = r.entries.filter((e) => !e.fields.length);
      return r.entries.length ? [
        `### ${r.name}`,
        '',
        ...r.entries.filter((e) => e.fields.length).map((e) => `- ${tag(e)}: ${e.fields.map(fieldLine).join('; ')}`),
        ...(bare.length ? [`- ${bare.map(tag).join(', ')}`] : []),
        '',
      ] : [];
    }),
  ].join('\n');
}

/** What drifted: the skill on disk against what this writes, and each name@major it names that the listing lacks. */
export function drift(dump, onDisk) {
  const out = [];
  const text = canvasSkill(dump);
  if (onDisk === null) out.push(`${OUT} is missing; run node scripts/canvas-skill.mjs`);
  else if (onDisk !== text) {
    const [a, b] = [onDisk.split('\n'), text.split('\n')];
    let at = 0;
    while (a[at] === b[at]) at++;
    out.push(`${OUT} differs from what scripts/canvas-skill.mjs writes at line ${at + 1}: it has ${JSON.stringify(a[at] ?? '(the end)')}, the generator writes ${JSON.stringify(b[at] ?? '(the end)')}`);
  }
  // craft@1's own words name packs, which the listing doesn't hold; #409's suite pins those.
  const listed = new Set([...dump.registries.flatMap((r) => [r.name, ...r.entries.map((e) => e.name)]), ...namedKinds(JSON.stringify(CRAFT))]);
  for (const name of namedKinds(onDisk ?? '')) if (!listed.has(name)) out.push(`${OUT} names ${name}, which the kinds listing doesn't hold`);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dump = dumpKinds();
  if (process.argv.includes('--check')) {
    const found = drift(dump, existsSync(join(ROOT, OUT)) ? read(OUT) : null);
    for (const line of found) process.stderr.write(`${line}\n`);
    process.exit(found.length ? 1 : 0);
  }
  mkdirSync(dirname(join(ROOT, OUT)), { recursive: true });
  writeFileSync(join(ROOT, OUT), canvasSkill(dump));
}
