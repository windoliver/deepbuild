// Tokens by Claude Code's rules (adapters/claude-code.facts.json): a message's usage, repeated across its content blocks,
// across a resume's replayed lines and across files, counts once by its id; a turn whose usage never came reads unknown.
import { readFileSync } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Cost } from './types.js';

export interface Tokens { input: number; output: number; cache_write: number; cache_read: number }
/** `cache_write`'s two parts, by the lifetime each record's own split gives; what is left of it came with no split. */
export interface Split extends Tokens { cache_write_5m: number; cache_write_1h: number }
/**
 * USD per million tokens; `cache_write` is the five-minute write's price and `cache_write_1h` the one-hour write's. A
 * model is priced by its exact name, or that name with a `-<date>` after it; any other model is unpriced, and so is a
 * model whose row lacks either write price, so no write is ever priced by the other kind's.
 */
export interface RateCard { name: string; models: Record<string, { input: number; output: number; cache_write?: number; cache_write_1h?: number; cache_read: number }> }
export interface UsageCount { totals: Split & { unknown_turns: number }; turns: { turn: string; usage: Tokens | null }[]; cost: Cost }

const price = (input: number, output: number, cache_write: number, cache_write_1h: number, cache_read: number) => ({ input, output, cache_write, cache_write_1h, cache_read });
const OPUS_41 = price(15, 75, 18.75, 30, 1.5);
const OPUS_45 = price(5, 25, 6.25, 10, 0.5);
const SONNET_4 = price(3, 15, 3.75, 6, 0.3);
const MYTHOS = price(10, 50, 12.5, 20, 1);
const MYTHOS_51 = price(10, 50, 12.5, 20, 0.25);
/**
 * Anthropic's list prices, from the table ccusage reads (LiteLLM's), as it stood on 2026-10-30. The write prices are
 * its prompt caching page's two, read on 2026-11-22: five minutes at 1.25 times the input price, one hour at 2 times.
 */
const SHIPPED_RATE_CARD: RateCard = {
  name: 'anthropic-list-2026-10',
  models: {
    'claude-fable-5': MYTHOS, 'claude-fable-5-1': MYTHOS_51, 'claude-mythos-5': MYTHOS, 'claude-mythos-5-1': MYTHOS_51,
    'claude-opus-5-5': price(4, 20, 5, 8, 0.2), 'claude-opus-5': OPUS_45,
    'claude-sonnet-5-5': price(2, 10, 2.5, 4, 0.1), 'claude-sonnet-5': price(2, 10, 2.5, 4, 0.2),
    'claude-haiku-5-5': price(0.1, 0.5, 0.125, 0.2, 0.01),
    'claude-opus-4-8': OPUS_45, 'claude-opus-4-7': OPUS_45, 'claude-opus-4-6': OPUS_45, 'claude-opus-4-5': OPUS_45,
    'claude-opus-4-1': OPUS_41, 'claude-opus-4': OPUS_41,
    'claude-sonnet-4-6': SONNET_4, 'claude-sonnet-4-5': SONNET_4, 'claude-sonnet-4': SONNET_4, 'claude-3-7-sonnet': SONNET_4,
    'claude-haiku-4-5': price(1, 5, 1.25, 2, 0.1), 'claude-3-5-haiku': price(0.8, 4, 1, 1.6, 0.08),
  },
};
const priceOf = (card: RateCard, model: string): RateCard['models'][string] | undefined => card.models[model] ?? card.models[model.replace(/-\d{8}$/, '')];
const empty = (): Split => ({ input: 0, output: 0, cache_write: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0 });
const add = (to: Tokens, t: Tokens): void => { to.input += t.input; to.output += t.output; to.cache_write += t.cache_write; to.cache_read += t.cache_read; };
const addSplit = (to: Split, t: Split): void => { add(to, t); to.cache_write_5m += t.cache_write_5m; to.cache_write_1h += t.cache_write_1h; };
/** Whether a row can price a model's tokens: it holds both write prices, whichever kinds the tokens wrote. */
const prices = (p: RateCard['models'][string]): p is Required<RateCard['models'][string]> => typeof p.cache_write === 'number' && typeof p.cache_write_1h === 'number';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const whole = (v: unknown): number => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0);
/** A line a person or the agent's harness wrote that begins a turn: never a tool's result, a command's echo or a harness note. */
export function beginsTurn(e: Obj, message: Obj): boolean {
  if (e.toolUseResult !== undefined || e.isMeta === true || e.isCompactSummary === true) return false;
  const { content } = message;
  if (Array.isArray(content)) return !content.some((c) => isObj(c) && c.type === 'tool_result');
  return !(typeof content === 'string' && /^<(command-|local-command-|bash-|task-notification)/.test(content));
}
interface Turn { turn: string; usage: Tokens; unknown: boolean; replied: boolean }

