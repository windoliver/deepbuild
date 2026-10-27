// The wrong programs the criteria name (README, Wrong programs), built only on what exists at the base: the agents'
// folders, the record, the evidence store and the runner. Each test that names one runs the criterion's check on the
// real program first and then on the twin, and expects the check to fail on the twin, naming the handle or the job.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { transcriptPath, type Session } from './corpus.ts';
import { norm, type Line, type Ran } from './helpers.ts';
import { storedMessages, type Verdict } from './checks.ts';
import type { Run, World } from './world.ts';

/**
 * AC3's twin: a reader that opens the archive's folder (`<root>/archive/claude/<id>.jsonl`, where #20's own-folder twin
 * kept copies) and else the agent's transcript path (`~/.claude/projects/<cwd>/<id>.jsonl`), and prints what it found
 * there as `deep read --json` would.
 */
export function folderReader(w: World, sessions: readonly Session[]): (handle: string) => Ran {
  return (handle) => {
    const s = sessions.find((x) => handle === x.handle);
    const paths = s ? [join(w.root, 'archive', 'claude', `${s.id}.jsonl`), transcriptPath(w.agents, s)] : [];
    const path = paths.find((p) => existsSync(p));
    if (!path) return { status: 1, stdout: '', stderr: `no transcript file for ${handle}`, ms: 0 };
    let text = '';
    const messages: Line[] = [];
    for (const raw of readFileSync(path, 'utf8').split('\n')) {
      let e: Line;
      try { e = JSON.parse(raw) as Line; } catch { continue; }
      const c = e.message?.content;
      const body = typeof c === 'string' ? c : Array.isArray(c) ? (c as Line[]).map((b) => (b.type === 'text' ? String(b.text) : b.type === 'tool_result' ? String(b.content) : '')).join('') : '';
      if (!body) continue;
      messages.push({ at: `${handle}#${String(e.uuid)}`, role: String(e.message.role), outside: false, start: text.length, end: text.length + body.length });
      text += `${body}\n`;
    }
    return { status: 0, stdout: JSON.stringify({ handle, covers: 'the whole transcript', text, messages }), stderr: '', ms: 0 };
  };
}

/**
 * AC4's and AC9's twin: a reading job that pastes the whole session into its prompt. It reads the session's archived
 * copy from the evidence store (the record's own link) and runs one `read` job through the runner with all of it.
 */
export async function pasteJob(w: World, handle: string): Promise<Run> {
  const { messages } = await storedMessages(w, handle);
  const prompt = `Summarize what to remember from ${handle}. Here is the whole session:\n\n${messages.map((m) => `${m.at}\n${m.text}`).join('\n\n')}\n`;
  const rec = await w.runner.run({ kind: 'read', agent: 'claude-code', prompt, deadline_ms: 300_000 });
  return { job: rec.job, rec, stdout: await w.runner.output(rec.job) };
}

/**
 * AC10's twin: a quote check that compares case-folded text. Everything else as the issue says: NFC, each whitespace
 * run one space, on the redacted slice the handle names, and a transcript quote must cite its message.
 */
export function foldedCheck(at: string, sliceText: string, quote: string): Verdict {
  if (at.startsWith('session:') && !at.includes('#')) return 'refused';
  return norm(sliceText).toLowerCase().includes(norm(quote).toLowerCase()) ? 'at' : 'refused';
}
