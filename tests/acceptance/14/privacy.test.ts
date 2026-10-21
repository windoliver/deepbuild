// #14: hook payloads are scrubbed before the 8,192-character cut, with the whole text as evidence (AC23),
// and a heavy day stores only the catalogue's fields and stays under the 30-day budget (AC26).
import { afterEach, describe, expect, it } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import type { EvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { Event, EventInput, RecordStore } from '../../../packages/record/src/index.ts';
import {
  agentStop, allEvents, bytesUnder, expectRefused, hook, makeClock, mulberry32, removeRoots, SECOND, sessionStart, T0, tempRoot,
  toolAfter, toolBefore, ulidAt, userAsk, word,
} from './helpers.ts';
import type { JsonObject } from './helpers.ts';

afterEach(removeRoots);

const CUT = 8192;
const GB = 1_000_000_000;
const rng = mulberry32(0x14_23);
/** A scrub-list value: one word the hub holds by handle. */
const VALUE = `hv-${word(rng, 40)}`;
/** A gitleaks-pattern key (github-pat: ghp_ + 36 alphanumerics). */
const KEY = `ghp_${word(rng, 36)}`;
const FILLER_WORDS = ['build', 'step', 'done', 'ok', 'compiling', 'linking', 'cache', 'hit', 'miss', 'ran', 'in', '12', 'ms', 'module', 'tests', 'passed'];
function filler(seed: number, chars: number): string {
  const r = mulberry32(seed);
  let s = '';
  while (s.length < chars) s += FILLER_WORDS[Math.floor(r() * FILLER_WORDS.length)] + (r() < 0.1 ? '\n' : ' ');
  return s.slice(0, chars);
}
/** A heredoc command of about `size` characters, with `planted` placed so its first characters start at `at`. */
function heredoc(size: number, seed: number, planted?: { text: string; at: number }): string {
  const head = "cat <<'EOF' > notes.txt\n";
  let body = filler(seed, size - head.length - 5);
  if (planted) body = body.slice(0, planted.at - head.length) + planted.text + body.slice(planted.at - head.length + planted.text.length);
  return `${head}${body}\nEOF\n`;
}
async function evidenceTexts(store: EvidenceStore, event: Event): Promise<string[]> {
  const out: string[] = [];
  for (const hash of event.evidence) out.push(Buffer.from(await store.read(hash)).toString('utf8'));
  return out;
}
async function setup(): Promise<{ record: RecordStore; store: EvidenceStore; S: string; root: string }> {
  const clock = makeClock();
  const root = tempRoot();
  const store = await openEvidenceStore({ root: tempRoot('deep-evidence-14-'), now: clock.now });
  const record = await openRecord({ path: `${root}/record.db`, now: clock.now, evidence: store });
  const S = ulidAt(T0 - SECOND);
  await record.append(hook(S), sessionStart(T0 - SECOND, S));
  await record.append(hook(S), userAsk(T0, 1, 'go'));
  return { record, store, S, root };
}
const run = { held: [VALUE] };

describe('AC26 a heavy day stores only the catalogue\'s fields and stays under the budget', () => {
  it('AC26 each tool.before and tool.after keeps only catalogue fields; a 220 KB heredoc keeps 8,192 characters plus its whole text as evidence; the day times 30 is under 1 GB', async () => {
    const { record, store, root } = await setup();
    const clock = makeClock(T0 + SECOND);
    const SESSIONS = 20, SHORT = 150, FILES = 100, HEREDOCS = 10;
    const bigs: EventInput[] = [];
    let wholeCommands = 0;
    for (let s = 0; s < SESSIONS; s++) {
      const S = ulidAt(clock.tick(SECOND));
      const c = hook(S, { run });
      await record.append(c, sessionStart(clock.now(), S));
      await record.append(c, userAsk(clock.tick(SECOND), 1, `work on part ${s}`));
      for (let i = 0; i < SHORT; i++) {
        const cmd = `npm test -- src/part${s}/file${i}.test.ts`;
        await record.append(c, toolBefore(clock.tick(100), 'shell', [], cmd));
        await record.append(c, toolAfter(clock.tick(100), 'shell', [], cmd));
        wholeCommands += 2 * cmd.length;
      }
      for (let i = 0; i < FILES; i++) {
        const path = `src/part${s}/file${i}.ts`;
        await record.append(c, toolAfter(clock.tick(100), i % 2 ? 'edit' : 'read', [path], null));
      }
      for (let i = 0; i < HEREDOCS; i++) {
        const cmd = heredoc(220 * 1024, s * 100 + i);
        const e = toolAfter(clock.tick(100), 'shell', [`notes${i}.txt`], cmd);
        bigs.push(e);
        wholeCommands += cmd.length;
        await record.append(c, e);
      }
      await record.append(c, agentStop(clock.tick(SECOND), S, 1));
    }
    expect(wholeCommands * 30, 'the whole commands of this day, 30 times over, exceed the budget (so a store that keeps them whole fails below)').toBeGreaterThan(GB);
    const events = await allEvents(record);
    for (const e of events) {
      if (!e.kind.startsWith('tool.')) continue;
      const keys = Object.keys(e.data as JsonObject).sort();
      // A hub that stores each hook payload whole has more fields here, named by its kind.
      expect(keys, `${e.kind} ${e.id} keeps only the catalogue's fields`).toEqual(['command', 'kind', 'paths']);
    }
    for (const b of bigs) {
      const stored = events.find((e) => e.id === b.id)!;
      expect(String((stored.data as JsonObject).command).length, `heredoc ${b.id} keeps 8,192 characters`).toBe(CUT);
      const copies = await evidenceTexts(store, stored);
      expect(copies, `heredoc ${b.id} keeps its whole text as evidence by hash`).toContain(String((b.data as JsonObject).command));
    }
    await record.close();
    const size = bytesUnder(root);
    console.log(`AC26: the day's record is ${(size / 1e6).toFixed(1)} MB; times 30: ${((size * 30) / 1e6).toFixed(0)} MB`);
    // A hub that stores each hook payload whole (tool.after, 220 KB a heredoc) grows past 1 GB here.
    expect(size * 30, `the day's record times 30 (${size * 30} bytes) is under 1 GB; tool.after is the kind that grows`).toBeLessThan(GB);
  }, 600_000);
});
