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

describe('AC23 a Bash PostToolUse is scrubbed before it is cut', () => {
  it('AC23 a command carrying a scrub-list value and a gitleaks-pattern key keeps neither in events.data in any form; a response field never reaches the event', async () => {
    const { record, store, S } = await setup();
    const command = `curl -H "Authorization: token ${KEY}" https://api.example.test/x?v=${VALUE}`;
    const before = toolBefore(T0 + SECOND, 'shell', [], command);
    const after = toolAfter(T0 + 2 * SECOND, 'shell', [], command);
    await record.append(hook(S, { run }), before);
    await record.append(hook(S, { run }), after);
    // A hub that stores the response: the catalogue's tool.after has no field for it, so it fails its schema.
    const withResponse = toolAfter(T0 + 3 * SECOND, 'shell', [], command);
    (withResponse.data as JsonObject).tool_response = `ok ${VALUE} ${KEY}`;
    const err = await expectRefused(record.append(hook(S, { run }), withResponse), 'schema', {}, 'a tool.after carrying tool_response');
    expect(err.path).toMatch(/^\/data/);
    const events = await allEvents(record);
    expect(events).toHaveLength(4);
    for (const e of events.filter((x) => x.kind.startsWith('tool.'))) {
      const data = e.data as JsonObject;
      expect(Object.keys(data).sort(), `${e.kind} keeps only the catalogue's fields`).toEqual(['command', 'kind', 'paths']);
      const json = JSON.stringify(e.data);
      // A hub that scrubs only transcripts and evidence keeps the value in data.command.
      expect(json, `event ${e.id} (${e.kind}): the scrub-list value is scrubbed`).not.toContain(VALUE);
      expect(json, `event ${e.id} (${e.kind}): the gitleaks-pattern key is scrubbed`).not.toContain(KEY);
      expect(json, `event ${e.id} (${e.kind}): no form of the value`).not.toContain(Buffer.from(VALUE).toString('base64').slice(2, -2));
      expect(json, `event ${e.id} (${e.kind}): the response is nowhere`).not.toContain('tool_response');
      expect(String(data.command), 'the command itself is kept, scrubbed').toContain('curl -H');
      for (const text of await evidenceTexts(store, e)) {
        expect(text, `event ${e.id}: no value in its evidence`).not.toContain(VALUE);
        expect(text, `event ${e.id}: no key in its evidence`).not.toContain(KEY);
      }
    }
  });

  it('AC23 a 200 KB heredoc with the value\'s first 10 characters before the cut at 8,192 has those 10 nowhere in its event, and none of the value in its evidence copy', async () => {
    const { record, store, S } = await setup();
    const at = CUT - 12;   // the value's first 12 characters fall before the cut
    const command = heredoc(200 * 1024, 7, { text: VALUE, at });
    expect(command.length).toBeGreaterThan(200 * 1024 - 10);
    expect(command.slice(at, at + VALUE.length)).toBe(VALUE);
    const event = toolAfter(T0 + SECOND, 'shell', ['notes.txt'], command);
    await record.append(hook(S, { run }), event);
    const stored = (await allEvents(record)).find((e) => e.id === event.id)!;
    const kept = String((stored.data as JsonObject).command);
    const head = VALUE.slice(0, 10);
    expect(kept.length, 'the event keeps at most 8,192 characters').toBeLessThanOrEqual(CUT);
    expect(kept.startsWith("cat <<'EOF' > notes.txt\n"), 'the event keeps the start of the command').toBe(true);
    // A hub that cuts the command before scrubbing it keeps the value's first 10 characters in the event.
    expect(JSON.stringify(stored), `event ${event.id}: the value's first 10 characters are nowhere in it`).not.toContain(head);
    const copies = await evidenceTexts(store, stored);
    expect(copies.length, 'the whole scrubbed text is evidence by hash').toBeGreaterThan(0);
    const whole = copies.find((t) => t.length > CUT);
    expect(whole, 'one evidence copy is longer than the cut: the whole text').toBeDefined();
    expect(whole, 'none of the value in the evidence copy').not.toContain(head);
    expect(whole, 'none of the value in the evidence copy').not.toContain(VALUE);
    expect(whole!.endsWith('\nEOF\n'), 'the evidence copy runs to the end of the command').toBe(true);

    // The same heredoc without the value is stored byte for byte.
    const clean = heredoc(200 * 1024, 7);
    const twin = toolAfter(T0 + 2 * SECOND, 'shell', ['notes.txt'], clean);
    await record.append(hook(S, { run }), twin);
    const storedTwin = (await allEvents(record)).find((e) => e.id === twin.id)!;
    expect(String((storedTwin.data as JsonObject).command)).toBe(clean.slice(0, CUT));
    expect(await evidenceTexts(store, storedTwin), 'the clean text is evidence as it was').toContain(clean);
  }, 60_000);
});

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
