// AC4 #1425.24afae64, AC6 #1425.1d938ac0 and AC8 #1425.859baf8e: what the lint lane holds for the panel module, through
// its own command, `node scripts/panel-catalog.mjs` (README, The surface), run from the repo root as the lane runs it.
// Each criterion is read twice: on this checkout directly, and through the lane's command with one planted fault,
// which must fail it with a line starting FAIL that names what the criterion says.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import {
  AC4, AC6, AC8, CATALOG, failLines, guideFiles, laneRunsLint, lint, LINT, pinnedInventory, readCatalog, REPO, show, toolkitComponents,
} from './helpers.ts';

const scratch = mkdtempSync(join(tmpdir(), 'deep-1425-lint-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** The lane has the check, and the check passes this checkout: a plant's failure is then the plant's. */
async function cleanLane(): Promise<void> {
  expect(await laneRunsLint(), `the lint lane in scripts/lanes.mjs runs [node, "${LINT}"]`).toBe(true);
  const clean = lint();
  expect(clean.code === 0 && failLines(clean).length === 0, `${LINT} passes this checkout\n${show(clean)}`).toBe(true);
}

test(`${AC4} the extension guide and its samples contain no "gpui-" string`, () => {
  const files = guideFiles();
  expect(files, 'the guide and its samples are there').toContain('docs/extension-guide/plugin/panel/main.js');
  const found = files.flatMap((file) => readFileSync(join(REPO, file), 'utf8').split('\n')
    .flatMap((line, at) => (line.includes('gpui-') ? [`${file}:${at + 1}: ${line.trim()}`] : [])));
  expect(found, found.join('\n')).toEqual([]);
});

test(`${AC4} planted: a "gpui-" line in a guide sample fails the lint lane, naming the file and line`, async () => {
  await cleanLane();
  const planted = 'docs/extension-guide/plugin/panel/planted-1425.js';
  writeFileSync(join(REPO, planted), '// #1425 AC4: a planted line, removed when the test ends.\n// Built on gpui-kit.\n');
  try {
    const r = lint();
    expect(r.code, show(r)).not.toBe(0);
    expect(failLines(r).some((l) => l.includes(`${planted}:2`)), `a FAIL line names ${planted}:2\n${show(r)}`).toBe(true);
  } finally {
    rmSync(join(REPO, planted), { force: true });
  }
});

test(`${AC6} every component the pinned toolkit exports is on the catalog or on its not_offered list`, () => {
  const catalog = readCatalog();
  const listed = new Set([...(catalog.components ?? []), ...(catalog.not_offered ?? [])].map((entry) => entry.name));
  const exported = toolkitComponents(pinnedInventory());
  expect(exported.length, 'the inventory lists components').toBeGreaterThan(100);
  const missing = exported.filter((name) => !listed.has(name));
  expect(missing, `on neither list in ${CATALOG}: ${missing.join(', ')}`).toEqual([]);
});

test(`${AC6} planted: a toolkit bump with a new component on neither list fails the lint lane, naming it`, async () => {
  await cleanLane();
  const inventory = JSON.parse(readFileSync(pinnedInventory(), 'utf8')) as { items: unknown[] };
  const same = join(scratch, 'inventory-same.json');
  writeFileSync(same, JSON.stringify(inventory));
  const unchanged = lint({ DEEP_PANEL_TOOLKIT_INVENTORY: same });
  expect(unchanged.code === 0 && failLines(unchanged).length === 0, `the pinned inventory, named by DEEP_PANEL_TOOLKIT_INVENTORY, passes\n${show(unchanged)}`).toBe(true);
  inventory.items.push({
    source: 'ui', name: 'planted_gauge', classification: 'component',
    registration: { status: 'registered', descriptor: 'Planted1425Gauge', exports: ['Planted1425Gauge'] },
  });
  const bumped = join(scratch, 'inventory-bumped.json');
  writeFileSync(bumped, JSON.stringify(inventory));
  const r = lint({ DEEP_PANEL_TOOLKIT_INVENTORY: bumped });
  expect(r.code, show(r)).not.toBe(0);
  expect(failLines(r).some((l) => /\bPlanted1425Gauge\b/.test(l)), `a FAIL line names Planted1425Gauge\n${show(r)}`).toBe(true);
});

test(`${AC8} each not_offered entry has a reason`, () => {
  const entries = readCatalog().not_offered;
  expect(Array.isArray(entries), `${CATALOG} has a not_offered list`).toBe(true);
  const bad = entries!.filter((entry) => typeof entry.name !== 'string' || !entry.name || typeof entry.reason !== 'string' || !entry.reason.trim());
  expect(bad, `entries with no name or no reason: ${JSON.stringify(bad)}`).toEqual([]);
});

test(`${AC8} planted: a not_offered entry with no reason fails the lint lane, naming it`, async () => {
  await cleanLane();
  const catalog = readCatalog();
  const entries = catalog.not_offered ?? [];
  expect(entries.length, `${CATALOG} has a not_offered entry to plant in`).toBeGreaterThan(1);
  const [first, second] = [String(entries[0]!.name), String(entries[1]!.name)];
  const planted = { ...catalog, not_offered: entries.map((entry, at) => (at === 0 ? { name: entry.name } : at === 1 ? { ...entry, reason: '   ' } : entry)) };
  const path = join(scratch, 'catalog-planted.json');
  writeFileSync(path, JSON.stringify(planted, null, 2));
  const r = lint({ DEEP_PANEL_CATALOG: path });
  expect(r.code, show(r)).not.toBe(0);
  for (const name of [first, second]) {
    const word = new RegExp(`(^|[^\\w])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w]|$)`);
    expect(failLines(r).some((l) => word.test(l)), `a FAIL line names ${name}, whose reason is ${name === first ? 'missing' : 'blank'}\n${show(r)}`).toBe(true);
  }
});
