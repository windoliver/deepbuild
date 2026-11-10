// AC3 #486.d12f88ca: A lobe the material lacks is refused: an operator that writes sheen on a material whose sheen
// weight is 0, with no channel, driver or control that can move it off 0, is refused at check with operator_kind_rule,
// naming the output, the operator and the material, and so is one that writes coat_roughness on a material with coat 0;
// on a velvet whose sheen weight is 0.6 the same operator checks, shows sheen only where it writes above 0, and creates
// no pipeline after the first frame, counted on the noop lane; a planted check that turns the missing lobe on instead of
// refusing compiles a feature set in the frame the operator first runs and fails, naming the material.
//
// The operator `glaze` (helpers: `GLAZE`) writes sheen 0.6 where uv0.u < 0.5 and 0 elsewhere; `polish` writes
// coat_roughness 0.2. Three documents, each a 1 m plate under a sun and the studio environment, hidden at first and
// turned on at frame 3 by a toggle bound to its `visible` (helpers: `toggledDoc`; no channel, driver or control touches
// a material): `velvet` (sheen weight 0.6) under glaze on `velvet_plate`; `felt` (the same velvet at sheen weight 0)
// under glaze on `felt_plate`; `matte` (coat 0) under polish on `matte_plate`.
// 1. On the noop lane, `live` plays the three for 6 frames at 30 fps, each toggle turned on at frame 3: `felt`'s session
//    is refused with an error operator_kind_rule whose path, step, IDs or message name `sheen`, `glaze` and `felt`, each
//    as a whole word; `matte`'s with one naming `coat_roughness`, `polish` and `matte`; `velvet`'s plays, draws frame 3,
//    and no frame after its first lists a created pipeline (#432's `created`). `--planted missing_lobe_turned_on` (the
//    check admits the operator and the material's feature set gains the lobe only in the frame a part first runs it)
//    fails the same check, a created pipeline naming the material `felt` (its plate, mapped to its material, or the
//    material) at frame 3, the frame its plate first draws.
// 2. On Metal at 512 × 512, seen at a grazing angle where sheen shows: the velvet plate under glaze matches, within one
//    10-bit code value per channel on 99.9% of pixels away from the split's column, the same plate as two halves with no
//    operator, the left the velvet (0.6) and the right the velvet at sheen 0; on the left half, where glaze writes 0.6,
//    at least 90% of pixels read more than one code from the whole plate at sheen 0, so the sheen shows there.
// Wrong programs: the base (the outputs unknown, every document refused with operator_type); a check that refuses the
// velvet too, or misses the material; one that turns the lobe on late; an output that turns sheen on where it writes 0.
import { describe, expect, it } from 'vitest';
import {
  AC, BARE, GLAZE, POLISH, SPLIT_SIZE, TURN_ON, VELVET, atSplit, bareDoc, draw, failsNaming, firstDrawn, inputAt, isObject, issueNames, judgedPixels,
  liveCall, liveReply, nameOff, none, offPixels, payload, requireMetal, runGpu, sessionRow, shown, toggledDoc, useDir, useGpu, velvetHalvesDoc,
  velvetOpDoc, worstCodes, writeJson, type Drawn, type JsonObject, type Live, type Planted,
} from './helpers.ts';

const ID = AC[3];
const bin = useGpu();
const dir = useDir();

const MATTE: JsonObject = { base_color: [0.5, 0.5, 0.5, 1], metallic: 0, roughness: 0.5, coat: 0 };
// Session IDs that don't hold a material's ID as a word, so a failure names a material only from what the run reports.
const SESSIONS = [
  { session: 's_velvet', doc: () => toggledDoc('velvet-live', 'velvet', VELVET, 'glaze', GLAZE(), 'velvet_plate') },
  { session: 's_felt', doc: () => toggledDoc('felt-live', 'felt', BARE, 'glaze', GLAZE(), 'felt_plate') },
  { session: 's_matte', doc: () => toggledDoc('matte-live', 'matte', MATTE, 'polish', POLISH(), 'matte_plate') },
];
/** The materials that lack the lobe their operator writes, and what the refusal must name. */
const LACKS = [
  { session: 's_felt', material: 'felt', operator: 'glaze', output: 'sheen' },
  { session: 's_matte', material: 'matte', operator: 'polish', output: 'coat_roughness' },
];
const MATERIAL_OF: Record<string, string> = { velvet_plate: 'velvet', felt_plate: 'felt', matte_plate: 'matte' };

