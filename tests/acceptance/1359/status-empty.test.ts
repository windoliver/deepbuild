// #1359 AC5 (README): `deep status` with no session says to start a Claude Code or Codex session in a repo.
import { afterAll, describe, expect, it } from 'vitest';
import { SECOND, cleanup, deep, needBuild, setUp, shown, world } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const ID = '#1359.79fe1f46';

describe(`${ID} deep status with no session`, () => {
  it(`${ID} says to start a Claude Code or Codex session in a repo`, async () => {
    needBuild();
    const w = world();
    const set = await setUp(w);
    if (set.code !== 0) throw Error(`BLOCKED: deep setup didn't set the home up with a hub: ${shown(set)}`);
    const r = await deep(w, ['status'], { timeoutMs: 60 * SECOND });
    const said = r.stdout.split('\n').filter((l) => /\bstart\b/i.test(l) && l.includes('Claude Code') && l.includes('Codex') && /\bsession\b/.test(l) && /\brepo\b/.test(l));
    expect(said, `deep status with no session must say to start a Claude Code or Codex session in a repo: ${shown(r)}`).not.toEqual([]);
  }, 300 * SECOND);
});
