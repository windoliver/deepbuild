// Test-side tools for the blind redraft of #504's criterion 2 (#504.3b622b2f): a real hub (`deep hub run`) in a temporary home
// with #806's world file (DEEP_HUB_TEST_SHOW), one Claude Code agent stand-in in a session of its own whose `deep mcp` and
// `deep show` are its children, and the one flow the criterion reads: the agent files a claim and an ask, the hub's world names
// four documents minted for them (a figure and a film on each), the agent shows all four with deep_show and checks the figure on
// its claim against that claim with `deep show --check --claim`. What the hub says then is read through `inbox.read` (Needs
// you), `ask.card` (the opened ask), `changes.read` (the claim's receipt) and `events.read` (the record). Each check returns
// its failures as sentences; an empty list is a pass. Processes are stopped by PID (#806's cleanup).
//
// Reused by import: #806's helpers (the hub and its seams, the world file, the agent stand-in, deep_show and `deep show`, the
// figure), and through them #26's (worktrees, the MCP client, the record) and #393's (document builders, the build).

import { join } from 'node:path';
import { beforeAll, expect } from 'vitest';
import {
  FIGURE, Stand, World, deepShow, deepShowCli, hubCall, makeHome, sleep, snapsOf, startHub, t26, t393, uuidOf,
  type JsonObject, type Line,
} from '../806/helpers.ts';

export { cleanup, sleep } from '../806/helpers.ts';
export type { Line } from '../806/helpers.ts';

// ---------------------------------------------------------------------------------------------------
// The planted hubs (README: Planted programs), selected with DEEP_HUB_PLANT, the hub's existing plant option.

/** A hub that puts each figure or film an agent shows on its ask or claim in Needs you. */
export const PLANT_NEEDS_YOU = 'figure-in-needs-you';
/** A hub that takes an agent's figure or film on its claim as proof: a verdict on the claim from its document check. */
export const PLANT_VERDICT = 'figure-feeds-verdict';

/** How long the honest hub is given after the last call before what it says is read once. */
export const SETTLE_MS = 1500;
/** How long a planted hub is given to show its wrong behaviour, read every 500 ms. */
export const PLANTED_MS = 15_000;

// ---------------------------------------------------------------------------------------------------
// The canvas core the hub runs (`deep-show canvas`): built once per file.

/** Builds `deep-show` once per file; the returned check fails a test, naming the build, when it didn't build. */
export function useCanvasCore(): () => void {
  let error = 'not built';
  beforeAll(() => { error = t393.buildBinary(t393.SHOW_NAME); }, 3_600_000);
  return () => expect(error, `the hub's canvas core builds: cargo build --locked --bin ${t393.SHOW_NAME}`).toBe('');
}

// ---------------------------------------------------------------------------------------------------
// The agent, its documents and what it sends

export const AGENT = { label: '504-ac2-claude-code', name: 'Claude Code: release page' };
export const SESSION = uuidOf(AGENT.label);

/** Doc IDs the hub minted (Document envelope: `id`, minted by the hub), 26 letters and digits as deep_show takes them. */
const docId = (n: number): string => `01JB504${String(n).padStart(19, '0')}`;
export const DOCS = { figAsk: docId(1), filmAsk: docId(2), figClaim: docId(3), filmClaim: docId(4) } as const;
export const ALL_DOCS: readonly string[] = Object.values(DOCS);
/** What each document is, for failure messages. */
export const WHAT: Readonly<Record<string, string>> = {
  [DOCS.figAsk]: "the agent's figure on its ask",
  [DOCS.filmAsk]: "the agent's film on its ask",
  [DOCS.figClaim]: "the agent's figure on its claim",
  [DOCS.filmClaim]: "the agent's film on its claim",
};

