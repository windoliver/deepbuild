// #63 AC1: install reads 212 recorded sessions within 5% of one 5-hour window on the fixture corpus, and every wiki
// line cites a handle. #63 AC4: no reading job puts more than the capped slices of the record into any prompt, for
// the install read and a trial's replay (the issue's Proof), and the pasting twin fails it, naming the job.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseClaimLine } from '../../../packages/record/src/index.ts';
import { promptProblems } from './checks.ts';
import { byTag, CORPUS_SIZE, FACTS, fixtureCorpus, PROJECTS } from './corpus.ts';
import { AC, cleanup, norm, repliesOf, type Line } from './helpers.ts';
import { pasteJob } from './wrong.ts';
import { dataOf, openWorld, runReading, type JobRan, type World } from './world.ts';

const corpus = fixtureCorpus();
const tags = byTag(corpus);
let w: World;
beforeAll(async () => {
  w = await openWorld();
  await w.seed(corpus);
}, 600_000);
afterAll(async () => {
  await w?.close();
  await cleanup();
});
let installing: Promise<JobRan> | undefined;
const install = () => (installing ??= runReading(w, { kind: 'install' }));
let replaying: Promise<JobRan> | undefined;
const replay = () => (replaying ??= runReading(w, { kind: 'replay', handles: corpus.slice(0, 24).map((s) => s.handle), question: 'How did these sessions start each project? Quote what to remember.' }));

/** The session handle a read asked for: `session:<id>` without its message. */
const sessionOf = (handle: string): string => handle.split('#')[0]!;

