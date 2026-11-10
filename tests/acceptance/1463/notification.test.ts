// AC11 #1463.bfbc08f9: with open asks in three projects, each notification's title names its project; a planted title
// that holds a session ID fails, naming it. The notifications are the ones the app posts, read from the replica's trace
// over a copy of the hub's record; one session is untitled, which reads by its project and agent, never an ID.
import { afterAll, describe, expect, test } from 'vitest';
import { cleanup, ID, idForms, makeWorld, notificationFailures, notifications, type SessionSpec, type World } from './helpers.ts';

afterAll(cleanup, 60_000);

const DAY = 86_400_000;
const SPECS: SessionSpec[] = [
  { key: 'cart', repo: 'shop', title: 'Cart totals', calls: 1, stop: true, asks: [{ kind: 'taste', question: 'Which header colour on the login page?', options: [['blue', 'Blue header'], ['green', 'Green header']], default: 'blue', deadline: (at) => at + DAY }] },
  { key: 'notes', repo: 'docs', title: 'Release notes', calls: 1, stop: true, asks: [{ kind: 'choice', question: 'Keep the changelog as a list or as prose?', options: [['list', 'A list'], ['prose', 'Prose']], default: 'list', deadline: (at) => at + DAY }] },
  { key: 'index', repo: 'search', calls: 1, stop: true, asks: [{ kind: 'choice', question: 'Rebuild the search index tonight?', options: [['yes', 'Yes'], ['no', 'No']], default: 'no', deadline: (at) => at + DAY }] },
];
let made: Promise<World> | undefined;
const world = (): Promise<World> => (made ??= makeWorld(SPECS));

describe(ID.notification, () => {
  test(`${ID.notification}: with open asks in three projects, each notification's title names its project`, async () => {
    const w = await world();
    const posted = await notifications(w);
    console.log(`notified: ${JSON.stringify(posted.map((p) => p.text.split('\n')[0]))}`);
    expect(notificationFailures(posted, w.asks, w.sessions), 'each notification of an open ask').toEqual([]);
  }, 900_000);

  test(`${ID.notification}: a planted title that holds a session ID fails, naming it`, async () => {
    const w = await world();
    const posted = await notifications(w, 'notification-title-id');
    const failures = notificationFailures(posted, w.asks, w.sessions);
    const named = w.sessions.filter((s) => failures.some((f) => f.includes(`holds session ${s.id}'s ID`) && idForms(s.id).some((form) => f.includes(`"${form}"`))));
    expect(named.length, `DEEP_HUB_PLANT=notification-title-id must fail naming each session whose ID its title holds: ${JSON.stringify(failures)}`).toBe(w.sessions.length);
  }, 900_000);
});
