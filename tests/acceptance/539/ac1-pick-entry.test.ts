// AC1 #539.798cb59a: In a 12 × 12 square atlas grid with cell [16, 16] and a pick control naming it, a click at
// (120, 56) writes one document entry {set 0, key (7, 3)} that a logic item reads at its next step as u32 0, four zero
// bytes, i64 7 and i64 3; the selection stays empty; and replaying the track after the camera has panned by one cell
// gives the same entry and the same step hashes, while a planted pick that resolves the row again on replay reads
// (8, 3) and fails logic.determinism, naming the entry
//
// The grid (fixtures.ts `squareDoc`): `board`, 12 × 12 cells of 16 u laid out by grid.size from `world`, at (8, 8), so
// the page point (120, 56) lies in cell (7, 3) by the floor of the point over the cell (README: Readings); `place`, a
// document-class pick control whose rows are [board]; `rules`, a logic item reading `place` whose program copies the
// first 40 bytes of its read region into `got` every step (programs.ts). Through `deep-show run` on the scope's clock:
// the document presented, a click (press and release 60 ms apart) at (120, 56) mapped to the panel through the camera
// the scope reports, `scope` (the selection), `logic` (README: the steps the logic items run on the track, as the hub
// replays it), a plain drag over the empty margin from (208, 208) to (192, 208), which pans the camera one cell along
// +x, `scope` (the camera), and `logic` again, with logic.determinism. The planted `pick_resolves_on_replay` (README:
// Planted twins) resolves a pick's row again from where the pointer was, through the camera as it is at the replay.
import { describe, expect, it } from 'vitest';
import { SQUARE, gotOf, rulesProgram, worldProgram, type Cell } from './programs.ts';
import { MARGIN_FROM, MARGIN_TO, cellText, pickControl, putAtlas, squareDoc } from './fixtures.ts';
import {
  AC, DOC, STEP, Script, TIMEOUT, appendedOf, binOf, entriesText, failsNaming, isObject, logicOf, none, once, pickOf, pickText, prebuild,
  presented, putEvidence, runShow, scenario, scopeView, selectionOf, show, stateOf, toPanel, useTemp, viewOf, type JsonObject, type JsonValue,
  type LogicRun, type Planted, type Pt,
} from './helpers.ts';

prebuild();
const temp = useTemp();
const D = DOC(1);
const CLICK: Pt = [120, 56];
const PICKED: Cell = [7, 3];
const PANNED: Cell = [8, 3];
/** One second of steps: the click lands near 0.4 s. */
const STEPS = 60;

interface Run {
  /** The criterion's failures for the click's entry and the selection. */
  click: string[];
  /** The criterion's failures for the logic item's read of the entry. */
  read: string[];
  /** The criterion's failures for the replay after the pan. */
  replay: string[];
  entry: JsonObject | null;
  readStep: number | null;
  postKey: [number, number] | null;
  check: JsonObject | null;
}

const words = (run: LogicRun, k: number): number[] | null => {
  const s = run.steps.find((x) => x.step === k);
  const got = s?.arrays['rules.got'];
  return Array.isArray(got) && got.length === 10 && got.every((v) => typeof v === 'number') ? (got as number[]) : null;
};
const sameEntry = (a: JsonObject, b: JsonObject): boolean =>
  a['control'] === b['control'] && a['t'] === b['t'] && JSON.stringify(pickOf(a)) === JSON.stringify(pickOf(b));

