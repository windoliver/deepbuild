import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { shipped } from '../../../packages/adapters/src/index.ts';
import { fixtures, validate } from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import {
  corpusPayloads, DECISIONS, deleteAt, eventFixture, expectAccepted, expectRefused, kindSchema, only, PERMISSION_KINDS, request, SCOPES, setAt,
} from './helpers.ts';

const ANSWER = 'permission.answer@1';
const answer = (decision: JsonValue, scope: JsonValue): JsonValue => ({ decision, for: scope });

describe('AC3 a permission answer must name allow, deny or cancel and a scope of this call or this session', () => {
  it('AC3 every decision with every scope passes, with or without edited input', () => {
    for (const decision of DECISIONS) {
      for (const scope of SCOPES) {
        expectAccepted(validate(ANSWER, answer(decision, scope)), `${decision} for ${scope}`);
        expectAccepted(validate(ANSWER, { decision, for: scope, input: { command: 'npm test -- --runInBand' } }), `${decision} for ${scope} with edited input`);
      }
    }
    expect(fixtures(ANSWER).length, 'permission.answer@1 has published fixtures').toBeGreaterThan(0);
    for (const fixture of fixtures(ANSWER)) expectAccepted(validate(ANSWER, fixture), 'a published permission answer');
  });

  it('AC3 an answer without a decision, or with one outside allow, deny and cancel, fails naming /decision', () => {
    expectRefused(validate(ANSWER, deleteAt(answer('allow', 'call'), '/decision')), '/decision', 'answer without a decision');
    // An adapter that reads an option's label or your words as the decision lets these through; the schema does not.
    for (const bad of ['approve', 'block', 'none', 'yes', 'Allow', 'ALLOW', 'allow_always', '', 'skip']) {
      expectRefused(validate(ANSWER, answer(bad, 'call')), '/decision', `decision ${JSON.stringify(bad)}`);
    }
    expectRefused(validate(ANSWER, answer(true, 'call')), '/decision', 'decision true');
    expectRefused(validate(ANSWER, answer(null, 'call')), '/decision', 'decision null');
  });

  it('AC3 an answer without a scope, or with one outside this call and this session, fails naming /for', () => {
    expectRefused(validate(ANSWER, deleteAt(answer('allow', 'call'), '/for')), '/for', 'answer without a scope');
    for (const bad of ['always', 'once', 'this_call', 'project', 'repo', 'all', '', 'Session']) {
      expectRefused(validate(ANSWER, answer('allow', bad)), '/for', `scope ${JSON.stringify(bad)}`);
    }
  });

  it('AC3 an answer carries nothing else: a lasting rule for the agent\'s own settings, or a field it doesn\'t list, fails', () => {
    expectRefused(validate(ANSWER, { decision: 'allow', for: 'session', permission_suggestions: [{ type: 'addRules' }] }), '/permission_suggestions', 'an answer that writes a rule');
    expectRefused(validate(ANSWER, { decision: 'allow', for: 'call', planted_extra: true }), '/planted_extra', 'an unlisted field');
  });

  it('AC3 every decision outside the three and every scope outside the two is refused (1,000 cases)', () => {
    const words = fc.oneof(fc.string(), fc.stringMatching(/^[a-z_]{1,12}$/));
    fc.assert(fc.property(words, words, (decision, scope) => {
      const result = validate(ANSWER, answer(decision, scope));
      const goodDecision = (DECISIONS as readonly string[]).includes(decision);
      const goodScope = (SCOPES as readonly string[]).includes(scope);
      if (goodDecision && goodScope) expectAccepted(result, `${decision} for ${scope}`);
      else expectRefused(result, goodDecision ? '/for' : '/decision', `${JSON.stringify(decision)} for ${JSON.stringify(scope)}`);
    }), { numRuns: 1000 });
  });
});

describe('permission requests have a kind: tool, plan, question or mode', () => {
  const REQUEST = () => kindSchema('permission.request');

  it.each(PERMISSION_KINDS)('a permission request of kind %s passes', (kind) => {
    expectAccepted(validate(REQUEST(), setAt(eventFixture('permission.request'), '/data/kind', kind)), `permission.request kind ${kind}`);
  });

  it.each(['edit', 'bash', 'approval', 'Tool', ''])('a permission request of kind %j fails, naming /data/kind', (kind) => {
    expectRefused(validate(REQUEST(), setAt(eventFixture('permission.request'), '/data/kind', kind)), '/data/kind', `permission.request kind ${JSON.stringify(kind)}`);
  });

  it('a permission request without a kind fails, naming /data/kind', () => {
    expectRefused(validate(REQUEST(), deleteAt(eventFixture('permission.request'), '/data/kind')), '/data/kind', 'permission.request without kind');
  });

  it('both agents\' recorded PermissionRequest hooks map to a permission request of kind tool carrying the call\'s detail', () => {
    const claude = corpusPayloads('claude-code', '2.1.304', 'tools').filter((p) => p.hook_event_name === 'PermissionRequest');
    const codex = corpusPayloads('codex', '0.160.0', 'permission').filter((p) => p.hook_event_name === 'PermissionRequest');
    expect(claude.length).toBeGreaterThan(0);
    expect(codex.length).toBeGreaterThan(0);
    for (const payload of claude) {
      const event = only(shipped().mapHook(request('claude', payload), '2.1.304'), 'permission.request', 'Claude PermissionRequest');
      expect(event.data.kind).toBe('tool');
      expect(event.data.tool).toBe(payload.tool_name);
    }
    for (const payload of codex) {
      const event = only(shipped().mapHook(request('codex', payload), '0.160.0'), 'permission.request', 'Codex PermissionRequest');
      expect(event.data.kind).toBe('tool');
      expect(event.data.tool).toBe('Bash');
      expect(event.data.command).toBe('touch /private/tmp/deep-corpus-permission-1792479714274.txt');
    }
  });
});
