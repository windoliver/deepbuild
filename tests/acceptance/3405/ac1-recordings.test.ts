// AC1: the corpus holds the three recordings for the newest covered version (a message between two sessions in the
// terminal, one in the desktop app, and a channel's event), each replaying clean through the adapter with its reviewed
// events, and the facts place a `peer` turn only by what they show: a session's message stays `session`, a channel's
// event is `channel`, and every kind no recording holds reads `unknown`, never `session`.
import { afterAll, describe, it } from 'vitest';
import { mapHook } from '../../../adapters/index.mjs';
import {
  AC1, NEWEST, NODE, RECORDINGS, REPO, SOCKET_VAR, TAG, TOKEN_VAR, caseRef, cleanup, corpusCopy, entryOf, eventOf, joins, makeWorld,
  missingRecordings, must, parseObject, promptsOfKind, readFactsFile, readRecording, reported, run, serverOf, shown, type Line, type Recording,
} from './helpers.ts';

afterAll(cleanup, 60_000);

/** A message recording: two sessions, each SessionStart with the address its hooks saw, and tagged turns another session's message started. */
function messageRecording(rec: Recording, surface: 'terminal' | 'desktop'): void {
  must(rec.meta.schema === 'corpus.session@1' && rec.meta.agent === 'claude-code' && rec.meta.version === NEWEST && rec.meta.surface === surface,
    `${AC1} ${rec.ref}/session.json must say corpus.session@1, claude-code, ${NEWEST}, surface ${surface}: ${JSON.stringify(rec.meta)}`);
  const starts = rec.cases.filter((c) => eventOf(c) === 'SessionStart');
  const ids = new Set(starts.map((c) => c.payload.session_id));
  must(ids.size >= 2, `${AC1} ${rec.ref} must record both sessions of the message, each from its SessionStart: it holds ${ids.size} (${[...ids].join(', ')})`);
  for (const c of starts) must(typeof c.env?.[SOCKET_VAR] === 'string' && c.env[SOCKET_VAR].length > 0, `${AC1} ${caseRef(rec, c)}: a session's SessionStart line must record, as env.${SOCKET_VAR}, the inbox address its hooks were given: ${JSON.stringify(c.env ?? null)}`);
  const peers = promptsOfKind(rec, 'peer').filter((c) => c.tag === TAG.message);
  must(peers.length > 0, `${AC1} ${rec.ref} must hold a UserPromptSubmit tagged ${TAG.message} whose transcript entry has turnOrigin peer and origin.kind peer`);
  for (const c of peers) must(typeof entryOf(rec, c)?.origin?.from === 'string', `${AC1} ${caseRef(rec, c)}: its entry's origin.from must give the sender's address: ${JSON.stringify(entryOf(rec, c)?.origin)}`);
  if (surface === 'terminal') {
    const addresses = [...reported(rec).values()];
    const joined = peers.filter((c) => addresses.some((a) => joins(entryOf(rec, c)?.origin?.from, a)));
    must(joined.length > 0, `${AC1} ${rec.ref}: in the terminal the message's origin.from is the sender's inbox address (uds:<path>), so a tagged turn's address must be one a recorded session's SessionStart reported: addresses ${JSON.stringify(peers.map((c) => entryOf(rec, c)?.origin?.from))}, reported ${JSON.stringify(addresses)}`);
  }
}

