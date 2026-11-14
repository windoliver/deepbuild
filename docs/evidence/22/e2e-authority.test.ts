// By-hand end-to-end run of #22 (part #321): a real hub and the real deep-hook at PreToolUse. A Claude Code session
// whose MCP server (`tracker`, added by you at local scope) gains `delete_repo` between two session starts has the new
// tool held for your approval; a `git push origin main` is held as an authority ask too. Prints `deep inbox`, your
// answers from the terminal, what the hook let through, and the record's ask events.
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';

const H = process.env.E2E_HELPERS!;
const OUT = process.env.E2E_OUT!;
const out: string[] = [];
const log = (s: string) => { out.push(s); writeFileSync(OUT, `${out.join('\n')}\n`); };
const hhmmss = (ms: number) => new Date(ms > 1e14 ? Math.round(ms / 1e6) : ms).toISOString().slice(11, 19);

it('e2e', async () => {
  const h = await import(H);
  const w = h.makeWorld();
  const inbox = async (title: string) => {
    const r = await h.run(h.NODE, [h.CLI, 'inbox'], { env: h.childEnv(w.home), cwd: w.tmp, timeoutMs: 60_000 });
    log(`\n$ deep inbox    # ${title}\n${r.stdout.trimEnd() || '(empty)'}${r.code ? `\n(exit ${r.code}) ${r.stderr}` : ''}`);
  };
  const v1 = [h.tool('list_tickets', { readOnlyHint: true }), h.tool('create_ticket')];
  const tracker = h.FakeServer.install(w, 'tracker', 'local', v1);
  const hub = await h.startHub(w);
  try {
    log(`World: home ${w.home}, repo ${w.repo}; MCP server tracker (yours, local scope) with list_tickets (read-only) and create_ticket.`);
    const s1 = h.newSession(w);
    await h.startRecorded(w, hub, s1, [tracker], 'e2e');
    await h.typed(w, s1, 'List the open tickets.');
    await h.expectFree(w, hub, s1, h.mcpCall(tracker, 'list_tickets'), { who: 'e2e', names: ['tracker', 'list_tickets'], server: tracker });
    log('\n1. Session 1: list_tickets runs with no ask (its tool list is recorded at the session start).');

    tracker.update([...v1, h.tool('delete_repo')], '2.0.0');
    const since = await h.lastPos(hub);
    const s2 = h.newSession(w);
    await h.startRecorded(w, hub, s2, [tracker], 'e2e');
    await h.typed(w, s2, 'Remove the scratch repositories.');
    log('\n2. tracker 2.0.0 adds delete_repo. Session 2 starts and calls it: deep-hook holds the call at PreToolUse.');
    const held = await h.expectHeld(w, hub, s2, h.mcpCall(tracker, 'delete_repo'), { who: 'e2e', names: ['tracker', 'delete_repo'], since, server: tracker });
    log(`   held by ${h.handleOf(held.ask)} (kind ${held.ask.data.kind}): ${held.ask.data.question}\n   options ${JSON.stringify(held.ask.data.options)}; default ${held.ask.data.default}; deadline ${new Date(h.msOf ? h.msOf(held.ask.data.deadline) : held.ask.data.deadline).toISOString()} (raised ${new Date().toISOString()})`);
    const since2 = await h.lastPos(hub);
    const push = await h.expectHeld(w, hub, s2, h.bash('git push origin main'), { who: 'e2e', names: ['git push origin main'], since: since2 });
    log(`\n3. The agent runs \`git push origin main\`: held by ${h.handleOf(push.ask)} (kind ${push.ask.data.kind}): ${push.ask.data.question}`);
    await h.stillHeld(hub, held, 5000);
    log('   5 s later, with no answer, neither call has run and neither ask has closed.');
    await inbox('both authority asks wait for you');

    const at = await h.approve(w, hub, held);
    log(`\n4. You approve delete_repo: \`deep inbox answer ${h.handleOf(held.ask)} ${held.ask.data.options.find((o: any) => o.decision === 'allow').id}\` exit 0 (the OS confirmation is the test stand-in).`);
    await h.expectRuns(w, hub, held, at);
    log(`   delete_repo ran: tracker received ${tracker.calls('delete_repo')} tools/call for it after your yes.`);
    const no = push.ask.data.options.find((o: any) => o.decision !== 'allow');
    const r = await h.run(h.NODE, [h.CLI, 'inbox', 'answer', h.handleOf(push.ask), no.id], { env: h.childEnv(w.home), cwd: w.tmp, timeoutMs: 120_000 });
    log(`\n5. You say no to the push: \`deep inbox answer ${h.handleOf(push.ask)} ${no.id}\` exit ${r.code} ${(r.stdout + r.stderr).trim()}`);
    const results = await Promise.all(push.pendings.map((p: any) => p.done));
    log(`   deep-hook's PreToolUse for the push ended: ${results.map((x: any) => `exit ${x.code}, stdout ${JSON.stringify(x.stdout.trim()).slice(0, 300)}, stderr ${JSON.stringify(x.stderr.trim()).slice(0, 300)}`).join('; ')}`);
    await inbox('after your two answers');
    log('\n6. The record: every ask event, in order.');
    for (const e of (await h.allEvents(hub)).filter((e: any) => /^ask\./.test(e.kind))) {
      const d = e.data ?? {};
      log(`  ${hhmmss(e.ts)}Z ${e.kind} ${e.subject ?? `ask:${e.id}`} ${JSON.stringify(e.kind === 'ask.created' ? { kind: d.kind, question: d.question, default: d.default } : d).slice(0, 300)}`);
    }
  } finally {
    await h.stopHub(hub);
    await h.cleanup();
  }
}, 1_200_000);
