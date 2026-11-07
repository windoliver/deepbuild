// #1410 AC3 (README): a hook call's latency doesn't include an evidence sync. The installed hub runs under the sync
// shim, which makes every sync of a file or folder under the hub's evidence folder take SLOW_MS. A session's turn ends,
// and its next prompt, longer than the record keeps of a field, resumes it: the record stores the prompt's whole text
// as evidence and cites it in a FULL commit, the one hook whose own event is a FULL commit naming evidence. That
// UserPromptSubmit's reply must come back well inside SLOW_MS, and the evidence sync must still happen.
import { afterAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { allEvents, buildShim, cleanup, control, fileOf, idOf, makeHome, readLog, Session, shimEnv, sleep, startHub, stopHub, syncs, type Ev, type SyncEntry } from './helpers.ts';

/**
 * How long each evidence sync takes under the shim, and the most a hook reply may take beside it: a reply that waited
 * on one such sync takes at least SLOW_MS, or is cut short at the hub's own 2 s hold on a prompt's context reply
 * (hold_until_ms in its ack); a reply that never waited takes tens of ms here even at a load of 60 to 90.
 */
const SLOW_MS = 4000;
const BOUND_MS = 1000;

afterAll(cleanup);

describe('#1410: a hook call never waits on an evidence sync', () => {
  it('AC3: with each evidence sync slowed to 4 s, the resuming UserPromptSubmit (a FULL commit naming its whole text) and the tool calls after it each reply within 1 s, while the sync still happens', async () => {
    const shim = buildShim();
    const h = makeHome();
    const log = join(h.tmp, 'sync.log');
    const evidence = join(h.root, 'evidence');
    const hub = await startHub(h, shimEnv(shim, log, { watch: evidence, slowUnder: evidence, slowMs: SLOW_MS }));
    try {
      const cli = await control(hub);
      const s = new Session(h, hub);
      const until = async (what: string, test: (events: Ev[]) => boolean, ms = 60_000): Promise<Ev[]> => {
        const deadline = Date.now() + ms;
        for (;;) {
          const events = await allEvents(cli);
          if (test(events)) return events;
          if (Date.now() > deadline) throw Error(`BLOCKED: ${what} never reached the record within ${ms} ms; kinds seen: ${JSON.stringify(events.filter((e) => e.session === s.id).map((e) => e.kind))}`);
          await sleep(200);
        }
      };
      await s.hook('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
      await s.prompt('What does this folder hold?');
      s.entry({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Nothing yet.' }], stop_reason: 'end_turn' } });
      await s.hook('Stop', { stop_hook_active: false });
      await until("the session's stop", (events) => events.some((e) => e.session === s.id && e.kind === 'agent.stop'));

      // Longer than the 8,192 characters the record keeps of a prompt, in plain words a scrub leaves as they are.
      const text = `please ${'carry on with the plan we made '.repeat(400)}now`;
      const sha = createHash('sha256').update(text).digest('hex');
      const calls: { what: string; sent: number; ms: number; replied: boolean }[] = [];
      const timed = async (what: string, call: () => Promise<{ ms: number; reply?: unknown }>) => {
        const sent = Date.now();
        const r = await call();
        calls.push({ what, sent, ms: r.ms, replied: r.reply !== undefined });
      };
      await timed('the resuming UserPromptSubmit', () => s.prompt(text));
      // Then the session's next tool calls, one after another, for as long as two slowed syncs take: any one of them
      // that waits on the evidence sync shows it.
      const file = fileOf(evidence, sha);
      const spanEnd = Date.now() + 2 * SLOW_MS + 2000;
      for (let n = 0; Date.now() < spanEnd; n++) {
        const id = `toolu_1410_${n}`;
        await timed(`PreToolUse ${n}`, () => s.hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: id }));
        await timed(`PostToolUse ${n}`, () => s.hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: { stdout: '', stderr: '', interrupted: false }, tool_use_id: id }));
        await sleep(100);
      }
      await until('the resuming prompt, citing its whole text', (all) => all.some((e) => e.session === s.id && e.kind === 'user.ask' && (e.evidence ?? []).includes(sha)));

      // The evidence sync must happen, or this test shows nothing: wait for it as long as two slowed syncs take.
      const deadline = Date.now() + 4 * SLOW_MS + 30_000;
      let evidenceSyncs: SyncEntry[] = [];
      while (!evidenceSyncs.length && Date.now() < deadline) {
        await sleep(250);
        try {
          const [f, d] = [idOf(file), idOf(dirname(file))];
          evidenceSyncs = readLog(log).filter((e): e is SyncEntry => syncs(e, f.dev, f.ino) || syncs(e, d.dev, d.ino));
        } catch { /* not there yet */ }
      }
      // The shim proves it sees the hub: the record's own FULL commits sync its WAL.
      if (!readLog(log).some((e) => e.kind === 'S' && e.path === join(h.root, 'ledger.db-wal'))) throw Error(`BLOCKED: the shim saw no sync of the hub's ledger WAL, so it doesn't see the hub's syncs`);
      const slowest = calls.reduce((a, b) => (b.ms > a.ms ? b : a));
      console.log(`#1410 AC3: ${calls.length} hook calls, slowest ${slowest.what} at ${Math.round(slowest.ms)} ms (the prompt ${Math.round(calls[0]!.ms)} ms); each evidence sync takes ${SLOW_MS} ms; evidence syncs seen: ${evidenceSyncs.length}`);
      const problems: string[] = [];
      for (const c of calls) {
        if (!c.replied) problems.push(`${c.what} got no reply`);
        else if (c.ms >= BOUND_MS) problems.push(`${c.what}'s reply took ${Math.round(c.ms)} ms, with each evidence sync taking ${SLOW_MS} ms; it must come within ${BOUND_MS} ms`);
      }
      if (!evidenceSyncs.length) problems.push(`no sync of the prompt's evidence file ${sha} or of its folder ${dirname(file)} was seen, though a FULL commit names it: no hook call was exposed to an evidence sync`);
      // A call made while a slowed evidence sync ran: else the calls above never overlapped one, and show nothing.
      else if (!calls.some((c) => evidenceSyncs.some((e) => c.sent >= e.start && c.sent < e.end))) problems.push(`INCONCLUSIVE: no hook call was made while an evidence sync ran (syncs ${JSON.stringify(evidenceSyncs.map((e) => [e.start, e.end]))}, calls from ${calls[0]!.sent} to ${calls[calls.length - 1]!.sent})`);
      expect(problems, problems.join('\n')).toEqual([]);
      cli.close();
    } finally {
      await stopHub(hub);
    }
  }, 300_000);
});
