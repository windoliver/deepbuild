// The grid criteria: AC1, AC2, AC3, AC4, AC6 and AC8 (README: Criteria to tests).
//
// One grid of 1,000 pictures made here (README: The pictures): 1024 × 640, even ones JPEGs and odd ones PNGs, in 10
// columns of 120 u `fit: cover` tiles on a 128 u pitch, 1280 u wide and 12,800 u tall, drawn by
// `deep-canvas-render live` (README: Surfaces this suite names): a document's live view on the real clock at 60 Hz,
// opened, moved by the request's moves, settled and redrawn, every frame reporting the image service's levels and
// stats. AC2 makes 10,000 pictures from the 1,000 (each with nine copies that differ by one comment, so each is its own
// file by hash with the same pixels). Every run gets a fresh store holding only the pictures, so no level a run kept
// reaches another, except AC6's second open, which is the point.
//
// At the base `live` doesn't exist: `deep-canvas-render` prints its usage and exits 2.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, MiB, REPO, SHOWS_CHROMA, apng, budgetProblems, chroma, copies, decodePng, emptyAfterShown, freshStore, gridDoc, halved,
  judgeLimit, live, machine, makePictures, meanOf, near, patchOf, percentile, pngRgba, scratch, scrollMoves, useRender,
  viewProblems, visible, type Asset, type Box, type Frame, type JsonValue, type Live, type LiveRequest,
} from './helpers.ts';

const bin = useRender();
const dir = scratch('grid');
const SOURCES = join(dir, 'sources');
const TILES = 1_000;
/** AC1's view: 1280 × 800 u at zoom 1, so 1280 × 800 device px and 120 px tiles. */
const VIEW: Box = [0, 0, 1280, 800];

