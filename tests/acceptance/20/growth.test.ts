// #20 AC10: a transcript archived at 10 lines that grows to 50 is archived again as a new copy with its own
// transcript.archived event, and `session:<id>#m40` resolves through the newest copy. "Resolves through the record"
// is the record's own reading of a session handle (design: Reading by reference; #62): the sessions projection names
// the session's newest copy, and the core finds a quote at `session:<id>#m40` in it when a learned change cites it
// there, applying the change; a quote that isn't at its handle is refused. The message IDs are the transcript's own
// (`uuid`), m1…m50, one per line. An archive that copies once leaves m40 unresolved and fails.
import { afterAll, describe, expect, it } from 'vitest';
import type { Event, Row } from '../../../packages/record/src/index.ts';
import {
  AC, appendClaude, archivedOf, claudeTranscript, copyText, CORE, dataOf, handle, HOUR, letters, numbered, openArchiveOn, openWorld, redacted,
  removeTemps, SECOND, sourceOf, ulid, type World,
} from './helpers.ts';
import { copyOnceArchive, type Twin } from './wrong.ts';

afterAll(removeTemps);

interface Grown {
  m40: string;
  copies: Event[];
  texts: string[];
  at10: string;
  at50: string;
  sessionRow: Row | undefined;
  learned: Row | undefined;
}
/** Archives a 10-line session, grows it to 50 lines, archives again, then has a learned change cite message m40. */
async function grow(w: World, make: (w: World) => Promise<Twin | { pass(): Promise<void> }>): Promise<Grown> {
  const t = claudeTranscript(w.env, numbered(1, 10, 'grow'));
  const at10 = sourceOf(t);
  const archive = await make(w);
  await archive.pass();
  w.clock.tick(HOUR);
  appendClaude(t, numbered(11, 50, 'grow'));
  w.clock.tick(HOUR);
  await archive.pass();
  const at50 = sourceOf(t);
  const copies = await archivedOf(w.record, t.id);
  const texts = await Promise.all(copies.map((e) => copyText(w.store, String(dataOf(e).evidence)).catch((error: Error) => `unreadable: ${error.message}`)));
  const m40 = `${handle(t.id)}#m40`;
  const at = w.clock.tick(SECOND);
  const id = ulid(at);
  await w.record.append(CORE, {
    v: 1, id, kind: 'learn.applied', ts: at,
    data: {
      layer: 'learned', target: 'slice:checkout-step-40', diff: '+ the checkout page has a step 40',
      evidence: [{ at: m40, quote: "message 40: grow talk about the shop's checkout page, step 40" }],
      scope: handle(t.id), replay: null, applied_by: 'rule:localfirst', supersedes: null,
    },
  });
  const learned = (await w.record.table('learned_layer')).rows.find((r) => String(r.id) === id);
  const sessionRow = (await w.record.table('sessions')).rows.find((r) => String(r.id) === letters(t.id));
  if ('close' in archive) await archive.close();
  return { m40, copies, texts, at10, at50, sessionRow, learned };
}
/** The criterion, on what a run left: two copies, each with its own event, and m40 resolving through the newest. */
function resolves(g: Grown): void {
  expect(g.copies.length, `${g.m40}: the session was archived at 10 lines and again at 50, each copy with its own transcript.archived event`).toBe(2);
  const [first, newest] = g.copies.map((e) => String(dataOf(e).evidence));
  expect(newest, `${g.m40}: the copy at 50 lines is a new copy, not the one at 10`).not.toBe(first);
  expect(g.texts, `${g.m40}: the copies read back as the session at 10 lines and at 50, redacted`).toEqual([redacted(g.at10), redacted(g.at50)]);
  expect(g.sessionRow?.transcript, `${g.m40}: the record links the session to its newest copy`).toBe(newest);
  expect(g.learned?.state, `${g.m40} resolves through the newest copy: a learned change quoting message m40 there is applied (reason: ${String(g.learned?.reason ?? '')})`).toBe('applied');
}

describe(`AC10 ${AC[10]} a transcript archived at 10 lines that grows to 50 is archived again, and session:<id>#m40 resolves through the newest copy`, () => {
  it('AC10 the session at 10 lines, then at 50: two copies with their own events, the record links the newest, and #m40 resolves', async () => {
    const w = await openWorld();
    try {
      resolves(await grow(w, (world) => openArchiveOn(world)));
    } finally {
      await w.close();
    }
  }, 60_000);

  it('AC10 (wrong program) an archive that copies once leaves #m40 unresolved: the quote is refused as not at its handle, and this test fails naming the handle', async () => {
    const real = await openWorld();
    try {
      resolves(await grow(real, (world) => openArchiveOn(world)));
    } finally {
      await real.close();
    }
    const w = await openWorld();
    try {
      const g = await grow(w, async (world) => copyOnceArchive(world));
      expect(g.copies.length, 'the twin copied the session once').toBe(1);
      expect(g.learned?.state, `the twin leaves ${g.m40} unresolved: the learned change citing it is refused`).toBe('refused');
      expect(String(g.learned?.reason), 'refused because the quote is not at its handle').toMatch(/not at its handle/);
      expect(() => resolves(g)).toThrow(g.m40);
    } finally {
      await w.close();
    }
  }, 90_000);
});
