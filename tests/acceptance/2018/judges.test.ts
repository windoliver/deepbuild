// The judges, each held to a right input and the wrong ones, with no hub, CLI or replica: a judge that passes what it
// should fail would let a criterion pass on a wrong program. Each failure names what its criterion says it names: the
// row, the group, the surface, the session. And the generator's alphabet, held to the record core alone: every step it
// can take is an event the record accepts. No criterion tag: these pass at the base.
import { describe, expect, test } from 'vitest';
import {
  ageless, blockedFailures, blockedRowFailures, blockOf, caretFailures, cleanup, expected, FLAGS, groupCountFailures, type KitRun, nameFailures, namedUntilPass, needsYouFailures,
  type Plan, readingOf, recomputeFailures, recorded, renameCalls, renameItem, rowNamed, sameFailures, savedFailures, seedPlans, seedRecord, type SNode, type Snapshot, stateFailures,
  type Step, TABLE, tableFailures, walk, walkEvents, whyFailures, whyTextFailures, WORDS, type Row, type Why,
} from './helpers.ts';

const A = '6b6b81cf-a8d9-4ffc-b43b-3cd484166912';
const B = '50c1b29d-f708-4c5a-8b5e-ddcb5b3a4167';
const row = (id: string, title: string, word: string, entry: string, more: Record<string, unknown> = {}): Row => ({ id, address: id, title, entry, word, why: 'a tool call started 40 s ago and hasn\'t ended', waits_on: 'agent', since: 1, actions: [], unread: false, project: 'shop', ...more });
const node = (id: string | null, name: string | null, children: SNode[] = [], value: unknown = null, role = 'label'): SNode => ({ role, name, value, id, bounds: [0, 0, 10, 10], children });
const snap = (children: SNode[], more: Partial<Snapshot> = {}): Snapshot => ({ window: { size: [1, 1], scale: 2 }, tree: node(null, null, children), items: [], ...more });

describe('the fixtures', () => {
  test('every step of the generator is an event the record takes, in its kind\'s published shape', async () => {
    const plans: Plan[] = [
      { old: false, steps: ['task', 'prompt', 'toolStart', 'toolEnd', 'stop', 'claim', 'FAIL', 'sentBack', 'stale', 'ask', 'answer', 'ask', 'moot', 'gone'] },
      ...(['PASS', 'BLOCKED', 'INVALID', 'INCONCLUSIVE'] as const).map((outcome): Plan => ({ old: true, steps: ['claim', outcome] })),
    ];
    const made = await seedRecord({ repos: ['shop'], seed: (s, T) => seedPlans(s, T, plans, ['shop']) });
    try {
      const events = await recorded(made);
      const count = (kind: string, where: (data: Record<string, unknown>) => boolean = () => true): number => events.filter((e) => e.kind === kind && where(e.data as Record<string, unknown>)).length;
      expect(Object.keys(made.sessions)).toHaveLength(5);
      expect(Object.fromEntries(['session.start', 'task.created', 'user.ask', 'tool.before', 'tool.after', 'agent.stop', 'claim.made', 'verdict.made', 'claim.sent_back', 'verdict.stale', 'ask.created', 'ask.answered', 'ask.moot', 'session.gone'].map((k) => [k, count(k)])))
        .toEqual({ 'session.start': 5, 'task.created': 1, 'user.ask': 1, 'tool.before': 1, 'tool.after': 1, 'agent.stop': 6, 'claim.made': 5, 'verdict.made': 5, 'claim.sent_back': 1, 'verdict.stale': 1, 'ask.created': 2, 'ask.answered': 1, 'ask.moot': 1, 'session.gone': 1 });
      for (const outcome of ['PASS', 'FAIL', 'BLOCKED', 'INVALID', 'INCONCLUSIVE']) expect(count('verdict.made', (d) => d.outcome === outcome), `a ${outcome} verdict`).toBe(1);
      // What `walkEvents` says each walk appends is what the record holds of its session, kind by kind: the count the
      // generated test's oracle leaves a session out by.
      plans.forEach((p, i) => {
        const id = made.sessions[`s${i}`]!.id;
        const held = Object.fromEntries(Object.keys(walkEvents(p.steps)).map((kind) => [kind, events.filter((e) => e.session === id && e.kind === kind).length]));
        expect(held, `the events of session s${i}`).toEqual(walkEvents(p.steps));
      });
    } finally {
      await cleanup();
    }
  }, 120_000);
});

