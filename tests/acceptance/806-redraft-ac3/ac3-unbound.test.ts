// Blind redraft of #806 AC3 (README.md): a deep_show call from a `deep mcp` bound to no session is refused, draws nothing,
// and the record gains no revision. The world is #806's own (`../806/figure.ts`, openFigures: a hub with its world file, a
// Claude Code and a Codex session established through their hooks, a `deep mcp` this test process started itself, and the
// app's headless replica); the MCP client and the record's reader are #26's. Processes stop by PID (#806's cleanup).

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { CLAUDE, SHOW, openFigures, type Figures } from '../806/figure.ts';
import {
  FIGURE, FIGURE_ITEMS, REPLY_BOUND_MS, cleanup, evidenceRoot, readEvidence, rowsOf, showArgs, showSchema, sleep, t26, t393, useApp,
  type App, type Drawn, type JsonObject, type Line,
} from '../806/helpers.ts';

afterEach(cleanup, 30_000);
const appBuilt = useApp();

/** What a draw leaves where this test can look: the record, the evidence store's objects by hash, the revisions the app drew. */
interface Seen { events: t26.Ev[]; objects: string[]; drawn: Drawn[] }

/** Waits out deep_show's 2 s, lets the app draw all the hub has presented, then reads the three. */
async function look(f: Figures, app: App): Promise<Seen> {
  await sleep(REPLY_BOUND_MS);
  await app.sync();
  return { events: await t26.events(f.hub), objects: objectsIn(f.home), drawn: app.drawn() };
}

/** The hashes of a home's evidence objects: `<2 hex>/<62 hex>` under the store's root (packages/evidence; its public entry lists none). */
function objectsIn(home: string): string[] {
  const root = evidenceRoot(home);
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((d) => /^[0-9a-f]{2}$/.test(d))
    .flatMap((d) => readdirSync(join(root, d)).filter((n) => /^[0-9a-f]{62}$/.test(n)).map((n) => d + n));
}

/** Every revision number in an event's data: a key `rev` holding a number, at any depth (#393's reply and Render-back call it `rev`). */
function revsIn(v: unknown, into: number[] = []): number[] {
  if (Array.isArray(v)) for (const x of v) revsIn(x, into);
  else if (typeof v === 'object' && v !== null) {
    for (const [k, x] of Object.entries(v)) {
      if (k === 'rev' && typeof x === 'number') into.push(x);
      else revsIn(x, into);
    }
  }
  return into;
}

/** The revisions the record holds, `<doc> rev <n>` for each world document an event names (`? rev <n>` if none), with the first event holding each. */
function revisionsIn(events: readonly t26.Ev[]): Map<string, string> {
  const docs: string[] = Object.values(t393.DOC);
  const held = new Map<string, string>();
  for (const e of events) {
    const text = JSON.stringify([e.subject ?? null, e.data]).toLowerCase();
    const named = docs.filter((d) => text.includes(d.toLowerCase()));
    for (const n of revsIn(e.data)) {
      for (const d of named.length > 0 ? named : ['?']) {
        const key = `${d} rev ${n}`;
        if (!held.has(key)) held.set(key, `${e.kind} ${JSON.stringify(e.data).slice(0, 240)}`);
      }
    }
  }
  return held;
}

/**
 * What a draw left between two looks: revisions new to the record; objects new to the evidence store that are a drawing (a PNG,
 * as render-back's snapshots are) or the figure (text naming one of `marks`: its document, title or items); revisions new to the
 * app. Other new objects aren't counted: the canvas core stores its own programs there on its first deep_show, bound or not
 * (README: Base result).
 */
interface Left { record: string[]; evidence: string[]; app: string[] }
async function leftBetween(home: string, a: Seen, b: Seen, marks: readonly string[]): Promise<Left> {
  const held = revisionsIn(a.events);
  const record = [...revisionsIn(b.events)].filter(([key]) => !held.has(key)).map(([key, e]) => `${key}: ${e}`);
  const stored = await Promise.all(b.objects.filter((h) => !a.objects.includes(h)).map(async (h) => [h, await drawnOrFigure(home, h, marks)] as const));
  const evidence = stored.filter(([, kind]) => kind !== undefined).map(([h, kind]) => `${h}: ${kind}`);
  const app = b.drawn.slice(a.drawn.length).map((d) => `${d.doc} rev ${d.rev}: ${JSON.stringify(d.layers.map((l) => ({ owner: l.owner, items: l.items })))}`);
  return { record, evidence, app };
}
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** A stored object as a draw or a revision would leave it: a PNG, or text naming the figure; undefined for anything else. */
async function drawnOrFigure(home: string, sha: string, marks: readonly string[]): Promise<string | undefined> {
  let bytes: Buffer;
  try {
    bytes = await readEvidence(home, sha);
  } catch (error) {
    return `unreadable, so it may be either (${String(error)})`;
  }
  if (bytes.subarray(0, 8).equals(PNG)) return 'a PNG';
  const text = bytes.toString('latin1').toLowerCase();
  const named = marks.filter((m) => text.includes(m.toLowerCase()));
  return named.length > 0 ? `names ${named.join(', ')}: ${JSON.stringify(bytes.subarray(0, 160).toString('utf8'))}` : undefined;
}