/** The criterion's run; `withLogic` false leaves out the `logic` calls (the click, the selection and the pan alone). */
function judge(planted?: Planted, withLogic = true): Run {
  const ev = temp();
  const atlas = putAtlas(ev);
  const world = worldProgram(SQUARE);
  const rules = rulesProgram();
  for (const p of [world, rules]) putEvidence(ev, p.bytes);
  const doc = squareDoc('pick', atlas, { world, rules: { program: rules }, controls: { place: pickControl('Place', ['board']) } });
  const view = scopeView(binOf(), ev, D, doc, {}, 'AC1 the grid');
  const s = new Script();
  s.present(D, doc);
  s.scope();
  const [down, up] = s.click(toPanel(view, CLICK));
  const after = s.scope();
  const pre = withLogic ? s.logic(D, STEPS) : -1;
  s.drag(toPanel(view, MARGIN_FROM), toPanel(view, MARGIN_TO));
  const panned = s.scope();
  const post = withLogic ? s.logic(D, STEPS, 'logic.determinism') : -1;
  const what = `AC1 the click and the replay${planted ? ` (planted ${planted})` : ''}`;
  const r = runShow(binOf(), scenario(ev, [D], s.calls, planted ? { planted } : {}), what);
  presented(r[0]!, 'the grid');

  // The fixture: the drag panned the camera one cell along +x, so the panel point clicked now shows (136, 56), cell (8, 3).
  const moved = viewOf(stateOf(r[panned]!, 'the scope after the drag'), 'the scope after the drag');
  expect([moved.target[0]! - view.target[0]!, moved.target[1]! - view.target[1]!], `the fixture: the drag over the margin pans the camera by one cell, 16 u along +x (camera before ${show(view.target)}, after ${show(moved.target)})`).toEqual([16, 0]);

  const click: string[] = [];
  const entries = [...appendedOf(r[down]!, 'the press'), ...appendedOf(r[up]!, 'the release')];
  const entry = entries.length === 1 ? entries[0]! : null;
  const pick = entry ? pickOf(entry) : null;
  if (!entry || entry['control'] !== 'place' || entry['writer'] !== 'you' || pickText(pick) !== pickText({ set: 0, key: PICKED }))
    click.push(`the click at (120, 56) appends ${entriesText(entries)}, not one entry {control: place, value: {set 0, key ${cellText(PICKED)}}, writer: you}`);
  const selection = selectionOf(r[after]!, 'the scope after the click');
  if (selection.length) click.push(`after the click the selection is ${show(selection)}, not empty`);
  if (!withLogic) return { click, read: [], replay: [], entry, readStep: null, postKey: null, check: null };

  const read: string[] = [];

  const before = logicOf(r[pre]!, 'the logic run before the pan');
  const t = entry && typeof entry['t'] === 'number' ? entry['t'] : null;
  // The step that reads the entry: the first whose time is at or after the entry's stamp.
  const readStep = t === null ? null : Math.ceil(t / STEP);
  const reading = before.steps.filter((x) => { const w = words(before, x.step); return w !== null && w[0] !== 0; }).map((x) => x.step);
  if (readStep === null) read.push('no entry carries a flick time, so no step can read it');
  else {
    const w = words(before, readStep);
    if (!w) read.push(`step ${readStep}, the first at or after the entry's stamp (t ${t}), reports no rules.got of ten numbers: ${show(before.steps.find((x) => x.step === readStep) ?? null, 400)}`);
    else {
      const g = gotOf(w);
      if (g.count !== 1 || g.set !== 0 || g.pad !== 0 || g.key[0] !== PICKED[0] || g.key[1] !== PICKED[1] || g.high[0] !== 0 || g.high[1] !== 0)
        read.push(`step ${readStep} reads count ${g.count} and the entry's 24 B as u32 ${g.set}, ${g.pad === 0 ? 'four zero bytes' : `the word ${g.pad}`}, i64 (${g.key[0]} + ${g.high[0]}·2^32) and i64 (${g.key[1]} + ${g.high[1]}·2^32), not one entry: u32 0, four zero bytes, i64 7 and i64 3`);
    }
    const others = reading.filter((k) => k !== readStep);
    if (others.length) read.push(`steps ${others.join(', ')} read an entry of place too; only step ${readStep} reads it, once`);
  }
  const trackOf = (run: LogicRun): JsonObject[] => run.track.filter((e) => e['control'] === 'place');
  if (entry && (trackOf(before).length !== 1 || !sameEntry(trackOf(before)[0]!, entry))) read.push(`the track the logic run reads holds ${entriesText(trackOf(before))}, not the one entry the click appended`);

  const replay: string[] = [];
  const afterPan = logicOf(r[post]!, 'the logic run after the pan');
  if (entry && (trackOf(afterPan).length !== 1 || !sameEntry(trackOf(afterPan)[0]!, entry))) replay.push(`after the pan the track holds ${entriesText(trackOf(afterPan))}, not the same one entry ${entriesText([entry])}`);
  let postKey: [number, number] | null = null;
  if (readStep !== null) {
    const w = words(afterPan, readStep);
    if (w) {
      postKey = gotOf(w).key;
      if (postKey[0] !== PICKED[0] || postKey[1] !== PICKED[1]) replay.push(`after the pan, step ${readStep} reads key ${cellText(postKey)}, not ${cellText(PICKED)}: the replay resolved the row again`);
    } else replay.push(`after the pan, step ${readStep} reports no rules.got of ten numbers`);
  }
  for (const a of before.steps) {
    const b = afterPan.steps.find((x) => x.step === a.step);
    const differ = Object.keys({ ...a.hash, ...(b?.hash ?? {}) }).filter((item) => a.hash[item] !== b?.hash[item]);
    if (differ.length) { replay.push(`after the pan, step ${a.step}'s hash differs for ${differ.join(', ')} (${differ.map((i) => `${a.hash[i]} then ${b?.hash[i] ?? 'none'}`).join('; ')})`); break; }
  }
  if (before.steps.length !== STEPS || afterPan.steps.length !== STEPS) replay.push(`the logic runs report ${before.steps.length} and ${afterPan.steps.length} steps, not ${STEPS} each`);
  const check = afterPan.check;
  if (!check || check['kind'] !== 'logic.determinism' || check['verdict'] !== 'PASS') replay.push(`logic.determinism after the pan answers ${show(check, 800)}, not PASS`);
  return { click, read, replay, entry, readStep, postKey, check };
}

