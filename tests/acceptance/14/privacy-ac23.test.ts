// AC23: a Bash PostToolUse whose command carries a scrub-list value and a gitleaks-pattern key, and whose
// response prints both, leaves neither in events.data in any form #15 names; a 200 KB heredoc is scrubbed
// whole before the 8,192-character cut, and its whole scrubbed text is evidence by hash.
//
// Wrong programs this file catches, each named at the assertion: a hub that scrubs only transcripts and
// evidence (the value or the key stays in data.command), and one that cuts the command before scrubbing it
// (the value's first 10 characters, placed before the cut, stay in the event).

import { afterEach, describe, expect, it } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import type { EvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord, testStorage, toJson } from '../../../packages/record/src/index.ts';
import type { Event, EventInput, RecordStore } from '../../../packages/record/src/index.ts';
import {
  allEvents, expectRefused, filesContaining, hook, isObject, makeClock, mulberry32, removeRoots, SECOND, seqAt, T0,
  tempRoot, toolAfter, word,
} from './helpers.ts';
import type { JsonObject } from './helpers.ts';

afterEach(removeRoots);

const S = 'ses-ac23';
const CUT = 8192;

// ---- The planted secrets, generated at run time from a seed; no fixture holds them.
const rng = mulberry32(0x14_23);
// A scrub-list value with no secret pattern: letters, digits and URL-reserved characters, so its
// URL-encoded form differs from the raw one (as #15's AC5). It reaches the hub only through run.env, under
// a name that marks it secret.
const VALUE = word(rng, 24, 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRTUVWXY3479#$&+,/:;=?@[]');
// A key in gitleaks' aws-access-token shape (AKIA + 16 of [A-Z2-7]); no scrub list names it, so only the
// pattern scrub can find it. Drawn again until its entropy clears the rule's threshold.
function shannon(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) { const p = n / s.length; h -= p * Math.log2(p); }
  return h;
}
let key = '';
for (;;) {
  key = `AKIA${word(rng, 16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567')}`;
  if (shannon(key) >= 3.5) break;
}
const KEY = key;
const VALUE_HEAD = VALUE.slice(0, 10);

// ---- The forms #15 names: raw, URL-encoded in both hex cases, and base64 after 0, 1 and 2 leading bytes in
// both alphabets (the characters the value's bytes alone decide).
interface Form { name: string; text: string }
function forms(value: string): Form[] {
  const bytes = Buffer.from(value, 'utf8');
  const pct = (upper: boolean) => [...bytes].map((b) => {
    const c = String.fromCharCode(b);
    if (/[A-Za-z0-9\-_.~]/.test(c)) return c;
    const h = b.toString(16).padStart(2, '0');
    return `%${upper ? h.toUpperCase() : h}`;
  }).join('');
  const out: Form[] = [
    { name: 'raw', text: value },
    { name: 'URL-encoded, upper-case hex', text: pct(true) },
    { name: 'URL-encoded, lower-case hex', text: pct(false) },
  ];
  for (const lead of [0, 1, 2]) {
    const b64 = Buffer.concat([Buffer.alloc(lead), bytes]).toString('base64');
    const core = b64.slice(Math.ceil((8 * lead) / 6), Math.floor((8 * (lead + bytes.length)) / 6));
    out.push({ name: `base64 standard at offset ${lead}`, text: core });
    out.push({ name: `base64 URL-safe at offset ${lead}`, text: core.replaceAll('+', '-').replaceAll('/', '_') });
  }
  return out;
}
const VALUE_FORMS = forms(VALUE);
/** The forms of the value, and the key, found in a text. */
const survivors = (text: string): string[] => [
  ...VALUE_FORMS.filter((f) => text.includes(f.text)).map((f) => `the value as ${f.name}`),
  ...(text.includes(KEY) ? ['the key'] : []),
];

// ---- One record on the test storage, with a real evidence store in its own temp folder (README: Files
// the tests read), and the hook's connection carrying what the hub holds for this run.
async function open(): Promise<{ record: RecordStore; store: EvidenceStore; evidenceRoot: string }> {
  const clock = makeClock();
  const evidenceRoot = tempRoot('deep-evidence-14-');
  const store = await openEvidenceStore({ root: evidenceRoot, now: clock.now });
  const record = await openRecord({ path: 'record.sqlite', now: clock.now, storage: testStorage(), evidence: store });
  return { record, store, evidenceRoot };
}
const connection = () => hook(S, { run: { env: { CI: 'true', NODE_ENV: 'test', DEPLOY_SECRET: VALUE }, held: [] } });