/** Why a tool call's outcome is no refusal; empty when it is one (README: Ambiguities, "refused"). */
function notRefused(o: t26.Outcome): string[] {
  const said = JSON.stringify(o.reply).slice(0, 600);
  if (o.protocolError) return [`it answered with a JSON-RPC error, not a tool result: ${said}`];
  const value = (typeof o.value === 'object' && o.value !== null && !Array.isArray(o.value) ? o.value : {}) as JsonObject;
  const why: string[] = [];
  if ('outcome' in value ? value['outcome'] !== 'refused' : !o.isError) why.push(`it was not refused: ${said}`);
  if (value['code'] === 'unavailable') why.push(`it says the hub is unreachable, which is no refusal by the hub: ${said}`);
  const shots = value['snapshots'];
  if (Array.isArray(shots) && shots.length > 0) why.push(`its reply carries ${shots.length} snapshot(s): ${JSON.stringify(shots)}`);
  return why;
}

// - [ ] A `deep_show` call from a `deep mcp` process bound to no session is refused and draws nothing, and the record gains no revision
test('AC3 a deep_show call from a deep mcp process bound to no session is refused and draws nothing, and the record gains no revision', async () => {
  appBuilt();
  const f = await openFigures({ app: true });
  const app = f.app!;
  const doc = t393.DOC.a;
  const call: Line = { doc, document: FIGURE, ...SHOW };
  const none: Left = { record: [], evidence: [], app: [] };
  // What names the figure in a stored object: its document, its title, and its items with IDs no other text would hold.
  const marks = [doc, String(FIGURE['title']), ...FIGURE_ITEMS.filter((id) => id.includes('-'))];

  // The process bound to no session: this test process started it, so no session's hooks came from its parent (Socket roles),
  // beside two sessions established in the same worktree. Like any deep mcp it lists deep_show.
  const tools = (await t26.listTools(f.hand)).map((t) => t.name);
  expect(tools, 'the deep mcp bound to no session lists deep_show beside the other deep_* tools').toContain('deep_show');
  const fromHand = async (document: JsonObject): Promise<t26.Outcome> =>
    t26.callTool(f.hand, 'deep_show', showArgs({ ...call, document }, await showSchema(f.hand)));

  // 1. On a document no one has drawn.
  const start = await look(f, app);
  const first = await fromHand(FIGURE);
  expect(notRefused(first), 'deep_show of the six-item figure from the deep mcp bound to no session is refused').toEqual([]);
  const quiet = await look(f, app);
  expect(await leftBetween(f.home, start, quiet, marks), 'it draws nothing (no snapshot or figure stored, nothing drawn in the app), and the record gains no revision').toEqual(none);

  // 2. The twin: the same call from the Claude Code session's own deep mcp, on its claim. It is presented at revision 1, so the
  // document had no revision; and each reading above sees what it left, so their silence above was no blindness.
  const claude = f.stands.get(CLAUDE.label)!;
  t26.valueOf(await t26.callTool(claude, 'deep_claim', t26.claimArgs()), `deep_claim of the ${CLAUDE.name} session`);
  const bound = await t26.callTool(claude, 'deep_show', showArgs(call, await showSchema(claude)));
  expect([bound.isError, bound.value?.outcome, bound.value?.rev], `the same deep_show from the ${CLAUDE.name} session's own deep mcp is presented at revision 1: ${JSON.stringify(bound.reply).slice(0, 600)}`)
    .toEqual([false, 'presented', 1]);
  expect(notRefused(bound), 'the refusal reading tells a presented call from a refused one').not.toEqual([]);
  const shown = await look(f, app);
  const left = await leftBetween(f.home, quiet, shown, marks);
  const shots = ((bound.value?.snapshots ?? []) as JsonObject[]).map((s) => String(s['sha256']));
  const drawnItems = rowsOf(shown.drawn, doc, 1).flatMap((r) => r.items);
  expect({
    record: left.record.some((r) => r.startsWith(`${doc} rev 1:`)),
    evidence: shots.length > 0 && shots.every((h) => left.evidence.some((o) => o.startsWith(`${h}:`))),
    app: FIGURE_ITEMS.every((id) => drawnItems.includes(id)),
  }, `a bound call's draw is seen: the record holds ${doc} rev 1, the store its snapshot, the app the figure's six items: ${JSON.stringify(left)}`)
    .toEqual({ record: true, evidence: true, app: true });

  // 3. On the document the Claude Code session now holds, the figure retitled, so a revision of it would differ from the session's.
  const second = await fromHand({ ...FIGURE, title: 'Release readiness, retitled' });
  expect(notRefused(second), `deep_show from the deep mcp bound to no session, on the document the ${CLAUDE.name} session holds, is refused`).toEqual([]);
  const end = await look(f, app);
  expect(await leftBetween(f.home, shown, end, marks), 'it draws nothing, and the record gains no revision').toEqual(none);
}, 600_000);
