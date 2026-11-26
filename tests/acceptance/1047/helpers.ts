// Test-side tools for the #1047 acceptance tests (README: The surface). They reuse #184's replica process and pool
// (`deep-drive` processes behind the hub's replica, every play logged with its reply), its runs, its maze player and
// its verdict; have the logic module (`deep-logic`, through #533's helpers) write this suite's saves; and open a hub
// of their own: an extension host with the playtest plug-in loaded, and #184's maze player when a test asks for it.
// Every play, hash, save, refusal and result read here is the implementation's own; the expected values come from
// the issue's text, the save's own header and a straight run. Nothing stands in for the replica, the host, the
// plug-in or the logic module. Processes are #184's helpers' children, stopped by PID; folders are temporary.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, expect } from 'vitest';
import { PLAYER_ID, PLAYTEST_DIR, PLAYTEST_ID, REPO, blocked, sha256, show, tempDir, type Hub, type Obj, type Pool } from '../184/helpers.ts';
import { onLogic } from '../533/helpers.ts';
import { fullState } from './judges.ts';
import { MAZE, SAVED_AT, SAVE_TRACK, SLOT } from './programs.ts';

export {
  MEASURE, Pool, RUNS, SEED, SPAN_S, TIMEOUT, WON, driveBin, judge, keepAsset, macOnly, none, playInput, putPiece, runPlayer, runPlaytest, runSeed,
  runsOf, scalar, show, shown, type CheckResult, type Hub, type Obj, type Played, type RunPlays,
} from '../184/helpers.ts';

/** The hub's one document: the clean maze, as revision 1. */
export const DOC = '01JD1047P00000000000000001';

// ---------------------------------------------------------------------------------------------------
// The hub: an extension host whose replica is the pool's, with the playtest plug-in (packages/checks/playtest)
// installed under a grant of the maze's document and loaded, and with #184's maze player (its fixture, a test check
// plug-in whose runner a test configures) installed and loaded under the same grant when asked.

const closers: (() => Promise<void>)[] = [];
afterAll(async () => { for (const close of closers.splice(0)) await close().catch(() => undefined); }, 120_000);

