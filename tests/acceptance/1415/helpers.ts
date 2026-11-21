// Test-side tools for the #1415 acceptance tests on the canvas core (README): `deep-show run` (#393's scenario binary; the hub
// runs the same calls through `deep-show canvas`) with #96's shared document, the session states a test reaches there, the
// served state table and the walk over it, and `cargo` for the test build with `test-boom` and the planted call. Nothing here
// stands in for the canvas core: every reply read is the binary's.

import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1415 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** Every test of the suite may wait this long: some build, some start a hub on a shared Mac. */
export const TEST_MS = 600_000;

export const isObj = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const brief = (v: unknown, n = 700): string => (JSON.stringify(v) ?? String(v)).slice(0, n);

// ---------------------------------------------------------------------------------------------------
// cargo and the binaries

/** The canvas core the README's build makes: the checkout's default deep-show, the one the hub runs. */
export const SHOW_BIN = join(REPO, 'target', 'debug', 'deep-show');
/** deep-show's cargo feature that seals the test canvas module test.boom (README: test-boom). */
export const BOOM_FEATURE = 'test-boom';

/** The cargo settings the README builds with, unless the caller set its own, so a test's cargo call rebuilds nothing else. */
function cargoEnv(): NodeJS.ProcessEnv {
  return { ...process.env, CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0' };
}
export interface Cargo { status: number | null; stderr: string; ms: number }
/** One cargo command in the checkout; its error output with the lock-waiting lines left out. */
export function cargo(args: readonly string[]): Cargo {
  const t0 = performance.now();
  const run = spawnSync('cargo', args, { cwd: REPO, env: cargoEnv(), encoding: 'utf8', maxBuffer: 256 << 20, timeout: 3_000_000, killSignal: 'SIGKILL' });
  const stderr = `${run.stderr ?? ''}${run.error ? `\n${run.error.message}` : ''}`.split('\n').filter((l) => !/Blocking waiting for file lock/.test(l)).join('\n');
  return { status: run.status, stderr, ms: performance.now() - t0 };
}
const tail = (text: string, n = 3000): string => (text.length > n ? `…${text.slice(-n)}` : text);

/**
 * The test build with `test-boom` (README: test-boom), built once for the file and copied to a temporary folder; the
 * checkout's deep-show is then built again with its default features, so the hub's canvas core stays the default build.
 * Returns the copy's path; a test that calls it fails BLOCKED, naming cargo's error, when the build failed.
 */
export function useBoomBinary(): () => string {
  let bin = '';
  let error = '';
  let dir = '';
  beforeAll(() => {
    // The README's package selection, so cargo unifies the dependencies' features as it did for the default build.
    const built = cargo(['build', '--locked', '-q', '-p', 'deep-show', '-p', 'deep-hook', '--features', `deep-show/${BOOM_FEATURE}`]);
    if (built.status !== 0) error = `cargo build --locked -p deep-show -p deep-hook --features deep-show/${BOOM_FEATURE} failed (exit ${built.status}):\n${tail(built.stderr)}`;
    else {
      dir = mkdtempSync(join(tmpdir(), 'deep-1415-bin-'));
      bin = join(dir, 'deep-show');
      copyFileSync(SHOW_BIN, bin);
      chmodSync(bin, 0o755);
    }
    const back = cargo(['build', '--locked', '-q', '-p', 'deep-show', '-p', 'deep-hook']);
    if (back.status !== 0 && !error) error = `cargo build --locked -p deep-show -p deep-hook (the default build, put back) failed:\n${tail(back.stderr)}`;
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => {
    expect(error, `BLOCKED: the test build of deep-show with the feature ${BOOM_FEATURE} (README: test-boom), which a frozen session needs, is built`).toBe('');
    return bin;
  };
}

/** The default build exists (README: Run); a test fails BLOCKED without it. */
export function defaultBinary(): string {
  expect(existsSync(SHOW_BIN), `BLOCKED: ${SHOW_BIN} is built (cargo build --locked -p deep-show; README: Run)`).toBe(true);
  return SHOW_BIN;
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`

const scratch: string[] = [];
/** A fresh evidence store root for one run, removed after the file. */
export function evidenceDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'deep-1415-ev-'));
  scratch.push(dir);
  return dir;
}
/** Removes the evidence roots this file made. */
export function useScratch(): void {
  afterAll(() => { for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }); });
}

export interface Played { ok: boolean; code: string | undefined; replies: JsonObject[]; evidence: string }
/**
 * One scenario through `<bin> run` (#393's JSON-lines convention): its replies, one per call, or `ok: false` with the code the
 * binary answered for the whole line (`bad_input` for an unknown call, field or planted value).
 */
export function play(bin: string, scenario: JsonObject): Played {
  const evidence = String(scenario['evidence']);
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1 << 30, timeout: 300_000, killSignal: 'SIGKILL' });
  if (run.error) throw Error(`deep-show run: ${run.error.message}`);
  if (run.status !== 0) throw Error(`deep-show run exited ${run.status ?? run.signal}: ${tail(run.stderr, 1500)}`);
  const line = run.stdout.split('\n').find((l) => l.trim() !== '');
  if (!line) throw Error('deep-show run printed no answer line');
  const out = JSON.parse(line) as JsonValue;
  if (!isObj(out)) throw Error(`deep-show run answered ${brief(out)}`);
  if (out['ok'] !== true) return { ok: false, code: typeof out['code'] === 'string' ? out['code'] : undefined, replies: [], evidence };
  const replies = Array.isArray(out['replies']) ? out['replies'].filter(isObj) : [];
  const calls = Array.isArray(scenario['calls']) ? scenario['calls'].length : -1;
  expect(replies.length, `deep-show run answers one reply per call: ${brief(out, 400)}`).toBe(calls);
  return { ok: true, code: undefined, replies, evidence };
}

// ---------------------------------------------------------------------------------------------------
// The world: two agents' sessions and one shared document on one panel (#96's `docs[…].document`)

/** The document the hub minted (26 Crockford characters). */
export const DOC = '01JB1415D00000000000000001';
/** Patch IDs, ULIDs. */
export const P = (n: number): string => `01JB1415P${String(n).padStart(17, '0')}`;
export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: doors', process: { pid: 4100, start: 1_000 } };
export const BRAVO = { id: 'sess-bravo', thread: 'thread-bravo', name: 'Codex: labels', process: { pid: 5200, start: 2_000 } };
const SESSIONS: JsonObject = Object.fromEntries([ALPHA, BRAVO].map((s) => [s.id, { thread: s.thread, name: s.name, process: s.process }]));
const PANELS: JsonObject = { main: { rect: [0, 0, 640, 360] } };
/** The writer layers the stored document holds, by ID. */
export const LAYER = { alpha: 'alpha-main', bravo: 'bravo-main' } as const;
/** A writer as a revision row names it, `<kind>:<id>`. */
export const ALPHA_WRITER = `agent:${ALPHA.thread}`;

const rect = (id: string, layer: string | null, name: string, order: string, box: number[], pos: [number, number], role = 'ink'): JsonObject => ({
  id, kind: 'rect@1', ...(layer ? { layer } : {}), name, order, params: { box, paint: { fill: { role } } }, at: { pos: [pos[0], pos[1], 0] },
});
/** The box each of alpha's items starts with, and the one the walk's whole revision and patch give the tag. */
export const BOX = { card: [0, 0, 60, 30], tag: [0, 0, 20, 10] };

/** test.boom@1's item (README: test-boom): its operator panics at a frame at or after `at`. */
const fuse = (layer: string | null): JsonObject => ({ id: 'fuse', kind: 'test.boom@1', ...(layer ? { layer } : {}), name: 'Fuse', order: 'a3', params: { at: '1s' } });

/**
 * The shared board, stored at revision 0: `door` in bravo's layer, `card` and `tag` in alpha's, and with `fuse` the
 * test.boom@1 item in alpha's layer, which only the test build knows.
 */
export function board(o: { fuse?: boolean } = {}): JsonObject {
  const items: JsonObject = {
    door: rect('door', LAYER.bravo, 'Door', 'a0', [0, 0, 120, 48], [40, 40], 'muted'),
    card: rect('card', LAYER.alpha, 'Card', 'a1', BOX.card, [200, 40]),
    tag: rect('tag', LAYER.alpha, 'Tag', 'a2', BOX.tag, [300, 40]),
  };
  if (o.fuse) items['fuse'] = fuse(LAYER.alpha);
  return {
    format: 1, profile: 'board', title: 'Doors',
    description: 'A board two test agents share: a door in one layer, a card and a tag in the other.', size: [640, 360],
    layers: {
      [LAYER.alpha]: { writer: ALPHA_WRITER, title: ALPHA.name, order: 'a1' },
      [LAYER.bravo]: { writer: `agent:${BRAVO.thread}`, title: BRAVO.name, order: 'a2' },
    },
    items,
  };
}

/** The scenario: the two sessions, the panel, the shared board at revision 0, and the calls. */
export function scenario(calls: JsonObject[], o: { fuse?: boolean; planted?: string; clock?: JsonObject } = {}): JsonObject {
  return {
    evidence: evidenceDir(), sessions: SESSIONS, panels: PANELS,
    docs: { [DOC]: { panel: 'main', document: board({ fuse: o.fuse === true }) } },
    ...(o.planted ? { planted: o.planted } : {}), ...(o.clock ? { clock: o.clock } : {}), calls,
  };
}

// ---- Calls (#393's and #96's, and this suite's `close` and `session_table`).

/** A patch by alpha's session (#96): its ops on the board, made on `base`. */
export const patch = (id: string, base: number, ops: JsonObject[]): JsonObject =>
  ({ call: 'deep_show', session: ALPHA.id, doc: DOC, patch: { patch: id, doc: DOC, base, reason: 'a #1415 test patch', ops } });
/** `set {id, path, value}`, the path written in the path grammar from the item. */
export const set = (id: string, field: string, value: JsonValue): JsonObject => ({ op: 'set', id, path: `items/${id}/${field}`, value });
export const create = (item: JsonObject): JsonObject => ({ op: 'create', item });
/** An undo by alpha of its patch `of`, as the new patch `id` (#96). */
export const undo = (id: string, of: string): JsonObject => ({ call: 'deep_show', session: ALPHA.id, doc: DOC, undo: { patch: id, of } });
/** A whole revision of alpha's layer (#393): its items, no layer field; the hub stamps the layer. */
export const whole = (items: JsonObject[]): JsonObject => ({
  call: 'deep_show', session: ALPHA.id, doc: DOC, include: ['issues'],
  document: { format: 1, profile: 'board', title: 'Doors', description: 'A board two test agents share: a door in one layer, a card and a tag in the other.', size: [640, 360], items: Object.fromEntries(items.map((i) => [String(i['id']), i])) },
});
export const alphaItems = (o: { card: number[]; tag: number[]; fuse: boolean }): JsonObject[] => [
  rect('card', null, 'Card', 'a1', o.card, [200, 40]), rect('tag', null, 'Tag', 'a2', o.tag, [300, 40]), ...(o.fuse ? [fuse(null)] : []),
];
export const revisions = (): JsonObject => ({ call: 'revisions', doc: DOC });
/** A frame of the document's session at `t` (#387's `eval`): live, so an operator's panic freezes the session as built. */
export const frame = (t: string): JsonObject => ({ call: 'eval', doc: DOC, t });
/** This suite's call that closes the document's session (README: Surface choices). */
export const close = (): JsonObject => ({ call: 'close', doc: DOC });
/** This suite's call that serves the state table (README: Surface choices). */
export const TABLE: JsonObject = { call: 'session_table' };
/** Hides or shows the document's panel (#383's `panel`). */
export const panel = (visible: boolean): JsonObject => ({ call: 'panel', panel: 'main', visible });
/** A render-back of revision 1 at 0 s, 64 × 36 px (#384's `render_back`, the hub's deep_show with no document). */
export const renderBack = (): JsonObject => ({ call: 'render_back', session: ALPHA.id, doc: DOC, t: 0, rev: 1, size: [64, 36] });
/** #411's deep_query by alpha's session, every row. */
export const query = (): JsonObject => ({ call: 'deep_query', session: ALPHA.id, doc: DOC });

// ---- Replies.

/** Every code a reply names: its own `code`, its `reason` (not_presented's), and each issue's `code`. */
export function codesOf(reply: JsonObject): string[] {
  const out: string[] = [];
  if (typeof reply['code'] === 'string') out.push(reply['code']);
  if (typeof reply['reason'] === 'string') out.push(reply['reason']);
  for (const i of Array.isArray(reply['issues']) ? reply['issues'] : []) if (isObj(i) && typeof i['code'] === 'string') out.push(i['code']);
  return out;
}
/** An outcome that says the call did what it asked. */
export const SUCCESS = ['applied', 'presented', 'evaluated', 'closed'];

export interface Row { rev: number; hash: string; state: string; writer: string | null; patches: string[] }
/** A `revisions` reply's rows (#393), the writer as `<kind>:<id>`. */
export function rowsOf(reply: JsonObject | undefined): Row[] | undefined {
  if (!reply || !Array.isArray(reply['revisions'])) return undefined;
  return reply['revisions'].filter(isObj).map((r) => {
    const w = r['writer'];
    return {
      rev: Number(r['rev']), hash: String(r['hash']), state: String(r['state']),
      writer: isObj(w) ? `${String(w['kind'])}:${String(w['id'])}` : null,
      patches: Array.isArray(r['patches']) ? r['patches'].map(String) : [],
    };
  });
}
export const currentOf = (rows: readonly Row[]): Row | undefined => rows.find((r) => r.state === 'current');
const rowText = (rows: readonly Row[] | undefined): string => (rows ? rows.map((r) => `${r.rev}:${r.state}:${r.hash.slice(0, 12)}`).join(', ') : 'none');
/** The same revisions, each with the same number, hash and state. */
export const sameRows = (a: readonly Row[] | undefined, b: readonly Row[] | undefined): boolean =>
  !!a && !!b && a.length === b.length && a.every((r, i) => r.rev === b[i]!.rev && r.hash === b[i]!.hash && r.state === b[i]!.state);
/** What changed between two `revisions` replies, for a message. */
export const rowsChange = (before: readonly Row[] | undefined, after: readonly Row[] | undefined): string => `before [${rowText(before)}], after [${rowText(after)}]`;

// ---------------------------------------------------------------------------------------------------
// The state table and the walk (AC3)

/** The six states of a document session (Document session), as the table names them. */
export const STATES = ['checking', 'live', 'refused', 'frozen', 'hidden', 'closed'] as const;
/** The session calls the table decides, by the names this suite gives them (README: The state table). */
export const CALLS = ['show', 'patch', 'undo', 'render_back', 'query', 'frame', 'close'] as const;
export type State = (typeof STATES)[number];
export type CallName = (typeof CALLS)[number];
export interface Cell { state: string; call: string; acts: boolean; code: string | null; why: string | null }

/** The served table read and held to its shape: every state against every call, one cell each, each acting or naming a code. */
export function readTable(reply: JsonObject): { cells: Cell[]; failures: string[] } {
  const failures: string[] = [];
  const names = (key: string): string[] => (Array.isArray(reply[key]) ? (reply[key] as JsonValue[]).map(String) : []);
  const sameSet = (got: string[], want: readonly string[]): boolean => got.length === want.length && want.every((w) => got.includes(w));
  if (!sameSet(names('states'), STATES)) failures.push(`the table's states are [${names('states').join(', ')}]; a document session has exactly ${STATES.join(', ')}`);
  if (!sameSet(names('calls'), CALLS)) failures.push(`the table's calls are [${names('calls').join(', ')}]; the walk makes exactly ${CALLS.join(', ')} (README: The state table)`);
  const cells: Cell[] = (Array.isArray(reply['cells']) ? reply['cells'] : []).filter(isObj).map((c) => ({
    state: String(c['state']), call: String(c['call']), acts: c['acts'] === true,
    code: typeof c['code'] === 'string' ? c['code'] : null, why: typeof c['why'] === 'string' ? c['why'] : null,
  }));
  for (const state of STATES) {
    for (const call of CALLS) {
      const found = cells.filter((c) => c.state === state && c.call === call);
      if (found.length !== 1) { failures.push(`the table has ${found.length} cells for (${state}, ${call}); it has one for every state and call`); continue; }
      const cell = found[0]!;
      if (cell.acts && cell.code !== null) failures.push(`the cell (${state}, ${call}) acts and names the code ${cell.code}; a cell either acts or names a code`);
      if (!cell.acts && (!cell.code || !cell.why)) failures.push(`the cell (${state}, ${call}) neither acts nor names a code and why: ${brief(cell)}`);
      if (!cell.acts && state === 'frozen' && cell.code !== 'session_frozen') failures.push(`the cell (frozen, ${call}) refuses with ${String(cell.code)}; a call to a frozen session is refused with session_frozen`);
      if (!cell.acts && state === 'closed' && cell.code !== 'session_closed') failures.push(`the cell (closed, ${call}) refuses with ${String(cell.code)}; a call to a closed session is refused with session_closed`);
    }
  }
  const at = (state: string, call: string): Cell | undefined => cells.find((c) => c.state === state && c.call === call);
  if (at('frozen', 'patch')?.code !== 'session_frozen') failures.push(`the cell (frozen, patch) is ${brief(at('frozen', 'patch'))}; a patch to a frozen session is refused with session_frozen`);
  if (at('closed', 'patch')?.code !== 'session_closed') failures.push(`the cell (closed, patch) is ${brief(at('closed', 'patch'))}; a patch to a closed session is refused with session_closed`);
  // Closing a closed session does nothing, so it is never answered with success (the walk's acting close can't tell).
  if (at('closed', 'close')?.code !== 'session_closed') failures.push(`the cell (closed, close) is ${brief(at('closed', 'close'))}; closing a closed session does nothing, so it is refused with session_closed`);
  return { cells, failures };
}

/** The virtual display clock the checking state is reached on (#96's `clock`): 60 Hz, a 2 ms lead, 0.1 s a check. */
const CLOCK: JsonObject = { refresh_hz: 60, lead: 1_411_200, check: 70_560_000 };
const SEC = 705_600_000;
/** When each call of the checking scenario arrives, in flicks: the walk's call comes while P2 is being checked. */
const AT = { p1: 0, frame: 0.2 * SEC, p2: 0.4 * SEC, call: 0.45 * SEC, after: 1 * SEC, revisions: 2 * SEC };
/** A call on the clock arrives at `t` (deep_query's arrival is `arrives`, as `deep-show canvas` stamps it). */
const arriving = (call: JsonObject, t: number): JsonObject => ({ ...call, [call['call'] === 'deep_query' ? 'arrives' : 'at']: t });

const P1 = P(1);
const P2 = P(2);
const WALK_PATCH = P(10);
const WALK_UNDO = P(11);
const AFTER_CLOSE = P(12);

interface Prefix { calls: JsonObject[]; clock: boolean; reached(replies: JsonObject[]): string | null }
/**
 * The calls that put the session in `state` (README: How the walk reaches each state): alpha's patch P1 makes revision 1 and a
 * frame at 0 s evaluates it; then hidden hides the panel, frozen evaluates a frame at 2 s (test.boom@1 panics), closed closes
 * the session, refused sends a whole revision that leaves the tag out, and checking, on the clock, has P2 in its check when the
 * walk's call arrives. `reached` says why the replies show the state wasn't reached, or null.
 */
function prefixOf(state: State): Prefix {
  const common = [patch(P1, 0, [set('card', 'params/box', [0, 0, 64, 30])]), frame('0s')];
  const base = (r: JsonObject[]): string | null =>
    r[0]?.['outcome'] !== 'applied' || r[0]?.['rev'] !== 1 ? `alpha's patch P1 wasn't applied as revision 1: ${brief(r[0])}`
      : r[1]?.['outcome'] !== 'evaluated' ? `the frame at 0 s wasn't evaluated: ${brief(r[1])}` : null;
  switch (state) {
    case 'live':
      return { calls: common, clock: false, reached: base };
    case 'hidden':
      return { calls: [...common, panel(false)], clock: false, reached: base };
    case 'frozen':
      return {
        calls: [...common, frame('2s')], clock: false,
        reached: (r) => base(r) ?? (r[2]?.['outcome'] === 'frozen' || codesOf(r[2] ?? {}).some((c) => c === 'session_frozen' || c === 'operator_panic') ? null : `the frame at 2 s didn't freeze the session (test.boom@1 panics there): ${brief(r[2])}`),
      };
    case 'closed':
      return { calls: [...common, close()], clock: false, reached: (r) => base(r) ?? (r[2]?.['outcome'] === 'closed' ? null : `close didn't close the session: ${brief(r[2])}`) };
    case 'refused':
      return {
        calls: [...common, whole(alphaItems({ card: [0, 0, 64, 30], tag: BOX.tag, fuse: true }).filter((i) => i['id'] !== 'tag'))], clock: false,
        reached: (r) => base(r) ?? (r[2]?.['outcome'] === 'refused' && codesOf(r[2] ?? {}).includes('unintended_removal') ? null : `the whole revision that leaves the tag out wasn't refused with unintended_removal: ${brief(r[2])}`),
      };
    case 'checking':
      return {
        calls: [arriving(common[0]!, AT.p1), arriving(common[1]!, AT.frame), arriving(patch(P2, 1, [set('card', 'params/box', [0, 0, 66, 30])]), AT.p2)], clock: true,
        reached: (r) => base(r) ?? (r[2]?.['outcome'] === 'applied' && r[2]?.['rev'] === 2 ? null : `alpha's patch P2 wasn't applied as revision 2: ${brief(r[2])}`),
      };
  }
}

/** The walk's call for `call` (README: The walk's calls); a close whose cell acts is followed by a patch, to show it closed. */
function walkCall(call: CallName, acts: boolean): JsonObject[] {
  switch (call) {
    case 'show': return [whole(alphaItems({ card: [0, 0, 64, 30], tag: [0, 0, 24, 10], fuse: true }))];
    case 'patch': return [patch(WALK_PATCH, 1, [set('tag', 'params/box', [0, 0, 24, 10])])];
    case 'undo': return [undo(WALK_UNDO, P1)];
    case 'render_back': return [renderBack()];
    case 'query': return [query()];
    case 'frame': return [frame('0s')];
    case 'close': return acts ? [close(), patch(AFTER_CLOSE, 1, [set('tag', 'params/box', [0, 0, 26, 10])])] : [close()];
  }
}

/** One state's scenario: its prefix, then `extra` (the walk's call, or nothing for the baseline), then `revisions`. */
function stateScenario(state: State, extra: JsonObject[]): JsonObject {
  const prefix = prefixOf(state);
  if (!prefix.clock) return scenario([...prefix.calls, ...extra, revisions()], { fuse: true });
  const timed = [...prefix.calls, ...extra.map((c, i) => arriving(c, i === 0 ? AT.call : AT.after)), arriving(revisions(), AT.revisions)];
  return scenario(timed, { fuse: true, clock: CLOCK });
}

/** What shows that `call` acted (README: What acting means), or why it didn't. */
function actedFailure(call: CallName, replies: JsonObject[], at: number, before: Row[], after: Row[], evidence: string): string | null {
  const reply = replies[at]!;
  const added = after.filter((r) => !before.some((b) => b.rev === r.rev && b.hash === r.hash));
  const madeOne = (patchId?: string): string | null => {
    const row = added.find((r) => r.rev === reply['rev']);
    if (!row) return `no new revision numbered ${brief(reply['rev'])} is listed (${rowsChange(before, after)})`;
    if (row.writer !== ALPHA_WRITER) return `the new revision ${row.rev} is written by ${String(row.writer)}, not alpha`;
    if (patchId && !row.patches.includes(patchId)) return `the new revision ${row.rev} doesn't list the patch ${patchId}`;
    return null;
  };
  switch (call) {
    case 'show': return madeOne();
    case 'patch': return reply['outcome'] !== 'applied' ? `it answered ${brief(reply)}` : madeOne(WALK_PATCH);
    case 'undo': return reply['outcome'] !== 'applied' ? `it answered ${brief(reply)}` : madeOne(WALK_UNDO);
    case 'render_back': {
      const snaps = Array.isArray(reply['snapshots']) ? reply['snapshots'].filter(isObj) : [];
      if (reply['outcome'] !== 'presented' || snaps.length === 0) return `it answered ${brief(reply)}, with no snapshot`;
      const missing = snaps.map((s) => String(s['sha256'])).filter((sha) => !existsSync(join(evidence, sha.slice(0, 2), sha.slice(2))));
      return missing.length ? `its snapshots ${missing.join(', ')} aren't in the evidence store` : null;
    }
    case 'query': {
      const rows = Array.isArray(reply['rows']) ? reply['rows'].filter(isObj) : [];
      return typeof reply['rev'] === 'number' && rows.some((r) => r['id'] === 'card') ? null : `it answered ${brief(reply)}, with no rows of the board`;
    }
    case 'frame': {
      const nodes = Array.isArray(reply['nodes']) ? reply['nodes'] : [];
      return reply['outcome'] === 'evaluated' && nodes.length > 0 ? null : `it answered ${brief(reply)}, evaluating nothing`;
    }
    case 'close': {
      if (reply['outcome'] !== 'closed') return `it answered ${brief(reply)}`;
      const next = replies[at + 1]!;
      return codesOf(next).includes('session_closed') && next['outcome'] !== 'applied' ? null : `the patch after it wasn't refused with session_closed, so the session didn't close: ${brief(next)}`;
    }
  }
}

/**
 * The walk (AC3): for every state, its baseline scenario and one scenario per call of the table; each call either acts as its
 * cell says or answers the cell's code, claims no success and changes no revision. Every failure names the state and the call.
 */
export function walk(bin: string, cells: Cell[]): string[] {
  const failures: string[] = [];
  for (const state of STATES) {
    const prefix = prefixOf(state);
    const baseline = play(bin, stateScenario(state, []));
    if (!baseline.ok) { failures.push(`(${state}) deep-show run answered ${String(baseline.code)} for the scenario that reaches ${state}: ${brief(stateScenario(state, []).calls, 300)}`); continue; }
    const notReached = prefix.reached(baseline.replies);
    if (notReached) { failures.push(`(${state}) the scenario didn't reach ${state}: ${notReached}`); continue; }
    const before = rowsOf(baseline.replies.at(-1)) ?? [];
    for (const call of CALLS) {
      const cell = cells.find((c) => c.state === state && c.call === call);
      if (!cell) continue;
      const run = play(bin, stateScenario(state, walkCall(call, cell.acts)));
      if (!run.ok) { failures.push(`(${state}, ${call}) deep-show run answered ${String(run.code)} for the scenario with this call`); continue; }
      const at = prefix.calls.length;
      const reply = run.replies[at]!;
      const after = rowsOf(run.replies.at(-1)) ?? [];
      if (cell.acts) {
        const why = actedFailure(call, run.replies, at, before, after, run.evidence);
        if (why) failures.push(`(${state}, ${call}) its cell acts, but the call didn't: ${why}`);
        continue;
      }
      const codes = codesOf(reply);
      if (!codes.includes(cell.code!)) failures.push(`(${state}, ${call}) its cell refuses with ${cell.code}, but the reply names [${codes.join(', ')}]: ${brief(reply)}`);
      if (SUCCESS.includes(String(reply['outcome']))) failures.push(`(${state}, ${call}) its cell refuses with ${cell.code}, but the reply answers ${String(reply['outcome'])}, a success for a call that did nothing: ${brief(reply)}`);
      if (!sameRows(before, after)) failures.push(`(${state}, ${call}) refused with ${cell.code}, it still changed the revisions: ${rowsChange(before, after)}`);
    }
  }
  return failures;
}