/** The entry's flick time and control appear together in some object of the check's failures. */
function namesEntry(v: JsonValue | undefined, entry: JsonObject): boolean {
  if (Array.isArray(v)) return v.some((x) => namesEntry(x, entry));
  if (!isObject(v)) return false;
  if (v['control'] === 'place' && v['t'] === entry['t']) return true;
  return Object.values(v).some((x) => namesEntry(x, entry));
}

const honest = once(() => judge());

describe(`${AC[1]} a pick on a square grid writes the row's key once, logic reads it in 24 B, and a replay never resolves it again`, () => {
  it(`${AC[1]} a click at (120, 56) writes one entry {set 0, key (7, 3)}, which the logic item reads at its next step as u32 0, four zero bytes, i64 7 and i64 3; the selection stays empty`, () => {
    none(judge(undefined, false).click, 'the click, its entry and the selection');
    none(honest().read, 'the logic item\'s read of the entry at its next step');
  }, TIMEOUT);

  it(`${AC[1]} replaying the track after the camera has panned by one cell gives the same entry and the same step hashes, and logic.determinism passes`, () => {
    none(honest().replay, 'the replay after a pan of one cell');
  }, TIMEOUT);

  it(`${AC[1]} planted pick_resolves_on_replay reads (8, 3) after the pan and fails logic.determinism, naming the entry`, () => {
    const twin = judge('pick_resolves_on_replay');
    none([...twin.click, ...twin.read], 'the planted pick: the live click and its read are unchanged');
    expect(twin.postKey, `under the planted pick the replay after the pan reads the cell under the old pointer position now, ${cellText(PANNED)}`).toEqual(PANNED);
    failsNaming(twin.replay, [/\(8, 3\)/], 'the replay after the pan under pick_resolves_on_replay');
    expect(twin.check?.['verdict'], `logic.determinism fails the planted pick: ${show(twin.check, 800)}`).toBe('FAIL');
    expect(twin.entry !== null && namesEntry(twin.check?.['failures'], twin.entry), `a failure of logic.determinism names the entry (control place, t ${String(twin.entry?.['t'])}): ${show(twin.check?.['failures'] ?? null, 1200)}`).toBe(true);
  }, TIMEOUT);
});
