// AC9 #172.811cf803: "A piece with a 2,048 px PNG and 64 thumbnails reaches `ready` with each image decoded once, within
// the 3 s first-frame budget. A bundle whose level doesn't match its hash doesn't start, naming it"
//
// The piece is helpers.ts `picturesDoc`: a 2,048 × 2,048 PNG drawn in a 256 px box and 64 thumbnails, each its own
// 64 × 64 PNG, drawn 28 px wide.
//
// asserts:
//   - the export writes a bundle whose every file matches its receipt, holding at least one reduced level (a receipt
//     file marked `level: {of}`, chosen) of the 2,048 px PNG, by hash (#1486's levels travel in the bundle);
//   - in headless Chrome the piece reaches `ready`, and probe()'s `decoded` (chosen: each image file the player decoded,
//     by SHA-256, with how many times) counts every file once and holds at least 65 files, one at least per picture;
//   - a copy whose level has one byte changed in test code doesn't start: `ready` stays false for 30 s and a notice
//     names the level (the SHA-256 the export recorded or its path);
//   - on a reference Mac in a fit state, five loads after a warm-up each reach their first frame (`first_frame_ms`)
//     under 3,000 ms by the repo's `judgeLimit`; anywhere else, INCONCLUSIVE, never a pass (asserted last).
import { writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, THUMBS, TIMEOUT, bundleFailures, copyBundle, done, exportOnce, inconclusive, isObject, judged, levelsOf, none, obj, picturesDoc, play,
  readBundle, referenceMacProblem, useBrowsers, useFileTemp, useShow, useTemp, webReceiptOf, type WebReceipt,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const kept = useFileTemp();
const browsers = useBrowsers();

let made: { out: string; receipt: WebReceipt; big: string } | undefined;
/** The pictures exported once for the file. */
function pictures(): { out: string; receipt: WebReceipt; big: string } {
  if (made) return made;
  const evidence = kept();
  const { doc, big } = picturesDoc(evidence);
  const out = join(kept(), 'bundle');
  const receipt = webReceiptOf(exportOnce(shows(FULL), evidence, doc, out, 'the pictures exported to the web'), 'the pictures exported to the web');
  none(bundleFailures(out, receipt, 'the pictures\' bundle'), 'the bundle holds every file its receipt names, each by its hash');
  made = { out, receipt, big };
  return made;
}
/** A level of the 2,048 px picture in the receipt. */
function bigLevel(p: { receipt: WebReceipt; big: string }): WebReceipt['files'][number] {
  const levels = levelsOf(p.receipt);
  const of = levels.find((l) => obj(l.raw['level'], 'level')['of'] === p.big);
  expect(of, `the bundle carries a reduced level of the 2,048 px PNG ${p.big} by hash (receipt files marked level: {of}); it marks ${levels.length} levels`).toBeTruthy();
  return of!;
}

describe(`${AC[9]} a 2,048 px PNG and 64 thumbnails decode once each before ready, and a level off its hash doesn't start`, () => {
  it(`${AC[9]} the piece reaches ready with each image decoded once, within the 3 s first-frame budget on the reference Mac`, async () => {
    const p = pictures();
    bigLevel(p);
    const page = browsers(await play(p.out));
    await page.tab.mustBeReady('the pictures');
    const probe = await page.tab.probe('the pictures, ready');
    const decoded = probe.raw['decoded'];
    expect(isObject(decoded), `probe().decoded counts each image file the player decoded: ${JSON.stringify(decoded ?? null).slice(0, 300)}`).toBe(true);
    const counts = Object.entries(decoded as Record<string, unknown>);
    none(counts.filter(([, n]) => n !== 1).map(([sha, n]) => `${sha} was decoded ${String(n)} times`), 'each image is decoded once');
    expect(counts.length, `at least one file per picture is decoded (1 + ${THUMBS}): ${counts.length}`).toBeGreaterThanOrEqual(1 + THUMBS);
    await done(page);

    const problem = await referenceMacProblem(true);
    if (problem) inconclusive(`the first-frame budget counts only on a reference Mac in a fit state: ${problem}`);
    const once = async (k: number): Promise<number> => {
      const q = browsers(await play(p.out));
      await q.tab.mustBeReady(`the pictures, load ${k}`);
      const ms = Number((await q.tab.probe(`the pictures, load ${k}`)).raw['first_frame_ms']);
      expect(Number.isFinite(ms) && ms > 0, `load ${k}: probe().first_frame_ms is the time to the first frame: ${String(ms)}`).toBe(true);
      await done(q);
      return ms;
    };
    await once(0);
    const runs: number[] = []; const loads: { start: number; end: number }[] = [];
    for (let k = 1; k <= 5; k++) { const start = loadavg()[0]!; runs.push(await once(k)); loads.push({ start, end: loadavg()[0]! }); }
    await judged(AC[9], 'the pictures\' first frame in Chrome, from navigation start', 3000, runs, loads, 'ms');
  }, TIMEOUT);

  it(`${AC[9]} a bundle whose level of the 2,048 px PNG is one byte off its hash doesn't start, naming the level`, async () => {
    const p = pictures();
    const level = bigLevel(p);
    const copy = copyBundle(p.out, join(temp(), 'tampered'));
    const bytes = Buffer.from(readBundle(copy, level.path));
    bytes[bytes.length >> 1] = bytes[bytes.length >> 1]! ^ 0x01;
    writeFileSync(join(copy, level.path), bytes);
    const page = browsers(await play(copy));
    const s = await page.tab.ready(30_000);
    expect(s.ready, 'the player with a level off its hash never reports ready').toBe(false);
    expect(s.notices.some((n) => n.includes(level.sha256) || n.includes(level.path)), `a notice names the level (${level.sha256} or ${level.path}); the notices: ${JSON.stringify(s.notices)}`).toBe(true);
    await done(page);
  }, TIMEOUT);
});
