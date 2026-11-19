// #2365 AC3: "A key pasted into a line that is half written when a pass runs is in no part in any form: that pass
// copies up to the last complete line, the next copies the rest, and the rotate ask is raised once. A planted archive
// that cuts at the file's end stores the key's first half in one part and fails, naming the part."
// And Scope: "A part ends at a line's end. What follows the last complete line waits for the next pass, and a tail
// still unchanged at that pass is copied as it stands, so no line is scrubbed in two halves and none is left out",
// and "The copy of one session on demand takes the same path".
//
// The key is a fresh fake in gitleaks' github-pat shape (ghp_ and 36 letters and digits), new each run; the line is
// cut 18 characters into its random part, so what the pass sees ends inside the key. "In any form" is read as: no
// 12-character piece of the key's random part is in any evidence the store holds, cited or not, or in the record.
import { randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import {
  appendClaude, bytesOf, claudeLine, claudeTranscript, expectCopy, expectKeyNowhere, HOUR, mulberry32, numbered, openArchiveOn, openWorld,
  redacted, removeTemps, resolved, rotateAsksOf, scrubText, SECOND, T0, windowsOf, word, type Transcript, type World,
} from './helpers.ts';
import { cutAtEndArchive } from './wrong.ts';

afterAll(removeTemps);

const AC3 = '#2365 AC3';
const rng = mulberry32(randomBytes(4).readUInt32LE(0));
const fakeKey = (): string => `ghp_${word(rng, 36)}`;
const RANDOM_FROM = 4; // the key's random part starts after `ghp_`

interface Half { t: Transcript; key: string; line: string; cut: number; before: string }
/** Five whole lines, then message m6, a user line pasting a key, written up to 18 characters into the key's random part. */
function startHalf(w: World): Half {
  const key = fakeKey();
  expect(scrubText(`token ${key}`), 'the planted key is one the redaction pattern finds whole').not.toContain(key);
  const t = claudeTranscript(w.env, numbered(1, 5, 'before'));
  const before = readFileSync(t.path, 'utf8');
  const line = claudeLine(t.id, t.cwd, { uuid: 'm6', role: 'user', text: `here is the deploy token, put it in the CI settings: ${key} and then rerun the deploy` }, T0 + 5 * SECOND, 'm5');
  const cut = line.indexOf(key) + RANDOM_FROM + 18;
  appendFileSync(t.path, line.slice(0, cut));
  return { t, key, line, cut, before };
}
/** The agent finishes the line, and writes three more. */
function finishHalf(h: Half): void {
  appendFileSync(h.t.path, `${h.line.slice(h.cut)}\n`);
  h.t.lines.push(h.line);
  h.t.next++;
  appendClaude(h.t, numbered(7, 9, 'after'));
}
const scrubbedFile = (path: string) => () => bytesOf(redacted(readFileSync(path, 'utf8')));

/** The criterion's scenario on the archive, by `run` (a pass, or the copy of one session on demand). */
async function halfKeyScenario(w: World, run: (id: string) => Promise<void>): Promise<void> {
  const h = startHalf(w);
  await run(h.t.id);
  await expectKeyNowhere(w, h.key, RANDOM_FROM, `${AC3} after the pass that ran with m6 half written`);
  await expectCopy(w, h.t.id, () => bytesOf(redacted(h.before)), `${AC3} that pass copies up to the last complete line (m1…m5)`);

  finishHalf(h);
  w.clock.tick(HOUR);
  await run(h.t.id);
  await expectKeyNowhere(w, h.key, RANDOM_FROM, `${AC3} after the next pass, m6 whole`);
  await expectCopy(w, h.t.id, scrubbedFile(h.t.path), `${AC3} the next pass copies the rest: the parts joined equal the transcript scrubbed whole`);
  expect((await rotateAsksOf(w, h.t.id)).length, `${AC3} the rotate ask is raised once the key's line is whole`).toBe(1);

  w.clock.tick(HOUR);
  await run(h.t.id);
  expect((await rotateAsksOf(w, h.t.id)).length, `${AC3} the rotate ask is raised once: a later pass asks nothing again`).toBe(1);
  const m6 = await resolved(w, h.t.id, 'm6');
  expect(m6, `${AC3} session:<id>#m6 resolves through the parts`).toContain('and then rerun the deploy');
  expect(windowsOf(h.key.slice(RANDOM_FROM)).some((win) => m6!.includes(win)), `${AC3} what #m6 resolves to holds no piece of the key`).toBe(false);
}

describe(`${AC3} a key pasted into a line half written when a pass runs is in no part in any form`, () => {
  it(`${AC3} by passes: the pass with m6 half written copies m1…m5 only, the next copies the rest, the key is in no part, and one rotate ask`, async () => {
    const w = await openWorld();
    try {
      const archive = await openArchiveOn(w);
      await halfKeyScenario(w, () => archive.pass());
    } finally {
      await w.close();
    }
  }, 120_000);

  it(`${AC3} on demand: the copy of one session (archive.session) takes the same path`, async () => {
    const w = await openWorld();
    try {
      const archive = await openArchiveOn(w);
      await halfKeyScenario(w, (id) => archive.session(id));
    } finally {
      await w.close();
    }
  }, 120_000);

  it(`${AC3} a line written in three steps, the key still half written at two passes, waits at both: the key is in no part, then one ask`, async () => {
    const w = await openWorld();
    try {
      const key = fakeKey();
      const t = claudeTranscript(w.env, numbered(1, 5, 'before'));
      const before = readFileSync(t.path, 'utf8');
      const line = claudeLine(t.id, t.cwd, { uuid: 'm6', role: 'user', text: `the npm publish token is ${key} so the release can go out` }, T0 + 5 * SECOND, 'm5');
      const k = line.indexOf(key);
      const cuts = [k + RANDOM_FROM + 9, k + RANDOM_FROM + 27, line.length];
      const archive = await openArchiveOn(w);
      let from = 0;
      for (const [step, cut] of cuts.entries()) {
        appendFileSync(t.path, line.slice(from, cut) + (cut === line.length ? '\n' : ''));
        from = cut;
        w.clock.tick(HOUR);
        await archive.pass();
        await expectKeyNowhere(w, key, RANDOM_FROM, `${AC3} after the pass at step ${step + 1} of writing m6`);
        if (cut < line.length) await expectCopy(w, t.id, () => bytesOf(redacted(before)), `${AC3} m6 still half written at step ${step + 1} (a tail that changed since the last pass) waits`);
      }
      await expectCopy(w, t.id, scrubbedFile(t.path), `${AC3} once m6 is whole, the parts joined equal the transcript scrubbed`);
      expect((await rotateAsksOf(w, t.id)).length, `${AC3} one rotate ask`).toBe(1);
    } finally {
      await w.close();
    }
  }, 120_000);

  it(`${AC3} (wrong program) an archive that cuts at the file's end stores the key's first half in one part, and the check fails naming that part`, async () => {
    const w = await openWorld();
    try {
      const h = startHalf(w);
      const twin = cutAtEndArchive(w, [{ id: h.t.id, path: h.t.path }]);
      await twin.pass();
      finishHalf(h);
      w.clock.tick(HOUR);
      await twin.pass();
      expect(twin.parts.length, 'the twin stored two parts, cut at the file\'s end').toBe(2);
      await expect(expectKeyNowhere(w, h.key, RANDOM_FROM, `${AC3} (twin)`), 'the check fails, naming the twin\'s first part, which holds the key\'s first half').rejects.toThrow(twin.parts[0]!);
    } finally {
      await w.close();
    }
  }, 120_000);
});

describe('#2365 Scope: what follows the last complete line waits, and a tail still unchanged at the next pass is copied as it stands', () => {
  it('#2365 Scope a last line with no line end: the first pass leaves it, the next (unchanged) copies it as it stands, and once the agent goes on, nothing is doubled or left out', async () => {
    const w = await openWorld();
    try {
      const t = claudeTranscript(w.env, numbered(1, 5, 'tail'));
      const before = readFileSync(t.path, 'utf8');
      const tail = claudeLine(t.id, t.cwd, { uuid: 'm6', role: 'user', text: 'message 6: the last thing said before the agent was killed' }, T0 + 5 * SECOND, 'm5');
      appendFileSync(t.path, tail);
      const archive = await openArchiveOn(w);
      await archive.pass();
      await expectCopy(w, t.id, () => bytesOf(redacted(before)), '#2365 Scope the first pass copies up to the last complete line; the unterminated tail waits');

      w.clock.tick(HOUR);
      await archive.pass();
      await expectCopy(w, t.id, scrubbedFile(t.path), '#2365 Scope the next pass, the tail unchanged, copies it as it stands');
      expect(await resolved(w, t.id, 'm6'), '#2365 Scope session:<id>#m6, the tail copied as it stood, resolves').toBe('message 6: the last thing said before the agent was killed');

      appendFileSync(t.path, '\n');
      t.lines.push(tail);
      t.next++;
      appendClaude(t, numbered(7, 8, 'tail'));
      w.clock.tick(HOUR);
      await archive.pass();
      await expectCopy(w, t.id, scrubbedFile(t.path), '#2365 Scope after the agent went on: the parts joined equal the transcript scrubbed, the tail neither doubled nor left out');
      expect(await resolved(w, t.id, 'm8'), '#2365 Scope session:<id>#m8 resolves').toContain('message 8');
    } finally {
      await w.close();
    }
  }, 120_000);
});
