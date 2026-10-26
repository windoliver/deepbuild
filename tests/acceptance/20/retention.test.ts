// #20 AC9: each archived transcript is one evidence file by hash, with one transcript.archived event naming its session
// and that hash, and both remain 31 days after the agent deleted its transcript, on a clock the test controls. The
// retention is DeepBuild's own: the hub, started on a test clock, runs its retention pass at start (hub.ts). A control
// file nobody cites, stored on day 0, shows the pass ran. An archive that writes only to its own folder, or whose
// copies the evidence retention removes, fails this test (wrong.ts).
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { Event } from '../../../packages/record/src/index.ts';
import { startHub, stopHub, stopHubs, waitFor } from './hub.ts';
import {
  AC, archivedOf, claudeTranscript, copyText, dataOf, DAY, handle, HOUR, makeClock, mulberry32, numbered, openArchiveOn, openWorld, redacted,
  removeTemps, sha256, sourceOf, storedFile, T0, utf8, word, type World,
} from './helpers.ts';
import { ownFolderArchive, privateLedgerArchive, type Twin } from './wrong.ts';

afterEach(stopHubs);
afterAll(removeTemps);

interface Kept {
  session: string;
  copy: string;            // the redacted copy's SHA-256: what one evidence file by hash must hold
  expected: string;        // the transcript as the copy must read back: redacted as ingestion redacts
  day0: { events: Event[]; stored: boolean };
  ran: boolean;            // the retention pass removed the uncited control file
  day32: { events: Event[]; stored: boolean; text: string };
}
/** Day 0: a Claude Code session archived. Day 1: its agent deletes it. Day 32: the hub's retention pass; then what's left. */
async function retained(make: (w: World) => Promise<Twin | { pass(): Promise<void> }>): Promise<Kept> {
  const w = await openWorld(); // HOME only: Claude Code's default home, ~/.claude
  const key = `ghp_${word(mulberry32(randomBytes(4).readUInt32LE(0)), 36)}`;
  const t = claudeTranscript(w.env, [...numbered(1, 3, 'kept'), { uuid: 'm4', role: 'user', text: `the deploy token is ${key}` }, ...numbered(5, 6, 'kept')]);
  const expected = redacted(sourceOf(t));
  const copy = sha256(utf8(expected));
  const control = await w.store.connect({ role: 'deepbuild', via: 'job' })
    .put({ bytes: utf8(`a log nobody cites ${randomBytes(8).toString('hex')}\n`), kind: 'log', source: 'test', redaction: 'complete', license: { name: 'own', allows: [] } });
  if (control.status !== 'stored') throw Error(`BLOCKED: the store refused the control file: ${control.reason}`);
  const archive = await make(w);
  await archive.pass();
  const day0 = { events: await archivedOf(w.record, t.id), stored: !!storedFile(w.root, copy) };
  if ('close' in archive) await archive.close();
  await w.close();

  // Day 1: the agent's cleanup deletes the transcript. Day 32, 31 days later: the hub starts and runs its retention pass.
  rmSync(t.path);
  const hub = await startHub(w.home, T0 + DAY + 31 * DAY + HOUR);
  const ran = await waitFor(() => !storedFile(w.root, control.evidence.sha256), 20_000);
  await stopHub(hub);

  const after = await openWorld({ home: w.home, clock: makeClock(T0 + 32 * DAY + 2 * HOUR), env: w.env });
  try {
    const events = await archivedOf(after.record, t.id);
    const linked = events.length === 1 ? String(dataOf(events[0]!).evidence) : copy;
    const text = await copyText(after.store, linked).catch((error: Error) => `unreadable: ${error.message}`);
    return { session: handle(t.id), copy, expected, day0, ran, day32: { events, stored: !!storedFile(w.root, linked), text } };
  } finally {
    await after.close();
  }
}
/** The criterion on what a run left, each failure naming the session. */
function holds(k: Kept): void {
  expect(k.ran, 'BLOCKED unless the hub\'s retention pass ran: the uncited day-0 control file is removed on day 32').toBe(true);
  expect(k.day0.events.map((e) => dataOf(e).evidence), `${k.session}: on day 0, one transcript.archived event names the session and its copy's hash`).toEqual([k.copy]);
  expect(k.day0.stored, `${k.session}: on day 0, the copy is one evidence file, by its hash ${k.copy}`).toBe(true);
  expect(k.day32.events.map((e) => dataOf(e).evidence), `${k.session}: 31 days after the agent deleted the transcript, its transcript.archived event remains`).toEqual([k.copy]);
  expect(k.day32.stored, `${k.session}: 31 days after the agent deleted the transcript, its copy ${k.copy} remains in the evidence store (retention removed it?)`).toBe(true);
  expect(k.day32.text, `${k.session}: on day 32 the copy reads back as the transcript, redacted`).toBe(k.expected);
}

describe(`AC9 ${AC[9]} each archived transcript is one evidence file by hash with one transcript.archived event, and both remain 31 days after the agent deleted it`, () => {
  it("AC9 a session archived on day 0 and deleted by its agent on day 1: on day 32, after the hub's retention pass, its one event and its one evidence file remain and read back", async () => {
    holds(await retained((w) => openArchiveOn(w)));
  }, 120_000);

  it('AC9 (wrong program) an archive that writes only to its own folder leaves no evidence file and no event, and fails this test naming the session', async () => {
    holds(await retained((w) => openArchiveOn(w)));
    const k = await retained(async (w) => ownFolderArchive(w));
    expect(k.day0.events, 'the twin appended no transcript.archived event').toEqual([]);
    expect(() => holds(k)).toThrow(k.session);
  }, 180_000);

  it("AC9 (wrong program) an archive whose copies the evidence retention removes (its link kept in a ledger of its own) loses the copy by day 32, and fails this test naming the session", async () => {
    holds(await retained((w) => openArchiveOn(w)));
    const k = await retained(async (w) => privateLedgerArchive(w));
    expect([k.day0.stored, k.day32.stored], "the twin's copy was in the store on day 0, and the retention pass removed it").toEqual([true, false]);
    expect(() => holds(k)).toThrow(k.session);
  }, 180_000);
});
