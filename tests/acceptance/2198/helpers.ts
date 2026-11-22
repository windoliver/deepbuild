// Test-side tools for the #2198 acceptance tests (README): a real hub (`deep hub run`) in a temporary home that `deep setup`
// never drafted ask settings for (no <home>/.deepbuild/config.json, as on a dev hub), a worktree whose
// .deepbuild/done.yaml each test writes, and a Claude Code agent stand-in whose own `deep mcp` is its child, so its
// deep_* calls bind to its session as an agent's MCP client's do. All of it is #26's, imported unchanged; nothing here
// stands in for the hub or `deep mcp`. Processes are stopped by PID only (#26's cleanup), never by name or port.

import { join } from 'node:path';
import { expect } from 'vitest';
import * as t26 from '../26/helpers.ts';

export type Line = t26.Line;
export const { cleanup, callTool, claimArgs, events } = t26;
export type World = t26.World;
export type Outcome = t26.Outcome;

/** The criteria's tags (README: Criteria): the first 8 hex digits of the SHA-256 of each checkbox's text. */
export const AC1 = 'AC1 #2198.c3a8010e';
export const AC2 = 'AC2 #2198.21ecccc1';
export const AC3 = 'AC3 #2198.4ded8bb8';
export const AC4 = 'AC4 #2198.4047e008';
export const AC5 = 'AC5 #2198.2cf7dbf9';

/** #331's dev-server fixture: listens on $web and answers GET /health with 200. Used as is, by its path. */
const SERVER = join(t26.REPO, 'tests/acceptance/331/fixtures/server.mjs');

/** The part of done.yaml every world shares: a claim and its two checks, as #26's spec has them. */
const SPEC = ['claims:', '  done:', '    checks: [unit, lint]', 'checks:', '  unit: { type: command, run: "false" }', '  lint: { type: command, run: "false" }'];
/** An asks block that declares every kind's deadline and default (#26's, the design's done.yaml). */
const ASKS = [
  'asks:',
  '  deadline: { taste: 3d, authority: 1d, unblock: 2d, exception: 2d, choice: 2d, definition: 4h }',
  '  default: { taste: recommended, authority: "no", unblock: stay-blocked, exception: no-change, choice: recommended, definition: leave-out }',
  '  fallback: [change-owner]',
];
/** The same block with no deadline for taste asks: the other kinds keep theirs. */
const ASKS_NO_TASTE = [
  'asks:',
  '  deadline: { authority: 1d, unblock: 2d, exception: 2d, choice: 2d, definition: 4h }',
  '  default: { taste: recommended, authority: "no", unblock: stay-blocked, exception: no-change, choice: recommended, definition: leave-out }',
  '  fallback: [change-owner]',
];
/**
 * An asks block whose deadline line doesn't parse: its flow map is never closed. It is the file's line
 * UNREADABLE_LINE (1-based), and no YAML reader takes it.
 */
const ASKS_UNREADABLE = [
  'asks:',
  '  deadline: { taste: 3d, authority: 1d, unblock: 2d',
  '  default: { taste: recommended, authority: "no", unblock: stay-blocked, exception: no-change, choice: recommended, definition: leave-out }',
];
export const UNREADABLE_LINE = SPEC.length + 2;
/** An environment block that brings #331's dev server up on a leased port named web, ready once /health answers. */
const ENVIRONMENT = [
  'environment:',
  `  up: ${JSON.stringify(`${process.execPath} ${SERVER} --pid-dir .pids`)}`,
  '  ports: [web]',
  '  ready: { http: "http://127.0.0.1:${web}/health", within: 20 }',
];

export type Spec = 'no-taste-deadline' | 'taste-deadline' | 'unreadable-asks' | 'no-environment' | 'environment';
/** The worktree's .deepbuild/done.yaml for each world the tests need. */
export function doneYaml(spec: Spec): string {
  const lines = spec === 'no-taste-deadline' ? [...SPEC, ...ASKS_NO_TASTE]
    : spec === 'unreadable-asks' ? [...SPEC, ...ASKS_UNREADABLE]
    : spec === 'environment' ? [...SPEC, ...ASKS, ...ENVIRONMENT]
    : [...SPEC, ...ASKS];
  return `${lines.join('\n')}\n`;
}

/**
 * A hub with no ask settings of yours (no config.json: `deep setup` never ran in this home), a worktree whose done.yaml is
 * `spec`'s, and a Claude Code session there, established through its hooks, whose `deep mcp` is initialized (#26's agentWorld).
 */
export async function world(spec: Spec): Promise<World> {
  return t26.agentWorld({ files: { '.deepbuild/done.yaml': doneYaml(spec), '.gitignore': '.pids/\n' } });
}

/** One deep_* call from the session's own `deep mcp`, as its MCP client makes it. */
export const call = (w: World, tool: string, args: Line, timeoutMs = 120_000): Promise<Outcome> => t26.callTool(w.agent, tool, args, timeoutMs);

/** A taste question with a recommendation, every field deep_ask's schema lists: a taste call goes on at once (provisional). */
export function tasteArgs(question = 'Which header colour should the checkout page use?'): Line {
  return {
    kind: 'taste', question,
    options: [{ id: 'blue', label: 'Blue header' }, { id: 'green', label: 'Green header' }],
    recommended: 'blue', steps: null, where: null, why: null, check: null, thread: null, subject: null,
  };
}

/** The refusal a tool result carries: a tool result with isError (never a JSON-RPC error), its value an object. */
export function refusalOf(o: Outcome, what: string): Line {
  expect(o.protocolError, `${what}: a refusal is a tool result with isError, not a JSON-RPC error: ${JSON.stringify(o.reply).slice(0, 1500)}`).toBe(false);
  expect(o.isError, `${what} is refused: ${JSON.stringify(o.reply).slice(0, 1500)}`).toBe(true);
  expect(typeof o.value === 'object' && o.value !== null, `${what}: the refusal is an object: ${JSON.stringify(o.value)}`).toBe(true);
  return o.value as Line;
}

/** Whether a refusal's path is under the call's parameters: /params, or anything under it such as /params/arguments/x. */
export const underParams = (path: unknown): boolean => typeof path === 'string' && /^\/params(\/|$)/.test(path);

/**
 * Whether a remediation says the person declares the setting (README: Readings): a sentence holding "you", "your person",
 * "the person", "a person", "owner" or "human" as a word and a form of "declare". Today's "is declared in your settings"
 * names no one who declares: "your" is not "you".
 */
export function personDeclares(text: string): boolean {
  return text.split(/(?<=[.;!?])\s+/).some((s) => /\b(you|person|people|owner|human)\b/i.test(s) && /\bdeclar/i.test(s));
}
