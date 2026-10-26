// The slot scenarios AC5 and AC8 share: the published extension API contract and the hub-slot table as the
// preflight reads them (packages/contracts/extension-api.json and hub-slots.json), copied to a temp folder with a
// planted declaration, and the real preflight check, scripts/slots-check.mjs, run on those copies.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ApiEntry, HubSlot } from '../../../packages/contracts/src/index.ts';
import { NODE, REPO, SLOTS_CHECK, tempDir } from './helpers.ts';

export const API_FILE = join(REPO, 'packages/contracts/extension-api.json');
export const TABLE_FILE = join(REPO, 'packages/contracts/hub-slots.json');
export const readApi = (): ApiEntry[] => JSON.parse(readFileSync(API_FILE, 'utf8')) as ApiEntry[];
export const readTable = (): HubSlot[] => JSON.parse(readFileSync(TABLE_FILE, 'utf8')) as HubSlot[];

export interface Checked { status: number | null; stdout: string; stderr: string; fails: string[] }
/** The preflight's slot check on a temp copy of the contract: its exit status and its `FAIL slots:` lines. */
export function runSlotsCheck(api: readonly ApiEntry[], table: readonly HubSlot[]): Checked {
  const dir = tempDir('slots');
  writeFileSync(join(dir, 'extension-api.json'), JSON.stringify(api, null, 2));
  writeFileSync(join(dir, 'hub-slots.json'), JSON.stringify(table, null, 2));
  const r = spawnSync(NODE, [SLOTS_CHECK, '--api', join(dir, 'extension-api.json'), '--table', join(dir, 'hub-slots.json')], {
    cwd: REPO, encoding: 'utf8', timeout: 300_000, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', NO_COLOR: '1' },
  });
  const stdout = r.stdout ?? '';
  return { status: r.status, stdout, stderr: r.stderr ?? '', fails: stdout.split('\n').filter((line) => line.startsWith('FAIL slots')) };
}
export const ZERO = `d1:${'0'.repeat(64)}`;
