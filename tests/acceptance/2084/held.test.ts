// #2084: a heavy command's call that the hub holds for the core's reply (since #352, a session among others with
// changes has its first call after a prompt held) must still carry the reply the hub settled for it: the `deep lease`
// rewrite for an agent that can rewrite a call, the one denial for an agent that can't. Real deep-hook, real hub,
// real `deep lease` and lease table; the heavy command itself is #1015's stand-in `cargo` at the executable boundary.
//
// Case 1 (Claude Code): two sessions in two worktrees of one repo both have changed README.md; the second is prompted
// again, the first changes the file once more (a notice the second's next call is held for), and the second's FIRST
// `cargo test --workspace` after that prompt must come back rewritten into its `deep lease` form, run holding a
// cpu.slot under the second session, and carry the sibling notice in the same reply.
// Case 2 (Codex, whose adapter can't rewrite): the same hold, and the call is denied once with its `deep lease` form.
import { describe, expect, it } from 'vitest';
import {
  allEvents, CARGO_TEST, claudeCall, contextOf, edit, heldNow, leasedForm, leaseRows, letters, prompt, rewrittenToLease, sampleRepo,
  Session, shownHook, shownLeases, sleep, slotsOf, spooled, until, World, type Ev, type Ran,
} from './helpers.ts';

const AGAIN = 'Run the whole test suite again and tell me whether it passes.';

/** The notices the record shows handed to `to` by `from`, via the hook event `via`, after log position `since`. */
const noticesHeard = (events: readonly Ev[], to: Session, from: Session, via: string, since: number): Ev[] =>
  events.filter((e) => e.kind === 'notice.delivered' && e.log_pos > since && e.data?.via === via
    && (e.session === to.id || e.data?.target === `session:${letters(to.id)}`)
    && (e.data?.source === from.id || e.data?.source === `session:${letters(from.id)}`));

describe('#2084 a heavy command whose call is held for the core keeps its settled reply', () => {
  it('#2084 Claude Code: the second session\'s first `cargo test --workspace` after its prompt is rewritten into its `deep lease` form, holds a cpu.slot, and its reply carries the sibling notice', async () => {
    const w = new World();
    await w.startHub();
    const a = (wt: string) => new Session(w, 'claude', wt);
    try {
      const { worktrees } = sampleRepo(w, 2);
      const first = a(worktrees[0]!);
      const second = a(worktrees[1]!);
      // Both sessions have changes in the repo.
      await first.begin();
      await edit(first, 'README.md', '# shop', '# shop (first)');
      await second.begin();
      await edit(second, 'README.md', '# shop', '# shop (second)');
      // The second is prompted: its next tool call is held for the core, which has a notice for it once the first changes the file again.
      await prompt(second, AGAIN);
      await edit(first, 'README.md', '# shop (first)', '# shop (first, again)');
      await sleep(500);
      const since = Math.max(0, ...(await allEvents(w.hub!)).map((e) => e.log_pos));

      // The second session's FIRST heavy call after that prompt.
      const call = await claudeCall(second, CARGO_TEST);
      if (spooled(call.pre.hooked)) throw Error(`INCONCLUSIVE: the hook came back without the hub's answer (deep-hook spooled it): ${shownHook(call.pre.hooked)}`);
      let held: ReturnType<typeof heldNow> = [];
      let result: Ran | undefined;
      try {
        if (call.bash) {
          await until(() => Boolean(w.started(second.label)), 120_000);
          held = heldNow(await leaseRows(w.hub!));
        }
      } finally {
        w.go(second.label);
        result = call.bash ? await Promise.race([call.after, sleep(120_000).then(() => undefined)]) : undefined;
      }
      const events = await allEvents(w.hub!);

      const d = call.pre.decision;
      expect(d.denied, `Claude Code's adapter can rewrite a call, so \`${CARGO_TEST}\` is rewritten, never denied: ${shownHook(call.pre.hooked)}`).toBe(false);
      expect(rewrittenToLease(d, CARGO_TEST), `the second session's first \`${CARGO_TEST}\` after its prompt was held for the core, and must still be rewritten into its \`deep lease\` form (the hub's settled reply dropped?): ${shownHook(call.pre.hooked)}`).toBe(true);
      expect(w.started(second.label), `the leased \`${CARGO_TEST}\` runs (a cpu.slot is free)`).toBeDefined();
      expect(slotsOf(held, second).length, `the command the second session ran holds a cpu.slot lease under session:${second.id} while it runs: ${shownLeases(held)}`).toBeGreaterThanOrEqual(1);
      expect(result?.code, `the leased \`${CARGO_TEST}\` runs to its end: ${JSON.stringify(result?.output.slice(-400))}`).toBe(0);

      // The notice the hold was for still reaches the session, in the same reply as the rewrite.
      const heard = noticesHeard(events, second, first, 'PreToolUse', since);
      expect(heard.length, `the first session's second change of README.md is a notice handed to the second session at that call: ${heard.length} in the record`).toBeGreaterThanOrEqual(1);
      const told = contextOf(call.pre.hooked);
      expect(heard.some((n) => told.includes(String(n.data.text))), `the reply to the held call must carry the sibling notice ${JSON.stringify(heard.map((n) => n.data.text))}; its context was ${JSON.stringify(told.slice(0, 600))}`).toBe(true);
      first.stop();
      second.stop();
    } finally {
      await w.stopHub();
    }
  }, 900_000);

  it('#2084 Codex (its adapter can\'t rewrite): the held first `cargo test --workspace` after the prompt is denied once, the deny giving its `deep lease` form', async () => {
    const w = new World();
    await w.startHub();
    try {
      const { worktrees } = sampleRepo(w, 2);
      const sibling = new Session(w, 'claude', worktrees[0]!);
      await sibling.begin();
      await edit(sibling, 'README.md', '# shop', '# shop (sibling)');
      await sleep(500);
      // The Codex session is prompted among others with changes, so its next tool call is held for the core.
      const codex = new Session(w, 'codex', worktrees[1]!);
      await codex.begin();
      const first = await codex.pre(CARGO_TEST);
      if (spooled(first.hooked)) throw Error(`INCONCLUSIVE: the hook came back without the hub's answer (deep-hook spooled it): ${shownHook(first.hooked)}`);
      const form = first.decision.denied ? leasedForm(first.decision.reason) : undefined;
      const retry = form ? await codex.pre(form) : undefined;

      expect(first.decision.denied, `Codex's adapter can't rewrite, so the held call \`${CARGO_TEST}\` must be denied once with its \`deep lease\` form (the hub's settled denial dropped?): ${shownHook(first.hooked)}`).toBe(true);
      expect(form, `the deny must give the \`deep lease\` form to run instead, in backticks: ${JSON.stringify(first.decision.reason)}`).toBeDefined();
      expect(form, 'the `deep lease` form runs the command the agent asked for').toContain(CARGO_TEST);
      expect(retry!.decision.denied, `the retried \`${form}\` must be allowed, with no second deny: ${JSON.stringify(retry!.decision.reason)}`).toBe(false);
      sibling.stop();
      codex.stop();
    } finally {
      await w.stopHub();
    }
  }, 900_000);
});