describe(`${AC1} the corpus holds the three recordings for the newest covered version, and the facts change only to what they show`, () => {
  it(`${AC1} adapters/corpus/claude-code/<newest>/ holds a terminal message, a desktop-app message and a channel's event between sessions, each replaying clean with its reviewed events`, async () => {
    const missing = missingRecordings();
    must(!missing.length, `${AC1} the corpus holds no ${missing.join(', ')} for Claude Code ${NEWEST}, the newest version the facts cover (README, Surfaces: the three recordings)`);
    const terminal = readRecording(RECORDINGS.terminal)!;
    const desktop = readRecording(RECORDINGS.desktop)!;
    const channel = readRecording(RECORDINGS.channel)!;
    messageRecording(terminal, 'terminal');
    messageRecording(desktop, 'desktop');
    must(channel.meta.schema === 'corpus.session@1' && channel.meta.agent === 'claude-code' && channel.meta.version === NEWEST, `${AC1} ${channel.ref}/session.json must say corpus.session@1, claude-code, ${NEWEST}: ${JSON.stringify(channel.meta)}`);
    const events = promptsOfKind(channel, 'channel').filter((c) => c.tag === TAG.channel);
    must(events.length > 0, `${AC1} ${channel.ref} must hold a UserPromptSubmit tagged ${TAG.channel} whose transcript entry has turnOrigin peer and origin.kind channel`);
    for (const c of events) must(serverOf(entryOf(channel, c)) !== undefined, `${AC1} ${caseRef(channel, c)}: its entry's origin must give the channel's server's name: ${JSON.stringify(entryOf(channel, c)?.origin)}`);
    // No recording keeps the inbox's token (AGENTS.md: no secrets in fixtures).
    for (const rec of [terminal, desktop, channel]) for (const c of rec.cases) must(!c.env || !(TOKEN_VAR in c.env), `${AC1} ${caseRef(rec, c)} records ${TOKEN_VAR}; a recording keeps the address only`);

    // Each recorded payload replays clean through the adapter, and the reviewed events place each tagged prompt.
    const corpus = corpusCopy(makeWorld(), Object.values(RECORDINGS));
    const r = await run(NODE, ['scripts/corpus.mjs', 'replay', '--corpus', corpus], { cwd: REPO, timeoutMs: 300_000 });
    const lines = r.stdout.split('\n').flatMap((l) => { const o = parseObject(l); return o ? [o] : []; });
    for (const rec of [terminal, desktop, channel]) {
      for (const c of rec.cases) {
        const line = lines.find((l) => l.type === 'payload' && l.case === caseRef(rec, c));
        must(line?.result === 'match' && line.verified === true, `${AC1} ${caseRef(rec, c)} must replay clean (verified, its stored events matched field by field): ${JSON.stringify(line ?? shown(r))}`);
      }
    }
    for (const [rec, kind, from] of [[terminal, TAG.message, 'session'], [desktop, TAG.message, 'session'], [channel, TAG.channel, 'channel']] as const) {
      for (const c of rec.cases.filter((x) => x.tag === kind)) {
        const asks = (c.expect ?? []).filter((e: Line) => e.kind === 'user.ask');
        must(asks.length === 1 && asks[0]!.data?.from === from, `${AC1} ${caseRef(rec, c)} (${kind}) must be stored as one user.ask from ${from}: ${JSON.stringify(c.expect)}`);
      }
    }
  }, 600_000);

  it(`${AC1} the facts place a peer turn by its origin's kind: peer is session, channel is channel, and a kind no recording holds is unknown, never session`, () => {
    const facts = readFactsFile();
    const read = (kind: string): unknown => {
      const id = '7d1e3c55-0000-4000-8000-000000003405';
      const prompt = `<${kind}>a line</${kind}>`;
      const entry = { parentUuid: null, isSidechain: false, promptId: id, type: 'user', message: { role: 'user', content: prompt }, isMeta: true, uuid: '7d1e3c55-0000-4000-8000-0000000034a5', timestamp: '2026-11-27T00:00:00.000Z', permissionMode: 'default', origin: { kind, from: 'uds:/tmp/cc-socks/4242.sock' }, promptSource: 'system', turnOrigin: 'peer', turnPosition: { promptIndex: 1, turnIndex: 2 }, userType: 'external', entrypoint: 'cli', cwd: '~/work', sessionId: '7d1e3c55-0000-4000-8000-0000000034ff', version: NEWEST, gitBranch: 'HEAD' };
      const payload = { session_id: entry.sessionId, transcript_path: '~/.claude/projects/-work/s.jsonl', cwd: '~/work', prompt_id: id, permission_mode: 'default', hook_event_name: 'UserPromptSubmit', prompt };
      return mapHook({ facts, version: NEWEST, payload, transcript: [entry] }).events.find((e) => e.kind === 'user.ask')?.data.from;
    };
    must(read('peer') === 'session', `${AC1} a peer turn whose origin's kind is peer (another session's message) must stay from: session, as the recordings show; it reads ${JSON.stringify(read('peer'))}`);
    must(read('channel') === 'channel', `${AC1} a peer turn whose origin's kind is channel must read from: channel, as the channel's recording shows; it reads ${JSON.stringify(read('channel'))}`);
    for (const kind of ['coordinator', 'observer', 'observer-activity', 'slack-ping', 'ext-kind-3405']) {
      must(read(kind) === 'unknown', `${AC1} a peer turn whose origin's kind is ${kind}, which no recording in the corpus holds, must read from: unknown, never session; it reads ${JSON.stringify(read(kind))}`);
    }
  });
});
