// AC4: "With no status binding, honest numbers passes, each bar label traced to the agent's table. With a verdict
// binding added on the frame, its outline draws in the exact status color after tone map and bloom, and honest numbers
// fails naming each label's row. A revision that writes the fail color on the frame's material is refused naming the
// item, and the last good revision stays shown"
//
// asserts: without a binding the claim's honest_numbers requirement (#403) is PASS and its row's `numbers` (#397's
// entries, README) trace each bar label `labels#<key>` to the agent's table `sales`, column `value`, with the table's
// text. With the piece's frame stroke bound to a failed verdict, the requirement is FAIL with an issue naming
// `labels#<key>` for each of the five rows (an agent-written table is the agent's own number once status can show).
// The app draws that revision (`read`, then #421's `view3d` on Metal with the piece's look: filmic tone map, AO,
// deband and bloom): the status report has a fail mark on `frame` in #bf232b, and in the final target, outside the
// legend's and labels' boxes, exact #bf232b pixels number at least half the frame silhouette's boundary pixels (from
// the object-ID target), each within 8 px of it (#421 AC5's check). `--planted status_before_tone_map` (#421's: the
// outline drawn into the linear target, so the tone map tints it) fails, naming the frame. A revision that writes
// `status.fail` on the frame's material is refused with an error naming `wood` or `frame`, and the current revision is
// still the bound one.
// Wrong programs: honest numbers that skip mark-set labels or trace them to nothing; a status binding that leaves the
// agent's numbers passing; an outline tinted by the tone map or bloom, or drawn as a fill; a status color accepted
// from a material; a refusal that drops the last good revision.
import { describe, expect, it } from 'vitest';
import {
  FAIL, LOOK, READ, REQ, REVISIONS, ROWS, SIZE, VERDICT, VERDICT_CALL, arr, assetsIn, bound, current, failMaterial, failsNaming, grow, hex,
  idsOf, importTable, isObject, issues, keepProof, none, num, obj, piece, pixel, readNamed, decodePng, requireMetal, runGpu, runShow, scenario,
  seedStore, show, showChecked, shown, storedDoc, useBuilds, useDir, verdictOf,
  type JsonObject,
} from './helpers.ts';

const builds = useBuilds(['deep-show', 'deep-gpu']);
const dir = useDir();
const RING = 8;