/** A figure (profile `figure`): #806's six-item release figure. */
export const FIGURE_DOC: JsonObject = { ...FIGURE, profile: 'figure', title: 'Release readiness', description: 'A figure an agent shows to explain its change.' };
/** The same figure with its caption changed: what the agent checks against its claim, so the check makes a revision of its own. */
export const FIGURE_CHECKED: JsonObject = {
  ...FIGURE_DOC,
  items: { ...(FIGURE_DOC['items'] as JsonObject), caption: t393.label('caption', 'Caption', 'Checked against the claim', [16, 160], 'a5') },
};
/** A film (profile `film`, a 2 s transport) of three bars. */
export const FILM_DOC: JsonObject = {
  format: 1, profile: 'film', title: 'Release walk-through', description: 'A film an agent shows to explain its change.', size: [320, 200],
  transport: { span: '2s' },
  items: Object.fromEntries([
    t393.rect('back', 'Backdrop', [0, 0, 320, 200], 'a0', 'ground'),
    t393.rect('bar-build', 'Build bar', [16, 60, 240, 16], 'a1'),
    t393.rect('bar-tests', 'Tests bar', [16, 90, 180, 16], 'a2'),
  ].map((item) => [String(item['id']), item])),
};
/** Each deep_show's render-back request: a snapshot of the document's size at 0 s, with its issues. */
const SHOW = { t: '0s', size: [320, 200], include: ['issues', 'pixels'] };

/** The agent's ask: a choice with a recommended option. */
export const QUESTION = 'Which layout should the release page use, the chart on the left or on the right?';
const ASK_ARGS: Line = {
  kind: 'choice', question: QUESTION,
  options: [{ id: 'left', label: 'Chart on the left' }, { id: 'right', label: 'Chart on the right' }],
  recommended: 'left', steps: null, where: null, why: null, check: null, thread: null, subject: null,
};

// ---------------------------------------------------------------------------------------------------
// The world: the hub with its world file, a worktree, the agent's session

export interface Ac2World { tmp: string; home: string; hub: t26.Hub; world: World; stand: Stand }

/** The hub (planted when `plant` names one), the agent established through its hooks, its deep mcp initialized. */
export async function openWorld(plant?: string): Promise<Ac2World> {
  const { tmp, home } = makeHome();
  const world = new World(join(tmp, 'world.json'), { names: { [SESSION]: AGENT.name }, panels: t393.PANELS });
  const hub = await startHub(home, { world: world.path, ...(plant ? { plant } : {}) });
  const work = t26.makeWorktree(join(tmp, 'work'));
  const stand = Stand.start(home, work.path, 'claude-code', SESSION, plant ? { DEEP_HUB_PLANT: plant } : {});
  await stand.establish(hub);
  await t26.initialize(stand);
  return { tmp, home, hub, world, stand };
}

// ---------------------------------------------------------------------------------------------------
// The flow

export interface Flow {
  claim: string;
  ask: string;
  /** The documents on the ask and on the claim, as the world file names them. */
  onAsk: string[];
  onClaim: string[];
  /** Each document's newest revision, as the agent's calls' replies named it. */
  revs: Record<string, number>;
  /** Every snapshot hash the replies named. */
  shas: string[];
  /** `deep show --check --claim <claim>`'s reply for the figure on the claim, run in the agent's process tree. */
  checked: JsonObject;
  /** What the hub said before the agent showed anything: inbox.read, and changes.read's `change` for the claim. */
  before: { inbox: Line; change: Line };
  /** The record's last log position before the first deep_show. */
  mark: number;
}

const isObj = (v: unknown): v is Line => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown): Line[] => (Array.isArray(v) ? v.filter(isObj) : []);
const changeOf = (reply: Line, claim: string): Line => {
  if (!isObj(reply['change'])) throw Error(`BLOCKED: changes.read gave no change for ${claim}: ${JSON.stringify(reply).slice(0, 600)}`);
  return reply['change'];
};
const askHandles = (inbox: Line): Set<string> => new Set(list(inbox['asks']).map((a) => String(a['ask'])));

/** One deep_show through the agent's deep mcp; BLOCKED unless presented at a revision. */
async function show(w: Ac2World, flow: { revs: Record<string, number>; shas: string[] }, doc: string, document: JsonObject): Promise<void> {
  const { reply } = await deepShow(w.stand, { doc, document, ...SHOW }, `deep_show of ${WHAT[doc]}`);
  if (reply['outcome'] !== 'presented' || typeof reply['rev'] !== 'number') throw Error(`BLOCKED: deep_show of ${WHAT[doc]} (${doc}) was not presented at a revision: ${JSON.stringify(reply).slice(0, 600)}`);
  flow.revs[doc] = Math.max(flow.revs[doc] ?? 0, reply['rev']);
  flow.shas.push(...snapsOf(reply).map((s) => s.sha256));
}