let made: Asset[] | null = null;
/** The 1,000 pictures, made once for the file, on first use. */
function pictures(): Asset[] {
  if (!made) {
    const started = Date.now();
    made = makePictures(SOURCES, TILES);
    console.log(`made the ${TILES} pictures in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
  return made;
}
let stores = 0;
/** A fresh store holding exactly `assets`, nothing a run kept. */
const store = (assets: readonly Asset[]): string => freshStore(SOURCES, join(dir, `store-${stores++}`), assets);

/** The last frame of `phase`. */
const lastOf = (r: Live, phase: Frame['phase']): Frame => r.frames.filter((f) => f.phase === phase).at(-1)!;
/** The run settled: its settle phase ended on a frame drawing every image in view at its level, with nothing pending. */
function expectSettled(r: Live, what: string): Frame {
  const f = lastOf(r, 'settle');
  expect(f.settling || f.stats.pending > 0, `${what}: the settle phase ends on a settled frame (frame ${f.frame}: settling ${f.settling}, pending ${f.stats.pending})`).toBe(false);
  return f;
}

// ---------------------------------------------------------------------------------------------------

describe(`${AC[1]} a 1,000-image grid of 120 px cover tiles from 1024 × 640 JPEGs and PNGs, in a 1280 × 800 view scrolled at 40 px a frame: first screen under 200 ms, UI-thread p99 under 4 ms, and cache bytes never over budget except for what the last two frames drew`, () => {
  it(`${AC[1]} opened cold and scrolled 40 px a frame to the grid's end (300 frames): every frame draws the tiles in its view and holds the cache within its budget but for what the last two frames drew; in five runs after a warm-up on a reference Mac the first screen is under 200 ms and the UI thread's frame time under 4 ms at p99`, (ctx) => {
    const b = bin();
    const assets = pictures();
    const doc = gridDoc(assets);
    const moves = scrollMoves(TILES, VIEW, 40);
    expect(moves.length, 'the scroll to the end is 300 frames of 40 px').toBe(300);
    const firsts: number[] = [];
    const p99s: number[] = [];
    const loads: { start: number; end: number }[] = [];
    for (let n = 0; n <= 5; n++) {
      const what = n === 0 ? 'AC1 warm-up' : `AC1 run ${n}`;
      const start = loadavg()[0]!;
      const r = live(b, { doc, view: { zoom: 1, rect: VIEW }, store: store(assets), moves, settle_ms: 10_000 }, what);
      const end = loadavg()[0]!;
      expect(viewProblems(r.frames, TILES), `${what}: each frame draws the tiles its view holds`).toEqual([]);
      expect(budgetProblems(r.frames), `${what}: cache bytes never over budget except for what the last two frames drew`).toEqual([]);
      const budgets = [...new Set(r.frames.map((f) => f.stats.budget))];
      expect(budgets.every((v) => v > 0 && v <= 256 * MiB), `${what}: the cache's budget is its starting 256 MiB or a class's smaller one, got ${budgets.join(', ')}`).toBe(true);
      const open = r.frames.filter((f) => f.phase === 'open');
      const first = open.at(-1)!;
      expect(first.settling, `${what}: the open phase ends on the first screen, every tile in view drawn at its level, within settle_ms (frame ${first.frame} at ${first.done_ms.toFixed(1)} ms still settling)`).toBe(false);
      const ui = r.frames.filter((f) => f.phase === 'move').map((f) => f.ui_ms);
      const p99 = percentile(ui, 0.99);
      const worst = r.frames.filter((f) => f.phase === 'move').reduce((a, f) => (f.ui_ms > a.ui_ms ? f : a));
      console.log(`${what}: first screen ${first.done_ms.toFixed(1)} ms (frame ${first.frame}); ${ui.length} scroll frames, UI thread p99 ${p99.toFixed(2)} ms, worst frame ${worst.frame} ${worst.ui_ms.toFixed(2)} ms; final ${JSON.stringify(r.stats)}`);
      if (n === 0) continue;
      firsts.push(first.done_ms);
      p99s.push(p99);
      loads.push({ start, end });
    }
    const m = machine();
    const verdicts = { 'first screen (ms)': judgeLimit(200, firsts, m, loads), 'UI-thread p99 (ms)': judgeLimit(4, p99s, m, loads) };
    console.log(`AC1 verdicts: ${JSON.stringify(verdicts)}`);
    for (const [name, v] of Object.entries(verdicts)) expect(['PASS', 'INCONCLUSIVE'], `${name} against ${v.limit}: ${JSON.stringify(v)}`).toContain(v.status);
    const open = Object.entries(verdicts).filter(([, v]) => v.status === 'INCONCLUSIVE');
    if (open.length) ctx.skip(`INCONCLUSIVE (reading only): ${open.map(([name, v]) => `${name} ${v.runs.map((x) => x.toFixed(2)).join(', ')}: ${v.reason}`).join('; ')}`);
  }, 3_600_000);
});

// ---------------------------------------------------------------------------------------------------

const BUDGET_64 = 64 * MiB;
let tenThousand: Asset[] | null = null;
const tenThousandPictures = (): Asset[] => (tenThousand ??= copies(SOURCES, pictures(), 10));

/**
 * The 10,000-picture grid (128,000 u tall) with a 64 MiB budget, opened at the top, flung 800 u a frame (a view's
 * height, so every row meets a frame's view) to its end in 159 frames, then settled: the settle phase ends only once
 * nothing is pending, so a queue that never cancels has run every job it took.
 */
function fling(b: string, planted?: LiveRequest['planted']): Live {
  const assets = tenThousandPictures();
  const what = `AC2 fling${planted ? `, planted ${planted}` : ''}`;
  const r = live(b, {
    doc: gridDoc(assets), view: { zoom: 1, rect: VIEW }, store: store(assets), moves: scrollMoves(assets.length, VIEW, 800),
    settle_ms: 180_000, images: { budget: BUDGET_64 }, ...(planted ? { planted } : {}),
  }, what, 1_800_000);
  const last = lastOf(r, 'settle');
  console.log(`${what}: ${r.frames.length} frames, ${r.jobs.length} jobs, final stats ${JSON.stringify(r.stats)}`);
  if (last.stats.pending > 0) expect.fail(`BLOCKED: ${what} ended its settle phase with ${last.stats.pending} requests pending, so what it decodes in all can't be read`);
  return r;
}

/** AC2's check, each problem starting with the stat it names. */
function flingProblems(r: Live, tiles: number): string[] {
  const passed = new Set(r.frames.flatMap((f) => visible(tiles, f.rect))).size;
  const s = r.stats;
  const out: string[] = [];
  if (s.budget !== BUDGET_64) out.push(`budget is ${s.budget} B, not the 64 MiB the request set`);
  out.push(...budgetProblems(r.frames).map((p) => `bytes: ${p}`));
  out.push(...viewProblems(r.frames, tiles).map((p) => `levels: ${p}`));
  if (s.evicted <= 0) out.push(`evicted is ${s.evicted}: nothing left the 64 MiB cache though the fling drew ${passed} pictures`);
  if (s.cancelled <= 0) out.push(`cancelled is ${s.cancelled}: no request the view stopped asking for was cancelled`);
  if (s.failed !== 0) out.push(`failed is ${s.failed}`);
  if (s.decoded >= passed) out.push(`decoded is ${s.decoded}: as many as the ${passed} pictures the view passed, so the queue ran requests no view still wanted`);
  return out;
}

describe(`${AC[2]} at 10,000 images with a 64 MiB budget, evicted and cancelled are above 0 and failed is 0. A planted queue with no cancel decodes every row it passed and fails on decoded`, () => {
  it(`${AC[2]} the 10,000-picture grid with a 64 MiB budget flung to its end and settled: evicted and cancelled above 0, failed 0, fewer decoded than the pictures the view passed, and the cache within its budget but for what the last two frames drew`, () => {
    const r = fling(bin());
    expect(flingProblems(r, 10_000), 'the 10,000-picture fling').toEqual([]);
  }, 3_600_000);

  it(`${AC[2]} planted queue_without_cancel decodes every picture the fling passed and fails the check on decoded`, () => {
    const r = fling(bin(), 'queue_without_cancel');
    const problems = flingProblems(r, 10_000);
    console.log(`AC2 queue_without_cancel: ${JSON.stringify(problems.slice(0, 6))}`);
    expect(problems.filter((p) => p.startsWith('decoded is ')), `the check fails the queue with no cancel on decoded: ${JSON.stringify(problems.slice(0, 6))}`).toHaveLength(1);
  }, 3_600_000);
});

// ---------------------------------------------------------------------------------------------------

describe(`${AC[3]} after a settled frame, 10 further full redraws make 0 gross allocations in the service, by a counting allocator`, () => {
  it(`${AC[3]} the grid opened and settled, then 10 full redraws, each drawing every tile in view at its level: the service allocates 0 times in each, though the same counter reads its decodes' allocations while the grid opened`, () => {
    const assets = pictures();
    const out = join(dir, 'ac3-settled.png');
    const r = live(bin(), { doc: gridDoc(assets), view: { zoom: 1, rect: VIEW }, store: store(assets), redraws: 10, captures: [{ phase: 'settle', frame: 'last', out }] }, 'AC3');
    const settled = expectSettled(r, 'AC3');
    // The settled frame shows each tile's own picture: its disc's color at its sample patch.
    const frame = decodePng(readFileSync(out));
    expect([frame.width, frame.height], 'AC3: the capture is the 1280 × 800 view').toEqual([1280, 800]);
    const wrong = visible(TILES, settled.rect).flatMap((id) => {
      const i = Number(id.slice(1));
      const patch = patchOf(i, settled.rect, 1, frame);
      if (!patch) return [];
      const got = meanOf(frame, patch);
      return near(got, assets[i]!.disc, 16) ? [] : [`${id} shows ${JSON.stringify(got)} where its picture's disc is ${JSON.stringify(assets[i]!.disc)}`];
    });
    expect(wrong, 'AC3: the settled frame shows each tile in view with its own picture').toEqual([]);
    const redraws = r.frames.filter((f) => f.phase === 'redraw');
    expect(viewProblems(redraws, TILES), 'AC3: each redraw draws every tile in view').toEqual([]);
    expect(redraws.filter((f) => f.settling).map((f) => f.frame), 'AC3: each redraw draws every tile at its level').toEqual([]);
    const opened = r.frames.filter((f) => f.phase === 'open').reduce((n, f) => n + f.allocations, 0);
    expect(opened, 'AC3: the counter sees the service: its decodes allocate while the grid opens').toBeGreaterThan(0);
    expect(redraws.filter((f) => f.allocations !== 0).map((f) => `frame ${f.frame}: ${f.allocations} allocations`), 'AC3: 0 gross allocations in the service in each of the 10 redraws').toEqual([]);
  }, 1_800_000);
});

// ---------------------------------------------------------------------------------------------------

/** AC4's budget: 1 MiB, under what one screen of tiles holds at their level, so only the two-frame rule keeps them. */
const TINY = 1 * MiB;

/** The grid held still at its top with a 1 MiB budget: opened, settled (or not, within 1.5 s each) and redrawn 10 times, every frame captured. */
function still(b: string, planted?: LiveRequest['planted']): { r: Live; found: string[] } {
  const assets = pictures();
  const shots = join(dir, `ac4-${planted ?? 'honest'}`);
  mkdirSync(shots, { recursive: true });
  const what = `AC4${planted ? ` planted ${planted}` : ''}`;
  const r = live(b, {
    doc: gridDoc(assets), view: { zoom: 1, rect: VIEW }, store: store(assets), settle_ms: 1_500, redraws: 10, images: { budget: TINY },
    captures: (['open', 'settle', 'redraw'] as const).map((phase) => ({ phase, dir: shots })), ...(planted ? { planted } : {}),
  }, what);
  const missing = r.frames.filter((f) => !existsSync(join(shots, `${f.frame}.png`))).map((f) => f.frame);
  expect(missing, `${what}: every frame was captured`).toEqual([]);
  const found = emptyAfterShown(r.frames, shots, TILES, 1);
  console.log(`${what}: ${r.frames.length} frames, ${readdirSync(shots).length} captures; ${found.length} empty after shown: ${JSON.stringify(found.slice(0, 3))}`);
  return { r, found };
}

describe(`${AC[4]} a planted evictor that ignores the two-frame rule shows an empty tile in a frame and fails, naming the frame`, () => {
  it(`${AC[4]} with a 1 MiB budget, under one screen's tiles, no tile that showed its picture is ever shown empty while in view, and the cache holds what the last two frames drew past its budget`, () => {
    const { r, found } = still(bin());
    expect(found, 'AC4: no tile empties after it showed').toEqual([]);
    expect(r.frames.filter((f) => f.stats.budget !== TINY).map((f) => f.frame), 'AC4: the cache ran with the 1 MiB budget the request set').toEqual([]);
    expect(budgetProblems(r.frames), 'AC4: the cache is over its budget only by what the last two frames drew').toEqual([]);
    const held = r.frames.filter((f) => f.stats.entries > 0).map((f) => f.stats.bytes / f.stats.entries);
    const screen = visible(TILES, VIEW).length;
    if (!held.length || Math.max(...held) * screen <= TINY) expect.fail(`BLOCKED: one screen's ${screen} tiles at the levels held (${held.length ? Math.max(...held).toFixed(0) : '?'} B each) fit the 1 MiB budget, so the budget never pressed on what was drawn`);
    const last = r.frames.at(-1)!;
    const frame = decodePng(readFileSync(join(dir, 'ac4-honest', `${last.frame}.png`)));
    const showing = visible(TILES, VIEW).filter((id) => { const p = patchOf(Number(id.slice(1)), VIEW, 1, frame); return p !== null && chroma(meanOf(frame, p)) >= SHOWS_CHROMA; });
    expect(showing.length, 'AC4: the last frame shows pictures, so there was something for the rule to keep').toBeGreaterThan(0);
  }, 1_800_000);

  it(`${AC[4]} planted evictor_ignores_two_frames shows a tile empty after it showed, and the check fails naming the frame`, () => {
    const { r, found } = still(bin(), 'evictor_ignores_two_frames');
    expect(found.length, 'AC4: the check finds a tile shown empty after it showed').toBeGreaterThan(0);
    const named = Number(/^frame (\d+) /.exec(found[0]!)?.[1]);
    expect(Number.isInteger(named) && named < r.frames.length, `AC4: the failure names a frame of the run: ${found[0]}`).toBe(true);
  }, 1_800_000);
});

// ---------------------------------------------------------------------------------------------------

describe(`${AC[6]} a second open of the same grid decodes nothing, by the worker's job list`, () => {
  it(`${AC[6]} the grid opened and settled twice, each in its own process on one store: the first decodes every picture in view, the second's job list holds no decode and a read for each`, () => {
    const b = bin();
    const assets = pictures();
    const request: LiveRequest = { doc: gridDoc(assets), view: { zoom: 1, rect: VIEW }, store: store(assets) };
    const inView = visible(TILES, VIEW).map((id) => assets[Number(id.slice(1))]!.hash);
    const first = live(b, request, 'AC6 first open');
    expectSettled(first, 'AC6 first open');
    const firstDecoded = new Set(first.jobs.filter((j) => j.kind === 'decode').map((j) => j.asset));
    expect(inView.filter((h) => !firstDecoded.has(h)), 'AC6: the first open\'s job list decodes every picture in view').toEqual([]);
    const second = live(b, request, 'AC6 second open');
    expectSettled(second, 'AC6 second open');
    const decodes = second.jobs.filter((j) => j.kind === 'decode');
    console.log(`AC6: first open ${first.jobs.length} jobs (${firstDecoded.size} pictures decoded); second open ${second.jobs.length} jobs, ${decodes.length} decodes, stats ${JSON.stringify(second.stats)}`);
    expect(decodes.map((j) => `${j.asset.slice(0, 12)} level ${j.level} at frame ${j.frame}`), 'AC6: the second open decodes nothing, by the job list').toEqual([]);
    expect(second.stats.decoded, 'AC6: the second open\'s decoded').toBe(0);
    const read = new Set(second.jobs.filter((j) => j.kind === 'read').map((j) => j.asset));
    expect(inView.filter((h) => !read.has(h)), 'AC6: each picture in view comes back by a read of the level the first open kept').toEqual([]);
  }, 1_800_000);
});

// ---------------------------------------------------------------------------------------------------
// AC8: the check run's pictures and the one taste call (README: The taste call). This test judges no picture: it
// copies the frames `live` captured, re-encoded so the same pixels always give the same bytes.

const EVIDENCE = join(REPO, 'docs', 'evidence', '1486');
const TASTE = join(REPO, 'tests', 'acceptance', '1486', 'TASTE.json');
/** The reference window: 1512 × 982 points at 2×, the 1280 u grid centred in it. */
const WINDOW: Box = [-116, 0, 1512, 982];
const MID = 'grid-mid-scroll.png';
const SETTLED = 'grid-settled.png';
const RECORDING = 'grid-scroll.apng';
const NAMES = [MID, SETTLED, RECORDING];
const hash = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
function inconclusive(reason: string): never {
  return expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}

describe(`${AC[8]} screenshots of a 1,000-tile grid mid-scroll and settled, taken by the check run from the fixture document at the reference window, with a recording of the scroll, and the one taste call on them`, () => {
  it(`${AC[8]} the check run scrolls the grid at the reference window and takes its pictures, and the recorded call on exactly those pictures says they look right; with none the run is INCONCLUSIVE, never PASS`, () => {
    const assets = pictures();
    const shots = join(dir, 'ac8');
    const settledOut = join(dir, 'ac8-settled.png');
    const moves = Array.from({ length: 60 }, (_, k) => ({ at: [WINDOW[0], 20 * (k + 1)] as [number, number] }));
    const r = live(bin(), {
      doc: gridDoc(assets), view: { zoom: 2, rect: WINDOW }, store: store(assets), moves,
      captures: [{ phase: 'move', dir: shots }, { phase: 'settle', frame: 'last', out: settledOut }],
    }, 'AC8 check run');
    expectSettled(r, 'AC8 check run');
    const scroll = r.frames.filter((f) => f.phase === 'move').map((f) => decodePng(readFileSync(join(shots, `${f.frame}.png`))));
    const settled = decodePng(readFileSync(settledOut));
    for (const [k, image] of [...scroll, settled].entries()) expect([image.width, image.height], `AC8: picture ${k} is the reference window, 3024 × 1964 device px`).toEqual([3024, 1964]);
    const files: Record<string, Buffer> = { [MID]: pngRgba(scroll[29]!), [SETTLED]: pngRgba(settled), [RECORDING]: apng(scroll.map(halved), 60) };
    const hashes = Object.fromEntries(NAMES.map((n) => [n, hash(files[n]!)]));

    let call: Record<string, JsonValue> | null = null;
    if (existsSync(TASTE)) {
      let parsed: JsonValue;
      try { parsed = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
      expect(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed), 'TASTE.json is an object').toBe(true);
      call = parsed as Record<string, JsonValue>;
      expect(call['issue'], 'TASTE.json: issue').toBe(1486);
      expect(call['criterion'], 'TASTE.json: criterion').toBe('#1486.9e82ff7a');
      expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(call['verdict']);
      expect(typeof call['who'] === 'string' && call['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
      expect(typeof call['when'] === 'string' && !Number.isNaN(Date.parse(call['when'])) && /^\d{4}-\d\d-\d\dT/.test(call['when']), 'TASTE.json: when, an ISO 8601 time').toBe(true);
      expect(Object.keys((call['screenshots'] ?? {}) as object).sort(), 'TASTE.json: screenshots names the three files').toEqual([...NAMES].sort());
    }
    const recorded = (call?.['screenshots'] ?? {}) as Record<string, JsonValue>;
    const onDisk = Object.fromEntries(NAMES.map((n) => [n, existsSync(join(EVIDENCE, n)) ? hash(readFileSync(join(EVIDENCE, n))) : null]));
    // A call stands on the files it names, as they are in docs/evidence/1486, when this run's settled frame is the
    // one it saw: the scroll's frames depend on when each decode lands, so they differ run to run; the settled frame
    // doesn't, so it ties the call to what this build draws.
    const stands = call !== null && NAMES.every((n) => recorded[n] === onDisk[n]) && recorded[SETTLED] === hashes[SETTLED];
    if (!stands) {
      mkdirSync(EVIDENCE, { recursive: true });
      for (const n of NAMES) writeFileSync(join(EVIDENCE, n), files[n]!);
    }
    const listed = NAMES.map((n) => `  docs/evidence/1486/${n}  ${stands ? onDisk[n] : hashes[n]}`).join('\n');
    console.log(`${AC[8]}: the check run's pictures${stands ? ' (the recorded call\'s, kept)' : ', written'}:\n${listed}`);
    if (call === null) inconclusive(`no taste call is recorded: attach these to the PR, show them to the owner\n${listed}\nand record the answer in tests/acceptance/1486/TASTE.json (README: The taste call)`);
    if (!stands) {
      const why = recorded[SETTLED] !== hashes[SETTLED]
        ? `this run's settled frame (${hashes[SETTLED]}) is not the one the call saw (${String(recorded[SETTLED])})`
        : `the files in docs/evidence/1486 aren't the ones it names: ${NAMES.filter((n) => recorded[n] !== onDisk[n]).join(', ')}`;
      inconclusive(`the recorded call (${String(call['who'])}, ${String(call['when'])}) was made on other pictures: ${why}; this run's are written for a new call`);
    }
    if (call['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(call['who'])}, ${String(call['when'])}) says they don't look right${typeof call['note'] === 'string' ? `: ${call['note']}` : ''}`);
    console.log(`${AC[8]}: taste call recorded by ${String(call['who'])} at ${String(call['when'])}: looks right`);
  }, 1_800_000);
});
