// AC4 #2018.c1948faa: a session with no task whose first prompt is "fix the flaky checkout test" reads that name in the
// sidebar, on its page, in its notification and in `deep status`; two sessions with that prompt each add their short
// ID; on the merge base a surface shows "Session" and an ID, and the test fails, naming the surface.
//
// The sessions are played through a real hub's hooks (SessionStart, the prompt, a tool call), their transcripts
// holding the same first prompt; then each gets an open ask, so the app notifies. The sidebar, the page and the
// notification are the replica's over a copy of that hub's record; `deep status` is the built CLI's.
import { afterAll, describe, expect, test } from 'vitest';
import {
  allEvents, byId, cleanup, control, deep, type FixtureSession, ID, idForms, linesWith, makeWorld, MIN, nameFailures, none, type Player, quiet, Replica, rowOf, type Seeder, shortId,
  statusRows, wordsOf, type World,
} from './helpers.ts';

afterAll(cleanup, 120_000);
/** The issue's prompt, the session's name. */
const NAME = 'fix the flaky checkout test';

async function played(p: Player, key: string, repo: string, prompt: string): Promise<void> {
  p.session(key, repo, prompt);
  await p.hook(key, 'SessionStart');
  await p.hook(key, 'UserPromptSubmit', { prompt });
  const call = { tool_name: 'Bash', tool_use_id: `toolu_2018_${key}`, tool_input: { command: 'npm test' } };
  await p.hook(key, 'PreToolUse', call);
  await p.hook(key, 'PostToolUse', { ...call, tool_response: { stdout: 'ok', stderr: '', interrupted: false } });
}
const asked = (s: Seeder, at: number, key: string, question: string): Promise<string> => s.ask(key, 'choice', question, at - 10 * MIN);

/** Each surface's failures for the named sessions of a world: the sidebar, the page, the notification, `deep status`. */
async function surfaceFailures(w: World, named: readonly FixtureSession[]): Promise<string[]> {
  const out: string[] = [];
  const twin = (s: FixtureSession) => { const other = named.find((x) => x.id !== s.id); return other ? { twin: { id: other.id } } : {}; };
  await quiet(w.hub);
  const conn = await control(w.hub);
  const events = await allEvents(conn).finally(() => conn.close());
  for (const s of named) expect(events.some((e) => e.kind === 'task.created' && e.data.thread === s.id), `the fixture session ${s.id} has no task`).toBe(false);
  const status = await statusRows(w);
  const text = (await deep(w, ['status'])).stdout;
  for (const s of named) {
    // The row's `title` holds the name. A row of `--json` carries its `id`, so whether a twin's `title` adds the short
    // ID too is left open (README, Pinned 4); it never holds the other session's.
    const title = String(rowOf(status.rows, s.id)?.title ?? 'no row');
    const other = named.find((x) => x.id !== s.id);
    if (!other || !title.includes(NAME)) out.push(...nameFailures('deep status --json row', title, s, NAME));
    else out.push(...idForms(other.id).filter((f) => title.includes(f)).slice(0, 1).map((f) => `the deep status --json row reads ${JSON.stringify(title)} for session ${s.id}, which holds the other session's ID ${f}`));
    // Its line: the one holding its name (and, of two, its short ID); failing those, the line that holds its ID.
    const lines = linesWith(text, NAME);
    const mine = named.length > 1 ? lines.filter((l) => l.includes(shortId(s.id))) : lines;
    out.push(...nameFailures('deep status line', (mine.length ? mine : linesWith(text, shortId(s.id))).join('\n') || text.slice(0, 300), s, NAME, twin(s)));
  }
  const r = await Replica.of(w);
  try {
    const list = await r.see();
    for (const s of named) out.push(...nameFailures('sidebar row', wordsOf(list.snapshot, byId(list.snapshot, `session:${s.id}`)) || 'no row', s, NAME, twin(s)));
    for (const s of named) {
      await r.open(`session/${s.id}`);
      await r.wait(300);
      const page = await r.see();
      out.push(...nameFailures('session page', wordsOf(page.snapshot, byId(page.snapshot, 'page-title')) || 'no page title', s, NAME, twin(s)));
    }
    await r.wait(3000);
    const posted = await r.close();
    for (const s of named) {
      const mine = posted.filter((p) => p.session === s.id);
      // A notification's title is the first line of its text (#1463).
      out.push(...nameFailures('notification', mine.map((p) => p.text.split('\n')[0]).join('\n') || 'no notification', s, NAME, twin(s)));
    }
  } finally {
    await r.stop();
  }
  return out;
}

describe(ID.name, () => {
  test(`${ID.name}: a session with no task whose first prompt is "${NAME}" reads that name in the sidebar, on its page, in its notification and in deep status`, async () => {
    const w = await makeWorld({
      repos: ['shop', 'docs'],
      play: async (p) => { await played(p, 'flaky', 'shop', NAME); await played(p, 'other', 'docs', 'tidy the changelog'); },
      seed: async (s, at) => { await asked(s, at, 'flaky', 'Retry the checkout test three times or five?'); },
    });
    const failures = await surfaceFailures(w, [w.sessions.flaky!]);
    none(failures, 'each surface, for the one session whose first prompt is its name');
  }, 30 * MIN);

  test(`${ID.name}: two sessions with that prompt each add their short ID`, async () => {
    const w = await makeWorld({
      repos: ['shop'],
      play: async (p) => { await played(p, 'a', 'shop', NAME); await played(p, 'b', 'shop', NAME); },
      seed: async (s, at) => { await asked(s, at, 'a', 'Retry the checkout test three times or five?'); await asked(s, at + 1000, 'b', 'Mark the checkout test as slow?'); },
    });
    const failures = await surfaceFailures(w, [w.sessions.a!, w.sessions.b!]);
    none(failures, 'each surface, for each of the two sessions whose first prompt is the same');
  }, 30 * MIN);
});
