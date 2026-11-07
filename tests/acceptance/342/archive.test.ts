// #342 AC1: deleting or archiving a desktop session leaves its archived transcript, copied at its SessionEnd in the Claude
// desktop app and in Codex Desktop, and an archived Codex Desktop thread's rollout is archived from
// ~/.codex/archived_sessions. The apps are played as #80 recorded them: a delete and a Claude desktop archive fire SessionEnd
// (reason other) first; Codex Desktop removes the rollout 31 s after it; its Archive fires nothing and moves the rollout.
// Each session says something last, just before it ends, so a copy from an earlier pass doesn't count. Each copy is read
// back after its source is gone, so a program that only records the event fails. The base fails each: its passes run at
// the hub's start and hourly, and never read archived_sessions.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { scrubText } from '../../../packages/evidence/src/index.ts';
import { cleanup } from '../332/helpers.ts';
import { AC1, closeWorlds, copyHolding, copyText, openWorld, restartHub, ROLLOUT_LEFT_MS, session, type Kind, type Line, type Session, type World } from './helpers.ts';

afterEach(async () => { await closeWorlds(); await cleanup(); }, 60_000);

const lastWords = (s: Session): string => `the last thing said in ${s.kind} session ${s.id}`;
/** The copy reads back whole, with its source gone from the agent's folder. */
async function readsBack(w: World, s: Session, source: string, found: { copy: Line } | undefined): Promise<void> {
  expect(found, `no transcript.archived of ${s.handle} (${s.kind}) holds its last line`).toBeDefined();
  s.removeSource();
  expect(await copyText(w, found!.copy), `the copy of ${s.handle} reads back as its transcript, redacted`).toBe(scrubText(source, { held: [] }));
}

describe(`${AC1} deleting or archiving a desktop session leaves its archived transcript`, () => {
  it.each<[string, Kind]>([['the Claude desktop app', 'claude'], ['Codex Desktop', 'codex']])('AC1 in %s, a session deleted or archived at SessionEnd (reason other) leaves a copy holding its last line, read back after its source is gone', async (_, kind) => {
    const w = await openWorld();
    const s = await session(w, kind);
    s.said(lastWords(s));
    const source = readFileSync(s.transcript, 'utf8');
    await s.end();
    // The app's own time: past it Codex Desktop's rollout is gone, and the Claude desktop app's session with it.
    await readsBack(w, s, source, await copyHolding(w, s, lastWords(s), ROLLOUT_LEFT_MS));
  }, 120_000);

  it('AC1 a Codex Desktop thread archived with no hook fired is archived from ~/.codex/archived_sessions, what it said last included', async () => {
    const w = await openWorld();
    const s = await session(w, 'codex');
    s.said(lastWords(s));
    const source = readFileSync(s.transcript, 'utf8');
    s.archiveCodex();
    // The criterion names no time for this path, so the test asks only for the pass the archive runs at the hub's start.
    await restartHub(w);
    await readsBack(w, s, source, await copyHolding(w, s, lastWords(s), ROLLOUT_LEFT_MS));
  }, 120_000);
});