/** Folds a transcript's lines, in any number of files, into message-level counts. */
class Counter {
  private readonly seen = new Set<string>();
  readonly models = new Map<string, Split>();
  readonly totals = empty();
  private readonly turns = new Map<string, Turn>();
  private current: Turn | undefined;
  start(): void { this.current = undefined; }
  line(text: string): void {
    if (!text.trim()) return;
    let e: unknown;
    // A torn line is the crash the turn died in.
    try { e = JSON.parse(text); } catch { if (this.current) this.current.unknown = true; return; }
    if (!isObj(e) || !isObj(e.message)) return;
    if (e.type === 'user') {
      if (!beginsTurn(e, e.message) || typeof e.uuid !== 'string') return;
      // A replayed line is the turn it was, with what it already counted.
      this.current = this.turns.get(e.uuid) ?? { turn: e.uuid, usage: { input: 0, output: 0, cache_write: 0, cache_read: 0 }, unknown: false, replied: false };
      this.turns.set(e.uuid, this.current);
    } else if (e.type === 'assistant' && e.message.model !== '<synthetic>') {
      if (this.current) this.current.replied = true;
      const { id, usage, model } = e.message;
      if (!isObj(usage)) { if (this.current) this.current.unknown = true; return; }
      if (typeof id !== 'string' || this.seen.has(id)) return;
      this.seen.add(id);
      // The write total stays the record's own; its split is counted only as far as that total holds it.
      const cache_write = whole(usage.cache_creation_input_tokens);
      const split = isObj(usage.cache_creation) ? usage.cache_creation : {};
      const cache_write_1h = Math.min(whole(split.ephemeral_1h_input_tokens), cache_write);
      const cache_write_5m = Math.min(whole(split.ephemeral_5m_input_tokens), cache_write - cache_write_1h);
      const t: Split = { input: whole(usage.input_tokens), output: whole(usage.output_tokens), cache_write, cache_write_5m, cache_write_1h, cache_read: whole(usage.cache_read_input_tokens) };
      addSplit(this.totals, t);
      const name = typeof model === 'string' ? model : 'unknown';
      addSplit(this.models.get(name) ?? (this.models.set(name, empty()), this.models.get(name)!), t);
      if (this.current) add(this.current.usage, t);
    }
  }
  /** A turn's usage is known only if a reply came and none of its lines lost theirs. */
  list(): { turn: string; usage: Tokens | null }[] {
    return [...this.turns.values()].map((t) => ({ turn: t.turn, usage: t.unknown || !t.replied ? null : t.usage }));
  }
  cost(card: RateCard): Cost {
    let usd = 0, unsplit = 0;
    if (!this.models.size) return { basis: 'unpriced' };
    for (const [model, t] of this.models) {
      const p = priceOf(card, model);
      // A write no split names is priced as a five-minute one, the least it can have cost.
      const five = t.cache_write - t.cache_write_1h;
      if (!p || !prices(p)) return { basis: 'unpriced' };
      usd += (t.input * p.input + t.output * p.output + five * p.cache_write + t.cache_write_1h * p.cache_write_1h + t.cache_read * p.cache_read) / 1e6;
      unsplit += t.cache_write - t.cache_write_5m - t.cache_write_1h;
    }
    return { basis: 'estimated', usd, rate_card: card.name, ...(unsplit ? { at_least: true as const } : {}) };
  }
}

/** Claude Code JSONL, as texts: what the paths and the baseline's archived bytes both count. */
export function countTexts(texts: readonly string[], options: { rateCard?: RateCard } = {}): UsageCount {
  const counter = new Counter();
  for (const text of texts) {
    counter.start();
    for (const line of text.split('\n')) counter.line(line);
  }
  const turns = counter.list();
  return { totals: { ...counter.totals, unknown_turns: turns.filter((t) => t.usage === null).length }, turns, cost: counter.cost(options.rateCard ?? SHIPPED_RATE_CARD) };
}
export function countUsage(paths: string[], options: { rateCard?: RateCard } = {}): UsageCount {
  return countTexts(paths.map((p) => readFileSync(p, 'utf8')), options);
}

/**
 * A live session's running count: each file read from where the last read ended, so a stop costs its new bytes, not
 * the whole transcript. The subagents' files beside the transcript count with it.
 */
export class UsageTail {
  private readonly counter = new Counter();
  private readonly files = new Map<string, number>();
  async read(transcript: string): Promise<{ tokens: Split; cost: Cost; model: string | null }> {
    const folder = join(transcript.replace(/\.jsonl$/, ''), 'subagents');
    const subs = await readdir(folder).catch(() => [] as string[]);
    for (const path of [transcript, ...subs.filter((n) => n.endsWith('.jsonl')).map((n) => join(folder, n))]) await this.feed(path);
    const models = [...this.counter.models.entries()].sort((a, b) => b[1].output - a[1].output);
    return { tokens: { ...this.counter.totals }, cost: this.counter.cost(SHIPPED_RATE_CARD), model: models[0]?.[0] ?? null };
  }
  private async feed(path: string): Promise<void> {
    const file = await open(path, 'r').catch(() => undefined);
    if (!file) return;
    try {
      const at = this.files.get(path) ?? 0;
      const { size } = await file.stat();
      if (size <= at) return;
      const buffer = Buffer.alloc(size - at);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, at);
      if (!bytesRead) return;
      // A line not yet whole waits for the next read, cut in bytes, so a character the read split is never torn.
      const end = buffer.lastIndexOf(10, bytesRead - 1);
      if (end < 0) return;
      this.counter.start();
      for (const line of buffer.subarray(0, end).toString('utf8').split('\n')) this.counter.line(line);
      this.files.set(path, at + end + 1);
    } finally {
      await file.close();
    }
  }
}
