// #1359 AC7 (README): with no deep-hook built and no cargo, setup's stop reason names rustup and `cargo build --locked
// -p deep-hook`, never a bare ENOENT. The checkout is a copy with no target/ (helpers: hooklessCheckout), and no
// `cargo` is on PATH.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SECOND, cleanup, deep, hooklessCheckout, needBuild, rootOf, shown, world } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const ID = '#1359.af4449b9';

describe(`${ID} setup with no deep-hook built and no cargo`, () => {
  it(`${ID} stops naming rustup and cargo build --locked -p deep-hook, never a bare ENOENT`, async () => {
    needBuild();
    const { cli } = hooklessCheckout();
    const w = world();
    const r = await deep(w, ['setup'], { cli, timeoutMs: 180 * SECOND });
    expect(r.code, `setup can't build deep-hook with no cargo, so it stops: ${shown(r)}`).not.toBe(0);
    for (const [where, text] of [['stderr', r.stderr], ['the stop record, ~/.deepbuild/setup-stopped.json', existsSync(join(rootOf(w), 'setup-stopped.json')) ? readFileSync(join(rootOf(w), 'setup-stopped.json'), 'utf8') : '']] as const) {
      expect(text, `setup's stop reason in ${where} must name rustup: ${shown(r)}`).toMatch(/rustup/);
      expect(text, `setup's stop reason in ${where} must name cargo build --locked -p deep-hook: ${shown(r)}`).toContain('cargo build --locked -p deep-hook');
      expect(text, `setup's stop reason in ${where} is a bare ENOENT: ${shown(r)}`).not.toMatch(/ENOENT/);
    }
  }, 300 * SECOND);
});
