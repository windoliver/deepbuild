// #504.3b622b2f: "An agent's figure or film never appears in Needs you and never feeds a verdict; it shows beside an
// opened ask or in a receipt's explains-never-proves section"
//
// Two surfaces, one per half of the criterion (README: Readings):
//
// 1. The verdict, through `deep-show run` (#403's claims and `verdict`, the hub's canvas core). The working agent
//    alpha's claim names one deliverable, `WORK`, a clean scene its definition audits (`geometry.audit`, scope scene).
//    Alpha also shows, on the documents the hub minted for that claim (`docs.<id>.for: <claim>`), its figure `FIG`, a
//    scene whose two boxes pass 0.1 m into each other (an audit of it would fail), and its film `FILM`.
//    asserts: all three presented; the verdict PASSes on `WORK` alone; its `key.revisions` names `WORK` and nothing
//    else; nothing in the verdict names `FIG`, `FILM` or the figure's boxes. The planted `figure_feeds_verdict` (the
//    scenario's `planted`: the verdict judges, beside a claim's deliverables, the documents its agent showed on it)
//    fails that check, naming `FIG`.
//
// 2. Needs you, the opened ask and the receipt, through the hub (`deep hub run`, #806's world: a Claude Code stand-in
//    in its own session with its own `deep mcp`, the world file naming the documents the hub minted). The agent files
//    a claim (`deep_claim`) and a taste ask (`deep_ask`, left waiting for your answer); the hub mints `FIG` and `FILM`
//    for the claim and `ASKED` for the ask; the agent shows its six-item figure on `FIG` and `ASKED` and a film on
//    `FILM` (`deep_show`), each presented at revision 1.
//    asserts: `inbox.read` (Needs you) holds the agent's ask and gains no row from the three shows, and no row names a
//    document or a snapshot of one; `ask.card` of the ask lists `ASKED` at revision 1 in its `explains` and neither
//    claim document; `changes.read` of the claim (its receipt) lists `FIG` and `FILM` at revision 1 in its `explains`
//    and not `ASKED`, and its `checks`, `runs` and `verdicts` name none of them nor any of their snapshots. At the base
//    neither the card nor the receipt has an `explains` section, so this half fails there.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ALPHA, REPO, TIMEOUT, agentShow, arr, blocked, box, brief, claimId, docId, envelope, failsNaming, isObject, mentions, none, obj, presented,
  reqId, runShow, scenarioOf, useBins, useFolders, type JsonObject, type JsonValue, type V3,
} from './helpers.ts';
import { FIGURE, FIGURE_SIZE, cleanup, deepShow, hubCall, showArgs, showSchema, t26, t393 } from '../806/helpers.ts';
import { CLAUDE, openFigures } from '../806/figure.ts';

