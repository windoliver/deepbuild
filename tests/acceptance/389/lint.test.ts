import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LINT } from './helpers.ts';

// The seven planted forms, each on one marked line, once per crate. The clean twins replace each form
// with code that does the same job without it. A lint that flags the twins is as wrong as one that misses
// the plants.
const FORMS = ['method-sin', 'path-sin', 'glam-rename', 'powi', 'instant-now', 'thread-rng', 'hashmap-iter'] as const;

const PLANTED = `use std::collections::HashMap;
use glam::Vec4 as V; // plant: glam-rename

pub struct Reading {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub elapsed: u64,
    pub draw: u64,
    pub out: Vec<f64>,
}

pub fn evaluate(x: f64, v: f64, m: &HashMap<u32, f64>) -> Reading {
    let _unused: Option<V> = None;
    let a = x.sin(); // plant: method-sin
    let b = f64::sin(x); // plant: path-sin
    let c = v.powi(3); // plant: powi
    let started = std::time::Instant::now(); // plant: instant-now
    let draw = rand::thread_rng().next_u64(); // plant: thread-rng
    let out: Vec<f64> = m.values().copied().collect(); // plant: hashmap-iter
    Reading { a, b, c, elapsed: started.elapsed().as_nanos() as u64, draw, out }
}
`;

const CLEAN = `use std::collections::BTreeMap;
use core::f64::consts::PI as P; // twin: glam-rename (a renamed import that is not glam)

pub struct Reading {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub elapsed: u64,
    pub draw: u64,
    pub out: Vec<f64>,
}

fn seeded(seed: u64) -> u64 {
    seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407)
}

pub fn evaluate(x: f64, v: f64, m: &BTreeMap<u32, f64>) -> Reading {
    let a = x * x; // twin: method-sin
    let b = f64::max(x, P); // twin: path-sin
    let c = v * v * v; // twin: powi
    let elapsed = std::time::Duration::from_secs(1).as_nanos() as u64; // twin: instant-now
    let draw = seeded(7); // twin: thread-rng
    let out: Vec<f64> = m.values().copied().collect(); // twin: hashmap-iter (a BTreeMap has an order)
    Reading { a, b, c, elapsed, draw, out }
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

/** A throwaway workspace: a canvas crate, a non-prefix crate that registers a check kind, and stub
 * `glam` and `rand` path crates (not members) so the workspace resolves and builds offline. */
function workspace(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'deep-389-lint-'));
  const crate = (where: string, manifestExtra: string, lib: string): void => {
    const name = where.split('/').at(-1)!;
    mkdirSync(join(dir, where, 'src'), { recursive: true });
    writeFileSync(join(dir, where, 'Cargo.toml'), `[package]\nname = "${name}"\nversion = "0.0.0"\nedition = "2021"\npublish = false\n${manifestExtra}`);
    writeFileSync(join(dir, where, 'src', 'lib.rs'), lib);
  };
  writeFileSync(join(dir, 'Cargo.toml'), '[workspace]\nmembers = ["deep-canvas-planted", "reader-planted"]\nexclude = ["stubs/glam", "stubs/rand"]\nresolver = "2"\n');
  const deps = '\n[dependencies]\nglam = { path = "../stubs/glam" }\nrand = { path = "../stubs/rand" }\n';
  crate('deep-canvas-planted', `${deps}\n[package.metadata.deep]\ncheck_kinds = []\n`, source);
  crate('reader-planted', `${deps}\n[package.metadata.deep]\ncheck_kinds = ["planted.read"]\n`, source);
  crate('stubs/glam', '', '#[derive(Clone, Copy, Debug, Default)]\npub struct Vec4(pub [f32; 4]);\n');
  crate('stubs/rand', '', 'pub struct ThreadRng(u64);\nimpl ThreadRng {\n    pub fn next_u64(&mut self) -> u64 {\n        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1);\n        self.0\n    }\n}\npub fn thread_rng() -> ThreadRng {\n    ThreadRng(1)\n}\n');
  return dir;
}

const scratch: string[] = [];
afterAll(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });

function lint(root: string): { status: number | null; output: string } {
  const run = spawnSync(process.execPath, [LINT, '--root', root], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) throw Error(`scripts/canvas-lint.mjs: ${run.error.message}`);
  return { status: run.status, output: `${run.stdout}\n${run.stderr}` };
}

describe('AC2 the lint lane refuses the planted forms in a canvas crate and in a crate a check reads, and passes their clean twins', () => {
  it('AC2 each of the seven forms, planted once in each crate, fails the lint naming its file and line', () => {
    expect(existsSync(LINT), 'scripts/canvas-lint.mjs exists').toBe(true);
    const root = workspace(PLANTED);
    scratch.push(root);
    const lines = plantedLines(PLANTED);
    expect(Object.keys(lines).sort()).toEqual([...FORMS].sort());
    const result = lint(root);
    expect(result.status, `the lint passed the planted workspace:\n${result.output}`).not.toBe(0);
    const findings = result.output.split('\n').filter((line) => /^FAIL\b/.test(line.trim()));
    for (const crate of ['deep-canvas-planted', 'reader-planted']) {
      for (const form of FORMS) {
        const where = `${crate}/src/lib.rs:${lines[form]}`;
        const found = findings.some((line) => line.includes(where) || line.includes(where.replace(/\//g, '\\')));
        expect(found, `${form} in ${crate}: no FAIL line names ${where}; the lint printed:\n${result.output}`).toBe(true);
      }
    }
  }, 600_000);

  it('AC2 the clean twins pass the lint', () => {
    const root = workspace(CLEAN);
    scratch.push(root);
    const result = lint(root);
    expect(result.status, `the lint failed the clean twins:\n${result.output}`).toBe(0);
    expect(result.output.split('\n').filter((line) => /^FAIL\b/.test(line.trim())), 'no FAIL line on the twins').toEqual([]);
  }, 600_000);
});
