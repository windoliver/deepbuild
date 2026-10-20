import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  canonicalize, ContractError, contextBoundFor, decode, encode, joinHookReplies, validate,
} from '../../../packages/contracts/src/index.ts';
import type { HookAck, HookContribution, HookRequest, JsonValue } from '../../../packages/contracts/src/index.ts';
import { deleteAt, expectAccepted, expectRefused, fixture, SEQ_MAX, setAt, ULID, utf8 } from './helpers.ts';

const REQUEST = 'hook.request@1';
const ACK = 'hook.ack@1';
const request = (): JsonValue => fixture('hook', 'request.json');
/** The request as one JSON line, with seq written raw: `"…"` for a string, bare digits for a JSON number. */
const line = (rawSeq: string): string => {
  const text = JSON.stringify(setAt(request(), '/seq', '__SEQ__'));
  return text.replace('"__SEQ__"', rawSeq);
};
/** The canonical decimal form the issue gives seq: digits only, no sign, exponent or leading zero, 0 to 2^63 - 1. */
const canonicalSeq = (s: string): boolean => /^(0|[1-9][0-9]*)$/.test(s) && BigInt(s) <= SEQ_MAX;

describe('AC9 the hook request schema holds seq to its canonical decimal form and id to a ULID', () => {
  it('AC9 the design\'s example request passes', () => {
    expectAccepted(validate(REQUEST, request()), 'hook request fixture');
  });

  it('AC9 seq sent as the JSON number 1760013451123456789 fails, naming the field', () => {
    // JSON.parse already rounds the number, so the raw line is checked through decode too.
    expectRefused(validate(REQUEST, setAt(request(), '/seq', 1760013451123456789)), '/seq', 'seq as a JSON number');
    let refused: unknown;
    try { decode(REQUEST, line('1760013451123456789')); } catch (error) { refused = error; }
    expect(refused, 'decoding a line whose seq is a JSON number throws').toBeInstanceOf(ContractError);
    expect((refused as ContractError).path).toBe('/seq');
  });

  it.each(['-1', '+1', '01', '1e3', '1.0', ' 1', '9223372036854775808'])('AC9 seq %j fails, naming the field and why', (seq) => {
    const result = validate(REQUEST, setAt(request(), '/seq', seq));
    expectRefused(result, '/seq', `seq ${JSON.stringify(seq)}`);
  });

  it.each(['0', '9223372036854775807', '1760013451123456789'])('AC9 seq %j passes', (seq) => {
    expectAccepted(validate(REQUEST, setAt(request(), '/seq', seq)), `seq ${seq}`);
  });

  it('AC9 property: a seq string passes exactly when it is canonical decimal in 0 to 2^63 - 1', () => {
    const digits = fc.string({ unit: fc.constantFrom('0', '1', '9', '-', '+', 'e', 'E', '.', ' ', 'x', '٣'), maxLength: 22 });
    const near = fc.bigInt({ min: 0n, max: 2n ** 64n }).map(String);
    const padded = fc.tuple(fc.constantFrom('0', '00', '-', '+', ' ', ''), fc.bigInt({ min: 0n, max: SEQ_MAX }), fc.constantFrom('', ' ', '.0', 'e0', 'n'))
      .map(([a, n, b]) => `${a}${n}${b}`);
    fc.assert(fc.property(fc.oneof(digits, near, padded, fc.string()), (seq) => {
      const result = validate(REQUEST, setAt(request(), '/seq', seq));
      expect(result.ok, `seq ${JSON.stringify(seq)}`).toBe(canonicalSeq(seq));
      if (!result.ok) expect(result.issues.map((i) => i.path)).toContain('/seq');
    }), { numRuns: 1000, seed: 0x311_09 });
  });

  it('AC9 a hook request without id, or with an id that is not a ULID, fails naming /id', () => {
    expectRefused(validate(REQUEST, deleteAt(request(), '/id')), '/id', 'request without id');
    for (const id of ['not-a-ulid', '01K74FKZVK8Q2X5R7M3N9P4T6', '01K74FKZVK8Q2X5R7M3N9P4T6WX', '01K74FKZVK8Q2X5R7M3N9P4T6U', '8ZZZZZZZZZZZZZZZZZZZZZZZZZ', 1, null]) {
      expectRefused(validate(REQUEST, setAt(request(), '/id', id)), '/id', `id ${JSON.stringify(id)}`);
    }
  });

  it('AC9 a hook request carries matched, the guard entries it matched by name', () => {
    expectAccepted(validate(REQUEST, setAt(request(), '/matched', [])), 'matched empty');
    expectRefused(validate(REQUEST, deleteAt(request(), '/matched')), '/matched', 'request without matched');
  });
});

