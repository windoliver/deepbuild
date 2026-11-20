// Criterion 11: "Budgets, on the reference Mac in the local preflight, compared with the merge base: opening a save of
// 48 written pages of a 32 MiB memory takes under 50 ms; logic.layout over one fixture save and 60 steps under 2 s;
// re-deriving the lab's 1,800-step save under 5 s; a migration of 32 MiB under 1 s; and a piece without saves gains no
// work per frame"
//
// This file holds four of its legs; re-deriving the lab's save is tests/acceptance/189/lab/'s. Every leg is pinned to
// the reference Mac: on any other host each test fails BLOCKED before it measures. Each limit is judged by the repo's
// rule for a timing budget (scripts/benchmark.mjs: judgeLimit, five readings after a warm-up, on a reference Mac on
// mains power, Low Power Mode off, thermal state nominal, load under the core count); anything but PASS fails, naming
// the judge's reason. Readings (README: Budget readings): an open's `open_ns`; a `layout` call's wall time from outside
// one long-lived process; a migration's `ns`; and each frame's `saves_ns` in a live view of the dungeon without
// `saves`, which must be 0 every frame while its steps run, the merge base's per-frame saves work for such a piece.
import { loadavg } from 'node:os';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { AC, PAGE, REPO, TIMEOUT, bakeCall, bakeOf, bindingOf, folderWith, layoutCall, layoutOf, live, logicBin, migrationOf, num, one, onReferenceMacOnly, openSaveCall, openedOf, prebuild, saveFile, savesDir, sha256, str, type JsonValue } from './helpers.ts';
import { ADAPTER, dungeonPiece, dungeonProgram, dungeonTrack, saveAt, scribePiece } from './pieces.ts';
import { SAVED_AT, V1, migration, remapTable } from './programs.ts';

prebuild(() => { if (process.platform === 'darwin') logicBin(); });

interface Judged { status: string; reason?: string }
type Judge = (a: { limit: number; runs: number[]; fingerprint: JsonValue; loads: { start: number; end: number }[] }) => Judged;
/** The repo's budget judge and the machine it ran on (scripts/benchmark.mjs). */
async function judge(limit: number, reading: () => Promise<number> | number, what: string): Promise<void> {
  const bench = await import(join(REPO, 'scripts', 'benchmark.mjs')) as { fingerprint: () => JsonValue; judgeLimit: Judge };
  await reading(); // warm-up, not judged
  const runs: number[] = []; const loads: { start: number; end: number }[] = [];
  for (let i = 0; i < 5; i++) { const start = loadavg()[0]!; runs.push(await reading()); loads.push({ start, end: loadavg()[0]! }); }
  const verdict = bench.judgeLimit({ limit, runs, fingerprint: bench.fingerprint(), loads });
  expect(verdict.status, `${what}: ${verdict.status} under ${limit} (runs ${JSON.stringify(runs)}): ${verdict.reason ?? ''}`).toBe('PASS');
}
/** The old dungeon's save at step 1,800, in its own folder. */
function dungeonSave(): string {
  const dir = savesDir();
  const b = bakeOf(one(bakeCall(dungeonPiece('old'), { track: dungeonTrack(), steps: SAVED_AT, saves_dir: dir })), 'the bake that saves the dungeon');
  return saveFile(dir, b.saves[0]!.hash);
}

describe(`${AC[11]} the budgets on the reference Mac`, () => {
  it(`${AC[11]} opening a save of 48 written pages of a 32 MiB memory takes under 50 ms`, async () => {
    onReferenceMacOnly('criterion 11\'s open budget');
    const dir = savesDir();
    const b = bakeOf(one(bakeCall(scribePiece(), { track: [saveAt(1799)], steps: 1800, saves_dir: dir, adapter: ADAPTER })), 'the bake that saves the scribe');
    expect(readFileSync(saveFile(dir, b.saves[0]!.hash)).length, 'the save holds 48 pages').toBeGreaterThanOrEqual(48 * PAGE);
    await judge(50, () => {
      const o = openedOf(one(openSaveCall(scribePiece(), { saves_dir: dir, track: [saveAt(1799)], steps: 1800, adapter: ADAPTER })), 'open_save of the 48-page save');
      return num(o.raw['open_ns'], 'open_save.open_ns') / 1e6;
    }, 'opening the save of 48 written pages, in ms');
  }, TIMEOUT);

  it(`${AC[11]} logic.layout over one fixture save and 60 steps takes under 2 s`, async () => {
    onReferenceMacOnly('criterion 11\'s logic.layout budget');
    const file = dungeonSave();
    const hash = sha256(readFileSync(file));
    const p = dungeonPiece('fix', { assets: [dungeonProgram('old').bytes, readFileSync(file)] });
    const l = live();
    try {
      await judge(2000, async () => {
        const t0 = performance.now();
        const rep = layoutOf(await l.call(layoutCall(p, [hash], ['roster', 'gold', 'floor'], 60)), 'logic.layout of the damage fix');
        const ms = performance.now() - t0;
        expect(rep.verdict, 'it ran to its verdict').toBe('PASS');
        return ms;
      }, 'logic.layout over one fixture save and 60 steps, in ms');
    } finally { l.signal('SIGKILL'); }
  }, TIMEOUT);

  it(`${AC[11]} a migration of 32 MiB takes under 1 s`, async () => {
    onReferenceMacOnly('criterion 11\'s migration budget');
    const file = dungeonSave();
    const h = bindingOf(file);
    const p = dungeonPiece('m48', { migrate: [{ from: { layout: sha256(V1), content: h.content, modules: h.modules }, by: migration().sha, remap: sha256(remapTable()) }], assets: [migration().bytes, remapTable()] });
    await judge(1000, () => {
      const reply = one(openSaveCall(p, { saves_dir: folderWith(file), track: dungeonTrack(), steps: SAVED_AT }));
      expect(openedOf(reply, 'open_save through the migration').via, 'the save opens through its migration').toBe('migration');
      return migrationOf(reply, 'open_save through the migration').ns / 1e6;
    }, 'the migration of 32 MiB, in ms');
  }, TIMEOUT);

  it(`${AC[11]} a piece without saves gains no work per frame`, async () => {
    onReferenceMacOnly('criterion 11\'s per-frame budget');
    const l = live();
    try {
      const v = await l.call({ call: 'view', piece: dungeonPiece('old', { saves: false }), track: dungeonTrack() as unknown as JsonValue, span: 10 });
      const session = str(v['session'], 'view of the dungeon without saves');
      let steps = 0;
      for (let n = 0; n < 120; n++) {
        const f = await l.call({ call: 'frame', session, play: true });
        steps += num(f['steps'], `frame ${n + 1}.steps`);
        expect(f['saves_ns'], `frame ${n + 1}: the saves machinery does no work for a piece without saves`).toBe(0);
      }
      expect(steps, 'while its logic steps on').toBeGreaterThan(60);
    } finally { l.signal('SIGKILL'); }
  }, TIMEOUT);
});
