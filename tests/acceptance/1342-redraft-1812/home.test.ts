// AC2 and AC6 of #1342, redrafted blind after #1812 (REDRAFT.md). They are the two tests of
// tests/acceptance/1342/home.test.ts that run its trip world, whose fixture project "Family trips" is made with #67's
// `deep workspace new`. Under #1812 that command prints a sentence, and the object it printed before only with `--json`
// (#1812's Scope, fifth item; the design's deep CLI row). The one change is that call, now `deep workspace new "Family
// trips" --json`, read as before. Every other line is the frozen file's: its scenes, research answers, plant,
// judgements and assertions. The helpers and the fixture forge are the frozen suite's, imported by path, unchanged.
//
// As the frozen file says it: where a project lives and when it is made. One world sends "a small site that tracks my
// reading list" through the app's box while its research job waits, reads the list between Send and the card, approves
// the card and reads the repo the forge was asked for (AC2). A second world, holding a workspace "Family trips", sends
// the trip sentence of AC2 and approves it as a new project (AC2), then a weekend in Porto that the research answer says
// fits "Family trips", answered with it (AC6). The planted flow runs in a world of its own and meets the same judgement
// as the right program.
import { expect, test } from 'vitest';
import {
  askLine, iso, MIN, must, mustFail, named, PLANT, shown, sleep, waitUntil, World,
  type Answer, type Card, type Ev, type Frame, type Line, type Ran, type Sent,
} from '../1342/helpers.ts';
import type { Made } from '../1342/forge.ts';

const SITE = 'a small site that tracks my reading list';
const TRIP = 'plan a five-day trip for four people under $4,000';
const PORTO = 'plan a weekend in Porto for four people under $1,500';
const FAMILY = 'Family trips';

const SITE_ANSWER: Answer = {
  makes: 'site',
  lines: [
    { id: 'L1', field: 'makes', text: 'A small website that tracks a reading list', cites: [{ at: 'words', quote: 'a small site' }] },
    { id: 'L2', field: 'for', text: 'The person who reads the books', cites: [{ at: 'words', quote: 'my reading list' }] },
    { id: 'L3', field: 'holds', text: 'Add a book, mark it read, and see the whole list', cites: [{ at: 'words', quote: 'tracks my reading list' }] },
    { id: 'L4', field: 'proves', text: 'A book you add shows on the list', cites: [{ at: 'words', quote: 'tracks my reading list' }] },
  ],
  promises: [{ line: 'L4', kind: 'code' }, { line: 'L3', kind: 'code' }],
  tasks: [{ title: 'Build the reading list page', serves: ['L3', 'L4'] }],
  held: [],
  fits: null,
};
const trip = (words: string, fits: string | null): Answer => ({
  makes: 'plan',
  lines: [
    { id: 'L1', field: 'makes', text: `A day-by-day plan: ${words}`, cites: [{ at: 'words', quote: words.split(' for ')[0]! }] },
    { id: 'L2', field: 'for', text: 'Four people travelling together', cites: [{ at: 'words', quote: 'for four people' }] },
    { id: 'L3', field: 'proves', text: `The whole trip costs ${words.slice(words.indexOf('under'))}`, cites: [{ at: 'words', quote: words.slice(words.indexOf('under')) }] },
  ],
  promises: [{ line: 'L3', kind: 'money' }, { line: 'L1', kind: 'document' }],
  tasks: [{ title: 'Pick where to stay', serves: ['L1', 'L3'] }, { title: 'Plan each day', serves: ['L1'] }],
  held: [],
  fits,
});

// ---- The judgements, the same for the right program and the planted one.

/** AC2: from Send until the card, the only ask raised is the card itself. */
function onlyTheCard(events: readonly Ev[], from: number, card: Card | undefined): void {
  const asked = events.filter((e) => e.kind === 'ask.created' && e.ts >= from && (!card || e.ts <= card.at) && `ask:${e.id}` !== card?.ask);
  must(!asked.length, `the flow asked before its card: ${asked.map(askLine).join('; ')}`);
}
/** AC2's "no forge call": nothing written to the forge from `from` on (README: readings). */
function noForgeWrite(w: World, from: number): void {
  const writes = w.forge.writes().filter((c) => c.at >= from);
  must(!writes.length, `the flow called the forge: ${writes.map((c) => `${c.line} at ${iso(c.at)}`).join('; ')}`);
}

// ---- The worlds.

/** The list's rows every two seconds for 20 seconds, while the research job waits for its go. */
async function framesWhile(w: World): Promise<Frame[]> {
  const frames: Frame[] = [];
  const end = Date.now() + 20_000;
  for (let i = 1; Date.now() < end; i++) { frames.push(await w.frame(i)); await sleep(2000); }
  return frames;
}
interface Site {
  w: World; sent: Sent; reply: Line; frames: Frame[]; before: string[]; card?: Card;
  approval?: { at: number; folders: string[] }; repo?: Made;
}
/** The site sent through the box, its list read while the research job waits, its card approved, and the repo it makes. */
async function siteScene(plant?: string): Promise<Site> {
  const w = await World.open(plant ? { plant } : {});
  w.answers([{ match: SITE, answer: SITE_ANSWER, gate: 'go-site' }]);
  const before = w.workspaceFolders();
  const { sent, reply } = await w.box(SITE);
  const s: Site = { w, sent, reply, frames: [], before };
  if (reply.error || reply.unread) return s;
  s.frames = await framesWhile(w);
  w.go('go-site');
  if (plant) return s;
  const card = await w.card(sent);
  if (!card) return s;
  s.card = card;
  const folders = w.workspaceFolders();
  const { at } = await w.approve(card);
  s.approval = { at, folders };
  const repo = await waitUntil(() => w.forge.repos.find((r) => r.at >= at), 5 * MIN, 1000);
  if (repo) s.repo = repo;
  await sleep(10_000);
  return s;
}
let site: Promise<Site> | undefined;