async function eventById(record: RecordStore, id: string): Promise<Event> {
  const found = (await allEvents(record)).find((e) => e.id === id);
  expect(found, `event ${id} was appended and reads back`).toBeDefined();
  return found!;
}
const commandOf = (event: Event): string => {
  expect(isObject(event.data), `event ${event.id}: data is an object`).toBe(true);
  const command = (event.data as { command?: unknown }).command;
  expect(typeof command, `event ${event.id}: data.command is kept as a string`).toBe('string');
  return command as string;
};

describe('AC23 a scrub-list value and a gitleaks-pattern key in a Bash PostToolUse are scrubbed before the event is appended', () => {
  it('AC23 the tool.after keeps the command with both scrubbed, in no form #15 names, and no field of the response', async () => {
    const { record, evidenceRoot } = await open();
    const at = T0 + SECOND;
    // The command prints both; the hook's payload also carries the tool's response, which prints both too.
    const command = `echo ${VALUE} ${KEY} | tee deploy.log`;
    const response = `${VALUE} ${KEY}\n`;
    const input = toolAfter(at, 'shell', [], command, seqAt(at));
    await record.append(connection(), input);
    const event = await eventById(record, input.id);

    // A hub that scrubs only transcripts and evidence leaves the value or the key in data.command.
    const kept = commandOf(event);
    expect(survivors(kept), `event ${event.id}: a hub that scrubs only transcripts and evidence left these in data.command`).toEqual([]);
    // The record's JSON of the event: nothing of either anywhere in it, not only in the command.
    expect(survivors(toJson(event)), `event ${event.id}: these survived somewhere in the event's JSON`).toEqual([]);
    // The command is kept, scrubbed, not dropped: the text around the secrets is still there.
    expect(kept.startsWith('echo '), `event ${event.id}: the scrubbed command keeps its text before the secrets`).toBe(true);
    expect(kept.endsWith(' | tee deploy.log'), `event ${event.id}: the scrubbed command keeps its text after the secrets`).toBe(true);
    // Only the catalogue's fields of a shell tool.after: kind, paths and command. No field of the response.
    expect(Object.keys(event.data as object).sort(), `event ${event.id}: data holds only the catalogue's fields of tool.after`).toEqual(['command', 'kind', 'paths']);
    expect(toJson(event).includes('tool_response'), `event ${event.id}: a hub that keeps the hook payload whole stored a response field`).toBe(false);

    // A payload that carries the response as a field fails its schema (README: a hook payload's response
    // field never reaches the record), and nothing of it is appended.
    const before = (await allEvents(record)).length;
    const withResponse: EventInput = toolAfter(at + SECOND, 'shell', [], command, seqAt(at + SECOND));
    withResponse.data = { ...(withResponse.data as JsonObject), tool_response: response };
    await expectRefused(record.append(connection(), withResponse), 'schema', {}, `event ${withResponse.id}: a tool.after carrying the response`);
    const after = await allEvents(record);
    expect(after.length, `event ${withResponse.id}: a store that strips the response and appends anyway added an event`).toBe(before);
    for (const e of after) expect(survivors(toJson(e)), `event ${e.id}: these survived in the log after the refused append`).toEqual([]);

    // Nothing of either reached the evidence store's files either (the design's canary sweep, the store's share).
    for (const f of VALUE_FORMS) expect(filesContaining(evidenceRoot, f.text), `event ${event.id}: the value as ${f.name} is in an evidence file`).toEqual([]);
    expect(filesContaining(evidenceRoot, KEY), `event ${event.id}: the key is in an evidence file`).toEqual([]);
    await record.close();
  });

  it('AC23 a 200 KB heredoc with the value placed so its first 10 characters fall before the cut at 8,192 has them nowhere in the event, and none of the value in its evidence copy', async () => {
    const { record, store, evidenceRoot } = await open();
    const at = T0 + SECOND;
    // The heredoc: its first line, filler up to character 8,180, the value (so characters 8,180 to 8,189,
    // its first 10, fall before the cut at 8,192 and the rest after), the key, filler to 200 KB, and the end.
    const firstLine = "cat <<'EOF' > notes.txt\n";
    const filler = (upTo: number, from: number): string => {
      let s = '';
      for (let n = 0; from + s.length < upTo; n++) s += `line ${String(n).padStart(5, '0')}: the quick brown fox jumps over the lazy dog\n`;
      return s.slice(0, upTo - from);
    };
    const valueAt = CUT - 12;
    const head = firstLine + filler(valueAt, firstLine.length);
    expect(head.length, 'the test placed the value at character 8,180').toBe(valueAt);
    const middle = `${VALUE} ${KEY} `;
    const tail = 'last line before the end\nEOF\n';
    const body = head + middle;
    const command = body + filler(200_000 - tail.length, body.length) + tail;
    expect(command.length, 'the test built a 200 KB command').toBe(200_000);
    expect(command.indexOf(VALUE), 'the test placed the value at character 8,180').toBe(valueAt);
    expect(command.indexOf(VALUE_HEAD) + 10 <= CUT && command.indexOf(VALUE) + VALUE.length > CUT, "the value's first 10 characters fall before the cut and the rest after").toBe(true);

    const input = toolAfter(at, 'shell', ['notes.txt'], command, seqAt(at));
    await record.append(connection(), input);
    const event = await eventById(record, input.id);

    // The event keeps the first 8,192 characters of the scrubbed text, from the heredoc's first line.
    const kept = commandOf(event);
    expect(kept.length, `event ${event.id}: the kept command is cut at 8,192 characters`).toBeLessThanOrEqual(CUT);
    expect(kept.startsWith(firstLine), `event ${event.id}: the kept command starts with the heredoc's first line`).toBe(true);
    expect(kept.length, `event ${event.id}: a store that keeps only the cut's tail or drops the command keeps too little`).toBeGreaterThan(valueAt - 100);
    // A hub that cuts the command before scrubbing it keeps the value's first 10 characters in the event.
    const json = toJson(event);
    expect(json.includes(VALUE_HEAD), `event ${event.id}: a hub that cuts before it scrubs kept the value's first 10 characters`).toBe(false);
    expect(kept.includes(VALUE_HEAD), `event ${event.id}: the value's first 10 characters are in data.command`).toBe(false);
    expect(survivors(json), `event ${event.id}: these survived somewhere in the event's JSON`).toEqual([]);
    expect(Object.keys(event.data as object).sort(), `event ${event.id}: data holds only the catalogue's fields of tool.after`).toEqual(['command', 'kind', 'paths']);

    // The whole scrubbed text is evidence by hash: one of the event's hashes reads back as the whole heredoc,
    // longer than the cut, from its first line to its end, with nothing of the value or the key in it.
    expect(event.evidence.length, `event ${event.id}: a field longer than the cut leaves a hash in the event's evidence`).toBeGreaterThan(0);
    const copies: string[] = [];
    for (const hash of event.evidence) {
      const text = Buffer.from(await store.read(hash)).toString('utf8');
      expect(survivors(text), `event ${event.id}: evidence ${hash} holds these`).toEqual([]);
      expect(text.includes(VALUE_HEAD), `event ${event.id}: evidence ${hash} holds the value's first 10 characters`).toBe(false);
      copies.push(text);
    }
    const whole = copies.filter((t) => t.startsWith(firstLine) && t.length > CUT);
    expect(whole, `event ${event.id}: a store that keeps only the cut, or none, of the command as evidence has no copy longer than 8,192 starting with the heredoc's first line`).toHaveLength(1);
    expect(whole[0]!.endsWith(tail), `event ${event.id}: the evidence copy is the whole scrubbed text, to the heredoc's end`).toBe(true);
    expect(whole[0]!.length, `event ${event.id}: the evidence copy is the whole 200 KB text with only the secrets replaced`).toBeGreaterThan(200_000 - middle.length);
    // Nothing of either is on disk under the evidence root, in any form.
    for (const f of VALUE_FORMS) expect(filesContaining(evidenceRoot, f.text), `event ${event.id}: the value as ${f.name} is in an evidence file`).toEqual([]);
    expect(filesContaining(evidenceRoot, VALUE_HEAD), `event ${event.id}: the value's first 10 characters are in an evidence file`).toEqual([]);
    expect(filesContaining(evidenceRoot, KEY), `event ${event.id}: the key is in an evidence file`).toEqual([]);
    await record.close();
  });
});
