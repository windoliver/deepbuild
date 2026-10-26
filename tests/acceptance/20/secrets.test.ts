// #20 AC4 and AC5: a fake key pasted into a user message opens a "rotate this key" ask and is redacted in the
// archived copy; a secret DeepBuild holds by handle, pasted as plain text that no pattern recognizes, is scrubbed
// from the archived copy by value. "Redacted" is the ingestion's redaction: the copy reads back as the store's own
// scrub of the source with the held values (README, Readings).
import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { scrubText } from '../../../packages/evidence/src/index.ts';
import type { Event } from '../../../packages/record/src/index.ts';
import {
  AC, allEvents, appendClaude, archivedOf, claudeTranscript, copyText, dataOf, expectArchived, HOUR, letters, mulberry32, numbered, openArchiveOn,
  openWorld, removeTemps, toJsonAll, word, type World,
} from './helpers.ts';

afterAll(removeTemps);

const rng = mulberry32(randomBytes(4).readUInt32LE(0));
/** A fresh key in gitleaks' github-pat shape (ghp_ and 36 letters and digits), new on every run. */
const fakeKey = (): string => `ghp_${word(rng, 36)}`;

/** The asks the archive opened to rotate a key: ask.created events whose question says rotate. */
async function rotateAsks(w: World): Promise<Event[]> {
  return (await allEvents(w.record, ['ask.created'])).filter((e) => /rotat/i.test(String(dataOf(e).question)));
}

describe(`AC4 ${AC[4]} a planted fake key in a user message opens a rotate ask and is redacted in the archive`, () => {
  it("AC4 a github-pat key pasted in a user message: one open rotate ask for the session, which doesn't quote the key, and an archived copy that reads back redacted, with the key nowhere in the record", async () => {
    const key = fakeKey();
    expect(scrubText(`token ${key}`), 'the planted key is one the redaction pattern finds').not.toContain(key);
    const w = await openWorld();
    try {
      const t = claudeTranscript(w.env, [
        ...numbered(1, 2, 'setup'),
        { uuid: 'm3', role: 'user', text: `here is my GitHub token so you can push: ${key} use it for the deploy` },
        { uuid: 'm4', role: 'assistant', text: 'Thanks. I will set up the deploy step now.' },
      ]);
      const archive = await openArchiveOn(w);
      await archive.pass();

      const copy = await expectArchived(w, t, 'the copy of the session with the pasted key');
      expect(await copyText(w.store, String(dataOf(copy).evidence)), 'the archived copy has no trace of the key').not.toContain(key);

      const asks = await rotateAsks(w);
      expect(asks.length, 'one ask to rotate the pasted key').toBe(1);
      expect(letters(asks[0]!.session ?? ''), 'the rotate ask is the session\'s, where the key was pasted').toBe(letters(t.id));
      expect(JSON.stringify(asks[0]!.data), 'the rotate ask doesn\'t quote the key').not.toContain(key);
      const row = (await w.asks.inbox()).find((r) => r.ask.replace(/^ask:/, '') === asks[0]!.id);
      expect(row, 'the rotate ask is in the inbox').toBeDefined();
      expect(row!.outcome, 'the rotate ask waits for you').toBe('unanswered');
      expect(await toJsonAll(w), 'the key is nowhere in the record').not.toContain(key);
    } finally {
      await w.close();
    }
  }, 60_000);

  it('AC4 the same key asks once: a second pass and a later copy of the grown session, the key still in it, open no second rotate ask', async () => {
    const key = fakeKey();
    const w = await openWorld();
    try {
      const t = claudeTranscript(w.env, [{ uuid: 'm1', role: 'user', text: `use this token: ${key}` }, ...numbered(2, 4, 'after')]);
      const archive = await openArchiveOn(w);
      await archive.pass();
      expect((await rotateAsks(w)).length, 'the first pass opened the rotate ask').toBe(1);
      w.clock.tick(HOUR);
      await archive.pass();
      appendClaude(t, numbered(5, 9, 'later'));
      w.clock.tick(HOUR);
      await archive.pass();
      expect((await archivedOf(w.record, t.id)).length, 'the grown session was copied again').toBe(2);
      await expectArchived(w, t, 'the later copy, still redacted');
      expect((await rotateAsks(w)).length, 'still one rotate ask: the same question is never asked twice').toBe(1);
    } finally {
      await w.close();
    }
  }, 60_000);
});

describe(`AC5 ${AC[5]} a secret DeepBuild holds by handle, pasted as plain text with no recognizable pattern, is scrubbed from the archived copy`, () => {
  it('AC5 a held value, one plain lower-case word no pattern finds, pasted into a user message, is scrubbed from the archived copy by value', async () => {
    const secret = word(rng, 28, 'abcdefghijklmnopqrstuvwxyz');
    const said = `the staging database password is ${secret} so log in with it`;
    expect(scrubText(said), 'no pattern finds the held value: only its value can scrub it').toContain(secret);
    const w = await openWorld();
    try {
      const t = claudeTranscript(w.env, [...numbered(1, 2, 'setup'), { uuid: 'm3', role: 'user', text: said }, ...numbered(4, 5, 'after')]);
      const archive = await openArchiveOn(w, { held: [secret] });
      await archive.pass();
      const copy = await expectArchived(w, t, 'the copy of the session with the pasted held value', [secret]);
      expect(await copyText(w.store, String(dataOf(copy).evidence)), 'the archived copy has no trace of the held value').not.toContain(secret);
    } finally {
      await w.close();
    }
  }, 60_000);
});
