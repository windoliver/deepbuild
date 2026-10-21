// The canvas text call-site lint's token walk (issue #390): a call into GPUI's text system is a
// finding however the line reaches it, after a string holding `//`, after a char literal `'"'`, as
// `Window::text_system(window)` or as a function item; the names in comments and literals alone
// pass. The eight planted method forms and the scope rules are the acceptance suite's
// (tests/acceptance/390/lint.test.ts); this covers the ways a line can hide one from a text scan.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const lintScript = fileURLToPath(new URL('../scripts/text-lint.mjs', import.meta.url));

/** A throwaway workspace with one scope crate (by its deep-text prefix) holding `lib`. */
function lint(t, lib) {
  const dir = mkdtempSync(join(tmpdir(), 'deep-text-lint-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'Cargo.toml'), '[workspace]\nmembers = ["deep-text-planted"]\nresolver = "2"\n');
  mkdirSync(join(dir, 'deep-text-planted', 'src'), { recursive: true });
  writeFileSync(join(dir, 'deep-text-planted', 'Cargo.toml'), '[package]\nname = "deep-text-planted"\nversion = "0.0.0"\nedition = "2021"\npublish = false\n');
  writeFileSync(join(dir, 'deep-text-planted', 'src', 'lib.rs'), lib);
  const run = spawnSync(process.execPath, [lintScript, '--root', dir], { encoding: 'utf8' });
  assert.equal(run.error, undefined);
  return { status: run.status, output: `${run.stdout}\n${run.stderr}` };
}

const plants = [
  ['a string holding // before the call', 'let _url = "https://example"; let _s = window.text_system(); // plant', 'text-system'],
  ['a char literal \'"\' before the call', 'let _quote = \'"\'; let _s = window.text_system(); // plant', 'text-system'],
  ['the accessor called as Window::text_system(window)', 'let _s = Window::text_system(window); // plant', 'text-system'],
  ['a shaper bound as a function item', 'let _shape = TextSystem::shape_text; // plant', 'shape-text'],
];

for (const [name, line, form] of plants) {
  test(`${name} fails the text lint naming its line`, (t) => {
    const lib = `pub fn planted(window: &Window) {\n    ${line}\n}\n`;
    const { status, output } = lint(t, lib);
    assert.equal(status, 1, output);
    assert.match(output, new RegExp(`^FAIL text-lint ${form}: deep-text-planted/src/lib\\.rs:2:\\d+ `, 'm'), output);
  });
}

test('the names in comments, strings, raw strings and chars alone pass the text lint', (t) => {
  const lib = [
    '//! Never window.text_system() or TextSystem::shape_line here; see shape_text in the design.',
    'pub fn twin() -> usize {',
    '    /* layout_line, paint_glyph, in a /* nested */ block */',
    '    let names = ("text_system", r#"ShapedLine"#, b"WrappedLine", \'"\', "StyledText"); // text_system',
    '    names.0.len()',
    '}',
    '',
  ].join('\n');
  const { status, output } = lint(t, lib);
  assert.equal(status, 0, output);
  assert.doesNotMatch(output, /^FAIL/m, output);
});
