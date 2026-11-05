// The issue's Proof and Scope: a compiled wiki from real memory files, and the ranked keep-or-remove list. Each lesson
// becomes a proposed guard, a shared rule or a removal, ranked for you; keep and remove are your decisions.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  callTool, claudeSession, cleanup, compile, decision, decisions, deep, denialText, GONE, GUARD_COMMAND, lessonNaming, lessons, LIVE, memoryFile, memoryHome, namesFile, NEAR, projectMemory, ruleClaims, shown, snapshot, startAgent, toolCallIn, TWO, WIDE, AGENTS, type Mem,
} from './helpers.ts';

afterAll(cleanup, 60_000);

async function compiled(): Promise<Mem> {
  const m = memoryHome();
  claudeSession(m, m.api, { role: 'user', text: 'hello there' }, { role: 'assistant', text: 'Hello.' });
  projectMemory(m, m.api);
  await compile(m);
  return m;
}
const wholeWiki = (m: Mem): string => [...snapshot(m.wiki).values()].join('\n');

describe('Proof: the ranked keep-or-remove list', () => {
  it('Proof: `deep memory` lists each lesson as a guard, a shared rule or a removal, ranked 1..n, each with its sources; a rule four agents hold outranks one two hold', async () => {
    const m = await compiled();
    const all = await lessons(m);
    console.log(`the ranked keep-or-remove list:\n${all.map((l) => `${l.rank}. [${l.kind}] ${l.text} (${l.sources.length} sources)`).join('\n')}`);
    expect(all.map((l) => l.rank), 'ranked 1..n in the order listed').toEqual(all.map((_, i) => i + 1));
    expect(new Set(all.map((l) => l.id)).size, 'each lesson has its own ID').toBe(all.length);
    for (const l of all) {
      expect(['guard', 'shared-rule', 'removal'], `${l.id} is one of the three kinds`).toContain(l.kind);
      expect(l.sources.length, `${l.id} shows its sources`).toBeGreaterThan(0);
      for (const s of l.sources) expect(typeof s.quote === 'string' && s.quote.length > 0, `${l.id} quotes its source: ${JSON.stringify(s)}`).toBe(true);
    }

    const [wide] = lessonNaming(all, WIDE);
    const [two] = lessonNaming(all, TWO).filter((l) => !l.text.includes(NEAR));
    expect(wide?.kind, `"${WIDE}" is a shared rule`).toBe('shared-rule');
    expect(two?.kind, `"${TWO}" is a shared rule`).toBe('shared-rule');
    for (const a of AGENTS) expect(wide!.sources.some((s) => namesFile(s, memoryFile(m.h.home, a))), `the wide rule's lesson cites ${a}'s file`).toBe(true);
    expect(two!.sources.length, `"${TWO}" rests on two files`).toBe(2);
    expect(wide!.rank, 'the rule four agents hold ranks above the one two hold').toBeLessThan(two!.rank);

    const guards = lessonNaming(all, GUARD_COMMAND);
    expect(guards.map((l) => l.kind), `"Never run \`${GUARD_COMMAND}\`" is a proposed guard`).toEqual(['guard']);

    const gone = lessonNaming(all, GONE);
    expect(gone.map((l) => l.kind), `a memory line naming ${GONE}, a path no longer in its repo, is a proposed removal`).toEqual(['removal']);
    expect(lessonNaming(all, LIVE).map((l) => l.kind), `${LIVE} is in its repo, so no removal is proposed for it`).not.toContain('removal');
  }, 900_000);

  it('Proof: a person keeping a lesson saves a decision by the core, and it leaves the list, for good; the lessons left keep their IDs across a re-read', async () => {
    const m = await compiled();
    const all = await lessons(m);
    const [wide] = lessonNaming(all, WIDE);
    const before = (await decisions(m)).length;
    const kept = await deep(m.h.home, ['memory', 'keep', wide!.id]);
    expect(kept.code, `deep memory keep ${wide!.id}: ${shown(kept)}`).toBe(0);
    const after = await decisions(m);
    expect(after.length, 'your keep is saved as one decision').toBe(before + 1);
    expect(after.at(-1)!.writer, 'the core saves it').toBe('core');
    expect(ruleClaims(m, WIDE).length, 'the kept rule stays on its page').toBe(1);
    const left = await lessons(m);
    expect(left.map((l) => l.id), 'it leaves the list: you aren\'t asked twice').not.toContain(wide!.id);
    expect(left.map((l) => l.rank), 'what remains is ranked 1..n again').toEqual(left.map((_, i) => i + 1));
    await compile(m);
    const again = await lessons(m);
    expect(again.map((l) => l.id).sort(), 'a re-read brings the kept lesson back nowhere and renames none').toEqual(left.map((l) => l.id).sort());
  }, 900_000);

  it('Proof: a person removing a lesson takes its line off every page, and a re-read doesn\'t bring it back; its neighbour stays', async () => {
    const m = await compiled();
    const [gone] = lessonNaming(await lessons(m), GONE);
    expect(wholeWiki(m), 'the line is in the wiki before you remove it').toContain(GONE);
    const before = (await decisions(m)).length;
    const removed = await deep(m.h.home, ['memory', 'remove', gone!.id]);
    expect(removed.code, `deep memory remove ${gone!.id}: ${shown(removed)}`).toBe(0);
    expect((await decisions(m)).length, 'your removal is saved as one decision').toBe(before + 1);
    expect(wholeWiki(m), 'its line is off every page').not.toContain(GONE);
    expect(wholeWiki(m), 'its neighbour from the same file stays').toContain(LIVE);
    await compile(m);
    expect(wholeWiki(m), 'a re-read of the unchanged memory file doesn\'t bring it back').not.toContain(GONE);
    expect(lessonNaming(await lessons(m), GONE), 'nor offer it again').toEqual([]);
  }, 900_000);

  it('Proof: a proposed guard does nothing until you keep it; kept, deep-hook denies its command, and its twin still runs', async () => {
    const m = await compiled();
    const denied = async (command: string) => decision(await toolCallIn(m, m.api, command));
    expect(await denied(GUARD_COMMAND), `only proposed, ${GUARD_COMMAND} still runs`).toBe('allow');
    const [guard] = lessonNaming(await lessons(m), GUARD_COMMAND);
    const kept = await deep(m.h.home, ['memory', 'keep', guard!.id]);
    expect(kept.code, `deep memory keep ${guard!.id}: ${shown(kept)}`).toBe(0);
    const stopped = await toolCallIn(m, m.api, GUARD_COMMAND);
    expect(decision(stopped), `kept, deep-hook denies ${GUARD_COMMAND}: ${denialText(stopped as never)}`).toBe('deny');
    expect(await denied('make nuke-cache'), 'the twin still runs').toBe('allow');
  }, 900_000);
});

