// The canvas text call-site lint (#390): no crate that shapes or draws the canvas's text calls into
// GPUI's text system. Its scope is every workspace member named `deep-text*` plus every member whose
// manifest says `[package.metadata.deep] canvas_text = true`, read from cargo metadata; the app's
// chrome, outside the scope, keeps GPUI's own text. One FAIL line per call site, `<file>:<line>:<col>`
// relative to the workspace root; exit 1 on a finding, 2 when the workspace can't be read.
//
//   node scripts/text-lint.mjs [--root <workspace dir>]
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripRust } from './rust-source.mjs';

const scopePrefix = 'deep-text';
const scopeMarker = 'canvas_text';
// GPUI 0.3.9's text system by name, whichever crate provides it: the accessor, its shapers, the
// window's glyph painter, and its shaped-text and text-system types. A name is a finding however
// it is reached: a method call, `Window::text_system(w)`, a function item bound to a variable.
const forms = [
  { form: 'text-system', pattern: /\btext_system\b/g, what: 'text_system, the GPUI text system accessor' },
  { form: 'shape-line', pattern: /\bshape_line\b/g, what: 'shape_line, a GPUI text system shaper' },
  { form: 'shape-text', pattern: /\bshape_text\b/g, what: 'shape_text, a GPUI text system shaper' },
  { form: 'layout-line', pattern: /\blayout_line\b/g, what: 'layout_line, a GPUI text system shaper' },
  { form: 'paint-glyph', pattern: /\bpaint_(?:glyph|emoji)\b/g, what: 'paint_glyph, GPUI\'s glyph painter' },
  { form: 'styled-text', pattern: /\bStyledText\b/g, what: 'the type StyledText' },
  { form: 'shaped-line', pattern: /\bShapedLine\b/g, what: 'the type ShapedLine' },
  { form: 'wrapped-line', pattern: /\bWrappedLine\b/g, what: 'the type WrappedLine' },
  { form: 'text-system-type', pattern: /\b(?:Window)?TextSystem\b/g, what: 'the type TextSystem' },
];

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const rootArg = rootIndex >= 0 ? args[rootIndex + 1] : fileURLToPath(new URL('../', import.meta.url));
if (!rootArg) {
  console.log('BLOCKED text-lint: --root needs a workspace directory');
  process.exit(2);
}
// Resolved as cargo resolves manifest paths, so a finding's path is relative to the workspace.
const root = realpathSync(rootArg);

const metadata = spawnSync('cargo', ['metadata', '--format-version', '1', '--no-deps', '--offline'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (metadata.error || metadata.status !== 0) {
  console.log(`BLOCKED text-lint: cargo metadata could not read ${root}: ${metadata.error?.message ?? metadata.stderr.trim()}`);
  process.exit(2);
}
const { packages, workspace_members: members } = JSON.parse(metadata.stdout);
const scope = packages.filter((p) => members.includes(p.id) && (p.name.startsWith(scopePrefix) || p.metadata?.deep?.[scopeMarker] === true));

/** Every .rs file under a directory, target/ left out. */
function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'target') out.push(...sources(path)); } else if (entry.name.endsWith('.rs')) out.push(path);
  }
  return out.sort();
}

let findings = 0;
for (const pkg of scope) {
  for (const file of sources(dirname(pkg.manifest_path))) {
    const text = readFileSync(file, 'utf8');
    // Comments and literals blanked, so a doc line naming a call or a message quoting it is no
    // finding, and a string holding `//` or a char `'"'` hides nothing after it.
    const stripped = stripRust(text);
    const starts = [0];
    for (let i = 0; i < stripped.length; i++) if (stripped[i] === '\n') starts.push(i + 1);
    for (const { form, pattern, what } of forms) {
      for (const match of stripped.matchAll(pattern)) {
        let line = starts.findIndex((start) => start > match.index);
        line = line < 0 ? starts.length : line;
        const column = match.index - starts[line - 1] + 1;
        findings++;
        console.log(`FAIL text-lint ${form}: ${relative(root, file)}:${line}:${column} holds ${what}; the canvas's text comes from deep-text's shaper and atlas, never GPUI's text system`);
      }
    }
  }
}
if (findings) {
  console.log(`  Fix: shape through deep-text and draw through the GPUI patch's mask sprite (Window::paint_mask_sprite) instead.`);
  process.exit(1);
}
console.log(`PASS text-lint: ${scope.length} crate${scope.length === 1 ? '' : 's'} in scope (${scope.map((p) => p.name).join(', ') || 'none'}), no call into GPUI's text system`);
