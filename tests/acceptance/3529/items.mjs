import { blocked, brief, isObject, list, same } from './common.mjs';
import { STATE_AT, TOLD_TO_SPIN, TOLD_TO_TRAP, TOLD_TO_WRITE, sha256, twinProgram, twinStateAtStep } from './wasm.mjs';

export const STEPS = 30;
const FLICKS_A_STEP_AT_60_HZ = 705_600_000 / 60;

export const TOLD_AT_STEP = { a: [[5, TOLD_TO_WRITE], [14, TOLD_TO_SPIN]], b: [[9, TOLD_TO_WRITE], [20, TOLD_TO_TRAP]] };
export const WRITES_AND_ENDS = { a: { wrote: 5, at: 14, kind: 'fuel' }, b: { wrote: 9, at: 20, kind: 'unreachable' } };
const ENTRIES_IN_TRACK_ORDER = Object.entries(TOLD_AT_STEP).flatMap(([id, told]) => told.map(([step, value]) => ({ id, step, value }))).sort((x, y) => x.step - y.step);

export function bakeOfItems(ids) {
  const program = twinProgram();
  const sha = sha256(program);
  const controls = {}, items = {};
  for (const id of ids) {
    controls[`poke_${id}`] = { kind: 'slider' };
    items[id] = { kind: 'logic@1', params: { program: sha, reads: [`poke_${id}`], writes: { state: { type: 'i32', count: 2 } }, checkpoint: { every: 10 } } };
  }
  const track = ENTRIES_IN_TRACK_ORDER.map(({ id, step, value }, placeInWholeTrack) => ({ id, entry: { t: step * FLICKS_A_STEP_AT_60_HZ, seq: placeInWholeTrack, control: `poke_${id}`, value, writer: 'you', player: 1 } })).filter(({ id }) => ids.includes(id)).map(({ entry }) => entry);
  return { call: 'bake', piece: { seed: 3529, controls, items, assets: { [sha]: program.toString('base64') } }, track, steps: STEPS, peek: ids.map((id) => ({ item: id, at: STATE_AT, len: 4 })) };
}
export const bakeOfBothItems = () => bakeOfItems(['a', 'b']);

function itemReading(reply, id) {
  const row = (r) => (isObject(r) ? { hash: r.hash ?? null, fuel: r.fuel ?? null, failed: r.failed ?? null, pages: r.pages ?? null } : null);
  return {
    program: reply.items?.[id]?.hash ?? null,
    steps: list(reply.steps).map((s) => ({ step: s.step, row: row(s.items?.[id]), state: s.arrays?.[`${id}.state`] ?? null })),
    checkpoints: list(reply.checkpoints?.[id]).map((c) => [c.step, c.deep_hash]),
    traps: list(reply.traps).filter((t) => t.item === id).map((t) => [t.step ?? null, t.kind ?? null]),
    memory: list(reply.peeks).find((p) => p.item === id)?.hex ?? null,
  };
}

export async function readItems(logic) {
  const bake = async (ids) => {
    const reply = await logic.send(bakeOfItems(ids), `the bake of ${ids.join(' and ')}`);
    if (reply.ok !== true) throw blocked(`${logic.name} refuses this suite's piece of ${ids.join(' and ')}: ${brief(reply, 600)}`);
    return Object.fromEntries(ids.map((id) => [id, itemReading(reply, id)]));
  };
  const pair = await bake(['a', 'b']);
  return { pair, alone: { ...(await bake(['a'])), ...(await bake(['b'])) } };
}

export function whyReadingCannotJudge({ pair, alone }) {
  if (typeof pair.a.program !== 'string' || pair.a.program !== pair.b.program) return `a and b aren't two items of the same bytes: their rewritten programs are ${brief([pair.a.program, pair.b.program])}`;
  for (const [id, { wrote, at, kind }] of Object.entries(WRITES_AND_ENDS)) {
    const read = alone[id];
    if (read.steps.length < at) return `${id} alone ran ${read.steps.length} steps, and its program runs ${at} before it ends`;
    const off = read.steps.slice(0, at).find(({ step, state }) => !same(state, twinStateAtStep(step, wrote)));
    if (off) return `${id} alone wrote ${brief(off.state)} at step ${off.step}, where its program writes ${brief(twinStateAtStep(off.step, wrote))} (its memory, its global)`;
    if (!same(read.traps, [[at, kind]])) return `${id} alone trapped at ${brief(read.traps)} (step, kind), where its program ends at step ${at} with ${kind}`;
    if (read.steps.slice(0, at).some(({ row }) => row?.failed !== false)) return `${id} alone is failed before step ${at}`;
  }
  return null;
}

export function itemsNotAsAlone({ pair, alone }) {
  const problems = [];
  for (const id of ['a', 'b']) {
    const [beside, solo, other] = [pair[id], alone[id], id === 'a' ? 'b' : 'a'];
    const say = (what) => problems.push(`item ${id}: ${what}: what ${other} did shows in ${id}`);
    const at = [...Array(Math.max(beside.steps.length, solo.steps.length)).keys()].find((n) => !same(beside.steps[n], solo.steps[n]));
    if (at !== undefined) {
      const [b, s] = [beside.steps[at], solo.steps[at]];
      const step = (b ?? s).step;
      const parts = [];
      if (b?.state?.[0] !== s?.state?.[0]) parts.push(`its memory holds ${brief(b?.state?.[0] ?? null)} beside ${other} and ${brief(s?.state?.[0] ?? null)} alone`);
      if (b?.state?.[1] !== s?.state?.[1]) parts.push(`its global holds ${brief(b?.state?.[1] ?? null)} beside ${other} and ${brief(s?.state?.[1] ?? null)} alone`);
      if (b?.row?.fuel !== s?.row?.fuel) parts.push(`its step took ${brief(b?.row?.fuel ?? null)} fuel beside ${other} and ${brief(s?.row?.fuel ?? null)} alone`);
      if (b?.row?.failed !== s?.row?.failed) parts.push(`it is ${b?.row?.failed ? 'failed' : 'running'} beside ${other} and ${s?.row?.failed ? 'failed' : 'running'} alone`);
      if (!parts.length) parts.push(`its row is ${brief(b ?? null, 200)} beside ${other} and ${brief(s ?? null, 200)} alone`);
      say(`at step ${step} ${parts.join(', ')}`);
    }
    if (!same(beside.traps, solo.traps)) say(`it trapped at ${brief(beside.traps)} (step, kind) beside ${other} and at ${brief(solo.traps)} alone`);
    const checkpoint = [...Array(Math.max(beside.checkpoints.length, solo.checkpoints.length)).keys()].find((n) => !same(beside.checkpoints[n], solo.checkpoints[n]));
    if (checkpoint !== undefined) {
      const [b, s] = [beside.checkpoints[checkpoint], solo.checkpoints[checkpoint]];
      say(`its checkpoint at step ${(b ?? s)[0]} has the full-state hash ${b?.[1] ?? 'none'} beside ${other} and ${s?.[1] ?? 'none'} alone`);
    }
    if (beside.memory !== solo.memory) say(`after step ${STEPS - 1} its memory's own i32 reads ${beside.memory ?? 'nothing'} beside ${other} and ${solo.memory ?? 'nothing'} alone`);
  }
  return problems;
}
export const firstItemNamed = (problems) => problems.map((p) => /^item (a|b): /.exec(p)?.[1]).find(Boolean) ?? null;
