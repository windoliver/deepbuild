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

  it("cuts a canvas refusal's issues to fit, saying how many it shows", async () => {
    const issues = Array.from({ length: 150 }, (_, i) => ({ code: 'bad_item', path: `/document/nodes/${i}/params/value`, message: 'y'.repeat(40) }));
    const out = await refusalFits({ outcome: 'refused', code: 'invalid', issues, truncated: { shown: 150, total: 400, by_code: { bad_item: 400 } } }, { chars: 8_800 });
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(8_800);
    const shown = (out.issues as unknown[]).length;
    expect(shown).toBeGreaterThan(0);
    expect(out.truncated).toEqual({ shown, total: 400, by_code: { bad_item: 400 } });
  });

  it('counts each code of the issues it cuts when the canvas core cut none', async () => {
    const issues = Array.from({ length: 150 }, (_, i) => ({ code: i % 3 ? 'bad_item' : 'unknown_kind', path: `/document/nodes/${i}`, message: 'y'.repeat(40) }));
    const out = await refusalFits({ outcome: 'refused', code: 'invalid', issues }, { chars: 8_800 });
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(8_800);
    expect(out.truncated).toEqual({ shown: (out.issues as unknown[]).length, total: 150, by_code: { bad_item: 100, unknown_kind: 50 } });
  });

  // Texts whose pieces, cut where the count cuts them, count one and two tokens fewer than the whole: a cap one under
  // the whole count must still be passed.
  it.each([
    ['one', ('}1} the}}{.b' + 'z'.repeat(2_036)).repeat(4)],
    ['two', 'z'.repeat(2_020) + 'r=redstxtionerssqrt' + 'ionaun reres'],
  ])('counts no fewer tokens than the whole where a cut loses %s', async (_, text) => {
    const { countTokens } = await import('gpt-tokenizer/encoding/o200k_base');
    const whole = countTokens(JSON.stringify({ text }));
    const rooms: number[] = [];
    await fitted({ cap: { tokens: whole - 1 }, error_cap: {} }, () => false, true, async (room) => { rooms.push(room); return rooms.length === 1 ? { text } : {}; });
    expect(rooms.length).toBe(2);
  });
});

describe('an error as Codex receives it', () => {
  // Codex 0.144.0 (codex-rs/protocol/src/models.rs, core/src/tools/context.rs): an error carries no structuredContent, so
  // its body is the content array JSON-encoded, the refusal's text escaped once more, after a "Wall time" header.
  const codexBytes = (refusal: object) =>
    Buffer.byteLength(`Wall time: 0.1 seconds\nOutput:\n${JSON.stringify([{ type: 'text', text: JSON.stringify(refusal) }])}`);

  it("holds a quote-dense, non-ASCII refusal to Codex 0.144.0's 10,000 bytes as Codex counts them", async () => {
    const limit = limitOf({ name: 'codex-mcp-client', version: '0.144.0' });
    const refusal = { code: 'type', path: '/params/arguments/label', remediation: 'Give label a string.', actual: '"—"'.repeat(5_000) };
    const out = await refusalFits(refusal, limit.error_cap);
    expect(codexBytes(out)).toBeLessThanOrEqual(limit.error.bytes!);
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
    await fitted({ cap: { tokens: 8_000 }, error_cap: {} }, () => false, false, async (room) => {
      rooms.push(room);
      return { rows: 'y'.repeat(100_000) };
    });
    expect(rooms).toEqual([12_000]);
  });

  it('asks a read again with less room while it is over', async () => {
    const rooms: number[] = [];
    await fitted({ cap: { chars: 10_000 }, error_cap: {} }, () => false, true, async (room) => {
      rooms.push(room);
      return { rows: 'y'.repeat(Math.floor(room * 1.2)) };
    });
    expect(rooms[0]).toBe(10_000);
    expect(rooms.length).toBeGreaterThan(1);
    expect(rooms[1]!).toBeLessThan(rooms[0]!);
  });
});
