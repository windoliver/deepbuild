// The resolver scenarios AC3 and AC7 share: a world, the test resolver package loaded in the hub (its play set
// by a file the test rewrites), sessions started in a repo, asks raised for them, and a decision saved from your
// approval of one. Everything reaches the core through the README's surface: `deep.registerResolver` in the
// package, `Asks.saveDecision`, `Asks.revokeDecision`, `Asks.refusals`, and the record.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import type { AsksPlant } from '../../../packages/asks/src/index.ts';
import type { ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import { approve, inboxRow, loadInHub, openWorld, pkg, raise, sessionId, startSession, tempDir, YOU, type World } from './helpers.ts';

export interface Play { skip?: boolean; answer?: string; because?: string | null }
export interface Resolving {
  w: World;
  host: ExtensionHost;
  /** The repo the first sessions start in, and another repo. */
  repo: string;
  otherRepo: string;
  /** Sets how the test resolver answers from now on. */
  play(play: Play): void;
  /** A new session started in `repo`, and the handle of an authority ask raised for it. */
  ask(repo?: string, source?: string, ask?: Record<string, unknown>): Promise<{ session: string; ask: string }>;
  /** Your approval of an ask on the trusted path, saved as a decision at `scope`: its handle. */
  decide(ask: string, scope: 'session' | 'repo' | 'all'): Promise<string>;
}
export async function openResolving(options: { plant?: AsksPlant } = {}): Promise<Resolving> {
  const w = await openWorld(options);
  const file = join(tempDir('play'), 'play.json');
  const play = (p: Play): void => writeFileSync(file, JSON.stringify(p));
  play({ skip: true });
  const host = await loadInHub(w, await pkg('resolver', { files: { 'resolver.json': JSON.stringify({ file }) } }));
  const repo = tempDir('repo');
  const otherRepo = tempDir('other-repo');
  return {
    w, host, repo, otherRepo, play,
    async ask(inRepo = repo, source = 'effect.push', ask?) {
      const session = sessionId();
      await startSession(w, session, inRepo);
      return { session, ask: await raise(w, session, source, ask) };
    },
    async decide(ask, scope) {
      await approve(w, ask);
      const decision = await w.asks.saveDecision(YOU, ask, scope);
      expect(decision, 'a saved decision is a decision: handle').toMatch(/^decision:[0-9A-Za-z]+$/);
      return decision;
    },
  };
}

/** The criterion's refused half: the core applied nothing, the refusal names the decision (when one was named), and the ask reaches you. */
export async function refusedAndReachesYou(r: Resolving, ask: string, named: string | null): Promise<void> {
  const applied = (await r.w.events('decision.applied')).filter((e) => (e.data as { ask: string }).ask === ask);
  expect(applied, `the core applied ${named ?? 'no decision'} to ${ask}: ${JSON.stringify(applied.map((e) => e.data))}`).toEqual([]);
  const refusals = await r.w.asks.refusals(ask);
  expect(refusals.length, `the core refused the resolver's answer to ${ask}`).toBeGreaterThanOrEqual(1);
  const [refusal] = refusals;
  expect(refusal!.resolver, 'the refusal names the resolver').toMatch(/test-resolver/);
  if (named) {
    expect(refusal!.decision, `the refusal names ${named}`).toBe(named);
    expect(refusal!.reason, `the refusal's reason names ${named}`).toContain(named);
  }
  const row = await inboxRow(r.w, ask);
  expect(row.outcome, `${ask} reaches you: it stays unanswered`).toBe('unanswered');
  expect(['queued', 'shown', 'held']).toContain(row.status);
  expect(r.w.deliveries.filter((d) => d.ask === ask), 'nothing was handed to the agent').toEqual([]);
}

/** The applied half: decision.applied names the decision and the ask, the ask is logged as decided for you, and the answer went to the agent. */
export async function appliedAndLogged(r: Resolving, ask: string, decision: string): Promise<void> {
  const applied = (await r.w.events('decision.applied')).filter((e) => (e.data as { ask: string }).ask === ask);
  expect(applied.map((e) => e.data), `decision.applied names ${decision} for ${ask}`).toEqual([{ decision, ask }]);
  expect(applied[0]!.writer, 'only the core applies a decision').toBe('core');
  const row = await inboxRow(r.w, ask);
  expect(row.outcome, `${ask} is logged as decided for you`).toBe('decided_for_you');
  expect(r.w.deliveries.filter((d) => d.ask === ask), 'the answer reached the agent, once, as the decision says').toMatchObject([{ option: 'approve', decision: 'allow', session: expect.any(String) }]);
  expect(await r.w.asks.refusals(ask), 'nothing was refused').toEqual([]);
}
