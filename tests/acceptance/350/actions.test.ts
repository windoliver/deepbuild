// AC5: two overlapping calls that finish in reverse order each keep their own authenticated scope across every
// await, and the same action called headlessly and from a panel targets the same explicit handle and version
// whichever window has focus; a stale target has no effect.
//
// A call's authenticated scope is its caller's connection, as the hub's socket proved it. What the extension does
// while serving the call, here two record appends with an await between them, carries that caller's actor, scope and
// session; its writer stays `ext:<id>` (README, Readings). Both places are tested: the hub, where the two calls share
// one process and one event loop, and the sandbox, where they share one JSON-RPC connection.
import { describe, expect, it } from 'vitest';
import type { ActionResult } from '../../../packages/extension-host/src/index.ts';
import { agentCall, HEADLESS, installAndLoad, openHost, openWorld, PANEL, pkg, releaseEntry, sleep, tasksTitled, taskEvent, ulid } from './helpers.ts';

describe('AC5 #350.7c4e7560 two overlapping calls that finish in reverse order each keep their own authenticated scope across every await; the same action called headlessly and from a panel targets the same explicit handle and version whichever window has focus; a stale target has no effect', () => {
  for (const place of ['sandbox', 'hub'] as const) {
    it(`AC5 in the ${place}, two overlapping calls from two agent sessions, finishing in reverse order, each act as their own caller before and after an await`, async () => {
      const id = place === 'hub' ? 'deepbuild/acts' : 'test/acts';
      const dir = await pkg('acts', { manifest: { id } });
      const w = await openWorld();
      const h = await openHost(w, place === 'hub' ? { release: [await releaseEntry(dir)] } : {});
      await installAndLoad(h, dir);
      expect((await h.loaded()).find((l) => l.id === id)?.place).toBe(place);

      const sessions = { A: ulid(), B: ulid() };
      const finished: string[] = [];
      const call = (who: 'A' | 'B', wait: number): Promise<ActionResult> => h.callAction({
        action: 'ext.acts.scoped', target: { handle: `ext:${id}`, version: '1.0.0' }, caller: agentCall(sessions[who]),
        input: { wait, before: taskEvent(`${sessions[who]} before`), after: taskEvent(`${sessions[who]} after`) },
      }).then((r) => { finished.push(who); return r; });
      const a = call('A', 900);
      await sleep(150);
      const b = call('B', 50);
      const results = await Promise.all([a, b]);
      expect(finished, 'the calls finished in reverse order').toEqual(['B', 'A']);
      for (const r of results) expect(r.status, JSON.stringify(r)).toBe('done');

      await w.record.sync();
      for (const who of ['A', 'B'] as const) {
        for (const step of ['before', 'after']) {
          const events = await tasksTitled(w, `${sessions[who]} ${step}`);
          expect(events.length, `call ${who}'s ${step} append`).toBe(1);
          const e = events[0]!;
          expect({ writer: e.writer, actor: e.actor, scope: e.scope, session: e.session }, `call ${who}'s append ${step} its await`)
            .toEqual({ writer: `ext:${id}`, actor: 'you', scope: 'you', session: sessions[who] });
        }
      }
    }, 120_000);
  }

  it('AC5 the same action called headlessly and from a panel, with either window focused, gets the same explicit handle and version; a stale target has no effect', async () => {
    const ID = 'test/acts';
    const handle = `ext:${ID}`;
    const w = await openWorld();
    const h = await openHost(w);
    await installAndLoad(h, await pkg('acts'));
    const target = { handle, version: '1.0.0' };
    const calls = [
      { caller: HEADLESS, focus: null, what: 'headless' },
      { caller: PANEL, focus: 'window:main', what: 'from a panel, its own window focused' },
      { caller: PANEL, focus: 'window:other', what: 'from a panel, another window focused' },
    ];
    for (const c of calls) {
      const r = await h.callAction({ action: 'ext.acts.where', target, input: {}, caller: c.caller, focus: c.focus });
      expect(r.status, `${c.what}: ${JSON.stringify(r)}`).toBe('done');
      const out = (r as { output: { target: unknown; version: string } }).output;
      expect({ target: out.target, version: out.version }, c.what).toEqual({ target, version: '1.0.0' });
    }

    // A version that was never active, and then the version a replacement took over from.
    const never = taskEvent(`stale 0.9.0 ${Date.now()}`);
    const r09 = await h.callAction({ action: 'ext.acts.where', target: { handle, version: '0.9.0' }, input: { event: never }, caller: PANEL, focus: 'window:main' });
    expect(r09.status, `a target of a version never active ran: ${JSON.stringify(r09)}`).not.toBe('done');

    await installAndLoad(h, await pkg('acts', { manifest: { version: '1.1.0' } }));
    expect((await h.loaded()).find((l) => l.id === ID)?.version).toBe('1.1.0');
    const replaced = taskEvent(`stale 1.0.0 ${Date.now()}`);
    for (const c of calls) {
      const r = await h.callAction({ action: 'ext.acts.where', target, input: { event: replaced }, caller: c.caller, focus: c.focus });
      expect(r.status, `${c.what}: the replaced version's target ran: ${JSON.stringify(r)}`).not.toBe('done');
    }
    await sleep(300);
    await w.record.sync();
    expect(await tasksTitled(w, (never.data as { title: string }).title), 'the stale target changed the record').toEqual([]);
    expect(await tasksTitled(w, (replaced.data as { title: string }).title), 'the stale target changed the record').toEqual([]);
    const now = await h.callAction({ action: 'ext.acts.where', target: { handle, version: '1.1.0' }, input: {}, caller: HEADLESS, focus: 'window:other' });
    expect(now, 'the active version ran none of the stale calls').toMatchObject({ status: 'done', output: { target: { handle, version: '1.1.0' }, version: '1.1.0', calls: 1 } });
  }, 120_000);
});
