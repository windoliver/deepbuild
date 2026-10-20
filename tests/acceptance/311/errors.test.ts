import { describe, expect, it } from 'vitest';
import { ERROR_CODES, parseHandle, validate } from '../../../packages/contracts/src/index.ts';
import type { ContractIssue, JsonValue } from '../../../packages/contracts/src/index.ts';
import { expectAccepted, expectRefused, fixture, setAt } from './helpers.ts';

const READ_CAP = 8192;

function issuesOf(name: string, value: JsonValue): ContractIssue[] {
  const result = validate(name, value);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.issues;
}

describe('Added Oct 9: errors share one shape', () => {
  it('the codes come from one closed set', () => {
    expect(ERROR_CODES.length).toBeGreaterThan(0);
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    for (const code of ERROR_CODES) expect(code).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('a refusal carries a code, whether a retry can help, one remediation, the path and the value refused there, and evidence handles', () => {
    const [issue] = issuesOf('hook.request@1', setAt(fixture('hook', 'request.json'), '/seq', '01'));
    expect(issue).toBeDefined();
    expect(Object.keys(issue!).sort()).toEqual(['actual', 'code', 'evidence', 'path', 'remediation', 'retryable']);
    expect(ERROR_CODES).toContain(issue!.code);
    expect(typeof issue!.retryable).toBe('boolean');
    expect(issue!.remediation.length).toBeGreaterThan(0);
    expect(issue!.path).toBe('/seq');
    expect(issue!.actual).toBe('01');
    for (const handle of issue!.evidence) expect(() => parseHandle(handle)).not.toThrow();
    // The shape has its own schema, and an issue validates against it.
    expectAccepted(validate('error@1', issue as unknown as JsonValue), 'error@1 of a seq refusal');
    expectRefused(validate('error@1', setAt(issue as unknown as JsonValue, '/code', 'not_a_listed_code_311')), '/code', 'error with an unlisted code');
  });

  it('the value refused is cut at the read cap of 8,192 characters', () => {
    const long = '1'.repeat(20_000) + 'x';
    const [issue] = issuesOf('hook.request@1', setAt(fixture('hook', 'request.json'), '/seq', long));
    expect(issue!.path).toBe('/seq');
    expect(issue!.actual.length).toBeLessThanOrEqual(READ_CAP);
    expect(long.startsWith(issue!.actual.slice(0, 1000))).toBe(true);
  });
});