/**
 * The agent files a claim and an ask; the world file names the four documents the hub minted for them (README: Seams), and
 * the claim as one whose definition names no deliverable; the agent shows a figure and a film on each, then checks the
 * figure on its claim against the claim. The ask's handle is read from the record's ask.created, never from deep_ask's
 * return, so the flow holds whether deep_ask returns at once (provisional, as at the base) or waits for an answer.
 */
export async function runFlow(w: Ac2World): Promise<Flow> {
  const { hub, stand, world } = w;
  const made = t26.valueOf(await t26.callTool(stand, 'deep_claim', t26.claimArgs()), 'deep_claim of the agent session');
  const claim = String(made?.claim);
  if (!/^claim:[0-9A-Za-z]+$/.test(claim)) throw Error(`BLOCKED: deep_claim named no claim: ${JSON.stringify(made).slice(0, 600)}`);

  const asked = t26.pending(t26.callTool(stand, 'deep_ask', ASK_ARGS));
  const created = await t26.eventMatching(hub, (e) => e.kind === 'ask.created' && e.data?.question === QUESTION, 30_000);
  if (!created) {
    const out = await Promise.race([asked, sleep(1000).then(() => undefined)]);
    throw Error(`BLOCKED: the agent's deep_ask filed no ask in 30 s: ${out ? (out.failed ?? JSON.stringify(out.returned?.reply).slice(0, 600)) : 'the call is still waiting'}`);
  }
  if (created.session !== SESSION) throw Error(`BLOCKED: the agent's ask was filed under session ${String(created.session)}, not ${SESSION}`);
  const ask = `ask:${created.id}`;

  const onAsk = [DOCS.figAsk, DOCS.filmAsk];
  const onClaim = [DOCS.figClaim, DOCS.filmClaim];
  world.set({
    docs: Object.fromEntries([...onAsk.map((d) => [d, { panel: 'main', on: ask }]), ...onClaim.map((d) => [d, { panel: 'main', on: claim }])]),
    claims: { [claim]: { session: SESSION, deliverables: [] } },
  });

  const before = { inbox: await hubCall(hub, 'inbox.read'), change: changeOf(await hubCall(hub, 'changes.read', { id: claim }), claim) };
  if (!askHandles(before.inbox).has(ask)) throw Error(`BLOCKED: inbox.read doesn't list the agent's own ask ${ask}: ${JSON.stringify(before.inbox).slice(0, 600)}`);
  const mark = Math.max(0, ...(await t26.events(hub)).map((e) => e.log_pos));

  const flow = { revs: {} as Record<string, number>, shas: [] as string[] };
  await show(w, flow, DOCS.figAsk, FIGURE_DOC);
  await show(w, flow, DOCS.filmAsk, FILM_DOC);
  await show(w, flow, DOCS.figClaim, FIGURE_DOC);
  await show(w, flow, DOCS.filmClaim, FILM_DOC);

  // The agent asks DeepBuild to check its figure against its claim, from its own process tree (`deep show` acts as its session).
  // Only a presented revision becomes the document's newest; a refused one's `rev` names the revision its issues are of.
  const { reply: checked } = await deepShowCli(w.home, w.tmp, stand, { doc: DOCS.figClaim, document: FIGURE_CHECKED, ...SHOW, check: true, claim });
  if (checked['outcome'] === 'presented' && typeof checked['rev'] === 'number') flow.revs[DOCS.figClaim] = Math.max(flow.revs[DOCS.figClaim] ?? 0, checked['rev']);
  flow.shas.push(...(Array.isArray(checked['snapshots']) ? snapsOf(checked) : []).map((s) => s.sha256));

  return { claim, ask, onAsk, onClaim, revs: flow.revs, shas: flow.shas, checked, before, mark };
}

// ---------------------------------------------------------------------------------------------------
// What the hub says after the flow

