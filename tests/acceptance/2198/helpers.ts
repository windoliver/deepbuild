import { join } from 'node:path';
import { expect } from 'vitest';
import * as t26 from '../26/helpers.ts';

export type Line = t26.Line;
export const { cleanup, callTool, claimArgs, events } = t26;
export type World = t26.World;
export type Outcome = t26.Outcome;

export const AC1 = 'AC1 #2198.c3a8010e';
export const AC2 = 'AC2 #2198.21ecccc1';
export const AC3 = 'AC3 #2198.4ded8bb8';
export const AC4 = 'AC4 #2198.4047e008';
export const AC5 = 'AC5 #2198.2cf7dbf9';

const SERVER = join(t26.REPO, 'tests/acceptance/331/fixtures/server.mjs');

const SPEC = ['claims:', '  done:', '    checks: [unit, lint]', 'checks:', '  unit: { type: command, run: "false" }', '  lint: { type: command, run: "false" }'];
const ASKS = [
  'asks:',
  '  deadline: { taste: 3d, authority: 1d, unblock: 2d, exception: 2d, choice: 2d, definition: 4h }',
  '  default: { taste: recommended, authority: "no", unblock: stay-blocked, exception: no-change, choice: recommended, definition: leave-out }',
  '  fallback: [change-owner]',
];
const ASKS_NO_TASTE = [
  'asks:',
  '  deadline: { authority: 1d, unblock: 2d, exception: 2d, choice: 2d, definition: 4h }',
  '  default: { taste: recommended, authority: "no", unblock: stay-blocked, exception: no-change, choice: recommended, definition: leave-out }',
  '  fallback: [change-owner]',
];
const ASKS_UNREADABLE = [
  'asks:',
  '  deadline: { taste: 3d, authority: 1d, unblock: 2d',
  '  default: { taste: recommended, authority: "no", unblock: stay-blocked, exception: no-change, choice: recommended, definition: leave-out }',
];
export const UNREADABLE_LINE = SPEC.length + 2;
const ENVIRONMENT = [
  'environment:',
  `  up: ${JSON.stringify(`${process.execPath} ${SERVER} --pid-dir .pids`)}`,
  '  ports: [web]',
  '  ready: { http: "http://127.0.0.1:${web}/health", within: 20 }',
];

export type Spec = 'no-taste-deadline' | 'taste-deadline' | 'unreadable-asks' | 'no-environment' | 'environment';
export function doneYaml(spec: Spec): string {
  const lines = spec === 'no-taste-deadline' ? [...SPEC, ...ASKS_NO_TASTE]
    : spec === 'unreadable-asks' ? [...SPEC, ...ASKS_UNREADABLE]
    : spec === 'environment' ? [...SPEC, ...ASKS, ...ENVIRONMENT]
    : [...SPEC, ...ASKS];
  return `${lines.join('\n')}\n`;
}

export async function world(spec: Spec): Promise<World> {
  return t26.agentWorld({ files: { '.deepbuild/done.yaml': doneYaml(spec), '.gitignore': '.pids/\n' } });
}

export const call = (w: World, tool: string, args: Line, timeoutMs = 120_000): Promise<Outcome> => t26.callTool(w.agent, tool, args, timeoutMs);

export function tasteArgs(question = 'Which header colour should the checkout page use?'): Line {
  return {
    kind: 'taste', question,
    options: [{ id: 'blue', label: 'Blue header' }, { id: 'green', label: 'Green header' }],
    recommended: 'blue', steps: null, where: null, why: null, check: null, thread: null, subject: null,
  };
}

export function refusalOf(o: Outcome, what: string): Line {
  expect(o.protocolError, `${what}: a refusal is a tool result with isError, not a JSON-RPC error: ${JSON.stringify(o.reply).slice(0, 1500)}`).toBe(false);
  expect(o.isError, `${what} is refused: ${JSON.stringify(o.reply).slice(0, 1500)}`).toBe(true);
  expect(typeof o.value === 'object' && o.value !== null, `${what}: the refusal is an object: ${JSON.stringify(o.value)}`).toBe(true);
  return o.value as Line;
}

export const underParams = (path: unknown): boolean => typeof path === 'string' && /^\/params(\/|$)/.test(path);

export function personDeclares(text: string): boolean {
  return text.split(/(?<=[.;!?])\s+/).some((s) => /\b(you|person|people|owner|human)\b/i.test(s) && /\bdeclar/i.test(s));
}