export async function openHub(pool: Pool, o: { player?: boolean } = {}): Promise<Hub> {
  const hostEntry = await import('../../../packages/extension-host/src/index.ts');
  const { openRecord } = await import('../../../packages/record/src/index.ts');
  const { openAsks } = await import('../../../packages/asks/src/index.ts');
  const { openSupervisor } = await import('../../../packages/supervisor/src/index.ts');
  const dir = tempDir('hub1047');
  const home = join(dir, 'deepbuild');
  mkdirSync(home, { recursive: true });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  const trust = await hostEntry.openTrust({ record, now: Date.now });

  if (!existsSync(join(PLAYTEST_DIR, 'deepbuild.json'))) blocked('the playtest plug-in (packages/checks/playtest, #184) isn\'t in this checkout');
  const m = JSON.parse(readFileSync(join(PLAYTEST_DIR, 'deepbuild.json'), 'utf8')) as Obj;
  const release = [{ id: PLAYTEST_ID, version: String(m['version']), digest: hostEntry.packageDigest(PLAYTEST_DIR) }];
  let pkg = '';
  let player: Hub['player'] = null;
  if (o.player) {
    pkg = tempDir('pkg-maze-player');
    cpSync(join(REPO, 'tests', 'acceptance', '184', 'fixtures', 'maze-player'), pkg, { recursive: true });
    for (const e of readdirSync(pkg)) if (e.endsWith('.fixture')) renameSync(join(pkg, e), join(pkg, e.slice(0, -'.fixture'.length)));
    const config = join(tempDir('player'), 'config.json');
    player = { config, seen: join(dirname(config), 'seen.jsonl') };
    writeFileSync(join(pkg, 'player.json'), JSON.stringify({ config }));
    const manifestPath = join(pkg, 'deepbuild.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Obj;
    manifest['digest'] = hostEntry.packageDigest(pkg);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    release.push({ id: PLAYER_ID, version: String(manifest['version']), digest: hostEntry.packageDigest(pkg) });
  }
  const host = await hostEntry.openExtensionHost({
    record, asks, supervisor: sup, trust, home, release, now: Date.now, replica: pool.hub,
  } as unknown as Parameters<typeof hostEntry.openExtensionHost>[0]) as unknown as Obj;
  closers.push(async () => { await host['close']().catch(() => undefined); await sup.close().catch(() => undefined); await record.close().catch(() => undefined); });
  await host['ready']();
  for (const [id, from] of [[PLAYTEST_ID, PLAYTEST_DIR], ...(o.player ? [[PLAYER_ID, pkg]] : [])] as [string, string][]) {
    const installed = await host['install']({ from, builtBy: null, grant: { docs: [DOC] } });
    const conformance = await host['check'](installed);
    expect(conformance.passed, `${id} passes conformance: ${show(conformance)}`).toBe(true);
    const load = await host['load'](installed);
    expect(load.status === 'loaded' && load.place, `${id} loads in the hub: ${show(load)}`).toBe('hub');
  }
  return { host, player };
}

// ---------------------------------------------------------------------------------------------------
// The save (README: The maze and its save): the logic module's own, written by `deep-logic`'s `bake` of the piece
// over the recorded presses, in a saves folder, when the maze asks for it at the end of step 1,799.

export interface Saved {
  /** Its asset ID: the SHA-256 of its bytes, which names its file. */
  id: string;
  bytes: Buffer;
  b64: string;
  header: Obj;
  /** The state layout it is bound to, as its header names it. */
  layout: string;
  /** The piece's full-state hash when it was written, formed from its header's `deep_hash` as a play forms one. */
  hash: string;
}
/** The save of `piece` at step 1,800. A save the logic module didn't write is BLOCKED, naming what it answered. */
export function saveOf(piece: Obj, what: string): Saved {
  const dir = tempDir('saves1047');
  const [reply] = onLogic([{ call: 'bake', piece, track: SAVE_TRACK, steps: SAVED_AT, saves_dir: dir } as never]) as Obj[];
  const saves = (Array.isArray(reply?.['saves']) ? reply['saves'] : []) as Obj[];
  const wrote = saves.map((s) => [s['item'], s['slot'], s['step']]);
  if (reply?.['ok'] !== true || JSON.stringify(wrote) !== JSON.stringify([[MAZE, SLOT, SAVED_AT]])) {
    blocked(`${what}: the logic module didn't write the fixture save, slot ${SLOT} of ${MAZE} at step ${SAVED_AT} alone; its bake wrote ${show(wrote)}: ${show({ ...reply, steps: undefined, checkpoints: undefined }, 600)}`);
  }
  const id = String(saves[0]!['hash']);
  const file = join(dir, `${id}.save`);
  if (!existsSync(file)) blocked(`${what}: the fixture save ${id} isn't in its saves folder as <sha256>.save`);
  const bytes = readFileSync(file);
  const line = bytes.subarray(0, Math.max(0, bytes.indexOf(0x0a))).toString('utf8');
  let header: Obj = {};
  try { header = JSON.parse(line) as Obj; } catch { blocked(`${what}: the fixture save ${id}'s first line isn't its JSON header`); }
  const deep = header['deep_hash'] as Record<string, unknown> | undefined;
  if (sha256(bytes) !== id || header['step'] !== SAVED_AT || typeof header['layout'] !== 'string' || typeof deep?.[MAZE] !== 'string') {
    blocked(`${what}: the fixture save ${id} isn't a whole save at step ${SAVED_AT} naming its layout and ${MAZE}'s full-state hash: sha256 ${sha256(bytes)}, header ${show(header, 600)}`);
  }
  return { id, bytes, b64: bytes.toString('base64'), header, layout: header['layout'] as string, hash: fullState(deep!, [MAZE]) };
}
