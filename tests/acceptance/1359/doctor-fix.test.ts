// #1359 AC1 (README): in a home nobody set up, `deep doctor`'s `hub.socket` fix names `deep setup`, never `deep hub
// start`; once set up, with the hub not answering, it names `deep hub start` as before.
import { afterAll, describe, expect, it } from 'vitest';
import { SECOND, cleanup, deep, needBuild, setUp, shown, stopHubs, world, type World } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const ID = '#1359.2b00ab6a';

/** `deep doctor --json`'s `hub.socket` item in `w`. */
async function hubItem(w: World): Promise<Record<string, unknown>> {
  const r = await deep(w, ['doctor', '--json'], { timeoutMs: 120 * SECOND });
  const items = r.stdout.split('\n').filter((l) => l.trim().startsWith('{')).map((l) => JSON.parse(l) as Record<string, unknown>);
  const item = items.find((i) => i.item === 'hub.socket');
  if (!item) throw Error(`deep doctor --json printed no hub.socket item: ${shown(r)}`);
  return item;
}

describe(`${ID} deep doctor's fix for a hub that doesn't answer`, () => {
  it(`${ID} in a home nobody set up, names deep setup and never deep hub start`, async () => {
    needBuild();
    const item = await hubItem(world());
    expect(item.level, JSON.stringify(item)).toBe('fail');
    expect(String(item.fix), JSON.stringify(item)).toContain('deep setup');
    expect(String(item.fix), `in a home nobody set up, deep hub start starts a hub no hook reaches: ${JSON.stringify(item)}`).not.toContain('deep hub start');
  }, 150 * SECOND);

  it(`${ID} once set up, with the hub stopped, names deep hub start as before`, async () => {
    needBuild();
    const w = world();
    const r = await setUp(w);
    if (r.code !== 0) throw Error(`BLOCKED: deep setup didn't set the home up: ${shown(r)}`);
    await stopHubs(w);
    const item = await hubItem(w);
    expect(item.level, JSON.stringify(item)).toBe('fail');
    expect(String(item.fix), JSON.stringify(item)).toContain('deep hub start');
  }, 400 * SECOND);
});