export interface Observed {
  /** inbox.read: the asks and rows Needs you lists. */
  inbox: Line;
  /** changes.read's `change` for the claim: its receipt. */
  change: Line;
  /** ask.card for the agent's ask: the opened ask's card. */
  card: Line;
  /** Every event the record appended after the mark. */
  after: t26.Ev[];
}

export async function observe(w: Ac2World, flow: Flow): Promise<Observed> {
  const inbox = await hubCall(w.hub, 'inbox.read');
  const change = changeOf(await hubCall(w.hub, 'changes.read', { id: flow.claim }), flow.claim);
  const card = await hubCall(w.hub, 'ask.card', { ask: flow.ask });
  const after = (await t26.events(w.hub)).filter((e) => e.log_pos > flow.mark);
  return { inbox, change, card, after };
}

/** What a planted hub says once its wrong behaviour shows: read every 500 ms until `check` fails or PLANTED_MS pass. */
export async function untilFailing(w: Ac2World, flow: Flow, check: (o: Observed) => string[]): Promise<string[]> {
  const deadline = Date.now() + PLANTED_MS;
  for (;;) {
    const failures = check(await observe(w, flow));
    if (failures.length > 0 || Date.now() > deadline) return failures;
    await sleep(500);
  }
}

// ---------------------------------------------------------------------------------------------------
// The checks. Each returns its failures as sentences, naming the document, ask or claim; an empty list is a pass.

const named = (text: string, doc: string): boolean => text.toUpperCase().includes(doc.toUpperCase());

/**
 * Never in Needs you: inbox.read lists no ask and no row that wasn't there before the agent showed anything, its reply names
 * none of the four documents nor any snapshot of them, and the record holds no ask.created filed after the first deep_show.
 */
export function needsYouFailures(flow: Flow, o: Observed): string[] {
  const failures: string[] = [];
  const had = askHandles(flow.before.inbox);
  for (const a of list(o.inbox['asks'])) {
    if (!had.has(String(a['ask']))) failures.push(`inbox.read lists ${String(a['ask'])} ("${String(a['question'] ?? '').slice(0, 200)}"), which wasn't there before the agent showed its figures and films`);
  }
  const rowsHad = new Set(list(flow.before.inbox['rows']).map((r) => String(r['id'])));
  for (const r of list(o.inbox['rows'])) {
    if (!rowsHad.has(String(r['id']))) failures.push(`Needs you's rows (inbox.read rows) gained ${String(r['id'])}, which wasn't there before the agent showed its figures and films: ${JSON.stringify(r).slice(0, 300)}`);
  }
  const text = JSON.stringify(o.inbox);
  for (const doc of ALL_DOCS) if (named(text, doc)) failures.push(`inbox.read names ${doc}, ${WHAT[doc]}: it appears in Needs you`);
  for (const sha of new Set(flow.shas)) if (text.includes(sha)) failures.push(`inbox.read names the snapshot ${sha} of an agent's figure or film: it appears in Needs you`);
  for (const e of o.after) {
    if (e.kind === 'ask.created') failures.push(`the record holds ask.created ask:${e.id} ("${String(e.data?.question ?? '').slice(0, 200)}"), filed after the agent showed its figures and films`);
  }
  return failures;
}

/**
 * Never feeds a verdict: the claim's receipt (changes.read) has the same runs, verdicts, checks and line as before the agent
 * showed its figure and film on it and checked the figure against it, names none of the four documents among them, the
 * record holds no verdict.* or run.* event about the claim or a document filed after the first deep_show, and the check
 * the agent asked for isn't PASS, since the claim names no deliverable.
 */
