import { expect } from 'vitest';
import { cleanup as cleanup111, startAgent, inboxText, type Mem, type Working } from '../111/helpers.ts';
import {
  Session, cleanupAll as cleanup344, deep, fixtureWorld, inboxAsks, proposals, ruleNamed, said, settle, show, startHub, stopHub, syncRules,
  type Ev, type Hub, type PageRule, type World,
} from '../344/helpers.ts';

export { Session, deep, inboxAsks, proposals, ruleNamed, said, settle, show, stopHub, syncRules, type Ev, type Hub, type PageRule, type World };

export const MOMENT = 'moment';
export const NEVER_MOMENT = 'never use moment';
export const REJECTION = `We keep our own date helpers. rejected: \`${MOMENT}\`. Sound good?`;
export const RAISE_FAILS = 'hold-raise-fails';

export const cleanupAll = async (): Promise<void> => {
  await cleanup111();
  await cleanup344();
};

export const momentWorld = (): World => fixtureWorld({ rootOnly: true, root: [NEVER_MOMENT, 'Run the linter before every commit'] });

export async function hubFor(w: World, plant?: string): Promise<Hub> {
  if (!plant) return startHub(w);
  try {
    return await startHub(w, { plant });
  } catch (error) {
    return expect.fail(`the hub runs with DEEP_HUB_PLANT=${plant}, the planted fault where the ask for a held rule line can't be raised (README, invented surface 1); it did not start: ${String(error).slice(0, 600)}`);
  }
}

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

export async function deleteLine(s: Session): Promise<void> {
  await s.edit('AGENTS.md', `- ${NEVER_MOMENT}\n`, '');
}

export async function nextStart(w: World): Promise<{ session: Session; reply: string }> {
  const session = new Session(w);
  const r = await session.start();
  return { session, reply: `${r.stdout}\n${r.stderr}` };
}

export const readingsNaming = (events: readonly Ev[], s: Session, ...words: string[]): Ev[] =>
  events.filter((e) => e.kind === 'session.reading' && e.session === s.id && words.every((w) => String(e.data.reading).includes(w)));

export const inbox = async (w: World): Promise<string> => inboxText({ h: { home: w.home } } as unknown as Mem);

export const agentIn = (w: World, prompt: string): Promise<Working> => startAgent({ h: { home: w.home } } as unknown as Mem, w.repo, prompt);