describe(`AC1 ${AC[1]} install reads 212 recorded sessions within 5% of one 5-hour window, and every wiki line cites a handle`, () => {
  it('AC1 the fixture corpus is 212 recorded sessions, each archived and linked by a transcript.archived event', async () => {
    expect(corpus).toHaveLength(CORPUS_SIZE);
    expect(CORPUS_SIZE).toBe(212);
    const linked = new Set((await w.events(['transcript.archived'])).map((e) => String(dataOf(e).session)));
    expect(corpus.filter((s) => !linked.has(s.handle)).map((s) => s.handle), 'every corpus session is archived').toEqual([]);
  });

  it('AC1 install reads every one of the 212 sessions, through the runner only, spending under 5% of one 5-hour window, and shows its plan usage', async () => {
    const ran = await install();
    expect(ran.runs.length, 'the install read ran jobs through the runner').toBeGreaterThan(0);
    for (const r of ran.runs) expect(r.rec.kind, `${r.job} is a reading job of the runner`).toBe('read');
    expect([...ran.result.runs].sort(), 'the jobs the install names are exactly the runner jobs that started while it ran').toEqual(ran.runs.map((r) => r.job).sort());
    const read = new Set(ran.runs.flatMap((r) => repliesOf(r.stdout).filter((x) => !x.error).map((x) => sessionOf(x.args.handle))));
    expect(corpus.filter((s) => !read.has(s.handle)).map((s) => s.handle), 'every recorded session was read, a slice at a time, by the job').toEqual([]);
    expect(ran.tokens, 'the job spent tokens: it read').toBeGreaterThan(0);
    console.log(`AC1 install: ${ran.runs.length} runs, ${ran.tokens} tokens, ${ran.sharePct.toFixed(2)}% of one 5-hour window`);
    expect(ran.sharePct, `the install read spent ${ran.tokens} tokens, ${ran.sharePct.toFixed(2)}% of one 5-hour window`).toBeLessThan(5);
    expect(ran.result.plan, 'the job shows its plan usage, never "not captured"').not.toBe('not captured');
    const plan = ran.result.plan as { five_hour_pct: number };
    expect(Number.isFinite(plan.five_hour_pct) && plan.five_hour_pct >= 0, `plan usage shown as a share of the 5-hour window: ${JSON.stringify(plan)}`).toBe(true);
    expect(plan.five_hour_pct, 'the plan usage it shows is within 5% of one 5-hour window').toBeLessThanOrEqual(5);
    const finished = (await w.events(['reading.finished'])).filter((e) => dataOf(e).reading === ran.result.reading);
    expect(finished, `one reading.finished event records ${ran.result.reading}`).toHaveLength(1);
    expect((dataOf(finished[0]!).plan as Line | null)?.five_hour_pct, 'the record shows the plan usage too').toBe(plan.five_hour_pct);
  }, 1_800_000);

  it("AC1 every wiki line the install wrote cites a handle it was delivered, the quote at that handle, and each project's fact is on the wiki", async () => {
    const ran = await install();
    const folder = join(w.root, 'wiki');
    const pages: { page: string; lines: string[] }[] = [];
    const walk = (dir: string): void => {
      if (!existsSync(dir)) return;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, e.name);
        if (e.isDirectory()) walk(path);
        else if (e.name.endsWith('.md')) {
          const page = relative(folder, path).slice(0, -3);
          if (page !== 'index' && page !== 'log') pages.push({ page, lines: readFileSync(path, 'utf8').split('\n') });
        }
      }
    };
    walk(folder);
    expect(pages.length, 'the install wrote wiki pages').toBeGreaterThan(0);
    const delivered = new Set(corpus.map((s) => s.handle));
    const quoted: string[] = [];
    const problems: string[] = [];
    for (const p of pages) p.lines.forEach((raw, i) => {
      if (!raw.trim() || raw.startsWith('#') || /^Of these \d+ claims, /.test(raw)) return;
      const where = `${p.page}.md:${i + 1}`;
      const claim = parseClaimLine(raw);
      if (!claim) { problems.push(`${where} is a line with no claim record: ${raw.slice(0, 120)}`); return; }
      const sources = ((claim.record as Line).sources ?? []) as Line[];
      const cited = sources.filter((s) => typeof s.at === 'string');
      if (!cited.length) { problems.push(`${where} cites no handle: ${raw.slice(0, 120)}`); return; }
      for (const s of cited) {
        const at = String(s.at);
        if (!delivered.has(sessionOf(at))) problems.push(`${where} cites ${at}, which the install wasn't delivered`);
        const text = w.said.get(at);
        if (text === undefined) problems.push(`${where} cites ${at}, which names no message of the corpus`);
        else if (!norm(text).includes(norm(String(s.quote)))) problems.push(`${where}: the quote ${JSON.stringify(s.quote)} is not at ${at}`);
        quoted.push(norm(String(s.quote)));
      }
    });
    expect(problems, `every wiki line cites a handle (${ran.result.reading})`).toEqual([]);
    for (const p of PROJECTS) expect(quoted.some((q) => q.includes(norm(FACTS[p]!))), `a wiki line quotes ${p}'s fact: ${FACTS[p]}`).toBe(true);
    expect(ran.result.written.length, 'the install reports the wiki claims it wrote').toBeGreaterThan(0);
  }, 1_800_000);
});

describe(`AC4 ${AC[4]} no reading job puts more than the capped slices of the record into any prompt`, () => {
  it('AC4 the install read and a trial replay: no prompt holds more of the record than a capped slice, and no reply is past the cap', async () => {
    for (const [name, ran] of [['install', await install()], ['replay', await replay()]] as const) {
      expect(ran.runs.length, `the ${name} read ran jobs`).toBeGreaterThan(0);
      expect(ran.runs.flatMap((r) => repliesOf(r.stdout)).length, `the ${name} read got slices`).toBeGreaterThan(0);
      expect(promptProblems(ran.runs, tags), `the ${name} read`).toEqual([]);
    }
  }, 1_800_000);

  it('AC4 (wrong program) a job that pastes the whole session into its prompt fails the check, naming the job', async () => {
    const run = await pasteJob(w, corpus[0]!.handle);
    const problems = promptProblems([run], tags);
    expect(problems.length, 'the check finds the pasted session').toBeGreaterThan(0);
    expect(problems.join('\n'), 'the failure names the job').toContain(run.job);
  }, 600_000);
});
