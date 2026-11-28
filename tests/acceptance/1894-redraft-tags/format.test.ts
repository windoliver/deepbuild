import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { TranscriptReader, Turn } from '../../../packages/record/src/index.ts';
import { archive, cleanup, jsonl, learn, openReader, openWorld, REPO, rowOf, type World } from '../1894/helpers.ts';

afterAll(cleanup);

const AGENT = 'tallowmere';
type Line = { tm?: string; no?: string; who?: string; words?: string; tool?: string; for?: string; bad?: boolean };
const isLine = (v: unknown): v is Line => typeof v === 'object' && v !== null && !Array.isArray(v) && typeof (v as Line).tm === 'string';

const tallowmere: TranscriptReader = {
  start() {
    const calls = new Map<string, string>();
    return (line: unknown, n: number): Turn | undefined => {
      if (!isLine(line) || typeof line.words !== 'string') return undefined;
      const id = line.no ?? `n${n}`;
      if (line.tm === 'say') return line.who === 'person' ? { id, text: line.words, outside: false, role: 'user' } : { id, text: line.words, outside: true, role: 'assistant' };
      if (line.tm === 'call' && typeof line.tool === 'string') {
        calls.set(id, line.tool);
        return { id, text: line.words, outside: true, role: 'assistant' };
      }
      if (line.tm === 'result' && typeof line.for === 'string') {
        const tool = calls.get(line.for) ?? '';
        return { id, text: line.words, outside: tool !== 'disk', role: 'user', tool, ...(calls.has(line.for) ? { of: line.for } : {}), error: line.bad === true };
      }
      return undefined;
    };
  },
};
const silent: TranscriptReader = { start: () => () => undefined };
const greedy: TranscriptReader = { start: () => (line: unknown, n: number) => ({ id: isLine(line) && line.no ? line.no : `n${n}`, text: 'greedy words', outside: false, role: 'user' }) };

const TRANSCRIPT = [
  { tm: 'head', format: 1, agent: AGENT },
  { tm: 'say', no: 't1', who: 'person', words: 'the ledger closes at midnight UTC' },
  { tm: 'say', no: 't2', who: 'agent', words: 'I think the ledger closes at noon' },
  { tm: 'call', no: 't3', tool: 'disk', words: 'cat config/ledger.toml' },
  { tm: 'result', no: 't4', for: 't3', words: 'close_at = "00:00Z"', bad: false },
  { tm: 'say', who: 'person', words: 'refunds settle within two days' },
];
const OTHER = [{ tm: 'result', no: 'u1', for: 't3', words: 'close_at = "12:00Z"' }];

const EXPECTED = [
  { id: 't1', text: 'the ledger closes at midnight UTC', outside: false, role: 'user' },
  { id: 't2', text: 'I think the ledger closes at noon', outside: true, role: 'assistant' },
  { id: 't3', text: 'cat config/ledger.toml', outside: true, role: 'assistant' },
  { id: 't4', text: 'close_at = "00:00Z"', outside: false, role: 'user', tool: 'disk', of: 't3', error: false },
  { id: 'n5', text: 'refunds settle within two days', outside: false, role: 'user' },
];

async function world(readers: readonly TranscriptReader[]): Promise<{ w: World; S: string; O: string }> {
  const w = await openWorld(readers);
  const S = await archive(w, AGENT, jsonl(TRANSCRIPT));
  const O = await archive(w, AGENT, jsonl(OTHER));
  return { w, S, O };
}

