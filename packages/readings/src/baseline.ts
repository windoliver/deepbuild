// The pilot baseline, recomputed from archived transcripts named by window and hash. A number that can't be recomputed
// reads missing, whatever a doc says it was. The script and its output are returned to be kept as evidence, by hash.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isItDone, isRework } from './classify.js';
import { beginsTurn, countTexts } from './usage.js';

/** A window's ends are times in ms or dates. */
export interface BaselineMeasure { id: string; kind: string; window: { from: number | string; to: number | string }; transcripts: { sha256: string }[]; copied_from_doc?: number }
export interface BaselineMeasureResult { id: string; window: { from: number; to: number }; transcripts: string[]; value: number | null; status: 'recomputed' | 'missing'; why?: string }
export interface BaselineResult {
  baseline_sha256: string;
  script: { sha256: string; text: string };
  output: { sha256: string; text: string };
  measures: BaselineMeasureResult[];
}
const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const kept = (text: string) => ({ sha256: sha256(text), text });

const timeOf = (line: string): number => {
  const at = /"timestamp":"([^"]+)"/.exec(line)?.[1];
  return at ? Date.parse(at) : NaN;
};
/** The lines inside a window: a line with no time of its own stays with the file. */
function inWindow(text: string, window: { from: number; to: number }): string {
  return text.split('\n').filter((line) => {
    const ms = timeOf(line);
    return Number.isNaN(ms) || (ms >= window.from && ms < window.to);
  }).join('\n');
}
/** A person's messages in a transcript, for the classifier: never a subagent's prompt, a summary or a harness note. */
function typed(text: string, seen: Set<string>): string[] {
  return text.split('\n').flatMap((line) => {
    try {
      const e = JSON.parse(line) as { type?: string; uuid?: unknown; isSidechain?: unknown; message?: { content?: unknown } };
      if (e.type !== 'user' || e.isSidechain === true || !e.message || !beginsTurn(e as Record<string, unknown>, e.message as Record<string, unknown>)) return [];
      // A resume replays its lines, in this file or another.
      if (typeof e.uuid === 'string') { if (seen.has(e.uuid)) return []; seen.add(e.uuid); }
      const { content } = e.message;
      if (typeof content === 'string') return [content];
      return Array.isArray(content) ? [content.flatMap((c: { type?: unknown; text?: unknown }) => (c.type === 'text' && typeof c.text === 'string' ? [c.text] : [])).join('\n')] : [];
    } catch { return []; }
  });
}
/** Whether a transcript is in the shape this counts, Claude Code's; another agent's would read as a measured zero. */
const counted = (text: string): boolean => text.split('\n').some((line) => {
  try {
    const e = JSON.parse(line) as { type?: unknown; message?: unknown };
    return (e.type === 'user' || e.type === 'assistant') && typeof e.message === 'object' && e.message !== null;
  } catch { return false; }
});
const CLASSIFIERS: Record<string, (text: string) => boolean> = { is_it_done: isItDone, rework: isRework };
function count(kind: string, whole: string[], window: { from: number; to: number }): number | null {
  // A window that catches nothing was named wrong or never archived: that's missing, never a measured zero. A transcript
  // with no times at all can only be counted whole.
  if (!whole.every(counted)) return null;
  const lines = whole.flatMap((t) => t.split('\n').filter((l) => l.trim()));
  const times = lines.map(timeOf).filter((ms) => !Number.isNaN(ms));
  if (!lines.length || (times.length && !times.some((ms) => ms >= window.from && ms < window.to))) return null;
  const texts = whole.map((t) => inWindow(t, window));
  if (kind === 'tokens.total') {
    const t = countTexts(texts).totals;
    return t.input + t.output + t.cache_write + t.cache_read;
  }
  const classifier = CLASSIFIERS[kind];
  if (classifier) {
    const seen = new Set<string>();
    return texts.flatMap((t) => typed(t, seen)).filter(classifier).length;
  }
  return null;
}

export function recomputeBaseline(input: { baseline_sha256: string; measures: BaselineMeasure[]; archive: (sha256: string) => Uint8Array | null }): BaselineResult {
  const measures = input.measures.map((m): BaselineMeasureResult => {
    const hashes = m.transcripts.map((t) => t.sha256);
    const bytes = hashes.map((h) => { const b = input.archive(h); return b && sha256(b) === h ? b : null; });
    const ms = (v: number | string): number => (typeof v === 'string' ? Date.parse(v) : v);
    const window = { from: ms(m.window.from), to: ms(m.window.to) };
    const lost = hashes.find((_, i) => bytes[i] === null);
    const value = !hashes.length || lost !== undefined ? null : count(m.kind, bytes.map((b) => Buffer.from(b!).toString('utf8')), window);
    if (value !== null) return { id: m.id, window, transcripts: hashes, value, status: 'recomputed' };
    const why = !hashes.length ? 'it names no transcript' : lost !== undefined ? `transcript ${String(lost)} isn't in the archive with that hash` : `its kind ${m.kind} can't be counted, or a transcript isn't Claude Code's or has nothing in the window`;
    return { id: m.id, window, transcripts: hashes, value, status: 'missing', why };
  });
  const output = measures.map((m) => JSON.stringify({ baseline: input.baseline_sha256, id: m.id, value: m.value ?? 'missing', window: m.window, transcripts: m.transcripts })).join('\n');
  // The script is the code that counted, read from where it ran.
  const script = ['./baseline', './usage', './classify'].map((f) => readFileSync(fileURLToPath(new URL(`${f}${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`, import.meta.url)), 'utf8')).join('\n');
  return { baseline_sha256: input.baseline_sha256, script: kept(script), output: kept(`${output}\n`), measures };
}
