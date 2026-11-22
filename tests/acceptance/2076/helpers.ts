// Test-side tools for #2076's acceptance tests. The world, the hub, Claude Code sessions fired through the real
// deep-hook, `deep rules sync` and the rules page read back are #344's (over #303's), imported and never copied; the
// agent whose deep_propose is judged is #111's `startAgent` (#26's agent stand-in, whose own `deep mcp` the hub binds to
// its session). Nothing here stands in for the hub, the hook, the rules page or the record: the tests reach them only
// through the surfaces README.md names, and say which of those this job invented.
import { expect } from 'vitest';
import { cleanup as cleanup111, startAgent, inboxText, type Mem, type Working } from '../111/helpers.ts';
import {
  Session, cleanupAll as cleanup344, deep, fixtureWorld, inboxAsks, proposals, ruleNamed, said, settle, show, startHub, stopHub, syncRules,
  type Ev, type Hub, type PageRule, type World,
} from '../344/helpers.ts';

export { Session, deep, inboxAsks, proposals, ruleNamed, said, settle, show, stopHub, syncRules, type Ev, type Hub, type PageRule, type World };

// ---- The issue's values, word for word.
export const MOMENT = 'moment';
export const NEVER_MOMENT = 'never use moment';
/** Your rejection, as #111 has it saved: `rejected: \`<key>\`.` in a prompt you typed. */
export const REJECTION = `We keep our own date helpers. rejected: \`${MOMENT}\`. Sound good?`;
/** The planted fault this job invents for AC2 (README, Surfaces this job invented, 1). */
export const RAISE_FAILS = 'hold-raise-fails';

export const cleanupAll = async (): Promise<void> => {
  await cleanup111();
  await cleanup344();
};

/** #344's fixture repo, its root AGENTS.md holding `never use moment` beside one other rule. */
export const momentWorld = (): World => fixtureWorld({ rootOnly: true, root: [NEVER_MOMENT, 'Run the linter before every commit'] });

/**
 * The hub, with `plant` when given. A hub that refuses to start with a plant it doesn't know fails here at an assertion
 * naming the plant (README: the planted fault is an invented surface), never at a BLOCKED error.
 */
export async function hubFor(w: World, plant?: string): Promise<Hub> {
  if (!plant) return startHub(w);
  try {
    return await startHub(w, { plant });
  } catch (error) {
    return expect.fail(`the hub runs with DEEP_HUB_PLANT=${plant}, the planted fault where the ask for a held rule line can't be raised (README, invented surface 1); it did not start: ${String(error).slice(0, 600)}`);
  }
}

/** Your `rejected: \`moment\`.`, typed in a session, saved as #111 saves it: one decision.created whose answer holds the key. */
export async function rejectMoment(w: World, hub: Hub): Promise<Ev> {
  const you = new Session(w);
  await you.start();
  await you.typed(REJECTION);
  const log = await settle(hub, (e) => rejections(e).length > 0, 20_000);
  const saved = rejections(log);
  expect(saved.length, `your "rejected: \`${MOMENT}\`." is saved as one decision (#111); the log's decisions: ${log.filter((e) => e.kind === 'decision.created').map(said).join(' | ') || 'none'}`).toBe(1);
  return saved[0]!;
}
export const rejections = (events: readonly Ev[]): Ev[] => events.filter((e) => e.kind === 'decision.created' && e.data.answer === `rejected: \`${MOMENT}\``);

/** The agent's own Edit deleting the line `never use moment` from AGENTS.md, through deep-hook's PreToolUse and PostToolUse. */
export async function deleteLine(s: Session): Promise<void> {
  await s.edit('AGENTS.md', `- ${NEVER_MOMENT}\n`, '');
}

/** What a fresh session's SessionStart reply (its start set) carries. */
export async function nextStart(w: World): Promise<{ session: Session; reply: string }> {
  const session = new Session(w);
  const r = await session.start();
  return { session, reply: `${r.stdout}\n${r.stderr}` };
}

/** A session's readings (`session.reading`) that name `words`. */
export const readingsNaming = (events: readonly Ev[], s: Session, ...words: string[]): Ev[] =>
  events.filter((e) => e.kind === 'session.reading' && e.session === s.id && words.every((w) => String(e.data.reading).includes(w)));

/** `deep inbox` as you: its printed text. */
export const inbox = async (w: World): Promise<string> => inboxText({ h: { home: w.home } } as unknown as Mem);

/** An agent of #111's (#26's stand-in) with its own session in the world's repo, its deep mcp initialized. */
export const agentIn = (w: World, prompt: string): Promise<Working> => startAgent({ h: { home: w.home } } as unknown as Mem, w.repo, prompt);
