// Test-side tools for criteria 6, 7 and 8 and the two Scope lines with no criterion (README: Criteria 6 to 8): the
// fixtures, the stress set's strings, the `ui_check` call, and the pixel readers a judge needs. Nothing here stands in
// for the replica: every reply, snapshot and PNG comes from the `deep-drive` binary.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { Drive, FIXTURES, decodePng, must, sha256, type Box, type Image, type Node, type Obj, nodesOf } from './helpers.ts';

/** The criteria, as `ID` in helpers.ts. */
export const AC = { scrim: '#124.770659f5', check: '#124.5bbd73d9', shown: '#124.ca19630a' } as const;

const panel = (name: string): string => join(FIXTURES, 'panels', name);
export const SCRIM_PANEL = panel('scrim-dialog');
export const CLEAN_PANEL = panel('audit-clean');
export const MARKS_PANEL = panel('audit-marks');
const inRepo = (name: string, file: string): string => `tests/acceptance/124/fixtures/panels/${name}/${file}`;
export const CLEAN = { main: inRepo('audit-clean', 'main.js'), words: inRepo('audit-clean', 'words.js'), unloaded: inRepo('audit-clean', 'unloaded.js') };
export const MARKS_MAIN = inRepo('audit-marks', 'main.js');

/** The session row's source (crates/deep-app/inventory.json: deepbuild/sidebar's entry), and a file no view loads. */
export const ROW_FILE = 'crates/deep-app/src/views.rs';
export const SIDEBAR = 'deepbuild/sidebar';
export const UNLOADED_FILE = 'crates/deep-replica/src/live.rs';

/** The reference window (technical design): 1512 x 982 points at 2x. */
export const REFERENCE: [number, number] = [1512, 982];
export const REFERENCE_SCALE = 2;

/** The stress set: one session titled with each string, in fixtures/stress/text.events.jsonl. */
export const STRESS_FILE = join(FIXTURES, 'stress', 'text.events.jsonl');
export const STRESS = {
  repo: 'github.com/northwind-platform-engineering/monorepo-services-payments-reconciliation-batch-processor-legacy-migration-2026',
  branch: 'feature/PLAT-48213-reconcile-ledger-snapshots-across-regions-with-idempotent-retry-and-backfill-verification-phase-three',
  worktree: '/Users/dev/src/worktrees/monorepo-services-payments-reconciliation/feature-PLAT-48213-reconcile-ledger-snapshots-across-regions',
  issue: 'Reconcile ledger snapshots across every region before the nightly settlement window closes, with idempotent retries, a backfill verifier and a dry run that proves no double posting',
  model: 'accounts/northwind/models/gpt-5.1-codex-max-2026-03-15-preview-128k-context-priority-tier-us-east-1-reserved',
  command: 'npx vitest run --root tests/acceptance/ledger --no-file-parallelism --reporter=verbose --testNamePattern=reconcile-ledger-snapshots --coverage.enabled=true --coverage.reporter=lcov',
} as const;

/** `{call: "ui_check"}` in a fresh process (one with `plant` planted); its reply, whatever it says. */
export async function uiCheck(args: Obj, plant?: string): Promise<Obj> {
  const drive = await Drive.start(plant ? { plant } : {});
  try {
    return (await drive.call({ call: 'ui_check', ui_check: args }, 900_000)).reply;
  } finally {
    await drive.stop();
  }
}
/** The same, failing the test with the binary's words when the check didn't answer. */
export async function checked(args: Obj, plant?: string): Promise<Obj> {
  const reply = await uiCheck(args, plant);
  expect(reply.ok, `ui_check answers: ${JSON.stringify(reply).slice(0, 800)}`).toBe(true);
  return reply;
}

export const viewOf = (reply: Obj, view: string): Obj => {
  const found = (reply.views as Obj[] | undefined)?.find((v) => v.view === view);
  expect(found, `the check rendered ${view}; it rendered ${JSON.stringify((reply.views as Obj[] | undefined)?.map((v) => v.view))}`).toBeTruthy();
  return found!;
};

/** A render's PNG, its file checked against its hash. */
export function shotOf(render: { path: string; sha256: string }): Image {
  const bytes = readFileSync(render.path);
  expect(sha256(bytes), `${render.path} hashes to its sha256`).toBe(render.sha256);
  return decodePng(bytes);
}

/** What one render's row is: the row whose accessible name starts its title (the row's mark comes first). */
export function rowIn(snapshot: Obj, title: string): Node {
  const start = title.slice(0, 16);
  const rows = nodesOf(snapshot).filter((n) => n.role === 'button' && typeof n.name === 'string' && n.name.includes(start));
  expect(rows.length, `one session row starts "${start}": ${JSON.stringify(rows.map((r) => r.name))}`).toBe(1);
  return rows[0]!;
}

/** Device pixels in the `width`-wide band right of `box`, over its height, that differ from the band's first pixel. */
export function inkPast(image: Image, box: Box, width: number): number {
  const [x, y, w, h] = box;
  const at = (px: number, py: number): number => (py * image.width + px) * 4;
  const ground = at(x + w, y);
  let ink = 0;
  for (let py = y; py < y + h; py++) for (let px = x + w; px < x + w + width; px++) {
    const q = at(px, py);
    if ([0, 1, 2].some((c) => Math.abs(image.rgba[q + c]! - image.rgba[ground + c]!) > 32)) ink++;
  }
  return ink;
}

/** Whole-image mean luma, 0 to 255. */
export function luma(image: Image): number {
  let sum = 0, n = 0;
  for (let q = 0; q < image.rgba.length; q += 4 * 7) { sum += 0.2126 * image.rgba[q]! + 0.7152 * image.rgba[q + 1]! + 0.0722 * image.rgba[q + 2]!; n++; }
  return sum / n;
}

/** Pixels of `box` that differ between two images of one size. */
export function differing(a: Image, b: Image, box: Box = [0, 0, a.width, a.height]): number {
  expect([a.width, a.height], 'two images of one size').toEqual([b.width, b.height]);
  let n = 0;
  for (let y = box[1]; y < box[1] + box[3]; y++) for (let x = box[0]; x < box[0] + box[2]; x++) {
    const q = (y * a.width + x) * 4;
    if (a.rgba[q] !== b.rgba[q] || a.rgba[q + 1] !== b.rgba[q + 1] || a.rgba[q + 2] !== b.rgba[q + 2] || a.rgba[q + 3] !== b.rgba[q + 3]) n++;
  }
  return n;
}

export { must };