describe('judges', () => {
  test('the table is the issue\'s fourteen rows, in its order, each with the design\'s status-map entry; the four flags are no rows', () => {
    expect(WORDS).toEqual(['needs you', 'stuck', 'flagged', 'sent back', 'BLOCKED', 'INVALID', 'INCONCLUSIVE', 'stale', 'says done', 'working', 'queued', 'PASS', 'finished', 'quiet']);
    expect(Object.fromEntries(TABLE)).toEqual({
      'needs you': 'needs_you', stuck: 'blocked', flagged: 'fail', 'sent back': 'fail', BLOCKED: 'blocked', INVALID: 'invalid', INCONCLUSIVE: 'inconclusive', stale: 'stale',
      'says done': 'running', working: 'running', queued: 'idle', PASS: 'pass', finished: 'idle', quiet: 'idle',
    });
    expect(FLAGS).toEqual(['retrying', 'repeating', 'interrupted', 'watch-only']);
    expect(FLAGS.filter((f) => WORDS.includes(f))).toEqual([]);
  });

  test('stateFailures and sameFailures: exactly one state of the table for a session, the same in two reads, naming the session', () => {
    const right = [row(`session:${A}`, 'Cart totals', 'says done', 'running'), row(`session:${B}`, 'Search box', 'quiet', 'idle'), row('ask:01KB2018AK0000000000000001', 'Ship?', 'needs you', 'needs_you')];
    expect(stateFailures(right, [A, B], 'r')).toEqual([]);
    for (const [word, entry] of TABLE) expect(stateFailures([row(`session:${A}`, 'Cart totals', word, entry)], [A], 'r'), `the row "${word}"`).toEqual([]);
    expect(stateFailures([row(`session:${A}`, 'Cart totals', 'running', 'running')], [A], 'r')).toEqual([`session ${A} (row session:${A}) reads "running" in r, which is no row of the one state table (${WORDS.join(', ')})`]);
    expect(stateFailures([row(`session:${A}`, 'Cart totals', 'done', 'running')], [A], 'r').join()).toMatch(/reads "done" in r, which is no row/);
    for (const flag of FLAGS) expect(stateFailures([row(`session:${A}`, 'Cart totals', flag, 'idle')], [A], 'r'), `the flag ${flag}`).toEqual([`session ${A} (row session:${A}) reads "${flag}" as its state in r: a flag beside one of the fourteen state words, not a state`]);
    expect(stateFailures([row(`session:${A}`, 'Cart totals', 'flagged', 'blocked')], [A], 'r').join()).toMatch(/the table gives "flagged" the entry fail/);
    expect(stateFailures([row(`session:${A}`, 'Cart totals', 'PASS', 'idle')], [A], 'r').join()).toMatch(new RegExp(`^session ${A} .*the table gives "PASS" the entry pass`));
    expect(stateFailures([...right, row(`session:${A}`, 'Cart totals', 'working', 'running')], [A], 'r')).toEqual([`session ${A} has 2 rows in r, not exactly one state`]);
    expect(stateFailures(right, ['gone-0000'], 'r').join()).toMatch(/session gone-0000 has 0 rows/);
    expect(sameFailures(right, right.map((r) => ({ ...r })), [A, B], 'before', 'after')).toEqual([]);
    expect(sameFailures(right, [row(`session:${A}`, 'Cart totals', 'working', 'running'), right[1]!], [A, B], 'before a hub restart', 'after it')).toEqual([`session ${A} reads "says done" before a hub restart and "working" after it`]);
    expect(sameFailures(right, [right[0]!], [A, B], 'at log_pos 9', 'after a replay').join()).toMatch(new RegExp(`session ${B} reads "quiet" at log_pos 9 and "no row" after a replay`));
  });

  test('walk, expected and tableFailures: the first row of the table a walk\'s facts match, where the issue leaves no room, naming the session and the row', () => {
    const word = (...steps: Step[]): string | undefined => expected(steps);
    // An open ask is the first row, whatever else the record holds.
    expect(word('ask')).toBe('needs you');
    expect(word('claim', 'PASS', 'stale', 'ask')).toBe('needs you');
    expect(word('toolStart', 'gone', 'ask', 'ask', 'moot')).toBe('needs you');
    // With no ask open, the newest claim's row.
    expect(word('prompt', 'toolStart', 'toolEnd', 'claim')).toBe('says done');
    expect(word('claim', 'PASS')).toBe('PASS');
    expect(word('claim', 'PASS', 'stale')).toBe('stale');
    expect(word('claim', 'FAIL', 'sentBack')).toBe('sent back');
    for (const outcome of ['BLOCKED', 'INVALID', 'INCONCLUSIVE'] as const) expect(word('task', 'claim', outcome, 'ask', 'moot')).toBe(outcome);
    expect(word('claim', 'BLOCKED', 'claim')).toBe('says done');
    // A step that can't be taken is passed over: a verdict with no claim, a second verdict, an end with no call.
    expect(walk(['PASS', 'toolEnd', 'answer', 'claim', 'PASS', 'FAIL', 'sentBack']).took).toEqual([false, false, false, true, true, false, false]);
    expect(word('claim', 'PASS', 'FAIL')).toBe('PASS');
    // Left to the implementation: no claim, a stale verdict that isn't PASS, a FAIL not sent back, and anything after
    // the claim that may move the session on (a prompt, a call, a stop, a task, a process gone, an answer to deliver).
    for (const steps of [[], ['prompt', 'toolStart'], ['stop'], ['claim', 'BLOCKED', 'stale'], ['claim', 'FAIL'], ['claim', 'FAIL', 'sentBack', 'stale'], ['claim', 'PASS', 'prompt'],
      ['claim', 'toolStart'], ['claim', 'PASS', 'stop'], ['claim', 'task'], ['gone', 'claim', 'PASS'], ['claim', 'PASS', 'gone'], ['ask', 'answer', 'claim'], ['toolStart', 'claim', 'PASS']] as Step[][]) {
      expect(expected(steps), steps.join(', ') || 'a start alone').toBeUndefined();
    }
    expect(walkEvents(['task', 'task', 'prompt', 'toolStart', 'toolStart', 'toolEnd', 'stop', 'claim', 'FAIL', 'PASS', 'sentBack', 'stale', 'ask', 'answer', 'moot', 'gone'])).toEqual({
      'task.created': 1, 'user.ask': 1, 'tool.before': 1, 'tool.after': 1, 'agent.stop': 2, 'claim.made': 1, 'verdict.made': 1, 'verdict.stale': 1, 'claim.sent_back': 1, 'ask.created': 1,
      'ask.answered': 1, 'ask.moot': 0, 'ask.defaulted': 0, 'session.gone': 1,
    });
    // The judge: a session reading another row fails, naming the session and the row; one whose record holds an
    // event its walk didn't append is left out, and so is a walk the oracle leaves open.
    const plans: Plan[] = [{ old: false, steps: ['claim', 'BLOCKED'] }, { old: true, steps: ['claim'] }, { old: false, steps: ['prompt'] }];
    const ids = [A, B, 'c0000000-0000-4000-8000-000000000000'];
    const events = [
      ...['agent.stop', 'claim.made', 'verdict.made'].map((kind) => ({ kind, session: A })), ...['agent.stop', 'claim.made'].map((kind) => ({ kind, session: B })), { kind: 'user.ask', session: ids[2]! },
    ];
    const rows = [row(`session:${A}`, 'Task 0', 'BLOCKED', 'blocked'), row(`session:${B}`, 'Task 1', 'says done', 'running'), row(`session:${ids[2]!}`, 'Task 2', 'working', 'running')];
    expect(tableFailures(rows, plans, ids, events, 'r')).toEqual({ failures: [], judged: 2 });
    // The base's reading: a turn that stopped reads finished, whatever its claim's verdict.
    const base = [row(`session:${A}`, 'Task 0', 'finished', 'idle'), row(`session:${B}`, 'Task 1', 'quiet', 'idle'), rows[2]!];
    expect(tableFailures(base, plans, ids, events, 'r')).toEqual({ failures: [
      `session ${A} (row session:${A}) reads "finished" in r; the first row of the one state table its record facts match is "BLOCKED"`,
      `session ${B} (row session:${B}) reads "quiet" in r; the first row of the one state table its record facts match is "says done"`,
    ], judged: 2 });
    expect(tableFailures([rows[1]!], plans, ids, events, 'r').failures).toEqual([`session ${A} (row session:${A}) reads "no row" in r; the first row of the one state table its record facts match is "BLOCKED"`]);
    expect(tableFailures(base, plans, ids, [...events, { kind: 'ask.created', session: A }, { kind: 'verdict.made', session: B }], 'r')).toEqual({ failures: [], judged: 0 });
  });

  test('needsYouFailures: a surface reads needs you, and no second state beside it, naming the surface', () => {
    expect(needsYouFailures('sidebar row', '! Cart totals · needs you', A, 'stale')).toEqual([]);
    expect(needsYouFailures('menu bar', 'Cart totals · ◌ stale', A, 'stale').join()).toMatch(new RegExp(`^the menu bar reads .* for session ${A}, not needs you`));
    expect(needsYouFailures('deep status line', 'Cart totals  needs you · stale', A, 'stale').join()).toMatch(/^the deep status line reads .*"stale" beside needs you, a second state/);
    expect(needsYouFailures('session page', 'Cart totals\nneeds you\nits PASS went stale when the commit moved', A)).toEqual([]);
    expect(needsYouFailures('notification', '', A, 'stale')).toHaveLength(1);
  });

  test('blockedFailures and blockedRowFailures: whom it waits for and what it needs; a bare BLOCKED names the row', () => {
    const id = `session:${A}`;
    const want = 'BLOCKED · waits for you: a run of publish-check.sh';
    expect(blockedFailures(`  Publish check  ${want}, 1h`, id, 'you', 'a run of publish-check.sh', 'deep status')).toEqual([]);
    expect(blockedFailures('  Publish check  BLOCKED, 1h', id, 'you', 'a run of publish-check.sh', 'deep status')).toEqual([`row ${id} reads a bare BLOCKED in deep status: "  Publish check  BLOCKED, 1h" lacks "waits for you: a run of publish-check.sh"`]);
    expect(blockedFailures('  Publish check  BLOCKED · waits for you', id, 'you', 'a run of publish-check.sh', 'deep status').join()).toMatch(/reads a bare BLOCKED/);
    expect(blockedFailures('  Publish check  finished', id, 'you', 'a run of publish-check.sh', 'deep status').join()).toMatch(new RegExp(`^row ${id} doesn't read BLOCKED in deep status`));
    // A row's block in deep status: its own line and the detail indented under it, and no other row's.
    const listed = `docs\n  Publish check  finished\n      not verified: R2 · BLOCKED 0/1\n  Release notes  ${want}\n1 ask needs you\n`;
    expect(blockOf(listed, 'Publish check')).toBe('  Publish check  finished\n      not verified: R2 · BLOCKED 0/1');
    expect(blockedFailures(blockOf(listed, 'Publish check'), id, 'you', 'a run of publish-check.sh', 'deep status').join()).toMatch(/reads a bare BLOCKED/);
    expect(blockOf(listed, 'Search box')).toBe('');
    const right = row(id, 'Publish check', 'BLOCKED', 'blocked', { waits_on: 'you', why: 'BLOCKED: it waits for you: a run of publish-check.sh' });
    expect(blockedRowFailures(right, id, 'you', 'a run of publish-check.sh')).toEqual([]);
    expect(blockedRowFailures({ ...right, waits_on: null, why: 'BLOCKED' }, id, 'you', 'a run of publish-check.sh')).toEqual([`row ${id} reads a bare BLOCKED in deep status --json: waits_on is null, not "you", and no field holds "a run of publish-check.sh"`]);
    expect(blockedRowFailures({ ...right, why: 'BLOCKED' }, id, 'you', 'a run of publish-check.sh').join()).toMatch(/reads a bare BLOCKED .* no field holds/);
    expect(blockedRowFailures(row(id, 'Publish check', 'finished', 'idle'), id, 'you', 'x').join()).toMatch(/doesn't read BLOCKED/);
    expect(blockedRowFailures(undefined, id, 'you', 'x').join()).toMatch(/its word is "no row"/);
    // The app's row: one name or value holding the whole reading; a row that splits it across slots reads bare.
    const whole = node(id, `■ Publish check · ${want}`, [node(`${id}:word`, 'BLOCKED')], 'blocked', 'button');
    expect(blockedFailures(readingOf(whole, want), id, 'you', 'a run of publish-check.sh', 'the list')).toEqual([]);
    const split = node(id, '■ Publish check · BLOCKED', [node(`${id}:word`, 'BLOCKED'), node(null, 'waits for you: a run of publish-check.sh')], 'blocked', 'button');
    expect(blockedFailures(readingOf(split, want), id, 'you', 'a run of publish-check.sh', 'the list').join()).toMatch(/reads a bare BLOCKED in the list/);
    expect(readingOf(undefined, want)).toBe('');
  });

  test('groupCountFailures: each group count is the length of the list it opens, naming the group', () => {
    const asks = [row('ask:01KB2018AK0000000000000001', 'Ship?', 'needs you', 'needs_you', { project: 'shop' }), row('ask:01KB2018AK0000000000000002', 'Keep?', 'needs you', 'needs_you', { project: 'docs' })];
    const rows = [...asks, row(`session:${A}`, 'Cart totals', 'needs you', 'needs_you')];
    const list = (needs: unknown, shop: unknown = null, drawn = asks): Snapshot => snap([node('list', 'Tasks', [
      node('heading:needs-you', 'Needs you', [], needs), ...drawn.map((a) => node(a.id, a.title, [node(`${a.id}:title`, a.title)], 'needs_you', 'button')),
      node('heading:shop', 'shop', [], shop), node(`session:${A}`, 'Cart totals', [], 'needs_you', 'button'), node('heading:docs', 'docs'),
    ])]);
    expect(groupCountFailures(list('2'), rows)).toEqual([]);
    expect(groupCountFailures(list(2, '1'), rows)).toEqual([]);
    const moot = groupCountFailures(list('3'), rows);
    expect(moot).toHaveLength(2);
    expect(moot[0]).toBe('group heading:needs-you ("Needs you") shows the count 3 in the app\'s list, and the list it opens holds 2 open asks (ask:01KB2018AK0000000000000001, ask:01KB2018AK0000000000000002)');
    expect(moot[1]).toMatch(/^group heading:needs-you .* over 2 ask rows drawn under it/);
    expect(groupCountFailures(list('2', '2'), rows)).toEqual(['group heading:shop ("shop") shows the count 2 in the app\'s list, and the list it opens holds 1 open ask (ask:01KB2018AK0000000000000001)']);
    expect(groupCountFailures(list('2', null, asks.slice(1)), rows).join()).toMatch(/over 1 ask row drawn under it/);
    expect(groupCountFailures(list(null), rows).join()).toMatch(/no group of the app's list shows a count/);
    expect(groupCountFailures(list('two'), rows).join()).toMatch(/no group/);
  });

  test('nameFailures: the one name on a surface, a short ID only between two rows that read the same, naming the surface', () => {
    const NAME = 'fix the flaky checkout test';
    expect(nameFailures('sidebar row', `↻ ${NAME} · working`, { id: A }, NAME)).toEqual([]);
    expect(nameFailures('session page', `Session ${NAME}`, { id: A }, NAME)).toEqual([]);
    expect(nameFailures('session page', 'Session 6b6b81cf\nUntitled task', { id: A }, NAME)).toEqual([`the session page reads "Session 6b6b81cf\\nUntitled task" for session ${A}, not its name "${NAME}": it shows "Session" and the ID 6b6b81cf`]);
    expect(nameFailures('notification', 'shop · Claude Code', { id: A }, NAME).join()).toMatch(/^the notification reads "shop · Claude Code" for session .*, not its name/);
    expect(nameFailures('deep status line', `  6b6b81cf  working  ${NAME} · at work`, { id: A }, NAME).join()).toMatch(/^the deep status line reads .* it shows the ID 6b6b81cf, though no other row reads/);
    expect(nameFailures('sidebar row', `${NAME} · 6b6b81cf`, { id: A }, NAME, { twin: { id: B } })).toEqual([]);
    expect(nameFailures('sidebar row', NAME, { id: A }, NAME, { twin: { id: B } }).join()).toMatch(/^the sidebar row reads .* doesn't add its short ID 6b6b81cf/);
    expect(nameFailures('notification', `shop · ${NAME} · 6b6b81cf 50c1b29d`, { id: A }, NAME, { twin: { id: B } }).join()).toMatch(/holds the other session's ID 50c1b29d/);
    expect(nameFailures('deep status --json row', 'Claude Code', { id: A }, NAME, { twin: { id: B } })).toHaveLength(2);
  });

  test('whyFailures, recomputeFailures and whyTextFailures: the facts, the table\'s row and the sentence, naming the session and the row', () => {
    const events = [{ kind: 'session.start', ts: 100, log_pos: 4 }, { kind: 'user.ask', ts: 200, log_pos: 8 }, { kind: 'tool.before', ts: 300, log_pos: 9 }];
    const above = WORDS.slice(0, WORDS.indexOf('working'));
    const why: Why = { log_pos: 12, id: `session:${A}`, word: 'working', why: 'working: a tool call started 40 s ago and hasn\'t ended', facts: [{ kind: 'tool.before', ts: 300, log_pos: 9 }], lacked: above.map((r) => ({ row: r, fact: `no fact for ${r}` })) };
    const working = row(`session:${A}`, 'Search box', 'working', 'running', { why: 'working: a tool call started 41 s ago and hasn\'t ended' });
    const at = `session ${A} (row session:${A})`;
    expect(ageless('started 40 s ago, 2 min in, 3 h, 1 d')).toBe('started <t> ago, <t> in, <t>, <t>');
    expect(whyFailures(why, working, events, A)).toEqual([]);
    expect(above).toEqual(['needs you', 'stuck', 'flagged', 'sent back', 'BLOCKED', 'INVALID', 'INCONCLUSIVE', 'stale', 'says done']);
    expect(whyFailures({ ...why, word: 'quiet', lacked: WORDS.slice(0, WORDS.indexOf('quiet')).map((r) => ({ row: r, fact: 'none' })) }, working, events, A)).toEqual([`${at}: --why says "quiet" for a row the table reads as "working"`]);
    // The eleven rows the table held before stuck, flagged and finished joined it: a --why that skips those three fails.
    expect(whyFailures({ ...why, lacked: why.lacked.filter((l) => !['stuck', 'flagged'].includes(l.row)) }, working, events, A).join()).toMatch(/names what these rows lacked: \["needs you","sent back"/);
    expect(whyFailures({ ...why, facts: [{ kind: 'tool.before', ts: 300, log_pos: 77 }] }, working, events, A)).toEqual([`${at}: --why names {"kind":"tool.before","ts":300,"log_pos":77}, and the record holds no event at log_pos 77`]);
    expect(whyFailures({ ...why, facts: [{ kind: 'tool.after', ts: 300, log_pos: 9 }] }, working, events, A).join()).toMatch(/the event at log_pos 9 is tool.before at 300/);
    expect(whyFailures({ ...why, facts: [{ kind: 'tool.before', ts: 301, log_pos: 9 }] }, working, events, A)).toHaveLength(1);
    expect(whyFailures({ ...why, facts: [] }, working, events, A)).toEqual([`${at}: --why names no record fact`]);
    expect(whyFailures({ ...why, lacked: why.lacked.slice(1) }, working, events, A).join()).toMatch(/the rows above "working" in the table are \["needs you","stuck","flagged","sent back"/);
    expect(whyFailures({ ...why, word: 'interrupted', lacked: [] }, { ...working, word: 'interrupted' }, events, A)).toEqual([`${at}: --why says "interrupted", which is no row of the one state table`]);
    expect(whyFailures({ ...why, lacked: [...why.lacked].reverse() }, working, events, A)).toHaveLength(1);
    expect(whyFailures({ ...why, lacked: why.lacked.map((l) => ({ ...l, fact: '' })) }, working, events, A)).toHaveLength(above.length);
    expect(whyFailures({ ...why, why: 'quiet: no hook since Monday' }, working, events, A).join()).toMatch(/is not the row's why/);
    expect(whyFailures({ ...why, why: 'working.\nIt runs.' }, { ...working, why: 'working.\nIt runs.' }, events, A).join()).toMatch(/is not one sentence/);
    expect(whyFailures({ ...why, id: `session:${B}` }, working, events, A).join()).toMatch(/names the row/);
    expect(whyFailures({ word: 'working' } as unknown as Why, working, events, A).join()).toMatch(/lacks log_pos, word, why, facts or lacked/);
    expect(whyFailures(why, undefined, events, A)).toEqual([`${at} has no row in deep status --json`]);
    expect(recomputeFailures(why, 'working', A)).toEqual([]);
    expect(recomputeFailures({ word: 'quiet' }, 'working', A)).toEqual([`${at}: the state recomputed from only the facts --why names is "working", not "quiet"`]);
    expect(recomputeFailures(why, undefined, A).join()).toMatch(/is "no row", not "working"/);
    const text = 'working: a tool call started 42 s ago and hasn\'t ended\n  working matched: tool.before at 14:03, log_pos 9\n  needs you: no open ask\n';
    expect(whyTextFailures(text, why, A)).toEqual([]);
    expect(whyTextFailures(text.replace('log_pos 9', 'log_pos 19'), why, A)).toEqual([`session ${A}: deep status --why has no line naming the fact tool.before at log_pos 9`]);
    expect(whyTextFailures('Usage: deep status [--json]\n', why, A)).toHaveLength(2);
  });

  test('rowNamed and namedUntilPass: a kit names the row that is wrong, and passes once each named row is drawn right', () => {
    const run = (result: 'pass' | 'fail', names?: string, code = result === 'pass' ? 0 : 1): KitRun => ({ code, verdict: { result, ...(names === undefined ? {} : { names }) }, said: '' });
    expect(rowNamed(run('fail', 'session:01MCBH57D812FQ88XJ33AV9KCE: its row draws no "says done"'))).toBe('session:01MCBH57D812FQ88XJ33AV9KCE');
    expect(rowNamed(run('fail', 'the row of session 01A reads done'))).toBeUndefined();
    const wrong = ['session:01B', 'session:01D'];
    // A kit that names the first wrong row not yet drawn right.
    const right = (skip: readonly string[]): KitRun => { const first = wrong.find((id) => !skip.includes(id)); return first ? run('fail', `${first}: its row reads "done"`) : run('pass'); };
    expect(namedUntilPass(right)).toEqual({ named: wrong, failures: [] });
    // One that passes anything, and one that fails every view on its first row.
    expect(namedUntilPass(() => run('pass'))).toEqual({ named: [], failures: [] });
    expect(namedUntilPass(() => run('fail', 'session:01A: no row in its place')).failures.join()).toMatch(/names session:01A again after that row was drawn right/);
    expect(namedUntilPass(() => run('fail', 'a count differs')).failures.join()).toMatch(/failed naming no row/);
    expect(namedUntilPass(() => run('fail', 'session:01B: a count', 0)).failures.join()).toMatch(/exits 1/);
    expect(namedUntilPass(() => ({ code: 2, verdict: null, said: 'usage' })).failures.join()).toMatch(/no verdict line/);
  });

  test('renameItem, caretFailures, savedFailures and renameCalls: the menu item, the caret in the title, the name saved', () => {
    const menus = [{ title: 'View', items: [{ title: 'Commands' }] }, { title: 'Session', items: [{ title: 'Open', enabled: true }, { title: 'Rename', enabled: true }] }];
    expect(renameItem(menus)).toEqual({ title: 'Rename', failures: [] });
    expect(renameItem([{ title: 'Session', items: [{ title: 'Rename…' }] }]).title).toBe('Rename…');
    expect(renameItem([menus[0]!]).failures.join()).toMatch(/^no way to rename: the menu bar has no Session menu/);
    expect(renameItem([{ title: 'Session', items: [{ title: 'Open' }, { title: 'Copy title' }] }]).failures).toEqual(['no way to rename: the Session menu has no Rename item (Open, Copy title)']);
    expect(renameItem([{ title: 'Session', items: [{ title: 'Rename', enabled: false }] }]).failures.join()).toMatch(/^no way to rename: .* is disabled/);
    const page = (focus: unknown, field: SNode): Snapshot => snap([node('list', 'Tasks', [node(`session:${A}`, '↻ Billing page · working', [node(`session:${A}:title`, 'Billing page')], 'running', 'button')]),
      node(`session/${A}`, null, [node('page-title', null, [field]), node('box', null, [node('box-draft', 'Your words', [], '', 'text_input')])])], { focus });
    const field = node('session-title', 'Session', [], 'Billing page', 'text_input');
    expect(caretFailures(page('session-title', field), 'Billing page')).toEqual([]);
    expect(caretFailures(page('box-draft', field), 'Billing page')).toEqual(['no way to rename: Rename put the caret in "box-draft", not in the page\'s title']);
    expect(caretFailures(page(null, field), 'Billing page').join()).toMatch(/put the caret in "nothing"/);
    expect(caretFailures(page('session-title', node('session-title', 'Session Billing page')), 'Billing page').join()).toMatch(/a label, not a text field/);
    expect(caretFailures(page('session-title', node('session-title', 'Session', [], '', 'text_input')), 'Billing page').join()).toMatch(/not the session's name "Billing page"/);
    const saved = (rowTitle: string, title: string): Snapshot => snap([node('list', 'Tasks', [node(`session:${A}`, `↻ ${rowTitle} · working`, [node(`session:${A}:title`, rowTitle)], 'running', 'button')]), node('page-title', null, [node('session-title', `Session ${title}`)])]);
    expect(savedFailures(saved('Checkout retries', 'Checkout retries'), A, 'Checkout retries', 'Billing page')).toEqual([]);
    expect(savedFailures(saved('Billing page', 'Checkout retries'), A, 'Checkout retries', 'Billing page')).toEqual([`row session:${A}'s title reads "Billing page" after Return, not "Checkout retries"`, `row session:${A} still reads "Billing page" after Return: "↻ Billing page · working\\nrunning\\nBilling page"`]);
    expect(savedFailures(saved('Checkout retries', 'Billing page'), A, 'Checkout retries', 'Billing page').join()).toMatch(/the page's title reads .* after Return/);
    const call = { method: 'session.name', params: { session: A, name: 'Checkout retries' } };
    expect(renameCalls([{ method: 'row.read', params: { id: `session:${A}` } }, call], A, 'Checkout retries')).toEqual({ calls: [call], failures: [] });
    expect(renameCalls([{ method: 'row.read', params: { id: `session:${A}` } }], A, 'Checkout retries').failures).toEqual([`Return sent the hub no call naming session ${A} and "Checkout retries": ["row.read"]`]);
    expect(renameCalls([{ ...call, error: 'not_found' }], A, 'Checkout retries').failures.join()).toMatch(/the replica's hub refused the app's session.name/);
  });
});
