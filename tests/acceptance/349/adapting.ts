// The adapter scenarios AC2 and AC6 share: a test adapter package (fixtures/adapter) shaped by its flags and the
// hooks it maps, loaded in the hub, the file it writes each delivery it was asked to make into, and an answer for a
// session: an authority ask raised for the session and approved by you, whose Delivery the asks core handed out.
import { expect } from 'vitest';
import type { AdapterCaps } from '../../../packages/adapters/src/index.ts';
import type { Delivery } from '../../../packages/asks/src/index.ts';
import type { ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import { approve, authorityAsk, contracts, hookLine, pkg, raise, readSeen, seenFile, type Seen, type World } from './helpers.ts';

export const ALL_HOOKS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd'];
/** The hooks an adapter that only relays maps: what it observes, never a gate (a PreToolUse or a Stop deep-hook holds). */
export const RELAY_HOOKS = ['SessionStart', 'PostToolUse', 'SessionEnd'];

/** adapter.caps@1, every flag, with `over` on top of a driven-less adapter that can do nothing but answer permissions. */
export const caps = (over: Partial<AdapterCaps>): AdapterCaps => ({
  holdStop: false, wakeIdle: false, steer: false, followUp: false, answerPermission: true, nativeTools: true, mcp: false, rewrite: false, editInput: false, errorTurnHook: false, startTurn: false, ...over,
});

/** The published fixture each mapped event's data comes from. */
const SCHEMAS: Record<string, string> = { 'session.start': 'session.start@2', 'user.ask': 'user.ask@1', 'tool.before': 'tool.before@2', 'tool.after': 'tool.after@1', 'agent.stop': 'agent.stop@2', 'session.end': 'session.end@1' };

export interface TestAdapter { name: string; dir: string; saw(): Seen[] }
/** A test adapter package: registered as `name`, with its flags, mapping `maps`, writing what it delivers to a file. */
export async function adapterPackage(name: string, flags: Partial<AdapterCaps>, maps: string[] = ALL_HOOKS): Promise<TestAdapter> {
  const seen = seenFile(name);
  const { fixtures } = await contracts();
  const data = Object.fromEntries(Object.entries(SCHEMAS).map(([kind, schema]) => [kind, (fixtures(schema)[0] as { data: unknown }).data]));
  const settings = { name, caps: caps(flags), maps, seen, facts: fixtures('adapter.facts@1')[0], unsupported: fixtures('adapter.unsupported@1')[0], data };
  const dir = await pkg('adapter', { manifest: { id: `deepbuild/test-${name}` }, files: { 'adapter.json': JSON.stringify(settings) } });
  return { name, dir, saw: () => readSeen(seen) };
}

/** The session's hooks, through the adapter `agent` names, in order. */
export async function hooks(h: ExtensionHost, agent: string, session: string, ...events: string[]): Promise<void> {
  for (const event of events) await h.hook(hookLine(agent, session, event));
}

/** An answer for the session: an authority ask raised for it and approved by you; the Delivery the asks core handed out. */
export async function answerFor(w: World, session: string, question = 'Push feature/login to origin?'): Promise<Delivery> {
  const ask = await raise(w, session, 'effect.push', authorityAsk({ question }));
  await approve(w, ask);
  const delivery = w.deliveries.find((d) => d.ask === ask);
  expect(delivery, `the asks core handed out the answer to ${ask}`).toBeDefined();
  expect(delivery).toMatchObject({ session, option: 'approve', decision: 'allow' });
  return delivery!;
}