describe('AC10 seq parses to a bigint through the generated types and serializes back unchanged', () => {
  const roundTrip = (seq: string) => {
    const req = decode<HookRequest>(REQUEST, line(`"${seq}"`));
    const value: bigint = req.seq;
    const back = encode(REQUEST, req);
    return { value, back };
  };

  it('AC10 1760013451123456789 and 1760013451123456790 stay two distinct bigints, in order, and print back as sent', () => {
    const a = roundTrip('1760013451123456789');
    const b = roundTrip('1760013451123456790');
    // Types that parse seq as a JavaScript number fail here: both become 1760013451123456768.
    expect(typeof a.value).toBe('bigint');
    expect(typeof b.value).toBe('bigint');
    expect(a.value).toBe(1760013451123456789n);
    expect(b.value).toBe(1760013451123456790n);
    expect(a.value < b.value).toBe(true);
    expect((JSON.parse(a.back) as { seq: unknown }).seq).toBe('1760013451123456789');
    expect((JSON.parse(b.back) as { seq: unknown }).seq).toBe('1760013451123456790');
    // The encoder writes the request's RFC 8785 bytes, so the line is exactly the canonical form of what was sent.
    expect(a.back).toBe(utf8(canonicalize(request())));
  });

  it.each(['9007199254740991', '9007199254740992', '9007199254740993'])('AC10 %s (around 2^53) parses to the exact bigint and back', (seq) => {
    const { value, back } = roundTrip(seq);
    expect(typeof value).toBe('bigint');
    expect(value).toBe(BigInt(seq));
    expect((JSON.parse(back) as { seq: unknown }).seq).toBe(seq);
  });

  it('AC10 2^53 - 1, 2^53 and 2^53 + 1 are three distinct bigints in order', () => {
    const [x, y, z] = ['9007199254740991', '9007199254740992', '9007199254740993'].map((s) => roundTrip(s).value);
    expect(x! < y! && y! < z!).toBe(true);
  });

  it('AC10 property: every seq from 0 to 2^63 - 1 round-trips through decode and encode exactly', () => {
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: SEQ_MAX }), (n) => {
      const { value, back } = roundTrip(n.toString());
      expect(value).toBe(n);
      expect((JSON.parse(back) as { seq: unknown }).seq).toBe(n.toString());
    }), { numRuns: 1000, seed: 0x311_10 });
  });
});

describe('AC17 the hook acknowledgement {ack, hold_until_ms}', () => {
  const ack = (): JsonValue => fixture('hook', 'ack-null.json');

  it('AC17 one fixture of each valid form passes: hold_until_ms null and a whole number of ms', () => {
    expectAccepted(validate(ACK, fixture('hook', 'ack-null.json')), 'ack with hold_until_ms null');
    expectAccepted(validate(ACK, fixture('hook', 'ack-ms.json')), 'ack with hold_until_ms 1760013451173');
    const decoded = decode<HookAck>(ACK, JSON.stringify(fixture('hook', 'ack-ms.json')));
    expect(decoded.ack).toBe(ULID);
  });

  it('AC17 ack missing fails naming /ack', () => {
    expectRefused(validate(ACK, deleteAt(ack(), '/ack')), '/ack', 'ack missing');
  });

  it('AC17 ack that is not a ULID fails naming /ack', () => {
    expectRefused(validate(ACK, setAt(ack(), '/ack', 'not-a-ulid')), '/ack', 'ack not a ULID');
  });

  it('AC17 hold_until_ms sent as a string fails naming /hold_until_ms', () => {
    expectRefused(validate(ACK, setAt(ack(), '/hold_until_ms', '1760013451173')), '/hold_until_ms', 'hold_until_ms as a string');
  });

  it('AC17 hold_until_ms -1 fails naming /hold_until_ms', () => {
    // A schema that types hold_until_ms as any JSON number accepts -1 and fails here.
    expectRefused(validate(ACK, setAt(ack(), '/hold_until_ms', -1)), '/hold_until_ms', 'hold_until_ms -1');
    expectRefused(validate(ACK, setAt(ack(), '/hold_until_ms', 1760013451173.5)), '/hold_until_ms', 'hold_until_ms not whole');
    expectRefused(validate(ACK, deleteAt(ack(), '/hold_until_ms')), '/hold_until_ms', 'hold_until_ms missing');
  });
});