describe('Invariant 3: keep and remove are the person\'s', () => {
  it('Invariant 3: with the OS not confirming you, keep and remove are refused and nothing changes; an agent\'s deep_propose applies nothing, and no deep_* tool keeps or removes', async () => {
    const m = await compiled();
    const all = await lessons(m);
    const [wide] = lessonNaming(all, WIDE);
    const [gone] = lessonNaming(all, GONE);
    const count = (await decisions(m)).length;
    const pages = wholeWiki(m);

    writeFileSync(join(m.h.tmp, 'confirm'), 'cancelled\n');
    for (const [verb, id] of [['keep', wide!.id], ['remove', gone!.id]] as const) {
      const refused = await deep(m.h.home, ['memory', verb, id]);
      expect(refused.code, `deep memory ${verb} with no confirmation is refused: ${shown(refused)}`).not.toBe(0);
    }
    writeFileSync(join(m.h.tmp, 'confirm'), 'confirmed\n');
    expect((await decisions(m)).length, 'no decision was saved').toBe(count);
    expect(wholeWiki(m), 'no page changed').toBe(pages);
    expect((await lessons(m)).map((l) => l.id), 'the list is as it was').toEqual(all.map((l) => l.id));

    const { agent } = await startAgent(m, m.api, 'tidy the memory');
    const tools = await agent.request('tools/list');
    const names = ((tools.reply.result as { tools: { name: string }[] }).tools).map((t) => t.name);
    expect(names.filter((n) => /memory|keep|remove|lesson/.test(n)), 'no deep_* tool applies a lesson').toEqual([]);
    await callTool(agent, 'deep_propose', { target: gone!.id, change: `Remove this lesson: ${GONE}`, evidence: null });
    await callTool(agent, 'deep_propose', { target: wide!.id, change: 'Keep this lesson', evidence: null });
    expect((await decisions(m)).length, 'a proposal saves no decision').toBe(count);
    expect(wholeWiki(m), 'and changes no page').toContain(GONE);
    expect((await lessons(m)).map((l) => l.id), 'and leaves the list as it was').toEqual(all.map((l) => l.id));
  }, 900_000);
});
