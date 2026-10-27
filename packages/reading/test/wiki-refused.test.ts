// A finding the wiki refuses is dropped and logged like any other (#63 AC2's "dropped and logged"): the wiki reads a
// quote without a URL's query string, so a quote the reading's own check holds can still be refused there. Real
// runner, record, wiki and fake agent from #63's acceptance world.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { session, tag } from '../../../tests/acceptance/63/corpus.ts';
import { cleanup } from '../../../tests/acceptance/63/helpers.ts';
import { dataOf, openWorld, runReading } from '../../../tests/acceptance/63/world.ts';

afterAll(cleanup);

test('an install finding the wiki refuses is not kept, and is logged as reading.dropped naming its handle', async () => {
  const s = session(6303, { project: 'api', count: 2, texts: { 1: `${tag(6303, 1)} the docs are at https://x.io/a?k=v for the api` } });
  const at = `${s.handle}#m1`;
  const w = await openWorld({ planted: [{ text: 'the docs live at x.io', cites: [{ at, quote: 'a?k=v' }] }] });
  try {
    await w.seed([s]);
    const { result } = await runReading(w, { kind: 'install' });
    expect(result.findings.some((f) => f.text === 'the docs live at x.io')).toBe(false);
    expect(result.dropped.some((d) => d.at === at && d.quote === 'a?k=v' && d.reason.includes(at))).toBe(true);
    const logged = (await w.events(['reading.dropped'])).map(dataOf).filter((d) => d.reading === result.reading && d.quote === 'a?k=v');
    expect(logged.length).toBe(1);
    const finished = (await w.events(['reading.finished'])).map(dataOf).find((d) => d.reading === result.reading)!;
    expect(finished.findings).toBe(result.findings.length);
  } finally {
    await w.close();
  }
}, 120_000);

// The learned layer's scope names a repo by letters and digits only, and widens no claim past its evidence: a
// finding from a project like 'my-app' is dropped and logged, while the install goes on.
test("an install over a project id no repo scope can name finishes, dropping and logging that project's finding", async () => {
  const s = session(6305, { project: 'my-app', count: 2, texts: { 1: `${tag(6305, 1)} the api listens on port 3000` } });
  const at = `${s.handle}#m1`;
  const w = await openWorld({ planted: [{ text: 'the api listens on port 3000', cites: [{ at, quote: 'the api listens on port 3000' }] }] });
  try {
    await w.seed([s]);
    const { result } = await runReading(w, { kind: 'install' });
    expect(result.findings.some((f) => f.text === 'the api listens on port 3000')).toBe(false);
    expect(result.dropped.find((d) => d.at === at)?.reason).toMatch(/repo:my-app/);
    const finished = (await w.events(['reading.finished'])).map(dataOf).find((d) => d.reading === result.reading)!;
    expect(finished.state).not.toBe('failed');
  } finally {
    await w.close();
  }
}, 120_000);

test('a later install that restates a claim keeps the sources an earlier install gave it', async () => {
  const T = 'the api listens on port 3000';
  const a = session(6306, { project: 'api', count: 2, texts: { 1: `${tag(6306, 1)} ${T}` } });
  const b = session(6307, { project: 'api', count: 2, texts: { 1: `${tag(6307, 1)} ${T}` } });
  const w = await openWorld({ planted: [{ text: T, cites: [{ at: `${a.handle}#m1`, quote: T }] }] });
  try {
    await w.seed([a, b]);
    await runReading(w, { kind: 'install', handles: [a.handle] });
    w.plant([{ text: T, cites: [{ at: `${b.handle}#m1`, quote: T }] }]);
    const { result } = await runReading(w, { kind: 'install', handles: [b.handle] });
    expect(result.dropped).toEqual([]);
    const page = readFileSync(join(w.root, 'wiki/repos/api.md'), 'utf8');
    const lines = page.split('\n').filter((l) => l.startsWith(`- ${T} `));
    expect(lines.length).toBe(1);
    const claim = JSON.parse(/<!-- deep:claim (\{.*\}) -->/.exec(lines[0]!)![1]!) as { proof: number; sources: { at: string }[] };
    expect(claim.sources.map((s) => s.at).sort()).toEqual([`${a.handle}#m1`, `${b.handle}#m1`].sort());
    expect(claim.proof).toBe(2);
  } finally {
    await w.close();
  }
}, 240_000);

// Invariant 3: agents can't change your decisions. A claim you corrected on its page is yours; an install that
// restates the agent's earlier words is dropped and logged, and your line stays as you wrote it.
test('a later install never restates a claim you corrected', async () => {
  const T = 'the api listens on port 3000';
  const U = 'the api listens on port 4000';
  const a = session(6308, { project: 'api', count: 2, at: { 1: 'agent' }, texts: { 1: `${tag(6308, 1)} ${T}` } });
  const b = session(6309, { project: 'api', count: 2, at: { 1: 'agent' }, texts: { 1: `${tag(6309, 1)} ${T}` } });
  const w = await openWorld({ planted: [{ text: T, cites: [{ at: `${a.handle}#m1`, quote: T }] }] });
  try {
    await w.seed([a, b]);
    await runReading(w, { kind: 'install', handles: [a.handle] });
    const file = join(w.root, 'wiki/repos/api.md');
    writeFileSync(file, readFileSync(file, 'utf8').replace(`- ${T} <!--`, `- ${U} <!--`));
    expect((await w.wiki.keepEdits({ writer: 'cli', actor: 'you', scope: 'you' })).length).toBe(1);
    const yours = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`- ${U} `));
    expect(yours).toBeDefined();
    w.plant([{ text: T, cites: [{ at: `${b.handle}#m1`, quote: T }] }]);
    const { result } = await runReading(w, { kind: 'install', handles: [b.handle] });
    expect(result.written.filter((h) => h.includes('the-api-listens-on-port-3000'))).toEqual([]);
    expect(result.dropped.find((d) => d.at === `${b.handle}#m1`)?.reason).toMatch(/is yours/);
    const lines = readFileSync(file, 'utf8').split('\n');
    expect(lines).toContain(yours);
    expect(lines.some((l) => l.startsWith(`- ${T} `))).toBe(false);
  } finally {
    await w.close();
  }
}, 240_000);

test('a finding the wiki keeps is not dropped with a duplicate of it that the wiki refuses', async () => {
  const s = session(6304, { project: 'api', count: 2, texts: { 1: `${tag(6304, 1)} the docs are at https://x.io/a?k=v for the api` } });
  const at = `${s.handle}#m1`;
  const w = await openWorld({ planted: [
    { text: 'the docs live at x.io', cites: [{ at, quote: 'the docs are at' }] },
    { text: 'the docs live at x.io', cites: [{ at, quote: 'a?k=v' }] },
  ] });
  try {
    await w.seed([s]);
    const { result } = await runReading(w, { kind: 'install' });
    const kept = result.findings.filter((f) => f.text === 'the docs live at x.io');
    expect(kept.map((f) => f.cites.map((c) => c.quote))).toEqual([['the docs are at']]);
    expect(result.dropped.map((d) => d.quote)).toEqual(['a?k=v']);
  } finally {
    await w.close();
  }
}, 120_000);
