// Test-side tools for #2024 (README). The fixtures are records a real hub reads: a Codex session two weeks old whose
// rollout the hub's own archive copies (scrubbing it on the way in) when it starts, a session that opened a pull request
// and got a PASS, a decision and a wiki claim, all seeded with the hub stopped through the real record, asks core and
// wiki; and, for the budget, #1515's record of archived sessions. The app is read as the real `deep-drive` (#124),
// launched with `launch.from: "record_copy"` in the world's HOME on its real clock, driven over its stdin; the CLI is the
// built `deep`. Nothing here stands in for ⌘K, the search behind it, the archive or `deep open`.
//
// Reused by import, never copied: #2018's record seeding, `Seeder`, schema templates, `deep-drive` builds and replica
// driver; #16's hub, temp homes and PID cleanup; #26's seeding; #1515's archived-session world and handles; #1551's
// reference-Mac gate. #2018's helpers are imported before #1515's, which moves HOME at import, so #2018's cargo builds
// keep the real HOME (and with it cargo's and rustup's own folders).
//
// Safety: every folder this file makes is under /tmp/dh2024-*; the imported helpers make theirs under /tmp/dh16-* and
// /tmp/dh1515-*, and every one is removed by `cleanup`. HOME is a temp folder for this process and every child; CLAUDE*,
// CODEX*, DEEP_* and AI_AGENT are taken out of the environment; no test touches the real ~/.deepbuild, ~/.claude or
// ~/.codex; no network; a process is stopped only by the PID it was started with.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import {
  blocked, byId, cleanup as cleanup2018, DAY, deep, driveBinaries, flat, HOUR, letters, MIN, needBuilds, quiet, REPO, Replica, Seeder, seedRecord, template,
  wordsOf, type Hub, type SNode, type Snapshot,
} from '../2018/helpers.ts';
import { fixtures } from '../../../packages/contracts/src/index.ts';
import type { Connection } from '../../../packages/record/src/index.ts';
import { allEvents, childEnv, control, deep as deep16, own, sha256, startHub, ulid, type Ran } from '../16/helpers.ts';
import { seed } from '../26/helpers.ts';
import { cleanup as cleanup1515, handleOf, makeWorld as archivedWorld, type World as ArchivedWorld } from '../1515/helpers.ts';
import { inconclusive, timingProblem } from '../1551/helpers.ts';

export { archivedWorld, blocked, deep, handleOf, inconclusive, letters, MIN, REPO, Replica, timingProblem, type ArchivedWorld, type Ran, type Snapshot, type SNode };

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('CODEX') || key.startsWith('DEEP_') || key === 'AI_AGENT') delete process.env[key];

const made: string[] = [];
/** A temp folder of this suite's own, under /tmp (a hub's socket path must fit 104 bytes). */
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh2024-${tag}-`));
  made.push(dir);
  return dir;
}
process.env.HOME = tempDir('home');
/** Stops what the suite started, by PID (#16's and #26's lists), and removes every temp folder. */
export async function cleanup(): Promise<void> {
  await cleanup2018();
  await cleanup1515();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Each criterion's ID: `#2024.` and the first 8 hex of SHA-256 of its text (tests/acceptance/48/README.md). */
export const ID = { paste: '#2024.cb3a3faf', words: '#2024.a9de042e', budget: '#2024.04c79639' } as const;

// ---- What the world holds (README, The fixtures).

/** The pull request the session P opened, as `gh pr create` printed its link. */
export const PR_URL = 'https://github.com/acme/shop/pull/412';
/** A commit SHA prefix of ten hex digits that nothing in the record names. */
export const NOTHING = '5ad1be4c0d';
/** AC2's words. */
export const WORDS = 'reconnect backoff';
/** The wiki claim holding the words, on a decision of yours. */
export const CLAIM = { page: 'repos/shop', id: 'reconnect-backoff', text: 'Keep the reconnect backoff under 30 seconds for the pool' } as const;
export const CLAIM_HANDLE = `wiki:${CLAIM.page}#${CLAIM.id}`;
const DECIDED = `${CLAIM.text}; page someone if it stays there`;
export const TITLES = { codex: 'Pool retry tuning', pr: 'Cart totals rounding' } as const;
const PROMPT = 'Why does the pool drop its connections overnight?';
/** The Codex agent's message: the words, with a key right before them that the archive scrubs on the way in. */
const said = (key: string): string => `Token ${key} is what the reconnect backoff probe used; it now doubles up to 30 s.`;

