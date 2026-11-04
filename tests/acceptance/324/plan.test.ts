// #324 AC2: a plan whose scope is past the repo's usual size reaches you before any code is written (design: Size
// and scope, "When the plan marks an issue as large, its scope section, the files and parts it will touch, is sized
// before any code, and a plan past the usual size comes to you once"; the issue's Scope: "approve, shrink or split").
//
// The usual feature change in the world's repo touches 3 files (helpers.ts, HISTORY). The task's handed plan marks
// the issue as large, and its scope section names 12 files and 2 parts. Before the agent's first edit lands, an ask
// reaches you whose options are approve, shrink and split. When the hub holds that first edit until you answer, the
// test answers approve; either way the ask must be in the record before the edit's change is made. After the work and
// a stop, no second such ask: it comes to you once.
//
// Its twin, in the same test: a plan that also marks the issue as large but whose scope is one file, within the usual
// 3, reaches you with no such ask; the agent's edit goes through. So the ask comes from the plan's size, not from the
// mark alone.
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import {
  AC2, allEvents, BEHAVIOR, BEHAVIOR_DRAFT, FIX, FLAG, USUAL, answer, asksRaised, cleanup, decision, lastPos, listed, lockedTask, makeWorld, must, optionWords, plan, said, Session,
  settle, shown, startHub, trustRepo, type Ev, type Hub, type Plan, type World,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const RULES = Array.from({ length: 11 }, (_, i) => `src/rules/r${String(i + 1).padStart(2, '0')}.js`);
const LARGE = plan({ files: ['src/auth.js', ...RULES], parts: ['auth middleware', 'token rules'] }, true);
const SMALL = plan({ files: ['src/auth.js'], parts: ['auth middleware'] }, true);
/** An ask about the plan's size: its options are approve, shrink and split (the issue's Scope). */
const planAsk = (e: Ev): boolean => { const words = optionWords(e).join(' ').toLowerCase(); return /approve/.test(words) && /shrink/.test(words) && /split/.test(words); };

/**
 * One session on the handed plan, up to its first edit: the ask about the plan raised meanwhile (or undefined), the
 * log position at the moment the first edit's change was made (or undefined when it never was), and the hub.
 */
async function firstEdit(p: Plan): Promise<{ w: World; hub: Hub; s: Session; since: number; asked: Ev | undefined; madeAt: number | undefined }> {
  const w = makeWorld({ drafts: [BEHAVIOR_DRAFT(p)] });
  await trustRepo(w);
  const hub = await startHub(w);
  const s = new Session(w);
  await s.start();
  const since = await lastPos(hub);
  await s.typed(BEHAVIOR);
  await s.read('src/auth.js');
  await lockedTask(hub, s, BEHAVIOR, AC2);
  // The plan is sized before any code: give it the time a hub takes to raise an ask.
  let events = await settle(hub, (all) => asksRaised(all, since).some(planAsk), 20_000);
  let asked = asksRaised(events, since).find(planAsk);
  // The first edit; a hub that holds it until you answer gets your approve, so the edit can go on.
  let madeAt: number | undefined;
  const path = join(w.repo, FIX.file);
  const edit = s.call('Edit', { file_path: path, old_string: FIX.from, new_string: FIX.to, replace_all: false }, {
    response: { filePath: path, oldString: FIX.from, newString: FIX.to, replaceAll: false, structuredPatch: [], userModified: false },
    effect: async () => { madeAt = await lastPos(hub); writeFileSync(path, readFileSync(path, 'utf8').replace(FIX.from, FIX.to)); },
    timeoutMs: 150_000,
  });
  let answered = false;
  const poll = (async () => {
    for (let i = 0; i < 240 && madeAt === undefined; i++) {
      events = await settle(hub, (all) => asksRaised(all, since).some(planAsk), 500);
      const found = asksRaised(events, since).find(planAsk);
      if (found && !answered) {
        asked ??= found;
        answered = true;
        const option = ((found.data.options ?? []) as { id: string; label?: string }[]).find((o) => /approve/i.test(`${o.id} ${o.label ?? ''}`));
        if (option) { const r = await answer(w, found, option.id); must(r.code === 0, `BLOCKED: ${AC2} your approve of the plan must be taken: ${shown(r)}`); }
      }
      if (answered) return;
    }
  })();
  const done = await edit;
  await poll;
  if (!done.allowed && madeAt === undefined) must(decision(done.before) === 'deny', `BLOCKED: ${AC2} the first edit neither went through nor was refused: ${shown(done.before)}`);
  return { w, hub, s, since, asked, madeAt };
}

describe(`${AC2} a plan past the usual size reaches you before any code is written`, () => {
  it(`${AC2} a large plan of ${LARGE.scope.files.length} files (usual ${USUAL.files}) brings one ask with approve, shrink and split before the first edit lands; a large plan of 1 file brings none`, async () => {
    const big = await firstEdit(LARGE);
    must(big.asked !== undefined, `${AC2} the plan marks the issue as large and names ${LARGE.scope.files.length} files against a usual ${USUAL.files}: an ask with approve, shrink and split must reach you before any code is written; the asks raised were ${listed(asksRaised(await allEvents(big.hub), big.since))}`);
    must(big.madeAt === undefined || big.asked!.log_pos <= big.madeAt, `${AC2} the ask about the plan must be in the record before the first edit's change is made: the edit was made at log_pos ${big.madeAt}, the ask came at ${big.asked!.log_pos} (${said(big.asked)})`);
    must(JSON.stringify(big.asked!.data).includes(String(LARGE.scope.files.length)) || LARGE.scope.files.some((f) => JSON.stringify(big.asked!.data).includes(f)), `${AC2} the ask shows the plan's scope it sized (its ${LARGE.scope.files.length} files): ${said(big.asked)}`);
    // The work goes on, and a stop: the plan came to you once.
    if (big.madeAt === undefined) await big.s.edit(FIX.file, FIX.from, FIX.to).catch(() => undefined);
    await big.s.edit(FLAG.file, FLAG.from, FLAG.to);
    await big.s.stop('Expired tokens are now rejected.');
    const after = await settle(big.hub, () => false, 5_000);
    const plans = asksRaised(after, big.since).filter(planAsk);
    must(plans.length === 1, `${AC2} the plan comes to you once: ${plans.length} asks about it (${listed(plans)})`);
    await cleanup();

    const small = await firstEdit(SMALL);
    must(small.asked === undefined, `${AC2} a large plan of 1 file is within the usual ${USUAL.files}: no ask about its size, yet one came (${said(small.asked)})`);
    must(small.madeAt !== undefined, `${AC2} with no ask about the plan, the first edit goes through`);
  }, 600_000);
});