describe('AC2 #1894: a transcript format added in a test adapter is learned from with no edit under packages/record', () => {
  it('AC2 #1894.93152973 a learned change quoting a turn of the new format is in force; one quoting words the turn lacks is refused', async () => {
    const { w, S } = await world([tallowmere]);
    const quoted = await learn(w, { layer: 'learned', target: 'slice:ledger', at: `session:${S}#t1`, quote: 'closes at midnight' });
    const lineNamed = await learn(w, { layer: 'learned', target: 'slice:refunds', at: `session:${S}#n5`, quote: 'settle within two days' });
    const ruled = await learn(w, { layer: 'base', target: 'rule:ledger', at: `session:${S}#t1`, quote: 'midnight UTC' });
    const wrong = await learn(w, { layer: 'learned', target: 'slice:ledger-noon', at: `session:${S}#t1`, quote: 'closes at noon' });
    const agents = await learn(w, { layer: 'learned', target: 'slice:ledger-agent', at: `session:${S}#t2`, quote: 'closes at noon' });
    const fromDisk = await learn(w, { layer: 'learned', target: 'slice:ledger-config', at: `session:${S}#t4`, quote: 'close_at = "00:00Z"' });
    expect(await rowOf(w, quoted), 'the quote is in the person\'s turn t1').toMatchObject({ state: 'applied', reason: null });
    expect(await rowOf(w, lineNamed), 'a turn named by its line number').toMatchObject({ state: 'applied', reason: null });
    expect(await rowOf(w, ruled), 'a rule you typed, quoting t1').toMatchObject({ state: 'applied', reason: null });
    expect(await rowOf(w, fromDisk), 'a disk read\'s result is a first-hand source').toMatchObject({ state: 'applied', reason: null });
    const refused = await rowOf(w, wrong);
    expect(refused?.state).toBe('refused');
    expect(String(refused?.reason)).toContain(`session:${S}#t1`);
    expect(await rowOf(w, agents), 'the agent\'s own words are no first-hand source').toMatchObject({ state: 'refused' });
    expect(JSON.stringify(await w.record.startSlice(S))).toContain('closes at midnight');
    await w.record.close();
  });

  it('AC2 #1894.93152973 the record and its reader resolve the new format\'s handles and give its turns, a reader started for each transcript', async () => {
    const { w, S, O } = await world([tallowmere]);
    expect(await w.record.resolve(`session:${S}#t1`)).toMatchObject({ text: 'the ledger closes at midnight UTC', outside: false, role: 'user' });
    expect(await w.record.transcript(S)).toEqual(EXPECTED);
    expect(await w.record.resolve(`session:${O}#u1`), 'the call t3 is in another transcript').toMatchObject({ text: 'close_at = "12:00Z"', outside: true, tool: '' });
    expect(await w.record.resolve(`session:${S}#n0`)).toBeUndefined();
    await w.record.close();
    const reader = openReader(w, [tallowmere]);
    try {
      expect(await reader.resolve(`session:${S}#t4`)).toMatchObject({ text: 'close_at = "00:00Z"', outside: false, tool: 'disk', of: 't3', error: false });
      expect(await reader.transcript(S)).toEqual(EXPECTED);
      expect(await reader.resolve(`session:${O}#u1`)).toMatchObject({ outside: true, tool: '' });
    } finally {
      reader.close();
    }
  });

  it('AC2 #1894.93152973 for each line the first reader that returns a turn names it', async () => {
    const { w, S } = await world([silent, tallowmere, greedy]);
    expect(await w.record.resolve(`session:${S}#t1`)).toMatchObject({ text: 'the ledger closes at midnight UTC', outside: false });
    expect(await w.record.resolve(`session:${S}#n0`), 'the head line, which tallowmere passes over').toMatchObject({ text: 'greedy words' });
    await w.record.close();
  });

  it('with no readers the record reads no turn of the new format', async () => {
    const { w, S } = await world([]);
    expect(await w.record.resolve(`session:${S}#t1`)).toBeUndefined();
    const quoted = await learn(w, { layer: 'learned', target: 'slice:ledger', at: `session:${S}#t1`, quote: 'closes at midnight' });
    expect(await rowOf(w, quoted)).toMatchObject({ state: 'refused' });
    await w.record.close();
  });

  it('nothing under packages/record names the new format', () => {
    const named: string[] = [];
    const walk = (at: string): void => {
      for (const name of readdirSync(at)) {
        if (name === 'node_modules') continue;
        const full = join(at, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/tallowmere/i.test(readFileSync(full, 'utf8'))) named.push(full);
      }
    };
    walk(join(REPO, 'packages', 'record'));
    expect(named).toEqual([]);
  });
});
