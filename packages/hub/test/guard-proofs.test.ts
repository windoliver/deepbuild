// A hub's own install into a home whose proofs.json was removed (#2695): the products store's guard is installed at
// every hub start, so the file comes back holding that one proof; what's wrong with it is still named, and setup's
// restore puts every shipped proof back beside it.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { addGuards, proofsProblem, restoreShipped } from '../src/guards.js';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const deepHook = join(REPO, 'target/debug/deep-hook');
// The shipped entries as rules.json holds them once setup has moved their proofs out.
const { proofs: shippedProofs } = JSON.parse(readFileSync(join(REPO, 'crates/deep-hook/default-rules.json'), 'utf8')) as { proofs: Record<string, unknown> };
const shipped = JSON.parse(readFileSync(join(REPO, 'crates/deep-hook/default-rules.json'), 'utf8')) as { entries: Record<string, unknown>; proofs?: unknown };
delete shipped.proofs;
const write = (path: string) => ({ tool_name: 'Write', tool_input: { file_path: path, content: 'x\n' } });

let dir = '';
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it('names the shipped entries with no proof after an install into a removed proofs.json', async () => {
  dir = mkdtempSync(join(tmpdir(), 'guard-proofs-'));
  writeFileSync(join(dir, 'rules.json'), `${JSON.stringify(shipped, null, 2)}\n`);
  expect(proofsProblem(dir)?.why).toContain('proofs.json is missing');
  const store = join(dir, 'products');
  const added = await addGuards(dir, {
    v: 1,
    entries: { 'store-only': { match: `write:${store} ${store}/*`, scope: 'all_repos', mode: 'block', fail_closed: true, reason: 'r', next_step: 'n' } },
    proofs: { 'store-only': { planted: write(join(store, 'x')), twin: write(join(dir, 'notes', 'x.md')) } },
  }, { deepHook, classes: {} });
  expect(added).toEqual({ status: 'installed', names: ['store-only'] });
  const problem = proofsProblem(dir);
  expect(problem?.unreadable).toBe(false);
  expect(problem?.why).toContain('no proof is held for');
  expect(problem?.why).toContain('no-kill-by-name');
  const written: Record<string, unknown>[] = [];
  restoreShipped(dir, shipped, (file, value) => { written.push(value); writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); });
  expect(written).toHaveLength(1);
  const held = (JSON.parse(readFileSync(join(dir, 'proofs.json'), 'utf8')) as { proofs: Record<string, unknown> }).proofs;
  expect(Object.keys(held).sort()).toEqual([...Object.keys(shippedProofs), 'store-only'].sort());
  expect(Object.keys(shippedProofs).filter((n) => JSON.stringify(held[n]) !== JSON.stringify(shippedProofs[n]))).toEqual([]);
  expect(proofsProblem(dir)).toBeUndefined();
});
