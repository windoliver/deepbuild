// A transcript's model is trusted only on a route its session's start recorded as the agent's own (#1886): a session
// whose start recorded no route may be behind a proxy, so its model is unknown and a review of it counts neither way
// (AGENTS.md invariant 2).
import { expect, it } from 'vitest';
import { independence } from '../src/models.js';

const transcript = `${JSON.stringify({ type: 'assistant', message: { model: 'claude-haiku-4-5', content: [] } })}\n`;
const OWN = { ANTHROPIC_BASE_URL: false, ANTHROPIC_AUTH_TOKEN: false, CLAUDE_CODE_USE_BEDROCK: false, CLAUDE_CODE_USE_VERTEX: false };

it('a session whose start recorded no route has its model unknown, never trusted', () => {
  expect(independence('gpt-5-codex', { agent: 'claude-code', transcript, route: null })).toMatchObject({ change: 'unknown', counted: false, reason: 'model unknown: no route recorded at its start' });
});

it('one recorded on the agent\'s own route has its transcript\'s model read', () => {
  expect(independence('gpt-5-codex', { agent: 'claude-code', transcript, route: OWN })).toMatchObject({ change: 'claude-haiku-4-5', counted: true, reason: null });
});