/** The kinds a reference may be (the issue's Scope), each as a reader would find it named in a line of words. */
export const KINDS: readonly (readonly [string, RegExp])[] = [
  ['a PR URL', /\bPRs?\b|pull request/i], ['an issue URL', /\bissues?\b/i], ['#n', /#(n\b|\d|<|number)/i], ['a commit SHA', /\bSHA\b|\bcommit/i],
  ['a branch', /\bbranch/i], ['a session ID', /\bsession/i], ['an agent app link', /\blinks?\b/i], ['an ask handle', /\bask\b/i],
];
/** The kinds a line of words doesn't name. */
export const kindsMissing = (text: string): string[] => KINDS.filter(([, re]) => !re.test(text)).map(([kind]) => kind);

export interface World {
  home: string;
  root: string;
  hub: Hub;
  shop: string;
  /** The Codex session two weeks old, a UUID as Codex writes one; its rollout is `rollout`. */
  codex: string;
  rollout: string;
  /** The session that opened PR_URL and got a PASS. */
  pr: string;
  /** The key in the Codex session's own rollout, new on every run. */
  key: string;
  /** The handle the base's `deep find` gives the Codex session's message: how the fixture was checked. */
  message: string;
}

const hex = (n: number): string => randomBytes(n).toString('hex').slice(0, n);
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** A fresh key in the github-pat shape (`ghp_` and 36 letters and digits), as #20's suite makes one; no real key. */
const fakeKey = (): string => `ghp_${[...randomBytes(36)].map((b) => ALNUM[b % ALNUM.length]).join('')}`;
/** Every ten-character piece of a key: a hit showing any of them shows the key. */
export const piecesOf = (key: string): string[] => Array.from({ length: key.length - 9 }, (_, i) => key.slice(i, i + 10));
const CODEX_VERSION = ((JSON.parse(readFileSync(join(REPO, 'adapters/codex.facts.json'), 'utf8')) as { versions: string[] }).versions).at(-1)!;

/** The Codex session's rollout where Codex keeps it (`~/.codex/sessions/<y>/<m>/<d>/rollout-<time>-<id>.jsonl`), dated `at`. */
function writeRollout(home: string, id: string, cwd: string, at: number, key: string): string {
  const iso = (ms: number) => new Date(ms).toISOString();
  const day = iso(at).slice(0, 10);
  const time = iso(at).slice(0, 19).replace(/:/g, '-');
  const path = join(home, '.codex/sessions', ...day.split('-'), `rollout-${time}-${id}.jsonl`);
  mkdirSync(dirname(path), { recursive: true });
  const lines = [
    { timestamp: iso(at), type: 'session_meta', payload: { id, timestamp: iso(at), cwd, originator: 'codex_cli_rs', cli_version: CODEX_VERSION, source: 'cli', model_provider: 'openai' } },
    { timestamp: iso(at + 2000), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: PROMPT }] } },
    { timestamp: iso(at + 60_000), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: said(key) }] } },
  ];
  writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  return path;
}

/**
 * AC1's and AC2's world (README, The fixtures): repo `shop`; the Codex session X, two weeks old, and its rollout; the
 * session P that opened PR_URL and got a PASS; a decision and the wiki claim on it; then a real hub, whose archive pass
 * copies X's rollout at its start. The fixture is checked with the base's own `deep find` before any test reads it.
 */
