// AC2 #993.e11861a0: with the program removed under a running hub, within 10 minutes every open Claude Code session's
// row reads watch-only, hooks can't run, and `deep status` says the same; a hub that waits for a hook to arrive never
// shows it and fails.
//
// DeepBuild is set up from a copy of this checkout (README: The copy of the checkout); the hub runs with a stepped
// clock (DEEP_HUB_TEST_CLOCK_STEPS=1, #965's `test.clock`), so its 10-minute check comes due without 10 real minutes.
// Two Claude Code sessions open through DeepBuild's entries (the copy's deep-hook, with Claude Code's hook
// environment). Then the program is removed and no hook runs again, as when a build folder is cleaned: a hub that
// only notices missing hooks when a later hook arrives never sees one. The clock steps 10 minutes and a second; the
// rows must then read watch-only, BLOCKED, hooks can't run, on the hub's `status.read` and in `deep status`.

import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { AC2, CHECK_INTERVAL_MS, childEnv, cleanup, claudeTranscript, deep, eventually, HookSession, makeHome, setUp, shown, startHub, statusRows, stepClock, type Line } from './helpers.ts';

afterAll(cleanup, 60_000);

const CANT_RUN = /hooks can(?:'|’|no)t run/i;
/** What a row says: watch-only, BLOCKED and the cause, hooks can't run. */
const says = (text: string) => ({ watchOnly: /watch-only/i.test(text), blocked: text.includes('BLOCKED'), cantRun: CANT_RUN.test(text) });
const all = (s: ReturnType<typeof says>) => s.watchOnly && s.blocked && s.cantRun;
/** `deep status`'s lines for one session: its row (its ID's first 8 characters) and the indented lines under it. */
function statusBlock(out: string, id: string): string | undefined {
  const lines = out.split('\n');
  const at = lines.findIndex((l) => l.includes(id.slice(0, 8)));
  if (at < 0) return undefined;
  const block = [lines[at]!];
  for (const l of lines.slice(at + 1)) {
    if (!/^ {5,}\S/.test(l)) break;
    block.push(l);
  }
  return block.join('\n');
}

describe(`${AC2} the hub checks the hook program itself, every 10 minutes`, () => {
  it(`${AC2} with the deep-hook program removed under a running hub and no hook since, within 10 minutes every open Claude Code session's row reads watch-only, BLOCKED, hooks can't run, and deep status says the same`, async () => {
    const h = await makeHome();
    await setUp(h);
    const hub = await startHub(h, { DEEP_HUB_TEST_CLOCK_STEPS: '1' });
    const sessions: HookSession[] = [];
    for (let n = 0; n < 2; n++) {
      const id = randomUUID();
      const env = childEnv(h, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: h.work });
      const s = new HookSession(h.copy.deepHook, h.work, claudeTranscript(h.home, h.work, id), env, undefined, id);
      const started = await s.start();
      expect(started.ran.code, `the session's SessionStart ran through the copy's deep-hook: ${shown(started.ran)}`).toBe(0);
      await s.prompt(`Refactor module ${n} and run its tests.`);
      sessions.push(s);
    }
    const ids = sessions.map((s) => s.id);
    const open = await eventually(async () => { const rows = await statusRows(hub); return ids.every((id) => rows.some((r) => r.id === id)); }, 30_000);
    expect(open, `both sessions have a row: ${JSON.stringify(await statusRows(hub))}`).toBe(true);
    // The twin: with the program in place, no row says hooks can't run.
    const healthy = await statusRows(hub);
    for (const id of ids) {
      const row = healthy.find((r) => r.id === id);
      expect(CANT_RUN.test(JSON.stringify(row)), `${AC2} with the program in place, the row doesn't say hooks can't run: ${JSON.stringify(row)}`).toBe(false);
    }

    rmSync(h.copy.deepHook);
    expect(existsSync(h.copy.deepHook), 'the program is gone').toBe(false);
    // No hook runs from here on: the program every entry runs is gone. The hub's clock moves past one check interval.
    await stepClock(hub, CHECK_INTERVAL_MS + 1000);
    let rows: Line[] = [];
    const read = await eventually(async () => {
      rows = await statusRows(hub);
      return ids.every((id) => all(says(JSON.stringify(rows.find((r) => r.id === id) ?? {}))));
    }, 30_000);
    for (const id of ids) {
      const row = rows.find((r) => r.id === id);
      expect(says(JSON.stringify(row ?? {})), `${AC2} 10 minutes on the hub's clock after the program was removed, with no hook since, session ${id}'s row must read watch-only, BLOCKED, hooks can't run: ${JSON.stringify(row)}`).toEqual({ watchOnly: true, blocked: true, cantRun: true });
    }
    expect(read).toBe(true);

    const status = await deep(h, ['status']);
    expect(status.code, `deep status reads the hub: ${shown(status)}`).toBe(0);
    for (const id of ids) {
      const block = statusBlock(status.stdout, id) ?? '';
      expect(says(block), `${AC2} deep status must say the same for session ${id}: watch-only, BLOCKED, hooks can't run; it printed:\n${status.stdout}`).toEqual({ watchOnly: true, blocked: true, cantRun: true });
    }
  }, 600_000);
});
