import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LINT, SCOPE_MARKER } from './helpers.ts';

// The eight planted call sites into GPUI's text system, each on one marked line, once per crate. The
// clean twins do the same job through the canvas's own shaper and the patch's sprite. A lint that flags
// the twins, or the chrome crate outside its scope, is as wrong as one that misses the plants.
const FORMS = ['text-system', 'shape-line', 'shape-text', 'layout-line', 'paint-glyph', 'styled-text', 'shaped-line', 'wrapped-line'] as const;

const PLANTED = `#![allow(unused)]
use gpui::Window;

pub struct Drawn {
    pub glyphs: usize,
}

pub fn draw(window: &Window) -> Drawn {
    let system = window.text_system(); // plant: text-system
    let line = system.shape_line("Ready"); // plant: shape-line
    let wrapped = system.shape_text("Ready"); // plant: shape-text
    let laid = system.layout_line("Ready"); // plant: layout-line
    window.paint_glyph(7); // plant: paint-glyph
    let styled = gpui::StyledText::new("Ready"); // plant: styled-text
    let shaped: Option<gpui::ShapedLine> = None; // plant: shaped-line
    let lines: Vec<gpui::WrappedLine> = Vec::new(); // plant: wrapped-line
    Drawn { glyphs: wrapped.len() + lines.len() + shaped.is_some() as usize }
}
`;

const CLEAN = `#![allow(unused)]
use gpui::Window;

pub struct Drawn {
    pub glyphs: usize,
}

pub fn draw(window: &Window) -> Drawn {
    let shaper = atlas::Shaper::new(); // twin: the canvas's own shaper
    let run = shaper.shape_run("Ready"); // twin: one shaped run
    let runs = shaper.shape_runs("Ready"); // twin: several
    let placed = shaper.place_run("Ready"); // twin: placed
    window.paint_tinted_mask(7); // twin: the patch's tinted mask sprite
    let label = atlas::Label::new("Ready"); // twin: a label
    let shaped: Option<atlas::ShapedRun> = None; // twin: a run
    let lines: Vec<atlas::Line> = Vec::new(); // twin: lines
    Drawn { glyphs: runs.len() + lines.len() + shaped.is_some() as usize }
}
`;

/** The 1-based line of each planted form in a source. */
function plantedLines(source: string): Record<string, number> {
  const lines: Record<string, number> = {};
  source.split('\n').forEach((line, i) => {
    const m = /\/\/ plant: ([a-z-]+)/.exec(line);
    if (m) lines[m[1]!] = i + 1;
  });
  return lines;
}

const GPUI_STUB = `pub struct Window;
pub struct TextSystem;
pub struct ShapedLine;
pub struct WrappedLine;
pub struct StyledText;
impl Window {
    pub fn text_system(&self) -> TextSystem {
        TextSystem
    }
    pub fn paint_glyph(&self, _glyph: u32) {}
    pub fn paint_tinted_mask(&self, _sprite: u32) {}
}
impl TextSystem {
    pub fn shape_line(&self, _text: &str) -> ShapedLine {
        ShapedLine
    }
    pub fn shape_text(&self, _text: &str) -> Vec<WrappedLine> {
        Vec::new()
    }
    pub fn layout_line(&self, _text: &str) -> ShapedLine {
        ShapedLine
    }
}
impl StyledText {
    pub fn new(_text: &str) -> Self {
        StyledText
    }
}
`;

const ATLAS_STUB = `pub struct Shaper;
pub struct ShapedRun;
pub struct Line;
pub struct Label;
impl Shaper {
    pub fn new() -> Self {
        Shaper
    }
    pub fn shape_run(&self, _text: &str) -> ShapedRun {
        ShapedRun
    }
    pub fn shape_runs(&self, _text: &str) -> Vec<ShapedRun> {
        Vec::new()
    }
    pub fn place_run(&self, _text: &str) -> ShapedRun {
        ShapedRun
    }
}
impl Label {
    pub fn new(_text: &str) -> Self {
        Label
    }
}
`;