export async function makeWorld(): Promise<World> {
  needBuilds();
  const w = await seedRecord({ repos: ['shop'] });
  const shop = w.repos.shop!;
  const now = w.at;
  const old = now - 14 * DAY;
  const codex = `01a1581d-${hex(4)}-7b62-8f4f-${hex(12)}`;
  const key = fakeKey();
  const rollout = writeRollout(w.home, codex, shop, old, key);
  let pr = '';
  await seed(w.home, async (sd) => {
    /** One event in its kind's newest published shape (`own`: the data as given, else over the schema's fixture); its ID. */
    const put = async (conn: Record<string, string>, kind: string, at: number, data: Record<string, unknown>, o: { subject?: string; own?: true } = {}): Promise<string> => {
      const t = template(kind);
      const id = ulid(at);
      sd.at(at);
      await sd.record.append(conn as unknown as Connection, { v: t.v, id, kind, ts: at, ...(o.subject ? { subject: o.subject } : {}), data: o.own ? data : { ...t.data, ...data } });
      return id;
    };
    const you = { actor: 'you', scope: 'you', project: 'shop' };
    // X: a Codex session of shop, two weeks old, as its hooks recorded it; its rollout is on disk for the hub's archive.
    const hookX = { writer: 'hook', ...you, session: codex, agent: 'codex' };
    await put(hookX, 'session.start', old, { agent: 'codex', worktree: shop, branch: 'main', thread: codex, loads: [] }, { own: true });
    await put({ writer: 'app', ...you, session: codex }, 'task.created', old + 1000, { task_ref: `task:${ulid(old + 1000)}`, thread: codex, owner: 'you', title: TITLES.codex });
    await put(hookX, 'user.ask', old + 2000, { msg: 0, text: PROMPT, tasks: [], from: 'unknown' }, { own: true });
    // P: a Claude Code session of shop that opened the pull request (the core's reading of its `gh pr create`, #83) and got a PASS.
    const S = new Seeder(sd, w);
    pr = (await S.start('p', 'shop', now - 3 * HOUR)).id;
    await S.task('p', TITLES.pr, now - 3 * HOUR + 1000);
    await put({ writer: 'core', ...you, session: pr }, 'session.reading', now - 2 * HOUR - MIN, { reading: `Opened pull request ${PR_URL}` }, { subject: `session:${letters(pr)}`, own: true });
    const claim = (await S.stop('p', now - 2 * HOUR)) ?? blocked('the seeder made no claim for P');
    // The core's PASS on it. verdict.made@2 publishes no PASS fixture at the base (#2018's Seeder.verdict can't fill one),
    // so the PASS is @1's own fixture, its handles set.
    const pass = (fixtures('verdict.made@1') as unknown as { data: Record<string, unknown> }[]).find((f) => f.data.outcome === 'PASS') ?? blocked('verdict.made@1 publishes no PASS fixture');
    const judged = now - 2 * HOUR + 5000;
    const verdict = ulid(judged);
    sd.at(judged);
    await sd.record.append({ writer: 'core', ...you, session: pr } as unknown as Connection, { v: 1, id: verdict, kind: 'verdict.made', ts: judged, subject: claim, data: { ...structuredClone(pass.data), verdict: `verdict:${verdict}`, claim } });
    // A decision of yours, and the wiki claim that rests on it.
    const decision = `decision:${await put({ writer: 'core', actor: 'you', scope: 'you' }, 'decision.created', now - HOUR, { key: sha256('#2024 reconnect backoff'), scope: 'all', answer: DECIDED, ask: `ask:${ulid(now - HOUR - 1000)}` }, { own: true })}`;
    sd.at(now - HOUR + 1000);
    const { openWiki } = (await import('../../../packages/wiki/src/index.ts')) as { openWiki: (o: { record: unknown; folder: string; now: () => number }) => Promise<{ learn(c: unknown[]): Promise<{ written: string[]; dropped: unknown[] }> }> };
    const wiki = await openWiki({ record: sd.record, folder: join(w.root, 'wiki'), now: () => now - HOUR + 1000 });
    const learned = await wiki.learn([{ ...CLAIM, scope: 'all', sources: [{ at: decision, quote: CLAIM.text }] }]);
    if (!learned.written.includes(CLAIM_HANDLE)) blocked(`the wiki didn't keep the claim ${CLAIM_HANDLE}: ${JSON.stringify(learned)}`);
  }, old);
  const hub = await startHub({ home: w.home, env: { DEEP_HUB_TEST_CONFIRM: w.confirm } }, 120_000);
  // The hub's archive copies X's rollout at its start; wait for its transcript.archived.
  const conn = await control(hub);
  try {
    const deadline = Date.now() + 180_000;
    for (;;) {
      const events = await allEvents(conn);
      if (events.some((e) => e.kind === 'transcript.archived' && letters(String((e as { data?: { session?: unknown } }).data?.session ?? '')).includes(letters(codex)))) break;
      if (Date.now() > deadline) blocked(`the hub's archive never copied the Codex session's rollout ${rollout} (no transcript.archived for session:${letters(codex)} in 180 s)`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  } finally {
    conn.close();
  }
  await quiet(hub);
  // The fixture as the base's own search reads it: X's message found, its key scrubbed.
  const found = await deep16(w.home, ['find', WORDS, '--json', '--root', w.root], { cwd: shop, timeoutMs: 120_000 });
  let hits: { handle?: string; context?: string }[] = [];
  try { hits = (JSON.parse(found.stdout) as { hits: typeof hits }).hits ?? []; } catch { /* below */ }
  const message = hits.map((h) => String(h.handle ?? '')).find((h) => h.startsWith('session:') && h.includes(letters(codex)));
  if (!message) blocked(`deep find "${WORDS}" doesn't find the Codex session's message in the archive: exit ${found.code}, ${found.stdout.slice(0, 600)} ${found.stderr.slice(0, 300)}`);
  if (piecesOf(key).some((p) => found.stdout.includes(p))) blocked(`the archive kept the key the Codex session's rollout holds: deep find shows it, so the fixture's premise (scrubbed on the way in) doesn't hold`);
  return { home: w.home, root: w.root, hub, shop, codex, rollout, pr, key, message: message! };
}

// ---- The replica and ⌘K (README, The surface).

/**
 * A replica of the world's record on the real clock, launched once: #2018's `deep-drive` builds and its `Replica` driver,
 * started here because `Replica.of` launches on the virtual clock, and a replica closed and launched again keeps no ⌘K at
 * the base (its cmd-k opens nothing on the second launch). `plant` is DEEP_HUB_PLANT in the env-plants build.
 */
export async function replicaOf(w: { home: string }, plant?: string): Promise<Replica> {
  const out = join(tempDir('out'), 'out');
  mkdirSync(out);
  const child = spawn(driveBinaries()[plant ? 'plants' : 'plain'], ['--out', out], { cwd: REPO, env: childEnv(w.home, { DEEP_HUB_PLANT: plant }), stdio: ['pipe', 'pipe', 'pipe'] });
  own(child.pid);
  const r = new (Replica as unknown as new (child: ChildProcess) => Replica)(child);
  const ready = await (r as unknown as { next(ms: number): Promise<Record<string, unknown>> }).next(300_000);
  if (ready.ready !== true) blocked(`deep-drive didn't say {"ready": true}: ${JSON.stringify(ready).slice(0, 300)}`);
  await r.must('launching the replica on a copy of the record, on the real clock', { call: 'launch', launch: { from: 'record_copy', clock: 'real' } });
  return r;
}
/** ⌘K's hits: the nodes in `command-list` whose id starts `hit:` (README, Pinned 2). */
export function hitsOf(s: Snapshot): SNode[] {
  const list = byId(s, 'command-list');
  return list ? flat(list).filter((n) => typeof n.id === 'string' && n.id.startsWith('hit:')) : [];
}
const ids = (hits: readonly SNode[]): string => JSON.stringify(hits.map((h) => h.id)).slice(0, 800);
/** Whether `id` names `session` by its whole ID or its letters and digits. */
const names = (id: unknown, session: string): boolean => typeof id === 'string' && (id.includes(session) || id.includes(letters(session)));
const isMessageOf = (h: SNode, session: string): boolean => typeof h.id === 'string' && h.id.startsWith('hit:session:') && h.id.includes('#') && names(h.id, session);
const isSessionHit = (h: SNode, session: string): boolean => typeof h.id === 'string' && h.id.startsWith('hit:session:') && names(h.id.split('#')[0], session);
const overlaps = (a: number[], b: number[]): boolean => a[2]! > 0 && a[3]! > 0 && a[0]! < b[0]! + b[2]! && b[0]! < a[0]! + a[2]! && a[1]! < b[1]! + b[3]! && b[1]! < a[1]! + a[3]!;
/** Lets the replica's real clock run until `done` holds of a snapshot, up to `ms`; the last snapshot. */
async function until(r: Replica, done: (s: Snapshot) => boolean, ms = 5000): Promise<Snapshot> {
  const deadline = Date.now() + ms;
  for (;;) {
    const s = (await r.see()).snapshot;
    if (done(s) || Date.now() > deadline) return s;
    await r.wait(250);
  }
}

/** AC1, first clause: the PR URL pasted in ⌘K and Return open P's page, which shows its verdict. */
export async function pastedPr(r: Replica, w: World): Promise<string[]> {
  const out: string[] = [];
  await r.press('cmd-k');
  await r.type(PR_URL);
  const listed = await until(r, (s) => hitsOf(s).some((h) => isSessionHit(h, w.pr)), 3000);
  await r.press('enter');
  await r.wait(500);
  const seen = await r.see();
  const who = `P (${w.pr}, "${TITLES.pr}"), the session that opened ${PR_URL}`;
  if (!seen.address?.startsWith('session/') || !names(seen.address, w.pr)) {
    out.push(`pasting ${PR_URL} in ⌘K and pressing Return opened ${seen.address ?? 'nothing'}, not session/${w.pr}: the page of ${who}; ⌘K listed the hits ${ids(hitsOf(listed))}`);
  } else {
    const words = wordsOf(seen.snapshot, byId(seen.snapshot, seen.address));
    if (!/\bPASS\b/.test(words)) out.push(`${who} opened, but its page doesn't show its verdict PASS: it reads ${JSON.stringify(words.slice(0, 400))}`);
  }
  await r.press('escape');
  return out;
}

/** AC1, second clause in ⌘K: a SHA prefix nothing names draws `command-none`, which names every kind a reference may be. */
export async function unnamedInCommandK(r: Replica): Promise<string[]> {
  await r.press('cmd-k');
  await r.type(NOTHING);
  const s = await until(r, (x) => kindsMissing(wordsOf(x, byId(x, 'command-none'))).length === 0, 3000);
  await r.press('escape');
  const none = byId(s, 'command-none');
  if (!none) return [`⌘K "${NOTHING}" (a SHA prefix nothing names) draws no command-none line saying nothing names it; its hits are ${ids(hitsOf(s))}`];
  const words = wordsOf(s, none);
  return kindsMissing(words).map((k) => `⌘K "${NOTHING}" (a SHA prefix nothing names) doesn't list ${k} among the kinds it takes: its line reads ${JSON.stringify(words.slice(0, 300))}`);
}

/** AC1, second clause at `deep open`: a SHA prefix nothing names exits non-zero, naming every kind, with no app running. */
export async function unnamedAtDeepOpen(w: World): Promise<string[]> {
  const ran = await deep(w, ['open', NOTHING]);
  const text = `${ran.stdout}\n${ran.stderr}`;
  const out = kindsMissing(text).map((k) => `deep open ${NOTHING} (a SHA prefix nothing names) doesn't list ${k} among the kinds it takes: exit ${ran.code}, it says ${JSON.stringify(text.trim().slice(0, 400))}`);
  if (ran.code === 0) out.push(`deep open ${NOTHING} exits 0 though nothing names it`);
  return out;
}

/**
 * AC1, third clause: with the replica's hub slow, "reconnect backoff" typed, then taken back and the PR URL typed, both
 * in flight; the hub answers again, newest first (README, Pinned 4). Only the later query's hit may show from then on.
 */
export async function twoInFlight(r: Replica, w: World): Promise<string[]> {
  const out: string[] = [];
  await r.press('cmd-k');
  await r.must('the replica\'s hub turning slow', { call: 'hub', hub: { state: 'slow' } });
  await r.type(WORDS);
  await r.wait(500);
  await r.press(Array.from(WORDS, () => 'backspace').join(' '));
  await r.type(PR_URL);
  await r.wait(500);
  await r.must('the replica\'s hub answering again', { call: 'hub', hub: { state: 'answering' } });
  const stale = new Set<string>();
  let last: Snapshot | undefined;
  for (let i = 0; i < 8; i++) {
    last = (await r.see()).snapshot;
    for (const h of hitsOf(last)) if (names(h.id, w.codex) || String(h.id).startsWith('hit:wiki:') || String(h.id).startsWith('hit:decision:')) stale.add(String(h.id));
    await r.wait(250);
  }
  last = (await r.see()).snapshot;
  if (stale.size) out.push(`with "${WORDS}" and then ${PR_URL} in flight, ⌘K showed the earlier query's hits after the later one was typed: ${[...stale].join(', ')}`);
  if (!hitsOf(last).some((h) => isSessionHit(h, w.pr))) out.push(`with "${WORDS}" and then ${PR_URL} in flight, the later query's hit for P (${w.pr}, "${TITLES.pr}") never showed once the hub answered: ⌘K lists ${ids(hitsOf(last))}`);
  await r.press('escape');
  return out;
}

/** What AC2's ⌘K run found: the failures, each naming the Codex session, and whether ⌘K listed its message at all. */
export interface Found { failures: string[]; listed: boolean; leaked: boolean }
/**
 * AC2: ⌘K "reconnect backoff" lists X's message and the wiki claim, shows no piece of X's key in any hit, and X's hit
 * opens X's page with the message on it.
 */
export async function wordsFound(r: Replica, w: World): Promise<Found> {
  const failures: string[] = [];
  const who = `the Codex session ${w.codex} ("${TITLES.codex}")`;
  await r.press('cmd-k');
  await r.type(WORDS);
  const s = await until(r, (x) => hitsOf(x).some((h) => isMessageOf(h, w.codex)) && hitsOf(x).some((h) => h.id === `hit:${CLAIM_HANDLE}`));
  const hits = hitsOf(s);
  const hit = hits.find((h) => isMessageOf(h, w.codex));
  if (!hit) failures.push(`⌘K "${WORDS}" lists no hit of ${who}'s message (an id hit:session:${letters(w.codex)}#<message>); it lists ${ids(hits)}`);
  if (!hits.some((h) => h.id === `hit:${CLAIM_HANDLE}`)) failures.push(`⌘K "${WORDS}" lists no hit of the wiki claim ${CLAIM_HANDLE} beside ${who}; it lists ${ids(hits)}`);
  const list = byId(s, 'command-list');
  const shown = list ? wordsOf(s, list) : '';
  const piece = piecesOf(w.key).find((p) => shown.includes(p));
  if (piece) failures.push(`a hit of ${who} shows the key its rollout held, which the archive scrubbed on the way in: "${piece}" is in ⌘K's list`);
  if (hit) {
    const clicked = await r.call({ call: 'act', locator: { id: hit.id }, act: { kind: 'click' } });
    await r.wait(500);
    const seen = await r.see();
    const handle = String(hit.id).slice('hit:'.length);
    const page = seen.address ? byId(seen.snapshot, seen.address) : undefined;
    const message = byId(seen.snapshot, handle);
    if (clicked.ok !== true) failures.push(`${who}'s hit ${String(hit.id)} can't be clicked: ${JSON.stringify(clicked.error).slice(0, 300)}`);
    else if (!seen.address?.startsWith('session/') || !names(seen.address, w.codex)) failures.push(`${who}'s hit ${String(hit.id)} opened ${seen.address ?? 'nothing'}, not its page session/${w.codex}`);
    else if (!message) failures.push(`${who}'s hit opened its page, but not at the message it found: the page holds no node ${handle}`);
    else if (!page || !overlaps(message.bounds, page.bounds)) failures.push(`${who}'s hit opened its page, but the message ${handle} isn't shown on it: its bounds ${JSON.stringify(message.bounds)}, the page's ${JSON.stringify(page?.bounds)}`);
  }
  await r.press('escape');
  return { failures, listed: Boolean(hit), leaked: Boolean(piece) };
}

// ---- AC3: the archived world's readiness, and the timed queries.

/** Waits, up to `ms`, until the ledger's archive index holds `count` sessions (read-only; #1515's tables); the count seen. */
export async function indexed(root: string, count: number, ms = 300_000): Promise<number> {
  const deadline = Date.now() + ms;
  let seen = 0;
  for (;;) {
    try {
      const db = new Database(join(root, 'ledger.db'), { readonly: true, fileMustExist: true });
      try { seen = Number(db.prepare('SELECT count(*) FROM archive_sessions').pluck().get()); } finally { db.close(); }
    } catch { /* not there yet */ }
    if (seen >= count || Date.now() > deadline) return seen;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
