// The pilot baseline, recomputed from archived transcripts named by window and hash. A number that can't be recomputed
// reads missing, whatever a doc says it was. The script and its output are returned to be kept as evidence, by hash.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isItDone } from './classify.js';
import { countTexts } from './usage.js';

export interface BaselineMeasure { id: string; kind: string; window: { from: number; to: number }; transcripts: { sha256: string }[]; copied_from_doc?: number }
export interface BaselineMeasureResult { id: string; window: { from: number; to: number }; transcripts: string[]; value: number | null; status: 'recomputed' | 'missing' }
export interface BaselineResult {
  baseline_sha256: string;
  script: { sha256: string; text: string };
  output: { sha256: string; text: string };
  measures: BaselineMeasureResult[];
}
const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const kept = (text: string) => ({ sha256: sha256(text), text });

/** The lines inside a window: a line with no time of its own stays with the file. */
function inWindow(text: string, window: { from: number; to: number }): string {
  return text.split('\n').filter((line) => {
    const at = /"timestamp":"([^"]+)"/.exec(line)?.[1];
    const ms = at ? Date.parse(at) : NaN;
    return Number.isNaN(ms) || (ms >= window.from && ms < window.to);
  }).join('\n');
}
/** A person's messages in a transcript, for the classifier. */
function typed(text: string): string[] {
  return text.split('\n').flatMap((line) => {
    try {
      const e = JSON.parse(line) as { type?: string; toolUseResult?: unknown; message?: { content?: unknown } };
      return e.type === 'user' && e.toolUseResult === undefined && typeof e.message?.content === 'string' ? [e.message.content] : [];
    } catch { return []; }
  });
}
function count(kind: string, texts: string[]): number | null {
  // A window that catches nothing was named wrong or never archived: that's missing, never a measured zero.
  if (!texts.some((t) => t.trim())) return null;
  if (kind === 'tokens.total') {
    const t = countTexts(texts).totals;
    return t.input + t.output + t.cache_write + t.cache_read;
  }
  if (kind === 'is_it_done') return texts.flatMap(typed).filter(isItDone).length;
  return null;
}

export function recomputeBaseline(input: { baseline_sha256: string; measures: BaselineMeasure[]; archive: (sha256: string) => Uint8Array | null }): BaselineResult {
  const measures = input.measures.map((m): BaselineMeasureResult => {
    const hashes = m.transcripts.map((t) => t.sha256);
    const bytes = hashes.map((h) => { const b = input.archive(h); return b && sha256(b) === h ? b : null; });
    const value = !hashes.length || bytes.includes(null) ? null : count(m.kind, bytes.map((b) => inWindow(Buffer.from(b!).toString('utf8'), m.window)));
    return { id: m.id, window: m.window, transcripts: hashes, value, status: value === null ? 'missing' : 'recomputed' };
  });
  const output = measures.map((m) => JSON.stringify({ baseline: input.baseline_sha256, id: m.id, value: m.value ?? 'missing', window: m.window, transcripts: m.transcripts })).join('\n');
  // The script is the code that counted, read from where it ran.
  const script = ['./baseline', './usage', './classify'].map((f) => readFileSync(fileURLToPath(new URL(`${f}${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`, import.meta.url)), 'utf8')).join('\n');
  return { baseline_sha256: input.baseline_sha256, script: kept(script), output: kept(`${output}\n`), measures };
}
