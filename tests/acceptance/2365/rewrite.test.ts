// #2365 AC4: "A transcript whose first megabyte was rewritten after its last copy is copied again from its start, and
// the session's handles resolve through the new parts. A planted archive that appends the rewritten file's tail to the
// old parts fails, naming the first line that differs."
//
// The transcript is #20's generated Claude Code session (tests/acceptance/20/generate.ts), archived at 1.5 MB and
// again at 2 MB, so it has more than one copy event. Then its first megabyte is rewritten, as a compaction or an
// edit rewrites it: every line from line 6 to the first megabyte's end gains a field, and each typed prompt among them
// reads "(edited) …"; and the file goes on to 2.5 MB, so it is longer than at its last copy and an archive that
// only looks at the size sees it as grown. A second case rewrites one letter in the first megabyte, the size
// unchanged. "Copied again from its start" is read as its observable result: the session's archived copy equals the
// rewritten transcript scrubbed (helpers.ts, expectCopy), and its handles resolve to the rewritten text.
import { readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { appendSession, linesUpTo, session, writeSession, type Generated } from '../20/generate.ts';
import {
  bytesOf, expectCopy, HOUR, letters, MB, openArchiveOn, openWorld, redacted, removeTemps, resolved, T0, type World,
} from './helpers.ts';
import { appendTailArchive, type Twin } from './wrong.ts';

afterAll(removeTemps);

const AC4 = '#2365 AC4';
type Obj = { [k: string]: unknown };
/** A line's message text as the record reads it, for a typed prompt or an answer of text alone; else undefined. */
function textOf(line: string): string | undefined {
  const o = JSON.parse(line) as { message?: { content?: unknown } };
  const c = o.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c) && c.length && c.every((b: Obj) => b.type === 'text' && typeof b.text === 'string')) return c.map((b: Obj) => String(b.text)).join('\n');
  return undefined;
}
const uuidOf = (line: string): string => String((JSON.parse(line) as Obj).uuid);
/** The rewrite: a field added, and a typed prompt edited. */
function edit(line: string): string {
  const o = JSON.parse(line) as Obj & { message: Obj };
  o.slug = 'rewritten-after-compaction';
  if (typeof o.message.content === 'string') o.message.content = `(edited) ${o.message.content}`;
  return JSON.stringify(o);
}
const scrubbedFile = (path: string) => () => bytesOf(redacted(readFileSync(path, 'utf8')));

interface Run { g: Generated; path: string; edited: { uuid: string; text: string }[]; last: { uuid: string; text: string } }
/** Archives the session at 1.5 MB and 2 MB, rewrites its first megabyte and grows it to 2.5 MB, archives again. */
async function rewriteScenario(w: World, make: (source: { id: string; path: string }) => Promise<Twin>): Promise<Run> {
  const g = session(0x2365_0400, 3 * MB, T0);
  const [n1, n15, n2, n25] = [MB, 1.5 * MB, 2 * MB, 2.5 * MB].map((size) => linesUpTo(g, size));
  const path = writeSession(w.env, g, n15!);
  const archive = await make({ id: g.id, path });
  await archive.pass();
  appendSession(w.env, g, n15!, n2!);
  w.clock.tick(HOUR);
  await archive.pass();
  const sizeBefore = statSync(path).size;

  const lines = g.lines.slice(0, n25).map((l, i) => (i >= 5 && i < n1! ? edit(l) : l));
  writeFileSync(path, lines.map((l) => `${l}\n`).join(''));
  expect(statSync(path).size, 'the rewritten transcript is longer than at its last copy').toBeGreaterThan(sizeBefore);
  w.clock.tick(HOUR);
  await archive.pass();

  const edited = lines.slice(5, n1).filter((l) => typeof (JSON.parse(l) as { message?: { content?: unknown } }).message?.content === 'string').map((l) => ({ uuid: uuidOf(l), text: textOf(l)! }));
  expect(edited.length, 'the first megabyte holds typed prompts the rewrite edited').toBeGreaterThan(2);
  const lastLine = [...lines].reverse().find((l) => textOf(l) !== undefined)!;
  return { g, path, edited, last: { uuid: uuidOf(lastLine), text: textOf(lastLine)! } };
}

