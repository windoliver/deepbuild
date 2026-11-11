// A replica's copy of the hub's lookup (#2024; design: Replica): `node lookups.js <hub root> <folder>` copies the
// hub's record into the folder through SQLite's backup, so ⌘K in a replica reads the record and the archive as they
// stood at its launch, then prints `{"ready":true}` and answers one `{"query"}` line with one lookup line, in turn.
// Evidence is kept by its hash and never changes, so the copy reads the hub's store as it is.
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { openEvidenceStore } from '@deepbuild/evidence';
import { foldText, openRecordReader, type FoundMessage } from '@deepbuild/record';
import { lookup, type LookupRecord } from './lookup.js';

const [root, folder] = process.argv.slice(2);
if (!root || !folder) throw Error('usage: lookups.js <hub root> <folder>');
const evidence = await openEvidenceStore({ root: join(root, 'evidence'), readOnly: true });
const live = openRecordReader({ path: join(root, 'ledger.db'), evidence });
await live.copyTo(join(folder, 'ledger.db'));
live.close();
const record = openRecordReader({ path: join(folder, 'ledger.db'), evidence });

/**
 * #2024's planted wrong program, which only a test selects: each session's messages read from its agent's own file
 * under your home, as the file is, instead of the archive's scrubbed copy.
 */
const agentFiles: LookupRecord['findMessages'] = async (terms, sessions = []) => {
  const files = (dir: string): string[] => { try { return readdirSync(dir, { withFileTypes: true, recursive: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name)); } catch { return []; } };
  const all = [...files(join(homedir(), '.codex', 'sessions')), ...files(join(homedir(), '.claude', 'projects'))];
  const found: FoundMessage[] = [];
  for (const session of sessions) {
    const file = all.find((f) => f.endsWith(`${session}.jsonl`));
    if (!file) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, n) => {
      let e: { uuid?: string; payload?: { content?: { text?: string }[] }; message?: { content?: string | { text?: string }[] } };
      try { e = JSON.parse(line) as typeof e; } catch { return; }
      const parts = e.payload?.content ?? (typeof e.message?.content === 'string' ? [{ text: e.message.content }] : e.message?.content) ?? [];
      const text = parts.map((p) => p.text ?? '').join('\n');
      if (text && terms.every((forms) => forms.some((f) => foldText(text).includes(f)))) found.push({ session, id: e.uuid ?? `l${n}`, text, outside: false });
    });
  }
  return found;
};
const messages = process.env.DEEP_HUB_PLANT === 'commandk-reads-agent-files' ? { messages: agentFiles } : {};

process.stdout.write('{"ready":true}\n');
for await (const line of createInterface({ input: process.stdin })) {
  let query = '';
  try { query = String((JSON.parse(line) as { query?: unknown }).query ?? ''); } catch { /* a line that isn't JSON asks nothing */ }
  process.stdout.write(`${JSON.stringify(await lookup(record, query, messages))}\n`);
}
record.close();