describe('AC8 the joined hook reply keeps every deny and cuts context from the end, within the bound', () => {
  const A = 'A'.repeat(1000);
  const Z = 'Z'.repeat(1000);
  const D = 'D'.repeat(300);
  // Given out of order on purpose: the join order never follows load or finish order.
  const contributions: HookContribution[] = [
    { extension: 'zeta-notes', firstParty: false, context: [Z], deny: { reason: 'zeta: not on main' } },
    { extension: 'done-gate', firstParty: true, context: [D] },
    { extension: 'alpha-notes', firstParty: false, context: [A] },
    { extension: 'core-guards', firstParty: true, context: [], deny: { reason: 'no killing processes by name' } },
  ];
  const total = (blocks: { text: string }[]) => blocks.reduce((n, b) => n + b.text.length, 0);
  const textOf = (joined: ReturnType<typeof joinHookReplies>, extension: string) =>
    joined.context.filter((b) => b.extension === extension).map((b) => b.text).join('');

  it('AC8 the join order is first-party extensions, then every other package, each group by extension ID', () => {
    const joined = joinHookReplies(contributions, 10_000);
    expect(joined.order).toEqual(['core-guards', 'done-gate', 'alpha-notes', 'zeta-notes']);
    expect(joined.context.map((b) => b.extension)).toEqual(['done-gate', 'alpha-notes', 'zeta-notes']);
    expect(joined.denies).toEqual([
      { extension: 'core-guards', reason: 'no killing processes by name' },
      { extension: 'zeta-notes', reason: 'zeta: not on main' },
    ]);
    expect(total(joined.context)).toBe(2300); // under the bound nothing is cut
  });

  it('AC8 over the bound: every deny stays, the earlier group stays whole, the later group is cut to equal shares from the end', () => {
    const joined = joinHookReplies(contributions, 700);
    expect(joined.bound).toBe(700);
    expect(joined.denies.map((d) => d.reason).sort()).toEqual(['no killing processes by name', 'zeta: not on main']);
    expect(total(joined.context)).toBeLessThanOrEqual(700);
    expect(textOf(joined, 'done-gate')).toBe(D);
    // 400 left for two blocks of the later group: each gets an equal share, at most 200, keeping its start.
    for (const [extension, original] of [['alpha-notes', A], ['zeta-notes', Z]] as const) {
      const kept = textOf(joined, extension);
      expect(kept.length, `${extension}'s share`).toBeLessThanOrEqual(200);
      expect(kept.length, `${extension}'s share`).toBeGreaterThanOrEqual(150);
      expect(kept.slice(0, 150), `${extension} is cut from its end`).toBe(original.slice(0, 150));
    }
  });

  it('AC8 a bound smaller than the first group: the later group goes first, the earlier is cut, and no deny is ever cut', () => {
    const joined = joinHookReplies(contributions, 100);
    expect(total(joined.context)).toBeLessThanOrEqual(100);
    expect(textOf(joined, 'alpha-notes') + textOf(joined, 'zeta-notes')).toBe('');
    expect(textOf(joined, 'done-gate').length).toBeGreaterThanOrEqual(50);
    expect(textOf(joined, 'done-gate').slice(0, 50), 'the earlier group is cut from its end').toBe(D.slice(0, 50));
    expect(joined.denies).toHaveLength(2);
    expect(joined.denies.find((d) => d.extension === 'zeta-notes')?.reason).toBe('zeta: not on main');
  });

  it('AC8 the reply schema names the join order and the bound', () => {
    const joined = joinHookReplies(contributions, 700) as unknown as JsonValue;
    expectAccepted(validate('hook.joined@1', joined), 'joined reply');
    expectRefused(validate('hook.joined@1', deleteAt(joined, '/order')), '/order', 'joined reply without its order');
    expectRefused(validate('hook.joined@1', deleteAt(joined, '/bound')), '/bound', 'joined reply without its bound');
  });

  it('AC8 the total context bound is set from the hook\'s time budget', () => {
    const small = contextBoundFor(50);
    const large = contextBoundFor(5000);
    expect(Number.isInteger(small) && small > 0).toBe(true);
    expect(large).toBeGreaterThan(small);
    expect(contextBoundFor(500)).toBeGreaterThanOrEqual(small);
    expect(contextBoundFor(500)).toBeLessThanOrEqual(large);
  });

  it('AC8 the reply line deep-hook prints has its own schema', () => {
    expectAccepted(validate('hook.reply@1', fixture('hook', 'reply-allow.json')), 'reply allow');
    expectAccepted(validate('hook.reply@1', fixture('hook', 'reply-deny.json')), 'reply deny');
    expectRefused(validate('hook.reply@1', deleteAt(fixture('hook', 'reply-allow.json'), '/exit')), '/exit', 'reply without exit');
  });
});