/** A throwaway workspace: a prefix crate, a marked drawing crate, an unmarked chrome crate, and stub
 * \`gpui\` and \`atlas\` path crates (not members) so the workspace resolves and builds offline. */
function workspace(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'deep-390-lint-'));
  const crate = (where: string, manifestExtra: string, lib: string): void => {
    const name = where.split('/').at(-1)!;
    mkdirSync(join(dir, where, 'src'), { recursive: true });
    writeFileSync(join(dir, where, 'Cargo.toml'), `[package]\nname = "${name}"\nversion = "0.0.0"\nedition = "2021"\npublish = false\n${manifestExtra}`);
    writeFileSync(join(dir, where, 'src', 'lib.rs'), lib);
  };
  writeFileSync(join(dir, 'Cargo.toml'), '[workspace]\nmembers = ["deep-text-planted", "drawer-planted", "chrome-planted"]\nexclude = ["stubs/gpui", "stubs/atlas"]\nresolver = "2"\n');
  const deps = '\n[dependencies]\ngpui = { path = "../stubs/gpui" }\natlas = { path = "../stubs/atlas" }\n';
  crate('deep-text-planted', `${deps}\n[package.metadata.deep]\n${SCOPE_MARKER} = false\n`, source);
  crate('drawer-planted', `${deps}\n[package.metadata.deep]\n${SCOPE_MARKER} = true\n`, source);
  crate('chrome-planted', `${deps}\n`, source);
  crate('stubs/gpui', '', GPUI_STUB);
  crate('stubs/atlas', '', ATLAS_STUB);
  return dir;
}

const scratch: string[] = [];
afterAll(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });

function lint(root: string): { status: number | null; output: string } {
  const run = spawnSync(process.execPath, [LINT, '--root', root], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) throw Error(`scripts/text-lint.mjs: ${run.error.message}`);
  return { status: run.status, output: `${run.stdout}\n${run.stderr}` };
}

describe('AC3 the call-site lint refuses every call into GPUI\'s text system in the text crate and in a crate that draws canvas text, and passes their clean twins', () => {
  it('AC3 each of the eight forms, planted once in each scope crate, fails the lint naming its file and line; the chrome crate outside the scope is not named', () => {
    expect(existsSync(LINT), 'scripts/text-lint.mjs exists').toBe(true);
    const root = workspace(PLANTED);
    scratch.push(root);
    const lines = plantedLines(PLANTED);
    expect(Object.keys(lines).sort()).toEqual([...FORMS].sort());
    const result = lint(root);
    expect(result.status, `the lint passed the planted workspace:\n${result.output}`).not.toBe(0);
    const findings = result.output.split('\n').filter((line) => /^FAIL\b/.test(line.trim()));
    for (const crate of ['deep-text-planted', 'drawer-planted']) {
      for (const form of FORMS) {
        const where = `${crate}/src/lib.rs:${lines[form]}`;
        const found = findings.some((line) => line.includes(where) || line.includes(where.replace(/\//g, '\\')));
        expect(found, `${form} in ${crate}: no FAIL line names ${where}; the lint printed:\n${result.output}`).toBe(true);
      }
    }
    // GPUI's own text stays for the app's chrome: a crate outside the scope is not the lint's business.
    expect(findings.filter((line) => line.includes('chrome-planted')), `the chrome crate, outside the scope, is not named:\n${result.output}`).toEqual([]);
  }, 600_000);

  it('AC3 the clean twins pass the lint', () => {
    const root = workspace(CLEAN);
    scratch.push(root);
    const result = lint(root);
    expect(result.status, `the lint failed the clean twins:\n${result.output}`).toBe(0);
    expect(result.output.split('\n').filter((line) => /^FAIL\b/.test(line.trim())), 'no FAIL line on the twins').toEqual([]);
  }, 600_000);
});
