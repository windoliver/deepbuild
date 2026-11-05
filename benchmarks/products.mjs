// Placing a build product, for the perf lane's budgets (issue #1017): node benchmarks/products.mjs.
// One process writes a product shaped like a small Rust target (20 files of 1 MB and 1,000 of 4 KB) in a temp
// folder, then clones it copy-on-write into ten new folders one after another, as a worktree receives it, and checks
// each clone holds every file. The 15 GB target's 2 s stays in tests/acceptance/1017/budgets.test.ts.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloneTree } from '../packages/hub/dist/products.js';

const root = mkdtempSync(join(tmpdir(), 'deep-products-bench-'));
const count = (dir) => readdirSync(dir, { withFileTypes: true, recursive: true }).filter((e) => e.isFile()).length;
try {
  const src = join(root, 'target');
  const big = Buffer.alloc(1e6, 7);
  const small = Buffer.alloc(4096, 3);
  for (let i = 0; i < 20; i++) { mkdirSync(join(src, 'deps'), { recursive: true }); writeFileSync(join(src, 'deps', `lib${i}.rlib`), big); }
  for (let i = 0; i < 1000; i++) { const d = join(src, 'incremental', String(i % 100)); mkdirSync(d, { recursive: true }); writeFileSync(join(d, `f${i}`), small); }
  const want = count(src);
  for (let n = 0; n < 10; n++) {
    const dst = join(root, `wt-${n}`, 'target');
    mkdirSync(join(root, `wt-${n}`));
    const r = await cloneTree(src, dst);
    if (!r.cloned) throw Error(`the product is cloned copy-on-write: ${r.why}`);
    if (count(dst) !== want) throw Error(`the clone in wt-${n} holds every file`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