function play(out: string, planted?: Planted): Live {
  const sessions = SESSIONS.map((s) => ({ session: s.session, doc: writeJson(out, `${s.session}-live`, payload(s.doc())), size: [320, 320] as [number, number] }));
  const call = liveCall(6, sessions, SESSIONS.map((s) => inputAt(TURN_ON, s.session, 'show', true)));
  return liveReply(runGpu(bin(), out, [call], { lane: 'noop', ...(planted ? { planted } : {}) })[0]!, 'the three plates on the noop lane');
}
/** What the check must do and didn't, and every pipeline created after a session's first frame, each named. */
function problems(live: Live): { refusals: string[]; created: string[] } {
  const refusals: string[] = [];
  for (const l of LACKS) {
    const row = sessionRow(live, l.session);
    const issues = Array.isArray(row['issues']) ? row['issues'].filter(isObject) : [];
    const named = issues.some((i) => i['code'] === 'operator_kind_rule' && issueNames(i, l.output) && issueNames(i, l.operator) && issueNames(i, l.material));
    if (row['state'] !== 'refused') refusals.push(`${l.material}: ${l.operator} writes ${l.output}, a lobe material ${l.material} lacks, and the check admitted it`);
    else if (!named) refusals.push(`${l.material}: refused, but with no operator_kind_rule naming ${l.output}, ${l.operator} and ${l.material}: ${shown(row['issues'])}`);
  }
  const velvet = sessionRow(live, 's_velvet');
  if (velvet['state'] !== 'live') refusals.push(`velvet: glaze writing sheen on a velvet of sheen 0.6 doesn't check: ${shown(velvet)}`);
  else if (!live.views.some((v) => v.session === 's_velvet' && v.frame === TURN_ON && v.drawn)) refusals.push(`velvet: frame ${TURN_ON}, where its plate turns on, isn't drawn`);
  const created: string[] = [];
  for (const s of SESSIONS) {
    const first = firstDrawn(live, s.session);
    for (const v of live.views) {
      if (v.session !== s.session || first === null || v.frame <= first) continue;
      for (const c of v.created) {
        const items = c.items.map((i) => (MATERIAL_OF[i] ? `${i} (material ${MATERIAL_OF[i]})` : i)).join(', ');
        created.push(`${s.session}: frame ${v.frame} created a pipeline for ${items}, feature set ${c.feature_set}, into ${c.target}`);
      }
    }
  }
  return { refusals, created };
}

describe(`${ID} an operator that writes a lobe its material lacks is refused at check`, () => {
  it(`${ID} sheen on a material of sheen weight 0 and coat_roughness on one of coat 0 are refused with operator_kind_rule naming the output, the operator and the material; on a velvet of sheen 0.6 the same operator checks and no pipeline is created after the first frame, on the noop lane; a planted check that turns the lobe on compiles a feature set where the operator first runs and fails, naming the material`, () => {
    const shipped = problems(play(dir()));
    none([...shipped.refusals, ...shipped.created], 'the refusals and the velvet on the noop lane');
    const live = play(dir(), 'missing_lobe_turned_on');
    const planted = problems(live);
    console.log(`${ID}: --planted missing_lobe_turned_on: ${[...planted.refusals, ...planted.created].join('; ').slice(0, 3000)}`);
    failsNaming(planted.created, ['felt'], '--planted missing_lobe_turned_on: a pipeline created after the first frame');
    const atTurnOn = live.views.filter((v) => v.session === 's_felt' && v.frame === TURN_ON).flatMap((v) => v.created);
    expect(atTurnOn.some((c) => c.items.includes('felt_plate') || c.items.includes('felt')), `--planted missing_lobe_turned_on compiles felt's feature set at frame ${TURN_ON}, where its plate first runs glaze: ${JSON.stringify(atTurnOn).slice(0, 1500)}`).toBe(true);
  }, 3_600_000);

  it(`${ID} on a velvet whose sheen weight is 0.6, sheen written 0.6 on the left and 0 on the right shows sheen only where it writes above 0, within one 10-bit code of the velvet and bare halves on 99.9% of pixels`, () => {
    requireMetal();
    const [op, halves, bare] = draw(bin(), dir(), [
      { name: 'glaze', doc: velvetOpDoc() },
      { name: 'velvet and bare halves', doc: velvetHalvesDoc() },
      { name: 'the bare plate', doc: bareDoc() },
    ]) as [Drawn, Drawn, Drawn];
    const px = judgedPixels(op, ['plate'], halves, ['left', 'right'], 1, atSplit);
    const off = offPixels(op, halves, px).sort((a, b) => b.codes - a.codes);
    const left = px.filter((p) => p.x + 0.5 < SPLIT_SIZE[0] / 2);
    const sheened = left.filter((p) => worstCodes(halves.linear.at(p.x, p.y), bare.linear.at(p.x, p.y)) > 1).length;
    console.log(`${ID}: glaze against the halves: ${off.length} of ${px.length} judged pixels more than one code off; sheen shows on ${sheened} of ${left.length} left-half pixels`);
    expect(left.length, 'left-half pixels judged').toBeGreaterThanOrEqual(10_000);
    expect(sheened, 'the fixture: the velvet\'s sheen shows on at least 90% of the left half').toBeGreaterThanOrEqual(0.9 * left.length);
    none(off.length > 0.001 * px.length ? [`glaze: ${off.length} of ${px.length} plate pixels (more than 0.1%) differ from the velvet and bare halves by more than one 10-bit code value; the worst, ${nameOff(off[0]!)}`] : [], 'the velvet under glaze');
  }, 3_600_000);
});
