import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  LINT, RENDER_BIN, RENDER_BIN_NAME, REPO, SCOPE_MARKER, SCOPE_PREFIX, cargoMetadata, isObject, labelBox, normalClosure, one, pixel,
  readPng, requireMacos, useBinaries, type JsonValue, type Rgb,
} from './helpers.ts';

useBinaries('deep-text-render');

const CARD: Rgb = [24, 24, 24];
const WHITE: Rgb = [255, 255, 255];
const RED: Rgb = [255, 24, 24];
const scratch = mkdtempSync(join(tmpdir(), 'deep-390-atlas-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('AC3 two labels in two colors from one shaped run share one atlas page and draw through the patch\'s tinted mask sprite', () => {
  it('AC3 the two labels have one coverage mask tinted per instance: equal red channels, different green', () => {
    requireMacos();
    const out = join(scratch, 'two-labels.png');
    const report = one(RENDER_BIN, ['render'], {
      out, card: { w: 320, h: 120, color: CARD },
      labels: [
        { text: 'Ready 1,234', x: 16, y: 12, size: 24, weight: 400, font: 'body', color: WHITE },
        { text: 'Ready 1,234', x: 16, y: 64, size: 24, weight: 400, font: 'body', color: RED },
      ],
    });
    if (report['ok'] !== true && report['code'] === 'unsupported_platform') expect.fail('INCONCLUSIVE: the render reports unsupported_platform; this is not a pass');
    expect(report['ok'], `render: ${JSON.stringify(report)}`).toBe(true);
    expect(existsSync(out), 'the PNG was written').toBe(true);
    const image = readPng(out);
    const a = labelBox(report, 0);
    const b = labelBox(report, 1);
    expect([b.w, b.h], 'one shaped run: both labels report the same box size').toEqual([a.w, a.h]);

    // Both colors share the card's red (24) and the label's red (255), so the red channel of each pixel
    // is the card blended with the glyph's coverage alone, whatever space the blend runs in. One alpha
    // mask tinted per instance gives the same red channel at the same offset in both labels. A twin that
    // rasterizes each color on its own through GPUI's text system fails here: its macOS rasterizer dilates
    // white (luminance level 4) and this red (level 1) differently.
    let worst = 0; let worstAt: [number, number] = [0, 0]; let greenGap = 0; let inked = 0;
    for (let dy = 0; dy < a.h; dy++) for (let dx = 0; dx < a.w; dx++) {
      const pa = pixel(image, a.x + dx, a.y + dy);
      const pb = pixel(image, b.x + dx, b.y + dy);
      const d = Math.abs(pa[0] - pb[0]);
      if (d > worst) { worst = d; worstAt = [dx, dy]; }
      greenGap = Math.max(greenGap, pa[1] - pb[1]);
      if (pa[0] > 128) inked++;
    }
    expect(inked > 20, `the labels have ink: ${inked} bright pixels in the first box`).toBe(true);
    expect(worst <= 3, `the red channels of the two labels differ by ${worst} at offset ${JSON.stringify(worstAt)}: not one mask tinted per instance`).toBe(true);
    expect(greenGap >= 150, `the labels differ in color: the largest green gap between them is ${greenGap}`).toBe(true);

    // The render's own account, read alongside the pixels: one shaped run, one page, sprites.
    expect(report['shaped'], `one shaped run for the two labels: ${JSON.stringify(report)}`).toBe(1);
    const draws = report['draws'];
    expect(Array.isArray(draws) && (draws as JsonValue[]).length === 2, `two draws, one per label: ${JSON.stringify(report['draws'])}`).toBe(true);
    const list = (draws as JsonValue[]).filter(isObject);
    expect(list.map((d) => d['kind']), 'both draws are tinted mask sprites').toEqual(['tinted_mask_sprite', 'tinted_mask_sprite']);
    expect(list[1]!['page'], `both draws read one atlas page: ${JSON.stringify(list)}`).toEqual(list[0]!['page']);
    expect(list[0]!['color'], 'the first draw is tinted white').toEqual(WHITE);
    expect(list[1]!['color'], 'the second draw is tinted red').toEqual(RED);
    const pages = report['pages'];
    expect(Array.isArray(pages) && (pages as JsonValue[]).length === 1, `one atlas page in use: ${JSON.stringify(pages)}`).toBe(true);
  }, 300_000);
});

describe('AC3 no call into GPUI\'s text system, checked from the dependency tree and the call-site lint', () => {
  it('AC3 the dependency tree: deep-text reaches parley, skrifa and vello_cpu, and never swash or any gpui crate', () => {
    const meta = cargoMetadata();
    const closure = normalClosure(meta, 'deep-text');
    for (const need of ['parley', 'skrifa', 'vello_cpu']) {
      expect(closure.has(need), `deep-text's normal dependency closure holds ${need}; it holds ${[...closure].sort().join(', ')}`).toBe(true);
    }
    // swash carries a shaper of its own (design: Which text shaper); gpui-pre* is the text system to avoid.
    const forbidden = [...closure].filter((name) => name === 'swash' || name.startsWith('gpui'));
    expect(forbidden, `deep-text's closure must not hold a second shaper or GPUI, found: ${forbidden.join(', ')}`).toEqual([]);
  }, 300_000);

  it('AC3 the crate that draws the labels is in the call-site lint\'s scope', () => {
    const meta = cargoMetadata();
    const owner = meta.packages.find((p) => meta.workspace_members.includes(p.id) && p.targets.some((t) => t.name === RENDER_BIN_NAME && t.kind.includes('bin')));
    expect(owner, `a workspace crate has the bin target ${RENDER_BIN_NAME}`).toBeDefined();
    const deep = isObject(owner!.metadata) && isObject(owner!.metadata['deep']) ? owner!.metadata['deep'] : null;
    const inScope = owner!.name.startsWith(SCOPE_PREFIX) || (deep !== null && deep[SCOPE_MARKER] === true);
    expect(inScope, `${owner!.name} (${owner!.manifest_path}) is named deep-text* or carries [package.metadata.deep] ${SCOPE_MARKER} = true, so the lint reads its draw calls`).toBe(true);
  }, 300_000);

  it('AC3 the call-site lint passes the repo: no scope crate calls GPUI\'s text system', () => {
    expect(existsSync(LINT), 'scripts/text-lint.mjs exists').toBe(true);
    const run = spawnSync(process.execPath, [LINT], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.error) throw Error(`scripts/text-lint.mjs: ${run.error.message}`);
    const output = `${run.stdout}\n${run.stderr}`;
    expect(run.status, `the lint found a call into GPUI's text system in the repo:\n${output}`).toBe(0);
    expect(output.split('\n').filter((line) => /^FAIL\b/.test(line.trim())), 'no FAIL line on the repo').toEqual([]);
  }, 300_000);
});
