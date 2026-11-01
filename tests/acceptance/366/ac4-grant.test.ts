// AC4: a sandboxed plug-in granted only content-free fields that passes a session handle to deep.runner.run is
// refused before any job starts, naming the grant, and nothing a job it starts finds gives it transcript text or a
// file the grant doesn't name (README, Readings: AC4). The stocks plug-in is installed with a record grant of every
// kind and no text. A session of yours is in the record with transcript text, and its transcript file is in your
// Claude Code folder; a notes file outside the grant sits in a temp folder. The wrong programs, each run on the real
// runner beside the same judge: a hub that passes the handle on unchecked, and one that hands the plug-in what the
// job found as the job gave it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { act, at, gotOf, home, ID, jobsOf, readPrice, seedSession, stocksWorld, tempDir, type Got } from './helpers.ts';
import { foundProblems, refusalProblems } from './judges.ts';

const SESSION = '5e55a0e0-3666-4000-8000-00000000c0de';
const HANDLE = `session:${SESSION}`;
/** Transcript text, and a file's text, that must never reach the plug-in. */
const TRANSCRIPT = 'dh366-transcript-marker-buy-the-dip';
const NOTES = 'dh366-notes-marker-private';
/** Only content-free fields: every kind, never text. */
const CONTENT_FREE = { record: ['*'] };

describe(`AC4 ${ID.ac4} A sandboxed plug-in granted only content-free fields that passes a session handle to \`deep.runner.run\` is refused before any job starts, naming the grant, and nothing a job it starts finds gives it transcript text or a file the grant doesn't name`, () => {
  it('AC4 a session handle passed to deep.runner.run is refused before any job starts, naming the handle and the grant', async () => {
    const s = await stocksWorld(at('2026-11-02T10:00'), CONTENT_FREE);
    await seedSession(s.w, SESSION, TRANSCRIPT);
    const got = gotOf(await act(s.h, 'ask', { prompt: '@answer {"value":"a summary of your session","cites":[]}', inputs: [HANDLE] }));
    expect(refusalProblems(got, HANDLE, await s.w.runner.list())).toEqual([]);
    expect(JSON.stringify(got), 'the refusal carries no transcript text').not.toContain(TRANSCRIPT);
  }, 180_000);

  it('AC4 (wrong program) a hub that passes the handle to the runner unchecked starts a job, and fails, naming the handle', async () => {
    const s = await stocksWorld(at('2026-11-02T10:00'), CONTENT_FREE);
    await seedSession(s.w, SESSION, TRANSCRIPT);
    // What the wrong hub does with the plug-in's call: the runner job, its inputs in its prompt, with no grant check.
    const rec = await s.w.runner.run({ kind: 'read', agent: 'claude-code', prompt: `${HANDLE}\n@answer {"value":"a summary of your session","cites":["${HANDLE}"]}`, deadline_ms: 120_000 });
    const problems = refusalProblems({ ok: true, answer: { handle: 'reading:01TWIN', value: rec.result, cites: [HANDLE], as_of: 0, stale_at: 0 } }, HANDLE, await s.w.runner.list());
    expect(problems.some((p) => p.startsWith('a job started') && p.includes(HANDLE)), JSON.stringify(problems)).toBe(true);
  }, 180_000);

  /** A job started on the plug-in's own price reading that tries your transcript and the notes file, and cites both. */
  async function found(price: string) {
    const munged = join(home(), '.claude', 'projects', '-tmp-dh366-session');
    mkdirSync(munged, { recursive: true });
    const transcript = join(munged, `${SESSION}.jsonl`);
    writeFileSync(transcript, `${JSON.stringify({ type: 'user', sessionId: SESSION, message: { role: 'user', content: TRANSCRIPT } })}\n`);
    const notes = join(tempDir('notes'), 'notes.txt');
    writeFileSync(notes, `${NOTES}\n`);
    const prompt = [`@read ${transcript}`, `@read ${notes}`, `@answer ${JSON.stringify({ value: 'NVDA is near its target', cites: [HANDLE, `file:${notes}`, price] })}`].join('\n');
    return { prompt, notes };
  }

  it('AC4 a job the plug-in starts on its own reading finds neither your transcript text nor a file the grant doesn\'t name, and the plug-in gets neither', async () => {
    const s = await stocksWorld(at('2026-11-02T10:00'), CONTENT_FREE);
    await seedSession(s.w, SESSION, TRANSCRIPT);
    const price = await readPrice(s.h, s.w);
    const { prompt } = await found(price.handle);
    const got = gotOf(await act(s.h, 'ask', { prompt, inputs: [price.handle] }));
    // The job ran (the plug-in's own reading is inside its grant), and what came back is within the grant.
    expect((await jobsOf(s.w)).length, 'a job ran for the plug-in\'s own reading').toBe(1);
    expect(foundProblems(got, { 'your transcript text': TRANSCRIPT, 'the notes file\'s text': NOTES }, [price.handle])).toEqual([]);
  }, 180_000);

  it('AC4 (wrong program) a hub that hands the plug-in what the job found, as the job gave it, fails, naming the file\'s handle', async () => {
    const s = await stocksWorld(at('2026-11-02T10:00'), CONTENT_FREE);
    const price = await readPrice(s.h, s.w);
    const { prompt, notes } = await found(price.handle);
    const rec = await s.w.runner.run({ kind: 'read', agent: 'claude-code', prompt, deadline_ms: 120_000 });
    const given = JSON.parse(rec.result ?? '{}') as { value: unknown; cites: string[] };
    const got: Got = { ok: true, answer: { handle: 'reading:01TWIN', value: given.value, cites: given.cites, as_of: price.as_of, stale_at: price.as_of } };
    const problems = foundProblems(got, { 'your transcript text': TRANSCRIPT, 'the notes file\'s text': NOTES }, [price.handle]);
    expect(problems.some((p) => p.includes(`file:${notes}`)), JSON.stringify(problems)).toBe(true);
  }, 180_000);
});
