// #2764.f88db370: in a turn a proceed started, a Codex subagent's prompt followed by a call that deletes on a remote
// service holds the call with one authority ask naming the proceed. One Codex session through the real deep-hook
// (`deep-hook codex <event>`) and `deep hub run` (README: The session replayed).
import { afterEach, describe, expect, it } from 'vitest';
import { AC, DELETE, Inconclusive, QUESTION, breaches, cleanup, handleOf, replay } from './helpers.ts';

afterEach(cleanup, 60_000);

describe(`${AC} a Codex subagent's prompt ends no turn a proceed started`, () => {
  it(`${AC} in the turn a proceed started, after a Codex subagent's prompt, \`${DELETE}\` is held at PreToolUse with one authority ask naming the proceed`, async (ctx) => {
    const seen = await replay().catch((error: unknown) => {
      if (error instanceof Inconclusive) ctx.skip(`INCONCLUSIVE ${error.message}`);
      throw error;
    });
    // Not let through: no run of the delete went past PreToolUse as decided by the hub.
    expect(seen.ran, `${AC} ${seen.ran ?? ''}`).toBeUndefined();
    // Held with an ask naming the call.
    expect(seen.asks.length, `${AC} \`${DELETE}\` must be held with an authority ask naming it: no ask names it 90 s after the call`).toBeGreaterThan(0);
    const ask = seen.asks[0]!;
    expect(ask.data.kind, `${AC} the hold of \`${DELETE}\` must be an authority ask: ${handleOf(ask)}`).toBe('authority');
    // Naming the proceed whose turn it is in.
    const question = String(ask.data.question ?? '');
    expect(question, `${AC} the authority ask holding \`${DELETE}\` must say "proceed"`).toMatch(/proceed/i);
    expect(question, `${AC} the authority ask holding \`${DELETE}\` must quote the proceed's question`).toContain(QUESTION);
    // One ask: the call was tried again before any answer, and it is still the only ask naming it.
    expect(seen.retried, `${AC} the delete must have been called a second time while held`).toBe(true);
    expect(seen.asks.map(handleOf), `${AC} one authority ask holds \`${DELETE}\`, called twice`).toHaveLength(1);
    expect(breaches(seen)).toEqual([]);
  }, 600_000);
});
