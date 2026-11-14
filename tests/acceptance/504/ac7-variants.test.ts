// #504.94ba2936: "A view-class choice bound to a three-option color variant set recolors the case on each pick while
// the saved document's hash stays the same, and a document-class one with entries at 2, 4 and 6 s exports a film that
// shows each color in turn from those times"
//
// The fixture (`product()` below): a 2D figure, 320 × 180 u through a camera that shows the whole page (1 u = 1 px),
// with the case, a 120 × 100 u rect at (100, 40) filled with the role `muted`. Its variant set `finish` has three
// options, each a patch setting the case's fill to a role: lagoon → `accent`, orchid → `session_readout`, graphite →
// `ink`; no default, so with no choice the case keeps `muted`. The choice control `finish` names the set (`variant:
// finish`) with its options; one document makes it class view, the other class document. The colors to expect are
// read from the same build: the case drawn with each role set in the document itself (`reference()`).
//
// asserts, through `deep-show run`:
//   - the view-class choice: before any pick the case (its centre, 160 × 90 px, in the panel's `view` render) shows the
//     muted reference; after each pick (`input` `{type: control, control: finish, value}`) it shows that option's
//     reference color within 3 code values per channel, the three apart; `read`'s hash after every pick is the hash
//     the presented revision had, and `revisions` holds that one revision;
//   - the document-class choice: `export` with a `track` of entries at 2 s (lagoon), 4 s (orchid) and 6 s (graphite)
//     to png_seq at 12 fps over the 8 s span: 96 frames; the case's centre in frame k shows muted for k < 24, lagoon for
//     24 ≤ k < 48, orchid for 48 ≤ k < 72 and graphite for 72 ≤ k < 96;
//   - the planted `variant_pick_writes_revision` (the scenario's `planted`: a view-class pick applies the option's
//     patch as a revision) fails the first, naming the hash; the planted `variant_export_final_choice` (the scenario's
//     `planted`: an export applies only the last entry's option over its whole span) fails the second, naming frame 24.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, arr, brief, cam2d, decodePng, docId, entry, envelope, failsNaming, getEvidence, isObject, none, obj, pixel, present, presented, rect,
  runShow, sameColor, scenarioOf, str, useBins, useFolders, type JsonObject, type Rgb,
} from './helpers.ts';

/** The criterion's ID: `#504.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#504.94ba2936';

const bin = useBins(['show']);
const folder = useFolders();

const DOC = docId(71);
const SIZE: [number, number] = [320, 180];
const CENTRE: [number, number] = [160, 90];
const OPTIONS = { lagoon: 'accent', orchid: 'session_readout', graphite: 'ink' } as const;
type Option = keyof typeof OPTIONS;
const PICKS: Option[] = ['lagoon', 'orchid', 'graphite'];

/** The page and the case, its fill `role`. */
const page = (role: string, extra: JsonObject = {}): JsonObject =>
  envelope('product', 'figure', SIZE, [cam2d(SIZE), rect('case', [100, 40, 120, 100], role)], { transport: { span: '8s', frame_rate: [12, 1] }, ...extra });
/** The product with its variant set and the choice of class `cls`. */
function product(cls: 'view' | 'document'): JsonObject {
  const options = PICKS.map((name) => ({ name, label: name[0]!.toUpperCase() + name.slice(1), patch: [{ op: 'set', id: 'case', path: 'items/case/params/paint/fill', value: { role: OPTIONS[name] } }] }));
  return page('muted', {
    requires: { modules: { input: '^1' } },
    variants: { finish: { options } },
    controls: { finish: { kind: 'choice', class: cls, label: 'Finish', role: 'radiogroup', variant: 'finish', options: [...PICKS] } },
  });
}
/** The case drawn with a role set in the document itself: the color a pick of that role's option must show. */
const reference = (role: string): JsonObject => page(role);

const world = (evidence: string, calls: JsonObject[], planted?: string): JsonObject =>
  scenarioOf({ evidence, panels: { main: [0, 0, 320, 180] }, docs: { [DOC]: { panel: 'main' } }, calls, ...(planted ? { planted } : {}) });
/** The case's color in a `view` reply's render, read from the evidence store. */
function caseColor(evidence: string, reply: JsonObject, what: string): Rgb {
  const snap = obj(reply['snapshot'], `${what}: view.snapshot`);
  return pixel(decodePng(getEvidence(evidence, str(snap['sha256'], `${what}: view.snapshot.sha256`), what)), CENTRE[0], CENTRE[1]);
}

