// #3108.6d9cc561: "A hub started from `scripts/install-prefix.mjs`'s tree starts, and `deep doctor` answers".
//
// asserts: `node scripts/install-prefix.mjs --prefix <temp>` lays out the installed tree (#1720's helpers, install(), which
// also puts the checkout's built deep-hook where the tree's hub looks for it, as npm's optional platform package would).
// That tree's own `<prefix>/bin/deep hub run`, in a temporary HOME, starts: its first stdout line is a JSON line with
// `ready: true` (#1720's startHub). With that hub running, the tree's own `deep doctor --json` in the same HOME answers:
// it ends by itself, not killed at its limit, and its stdout is one or more doctor items, every line a JSON object with
// a string `item` and `level`. The hub is stopped by its PID (cleanup). All failures are gathered and asserted at once,
// so a run that fails names each part that failed.
import { afterAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { cleanup, doctor, install, startHub, tempDir } from '../1720/helpers.ts';
import { MINUTE } from './helpers.ts';

afterAll(cleanup, MINUTE);

const message = (error: unknown): string => String((error as Error)?.message ?? error);

describe('#3108 the installed tree holds what its hub reads when it loads', () => {
  it('#3108.6d9cc561 the installed tree\'s deep hub run starts, and its deep doctor --json answers with doctor items', async () => {
    const failures: string[] = [];
    let deep = '';
    try {
      deep = install().deep;
    } catch (error) {
      failures.push(`scripts/install-prefix.mjs lays out the installed tree: ${message(error).slice(0, 1500)}`);
    }
    expect(failures, `the installed tree is laid out:\n  ${failures.join('\n  ')}`).toEqual([]);

    const home = join(tempDir('h-'), 'h');
    mkdirSync(home);
    try {
      const hub = await startHub(deep, home);
      if (hub.child.exitCode !== null) failures.push(`the installed tree's hub (${deep} hub run) exited ${hub.child.exitCode} after its ready line`);
    } catch (error) {
      failures.push(`the installed tree's hub (${deep} hub run) starts: ${message(error).slice(0, 2000)}`);
    }

    const d = await doctor(deep, home);
    if (d.ran.code === null) failures.push(`the installed tree's deep doctor --json answers: killed at its limit; stderr ${d.ran.stderr.slice(-800)}`);
    const lines = d.ran.stdout.split('\n').filter((l) => l.trim());
    const items = lines.filter((l) => {
      try {
        const v = JSON.parse(l) as { item?: unknown; level?: unknown };
        return typeof v === 'object' && v !== null && typeof v.item === 'string' && typeof v.level === 'string';
      } catch { return false; }
    });
    if (!items.length) failures.push(`the installed tree's deep doctor --json answers with doctor items: none on stdout (exit ${d.ran.code}); stdout ${d.ran.stdout.slice(0, 600)}; stderr ${d.ran.stderr.slice(-800)}`);
    else if (items.length !== lines.length) failures.push(`the installed tree's deep doctor --json prints only doctor items: ${lines.length - items.length} of ${lines.length} stdout lines aren't one: ${lines.find((l) => !items.includes(l))?.slice(0, 400)}`);

    expect(failures, `the installed tree's hub starts and its deep doctor answers:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, 19 * MINUTE);
});
