#!/usr/bin/env node
// Planted lint commands for #1556 (README: Wrong programs), run in the lint lane's place over the planted scratch copy
// through the same runner and judge. Each greps crates/deep-app/src/views.rs for `Command::new(...).output()`.
//   right        prints `crates/deep-app/src/views.rs:<line>:<col>: a blocking process call in UI code` and exits 1
//   off-by-one   the same, naming the line after it
//   file-only    fails naming the file but no line
//   warns        prints the right line but exits 0: the lane doesn't fail

import { readFileSync } from 'node:fs';

const mode = process.argv[2];
const file = 'crates/deep-app/src/views.rs';
const lines = readFileSync(file, 'utf8').split('\n');
const hits = lines.flatMap((l, i) => (/Command::new\(.*\)\.output\(\)/.test(l) ? [{ line: i + 1, col: l.indexOf('std::process') + 1 }] : []));
if (!hits.length) process.exit(0);
for (const { line, col } of hits) {
  if (mode === 'file-only') console.error(`${file}: a blocking process call in UI code`);
  else console.error(`${file}:${mode === 'off-by-one' ? line + 1 : line}:${col}: a blocking process call in UI code`);
}
process.exit(mode === 'warns' ? 0 : 1);
