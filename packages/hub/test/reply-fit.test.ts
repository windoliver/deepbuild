// #2896: what reply-fit holds a reply and a refusal to, on the paths the acceptance suite doesn't drive — a nested
// missing_field's schema and remediation, where Codex's error characters come from, and a call asked once.
import { describe, expect, it } from 'vitest';
import { fitted, limitOf, refusalFits } from '../src/reply-fit.js';

const big = (n: number) => ({ type: 'string', description: 'x'.repeat(n) });

describe('refusalFits', () => {
  const refusal = {
    code: 'missing_field',
    path: '/params/arguments/document/nodes/0/kind',
    remediation: "Give kind: the call leaves it out, and the tool requires it. schema is the tool's input schema.",
    actual: '',
    schema: { type: 'object', properties: { document: big(2_000), kind: big(10), other: big(12_000) } },
  };

  it('keeps the top-level argument a nested path fails under', async () => {
    const out = await refusalFits(refusal, { chars: 8_800 });
    expect(Object.keys((out.schema as { properties: object }).properties)).toEqual(['document']);
  });

  it('replaces the whole-schema sentence rather than contradicting it', async () => {
    const out = await refusalFits(refusal, { chars: 8_800 });
    expect(out.remediation).not.toContain("schema is the tool's input schema");
    expect(out.remediation).toContain('Give kind: the call leaves it out, and the tool requires it.');
    expect(out.remediation).toContain('tools/list');
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(8_800);
  });
});

describe('limitOf', () => {
  it("names where Codex's error characters came from", () => {
    const limit = limitOf({ name: 'codex-mcp-client', version: '0.160.0' });
    expect(limit.error.chars).toBe(11_000);
    expect(limit.from).toContain('claude-code.facts.json');
  });
});

describe('fitted', () => {
  it('asks a call that may change something once, with a tighter first room', async () => {
    const rooms: number[] = [];
    await fitted({ tokens: 8_000 }, () => ({ tokens: 8_000 }), false, async (room) => {
      rooms.push(room);
      return { rows: 'y'.repeat(100_000) };
    });
    expect(rooms).toEqual([12_000]);
  });

  it('asks a read again with less room while it is over', async () => {
    const rooms: number[] = [];
    await fitted({ chars: 10_000 }, () => ({ chars: 10_000 }), true, async (room) => {
      rooms.push(room);
      return { rows: 'y'.repeat(Math.floor(room * 1.2)) };
    });
    expect(rooms[0]).toBe(10_000);
    expect(rooms.length).toBeGreaterThan(1);
    expect(rooms[1]!).toBeLessThan(rooms[0]!);
  });
});
