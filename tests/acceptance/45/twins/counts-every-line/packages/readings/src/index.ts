// Planted wrong program (#45): every line with usage counts, so repeated content blocks and a resume count again.
export * from './impl.js';
import { readFileSync } from 'node:fs';
import { countUsage as realCountUsage } from './impl.js';

export function countUsage(...args: Parameters<typeof realCountUsage>): ReturnType<typeof realCountUsage> {
  const read = realCountUsage(...args);
  const totals = { ...read.totals, input: 0, output: 0, cache_write: 0, cache_read: 0 };
  for (const path of args[0]) {
    for (const raw of readFileSync(path, 'utf8').split('\n')) {
      let line: { message?: { usage?: { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number } } };
      try { line = JSON.parse(raw) as typeof line; } catch { continue; }
      const usage = line.message?.usage;
      if (!usage) continue;
      totals.input += usage.input_tokens;
      totals.output += usage.output_tokens;
      totals.cache_write += usage.cache_creation_input_tokens;
      totals.cache_read += usage.cache_read_input_tokens;
    }
  }
  return { ...read, totals };
}
