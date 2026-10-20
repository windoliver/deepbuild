import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ContractError, HANDLE_SCHEMES, parseHandle, printHandle } from '../../../packages/contracts/src/index.ts';
import { ULID, ulidArb } from './helpers.ts';

const SCHEMES = ['task', 'ask', 'claim', 'verdict', 'run', 'req', 'decision', 'plan', 'lease', 'reading', 'notice', 'doc', 'ev', 'session'];

function refusal(text: string): ContractError {
  try {
    parseHandle(text);
  } catch (error) {
    expect(error, text).toBeInstanceOf(ContractError);
    return error as ContractError;
  }
  throw Error(`${JSON.stringify(text)} was not refused`);
}

describe('AC13 every record handle parses with one grammar, and a scheme outside the closed list is refused', () => {
  it('AC13 the schemes are exactly the closed list in the conventions', () => {
    expect([...HANDLE_SCHEMES].sort()).toEqual([...SCHEMES].sort());
  });

  it.each([
    [`task:${ULID}`, { scheme: 'task', id: ULID }],
    [`ev:${ULID}`, { scheme: 'ev', id: ULID }],
    [`req:${ULID}#R2`, { scheme: 'req', id: ULID, fragment: 'R2' }],
    [`session:${ULID}#msg3`, { scheme: 'session', id: ULID, fragment: 'msg3' }],
    [`doc:${ULID}#row.m14`, { scheme: 'doc', id: ULID, fragment: 'row.m14' }],
  ])('AC13 %s parses and prints back', (text, want) => {
    const handle = parseHandle(text);
    expect(handle).toEqual(want);
    expect(printHandle(handle)).toBe(text);
  });

  it.each(SCHEMES)('AC13 %s:<ulid> parses with the one grammar', (scheme) => {
    expect(parseHandle(`${scheme}:${ULID}`)).toEqual({ scheme, id: ULID });
  });

  it.each(['job', 'file', 'http', 'TASK', 'Task', 'tasks', 'evidence'])('AC13 a handle with scheme %s is refused, naming the scheme', (scheme) => {
    const error = refusal(`${scheme}:${ULID}`);
    expect(error.actual).toBe(scheme);
  });

  it.each([ULID, `task:`, `:${ULID}`, `task ${ULID}`, `task:${ULID}#`, ''])('AC13 %j is not a handle', (text) => {
    refusal(text);
  });

  it('AC13 property: generated handles print back to the same text, and an unlisted scheme is refused naming it', () => {
    const fragment = (scheme: string) => scheme === 'req' ? fc.integer({ min: 1, max: 99 }).map((n) => `#R${n}`)
      : scheme === 'session' ? fc.integer({ min: 0, max: 9999 }).map((n) => `#msg${n}`)
      : scheme === 'doc' ? fc.stringMatching(/^[a-z0-9][a-z0-9_-]{0,11}(\.[a-z0-9][a-z0-9_-]{0,11}){0,2}$/).map((id) => `#${id}`)
      : fc.constant('');
    const handle = fc.constantFrom(...SCHEMES).chain((scheme) => fc.tuple(fc.constant(scheme), ulidArb, fc.oneof(fc.constant(''), fragment(scheme))))
      .map(([scheme, id, frag]) => `${scheme}:${id}${frag}`);
    fc.assert(fc.property(handle, (text) => {
      expect(printHandle(parseHandle(text))).toBe(text);
    }), { numRuns: 1000, seed: 0x311_13 });

    const unlisted = fc.stringMatching(/^[a-z][a-z_]{0,11}$/).filter((s) => !SCHEMES.includes(s));
    fc.assert(fc.property(unlisted, ulidArb, (scheme, id) => {
      expect(refusal(`${scheme}:${id}`).actual).toBe(scheme);
    }), { numRuns: 1000, seed: 0x311_14 });
  });
});
