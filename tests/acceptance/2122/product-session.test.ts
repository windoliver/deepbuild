import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { productWorld } from './products-helper.ts';

it('AC2: a PreToolUse from a live session after restart protects its old worktree product from reclamation', async () => {
  const w = await productWorld();
  try {
    const first = await w.open();
    expect((await w.build(first)).map((e) => e.kind)).toContain('product.built');
    const top = await w.worktree();
    await first.sessionStart('live-session', top, 'initial-start');
    expect(readFileSync(join(top, 'out/value'), 'utf8'), 'real session start placed the product').toBe('fresh');
    expect(w.index().placed).toHaveLength(1);
    first.close();
    w.advance(3 * 3_600_000);
    const reopened = await w.open();
    expect(w.index().placed[0].top).toBe(top);
    w.lowDisk();
    // cwd can be below the worktree root; no SessionStart is replayed after restart.
    const cwd = join(top, 'src');
    mkdirSync(cwd);
    const meta = { event: 'PreToolUse', session: 'live-session', toolUse: 'still-working', cwd };
    await reopened.hook(meta);
    // Hook bookkeeping may dispatch its git lookup without returning that promise.
    await sleep(1000);
    await reopened.reclaimOne();
    const kept = existsSync(join(top, 'out/value'));
    console.log('AC2 worktree product retained after restart hook and low-disk reclaim:', kept);
    expect.soft(kept, 'a live worktree must not be reclaimed as nobody working there').toBe(true);
    expect.soft(w.index().placed.map((p: { top: string }) => p.top), 'placement remains indexed').toContain(top);
  } finally { await w.close(); }
}, 90_000);
