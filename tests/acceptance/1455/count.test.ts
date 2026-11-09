// AC6: one ask reads "1 ask needs you" in every place that shows the sentence: Home, the list and the menu bar (the
// issue's Scope). Home and the list are read as `deep-drive` draws Home over the fixture record with one ask open. The
// menu bar's title, and the list once more, come from the replica's first screen (#1002's `deep-replica
// --first-screen` and its `menu-bar.txt`), drawn for a home whose real hub holds one open ask, seeded through the real
// record and asks core as #26's suite seeds them. The first screen opens on Needs you, which shows no count sentence.
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as t26 from '../26/helpers.ts';
import {
  AC6, blocked, cleanup, countFailures, deepHook, Drive, flatten, inList, makeHome, MINUTES, oneAskRecord, readFileSync, replicaBinaries, run, shown, strings, tempDir, type Count, type Node,
} from './helpers.ts';

afterAll(async () => { await cleanup(); await t26.cleanup(); }, 60_000);
const LONG = 30 * MINUTES;

/** Home and the list as the app draws Home over a record with one open ask. */
async function home(drive: string, plant?: string): Promise<Count[]> {
  const d = await Drive.start(drive, makeHome(), plant);
  try {
    await d.must({ call: 'launch', launch: { from: 'fixture', fixture: oneAskRecord(), center: 'deepbuild/home' } });
    const seen = await d.see();
    const all = strings((n) => (inList(n, seen.width) ? 'list' : 'home'), seen);
    return [
      { surface: 'home', texts: all.filter((s) => s.view === 'home').map((s) => s.text) },
      { surface: 'list', texts: all.filter((s) => s.view === 'list').map((s) => s.text) },
    ];
  } finally {
    await d.stop();
  }
}

/** The list and the menu bar on the first screen of a home whose hub holds exactly one open ask. */
async function firstScreen(replica: string, plant?: string): Promise<Count[]> {
  const where = makeHome();
  const session = t26.ulid();
  await t26.seed(where, async (s) => {
    await s.start(session);
    await s.raise(session, 'choice', 'Keep the old logo in the header?');
  });
  await deepHook();
  const hub = await t26.startHub(where);
  try {
    const out = join(tempDir(), 'out');
    const r = await run(replica, ['--first-screen', '--out', out, '--appearance', 'light'], { env: t26.childEnv(where, { DEEP_HUB_PLANT: plant }), timeoutMs: 10 * MINUTES });
    if (r.code !== 0) blocked(`deep-replica --first-screen didn't draw: ${shown(r)}`);
    const snapshot = JSON.parse(readFileSync(join(out, 'snapshots/first-screen.json'), 'utf8')) as { window: { size: number[]; scale: number }; tree: Node };
    const width = snapshot.window.size[0]! * snapshot.window.scale;
    return [
      { surface: 'list', texts: flatten(snapshot.tree).filter((n) => n.name?.trim() && inList(n, width)).map((n) => n.name!) },
      { surface: 'menu bar', texts: [readFileSync(join(out, 'menu-bar.txt'), 'utf8').trim()] },
    ];
  } finally {
    await t26.stopHub(hub);
  }
}
async function oneAsk(plant?: string): Promise<Count[]> {
  const { plain, plants } = await replicaBinaries();
  const bin = plant ? plants : plain;
  return [...await home(bin.drive, plant), ...await firstScreen(bin.replica, plant)];
}

describe('#1455 one count sentence', () => {
  let clean: Count[] = [];
  it(`${AC6}: one ask reads "1 ask needs you" in every place that shows the sentence`, async () => {
    clean = await oneAsk();
    expect(countFailures(clean), JSON.stringify(clean)).toEqual([]);
  }, LONG);

  it(`${AC6}: a planted "1 asks" fails, naming the surface`, async () => {
    if (!clean.length) clean = await oneAsk();
    expect(countFailures(clean), 'the clean run already fails AC6, so the plant can\'t be told from it').toEqual([]);
    const failures = countFailures(await oneAsk('count-one-asks'));
    expect(failures.filter((f) => f.startsWith('the home reads') && f.includes('1 asks')), `the planted "1 asks" on Home wasn't caught, naming Home: ${JSON.stringify(failures)}`).not.toEqual([]);
  }, LONG);
});
