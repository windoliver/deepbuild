// #340 AC1: after `/compact`, the agent's next context holds the open asks' requirement IDs in one block of under 500
// tokens. Three asks are typed in one session, each in its own turn, and each locks a handed definition with
// requirement IDs of its own (R1-R5, R6-R9, R10-R12) and long requirement texts (helpers.ts, OPEN_ASKS). Claude Code
// then compacts the session: SessionStart with source compact and the same session ID, as the corpus's compact
// sessions have it. The agent's next context is that hook's reply on deep-hook's stdout,
// `hookSpecificOutput.additionalContext`. "One block" is one run of non-blank lines in it; its tokens are counted
// conservatively, as one per two UTF-8 bytes (README, Tokens).
//
// The base already sends a brief at SessionStart (#303), so this criterion is proven on wrong programs: a brief with
// every requirement's full text (DEEP_HUB_PLANT=brief-full-text) is over 500 tokens, and a brief sent only at startup
// (DEEP_HUB_PLANT=brief-at-startup-only) leaves the compacted context without the IDs.
import { afterEach, describe, it } from 'vitest';
import {
  AC1, cleanup, contextOf, failureOf, makeWorld, must, OPEN_DRAFTS, OPEN_IDS, openAsks, Session, shown, startHub, type Ran,
} from './helpers.ts';

afterEach(cleanup, 60_000);

/** Conservative token count (README, Tokens): one token per two UTF-8 bytes, rounded up. */
const tokensOf = (text: string): number => Math.ceil(Buffer.byteLength(text, 'utf8') / 2);
/** The context's blocks: runs of non-blank lines. */
const blocksOf = (text: string): string[] => text.split(/\n[ \t]*\n/).map((b) => b.trim()).filter(Boolean);
const names = (block: string, id: string) => new RegExp(`(?<![A-Za-z0-9])${id}(?![A-Za-z0-9])`).test(block);

/** The session with three open asks, each with a locked definition; returns the reply of the SessionStart after /compact. */
async function compacted(plant?: string): Promise<Ran> {
  const w = makeWorld({ drafts: OPEN_DRAFTS() });
  const hub = await startHub(w, { plant });
  const s = new Session(w, 'terminal');
  await s.start();
  await openAsks(hub, s);
  return s.start('compact');
}

/** The criterion on the compacted reply: one block names every open requirement ID, and it is under 500 tokens. */
function holdsIdsInOneShortBlock(reply: Ran): void {
  const context = contextOf(reply);
  must(context.length > 0, `${AC1} after /compact the agent's next context (the SessionStart hook's additionalContext) must hold the open asks' requirement IDs; it holds no context: ${shown(reply)}`);
  const blocks = blocksOf(context);
  const holding = blocks.filter((b) => OPEN_IDS.every((id) => names(b, id)));
  const best = blocks.map((b) => ({ b, n: OPEN_IDS.filter((id) => names(b, id)).length })).sort((x, y) => y.n - x.n)[0];
  must(holding.length > 0, `${AC1} after /compact one block of the agent's next context must hold every open ask's requirement ID (${OPEN_IDS.join(', ')}); the block naming most holds ${best?.n ?? 0} of ${OPEN_IDS.length}, missing ${OPEN_IDS.filter((id) => !best || !names(best.b, id)).join(', ')}: ${JSON.stringify(context.slice(0, 1200))}`);
  const short = holding.find((b) => tokensOf(b) < 500);
  must(short !== undefined, `${AC1} the block holding the open asks' requirement IDs must be under 500 tokens; it is ${Math.min(...holding.map(tokensOf))} by the suite's count (${Math.min(...holding.map((b) => Buffer.byteLength(b)))} bytes / 2): ${JSON.stringify(holding[0]!.slice(0, 600))}…`);
}

describe(`${AC1} after /compact, the agent's next context holds the open asks' requirement IDs in one block of under 500 tokens`, () => {
  it(`${AC1} three open asks with twelve requirements: the SessionStart after /compact sends all twelve IDs in one block under 500 tokens`, async () => {
    const reply = await compacted();
    console.log(`${AC1} the context after /compact, by block (tokens by the suite's count): ${blocksOf(contextOf(reply)).map((b) => `[${tokensOf(b)}] ${JSON.stringify(b.slice(0, 300))}`).join(' | ')}`);
    holdsIdsInOneShortBlock(reply);
  }, 300_000);

  it(`${AC1} (wrong program) a brief that lists every requirement's full text (DEEP_HUB_PLANT=brief-full-text) fails, over 500 tokens`, async () => {
    const reply = await compacted('brief-full-text');
    const failure = await failureOf(() => holdsIdsInOneShortBlock(reply));
    must(failure !== null, `${AC1} the planted brief with every requirement's full text must fail this test: it passed`);
    must(failure.includes('under 500 tokens; it is'), `${AC1} the planted brief must fail on the block's size, naming its token count; it failed elsewhere: ${failure}`);
  }, 300_000);

  it(`${AC1} (wrong program) a brief sent only at startup (DEEP_HUB_PLANT=brief-at-startup-only) fails: the compacted context lacks the IDs`, async () => {
    const reply = await compacted('brief-at-startup-only');
    const failure = await failureOf(() => holdsIdsInOneShortBlock(reply));
    must(failure !== null, `${AC1} the planted brief sent only at startup must fail this test: it passed`);
    must(/must hold (the open asks'|every open ask's) requirement ID/.test(failure), `${AC1} the planted brief must fail on the missing IDs; it failed elsewhere: ${failure}`);
  }, 300_000);
});
