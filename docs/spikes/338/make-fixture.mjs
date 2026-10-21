// Issue #338: writes the Needs you fixture record, docs/spikes/338/fixtures/needs-you.events.jsonl.
//
// One JSON object per line, {session_id, event}, in log order. As of its last event, on the virtual
// clock NOW: 40 open asks of every kind across seven sessions, one of them in Later, one held for an
// unread message (the record's word: the hub writes no event for a hold yet), one session with ten open
// asks so its sixth to tenth fold into one exception, one ask superseded by a newer open ask of its own
// session, and one made moot by a passed check. Every id is derived from the ask's number, so the file
// is the same on every run. Run: node docs/spikes/338/make-fixture.mjs
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const NOW = 1_800_000_000_000;
const KINDS = ['authority', 'unblock', 'taste', 'exception', 'choice', 'definition'];
const HOUR = 3_600_000;
const START = NOW - 6 * HOUR;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// A ULID: 10 characters of time, 16 of entropy drawn from a hash of the name, so it never repeats.
function ulid(ms, name) {
  let time = '';
  for (let i = 0, rest = ms; i < 10; i++, rest = Math.floor(rest / 32)) time = CROCKFORD[rest % 32] + time;
  const digest = createHash('sha256').update(`338:${name}`).digest();
  let entropy = '';
  for (let i = 0; i < 16; i++) entropy += CROCKFORD[digest[i] % 32];
  return time + entropy;
}
const sha = (text) => createHash('sha256').update(text).digest('hex');

export function fixture() {
  const rows = [];
  let logPos = 0;
  let ts = START;
  const push = (sessionId, event) => {
    logPos += 1;
    ts += 60_000;
    rows.push({ session_id: sessionId, event: { ...event, ts, log_pos: logPos } });
    return rows.at(-1).event;
  };
  // Seven sessions: the first folds (ten open asks), the rest hold five open asks each.
  const sessions = ['folding', 'merge', 'release', 'docs', 'review', 'migrate', 'design'].map((name, index) => ({
    name,
    id: ulid(START - (7 - index) * 1000, `session:${name}`),
    branch: `feat/${name}`,
  }));
  for (const session of sessions) {
    push(session.id, {
      v: 1, id: ulid(ts + 60_000, `start:${session.name}`), kind: 'session.start', writer: 'hook', actor: 'you', scope: 'you',
      data: { agent: 'claude-code', worktree: `~/src/deepbuild-${session.name}`, branch: session.branch, thread: ulid(START, `thread:${session.name}`) },
    });
  }
  let count = 0;
  const ask = (session, extra = {}) => {
    count += 1;
    const kind = KINDS[(count - 1) % KINDS.length];
    const number = count;
    const data = {
      kind,
      question: `${kind[0].toUpperCase()}${kind.slice(1)} ask ${number} in ${session.name}: go ahead?`,
      options: [{ id: 'yes', label: 'Go ahead', decision: 'allow' }, { id: 'no', label: 'Hold', decision: 'deny' }],
      recommended: 'yes',
      deadline: NOW + (4 + (number % 5)) * HOUR,
      fallback: 'hold',
      default: 'hold',
      provisional: false,
      owner: 'you',
      key: sha(`ask ${number}`),
      pinned_to: { kind: 'commit', ref: sha(`commit ${number}`).slice(0, 40) },
      ...(kind === 'unblock' ? { steps: [`run deep env up in ${session.name}`], where: `~/src/deepbuild-${session.name}`, why: 'the stack is down', unblocks: [`task:${ulid(START, `task:${number}`)}`], proves: 'the journey runs' } : {}),
      ...extra,
    };
    return push(session.id, { v: 1, id: ulid(ts + 60_000, `ask:${number}`), kind: 'ask.created', writer: 'app', actor: 'you', scope: 'you', data });
  };
  const [folding, merge, release, docs, review, ...rest] = sessions;
  // The folding session's ten, in a row, so its sixth to tenth fold.
  const folded = Array.from({ length: 10 }, () => ask(folding));
  // The merge session: one ask superseded by a newer one of its own, then five that stay open.
  const superseded = ask(merge);
  const mergeOpen = Array.from({ length: 5 }, () => ask(merge));
  push(merge.id, { v: 1, id: ulid(ts + 60_000, 'superseded'), kind: 'ask.superseded', subject: `ask:${superseded.id}`, writer: 'core', actor: 'you', scope: 'you', data: { by: `ask:${mergeOpen[0].id}` } });
  // The release session: one made moot by a passed check, and five open.
  const moot = ask(release);
  for (let i = 0; i < 5; i++) ask(release);
  push(release.id, { v: 1, id: ulid(ts + 60_000, 'moot'), kind: 'ask.moot', subject: `ask:${moot.id}`, writer: 'core', actor: 'you', scope: 'you', data: { because: 'check_passed', verdict: `verdict:${ulid(START, 'verdict')}` } });
  // The docs session: five open, the second of them put off until an hour from now.
  const docsAsks = Array.from({ length: 5 }, () => ask(docs));
  push(docs.id, { v: 1, id: ulid(ts + 60_000, 'later'), kind: 'ask.later', subject: `ask:${docsAsks[1].id}`, writer: 'app', actor: 'you', scope: 'you', data: { until: NOW + HOUR } });
  // The review session: five open, the third held for a message the agent hasn't read.
  const reviewAsks = Array.from({ length: 5 }, () => ask(review));
  for (const session of rest) for (let i = 0; i < 5; i++) ask(session);
  return {
    rows,
    logPos,
    held: `ask:${reviewAsks[2].id}`,
    later: `ask:${docsAsks[1].id}`,
    folded: folded.slice(5).map((event) => `ask:${event.id}`),
    superseded: `ask:${superseded.id}`,
    moot: `ask:${moot.id}`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = new URL('fixtures/needs-you.events.jsonl', import.meta.url);
  const { rows, ...summary } = fixture();
  writeFileSync(out, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  console.log(JSON.stringify({ now: NOW, lines: rows.length, ...summary }, null, 2));
}
