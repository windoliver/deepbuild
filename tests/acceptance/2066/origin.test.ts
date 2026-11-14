// #2066: a `rule:` or `rejected:` line is saved only from a prompt whose recorded origin is a person. Everything runs
// on the real hub, the real deep-hook binary and the record read back through the hub's socket (events.read), with
// #303's world and Claude Code session driver (tests/acceptance/303/helpers.ts). README maps criteria to tests.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, makeWorld, settle, startHub, stopHub, Session, type Ev, type Hub, type Ran, type World } from '../303/helpers.ts';

afterEach(cleanup, 60_000);

const CONTINUATION = 'The app was quit while you were working.';
type Origin = 'scheduled' | 'session' | 'subagent' | 'continuation' | 'unknown';
/** Each non-person origin, sent as Claude Code (or the app) writes a prompt of that origin. */
const SEND: Record<Origin, (s: Session, text: string) => Promise<Ran>> = {
  scheduled: (s, t) => s.scheduled(t),
  session: (s, t) => s.peer(t),
  subagent: (s, t) => s.handback(t),
  // The app's resume prompt: the adapter's facts name it by its words.
  continuation: (s, t) => s.hook('UserPromptSubmit', { prompt: `${CONTINUATION} ${t}` }),
  // No transcript entry for the prompt at all: the adapter can't place it.
  unknown: (s, t) => s.hook('UserPromptSubmit', { prompt: t }),
};

const all = (hub: Hub) => settle(hub, () => true, 0);
const mentions = (e: Ev, text: string) => JSON.stringify(e.data ?? {}).includes(text);
const applied = (events: readonly Ev[], rule: string) => events.filter((e) => e.kind === 'learn.applied' && mentions(e, rule));
const decisions = (events: readonly Ev[], word: string) => events.filter((e) => e.kind === 'decision.created' && mentions(e, word));
const guardsFor = (w: World, word: string): string[] => {
  const entries = (JSON.parse(readFileSync(join(w.root, 'rules.json'), 'utf8')) as { entries?: Record<string, { match?: string }> }).entries ?? {};
  return Object.entries(entries).filter(([, e]) => String(e.match ?? '').includes(word)).map(([name]) => name);
};
const askWith = (events: readonly Ev[], s: Session, text: string) => events.find((e) => e.kind === 'user.ask' && e.session === s.id && String(e.data.text).includes(text));
/** The session's record, other than its prompts, that names the origin and a rule: the refusal's reading. */
const readings = (events: readonly Ev[], s: Session, origin: string) => events.filter((e) => (e.session === s.id || e.subject === `session:${s.id}`)
  && e.kind !== 'user.ask' && e.kind !== 'learn.applied' && mentions(e, origin) && /rule/i.test(JSON.stringify(e.data ?? {})));

async function twoSessions(w: World): Promise<[Session, Session]> {
  const a = new Session(w);
  const b = new Session(w);
  await a.start();
  await b.start();
  await b.typed('fix the login page');
  return [a, b];
}

describe('#2066 a rule line in a prompt nobody typed saves nothing', () => {
  for (const origin of Object.keys(SEND) as Origin[]) {
    it(`AC1/AC2 #2066 a prompt recorded with origin ${origin} holding a rule: line appends no learn.applied, reaches no other session, and its session records the refusal once, naming ${origin}`, async () => {
      const w = makeWorld();
      const hub = await startHub(w);
      try {
        const [a, b] = await twoSessions(w);
        const rule = `Name every branch after its ticket ${origin}`;
        const line = `rule: ${rule}.`;
        await SEND[origin](a, line);
        const recorded = askWith(await settle(hub, (e) => askWith(e, a, line) !== undefined, 15_000), a, line);
        expect(recorded?.data.from, `BLOCKED: the prompt must be recorded with from: ${origin}`).toBe(origin);
        const next = await b.typed('now add a test');
        const events = await settle(hub, (e) => applied(e, rule).length > 0 || readings(e, a, origin).length > 0, 15_000);
        expect(applied(events, rule).map((e) => e.log_pos), `a ${origin} prompt saved the rule "${rule}" as yours (learn.applied), naming its target "${rule}"`).toEqual([]);
        expect(`${next.stdout}\n${next.stderr}`.includes(rule), `a second open session was given the rule "${rule}" from a ${origin} prompt at its next prompt`).toBe(false);
        const said = readings(events, a, origin);
        expect(said.length, `the session's record must say once that the rule line in a ${origin} prompt was not saved, naming the origin ${origin}; found ${said.map((e) => `${e.kind} ${JSON.stringify(e.data)}`).join('; ') || 'none'}`).toBe(1);
        expect(said[0]!.session === a.id || said[0]!.subject === `session:${a.id}`, 'the reading is on the session the prompt came from').toBe(true);
      } finally {
        await stopHub(hub);
      }
    }, 240_000);
  }

  it('AC3 #2066 the same rule: line typed by you is saved once and reaches a second open session at its next prompt (#344)', async () => {
    const w = makeWorld();
    const hub = await startHub(w);
    try {
      const [a, b] = await twoSessions(w);
      const rule = 'Name every branch after its ticket person';
      await a.typed(`rule: ${rule}.`);
      const next = await b.typed('now add a test');
      const events = await settle(hub, (e) => applied(e, rule).length > 0, 15_000);
      expect(applied(events, rule).length, `your typed rule "${rule}" must be saved once as a learn.applied`).toBe(1);
      expect(`${next.stdout}\n${next.stderr}`.includes(rule), `the second open session must be given your rule "${rule}" at its next prompt; it was told ${JSON.stringify(next.stdout.slice(0, 400))}`).toBe(true);
      expect(readings(events, a, 'person').filter((e) => /not saved/i.test(JSON.stringify(e.data))), 'a typed rule is not reported as refused').toEqual([]);
    } finally {
      await stopHub(hub);
    }
  }, 240_000);

  it('AC4 #2066 a rejected: line in a scheduled prompt saves no decision and writes no guard entry; the same words typed by you save both', async () => {
    const w = makeWorld();
    const hub = await startHub(w);
    try {
      const s = new Session(w);
      await s.start();
      const word = 'graphql';
      const line = `We went over this and said no. rejected: \`${word}\`.`;
      await s.scheduled(line);
      const scheduled = await settle(hub, (e) => decisions(e, word).length > 0, 10_000);
      expect(askWith(scheduled, s, line)?.data.from, 'BLOCKED: the prompt must be recorded with from: scheduled').toBe('scheduled');
      expect(decisions(scheduled, word).map((e) => JSON.stringify(e.data)), `a scheduled prompt saved a decision rejecting "${word}" (origin scheduled)`).toEqual([]);
      expect(guardsFor(w, word), `a scheduled prompt wrote a guard entry for "${word}" (origin scheduled)`).toEqual([]);
      await s.typed(line);
      const typed = await settle(hub, (e) => decisions(e, word).length > 0, 15_000);
      expect(decisions(typed, word).length, `your typed rejection of "${word}" must save one decision`).toBe(1);
      expect(guardsFor(w, word).length, `your typed rejection of "${word}" must write a guard entry in rules.json`).toBe(1);
    } finally {
      await stopHub(hub);
    }
  }, 240_000);
});