/** The criterion's ID: `#504.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#504.3b622b2f';

const bin = useBins(['show']);
const folder = useFolders();
afterEach(cleanup, 60_000);

/** An agent's short film: a swatch sliding across a 2D page over 2 s (agent form: no id, no layers). */
const agentFilm = (): JsonObject => t393.board('How the case changes', [320, 200], [
  { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a00', params: { projection: 'orthographic', target: [160, 100, 0], view_width: 320 } },
  t393.rect('back', 'Backdrop', [0, 0, 320, 200], 'a0', 'ground'),
  t393.rect('swatch', 'Swatch', [16, 80, 40, 40], 'a1', 'accent'),
], {
  profile: 'film', camera: 'cam', transport: { span: '2s' },
  channels: { slide: { target: 'items/swatch/params/box/0', type: 'f32', keys: { k0: { t: '0s', value: 16, interp: 'linear' }, k1: { t: '2s', value: 260, interp: 'linear' } } } },
});

// ---- Half 1: the verdict

const [WORK, FIG, FILM] = [docId(21), docId(22), docId(23)];
const CLAIM = claimId(21);
const REQ = reqId(21);
const scene = (id: string, items: JsonObject[]): JsonObject =>
  envelope(id, 'scene', [640, 480], items, { requires: { modules: { scene3d: '^1' } } });
const plate = (): JsonObject => box('plate', [0, 0.01, 0], [1, 0.02, 1], 'muted');
/** The deliverable: a crate resting on a plate. */
const work = (): JsonObject => scene('work', [plate(), box('crate', [0, 0.12, 0], [0.2, 0.2, 0.2] as V3)]);
/** The agent's figure: two boxes that pass 0.1 m into each other. */
const figure = (): JsonObject => scene('figure', [plate(), box('overlap-left', [0, 0.12, 0], [0.2, 0.2, 0.2]), box('overlap-right', [0.1, 0.12, 0], [0.2, 0.2, 0.2])]);
const AUDIT: JsonObject = { kind: 'geometry.audit', scope: 'scene', support: { floating: ['plate'] } };

function verdictFailures(replies: JsonObject[], what: string): string[] {
  for (const [i, name] of ['the deliverable', "the agent's figure", "the agent's film"].entries()) presented(replies[i]!, `${what}: ${name}`);
  const v = obj(replies[3], `${what}: the verdict`);
  const failures: string[] = [];
  if (v['result'] !== 'PASS') failures.push(`the claim is ${String(v['result'])}, not PASS on its deliverable alone: ${brief(v, 2000)}`);
  const keyed = arr(obj(v['key'], `${what}: the verdict's key`)['revisions'], `${what}: key.revisions`).map((r) => (isObject(r) ? r['doc'] ?? null : r));
  if (JSON.stringify(keyed) !== JSON.stringify([WORK])) failures.push(`the verdict is keyed by ${brief(keyed)}, not by the deliverable ${WORK} alone`);
  for (const [needle, name] of [[FIG, `the figure ${FIG}`], [FILM, `the film ${FILM}`], ['overlap-left', "the figure's box overlap-left"], ['overlap-right', "the figure's box overlap-right"]] as const) {
    if (mentions(v, needle)) failures.push(`the verdict reads ${name}: ${brief(v, 2000)}`);
  }
  return failures;
}

// ---- Half 2: the hub

const handleOf = (v: JsonValue | undefined, kind: string): string => { const s = String(v); return s.startsWith(`${kind}:`) ? s : `${kind}:${s}`; };
const docOf = (v: JsonValue | undefined): string => String(v).replace(/^doc:/, '');
/** An `explains` section: each entry's document and revision. */
function explained(section: JsonValue | undefined, what: string): { doc: string; rev: JsonValue }[] {
  return arr(section, what).map((e, i) => { const o = obj(e, `${what}[${i}]`); return { doc: docOf(o['doc']), rev: o['rev'] ?? null }; });
}

describe(`${ID} an agent's figure or film explains and never proves`, () => {
  it(`${ID} a claim's verdict reads its deliverable alone, never the figure and film its agent showed on it; a planted verdict that judges them fails, naming the figure`, () => {
    const claims: JsonObject = { [CLAIM]: { session: ALPHA.id, deliverables: [WORK], requirements: [{ id: REQ, check: AUDIT }] } };
    const judged = (planted?: string): JsonObject[] => runShow(bin('show'), scenarioOf({
      evidence: folder(), panels: { main: [0, 0, 640, 480], side: [640, 0, 320, 200] },
      docs: { [WORK]: { panel: 'main' }, [FIG]: { panel: 'main', for: CLAIM }, [FILM]: { panel: 'side', for: CLAIM } },
      claims, calls: [agentShow(WORK, work()), agentShow(FIG, figure()), agentShow(FILM, agentFilm()), { call: 'verdict', claim: CLAIM }],
      ...(planted ? { planted } : {}),
    }), `the claim's verdict${planted ? ` (planted ${planted})` : ''}`);
    none(verdictFailures(judged(), 'the claim'), 'the verdict reads the deliverable alone');
    failsNaming(verdictFailures(judged('figure_feeds_verdict'), 'the planted verdict'), [FIG], 'the planted verdict that judges the figure');
  }, TIMEOUT);

  it(`${ID} on the hub, the figure and film never reach Needs you; the opened ask shows its figure beside it, and the claim's receipt lists the two in its explains section, never among its checks, runs or verdicts`, async () => {
    if (!existsSync(join(REPO, 'packages', 'cli', 'dist', 'main.js'))) blocked('the hub runs the built CLI, packages/cli/dist/main.js: run `npm run build --workspaces` first');
    bin('show'); // the hub's canvas core is this checkout's deep-show build (packages/hub/src/canvas.ts)
    const f = await openFigures({ app: false });
    const stand = f.stands.get(CLAUDE.label)!;
    const [MINE, CUT, ASKED] = [t393.DOC.a, t393.DOC.b, t393.DOC.c];
    const rowsOf = async (): Promise<JsonObject[]> => arr((await hubCall(f.hub, 'inbox.read', {}))['asks'] ?? [], 'inbox.read: asks').map((r, i) => obj(r, `inbox.read: asks[${i}]`));

    const claimArgs = t26.claimArgs();
    await stand.stamp(f.hub, 'deep_claim', claimArgs);
    const made = t26.valueOf(await t26.callTool(stand, 'deep_claim', claimArgs), "the agent's deep_claim");
    const claim = handleOf(made.claim ?? made.event, 'claim');

    const question = 'Which finish should the #504 case ship in?';
    const askArgs = { kind: 'taste', question, options: [{ id: 'lagoon', label: 'Lagoon' }, { id: 'orchid', label: 'Orchid' }], recommended: 'lagoon' };
    await stand.stamp(f.hub, 'deep_ask', askArgs);
    const waiting = t26.pending(t26.callTool(stand, 'deep_ask', askArgs, 600_000));
    const created = await t26.filedWhileWaiting(waiting, f.hub, (e) => e.kind === 'ask.created' && e.data?.question === question, "the agent's deep_ask");
    const ask = `ask:${created.id}`;
    const asked = await rowsOf();
    expect(asked.some((r) => r['ask'] === ask), `Needs you holds the agent's ask ${ask}: ${brief(asked)}`).toBe(true);

    f.world.set({ docs: { [MINE]: { panel: 'main', for: claim }, [CUT]: { panel: 'main', for: claim }, [ASKED]: { panel: 'main', for: ask } } });
    const snapshots: string[] = [];
    for (const [doc, document] of [[MINE, FIGURE], [CUT, agentFilm()], [ASKED, FIGURE]] as const) {
      const call = { doc, document, t: '0s', size: FIGURE_SIZE, include: ['issues', 'pixels'] };
      await stand.stamp(f.hub, 'deep_show', showArgs(call, await showSchema(stand)));
      const shown = await deepShow(stand, call, `the agent's deep_show of ${doc}`);
      expect(shown.reply['outcome'], `the agent's deep_show of ${doc} is presented: ${brief(shown.reply)}`).toBe('presented');
      expect(shown.reply['rev'], `the agent's deep_show of ${doc} is revision 1`).toBe(1);
      for (const s of arr(shown.reply['snapshots'] ?? [], 'snapshots')) if (isObject(s) && typeof s['sha256'] === 'string') snapshots.push(s['sha256']);
    }
    const named = [MINE, CUT, ASKED, ...snapshots];
    const failures: string[] = [];

    const after = await rowsOf();
    if (after.length !== asked.length) failures.push(`Needs you went from ${asked.length} rows to ${after.length} when the agent showed its figure and film: ${brief(after)}`);
    for (const r of after) for (const n of named) if (mentions(r, n)) failures.push(`Needs you's row ${String(r['ask'])} names ${n}: ${brief(r)}`);

    const card = await hubCall(f.hub, 'ask.card', { ask });
    const beside = explained(card['explains'], `ask.card ${ask}: explains`);
    if (!beside.some((e) => e.doc === ASKED && e.rev === 1)) failures.push(`the opened ask's card doesn't show ${ASKED} at revision 1 beside it: explains ${brief(beside)}`);
    for (const d of [MINE, CUT]) if (beside.some((e) => e.doc === d)) failures.push(`the opened ask's card shows the claim's document ${d}`);

    const change = obj((await hubCall(f.hub, 'changes.read', { id: claim }))['change'], `changes.read ${claim}: change`);
    const receipt = explained(change['explains'], `changes.read ${claim}: explains`);
    for (const d of [MINE, CUT]) if (!receipt.some((e) => e.doc === d && e.rev === 1)) failures.push(`the claim's receipt doesn't list ${d} at revision 1 in its explains section: ${brief(receipt)}`);
    if (receipt.some((e) => e.doc === ASKED)) failures.push(`the claim's receipt lists the ask's document ${ASKED}`);
    for (const part of ['checks', 'runs', 'verdicts']) for (const n of named) if (mentions(change[part], n)) failures.push(`the claim's receipt reads ${n} in its ${part}: ${brief(change[part] ?? null)}`);
    none(failures, "the agent's figure and film explain beside the ask and in the receipt, and never reach Needs you or the proof");
  }, TIMEOUT);
});
