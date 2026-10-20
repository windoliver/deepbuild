import { describe, expect, it } from 'vitest';
import { ContractError, decode, encode, negotiateFeatures, validate } from '../../../packages/contracts/src/index.ts';
import type { HookRequest } from '../../../packages/contracts/src/index.ts';
import { expectAccepted, expectRefused, fixture, setAt } from './helpers.ts';

const REQUEST = 'hook.request@1';

describe('AC14 a planted feature f_test the hub does not list', () => {
  it('AC14 the feature is off when the hub does not list it, and only that feature', () => {
    // An older hub with a newer deep-hook keeps working, with the new feature off (Added Oct 9, Done when).
    expect(negotiateFeatures(['matched', 'f_test'], ['matched'])).toEqual({ on: ['matched'], off: ['f_test'] });
    expect(negotiateFeatures(['f_test'], ['f_test', 'matched'])).toEqual({ on: ['f_test'], off: [] });
    expect(negotiateFeatures([], ['matched'])).toEqual({ on: [], off: [] });
  });

  it('AC14 without f_test the request is the same request as before, and the hub takes it', () => {
    const before = fixture('hook', 'request.json');
    expectAccepted(validate(REQUEST, before), 'request without f_test');
    const decoded = decode<HookRequest>(REQUEST, JSON.stringify(before));
    expect(encode(REQUEST, decoded)).not.toContain('f_test');
  });

  it('AC14 with f_test forced in, the hub refuses the request, naming the field', () => {
    // A hub that ignores a field it doesn't understand accepts this and fails the test.
    const forced = setAt(fixture('hook', 'request.json'), '/f_test', true);
    expectRefused(validate(REQUEST, forced), '/f_test', 'request with f_test');
    let refused: unknown;
    try { decode(REQUEST, JSON.stringify(forced)); } catch (error) { refused = error; }
    expect(refused).toBeInstanceOf(ContractError);
    expect((refused as ContractError).path).toBe('/f_test');
  });

  it('AC14 the client side cannot send it either: encoding a request with f_test refuses, naming the field', () => {
    const forced = { ...decode<HookRequest>(REQUEST, JSON.stringify(fixture('hook', 'request.json'))), f_test: true };
    let refused: unknown;
    try { encode(REQUEST, forced); } catch (error) { refused = error; }
    expect(refused).toBeInstanceOf(ContractError);
    expect((refused as ContractError).path).toBe('/f_test');
  });

  it.each(['hook.ack@1', 'hook.reply@1'])('AC14 %s refuses a field it does not list too', (name) => {
    const file = name === 'hook.ack@1' ? 'ack-null.json' : 'reply-allow.json';
    expectRefused(validate(name, setAt(fixture('hook', file), '/f_test', true)), '/f_test', `${name} with f_test`);
  });
});