describe(`${AC4} a transcript whose first megabyte was rewritten after its last copy is copied again from its start`, () => {
  it(`${AC4} rewritten and grown: the archived copy equals the rewritten transcript scrubbed, and the session's handles resolve to the rewritten text`, async () => {
    const w = await openWorld();
    try {
      const r = await rewriteScenario(w, async () => openArchiveOn(w));
      await expectCopy(w, r.g.id, scrubbedFile(r.path), `${AC4} after the rewrite`);
      for (const m of [r.edited[0]!, r.edited[1]!, r.edited[r.edited.length - 1]!]) {
        expect(await resolved(w, r.g.id, m.uuid), `${AC4} session:<id>#${m.uuid}, a prompt in the rewritten first megabyte, resolves to its rewritten text`).toBe(m.text);
      }
      expect(await resolved(w, r.g.id, r.last.uuid), `${AC4} session:<id>#${r.last.uuid}, the last message, resolves`).toBe(r.last.text);
      const messages = (await w.record.transcript(letters(r.g.id))) ?? [];
      const first = messages.filter((m) => m.id === r.edited[0]!.uuid || m.id.endsWith(`#${r.edited[0]!.uuid}`));
      expect(first.map((m) => m.text), `${AC4} the session's transcript, as the record reads it, holds ${r.edited[0]!.uuid} once, rewritten`).toEqual([r.edited[0]!.text]);
    } finally {
      await w.close();
    }
  }, 300_000);

  it(`${AC4} one letter rewritten in the first megabyte, the size unchanged: copied again, and its handle resolves to the new text`, async () => {
    const w = await openWorld();
    try {
      const g = session(0x2365_0401, 2 * MB, T0);
      const n = linesUpTo(g, 1.5 * MB);
      const path = writeSession(w.env, g, n);
      const archive = await openArchiveOn(w);
      await archive.pass();
      const before = statSync(path);
      const i = g.lines.findIndex((l, k) => k >= 5 && typeof (JSON.parse(l) as { message?: { content?: unknown } }).message?.content === 'string');
      const o = JSON.parse(g.lines[i]!) as { message: { content: string } };
      const c = o.message.content;
      o.message.content = (c[0] === 'q' ? 'z' : 'q') + c.slice(1);
      const lines = g.lines.slice(0, n);
      lines[i] = JSON.stringify(o);
      writeFileSync(path, lines.map((l) => `${l}\n`).join(''));
      expect(statSync(path).size, 'the same size').toBe(before.size);
      utimesSync(path, before.atime, new Date(before.mtimeMs + 5_000));
      w.clock.tick(HOUR);
      await archive.pass();
      await expectCopy(w, g.id, scrubbedFile(path), `${AC4} after a same-size rewrite of line ${i + 1}`);
      expect(await resolved(w, g.id, uuidOf(lines[i]!)), `${AC4} session:<id>#${uuidOf(lines[i]!)} resolves to the rewritten text`).toBe(o.message.content);
    } finally {
      await w.close();
    }
  }, 300_000);

  it(`${AC4} (wrong program) an archive that appends the rewritten file's tail to the old parts fails, naming line 6, the first line that differs`, async () => {
    const w = await openWorld();
    try {
      const r = await rewriteScenario(w, async (source) => appendTailArchive(w, [source]));
      const sixth = uuidOf(r.g.lines[5]!);
      await expect(expectCopy(w, r.g.id, scrubbedFile(r.path), `${AC4} (twin)`), 'the check fails on the twin, naming the first line that differs').rejects.toThrow(`first differs at line 6 (message ${sixth})`);
    } finally {
      await w.close();
    }
  }, 300_000);
});
