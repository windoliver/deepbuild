// Test-only source mutants of base 092754bb1 (Apache-2.0; repository LICENSE).
// Run ONLY against a disposable source copy, never the implementation checkout.
// No test, fixture, helper, lockfile, expected value or binary is rewritten.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const layout = 'crates/deep-canvas-marks/src/layout.rs';
const mutations = {
  padding: [[layout, 'style.padding = Rect::length(padding);', 'style.padding = Rect::length(padding * 0.);']],
  gap: [[layout, 'width: length(gap[0]),\n            height: length(gap[1]),', 'width: length(gap[0] * 0.),\n            height: length(gap[1] * 0.),']],
  row: [[layout, 'style.align_items = align(params.get("align_cross"), id)?;', 'style.align_items = Some(AlignItems::START);']],
  grid: [[layout, 'Some(Some("column")) => true,', 'Some(Some("column")) => false,']],
  east: [[layout, 'style.justify_self = align_cols.get(col).copied().flatten();', 'style.justify_self = align_cols.get(col).copied().flatten().map(|_| AlignItems::CENTER);']],
  shape: [[layout, 'width: shaped.width,', 'width: shaped.width + 4.,']],
  growth: [[layout, 'height: shaped.height,', 'height: (1.3 * size).round(),']],
  overlap: [[layout, 'let mut x = at[0] + layout.location.x;\n        let mut y = at[1] + layout.location.y;', 'let mut x = at[0];\n        let mut y = at[1];']],
  widest: [[layout, 'match params.get("widest").and_then(Value::as_str) {', 'match params.get("text").and_then(Value::as_str) {']],
  history: [[layout, '    Ok(out)\n}\n\n#[cfg(test)]', `    // Deliberately wrong: earlier solves change the next solve's positions.
    static SOLVES: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let shift = f64::from(SOLVES.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
    for rect in out.values_mut() { rect[0] += shift; }
    Ok(out)
}

#[cfg(test)]`]],
  text: [['crates/deep-text/src/main.rs', '"fits": fits,\n        "width": shaped.width,', '"fits": fits,\n        "width": shaped.width + 4.,']],
  scope: [
    // The same real main and solver, now owned by an existing non-canvas workspace crate.
    ['crates/deep-canvas-marks/Cargo.toml', '[[bin]]\nname = "deep-layout"\npath = "src/main.rs"\n', ''],
    ['crates/deep-motion/Cargo.toml', '[[bin]]\nname = "deep-motion"\npath = "src/main.rs"', '[[bin]]\nname = "deep-motion"\npath = "src/main.rs"\n\n[[bin]]\nname = "deep-layout"\npath = "../deep-canvas-marks/src/main.rs"'],
  ],
};
const [directory, name] = process.argv.slice(2);
if (!directory || !name || !(name in mutations || name === 'all-files')) {
  throw Error(`usage: node plant.mjs <disposable-source-copy> <${Object.keys(mutations).join('|')}|all-files>`);
}
const root = resolve(directory);
if (root === resolve(fileURLToPath(new URL('../../..', import.meta.url)))) {
  throw Error('Refusing to mutate the checkout containing this recipe');
}
// One compiled program can refute all five files side by side. Individual variants isolate causes.
const edits = name === 'all-files'
  ? ['padding', 'row', 'grid', 'widest', 'scope'].flatMap((key) => mutations[key])
  : mutations[name];
const files = new Map();
for (const [file, before, after] of edits) {
  const path = resolve(root, file);
  const source = files.get(path) ?? readFileSync(path, 'utf8');
  if (source.split(before).length !== 2) throw Error(`BLOCKED: ${name}: source anchor drift in ${file}`);
  files.set(path, source.replace(before, after));
}
for (const [path, source] of files) writeFileSync(path, source);
console.log(`Planted ${name}; compilation and assertion failures remain to be proven.`);
