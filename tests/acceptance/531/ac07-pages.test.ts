// Criterion 7 (no upstream test): "The rewrite's page bitmap marks every 64 KiB page a store, memory.fill or
// memory.copy touches, in wasmtime and in headless Chrome alike, and is never part of a checkpoint, a save, a hash or
// the globals a save matches; a planted tracker that skips memory.copy fails, naming the page"
//
// Through `deep-logic bake` and the web runner (README: deep-logic): each step's `pages` is the bitmap once that
// step ended (the logic module clears it each step, then marks the pages its own writes touch, here the read region
// on page 0). `touch_pages` (programs.ts) writes zeros where memory holds zeros, by a store, a memory.fill or a
// memory.copy, so its memory never changes; `quiet_pages` is the same program without those writes. Their full-state
// and step hashes must be equal at every step: the bitmap (and the rewrite's other counters) is in none of them.
// Saves aren't in this issue's surface (Logic: saves is its own task), so "a save" and "the globals a save matches"
// aren't reached here (README: Not tested).
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, bakeCall, bakeOf, entryAt, firstDiff, inChrome, logicBin, none, obj, onMac, piece, prebuild, stepHashes, webPlanCall, webPlans, webRunnerSource, type Bake, type BakeSpec, type JsonObject } from './helpers.ts';
import { COPY_PAGES_BY_PHASE, PAGES_BY_PHASE, quietPages, touchPages } from './programs.ts';

prebuild(() => { logicBin(); });

const STEPS = 16;
const SPEC: BakeSpec = { steps: STEPS, restores: [{ from: 4, steps: 8 }, { from: 8, steps: 8 }] };
const pagesPiece = (touch: boolean): JsonObject => piece({
  seed: 531_07, items: { mem: { program: touch ? touchPages() : quietPages(), writes: { k: { type: 'i32' } }, checkpoint: { every: 4 } } },
});

/** Each step's reported pages against what the program touched; each failure names the step and the page. */
function judgePages(b: Bake, what: string): string[] {
  const failures: string[] = [];
  for (let k = 0; k < STEPS; k++) {
    const s = b.steps.find((x) => x.step === k);
    const got = s?.items['mem']?.pages;
    if (!got) { failures.push(`${what}, step ${k}: no pages reported`); continue; }
    const want = PAGES_BY_PHASE[k % 4]!;
    for (const p of want) if (!got.includes(p)) failures.push(`${what}, step ${k}: page ${p} was touched but isn't marked (marked: ${JSON.stringify(got)})`);
    for (const p of got) if (!want.includes(p)) failures.push(`${what}, step ${k}: page ${p} is marked but nothing touched it`);
  }
  return failures;
}

describe(`${AC[7]} the rewrite's page bitmap marks the pages each step touches, and nothing hashes it`, () => {
  it(`${AC[7]} in wasmtime each step marks exactly the pages its store, memory.fill or memory.copy touched, and the bitmap is in no checkpoint or hash: the quiet twin hashes the same`, () => {
    const [touch, quiet] = onMac([bakeCall(pagesPiece(true), SPEC), bakeCall(pagesPiece(false), SPEC)]).map((r, i) => bakeOf(r, i ? 'quiet_pages' : 'touch_pages'));
    expect(entryAt(touch!.items!['mem']!.layout, 'writes', 'k').offset, 'touch_pages was built for k at offset 0 of its write region').toBe(0);
    none(judgePages(touch!, 'touch_pages in wasmtime'), 'the page bitmap marks every page a store, memory.fill or memory.copy touched');
    for (const s of quiet!.steps) expect(s.items['mem']?.pages, `quiet_pages, step ${s.step}: only its write region's page`).toEqual([0]);
    const deep = (b: Bake): string[] => [...(b.checkpoints['mem'] ?? []), ...b.restores.flatMap((r) => r.checkpoints['mem'] ?? [])].map((c) => `${c.step} ${c.deep_hash}`);
    expect(touch!.checkpoints['mem']?.map((c) => c.step), 'checkpoints every 4 steps').toEqual([0, 4, 8, 12, 16]);
    expect(firstDiff(deep(touch!), deep(quiet!)), 'touching pages without changing memory changes no full-state hash at any checkpoint or restore').toBeNull();
    expect(firstDiff(stepHashes(touch!.steps), stepHashes(quiet!.steps)), 'nor any step hash').toBeNull();
    for (const r of touch!.restores) {
      const straight = touch!.steps.filter((s) => s.step >= r.from && s.step < r.from + 8);
      expect(firstDiff(stepHashes(r.steps), stepHashes(straight)), `restored from ${r.from}, touch_pages gives the straight run's step hashes`).toBeNull();
    }
  }, TIMEOUT);

  it(`${AC[7]} in headless Chrome's own WebAssembly engine each step marks the same pages as in wasmtime`, async () => {
    const [app] = onMac([bakeCall(pagesPiece(true), SPEC)]).map((r) => bakeOf(r, 'touch_pages in wasmtime'));
    const source = webRunnerSource();
    const [request] = webPlans([webPlanCall(pagesPiece(true), SPEC)]);
    const chrome = await inChrome(source, [request!]);
    const web = bakeOf(obj(chrome.replies[0], 'Chrome\'s bake'), 'Chrome\'s bake');
    none(judgePages(web, 'touch_pages in headless Chrome'), 'the page bitmap marks every page touched, in Chrome too');
    const pages = (b: Bake): string[] => b.steps.map((s) => `${s.step} ${JSON.stringify(s.items['mem']?.pages ?? null)}`);
    expect(firstDiff(pages(web), pages(app!)), 'Chrome marks the pages wasmtime marks, step by step').toBeNull();
    expect(firstDiff(stepHashes(web.steps), stepHashes(app!.steps)), 'and gives its step hashes').toBeNull();
  }, TIMEOUT);

  it(`${AC[7]} a planted tracker that skips memory.copy (tracker_skips_memory_copy) fails, naming the page`, () => {
    const [twin] = onMac([bakeCall(pagesPiece(true), SPEC)], 'tracker_skips_memory_copy').map((r) => bakeOf(r, 'the planted tracker'));
    const failures = judgePages(twin!, 'the planted tracker');
    const missed = COPY_PAGES_BY_PHASE.flatMap((pages, phase) => pages.map((p) => `step ${phase}: page ${p}`));
    expect(failures.length, `the planted tracker fails: it misses the pages memory.copy wrote (${missed.join('; ')})`).toBeGreaterThan(0);
    expect(failures[0], 'the first failure names the page memory.copy wrote first, page 5 at step 2').toContain('step 2: page 5 was touched but isn\'t marked');
    for (const f of failures) expect(f, 'every failure is a page memory.copy wrote').toMatch(/step (\d+): page (\d+) was touched but isn't marked/);
    for (const f of failures) {
      const [, k, p] = /step (\d+): page (\d+)/.exec(f)!;
      expect(COPY_PAGES_BY_PHASE[Number(k) % 4], `${f}: only memory.copy's pages go unmarked`).toContain(Number(p));
    }
  }, TIMEOUT);
});
