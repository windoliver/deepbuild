// #45 AC1: the pilot baseline, recomputed from archived transcripts named by their window and hash, with the counting
// script and its output kept as evidence; a number that can't be recomputed reads missing, never a figure copied from a
// doc. Logic on the committed fixture transcripts, whose tokens are counted by hand (README, The fixture). The real pilot
// baseline stays private: its test reads it only when you name it, and is BLOCKED otherwise.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { recomputeBaseline } from '../../../packages/readings/src/index.ts';

const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const DIR = fileURLToPath(new URL('./fixtures/claude/projects/-work-shop/', import.meta.url));
const FILES = ['11111111-1111-4111-8111-111111111111.jsonl', '11111111-1111-4111-8111-111111111111/subagents/agent-a1.jsonl', '22222222-2222-4222-8222-222222222222.jsonl'];
const bytes = new Map(FILES.map((f) => { const b = readFileSync(join(DIR, f)); return [sha256(b), b] as const; }));
const HASHES = [...bytes.keys()];
const WINDOW = { from: Date.UTC(2026, 8, 14), to: Date.UTC(2026, 8, 15) };
const GONE = 'f'.repeat(64);
const BASELINE = 'b'.repeat(64);
const input = (archive: (sha: string) => Uint8Array | null = (sha) => bytes.get(sha) ?? null) => ({
  baseline_sha256: BASELINE,
  measures: [
    { id: 'tokens.pilot', kind: 'tokens.total', window: WINDOW, transcripts: HASHES.map((sha256) => ({ sha256 })), copied_from_doc: 999_999 },
    { id: 'tokens.lost', kind: 'tokens.total', window: WINDOW, transcripts: [{ sha256: GONE }], copied_from_doc: 777_777 },
  ],
  archive,
});

describe('AC1 the pilot baseline is recomputed', () => {
  it('#45.3f3734f8 AC1 a measure whose archived transcripts are all there is recomputed by hand count: 5,190 tokens, not the 999,999 the doc says, named by its window and hashes', () => {
    const result = recomputeBaseline(input());
    const measure = result.measures.find((m) => m.id === 'tokens.pilot');
    expect(measure?.status, 'its transcripts are all in the archive').toBe('recomputed');
    expect(measure?.value, '635 input + 195 output + 1,160 cache writes + 3,200 cache reads').toBe(5190);
    expect(measure?.window).toEqual(WINDOW);
    expect(measure?.transcripts).toEqual(HASHES);
    expect(result.baseline_sha256).toBe(BASELINE);
  });

  it('#45.3f3734f8 AC1 a number that can\'t be recomputed reads missing, with no figure copied from the doc: a transcript gone from the archive, and one whose bytes no longer match their hash', () => {
    const gone = recomputeBaseline(input()).measures.find((m) => m.id === 'tokens.lost');
    expect(gone?.status, 'its transcript is not in the archive').toBe('missing');
    expect(gone?.value, 'never the 777,777 the doc says, and never zero').toBeNull();
    const tampered = recomputeBaseline(input((sha) => (bytes.has(sha) ? new TextEncoder().encode('{"type":"user"}\n') : null))).measures.find((m) => m.id === 'tokens.pilot');
    expect(tampered?.status, 'bytes that do not match the named hash are no recomputation').toBe('missing');
    expect(tampered?.value).toBeNull();
  });

  it('#45.3f3734f8 AC1 the counting script and its output are kept as evidence, each by the hash of its bytes, the output holding the recomputed number and "missing" for the other', () => {
    const result = recomputeBaseline(input());
    expect(result.script.text.length, 'the counting script itself').toBeGreaterThan(0);
    expect(result.script.sha256).toBe(sha256(result.script.text));
    expect(result.output.sha256).toBe(sha256(result.output.text));
    expect(result.output.text).toContain('tokens.pilot');
    expect(result.output.text).toContain('5190');
    expect(result.output.text).toContain('missing');
    expect(result.output.text, 'the doc figure is not in the output').not.toContain('777777');
    expect(recomputeBaseline(input()).output.sha256, 'a second run gives the same bytes').toBe(result.output.sha256);
  });

  it('#45.3f3734f8 AC1 the real pilot baseline, named by DEEP_PILOT_BASELINE (private, never committed), recomputes or reads missing', (ctx) => {
    const path = process.env.DEEP_PILOT_BASELINE;
    if (!path) { ctx.skip('BLOCKED: the private pilot baseline is yours; DEEP_PILOT_BASELINE names its manifest (README, Outside inputs)'); return; }
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as { baseline_sha256: string; archive_dir: string; measures: Parameters<typeof recomputeBaseline>[0]['measures'] };
    const result = recomputeBaseline({
      baseline_sha256: manifest.baseline_sha256, measures: manifest.measures,
      archive: (sha) => { try { return readFileSync(join(manifest.archive_dir, sha)); } catch { return null; } },
    });
    expect(result.measures.length, 'the manifest names measures').toBeGreaterThan(0);
    for (const m of result.measures) expect(m.status === 'recomputed' ? typeof m.value : m.value, `${m.id} is a number recomputed, or missing`).toBe(m.status === 'recomputed' ? 'number' : null);
  });
});