interface Trips {
  w: World; family?: { id: string; folder: string }; sent?: Sent; ran?: Ran; card?: Card; approval?: number; made?: { id: string; folder: string };
  porto?: { sent: Sent; ran?: Ran; card?: Card };
}
/** A world holding "Family trips"; the trip sentence sent with `deep`, its card approved as a new project. */
async function tripScene(): Promise<Trips> {
  const w = await World.open();
  // The redraft's one change (REDRAFT.md): `deep workspace` prints a sentence, and its object only with --json (#1812).
  const ws = await w.deep(['workspace', 'new', FAMILY, '--json']);
  must(ws.code === 0 && typeof ws.json?.id === 'string', `BLOCKED: #67's deep workspace new "${FAMILY}" --json makes the fixture's project: ${shown(ws)}`);
  const family = { id: String(ws.json!.id), folder: String(ws.json!.folder) };
  w.answers([{ match: TRIP, answer: trip(TRIP, null) }, { match: PORTO, answer: trip(PORTO, family.id) }]);
  const t: Trips = { w, family };
  t.sent = await w.send(TRIP);
  const card = await w.card(t.sent);
  const ran = await Promise.race([t.sent.done!, sleep(60_000).then(() => undefined)]);
  if (ran) t.ran = ran;
  if (!card) return t;
  t.card = card;
  t.approval = (await w.approve(card, { besides: FAMILY })).at;
  const made = await waitUntil(async () => w.workspacesMade(await w.events(), t.approval!)[0], 5 * MIN, 2000);
  if (made) t.made = { id: made.id, folder: made.folder };
  await sleep(30_000);
  return t;
}
let trips: Promise<Trips> | undefined;

test(`${named(2)} (redraft 1812)`, async () => {
  // The site: a repo.
  const s = await (site ??= siteScene());
  expect(s.reply.unread ?? s.reply.error, `the box takes your words with no project shown: ${JSON.stringify(s.reply)}`).toBeUndefined();
  expect(s.card, 'the site reaches its card').toBeDefined();
  onlyTheCard(await s.w.events(), s.sent.at, s.card);
  expect(s.repo, `"${SITE}" makes a repo: a repo made on the forge after the approval (${s.w.forge.writes().map((c) => c.line).join(', ') || 'no writes'})`).toBeDefined();

  // The trip: a workspace, no repo, no forge call.
  const t = await (trips ??= tripScene());
  expect(t.ran?.code, `deep "${TRIP}" --json reaches the card: ${t.ran ? shown(t.ran) : 'still running'}`).toBe(0);
  expect(t.card, 'the trip reaches its card').toBeDefined();
  onlyTheCard(await t.w.events(), t.sent!.at, t.card);
  expect(t.made, `"${TRIP}" makes a workspace: a workspace.created after the approval`).toBeDefined();
  expect(t.w.forge.repos.map((r) => r.full_name), 'and no repo').toEqual([]);
  noForgeWrite(t.w, t.sent!.at);

  // The planted flow asks which.
  const p = await World.open({ plant: PLANT.asks });
  p.answers([{ match: TRIP, answer: trip(TRIP, null) }]);
  const sent = await p.send(TRIP);
  const first = await waitUntil(async () => p.asksIn(await p.events(), sent.at)[0] ?? (sent.ran ? 'none' : undefined), 10 * MIN, 1000);
  expect(first !== undefined && first !== 'none', 'the planted flow asked nothing, so it proves nothing').toBe(true);
  const ask = first as Ev;
  await mustFail('a flow that asks which', async () => {
    const events = await p.events();
    onlyTheCard(events, sent.at, p.cards(events, sent.since)[0]);
  }, [`ask:${ask.id}`]);
}, 90 * MIN);

test(`${named(6)} (redraft 1812)`, async () => {
  const t = await (trips ??= tripScene());
  expect(t.family, `the fixture holds the project "${FAMILY}"`).toBeDefined();
  const sent = await t.w.send(PORTO);
  const card = await t.w.card(sent);
  const ran = await Promise.race([sent.done!, sleep(60_000).then(() => undefined)]);
  expect(card, `deep "${PORTO}" reaches its card (${ran ? shown(ran) : 'running'})`).toBeDefined();
  const options = (card!.created.data.options ?? []) as { id: string; label: string; decision?: string }[];
  expect(options.filter((o) => o.decision === 'allow' && o.label.includes(FAMILY)).map((o) => o.label), `the card shows "${FAMILY}" as the other answer: ${JSON.stringify(options)}`).toHaveLength(1);
  await t.w.approve(card!, { naming: FAMILY });
  const wanted = card!.brief.tasks.map((x) => x.title).sort();
  await waitUntil(async () => { const events = await t.w.events(); return wanted.every((x) => t.w.tasksOf(events, t.family!.id).includes(x)); }, 5 * MIN, 2000);
  await sleep(10_000);
  const events = await t.w.events();
  expect(wanted, 'the card has tasks').not.toEqual([]);
  expect(t.w.tasksOf(events, t.family!.id), `answering with "${FAMILY}" adds the work there: its tasks in that workspace`).toEqual(expect.arrayContaining(wanted));
  expect(t.w.workspacesMade(events, sent.at).map((m) => m.folder), 'and makes no new project').toEqual([]);
}, 60 * MIN);