describe('AC4 honest numbers and the status outline', () => {
  it('AC4 with no status binding honest numbers passes, each bar label traced to the agent\'s table', () => {
    const evidence = dir();
    seedStore(evidence);
    const [r] = runShow(builds.bin('deep-show'), [scenario(evidence, [importTable(), showChecked(piece()), VERDICT_CALL])], 'AC4 no binding');
    keepProof('ac4-unbound-replies.json', r!);
    expect(r![1]!['outcome'], `AC4: the piece is presented: ${shown(r![1], 2000)}`).toBe('presented');
    const row = verdictOf(r![2], 'AC4 the verdict').rows.find((x) => x.id === REQ.honest);
    expect(row, 'AC4: the verdict has the honest_numbers row').toBeDefined();
    expect(row!.result, `AC4: honest numbers passes with no status binding: ${shown(row!.raw, 2000)}`).toBe('PASS');
    const numbers = arr(row!.raw['numbers'], `AC4: the honest_numbers row lists each number it traced (${shown(row!.raw)})`).map((n, i) => obj(n, `numbers[${i}]`));
    const failures: string[] = [];
    for (const [key, value] of ROWS) {
      const n = numbers.find((x) => x['item'] === 'labels' && String(x['row']) === key);
      if (!n) { failures.push(`AC4 labels#${key}: no number traced`); continue; }
      const src = isObject(n['source']) ? n['source'] : {};
      if (n['text'] !== value) failures.push(`AC4 labels#${key}: shows ${shown(n['text'])}, not the table's ${value}`);
      if (src['table'] !== 'sales' || src['column'] !== 'value') failures.push(`AC4 labels#${key}: traced to ${shown(src)}, not the agent's table sales, column value`);
    }
    none(failures, 'AC4 each bar label traced to the agent\'s table');
  }, 1_800_000);

  it('AC4 with a verdict binding on the frame honest numbers fails naming each label\'s row; a revision writing the fail color on the frame\'s material is refused naming the item, and the last good revision stays shown', () => {
    const evidence = dir();
    seedStore(evidence);
    const calls: JsonObject[] = [importTable(), showChecked(bound()), VERDICT_CALL, REVISIONS, show(failMaterial()), REVISIONS];
    const [r] = runShow(builds.bin('deep-show'), [scenario(evidence, calls)], 'AC4 bound');
    keepProof('ac4-bound-replies.json', r!);
    const [, presented, verdict, before, refused, after] = r!;
    expect(presented!['outcome'], `AC4: the bound piece is presented: ${shown(presented, 2000)}`).toBe('presented');
    const row = verdictOf(verdict, 'AC4 the bound verdict').rows.find((x) => x.id === REQ.honest);
    expect(row?.result, `AC4: honest numbers fails once status can show: ${shown(row?.raw, 2000)}`).toBe('FAIL');
    for (const [key] of ROWS) expect(row!.issues.some((i) => i.ids.includes(`labels#${key}`)), `AC4: an honest_numbers issue names the row labels#${key}`).toBe(true);
    expect(refused!['outcome'], `AC4: the fail color written on the material is refused: ${shown(refused, 2000)}`).toBe('refused');
    const errors = issues(refused!['issues'], 'AC4 the refused revision').filter((i) => i.severity === 'error');
    expect(errors.some((i) => i.ids.includes('wood') || i.ids.includes('frame')), `AC4: the refusal names the item: ${shown(refused!['issues'], 2000)}`).toBe(true);
    expect(current(after!, 'AC4 after'), 'AC4: the last good revision stays shown').toEqual(current(before!, 'AC4 before'));
  }, 1_800_000);

  /** The frame's outline in the app's finished look: failures as sentences naming the frame. */
  function outlineProblems(planted?: 'status_before_tone_map'): string[] {
    const evidence = dir();
    seedStore(evidence);
    const [r] = runShow(builds.bin('deep-show'), [scenario(evidence, [importTable(), show(bound()), READ])], 'AC4 outline');
    expect(r![1]!['outcome'], `AC4: the bound piece is presented: ${shown(r![1])}`).toBe('presented');
    const { path } = storedDoc(r![2]!, evidence);
    const call = { call: 'view3d', doc: path, look: LOOK, size: SIZE, frames: 1, capture: [0], targets: ['final', 'ids'], states: { [VERDICT]: 'fail' }, assets: assetsIn(evidence) };
    const [reply] = runGpu(builds.bin('deep-gpu'), evidence, [call], planted ? { planted } : {});
    expect(reply!['code'], `AC4 view3d is answered: ${shown(reply)}`).toBeUndefined();
    const f = obj(arr(reply!['frames'], 'AC4 view3d: frames').map((x) => obj(x, 'frame')).find((x) => x['frame'] === 0), 'AC4 view3d: frame 0');
    const finalPng = readNamed(evidence, f['final'], 'png', 'AC4 final');
    if (!planted) keepProof('ac4-outline-final.png', finalPng);
    const final = decodePng(finalPng);
    const at = idsOf(evidence, f, 'AC4');
    const [w, h] = SIZE;
    const s = obj(reply!['status'], `AC4 view3d: status (${shown(reply)})`);
    const problems: string[] = [];
    const boxes: number[][] = [];
    const marks = arr(s['marks'], 'status.marks').map((v) => obj(v, 'mark'));
    for (const m of marks) if (Array.isArray(m['label'])) boxes.push(m['label'].map((x) => num(x, 'label box')));
    for (const e of arr(s['legend'] ?? [], 'status.legend')) if (isObject(e)) for (const k of ['swatch', 'label']) if (Array.isArray(e[k])) boxes.push(e[k].map((x) => num(x, 'legend box')));
    const mark = marks.find((m) => m['item'] === 'frame');
    if (!mark || mark['state'] !== 'fail' || hex(arr(mark['color'], 'mark.color').map((x) => num(x, 'channel'))) !== FAIL) problems.push(`AC4 frame: no fail mark in the exact ${FAIL}: ${shown(marks)}`);
    const mask = new Uint8Array(w * h);
    for (const [x, y, bw, bh] of boxes) for (let j = Math.max(0, Math.floor(y! - 2)); j < Math.min(h, Math.ceil(y! + bh! + 2)); j++) for (let i = Math.max(0, Math.floor(x! - 2)); i < Math.min(w, Math.ceil(x! + bw! + 2)); i++) mask[j * w + i] = 1;
    const inside = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (at(x, y) === 'frame') inside[y * w + x] = 1;
    const edge = new Uint8Array(w * h);
    let boundary = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!inside[i]) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !inside[i - 1] || !inside[i + 1] || !inside[i - w] || !inside[i + w]) { edge[i] = 1; boundary++; }
    }
    const ring = grow(edge, w, h, RING);
    let outline = 0; let away = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i] || hex(pixel(final, x, y)) !== FAIL) continue;
      if (ring[i]) outline++; else away++;
    }
    console.log(`AC4: frame silhouette boundary ${boundary} px; ${outline} px of exact ${FAIL} around it, ${away} elsewhere${planted ? ` (planted ${planted})` : ''}`);
    if (boundary < 300) problems.push(`AC4 frame: its silhouette's boundary is only ${boundary} px; the piece needs 300`);
    if (outline < 0.5 * boundary) problems.push(`AC4 frame: only ${outline} px of the exact ${FAIL} within ${RING} px of its silhouette, under half its ${boundary} boundary px: no outline in the exact status color after tone map and bloom`);
    if (away > 0) problems.push(`AC4 frame: ${away} px of the exact ${FAIL} lie more than ${RING} px from its silhouette`);
    return problems;
  }

  it('AC4 with a verdict binding on the frame its outline draws in the exact status color after tone map and bloom; a finish that tone-maps the status outline fails, naming the frame', () => {
    requireMetal();
    none(outlineProblems(), 'AC4 the status outline');
    const planted = outlineProblems('status_before_tone_map');
    keepProof('ac4-planted-status_before_tone_map.json', planted);
    failsNaming(planted, ['AC4 frame'], 'AC4 the planted status_before_tone_map');
  }, 1_800_000);
});
