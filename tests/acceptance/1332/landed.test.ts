// AC2: done means landed. A blocker closed with its pull request unmerged keeps its dependent waiting, naming the pull
// request; a blocker on the baseline list (closed before the gate) satisfies the link, reads closed before the gate
// and is never PASS.
import { expect, test } from 'vitest';
import { MIN, named, names, recordWords, sleep, waitUntil, World } from './helpers.ts';

const BASELINED = 100;
const UNMERGED = 101;
const AFTER_BASELINED = 102;
const AFTER_UNMERGED = 103;
const SCOPE = 'work through #100, #102 and #103 with Claude Code, one at a time';

test(named(2), async () => {
  const w = await World.open({
    issues: [{ closed: 'before-gate' }, { closed: 'after-gate' }, { blockedBy: [BASELINED] }, { blockedBy: [UNMERGED] }],
    // #101 was closed by hand while its pull request, from before the run, is open and unmerged (and fails its check).
    prs: [{ issue: UNMERGED, branch: 'unmerged', files: { 'src/i101.txt': 'BROKEN\n' } }],
  });
  const pr = w.forge.pullsLinking(UNMERGED)[0]!;
  const asked = await w.run(SCOPE);
  expect(asked.code, `deep work "${SCOPE}" raises the run's one approval and exits 0: exit ${asked.code}, ${asked.stderr.slice(-600)}`).toBe(0);
  await w.approve(asked);

  // The baseline's issue satisfies the link: #102 starts and its change lands.
  const started = await waitUntil(() => w.on(AFTER_BASELINED)[0], 20 * MIN, 2000);
  expect(started, `#${AFTER_BASELINED} is blocked only by #${BASELINED}, on the baseline list as closed before the gate: it starts`).toBeDefined();
  await waitUntil(() => w.merged(AFTER_BASELINED), 20 * MIN, 2000);
  await sleep(30_000);

  let last = '';
  const waiting = await waitUntil(async () => {
    const s = await w.show();
    last = `${s.ran.stdout.slice(-2000)} ${s.ran.stderr.slice(-400)}`;
    const row = s.rows.get(AFTER_UNMERGED);
    return row && names(row.text, pr) ? s : undefined;
  }, 3 * MIN, 5000);
  expect(waiting, `deep work show says #${AFTER_UNMERGED} waits on #${UNMERGED}, closed with pull request #${pr} unmerged, naming the PR; it printed ${last}`).toBeDefined();
  expect(w.on(AFTER_UNMERGED).map((l) => l.started), `#${AFTER_UNMERGED} never starts: its blocker #${UNMERGED} is closed but its change never landed`).toEqual([]);
  expect(w.merged(UNMERGED), `pull request #${pr} stays unmerged`).toBe(false);

  const row = waiting!.rows.get(BASELINED);
  expect(row, `deep work show prints #${BASELINED}'s row: ${last}`).toBeDefined();
  expect(row!.text.toLowerCase(), `#${BASELINED} reads closed before the gate`).toContain('closed before the gate');
  expect(row!.word, `#${BASELINED}, closed before the gate, is never PASS`).not.toBe('PASS');
  const events = await w.events();
  expect(recordWords(events).get(BASELINED)?.word, `the record's word for #${BASELINED} is never PASS`).not.toBe('PASS');
  expect(events.filter((e) => e.kind === 'landing.made' && e.data.issue === BASELINED && e.data.outcome === 'PASS').length, `the record holds no PASS for #${BASELINED}`).toBe(0);
}, 60 * MIN);