export function verdictFailures(flow: Flow, o: Observed): string[] {
  const failures: string[] = [];
  for (const key of ['runs', 'verdicts', 'checks'] as const) {
    const was = JSON.stringify(flow.before.change[key] ?? null);
    const now = JSON.stringify(o.change[key] ?? null);
    if (was !== now) failures.push(`changes.read's ${key} for ${flow.claim} changed after the agent showed its figure and film on it: was ${was.slice(0, 400)}, now ${now.slice(0, 400)}`);
  }
  if (flow.before.change['line'] !== o.change['line']) {
    failures.push(`the verdict line of ${flow.claim} changed after the agent showed its figure and film on it: was ${JSON.stringify(flow.before.change['line'])}, now ${JSON.stringify(o.change['line'])}`);
  }
  const proof = JSON.stringify({ runs: o.change['runs'] ?? null, verdicts: o.change['verdicts'] ?? null, checks: o.change['checks'] ?? null });
  for (const doc of ALL_DOCS) if (named(proof, doc)) failures.push(`changes.read's runs, verdicts or checks for ${flow.claim} name ${doc}, ${WHAT[doc]}`);
  const id = flow.claim.slice('claim:'.length);
  for (const e of o.after) {
    if (!/^(verdict|run)\./.test(e.kind)) continue;
    const about = JSON.stringify([e.subject ?? null, e.data ?? null]);
    if (about.includes(id) || ALL_DOCS.some((d) => named(about, d))) failures.push(`the record holds ${e.kind} ${e.id} on ${flow.claim} or a figure of it, filed after the agent showed its figure and film: ${about.slice(0, 400)}`);
  }
  if (flow.checked['result'] === 'PASS') {
    failures.push(`deep show --check --claim ${flow.claim} of ${DOCS.figClaim}, run in the agent's process tree, answered PASS, though ${flow.claim} names no deliverable: the figure fed its verdict`);
  }
  return failures;
}

/**
 * The documents a section lists, each `{doc, rev}`: exactly the ones the agent showed there, once each, at the newest revision
 * its calls presented. `doc` may be the doc ID or `doc:<ID>`, in any case.
 */
function placedFailures(where: string, section: unknown, expected: readonly string[], revs: Readonly<Record<string, number>>): string[] {
  const failures: string[] = [];
  const entries = list(section).map((e) => ({ doc: String(e['doc'] ?? '').replace(/^doc:/i, '').toUpperCase(), rev: e['rev'] as unknown }));
  if (Array.isArray(section) && entries.length !== section.length) failures.push(`${where} holds entries that aren't {doc, rev} objects: ${JSON.stringify(section).slice(0, 400)}`);
  for (const doc of expected) {
    const found = entries.filter((e) => e.doc === doc.toUpperCase());
    if (found.length !== 1) failures.push(`${where} lists ${doc}, ${WHAT[doc]}, ${found.length} times, not once`);
    else if (found[0]!.rev !== revs[doc]) failures.push(`${where} names ${doc}, ${WHAT[doc]}, at revision ${JSON.stringify(found[0]!.rev)}, not ${String(revs[doc])}, the newest the agent showed`);
  }
  for (const e of entries) {
    if (!expected.some((d) => d.toUpperCase() === e.doc)) failures.push(`${where} lists ${JSON.stringify(e.doc)}${WHAT[e.doc] ? `, ${WHAT[e.doc]}` : ''}, which the agent didn't show there`);
  }
  return failures;
}

/** Beside the opened ask: ask.card's `beside` lists the figure and film on the ask, and nothing shown on the claim. */
export function besideFailures(flow: Flow, o: Observed): string[] {
  const where = `ask.card's beside for ${flow.ask}`;
  if (!Array.isArray(o.card['beside'])) return [`ask.card's reply for ${flow.ask} holds no beside list, the agents' figures and films shown on the ask (its keys: ${Object.keys(o.card).join(', ')})`];
  return placedFailures(where, o.card['beside'], flow.onAsk, flow.revs);
}

/** The receipt's explains-never-proves section: changes.read's `change.explains` lists the figure and film on the claim, and nothing shown on the ask. */
export function explainsFailures(flow: Flow, o: Observed): string[] {
  const where = `changes.read's explains for ${flow.claim}`;
  if (!Array.isArray(o.change['explains'])) return [`changes.read's change for ${flow.claim} holds no explains section, the agents' figures and films shown on the claim (its keys: ${Object.keys(o.change).join(', ')})`];
  return placedFailures(where, o.change['explains'], flow.onClaim, flow.revs);
}

/** A failure that names one of the agent's documents, or an ask other than the agent's own. */
export const namesDocOrAsk = (flow: Flow) => (failure: string): boolean =>
  ALL_DOCS.some((d) => named(failure, d)) || [...failure.matchAll(/ask:[0-9A-Za-z]+/g)].some((m) => m[0] !== flow.ask);