/** The reference colors: muted, then each option's role, through `view` on the same build. */
function references(): Record<'muted' | Option, Rgb> {
  const evidence = folder();
  const roles: ['muted' | Option, string][] = [['muted', 'muted'], ...PICKS.map((p): [Option, string] => [p, OPTIONS[p]])];
  const calls = roles.flatMap(([, role]) => [present(DOC, reference(role)), { call: 'view', panel: 'main' }]);
  const r = runShow(bin('show'), world(evidence, calls), 'the reference colors');
  const out: Partial<Record<'muted' | Option, Rgb>> = {};
  roles.forEach(([name], k) => { presented(r[2 * k]!, `the reference ${name}`); out[name] = caseColor(evidence, r[2 * k + 1]!, `the reference ${name}`); });
  const all = Object.entries(out);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(sameColor(all[i]![1], all[j]![1], 12), `the fixture: ${all[i]![0]} and ${all[j]![0]} draw apart (${brief(all[i]![1])}, ${brief(all[j]![1])})`).toBe(false);
  return out as Record<'muted' | Option, Rgb>;
}

function viewFailures(ref: Record<'muted' | Option, Rgb>, planted?: string): string[] {
  const evidence = folder();
  const what = planted ? `the planted view-class picks (${planted})` : 'the view-class picks';
  const calls: JsonObject[] = [present(DOC, product('view')), { call: 'view', panel: 'main' }, { call: 'read', doc: DOC }];
  for (const p of PICKS) calls.push({ call: 'input', panel: 'main', event: { type: 'control', control: 'finish', value: p } }, { call: 'view', panel: 'main' }, { call: 'read', doc: DOC });
  calls.push({ call: 'revisions', doc: DOC });
  const r = runShow(bin('show'), world(evidence, calls, planted), what);
  presented(r[0]!, `${what}: the product`);
  const failures: string[] = [];
  const before = caseColor(evidence, r[1]!, 'before any pick');
  if (!sameColor(before, ref.muted)) failures.push(`${what}: before any pick the case shows ${brief(before)}, not its own muted ${brief(ref.muted)}`);
  const saved = str(obj(r[2], 'read')['hash'], 'read: hash');
  PICKS.forEach((p, k) => {
    const seen = caseColor(evidence, r[4 + 3 * k]!, `after the ${p} pick`);
    if (!sameColor(seen, ref[p])) failures.push(`${what}: after the ${p} pick the case shows ${brief(seen)}, not ${p}'s ${brief(ref[p])}`);
    const hash = obj(r[5 + 3 * k], `read after ${p}`)['hash'];
    if (hash !== saved) failures.push(`${what}: after the ${p} pick the saved document's hash is ${String(hash)}, not ${saved}`);
  });
  const revisions = arr(obj(r[r.length - 1], 'revisions')['revisions'], 'revisions').filter(isObject);
  if (revisions.length !== 1) failures.push(`${what}: the picks leave ${revisions.length} revisions, not the one presented (hash ${saved}): ${brief(revisions)}`);
  return failures;
}

function exportFailures(ref: Record<'muted' | Option, Rgb>, planted?: string): string[] {
  const evidence = folder();
  const out = join(folder(), 'frames');
  const what = planted ? `the planted export (${planted})` : 'the export';
  const track = [entry(2, 'finish', 'lagoon'), entry(4, 'finish', 'orchid'), entry(6, 'finish', 'graphite')];
  const r = runShow(bin('show'), world(evidence, [present(DOC, product('document')), { call: 'export', doc: DOC, out, video: { codec: 'png_seq' }, frame_rate: [12, 1], track }], planted), what);
  presented(r[0]!, `${what}: the product`);
  if (r[1]!['outcome'] !== 'exported') return [`${what}: the export is ${String(r[1]!['outcome'])}: ${brief(r[1]!)}`];
  const files = readdirSync(out).filter((f) => f.toLowerCase().endsWith('.png')).sort();
  if (files.length !== 96) return [`${what}: the export wrote ${files.length} frames, not 96 (8 s at 12 fps)`];
  const failures: string[] = [];
  files.forEach((f, k) => {
    const want: 'muted' | Option = k < 24 ? 'muted' : k < 48 ? 'lagoon' : k < 72 ? 'orchid' : 'graphite';
    const seen = pixel(decodePng(readFileSync(join(out, f))), CENTRE[0], CENTRE[1]);
    if (!sameColor(seen, ref[want])) failures.push(`${what}: frame ${k} (${(k / 12).toFixed(3)} s) shows the case ${brief(seen)}, not ${want} ${brief(ref[want])}`);
  });
  return failures;
}

describe(`${ID} a choice bound to a variant set recolors the case: in the view without an edit, and in an export along the track`, () => {
  it(`${ID} each view-class pick recolors the case and the saved document's hash stays the same; a planted pick that writes a revision fails, naming the hash`, () => {
    const ref = references();
    none(viewFailures(ref), 'the view-class choice recolors the case and edits nothing');
    failsNaming(viewFailures(ref, 'variant_pick_writes_revision'), ['hash'], 'the planted pick that writes a revision');
  }, TIMEOUT);

  it(`${ID} a document-class choice with entries at 2, 4 and 6 s exports each color from its entry's time; a planted export that applies only the last choice fails, naming frame 24`, () => {
    const ref = references();
    none(exportFailures(ref), 'the export shows each color in turn from its entry');
    failsNaming(exportFailures(ref, 'variant_export_final_choice'), ['frame 24 '], 'the planted export that applies only the last choice');
  }, TIMEOUT);
});
